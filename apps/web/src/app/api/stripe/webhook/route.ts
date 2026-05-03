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
import { eq } from 'drizzle-orm';
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

        // Cycle 3 RPF / P262-01 / C3-RPF-01: gate on session.payment_status === 'paid'.
        // Stripe's `checkout.session.completed` fires for ALL payment methods,
        // including async ones (ACH, bank transfer, OXXO, Boleto) where
        // `payment_status` can be `'unpaid'` until funds settle. Without this
        // gate the webhook would mint an entitlement and (under
        // LOG_PLAINTEXT_DOWNLOAD_TOKENS=true) write the manual-distribution
        // log for a customer who has not actually paid. Async-paid flows are
        // not currently supported; a future cycle should add a handler for
        // `checkout.session.async_payment_succeeded` to round out coverage.
        if (session.payment_status !== 'paid') {
            console.error('Stripe webhook: rejecting non-paid session', {
                sessionId: session.id,
                paymentStatus: session.payment_status,
            });
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        const imageIdStr = session.metadata?.imageId;
        const tier = session.metadata?.tier;
        // N-CYCLE1-01: defensive truncation to RFC-5321 max email length (320
        // chars). Stripe does not normally violate this, but a future schema
        // migration could shrink the column and silently drop the INSERT for
        // a paid order. Truncate at the read site so the rest of the path
        // sees a known-bounded string.
        // Cycle 3 RPF / P262-09 / C3-RPF-09: lowercase the email after slice
        // so case-mismatched stripes (`Customer@Example.COM` vs
        // `customer@example.com`) coalesce on the same DB row for future
        // customer-history lookups.
        const customerEmailRaw = session.customer_details?.email ?? session.customer_email ?? '';
        const customerEmail = customerEmailRaw.slice(0, 320).toLowerCase();
        const sessionId = session.id;
        const amountTotalCents = session.amount_total ?? 0;

        // Cycle 2 RPF / P260-03 / C2-RPF-03: validate email shape at ingest
        // before insert. Rejects values that contain whitespace or quoting
        // characters that could spoof renderings in downstream tools (CSV
        // exports, copy-paste to email clients). RFC-conformant for the common
        // case; we explicitly do not allow IDN/unicode-direction characters.
        // Cycle 3 RPF / P262-11: console.error so log-shipper alerts catch
        // this — silent rejects are bad ops UX.
        const EMAIL_SHAPE = /^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/;
        if (customerEmail && !EMAIL_SHAPE.test(customerEmail)) {
            console.error('Stripe webhook: rejecting malformed customer email shape', { sessionId });
            // 200 — Stripe should not retry; this is a permanent metadata error
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

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
        // Cycle 3 RPF / P262-11 / C3-RPF-11: console.error so log-shipper
        // alerts catch tier drift between Stripe dashboard config and the
        // gallery allowlist.
        if (!isPaidLicenseTier(tier)) {
            console.error('Stripe webhook: rejecting unknown tier in metadata', { sessionId });
            // 200 so Stripe does not retry — this is a permanent metadata error
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        const imageId = parseInt(imageIdStr, 10);
        if (!Number.isFinite(imageId) || imageId <= 0) {
            console.error('Stripe webhook: invalid imageId in metadata', imageIdStr);
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        // Cycle 3 RPF / P262-02 / C3-RPF-02: reject zero-amount sessions.
        // Stripe coupons / promotion codes can drop `amount_total` to 0. The
        // checkout route at /api/checkout/[imageId] already rejects
        // `priceCents <= 0` server-side, so the only way a $0 session reaches
        // this webhook is via a coupon applied in the Stripe dashboard or a
        // programmatic SDK call. Defense-in-depth: a $0 amount is conceptually
        // equivalent to "not for sale", so we treat it the same as the tier
        // allowlist reject.
        if (!Number.isInteger(amountTotalCents) || amountTotalCents <= 0) {
            console.error('Stripe webhook: rejecting zero-amount session', {
                sessionId,
                amountTotalCents,
            });
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        // Cycle 3 RPF / P262-07 / C3-RPF-07: idempotency on retry.
        // Stripe retries `checkout.session.completed` on transient failures.
        // Previously every retry called `generateDownloadToken()`, producing a
        // fresh plaintext token, which was then written to the
        // `[manual-distribution]` stdout line — but the DB row already has the
        // FIRST retry's hash, so an operator running `tail -1` would email a
        // token whose hash is NOT stored. Customer's download fails 404
        // "Token not found".
        //
        // Fix: SELECT first by `sessionId`. If a row already exists, this is a
        // retry for an already-recorded entitlement; skip token generation,
        // skip the manual-distribution log line entirely, and return 200.
        // The first-insert path is the only one that mints a token + log line.
        const [existing] = await db
            .select({ id: entitlements.id })
            .from(entitlements)
            .where(eq(entitlements.sessionId, sessionId))
            .limit(1);
        if (existing) {
            console.info(`Stripe webhook: idempotent skip — entitlement already exists session=${sessionId}`);
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        // Generate single-use download token.
        // The plaintext token would normally be emailed to the customer (deferred per PRD).
        // Only the hash is stored in DB.
        // Cycle 2 RPF / P260-01 / C2-RPF-01: until the email pipeline ships,
        // the plaintext token has no path to the customer. To close the
        // workflow loop with the lowest-risk change, surface the plaintext
        // token to stdout when the operator opts in via
        // `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`. Operators run `docker logs |
        // grep 'session=cs_...'` to retrieve the token and email it to the
        // customer manually. The opt-in flag prevents accidental token leakage
        // in default deployments. See `apps/web/README.md` "Paid downloads"
        // section for the operational workflow.
        // TODO(US-P54-phase2): replace this scaffold with the email pipeline.
        const { token: downloadToken, hash: downloadTokenHash } = generateDownloadToken();

        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        try {
            // Idempotent insert: sessionId UNIQUE prevents double-recording on Stripe retries.
            // The SELECT above is the primary idempotency guard for the
            // manual-distribution log line; this ON DUPLICATE KEY UPDATE
            // remains as belt-and-suspenders against a race between the SELECT
            // and the INSERT (two concurrent retries hitting between them).
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
        // entitlements row.
        // Cycle 2 RPF / P260-01: when LOG_PLAINTEXT_DOWNLOAD_TOKENS=true,
        // also surface the plaintext token + email to stdout on a separate
        // log line so operators can retrieve and email it to the customer.
        // This is opt-in to avoid leaking tokens in default deployments.
        console.info(`Entitlement created: imageId=${imageId} tier=${tier} session=${sessionId}`);
        if (process.env.LOG_PLAINTEXT_DOWNLOAD_TOKENS === 'true') {
            console.info(
                `[manual-distribution] download_token: imageId=${imageId} tier=${tier} ` +
                `session=${sessionId} email=${customerEmail} token=${downloadToken}`,
            );
        }
    }

    return NextResponse.json({ received: true }, { headers: NO_STORE });
}
