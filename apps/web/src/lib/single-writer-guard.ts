import mysql from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getMysqlConnectionOptions } from '../../scripts/mysql-connection-options';
import { LOCK_SINGLE_WRITER_GUARD, isAdvisoryLockAcquired } from '@/lib/advisory-locks';

/**
 * C2-03 (run-10 c2): WARN-ONLY startup guard for the single-web-instance /
 * single-writer topology documented in CLAUDE.md ("Runtime topology"). Two
 * live GalleryKit web processes sharing one MySQL server silently break the
 * restore mutation fence, upload quota tracking, and several rate-limit
 * fast paths, none of which coordinate across processes today. This guard
 * cannot enforce single-instance operation — it can only detect and loudly
 * warn about the misconfiguration. It must never block or delay a
 * legitimate boot (e.g. the DB being briefly unreachable at startup, or a
 * stale lock from a previous crashed process that MySQL has already
 * reclaimed) is not a reason to fail startup.
 *
 * Uses a dedicated (non-pooled) connection because the lock is held open
 * for the entire process lifetime — borrowing a slot from the shared pool
 * (`POOL_CONNECTION_LIMIT`, `db/index.ts`) would permanently shrink the
 * budget available to live request traffic.
 */

let heldConnection: Connection | null = null;
let lapseWarned = false;

export async function startSingleWriterGuard(): Promise<void> {
    if (heldConnection) {
        // Already holding the lock from an earlier call in this process.
        return;
    }

    let conn: Connection;
    try {
        const options = getMysqlConnectionOptions();
        conn = await mysql.createConnection(options);
    } catch (err) {
        console.warn(
            '[single-writer-guard] Could not connect to MySQL to probe the singleton lock at startup; skipping (this does not affect app startup):',
            err,
        );
        return;
    }

    try {
        const [rows] = await conn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            'SELECT GET_LOCK(?, 0) AS acquired',
            [LOCK_SINGLE_WRITER_GUARD],
        );
        const acquired = rows[0]?.acquired ?? null;

        if (!isAdvisoryLockAcquired(acquired)) {
            console.error(`
================================================================================
[single-writer-guard] ANOTHER LIVE GALLERYKIT INSTANCE DETECTED ON THIS MYSQL SERVER
--------------------------------------------------------------------------------
This process could not acquire the '${LOCK_SINGLE_WRITER_GUARD}' MySQL
advisory lock (the single-writer/singleton liveness lock) because another
running GalleryKit web process already holds it.

GalleryKit ships a single-web-instance / single-writer topology. Per-process
in-memory coordination — the restore-maintenance mutation fence, upload
quota tracking, and several rate-limit fast paths — is NOT safe across
multiple concurrently running instances that share this MySQL server. See
CLAUDE.md, "Runtime topology", for details.

This is a WARNING only. Startup is continuing.
================================================================================`);
            await conn.end().catch(() => {});
            return;
        }

        // Lock acquired: hold this connection open for the process
        // lifetime. Its liveness (and the GET_LOCK it holds) is exactly the
        // signal a future second instance's own probe above would observe
        // as "already taken" — closing it here would defeat the guard.
        heldConnection = conn;
        lapseWarned = false;
        conn.on('error', (err) => {
            // Never auto-reconnect: a dropped connection silently releases
            // the advisory lock server-side, so the only honest response is
            // to warn once that the guard's liveness signal has lapsed.
            if (lapseWarned) return;
            lapseWarned = true;
            console.warn(
                '[single-writer-guard] The MySQL connection backing the singleton guard was lost; the guard has lapsed (no auto-reconnect):',
                err,
            );
            if (heldConnection === conn) {
                heldConnection = null;
            }
        });
    } catch (err) {
        console.warn(
            '[single-writer-guard] Error while probing the singleton advisory lock at startup; skipping (this does not affect app startup):',
            err,
        );
        await conn.end().catch(() => {});
    }
}

export async function stopSingleWriterGuard(): Promise<void> {
    const conn = heldConnection;
    heldConnection = null;
    if (!conn) return;

    try {
        await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_SINGLE_WRITER_GUARD]);
    } catch (err) {
        console.debug('[single-writer-guard] RELEASE_LOCK failed during shutdown:', err);
    } finally {
        await conn.end().catch(() => {});
    }
}
