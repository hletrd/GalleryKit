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
// R20-L2: pin the route to the Node runtime explicitly. The Stripe SDK
// imports node-only modules (`crypto`, `https`); a future Next.js default
// flip to the Edge runtime, or a bundler heuristic miss, would otherwise
// break `getStripe()` at import time. Matches the convention used by every
// other paid-flow route in the repo (download, og, og/photo, search/semantic).
export const runtime = 'nodejs';

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

    // Fetch image and check tier.
    // R4C6 COR-R4C6-08: the DB reads sit inside a try so a transient
    // database error follows the route's own Pattern-2 contract — roll
    // back the pre-incremented per-IP budget and answer a JSON 500 with
    // NO_STORE — instead of escaping as a framework 500 that permanently
    // consumed the visitor's rate budget.
    let image: { id: number; title: string | null; license_tier: string; processed: boolean | null } | undefined;
    let priceCents: number;
    try {
        [image] = await db
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

        priceCents = await getTierPriceCents(image.license_tier);
    } catch (err) {
        // C7-RPF-01 structured log shape so operators can grep by imageId.
        console.error('Checkout image/price lookup failed', { imageId, ip, err });
        rollbackCheckoutAttempt(ip);
        return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500, headers: NO_STORE });
    }

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
        // R4C2 COR-R4C2-08: truncate by CODE POINTS (Array.from iterates by
        // code point) — a UTF-16 .slice(0, 199) could bisect a surrogate
        // pair and put U+FFFD on the customer's Stripe receipt.
        const titleCodePoints = image.title ? Array.from(image.title) : [];
        const titleForStripe = image.title
            ? (titleCodePoints.length > 200 ? titleCodePoints.slice(0, 199).join('') + '…' : image.title)
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
        // TRC-R5C1-16: when TRUST_PROXY is not configured, getClientIp()
        // returns 'unknown' and all concurrent buyers of the same image in
        // the same minute would share one Stripe idempotency key, causing the
        // second buyer's session creation to silently return the FIRST
        // buyer's session URL. Fix: omit the key entirely for unknown-IP
        // callers so each request creates a fresh Stripe session. Stripe-side
        // deduplication is lost only for misconfigured-proxy deployments —
        // the correct trade-off versus silently colliding distinct buyers.
        // AGG-R5C3-23 (CRT-R5C3-02): omitting the key ALSO forfeits the
        // single-buyer double-click dedup on unknown-IP deployments — a buyer
        // who double-clicks Buy gets TWO pending Stripe sessions instead of one.
        // This is self-healing (unpaid sessions expire ~24 h) and never
        // double-charges (each session is paid independently or not at all), so
        // it is an acceptable degradation versus the cross-buyer collision that
        // a shared 'unknown' key would cause.
        // Operators should set TRUST_PROXY=true behind a reverse proxy so
        // per-IP deterministic keys work correctly.
        const stripeOptions: { idempotencyKey?: string } = {};
        if (ip !== 'unknown') {
            stripeOptions.idempotencyKey = `checkout-${image.id}-${ip}-${Math.floor(Date.now() / 60_000)}`;
        }
        const session = await stripe.checkout.sessions.create(
            {
                mode: 'payment',
                // AGG-H1 / CRT-R5C1-04 (run-6 cycle-2): pin to card-only
                // (immediate-capture) until the stripe webhook handles
                // checkout.session.async_payment_succeeded (tracked in
                // plan-316 CRT-R5C1-04). Async-payment methods (SEPA / ACH /
                // bank-transfer / OXXO / Boleto) fire completed+unpaid, then
                // settle days later via async_payment_succeeded — which we do
                // NOT yet handle, so a buyer would be charged with no
                // entitlement / download token (money-taken-no-goods). Forcing
                // card-only makes completed+unpaid unreachable, closing the gap
                // operationally. DO NOT add async methods here before the
                // async_payment_succeeded handler ships.
                payment_method_types: ['card'],
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
            stripeOptions,
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
