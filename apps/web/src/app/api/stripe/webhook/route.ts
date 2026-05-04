/**
 * @public-no-rate-limit-required: webhook is gated by Stripe signature
 *   verification (`stripe.webhooks.constructEvent`) which cryptographically
 *   binds the request body to STRIPE_WEBHOOK_SECRET. Stripe enforces
 *   server-side rate limits on its own outbound webhook deliveries, so an
 *   IP-bucketed limit at this endpoint would only impact Stripe's retry
 *   behavior on legitimate events. Forged unsigned requests are 400'd in
 *   constant time before any DB work.
 *
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
import { entitlements, images } from '@/db/schema';
import { constructStripeEvent } from '@/lib/stripe';
import { generateDownloadToken } from '@/lib/download-tokens';
import { isPaidLicenseTier } from '@/lib/license-tiers';
import type Stripe from 'stripe';

export const dynamic = 'force-dynamic';
// MUST be Node.js runtime — edge runtime does not support raw body reads
// required for Stripe webhook signature verification.
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

// Cycle 5 RPF / P388-04 / C5-RPF-04: hoist EMAIL_SHAPE regex to module
// scope. Consistency with `STORED_HASH_SHAPE` in
// `apps/web/src/lib/download-tokens.ts` (also module-scoped). V8 caches
// regex literals so the micro-perf gain is essentially free; the readability
// and consistency win is the primary motive.
//
// Cycle 2 RPF / P260-03 / C2-RPF-03: validate email shape at ingest before
// insert. Rejects values that contain whitespace or quoting characters that
// could spoof renderings in downstream tools (CSV exports, copy-paste to
// email clients). RFC-conformant for the common case; we explicitly do not
// allow IDN/unicode-direction characters.
const EMAIL_SHAPE = /^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/;

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
        // Cycle 7 RPF / P392-02 / C7-RPF-02: structured-object log shape.
        // signatureLength helps operators distinguish a malformed/truncated
        // signature header from a genuine signature mismatch (a malformed
        // header would have an unusual length; a real attacker-supplied
        // forgery would have the typical Stripe length but wrong HMAC).
        console.error('Stripe webhook signature verification failed', {
            signatureLength: signature.length,
            err,
        });
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
        // Cycle 4 RPF / P264-03 / C4-RPF-03: split the log severity so
        // `'unpaid'` (the documented async-paid happy path) does not trigger
        // PagerDuty pages keyed on `console.error`. Reserve `console.error`
        // for `'no_payment_required'` and any future unexpected status, which
        // should also be caught by the zero-amount gate below.
        if (session.payment_status !== 'paid') {
            if (session.payment_status === 'unpaid') {
                console.warn('Stripe webhook: rejecting non-paid (async) session', {
                    sessionId: session.id,
                    paymentStatus: session.payment_status,
                });
            } else {
                console.error('Stripe webhook: rejecting unexpected non-paid status', {
                    sessionId: session.id,
                    paymentStatus: session.payment_status,
                });
            }
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        const imageIdStr = session.metadata?.imageId;
        const tier = session.metadata?.tier;
        // N-CYCLE1-01: defensive truncation to schema column width.
        // Cycle 4 RPF / P264-01 / C4-RPF-01: slice to 255 (the
        // entitlements.customer_email varchar(255) width), NOT to RFC-5321's
        // 320-char max. In MySQL strict mode an INSERT with a 256-320 char
        // email would throw `Data too long for column 'customer_email'`,
        // returning 500 to Stripe and triggering retries indefinitely while
        // each retry mints a fresh plaintext token.
        // Cycle 3 RPF / P262-09 / C3-RPF-09: lowercase the email after slice
        // so case-mismatched stripes (`Customer@Example.COM` vs
        // `customer@example.com`) coalesce on the same DB row for future
        // customer-history lookups.
        // Cycle 4 RPF / P264-05 / C4-RPF-05: trim accidental whitespace from
        // misconfigured callers BEFORE the EMAIL_SHAPE regex, which rejects
        // any whitespace and would otherwise drop a legit address with
        // copy-paste padding.
        // D-101-09: lowercase + trim customerEmail before INSERT so the
        // same human appearing as `User@Example.com` and `user@example.com`
        // in two purchases doesn't show up as two rows in /sales.
        const customerEmailRaw = session.customer_details?.email ?? session.customer_email ?? '';
        const sessionId = session.id;
        const amountTotalCents = session.amount_total ?? 0;

        // Cycle 5 RPF / P388-06 / C5-RPF-06: reject 256+-char raw email
        // BEFORE truncation. Cycle 4 P264-01 set the slice to 255 to match
        // schema column width, but truncation is silent: a 1000-char
        // misconfigured upstream email could pass the post-truncation
        // EMAIL_SHAPE regex (rare, but a 250-char-local + valid domain
        // fits 255) and get persisted with a different mailbox than the
        // customer intended. Treat oversized raw emails as malformed — this
        // is a data-integrity safeguard, not a hygiene one.
        const trimmedEmailRaw = customerEmailRaw.trim();
        if (trimmedEmailRaw.length > 255) {
            // Cycle 6 RPF / P390-05 / C6-RPF-05: include `cap: 255` in the
            // structured payload so the log is self-describing. Operator
            // triage previously had to consult the source to map "length:
            // 1024 → why rejected?". Adding the cap makes the threshold
            // explicit at the log line.
            console.error('Stripe webhook: rejecting oversized customer email', {
                sessionId,
                length: trimmedEmailRaw.length,
                cap: 255,
            });
            // 200 — Stripe should not retry; permanent metadata error.
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }
        // Cycle 4 RPF / P264-01 / C4-RPF-01: slice to 255 (the
        // entitlements.customer_email varchar(255) width). Reachable only when
        // length <= 255 (the cycle 5 P388-06 reject above handles the
        // oversized case), so the slice is now a defense-in-depth no-op but
        // is preserved for explicitness against future column-width changes.
        // Cycle 3 RPF / P262-09 / C3-RPF-09: lowercase the email after slice
        // so case-mismatched stripes (`Customer@Example.COM` vs
        // `customer@example.com`) coalesce on the same DB row for future
        // customer-history lookups.
        // Cycle 4 RPF / P264-05 / C4-RPF-05: trim accidental whitespace from
        // misconfigured callers BEFORE the EMAIL_SHAPE regex, which rejects
        // any whitespace and would otherwise drop a legit address with
        // copy-paste padding. (Trimming is now done above into
        // `trimmedEmailRaw` so we only need slice + lowercase here.)
        const customerEmail = trimmedEmailRaw.slice(0, 255).toLowerCase();

        // Cycle 3 RPF / P262-11: console.error so log-shipper alerts catch
        // this — silent rejects are bad ops UX.
        if (customerEmail && !EMAIL_SHAPE.test(customerEmail)) {
            console.error('Stripe webhook: rejecting malformed customer email shape', { sessionId });
            // 200 — Stripe should not retry; this is a permanent metadata error
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        // D-101-04: do not require customerEmail in the guard — missing email
        // is handled by the sentinel placeholder below.
        if (!imageIdStr || !tier || !sessionId) {
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
        // D-101-04: previously a missing customerEmail caused the event to
        // be silently dropped (200 to Stripe, no entitlement row). The
        // photographer then had no audit trail tying the Stripe payment to
        // an image. The schema column is NOT NULL, so we substitute a
        // sentinel placeholder — `unknown+<sessionId>@stripe.local` — that
        // is unambiguously non-real (the `.local` TLD is reserved by RFC
        // 6762) but still satisfies the column constraint and tags the
        // row with the originating session for manual reconciliation
        // against the Stripe dashboard.
        let resolvedEmail = customerEmail;
        if (!resolvedEmail) {
            resolvedEmail = `unknown+${sessionId}@stripe.local`;
            console.warn('Stripe webhook: customer email missing, recording entitlement with sentinel placeholder', {
                sessionId,
            });
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
            // Cycle 6 RPF / P390-02 / C6-RPF-02: structured-object log shape
            // for consistency with all cycle 1-5 webhook log lines (idempotent
            // skip, entitlement created, oversized email, etc.). The
            // sessionId correlation key was missing from the prior positional
            // form, making operator triage by sessionId impossible.
            console.error('Stripe webhook: invalid imageId in metadata', {
                sessionId,
                imageIdStr,
            });
            return NextResponse.json({ received: true }, { headers: NO_STORE });
        }

        // Cycle 4 RPF / P264-02 / C4-RPF-02: defensive cross-check between
        // Stripe metadata tier and the image's CURRENT license_tier in DB.
        // If admin re-tiers an image after checkout creation but before
        // webhook delivery, the entitlement gets recorded with the stale
        // metadata tier. Behavior is unchanged (we still proceed using the
        // metadata tier — the customer paid for that tier, after all). This
        // is an audit signal only so operators can spot the drift.
        const [currentImage] = await db
            .select({ license_tier: images.license_tier })
            .from(images)
            .where(eq(images.id, imageId))
            .limit(1);
        if (currentImage && currentImage.license_tier !== tier) {
            console.warn('Stripe webhook: tier mismatch between Stripe metadata and current image tier', {
                sessionId,
                imageId,
                metadataTier: tier,
                currentTier: currentImage.license_tier,
            });
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
            // Cycle 5 RPF / P388-02 / C5-RPF-02: structured-object log shape
            // for consistency with cycle 1-4 lines. Log shippers (Datadog,
            // Loki) parse JSON better than free-form text.
            console.info('Stripe webhook: idempotent skip', { sessionId });
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
                customerEmail: resolvedEmail,
                sessionId,
                amountTotalCents,
                downloadTokenHash,
                expiresAt,
            }).onDuplicateKeyUpdate({ set: { sessionId } }); // no-op update keeps idempotency
        } catch (err) {
            // Cycle 7 RPF / P392-03 / C7-RPF-03: structured-object log shape
            // with sessionId/imageId/tier so operator can correlate the
            // failure with the Stripe retry that follows (Stripe retries on
            // our 500). Without these keys, repeated retries produce
            // indistinguishable log lines.
            console.error('Stripe webhook: failed to insert entitlement', {
                sessionId,
                imageId,
                tier,
                err,
            });
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
        // Cycle 5 RPF / P388-02 / C5-RPF-02: structured-object log shape for
        // consistency with cycle 1-4 lines.
        console.info('Entitlement created', { imageId, tier, sessionId });
        if (process.env.LOG_PLAINTEXT_DOWNLOAD_TOKENS === 'true') {
            console.info(
                `[manual-distribution] download_token: imageId=${imageId} tier=${tier} ` +
                `session=${sessionId} email=${customerEmail} token=${downloadToken}`,
            );
        }
    }

    return NextResponse.json({ received: true }, { headers: NO_STORE });
}
