import type { PoolConnection } from 'mysql2/promise';

/**
 * C7-02 (run-10 cycle 7b): shared destroy-don't-release discipline for pooled
 * advisory-lock connections.
 *
 * A MySQL advisory lock is held by a CONNECTION, not a transaction. When a
 * `RELEASE_LOCK` round-trip fails (connection blip, timeout, server restart)
 * and the connection is then `release()`d back to the pool anyway, the lock
 * may still be held server-side by that live pooled connection — silently
 * wedging every future `GET_LOCK` attempt for that name until the process
 * restarts. For fail-fast locks (`GET_LOCK(..., 0)` — e.g. the DB-restore
 * lock) one transient release failure disables the whole feature.
 *
 * The fix pattern (first landed for the topic route-segment lock in commit
 * 3acf638a): when a release fails, DESTROY the connection instead of
 * releasing it — mysql2 closes the socket, MySQL frees every advisory lock
 * held by that session, and the pool opens a fresh replacement on demand.
 *
 * Every pooled advisory-lock release site MUST go through this module (a
 * source-contract test pins that — see advisory-lock-release.test.ts). The
 * single-writer guard is exempt: it uses a dedicated NON-pool connection
 * whose own lifecycle already closes the socket on failure.
 */

export interface PooledAdvisoryLockReleaser {
    /**
     * Attempt to release one advisory lock on the tracked connection. Never
     * throws; a failure is remembered so `finish()` destroys the connection.
     */
    release(lockName: string, label: string): Promise<void>;
    /** Whether any release so far failed (the connection will be destroyed). */
    readonly releaseFailed: boolean;
    /**
     * Terminal decision for the connection: `release()` back to the pool when
     * every RELEASE_LOCK succeeded, `destroy()` otherwise. Call exactly once.
     */
    finish(): void;
}

/**
 * Staged variant for call sites that release several locks on one connection
 * at different points (e.g. the DB-restore path holds up to three chained
 * locks) and make a single terminal release/destroy decision at the end.
 */
export function createPooledAdvisoryLockReleaser(conn: PoolConnection): PooledAdvisoryLockReleaser {
    let failed = false;
    return {
        async release(lockName: string, label: string): Promise<void> {
            try {
                await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
            } catch (err) {
                failed = true;
                console.error(
                    `RELEASE_LOCK (${label}) failed; destroying pooled connection to avoid leaking an advisory lock:`,
                    err,
                );
            }
        },
        get releaseFailed() {
            return failed;
        },
        finish(): void {
            if (failed) {
                conn.destroy();
            } else {
                conn.release();
            }
        },
    };
}

/**
 * One-shot variant: release the given lock(s), then immediately return the
 * connection to the pool (all succeeded) or destroy it (any failed).
 *
 * @returns true when every release succeeded and the connection was released
 *          back to the pool; false when the connection was destroyed.
 */
export async function releasePooledAdvisoryLocks(
    conn: PoolConnection,
    lockNames: readonly string[],
    label: string,
): Promise<boolean> {
    const releaser = createPooledAdvisoryLockReleaser(conn);
    for (const lockName of lockNames) {
        await releaser.release(lockName, label);
    }
    releaser.finish();
    return !releaser.releaseFailed;
}
