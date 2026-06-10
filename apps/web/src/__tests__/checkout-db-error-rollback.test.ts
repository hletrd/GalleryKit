/**
 * R4C6 COR-R4C6-08: a transient DB error during the checkout route's
 * image/price lookup must follow the route's Pattern-2 contract — roll
 * back the pre-incremented per-IP budget and answer JSON 500 with
 * NO_STORE — instead of escaping as a framework 500 that permanently
 * consumed the visitor's rate budget.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { selectMock, preIncrementMock, rollbackMock } = vi.hoisted(() => ({
    selectMock: vi.fn(),
    preIncrementMock: vi.fn(),
    rollbackMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: { select: selectMock },
}));
vi.mock('@/db/schema', () => ({
    images: { id: 'images.id', title: 'images.title', license_tier: 'images.license_tier', processed: 'images.processed' },
    adminSettings: { key: 'admin_settings.key', value: 'admin_settings.value' },
}));
vi.mock('@/lib/stripe', () => ({
    getStripe: () => ({ checkout: { sessions: { create: vi.fn() } } }),
}));
vi.mock('@/lib/rate-limit', () => ({
    preIncrementCheckoutAttempt: (...args: unknown[]) => preIncrementMock(...args),
    rollbackCheckoutAttempt: (...args: unknown[]) => rollbackMock(...args),
    getClientIp: () => '203.0.113.7',
    CHECKOUT_WINDOW_MS: 60_000,
}));

import { POST } from '@/app/api/checkout/[imageId]/route';

function makeRequest(): NextRequest {
    return new NextRequest('https://gallery.example/api/checkout/42', { method: 'POST' });
}

beforeEach(() => {
    selectMock.mockReset();
    preIncrementMock.mockReset().mockReturnValue(false);
    rollbackMock.mockReset();
});

describe('checkout route DB-error rollback (COR-R4C6-08)', () => {
    it('rolls back the rate charge and answers JSON 500 + no-store when the image lookup throws', async () => {
        selectMock.mockImplementation(() => {
            throw new Error('connection lost');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(500);
        expect(res.headers.get('Cache-Control')).toContain('no-store');
        const body = await res.json();
        expect(body.error).toBe('Failed to create checkout session');
        expect(rollbackMock).toHaveBeenCalledWith('203.0.113.7');
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('still rolls back + 404s for a missing image (early-return path unchanged)', async () => {
        selectMock.mockReturnValue({
            from: () => ({ where: () => ({ limit: async () => [] }) }),
        });

        const res = await POST(makeRequest(), { params: Promise.resolve({ imageId: '42' }) });

        expect(res.status).toBe(404);
        expect(rollbackMock).toHaveBeenCalledWith('203.0.113.7');
    });
});
