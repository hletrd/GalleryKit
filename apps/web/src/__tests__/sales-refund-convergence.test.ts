/**
 * R4C4 COR-R4C4-02 / TEST-R4C4-11: behavioral lock for refundEntitlement's
 * `charge_already_refunded` convergence.
 *
 * Stripe is the source of truth: when it reports the charge is ALREADY
 * refunded (prior attempt whose DB update never landed, expired
 * idempotency-key window, or a dashboard-side refund), the action must
 * converge local state (`refunded: true`, `downloadTokenHash: null`) and
 * report success — NOT loop forever on an "already refunded" error while
 * the customer's download token stays live for a refunded purchase.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface UpdateCall {
    set: Record<string, unknown>;
}

const state: {
    row: { id: number; sessionId: string; refunded: boolean } | undefined;
    updateCalls: UpdateCall[];
    updateShouldThrow: boolean;
    refundsCreate: ReturnType<typeof vi.fn>;
} = {
    row: { id: 42, sessionId: 'cs_test_123', refunded: false },
    updateCalls: [],
    updateShouldThrow: false,
    refundsCreate: vi.fn(),
};

vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: vi.fn(async () => null),
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: vi.fn(async () => true),
}));

vi.mock('@/db', () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => (state.row ? [state.row] : []),
                }),
            }),
        }),
        update: () => ({
            set: (vals: Record<string, unknown>) => ({
                where: async () => {
                    if (state.updateShouldThrow) throw new Error('db down');
                    state.updateCalls.push({ set: vals });
                    return [{ affectedRows: 1 }];
                },
            }),
        }),
    },
}));

vi.mock('@/lib/stripe', () => ({
    getStripe: () => ({
        checkout: {
            sessions: {
                retrieve: vi.fn(async () => ({ payment_intent: 'pi_test_1' })),
            },
        },
        refunds: {
            create: (...args: unknown[]) => state.refundsCreate(...args),
        },
    }),
}));

import { refundEntitlement } from '@/app/actions/sales';

function stripeError(code: string): Error & { code: string } {
    const err = new Error(`stripe: ${code}`) as Error & { code: string };
    err.code = code;
    return err;
}

describe('refundEntitlement charge_already_refunded convergence (R4C4 COR-R4C4-02)', () => {
    beforeEach(() => {
        state.row = { id: 42, sessionId: 'cs_test_123', refunded: false };
        state.updateCalls = [];
        state.updateShouldThrow = false;
        state.refundsCreate = vi.fn(async () => ({ id: 're_test_1' }));
    });

    it('happy path: refund succeeds and the UPDATE clears the hash', async () => {
        const result = await refundEntitlement(42);
        expect(result).toEqual({ success: true });
        expect(state.updateCalls).toHaveLength(1);
        expect(state.updateCalls[0].set).toEqual({ refunded: true, downloadTokenHash: null });
    });

    it('charge_already_refunded: converges local state and reports success', async () => {
        state.refundsCreate = vi.fn(async () => { throw stripeError('charge_already_refunded'); });
        const result = await refundEntitlement(42);
        expect(result).toEqual({ success: true });
        // The convergence UPDATE must be the SAME shape as the happy path:
        // refunded flipped AND the download token hash invalidated.
        expect(state.updateCalls).toHaveLength(1);
        expect(state.updateCalls[0].set).toEqual({ refunded: true, downloadTokenHash: null });
    });

    it('charge_already_refunded + convergence UPDATE failure: original error preserved', async () => {
        state.refundsCreate = vi.fn(async () => { throw stripeError('charge_already_refunded'); });
        state.updateShouldThrow = true;
        const result = await refundEntitlement(42);
        expect(result).toEqual({ error: 'Refund failed', errorCode: 'already-refunded' });
    });

    it('other Stripe errors do NOT trigger the convergence UPDATE', async () => {
        state.refundsCreate = vi.fn(async () => { throw stripeError('resource_missing'); });
        const result = await refundEntitlement(42);
        expect(result).toEqual({ error: 'Refund failed', errorCode: 'charge-unknown' });
        expect(state.updateCalls).toHaveLength(0);
    });
});
