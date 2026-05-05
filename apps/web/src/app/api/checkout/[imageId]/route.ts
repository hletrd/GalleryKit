/**
 * US-P54: POST /api/checkout/[imageId]
 *
 * Public-facing Stripe Checkout session creation.
 * This route is OUTSIDE /api/admin/ so lint:api-auth does not apply.
 * Authentication is by Stripe signature on the resulting webhook.
 *
 * Flow:
 *   1. Per-IP rate limit (cycle 1 RPF / C1RPF-PHOTO-HIGH-01).
 *   2. Validate imageId and that the image exists with license_tier != 'none'.
 *   3. Read tier price from admin_settings.
 *   4. Create a Stripe Checkout session (hosted) with image metadata.
 *   5. Return { url } for client redirect.
 *
 * Cycle 1 RPF / plan-100:
 *   - C1RPF-PHOTO-HIGH-01: per-IP rate limit added (10/60s, rollback on
 *     infrastructure error per Pattern 2 in lib/rate-limit.ts).
 *   - C1RPF-PHOTO-MED-02: tier allowlist hoisted to lib/license-tiers.ts.
 *   - C1RPF-PHOTO-LOW-03: success_url/cancel_url derive locale from
 *     Referer so the visitor lands back on the same locale they came from.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { images, adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe } from '@/lib/stripe';
import { GALLERY_SETTING_KEYS } from '@/lib/gallery-config-shared';
import { PAID_TIER_PRICE_KEYS, isPaidLicenseTier, deriveLocaleFromReferer } from '@/lib/license-tiers';
import {
    preIncrementCheckoutAttempt,
    rollbackCheckoutAttempt,
    getClientIp,
    CHECKOUT_WINDOW_MS,
} from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

async function getTierPriceCents(tier: string): Promise<number> {
    if (!isPaidLicenseTier(tier)) return 0;
    const key = PAID_TIER_PRICE_KEYS[tier];
    if (!(GALLERY_SETTING_KEYS as readonly string[]).includes(key)) return 0;
    const [row] = await db
        .select({ value: adminSettings.value })
        .from(adminSettings)
        .where(eq(adminSettings.key, key))
        .limit(1);
    // D-101-11: strict integer parse — `parseInt('500abc', 10)` is 500 and
    // `parseInt('  500  ', 10)` is 500. We need a strict /^\d+$/ shape so a
    // typo in the admin price field cannot silently charge a visitor a
    // truncated price. The settings UI validates on submit, but defense in
    // depth at the read site is cheap.
    if (!row) return 0;
    const raw = row.value;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return 0;
    const cents = Number(raw);
    return Number.isInteger(cents) && cents >= 0 && cents <= Number.MAX_SAFE_INTEGER ? cents : 0;
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ imageId: string }> }
): Promise<Response> {
    // C1RPF-PHOTO-HIGH-01: pre-increment rate limit BEFORE any DB work.
    // Pattern 2: rollback on every early-return so legitimate visitors who
    // hit a 4xx (image not found, not for sale) are not penalized.
    const ip = getClientIp(request.headers);
    if (preIncrementCheckoutAttempt(ip)) {
        return NextResponse.json(
            { error: 'Too many checkout attempts. Please try again shortly.' },
            {
                status: 429,
                headers: {
                    ...NO_STORE,
                    'Retry-After': String(Math.ceil(CHECKOUT_WINDOW_MS / 1000)),
                },
            },
        );
    }

    const { imageId: imageIdStr } = await params;
    const imageId = parseInt(imageIdStr, 10);
    if (!Number.isFinite(imageId) || imageId <= 0) {
        rollbackCheckoutAttempt(ip);
        return NextResponse.json({ error: 'Invalid image ID' }, { status: 400, headers: NO_STORE });
    }

    // Fetch image and check tier
    const [image] = await db
        .select({ id: images.id, title: images.title, license_tier: images.license_tier, processed: images.processed })
        .from(images)
        .where(eq(images.id, imageId))
        .limit(1);

    if (!image) {
        rollbackCheckoutAttempt(ip);
        return NextResponse.json({ error: 'Image not found' }, { status: 404, headers: NO_STORE });
    }
    if (!image.license_tier || !isPaidLicenseTier(image.license_tier)) {
        rollbackCheckoutAttempt(ip);
        return NextResponse.json({ error: 'This image is not available for purchase' }, { status: 400, headers: NO_STORE });
    }
    if (!image.processed) {
        rollbackCheckoutAttempt(ip);
        return NextResponse.json({ error: 'Image is still processing' }, { status: 400, headers: NO_STORE });
    }

    const priceCents = await getTierPriceCents(image.license_tier);
    if (priceCents <= 0) {
        rollbackCheckoutAttempt(ip);
        return NextResponse.json({ error: 'This image is not priced for sale' }, { status: 400, headers: NO_STORE });
    }

    try {
        const stripe = getStripe();
        const origin = request.nextUrl.origin;
        // C1RPF-PHOTO-LOW-03: locale-aware redirect URLs.
        // D-101-12: also pass accept-language so a cross-site Referer with
        // an unsupported locale prefix falls through to the visitor's
        // browser-declared language preference instead of `en`.
        const locale = deriveLocaleFromReferer(
            request.headers.get('referer'),
            request.headers.get('accept-language'),
        );
        // N-CYCLE1-03: defensive truncation. Stripe enforces a 1500-char
        // limit on `product_data.name`. `images.title` is admin-controlled
        // and should normally be short, but truncating at the call site
        // prevents a silent Stripe API rejection on a corner-case title.
        // Cycle 2 RPF / P260-09 / C2-RPF-14: append an ellipsis when truncation
        // actually fires so the customer's Stripe receipt shows the elision
        // explicitly rather than a silent cut.
        const titleForStripe = image.title
            ? (image.title.length > 200 ? image.title.slice(0, 199) + '…' : image.title)
            : null;
        // Cycle 6 RPF / P390-01 / C6-RPF-01: pass an Idempotency-Key on the
        // Stripe Checkout session POST. Stripe deduplicates server-side when
        // the same key is used, so a browser double-click (or transient
        // network retry) returns the same session.id rather than creating a
        // second pending Checkout session that would otherwise sit unpaid in
        // the dashboard until expiry (~24h) and trigger false-positive
        // payment-monitoring alerts. The minute-window deterministic key
        // (`checkout-${imageId}-${ip}-${minute}`) collapses rapid duplicates
        // while keeping distinct legitimate buys at minute N+1 separate.
        // Mirrors the cycle 5 P388-01 refund idempotency-key pattern.
        // C18-HIGH-01: the key MUST be deterministic per user context. Adding
        // randomness (e.g. randomUUID) defeats deduplication entirely. When
        // TRUST_PROXY is not set, IP becomes 'unknown' and all users share
        // the same key — this is a deployment-configuration issue, not a
        // code bug. Operators should set TRUST_PROXY=true when behind a
        // reverse proxy so per-IP keys work correctly.
        const idempotencyKey = `checkout-${image.id}-${ip}-${Math.floor(Date.now() / 60_000)}`;
        const session = await stripe.checkout.sessions.create(
            {
                mode: 'payment',
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: priceCents,
                            product_data: {
                                name: titleForStripe
                                    ? `${titleForStripe} — ${image.license_tier} license`
                                    : `Photo #${image.id} — ${image.license_tier} license`,
                                description: `Single-use download license (${image.license_tier})`,
                            },
                        },
                        quantity: 1,
                    },
                ],
                metadata: {
                    imageId: String(image.id),
                    tier: image.license_tier,
                },
                success_url: `${origin}/${locale}/p/${image.id}?checkout=success`,
                cancel_url: `${origin}/${locale}/p/${image.id}?checkout=cancel`,
            },
            { idempotencyKey },
        );

        return NextResponse.json({ url: session.url }, { headers: NO_STORE });
    } catch (err) {
        // Cycle 7 RPF / P392-01 / C7-RPF-01: structured-object log shape so
        // operators triaging a Stripe outage can grep by imageId. Mirrors
        // the cycle 5/6 webhook log refactor pattern.
        console.error('Stripe checkout session creation failed', { imageId: image.id, ip, err });
        // Pattern 2: roll back the rate-limit charge for legitimate visitors
        // hit by a transient Stripe outage so they aren't penalized.
        rollbackCheckoutAttempt(ip);
        return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500, headers: NO_STORE });
    }
}
