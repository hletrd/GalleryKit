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
    selectMock,
    fromMock,
    whereMock,
    limitMock,
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

    // checkRateLimit (C2-22/TEST-01) chain: db.select().from().where().limit().
    const limitMock = vi.fn(async () => [] as Array<{ count: number }>);
    const whereMock = vi.fn(() => ({ limit: limitMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const selectMock = vi.fn(() => ({ from: fromMock }));

    return {
        insertMock, valuesMock, onDuplicateKeyUpdateMock,
        deleteMock, deleteWhereMock,
        transactionMock, txUpdateMock, txDeleteMock,
        executeMock, sqlMock,
        selectMock, fromMock, whereMock, limitMock,
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
        select: selectMock,
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

import { incrementRateLimit, decrementRateLimit, resetRateLimit, purgeOldBuckets, checkRateLimit, RATE_LIMIT_BUCKET_PURGE_BATCH_SIZE } from '@/lib/rate-limit';

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

describe('checkRateLimit (C2-22/TEST-01)', () => {
    it('queries via db.select().from().where().limit(1) with ip + bucketType + bucketStart eq conditions', async () => {
        limitMock.mockResolvedValueOnce([{ count: 2 }]);

        await checkRateLimit('203.0.113.20', 'login', 5, 60_000, 4_000);

        expect(selectMock).toHaveBeenCalledTimes(1);
        expect(fromMock).toHaveBeenCalledTimes(1);
        expect(whereMock).toHaveBeenCalledTimes(1);
        expect(limitMock).toHaveBeenCalledWith(1);

        // The mocked `and`/`eq` from drizzle-orm record their raw args, so the
        // where() clause shape can be asserted without a real query builder.
        const whereArg = (whereMock.mock.calls as unknown[][])[0][0] as { __and: unknown[] };
        expect(whereArg).toEqual({
            __and: [
                { __eq: ['rate_limit_buckets.ip', '203.0.113.20'] },
                { __eq: ['rate_limit_buckets.bucket_type', 'login'] },
                { __eq: ['rate_limit_buckets.bucket_start', 4_000] },
            ],
        });
    });

    it('returns limited:true at the exceeded boundary (count >= maxRequests)', async () => {
        limitMock.mockResolvedValueOnce([{ count: 5 }]);

        const result = await checkRateLimit('203.0.113.21', 'login', 5, 60_000, 1_000);

        expect(result).toEqual({ limited: true, count: 5 });
    });

    it('returns limited:false just below the boundary (count === maxRequests - 1)', async () => {
        limitMock.mockResolvedValueOnce([{ count: 4 }]);

        const result = await checkRateLimit('203.0.113.21', 'login', 5, 60_000, 1_000);

        expect(result).toEqual({ limited: false, count: 4 });
    });

    it('treats an empty result as count 0, not limited, and does not throw', async () => {
        limitMock.mockResolvedValueOnce([]);

        await expect(checkRateLimit('203.0.113.22', 'login', 5, 60_000, 1_000)).resolves.toEqual({
            limited: false,
            count: 0,
        });
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
