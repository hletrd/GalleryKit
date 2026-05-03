/**
 * US-P54: POST /api/checkout/[imageId]
 *
 * Public-facing Stripe Checkout session creation.
 * This route is OUTSIDE /api/admin/ so lint:api-auth does not apply.
 * Authentication is by Stripe signature on the resulting webhook.
 *
 * Flow:
 *   1. Validate imageId and that the image exists with license_tier != 'none'.
 *   2. Read tier price from admin_settings.
 *   3. Create a Stripe Checkout session (hosted) with image metadata.
 *   4. Return { url } for client redirect.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { images, adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe } from '@/lib/stripe';
import { GALLERY_SETTING_KEYS } from '@/lib/gallery-config-shared';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

const TIER_PRICE_KEYS: Record<string, string> = {
    editorial: 'license_price_editorial_cents',
    commercial: 'license_price_commercial_cents',
    rm: 'license_price_rm_cents',
};

async function getTierPriceCents(tier: string): Promise<number> {
    const key = TIER_PRICE_KEYS[tier];
    if (!key || !(GALLERY_SETTING_KEYS as readonly string[]).includes(key)) return 0;
    const [row] = await db
        .select({ value: adminSettings.value })
        .from(adminSettings)
        .where(eq(adminSettings.key, key))
        .limit(1);
    const cents = row ? parseInt(row.value, 10) : 0;
    return Number.isInteger(cents) && cents >= 0 ? cents : 0;
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ imageId: string }> }
): Promise<Response> {
    const { imageId: imageIdStr } = await params;
    const imageId = parseInt(imageIdStr, 10);
    if (!Number.isFinite(imageId) || imageId <= 0) {
        return NextResponse.json({ error: 'Invalid image ID' }, { status: 400, headers: NO_STORE });
    }

    // Fetch image and check tier
    const [image] = await db
        .select({ id: images.id, title: images.title, license_tier: images.license_tier, processed: images.processed })
        .from(images)
        .where(eq(images.id, imageId))
        .limit(1);

    if (!image) {
        return NextResponse.json({ error: 'Image not found' }, { status: 404, headers: NO_STORE });
    }
    if (image.license_tier === 'none' || !image.license_tier) {
        return NextResponse.json({ error: 'This image is not available for purchase' }, { status: 400, headers: NO_STORE });
    }
    if (!image.processed) {
        return NextResponse.json({ error: 'Image is still processing' }, { status: 400, headers: NO_STORE });
    }

    const priceCents = await getTierPriceCents(image.license_tier);
    if (priceCents <= 0) {
        return NextResponse.json({ error: 'This image is not priced for sale' }, { status: 400, headers: NO_STORE });
    }

    try {
        const stripe = getStripe();
        const origin = request.nextUrl.origin;
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        unit_amount: priceCents,
                        product_data: {
                            name: image.title ? `${image.title} — ${image.license_tier} license` : `Photo #${image.id} — ${image.license_tier} license`,
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
            customer_email: undefined,
            success_url: `${origin}/p/${image.id}?checkout=success`,
            cancel_url: `${origin}/p/${image.id}?checkout=cancel`,
        });

        return NextResponse.json({ url: session.url }, { headers: NO_STORE });
    } catch (err) {
        console.error('Stripe checkout session creation failed:', err);
        return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500, headers: NO_STORE });
    }
}
