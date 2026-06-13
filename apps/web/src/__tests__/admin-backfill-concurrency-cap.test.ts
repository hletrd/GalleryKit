/**
 * AGG-R5C3-05 + AGG-5 (run-6 c1): resolveBackfillConcurrency pool-budget cap.
 *
 * The backfill runner clamps ADMIN_BACKFILL_CONCURRENCY against the shared DB
 * pool so a background re-encode cannot pin every connection and 500 live
 * traffic. AGG-5 corrected the margin: reserve ≈ half the pool (≥ one full live
 * getImage fan-out, which is a ~3-way Promise.all) for live traffic, then the
 * cap is floor((POOL_LIMIT − RESERVED − 1) / 2) where RESERVED = max(3,
 * ceil(POOL_LIMIT / 2)). The whole-run advisory lock pins 1 connection and each
 * worker can hold up to 2 (per-image claim + transient db.execute). At
 * POOL_LIMIT = 10 this yields cap = floor((10 − 5 − 1) / 2) = 2 (down from the
 * pre-AGG-5 value of 4, which left only 1 connection free and starved live
 * photo-page renders).
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

describe('resolveBackfillConcurrency — pool-budget cap (AGG-5 reserved-headroom formula)', () => {
    it('clamps requests above the cap down to floor((poolLimit - reserved - 1) / 2)', () => {
        // poolLimit 10 → reserved 5 → cap floor((10-5-1)/2)=2.
        expect(resolveBackfillConcurrency(8, 10)).toBe(2);
        expect(resolveBackfillConcurrency(2, 10)).toBe(2);
        expect(resolveBackfillConcurrency(100, 10)).toBe(2);
    });

    it('passes through requests at or below the cap', () => {
        expect(resolveBackfillConcurrency(1, 10)).toBe(1);
        expect(resolveBackfillConcurrency(2, 10)).toBe(2);
    });

    it('never returns less than 1, even for 0 / negative / NaN requests', () => {
        expect(resolveBackfillConcurrency(0, 10)).toBe(1);
        expect(resolveBackfillConcurrency(-5, 10)).toBe(1);
        expect(resolveBackfillConcurrency(Number.NaN, 10)).toBe(1);
    });

    it('floors fractional requests before clamping', () => {
        expect(resolveBackfillConcurrency(1.9, 10)).toBe(1);
        expect(resolveBackfillConcurrency(2.9, 10)).toBe(2);
    });

    it('reserves at least one full live getImage fan-out — never pins the whole pool', () => {
        // At the cap, worst-case held = 1 (lock) + 2*cap. The pool must keep
        // ≥ reserved free for live traffic. poolLimit 10, cap 2 → held ≤ 5,
        // free ≥ 5 (= reserved). This is the core AGG-5 invariant.
        const limit = 10;
        const cap = resolveBackfillConcurrency(1000, limit);
        const reserved = Math.max(3, Math.ceil(limit / 2));
        const worstCaseHeld = 1 + 2 * cap;
        expect(limit - worstCaseHeld).toBeGreaterThanOrEqual(reserved);
    });

    it('caps at 1 for a small pool where the arithmetic would go non-positive', () => {
        // poolLimit 3 → reserved max(3,2)=3 → floor((3-3-1)/2)=floor(-0.5)=-1 → max(1,-1)=1.
        expect(resolveBackfillConcurrency(8, 3)).toBe(1);
        // poolLimit 4 → reserved 3 → floor((4-3-1)/2)=0 → max(1,0)=1.
        expect(resolveBackfillConcurrency(8, 4)).toBe(1);
        // poolLimit 6 → reserved 3 → floor((6-3-1)/2)=1.
        expect(resolveBackfillConcurrency(8, 6)).toBe(1);
    });

    it('scales the cap up on a larger pool while still reserving half', () => {
        // poolLimit 20 → reserved 10 → floor((20-10-1)/2)=floor(4.5)=4.
        expect(resolveBackfillConcurrency(100, 20)).toBe(4);
    });

    it('uses the default pool limit (10) when none is passed → cap 2', () => {
        expect(resolveBackfillConcurrency(8)).toBe(2);
    });
});
