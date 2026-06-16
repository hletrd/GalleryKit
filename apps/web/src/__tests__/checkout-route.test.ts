/**
 * TEST-R5C1-06: Checkout route branch tests.
 * Follows the mocked Stripe + DB pattern of checkout-db-error-rollback.test.ts.
 * Covers: strict price parse, priceCents <= 0, unprocessed image, happy path
 * with idempotency key shape, rollback on each 4xx branch, unknown image 404,
 * and unknown-IP idempotency omission (TRC-R5C1-16 / AGG-R5C2-53).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { selectMock, preIncrementMock, rollbackMock, stripeCreateMock, getClientIpMock } = vi.hoisted(() => ({
    selectMock: vi.fn(),
    preIncrementMock: vi.fn(),
    rollbackMock: vi.fn(),
    stripeCreateMock: vi.fn(),
    getClientIpMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: { select: selectMock },
}));

vi.mock('@/db/schema', () => ({
    images: {
        id: 'images.id',
        title: 'images.title',
        license_tier: 'images.license_tier',
        processed: 'images.processed',
    },
    adminSettings: {
        key: 'admin_settings.key',
        value: 'admin_settings.value',
    },
}));

vi.mock('@/lib/stripe', () => ({
    getStripe: () => ({
        checkout: {
            sessions: { create: stripeCreateMock },
        },
    }),
}));

vi.mock('@/lib/rate-limit', () => ({
    preIncrementCheckoutAttempt: (...args: unknown[]) => preIncrementMock(...args),
    rollbackCheckoutAttempt: (...args: unknown[]) => rollbackMock(...args),
    getClientIp: (...args: unknown[]) => getClientIpMock(...args),
    CHECKOUT_WINDOW_MS: 60_000,
}));

// GALLERY_SETTING_KEYS needs to include the price keys
vi.mock('@/lib/gallery-config-shared', () => ({
    GALLERY_SETTING_KEYS: [
        'license_price_editorial_cents',
        'license_price_commercial_cents',
        'license_price_rm_cents',
    ],
}));

vi.mock('@/lib/license-tiers', () => ({
    isPaidLicenseTier: (v: unknown) => typeof v === 'string' && ['editorial', 'commercial', 'rm'].includes(v),
    PAID_TIER_PRICE_KEYS: {
        editorial: 'license_price_editorial_cents',
        commercial: 'license_price_commercial_cents',
        rm: 'license_price_rm_cents',
    },
    deriveLocaleFromReferer: () => 'en',
}));

import { POST } from '@/app/api/checkout/[imageId]/route';

function makeRequest(imageId = '42'): NextRequest {
    return new NextRequest(`https://gallery.example/api/checkout/${imageId}`, { method: 'POST' });
}

/**
 * AGG-R5C2-53: table-keyed dispatch replaces the order-dependent call-counter
 * approach. Each call is matched by inspecting the `from` argument's table
 * identifier so a query-order refactor cannot silently feed wrong rows.
 *
 * The drizzle mock receives the schema table object as the argument to `.from()`.
 * We distinguish image queries from adminSettings queries by checking which
 * sentinel property values are present on the mock schema object:
 *   - images table has `processed: 'images.processed'` (unique to images)
 *   - adminSettings table has `value: 'admin_settings.value'` (unique to settings)
 */
function buildSelectChain(
    imageRow: Record<string, unknown> | null,
    settingsRow: { value: string } | null = { value: '500' }
) {
    selectMock.mockImplementation(() => ({
        from: (table: Record<string, unknown>) => ({
            where: () => ({
                limit: async () => {
                    // Dispatch by which schema object was passed to .from().
                    // images has 'processed' key; adminSettings does not.
                    const isImagesQuery = 'processed' in table;
                    if (isImagesQuery) {
                        return imageRow ? [imageRow] : [];
                    }
                    // adminSettings query
                    return settingsRow ? [settingsRow] : [];
                },
            }),
        }),
    }));
}

const validProcessedImage = {
    id: 42,
    title: 'Test Photo',
    license_tier: 'editorial',
    processed: true,
};

beforeEach(() => {
    selectMock.mockReset();
    preIncrementMock.mockReset().mockReturnValue(false);
    rollbackMock.mockReset();
    stripeCreateMock.mockReset();
    // Default: known IP
    getClientIpMock.mockReturnValue('203.0.113.9');
});

describe('checkout route branch tests (TEST-R5C1-06)', () => {

    // ── (1) Strict price parse: "500abc" rejected ─────────────────────────────

    it('(1) getTierPriceCents strict parse — "500abc" returns 0 → 4xx, NOT a $5.00 charge', async () => {
        buildSelectChain(validProcessedImage, { value: '500abc' });

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/not priced for sale/i);
        // Stripe must never be called — no charge created
        expect(stripeCreateMock).not.toHaveBeenCalled();
        // Rate limit rolled back on 4xx
        expect(rollbackMock).toHaveBeenCalledWith('203.0.113.9');
    });

    // ── (2) priceCents <= 0 → 4xx ────────────────────────────────────────────

    it('(2) priceCents = 0 → 400 not priced for sale', async () => {
        buildSelectChain(validProcessedImage, { value: '0' });

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/not priced for sale/i);
        expect(stripeCreateMock).not.toHaveBeenCalled();
        expect(rollbackMock).toHaveBeenCalledWith('203.0.113.9');
    });

    it('(2b) missing price setting (no row) → priceCents = 0 → 400', async () => {
        buildSelectChain(validProcessedImage, null);

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(400);
        expect(stripeCreateMock).not.toHaveBeenCalled();
        expect(rollbackMock).toHaveBeenCalledWith('203.0.113.9');
    });

    // ── (3) !image.processed → 4xx ───────────────────────────────────────────

    it('(3) unprocessed image → 400', async () => {
        buildSelectChain({ ...validProcessedImage, processed: false }, { value: '500' });

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/processing/i);
        expect(stripeCreateMock).not.toHaveBeenCalled();
        expect(rollbackMock).toHaveBeenCalledWith('203.0.113.9');
    });

    // ── (4) Happy path: { url } returned, idempotency key shape ───────────────

    it('(4) happy path → { url } returned, Stripe called with idempotency key', async () => {
        buildSelectChain(validProcessedImage, { value: '999' });
        stripeCreateMock.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_abc123' });

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test_abc123');

        // Stripe was called
        expect(stripeCreateMock).toHaveBeenCalledOnce();

        // Known IP → deterministic idempotency key: checkout-{imageId}-{ip}-{minute}
        const callArgs = stripeCreateMock.mock.calls[0];
        const idempotencyOptions = callArgs[1] as { idempotencyKey: string };
        expect(idempotencyOptions.idempotencyKey).toMatch(
            /^checkout-42-203\.0\.113\.9-\d+$/
        );

        // AGG-H1 / CRT-R5C1-04: the session MUST be pinned to card-only
        // (immediate-capture) until the webhook handles
        // async_payment_succeeded. If a future change drops this pin, async
        // payment methods (SEPA/ACH/etc.) become initiatable and a buyer could
        // be charged with no entitlement (money-taken-no-goods). This assertion
        // fails loud if the card-only guard is removed.
        const sessionPayload = callArgs[0] as { payment_method_types?: string[] };
        expect(sessionPayload.payment_method_types).toEqual(['card']);

        // No rollback on success
        expect(rollbackMock).not.toHaveBeenCalled();
    });

    it('(4b) idempotency key contains the current minute (not random)', async () => {
        buildSelectChain(validProcessedImage, { value: '999' });
        const expectedMinute = Math.floor(Date.now() / 60_000);
        stripeCreateMock.mockResolvedValue({ url: 'https://checkout.stripe.com/sess' });

        await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        const callArgs = stripeCreateMock.mock.calls[0];
        const { idempotencyKey } = callArgs[1] as { idempotencyKey: string };
        // The minute component is the last segment
        const parts = idempotencyKey.split('-');
        const minute = parseInt(parts[parts.length - 1], 10);
        // Allow ±1 minute for timing skew around the minute boundary
        expect(Math.abs(minute - expectedMinute)).toBeLessThanOrEqual(1);
    });

    // ── (4c) Unknown IP → no idempotency key (TRC-R5C1-16) ───────────────────
    //
    // When TRUST_PROXY is not configured, getClientIp() returns 'unknown'.
    // Two distinct buyers of the same image in the same minute must each
    // receive a fresh Stripe session — the route omits idempotencyKey so
    // Stripe does not deduplicate across unrelated callers.

    it('(4c) unknown IP → two POSTs each create a session with NO idempotencyKey', async () => {
        getClientIpMock.mockReturnValue('unknown');
        stripeCreateMock.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_unknownip' });

        // First request
        buildSelectChain(validProcessedImage, { value: '999' });
        const res1 = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });
        expect(res1.status).toBe(200);

        // Second request (same image, same minute, different buyer)
        buildSelectChain(validProcessedImage, { value: '999' });
        const res2 = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });
        expect(res2.status).toBe(200);

        expect(stripeCreateMock).toHaveBeenCalledTimes(2);

        // Neither call may carry an idempotencyKey — omitting it entirely
        // means Stripe treats each as a distinct request (TRC-R5C1-16 fix).
        for (const call of stripeCreateMock.mock.calls) {
            const options = call[1] as Record<string, unknown>;
            expect(options).not.toHaveProperty('idempotencyKey');
        }
    });

    // ── (5) Rollback called on each 4xx branch ────────────────────────────────

    it('(5a) not-for-sale tier → 400 + rollback', async () => {
        buildSelectChain({ ...validProcessedImage, license_tier: 'none' }, { value: '500' });

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(400);
        expect(rollbackMock).toHaveBeenCalledWith('203.0.113.9');
    });

    it('(5b) rate limit exceeded → 429, rollback NOT called (limit was already charged)', async () => {
        preIncrementMock.mockReturnValue(true); // limit exceeded

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(429);
        // When preIncrement returns true (already at limit), the route returns 429
        // without calling rollback — the charge was the rejection itself
        expect(rollbackMock).not.toHaveBeenCalled();
    });

    it('(5c) invalid image ID → 400 + rollback', async () => {
        const res = await POST(
            new NextRequest('https://gallery.example/api/checkout/abc', { method: 'POST' }),
            { params: Promise.resolve({ imageId: 'abc' }) }
        );

        expect(res.status).toBe(400);
        expect(rollbackMock).toHaveBeenCalledWith('203.0.113.9');
    });

    // ── (6) Unknown image → 404 ───────────────────────────────────────────────

    it('(6) unknown image → 404 + rollback', async () => {
        buildSelectChain(null); // no image row

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toMatch(/not found/i);
        expect(rollbackMock).toHaveBeenCalledWith('203.0.113.9');
        expect(stripeCreateMock).not.toHaveBeenCalled();
    });
});
