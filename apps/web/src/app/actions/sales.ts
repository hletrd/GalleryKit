'use server';

/**
 * US-P54: Server actions for admin /sales view.
 * List entitlements, refund, and revenue totals.
 * All mutating actions require requireSameOriginAdmin().
 */

import { db } from '@/db';
import { entitlements, images } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { isAdmin } from '@/app/actions/auth';
import { requireSameOriginAdmin } from '@/lib/action-guards';
import { getStripe } from '@/lib/stripe';

export interface EntitlementRow {
    id: number;
    imageId: number;
    imageTitle: string | null;
    tier: string;
    customerEmail: string;
    sessionId: string;
    amountTotalCents: number;
    downloadedAt: Date | null;
    expiresAt: Date;
    refunded: boolean;
    createdAt: Date;
}

/** @action-origin-exempt: read-only admin getter */
export async function listEntitlements(): Promise<{ error?: string; rows?: EntitlementRow[] }> {
    if (!(await isAdmin())) return { error: 'Not authorized' };

    try {
        const rows = await db
            .select({
                id: entitlements.id,
                imageId: entitlements.imageId,
                imageTitle: images.title,
                tier: entitlements.tier,
                customerEmail: entitlements.customerEmail,
                sessionId: entitlements.sessionId,
                amountTotalCents: entitlements.amountTotalCents,
                downloadedAt: entitlements.downloadedAt,
                expiresAt: entitlements.expiresAt,
                refunded: entitlements.refunded,
                createdAt: entitlements.createdAt,
            })
            .from(entitlements)
            .leftJoin(images, eq(entitlements.imageId, images.id))
            .orderBy(desc(entitlements.createdAt))
            .limit(500);

        return {
            rows: rows.map((r) => ({
                id: r.id,
                imageId: r.imageId,
                imageTitle: r.imageTitle ?? null,
                tier: r.tier,
                customerEmail: r.customerEmail,
                sessionId: r.sessionId,
                amountTotalCents: r.amountTotalCents,
                downloadedAt: r.downloadedAt ?? null,
                expiresAt: r.expiresAt,
                refunded: r.refunded,
                createdAt: r.createdAt,
            })),
        };
    } catch (err) {
        console.error('listEntitlements failed:', err);
        return { error: 'Failed to load sales' };
    }
}

/**
 * Cycle 3 RPF / P262-06 / C3-RPF-06: `getTotalRevenueCents` was removed in
 * cycle 3 because cycle 2's P260-05 fix made the client compute revenue
 * directly from the loaded rows. The action's only remaining use was the
 * `rows.length === 0` fallback in /admin/sales — but in that case the
 * all-time SUM is also 0 (no rows to sum), so the action was dead code
 * paying for a full-table SUM on every page load. The exit criterion of
 * cycle 2's deferred item C2-RPF-D02 (re-open in the cycle after Plan 260
 * lands) is met. Removed.
 */

/**
 * Cycle 2 RPF / P260-07 / C2-RPF-13: known Stripe refund error codes
 * mapped to short, stable identifiers. The full Stripe error is logged
 * server-side; only the mapped identifier crosses the action boundary
 * to the client, which then renders a localized message via i18n. This
 * stops Stripe-internal request ids from leaking into UI toasts and
 * makes refund errors localizable.
 *
 * Cycle 5 RPF / P388-03 / C5-RPF-03: split `'auth-error'` from
 * `'network'`. `StripeAuthenticationError` (rotated/revoked API key)
 * requires ops to rotate STRIPE_SECRET_KEY; surfacing it as `'network'`
 * (the previous behavior) caused operators to retry forever instead of
 * fixing the key. `StripeRateLimitError` and `StripeConnectionError`
 * remain `'network'` since both are transient by definition.
 *
 * Stripe error type → RefundErrorCode mapping:
 *   - StripeAuthenticationError       → 'auth-error'  (key rotated)
 *   - StripeConnectionError           → 'network'     (transient)
 *   - StripeAPIError                  → 'network'     (transient)
 *   - StripeRateLimitError            → 'network'     (transient)
 *   - charge_already_refunded (code)  → 'already-refunded'
 *   - resource_missing (code)         → 'charge-unknown'
 *   - AbortError / ETIMEDOUT / ECONNREFUSED (non-Error throws) → 'network'
 *   - everything else                 → 'unknown'
 */
export type RefundErrorCode =
    | 'already-refunded'
    | 'charge-unknown'
    | 'network'
    | 'auth-error'
    | 'not-found'
    | 'invalid-id'
    | 'no-payment-intent'
    | 'unknown';

function mapStripeRefundError(err: unknown): RefundErrorCode {
    // Cycle 5 RPF / P388-05 / C5-RPF-05: handle non-Error throws BEFORE the
    // instanceof check. AbortController-issued AbortError is a DOMException
    // in Node.js, NOT an Error, so the previous instanceof check returned
    // 'unknown' and the user saw the generic fallback toast on a hung
    // network request. Common Node.js fs/network error codes (ETIMEDOUT,
    // ECONNREFUSED) also propagate without subclassing Error in some paths.
    const maybeNonError = err as { name?: string; code?: string } | null;
    if (maybeNonError?.name === 'AbortError') return 'network';
    if (maybeNonError?.code === 'ETIMEDOUT' || maybeNonError?.code === 'ECONNREFUSED') return 'network';
    if (!(err instanceof Error)) return 'unknown';
    // Stripe SDK errors carry a `code` and `type` on the error object.
    const e = err as Error & { code?: string; type?: string };
    if (e.code === 'charge_already_refunded') return 'already-refunded';
    if (e.code === 'resource_missing') return 'charge-unknown';
    // Cycle 5 RPF / P388-03 / C5-RPF-03: split auth-error from network.
    if (e.type === 'StripeAuthenticationError') return 'auth-error';
    if (e.type === 'StripeConnectionError' || e.type === 'StripeAPIError') return 'network';
    // Cycle 4 RPF / P264-07 / C4-RPF-07: StripeRateLimitError is transient
    // (rate-limited by Stripe, retry-after is the fix). Keep it on the
    // 'network' code path. Cycle 5 split 'StripeAuthenticationError' into
    // its own 'auth-error' bucket above.
    if (e.type === 'StripeRateLimitError') return 'network';
    // Cycle 6 RPF / P390-04 / C6-RPF-04: proactive ops signal when Stripe
    // ships a new error type that the mapping table does not yet cover.
    // Silent 'unknown' returns previously caused operators to learn about
    // emerging Stripe error types only via customer complaint. The warn
    // line surfaces the new type/code/name so the mapping table can be
    // updated proactively. Skipped under NODE_ENV=test to keep unit-test
    // output clean.
    if (process.env.NODE_ENV !== 'test') {
        console.warn('Stripe refund: unrecognized error type', {
            name: maybeNonError?.name,
            type: e.type,
            code: e.code,
        });
    }
    return 'unknown';
}

export async function refundEntitlement(entitlementId: number): Promise<{ error?: string; errorCode?: RefundErrorCode; success?: true }> {
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError, errorCode: 'unknown' };
    if (!(await isAdmin())) return { error: 'Not authorized', errorCode: 'unknown' };

    if (!Number.isFinite(entitlementId) || entitlementId <= 0) {
        return { error: 'Invalid entitlement ID', errorCode: 'invalid-id' };
    }

    const [row] = await db
        .select({
            id: entitlements.id,
            sessionId: entitlements.sessionId,
            refunded: entitlements.refunded,
        })
        .from(entitlements)
        .where(eq(entitlements.id, entitlementId))
        .limit(1);

    if (!row) return { error: 'Entitlement not found', errorCode: 'not-found' };
    if (row.refunded) return { error: 'Already refunded', errorCode: 'already-refunded' };

    try {
        const stripe = getStripe();
        // Retrieve the payment intent from the checkout session
        const session = await stripe.checkout.sessions.retrieve(row.sessionId);
        const paymentIntent = session.payment_intent;
        if (!paymentIntent) {
            return { error: 'No payment intent found for this session', errorCode: 'no-payment-intent' };
        }
        const piId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id;
        // Cycle 5 RPF / P388-01 / C5-RPF-01: pass an Idempotency-Key on the
        // refund POST. Stripe deduplicates server-side when the same key is
        // used, so a retry (transient network error or browser double-click)
        // returns the same refund.id rather than creating a second refund
        // attempt — which Stripe would auto-reject with
        // `charge_already_refunded`, mapping to a confusing
        // "already-refunded" toast on a successful refund. The deterministic
        // `refund-${entitlementId}` key allows safe retries because each
        // entitlement has at most one refund.
        await stripe.refunds.create(
            { payment_intent: piId },
            { idempotencyKey: `refund-${entitlementId}` },
        );

        // Mark entitlement as refunded (blocks future downloads)
        await db
            .update(entitlements)
            .set({ refunded: true, downloadTokenHash: null })
            .where(eq(entitlements.id, entitlementId));

        return { success: true };
    } catch (err) {
        console.error('Stripe refund failed:', err);
        // Cycle 6 RPF / P390-03 / C6-RPF-03: do NOT cross the action boundary
        // with `err.message`. The Stripe SDK includes request IDs (req_xxx)
        // and other internal diagnostics in `err.message` that the doc block
        // (above mapStripeRefundError) explicitly says should not leak to
        // the client. The client-visible signal is `errorCode`, which is
        // mapped to a localized i18n string by `mapErrorCode` in
        // sales-client.tsx. The `error` field is a stable client-safe
        // fallback for the rare case where a UI surface reads it directly.
        return {
            error: 'Refund failed',
            errorCode: mapStripeRefundError(err),
        };
    }
}
