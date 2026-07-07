import type { RowDataPacket } from 'mysql2/promise';
import { connection } from '@/db';
import { LOCK_UPLOAD_PROCESSING_CONTRACT, isAdvisoryLockAcquired } from '@/lib/advisory-locks';
import { releasePooledAdvisoryLocks } from '@/lib/advisory-lock-release';

type UploadProcessingContractLock = {
    release: () => Promise<void>;
};

export async function acquireUploadProcessingContractLock(timeoutSeconds = 5): Promise<UploadProcessingContractLock | null> {
    // C2L2-01: convert pool/connection acquisition errors into a `null` return
    // so callers can surface a friendly i18n `uploadSettingsLocked` toast
    // instead of letting a transient DB outage propagate as a 500. The lock
    // helper is a guard layer; the action body itself can still be rejected by
    // higher-level mechanisms when the DB is unhealthy enough that subsequent
    // queries fail.
    let conn: Awaited<ReturnType<typeof connection.getConnection>>;
    try {
        conn = await connection.getConnection();
    } catch (err) {
        console.debug('GET_LOCK (upload processing contract) connection failed:', err);
        return null;
    }
    let lockAcquired = false;
    let released = false;

    try {
        const [lockRows] = await conn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            'SELECT GET_LOCK(?, ?) AS acquired',
            [LOCK_UPLOAD_PROCESSING_CONTRACT, timeoutSeconds],
        );
        const acquired = lockRows[0]?.acquired;
        lockAcquired = isAdvisoryLockAcquired(acquired);
        if (!lockAcquired) {
            // C2L2-07: log the failed acquisition at debug so an operator can
            // distinguish "another writer holds the lock" (acquired === 0)
            // from "the lock infra returned NULL/timeout/unhealthy" by
            // pattern-matching on the recorded value.
            console.debug('GET_LOCK (upload processing contract) returned non-1 result:', acquired);
            conn.release();
            released = true;
            return null;
        }

        return {
            release: async () => {
                if (released) return;
                released = true;
                // C7-02 (run-10 cycle 7b): destroy-don't-release on a failed
                // RELEASE_LOCK so the upload-processing contract lock cannot
                // leak onto a live pooled session (which would block every
                // future upload and image_sizes/strip_gps settings change
                // until process restart). Never throws.
                await releasePooledAdvisoryLocks(conn, [LOCK_UPLOAD_PROCESSING_CONTRACT], 'upload processing contract');
            },
        };
    } catch (err) {
        // C2L2-01: also convert post-connection query errors (e.g. lost
        // connection during GET_LOCK round-trip) into a null return so the
        // caller surfaces a friendly toast instead of a 500.
        console.debug('GET_LOCK (upload processing contract) query failed:', err);
        if (!released) {
            released = true;
            if (lockAcquired) {
                // C7-02: same destroy-don't-release discipline on the error path.
                await releasePooledAdvisoryLocks(conn, [LOCK_UPLOAD_PROCESSING_CONTRACT], 'upload processing contract (error path)');
            } else {
                try {
                    conn.release();
                } catch (releaseErr) {
                    console.debug('connection.release() after GET_LOCK failure threw:', releaseErr);
                }
            }
        }
        return null;
    }
}
