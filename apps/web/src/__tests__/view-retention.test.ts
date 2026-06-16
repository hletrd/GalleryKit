/**
 * AGG-H2 (run-6 cycle-2): purgeOldViewEvents retention sweep for the anonymous
 * analytics view tables (image_views / topic_views / shared_group_views).
 *
 * Mirrors audit-retention.test.ts. Critically locks the R4C6 COR-R4C6-10
 * safety guard: a negative / non-finite retention must NOT put the cutoff in
 * the future (which would DELETE every row), and the DELETE must be chunked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { deleteMock, whereMock, limitMock, ltMock, affectedRowsRef } = vi.hoisted(() => {
    const affectedRowsRef = { value: 0 };
    // delete(table) -> { where } -> { limit } -> Promise<{ affectedRows }>
    const limitMock = vi.fn(async () => ({ affectedRows: affectedRowsRef.value }));
    const whereMock = vi.fn(() => ({ limit: limitMock }));
    const deleteMock = vi.fn(() => ({ where: whereMock }));
    const ltMock = vi.fn((col: unknown, cutoff: Date) => ({ col, cutoff }));
    return { deleteMock, whereMock, limitMock, ltMock, affectedRowsRef };
});

vi.mock('@/db', () => ({
    db: { delete: deleteMock },
}));
vi.mock('@/db/schema', () => ({
    imageViews: { viewed_at: 'image_views.viewed_at' },
    topicViews: { viewed_at: 'topic_views.viewed_at' },
    sharedGroupViews: { viewed_at: 'shared_group_views.viewed_at' },
}));
vi.mock('drizzle-orm', () => ({
    lt: ltMock,
}));

import { purgeOldViewEvents } from '@/lib/view-retention';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 395;

function cutoffsForThisSweep(): Date[] {
    return ltMock.mock.calls.map((c) => c[1] as Date);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T00:00:00Z'));
    deleteMock.mockClear();
    whereMock.mockClear();
    limitMock.mockClear();
    ltMock.mockClear();
    affectedRowsRef.value = 0; // each batch deletes 0 → one batch per table
    delete process.env.VIEW_RETENTION_DAYS;
});

afterEach(() => {
    vi.useRealTimers();
    delete process.env.VIEW_RETENTION_DAYS;
});

describe('purgeOldViewEvents retention sweep (AGG-H2)', () => {
    it('defaults to a 395-day (13-month) cutoff in the PAST', async () => {
        await purgeOldViewEvents();
        const cutoffs = cutoffsForThisSweep();
        // One cutoff per table (3 tables), all equal to now - 395d.
        expect(cutoffs).toHaveLength(3);
        for (const cutoff of cutoffs) {
            expect(cutoff.getTime()).toBe(Date.now() - DEFAULT_DAYS * DAY_MS);
            expect(cutoff.getTime()).toBeLessThan(Date.now());
        }
    });

    it('honors a positive VIEW_RETENTION_DAYS env override', async () => {
        process.env.VIEW_RETENTION_DAYS = '30';
        await purgeOldViewEvents();
        const cutoff = cutoffsForThisSweep()[0];
        expect(cutoff.getTime()).toBe(Date.now() - 30 * DAY_MS);
    });

    it('NEGATIVE env value falls back to the default — cutoff stays in the PAST (COR-R4C6-10)', async () => {
        process.env.VIEW_RETENTION_DAYS = '-1';
        await purgeOldViewEvents();
        const cutoff = cutoffsForThisSweep()[0];
        // Must NOT be in the future (which would wipe every row).
        expect(cutoff.getTime()).toBe(Date.now() - DEFAULT_DAYS * DAY_MS);
        expect(cutoff.getTime()).toBeLessThan(Date.now());
    });

    it('non-finite env value falls back to the default', async () => {
        process.env.VIEW_RETENTION_DAYS = 'not-a-number';
        await purgeOldViewEvents();
        const cutoff = cutoffsForThisSweep()[0];
        expect(cutoff.getTime()).toBe(Date.now() - DEFAULT_DAYS * DAY_MS);
    });

    it('issues a bounded (LIMIT-ed) DELETE per table', async () => {
        await purgeOldViewEvents();
        // 3 tables, each one batch (affectedRows 0 < cap stops the loop).
        expect(deleteMock).toHaveBeenCalledTimes(3);
        // The DELETE goes through the where→limit chain (bounded), not a bare
        // unbounded delete, on every table.
        expect(whereMock).toHaveBeenCalledTimes(3);
        expect(limitMock).toHaveBeenCalledTimes(3);
    });

    it('keeps deleting in chunks until a batch is under the cap, then returns the total', async () => {
        // First call to limit() returns a full batch (5000), subsequent calls
        // return a partial batch (drains). Simulate per-table: full then 0.
        let n = 0;
        limitMock.mockImplementation(async () => {
            n += 1;
            // For each table: 1st batch full (5000), 2nd batch 10 (< cap → stop).
            return { affectedRows: n % 2 === 1 ? 5000 : 10 };
        });
        const total = await purgeOldViewEvents();
        // 3 tables × (5000 + 10) = 15030.
        expect(total).toBe((5000 + 10) * 3);
    });
});
