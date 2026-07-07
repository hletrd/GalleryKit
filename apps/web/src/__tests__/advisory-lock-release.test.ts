import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

import {
    createPooledAdvisoryLockReleaser,
    releasePooledAdvisoryLocks,
} from '@/lib/advisory-lock-release';

function makeConn() {
    return {
        query: vi.fn(async () => [[{ released: 1 }]]),
        release: vi.fn(),
        destroy: vi.fn(),
    } as unknown as PoolConnection & {
        query: ReturnType<typeof vi.fn>;
        release: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
    };
}

describe('pooled advisory-lock release helper', () => {
    it('returns a clean connection to the pool when every RELEASE_LOCK succeeds', async () => {
        const conn = makeConn();

        await expect(releasePooledAdvisoryLocks(conn, ['lock-a', 'lock-b'], 'test locks'))
            .resolves.toBe(true);

        expect(conn.query).toHaveBeenCalledTimes(2);
        expect(conn.query).toHaveBeenNthCalledWith(1, 'SELECT RELEASE_LOCK(?)', ['lock-a']);
        expect(conn.query).toHaveBeenNthCalledWith(2, 'SELECT RELEASE_LOCK(?)', ['lock-b']);
        expect(conn.release).toHaveBeenCalledTimes(1);
        expect(conn.destroy).not.toHaveBeenCalled();
    });

    it('destroys the pooled connection when any RELEASE_LOCK fails', async () => {
        const conn = makeConn();
        const error = new Error('release failed');
        conn.query.mockRejectedValueOnce(error);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(releasePooledAdvisoryLocks(conn, ['lock-a'], 'test lock'))
            .resolves.toBe(false);

        expect(conn.release).not.toHaveBeenCalled();
        expect(conn.destroy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('RELEASE_LOCK (test lock) failed; destroying pooled connection'),
            error,
        );

        errorSpy.mockRestore();
    });

    it('supports staged multi-lock release with one terminal pool decision', async () => {
        const conn = makeConn();
        const releaser = createPooledAdvisoryLockReleaser(conn);

        await releaser.release('lock-a', 'first');
        await releaser.release('lock-b', 'second');
        releaser.finish();

        expect(releaser.releaseFailed).toBe(false);
        expect(conn.release).toHaveBeenCalledTimes(1);
        expect(conn.destroy).not.toHaveBeenCalled();
    });
});
