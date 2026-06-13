/**
 * AGG-R5C3-05: resolveBackfillConcurrency pool-budget cap.
 *
 * The backfill runner clamps ADMIN_BACKFILL_CONCURRENCY against the shared DB
 * pool so a background re-encode cannot pin every connection and 500 live
 * traffic. The cap is floor((POOL_LIMIT - 2) / 2): the whole-run advisory lock
 * pins 1 connection and each worker can hold up to 2 (per-image claim +
 * transient db.execute).
 *
 * This test imports ONLY the pure helper; the runner module pulls in heavy deps
 * (sharp, process-image) at load, so we mock just enough for the import to
 * resolve without side effects.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/db', () => ({
    connection: { getConnection: vi.fn() },
    db: { execute: vi.fn() },
    POOL_CONNECTION_LIMIT: 10,
}));
vi.mock('sharp', () => {
    const sharpFn = vi.fn() as unknown as {
        (...a: unknown[]): unknown;
        concurrency: ReturnType<typeof vi.fn>;
        cache: ReturnType<typeof vi.fn>;
        versions: { heif?: string };
    };
    sharpFn.concurrency = vi.fn();
    sharpFn.cache = vi.fn();
    sharpFn.versions = { heif: '1.0.0' };
    return { default: sharpFn };
});

import { resolveBackfillConcurrency } from '@/lib/admin-backfill-runner';

describe('resolveBackfillConcurrency — pool-budget cap', () => {
    it('clamps requests above the cap down to floor((poolLimit - 2) / 2)', () => {
        // poolLimit 10 → cap 4.
        expect(resolveBackfillConcurrency(8, 10)).toBe(4);
        expect(resolveBackfillConcurrency(4, 10)).toBe(4);
        expect(resolveBackfillConcurrency(100, 10)).toBe(4);
    });

    it('passes through requests at or below the cap', () => {
        expect(resolveBackfillConcurrency(1, 10)).toBe(1);
        expect(resolveBackfillConcurrency(2, 10)).toBe(2);
        expect(resolveBackfillConcurrency(3, 10)).toBe(3);
    });

    it('never returns less than 1, even for 0 / negative / NaN requests', () => {
        expect(resolveBackfillConcurrency(0, 10)).toBe(1);
        expect(resolveBackfillConcurrency(-5, 10)).toBe(1);
        expect(resolveBackfillConcurrency(Number.NaN, 10)).toBe(1);
    });

    it('floors fractional requests before clamping', () => {
        expect(resolveBackfillConcurrency(2.9, 10)).toBe(2);
        expect(resolveBackfillConcurrency(4.9, 10)).toBe(4);
    });

    it('caps at 1 for a tiny pool where the arithmetic would go non-positive', () => {
        // poolLimit 3 → floor(1/2)=0 → max(1, 0)=1.
        expect(resolveBackfillConcurrency(8, 3)).toBe(1);
        // poolLimit 4 → floor(2/2)=1.
        expect(resolveBackfillConcurrency(8, 4)).toBe(1);
    });

    it('uses the default pool limit (10) when none is passed → cap 4', () => {
        expect(resolveBackfillConcurrency(8)).toBe(4);
    });
});
