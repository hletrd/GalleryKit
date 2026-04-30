import type { RowDataPacket } from 'mysql2/promise';
import { connection } from '@/db';
import { LOCK_UPLOAD_PROCESSING_CONTRACT } from '@/lib/advisory-locks';

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
        lockAcquired = acquired === 1 || acquired === BigInt(1);
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
                try {
                    await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_UPLOAD_PROCESSING_CONTRACT]);
                } catch (err) {
                    console.debug('RELEASE_LOCK (upload processing contract) failed:', err);
                } finally {
                    conn.release();
                }
            },
        };
    } catch (err) {
        // C2L2-01: also convert post-connection query errors (e.g. lost
        // connection during GET_LOCK round-trip) into a null return so the
        // caller surfaces a friendly toast instead of a 500.
        console.debug('GET_LOCK (upload processing contract) query failed:', err);
        if (lockAcquired && !released) {
            await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_UPLOAD_PROCESSING_CONTRACT]).catch(() => {});
        }
        if (!released) {
            try {
                conn.release();
            } catch (releaseErr) {
                console.debug('connection.release() after GET_LOCK failure threw:', releaseErr);
            }
        }
        return null;
    }
}
