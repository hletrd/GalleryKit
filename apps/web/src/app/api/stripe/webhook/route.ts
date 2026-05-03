/**
 * US-P54: POST /api/stripe/webhook
 *
 * This route is OUTSIDE /api/admin/ — authentication is by Stripe webhook
 * signature (STRIPE_WEBHOOK_SECRET), not admin cookie. The lint:api-auth
 * gate only applies to routes under /api/admin/, so no withAdminAuth wrapper
 * is needed or appropriate here.
 *
 * MUST run in Node.js runtime (not edge) to access raw request body for
 * stripe.webhooks.constructEvent signature verification.
 *
 * On checkout.session.completed:
 *   1. Verify Stripe signature (mandatory — never trust unsigned webhooks).
 *   2. INSERT entitlement with session_id UNIQUE for idempotency.
 *   3. Generate single-use download token; store sha256 hash in entitlement.
 *   4. Token is surfaced in admin /sales view (email sending deferred).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { entitlements } from '@/db/schema';
import { constructStripeEvent } from '@/lib/stripe';
import { generateDownloadToken } from '@/lib/download-tokens';
import { isPaidLicenseTier } from '@/lib/license-tiers';
import type Stripe from 'stripe';

export const dynamic = 'force-dynamic';
// MUST be Node.js runtime — edge runtime does not support raw body reads
// required for Stripe webhook signature verification.
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

export async function POST(request: NextRequest): Promise<Response> {
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
        return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400, headers: NO_STORE });
    }

    // Read raw body as text — required for Stripe signature verification.
    let payload: string;
    try {
        payload = await request.text();
    } catch {
        return NextResponse.json({ error: 'Failed to read request body' }, { status: 400, headers: NO_STORE });
    }

    // Verify Stripe webhook signature — MANDATORY. Never trust unsigned webhooks.
    let event: Stripe.Event;
    try {
        event = constructStripeEvent(payload, signature);
    } catch (err) {
        console.error('Stripe webhook signature verification failed:', err);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400, headers: NO_STORE });
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const imageIdStr = session.metadata?.imageId;
        const tier = session.metadata?.tier;
        // N-CYCLE1-01: defensive truncation to RFC-5321 max email length (320
        // chars). Stripe does not normally violate this, but a future schema
        // migration could shrink the column and silently drop the INSERT for
        // a paid order. Truncate at the read site so the rest of the path
        // sees a known-bounded string.
        const customerEmailRaw = session.customer_details?.email ?? session.customer_email ?? '';
        const customerEmail = customerEmailRaw.slice(0, 320);
        const sessionId = session.id;
        const amountTotalCents = session.amount_total ?? 0;

        if (!imageIdStr || !tier || !customerEmail || !sessionId) {
            // C1RPF-PHOTO-MED-01: do not log customerEmail at error level — it
            // is PII and ends up in retained log shippers. Log presence flags
            // only so on-call has enough to triage without storing PII.
            console.error('Stripe webhook: missing required metadata', {
                hasImageIdStr: Boolean(imageIdStr),
                hasTier: Boolean(tier),
                hasCustomerEmail: Boolean(customerEmail),
                hasSessionId: Boolean(sessionId),
            });
            // Return 200 to prevent Stripe from retrying malformed events
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        // C1RPF-PHOTO-MED-02: allowlist-validate tier from Stripe metadata
        // before it touches the entitlements table. A misconfigured Checkout
        // flow or future bug must not be able to seed arbitrary tier strings
        // ('admin', '<script>', etc.) into a row that gets rendered in the
        // admin /sales view.
        if (!isPaidLicenseTier(tier)) {
            console.warn('Stripe webhook: rejecting unknown tier in metadata', { sessionId });
            // 200 so Stripe does not retry — this is a permanent metadata error
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        const imageId = parseInt(imageIdStr, 10);
        if (!Number.isFinite(imageId) || imageId <= 0) {
            console.error('Stripe webhook: invalid imageId in metadata', imageIdStr);
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        // Generate single-use download token.
        // The plaintext token would normally be emailed to the customer (deferred per PRD).
        // Only the hash is stored in DB; surfaced in admin /sales view for manual distribution.
        const { hash: downloadTokenHash } = generateDownloadToken();

        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        try {
            // Idempotent insert: sessionId UNIQUE prevents double-recording on Stripe retries.
            await db.insert(entitlements).values({
                imageId,
                tier,
                customerEmail,
                sessionId,
                amountTotalCents,
                downloadTokenHash,
                expiresAt,
            }).onDuplicateKeyUpdate({ set: { sessionId } }); // no-op update keeps idempotency
        } catch (err) {
            console.error('Stripe webhook: failed to insert entitlement:', err);
            // Return 500 so Stripe retries
            return NextResponse.json({ error: 'Database error' }, { status: 500, headers: NO_STORE });
        }

        // C1RPF-PHOTO-MED-01: drop tokenHash from the structured log line.
        // The hash is not the token, but pairing it with sessionId in
        // retained log shippers creates a transaction-level ledger that
        // the photographer did not consciously opt into. Keep imageId/tier/
        // sessionId for audit; the hash is already persisted in the
        // entitlements row and surfaced via the admin /sales view.
        console.info(`Entitlement created: imageId=${imageId} tier=${tier} session=${sessionId}`);
    }

    return NextResponse.json({ received: true }, { headers: NO_STORE });
}
