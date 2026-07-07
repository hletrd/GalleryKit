/**
 * TE-R9C1-02 (run-9 cycle-1): behavioral coverage for
 * acquireUploadProcessingContractLock.
 *
 * Before this file, only the source-grep `restore-upload-lock.test.ts` existed
 * — neither GET_LOCK acquisition arm was behaviorally exercised. The critical
 * uncovered branch is `upload-processing-contract-lock.ts:32`:
 *
 *     lockAcquired = acquired === 1 || acquired === BigInt(1);
 *
 * mysql2 can return integer columns as `number` OR `BigInt` depending on driver
 * config / column type. If a driver change ever made GET_LOCK return BigInt(1)
 * and only the numeric-`1` arm had ever run, the lock would return `null` on
 * every call and every upload-contract settings change would spuriously fail
 * with the `uploadSettingsLocked` toast. These tests pin both arms plus the
 * null / 0 / error / double-release paths.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConnectionMock } = vi.hoisted(() => ({
    getConnectionMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    connection: { getConnection: getConnectionMock },
}));

import { acquireUploadProcessingContractLock } from '@/lib/upload-processing-contract-lock';
import { LOCK_UPLOAD_PROCESSING_CONTRACT } from '@/lib/advisory-locks';

type QueryResult = unknown;

/**
 * Build a fake mysql2 pool connection whose `.query()` resolves the GET_LOCK
 * row to `acquiredValue` and resolves every other query (RELEASE_LOCK) to an
 * empty result. `.release()` is a spy.
 */
function makeConn(acquiredValue: number | bigint | null) {
    const release = vi.fn();
    const destroy = vi.fn();
    const query = vi.fn(async (sql: string, _params?: unknown[]): Promise<[QueryResult, unknown]> => {
        if (sql.includes('GET_LOCK')) {
            return [[{ acquired: acquiredValue }], undefined];
        }
        // RELEASE_LOCK
        return [[], undefined];
    });
    return { query, release, destroy };
}

beforeEach(() => {
    getConnectionMock.mockReset();
});

describe('acquireUploadProcessingContractLock — acquisition arms', () => {
    it('returns a working lock when GET_LOCK yields numeric 1', async () => {
        const conn = makeConn(1);
        getConnectionMock.mockResolvedValue(conn);

        const lock = await acquireUploadProcessingContractLock(5);
        expect(lock).not.toBeNull();

        // GET_LOCK was called with the contract lock name.
        const getLockCall = conn.query.mock.calls.find((c) => String(c[0]).includes('GET_LOCK'));
        expect(getLockCall).toBeTruthy();
        expect((getLockCall![1] as unknown[])[0]).toBe(LOCK_UPLOAD_PROCESSING_CONTRACT);

        // release() issues RELEASE_LOCK then releases the connection.
        await lock!.release();
        const releaseLockCall = conn.query.mock.calls.find((c) => String(c[0]).includes('RELEASE_LOCK'));
        expect(releaseLockCall).toBeTruthy();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it('returns a working lock when GET_LOCK yields BigInt(1) — the defensive arm', async () => {
        const conn = makeConn(BigInt(1));
        getConnectionMock.mockResolvedValue(conn);

        const lock = await acquireUploadProcessingContractLock(5);
        // This is the branch that had never been exercised before this test.
        expect(lock).not.toBeNull();

        await lock!.release();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });
});

describe('acquireUploadProcessingContractLock — non-acquired results', () => {
    it('returns null and releases the connection when GET_LOCK yields 0', async () => {
        const conn = makeConn(0);
        getConnectionMock.mockResolvedValue(conn);

        const lock = await acquireUploadProcessingContractLock(5);
        expect(lock).toBeNull();
        expect(conn.release).toHaveBeenCalledTimes(1);
        // No RELEASE_LOCK should be issued — we never held the lock.
        const releaseLockCall = conn.query.mock.calls.find((c) => String(c[0]).includes('RELEASE_LOCK'));
        expect(releaseLockCall).toBeUndefined();
    });

    it('returns null and releases the connection when GET_LOCK yields null (timeout/unhealthy)', async () => {
        const conn = makeConn(null);
        getConnectionMock.mockResolvedValue(conn);

        const lock = await acquireUploadProcessingContractLock(5);
        expect(lock).toBeNull();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });
});

describe('acquireUploadProcessingContractLock — error paths', () => {
    it('returns null (no throw) when getConnection itself fails', async () => {
        getConnectionMock.mockRejectedValue(new Error('pool exhausted'));

        const lock = await acquireUploadProcessingContractLock(5);
        expect(lock).toBeNull();
    });

    it('returns null and destroys the connection when the GET_LOCK query throws after connect', async () => {
        const release = vi.fn();
        const destroy = vi.fn();
        const query = vi.fn(async () => {
            throw new Error('lost connection mid-GET_LOCK');
        });
        getConnectionMock.mockResolvedValue({ query, release, destroy });

        const lock = await acquireUploadProcessingContractLock(5);
        expect(lock).toBeNull();
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
    });
});

describe('acquireUploadProcessingContractLock — release idempotency', () => {
    it('is a no-op on the second release() call (RELEASE_LOCK issued once)', async () => {
        const conn = makeConn(1);
        getConnectionMock.mockResolvedValue(conn);

        const lock = await acquireUploadProcessingContractLock(5);
        expect(lock).not.toBeNull();

        await lock!.release();
        await lock!.release();

        const releaseLockCalls = conn.query.mock.calls.filter((c) => String(c[0]).includes('RELEASE_LOCK'));
        expect(releaseLockCalls.length).toBe(1);
        expect(conn.release).toHaveBeenCalledTimes(1);
    });
});
