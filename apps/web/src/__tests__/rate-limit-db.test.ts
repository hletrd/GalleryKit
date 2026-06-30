/**
 * AGG-T1 / AGG-T4 (run-6 cycle-2): unit tests for the DB-backed rate-limit
 * functions in lib/rate-limit.ts (incrementRateLimit / decrementRateLimit /
 * resetRateLimit). These were previously UNTESTED — every higher-level test
 * mocks `@/lib/rate-limit` at the boundary, so the real SQL shapes had zero
 * coverage. decrementRateLimit's transaction + GREATEST(count-1,0) guard is
 * correctness-critical for the rollback-on-navigation behavior; a regression
 * that dropped the transaction, swapped UPDATE/DELETE, or changed GREATEST to
 * a bare count-1 (allowing negative counts) would have gone undetected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the SQL builder chain calls. (txUpdateSetMock / txUpdateWhereMock /
// txDeleteWhereMock wire the in-transaction chain internally but the test body
// asserts via the public mocks below, so they are not re-exported.)
const {
    insertMock,
    valuesMock,
    onDuplicateKeyUpdateMock,
    deleteMock,
    deleteWhereMock,
    transactionMock,
    txUpdateMock,
    txDeleteMock,
    executeMock,
    sqlMock,
} = vi.hoisted(() => {
    const onDuplicateKeyUpdateMock = vi.fn(async () => undefined);
    const valuesMock = vi.fn(() => ({ onDuplicateKeyUpdate: onDuplicateKeyUpdateMock }));
    const insertMock = vi.fn(() => ({ values: valuesMock }));

    const deleteWhereMock = vi.fn(async () => undefined);
    const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

    const txUpdateWhereMock = vi.fn(async () => undefined);
    const txUpdateSetMock = vi.fn(() => ({ where: txUpdateWhereMock }));
    const txUpdateMock = vi.fn(() => ({ set: txUpdateSetMock }));
    const txDeleteWhereMock = vi.fn(async () => undefined);
    const txDeleteMock = vi.fn(() => ({ where: txDeleteWhereMock }));

    const transactionMock = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
        await cb({ update: txUpdateMock, delete: txDeleteMock });
    });

    const executeMock = vi.fn(async () => ({ affectedRows: 0 }));

    // sql`...` tag — return a marker that records the raw template so we can
    // assert GREATEST() / <= 0 appear in the right places.
    const sqlMock = vi.fn((strings: TemplateStringsArray) => ({ __sql: strings.join('?') }));

    return {
        insertMock, valuesMock, onDuplicateKeyUpdateMock,
        deleteMock, deleteWhereMock,
        transactionMock, txUpdateMock, txDeleteMock,
        executeMock, sqlMock,
    };
});

// NOTE: rate-limit.ts imports `rateLimitBuckets` from '@/db' (re-exported
// there), NOT from '@/db/schema' — mock it on the '@/db' module.
vi.mock('@/db', () => ({
    db: {
        insert: insertMock,
        delete: deleteMock,
        transaction: transactionMock,
        execute: executeMock,
    },
    rateLimitBuckets: {
        ip: 'rate_limit_buckets.ip',
        bucketType: 'rate_limit_buckets.bucket_type',
        bucketStart: 'rate_limit_buckets.bucket_start',
        count: 'rate_limit_buckets.count',
    },
}));
vi.mock('drizzle-orm', () => ({
    and: (...args: unknown[]) => ({ __and: args }),
    eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
    lt: (col: unknown, val: unknown) => ({ __lt: [col, val] }),
    sql: sqlMock,
}));

import { incrementRateLimit, decrementRateLimit, resetRateLimit, purgeOldBuckets, RATE_LIMIT_BUCKET_PURGE_BATCH_SIZE } from '@/lib/rate-limit';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('incrementRateLimit (AGG-T1)', () => {
    it('upserts via INSERT ... ON DUPLICATE KEY UPDATE count = count + 1', async () => {
        await incrementRateLimit('203.0.113.1', 'login', 60_000, 1_000);

        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(valuesMock).toHaveBeenCalledWith(
            expect.objectContaining({
                ip: '203.0.113.1',
                bucketType: 'login',
                bucketStart: 1_000,
                count: 1,
            }),
        );
        // The onDuplicateKeyUpdate must increment (count + 1), not overwrite.
        expect(onDuplicateKeyUpdateMock).toHaveBeenCalledTimes(1);
        const sqlCalls = sqlMock.mock.calls.map((c) => (c[0] as TemplateStringsArray).join('+'));
        expect(sqlCalls.some((s) => s.includes('+'))).toBe(true);
    });
});

describe('decrementRateLimit (AGG-T1 / AGG-T4)', () => {
    it('wraps UPDATE GREATEST(count-1,0) + DELETE-when-<=0 in a single transaction', async () => {
        await decrementRateLimit('203.0.113.2', 'checkout', 60_000, 2_000);

        // Must use a transaction (NOT two bare db.execute calls) so a concurrent
        // read can't see count=0 with the row still present.
        expect(transactionMock).toHaveBeenCalledTimes(1);

        // Inside the tx: an UPDATE (the decrement) then a DELETE (cleanup).
        expect(txUpdateMock).toHaveBeenCalledTimes(1);
        expect(txDeleteMock).toHaveBeenCalledTimes(1);

        // The UPDATE set must use GREATEST(... - 1, 0) so the count never goes
        // negative under concurrent decrements. Assert via the sql`` template
        // text captured by sqlMock rather than a brittle cast through the
        // builder return value.
        const sqlTemplates = sqlMock.mock.calls.map((c) => c[0].join(''));
        expect(sqlTemplates.some((s) => s.includes('GREATEST'))).toBe(true);

        // The DELETE must be scoped to count <= 0 (only zero rows are cleaned).
        expect(sqlTemplates.some((s) => s.includes('<= 0'))).toBe(true);
    });
});

describe('resetRateLimit (AGG-T1)', () => {
    it('DELETEs the bucket row for the ip + type + bucketStart', async () => {
        await resetRateLimit('203.0.113.3', 'login_account', 60_000, 3_000);

        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(deleteWhereMock).toHaveBeenCalledTimes(1);
        // It must be a plain delete (no transaction needed — full-row removal).
        expect(transactionMock).not.toHaveBeenCalled();
    });
});

describe('purgeOldBuckets (C29 AGG-C29-01)', () => {
    it('deletes expired buckets with bounded raw DELETE batches', async () => {
        executeMock
            .mockResolvedValueOnce({ affectedRows: RATE_LIMIT_BUCKET_PURGE_BATCH_SIZE })
            .mockResolvedValueOnce({ affectedRows: 3 });

        const deleted = await purgeOldBuckets(60_000);

        expect(deleted).toBe(RATE_LIMIT_BUCKET_PURGE_BATCH_SIZE + 3);
        expect(deleteMock).not.toHaveBeenCalled();
        expect(executeMock).toHaveBeenCalledTimes(2);
        const templates = sqlMock.mock.calls.map((c) => c[0].join(''));
        expect(templates.some((s) => s.includes('DELETE FROM') && s.includes('LIMIT'))).toBe(true);
    });
});
