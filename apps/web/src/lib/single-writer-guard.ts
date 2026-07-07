import mysql from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { getMysqlConnectionOptions } from '../../scripts/mysql-connection-options';
import { getSingleWriterLockName, isAdvisoryLockAcquired } from '@/lib/advisory-locks';

/**
 * C2-03 (run-10 c2): WARN-ONLY startup guard for the single-web-instance /
 * single-writer topology documented in CLAUDE.md ("Runtime topology"). Two
 * live GalleryKit web processes sharing one MySQL database silently break the
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
 *
 * C3-02 (run-10 c3, ARCH3-01/VER3-01): the held connection is kept alive
 * with a periodic no-op `SELECT 1`. Without it, MySQL's `wait_timeout`
 * (server default 8h) reaps the query-idle connection, the advisory lock
 * releases server-side, and a second instance booting LATER acquires the
 * lock silently — exactly the scale-up-after-running-solo path the guard
 * exists to catch.
 *
 * C3-03 (run-10 c3, CRIT3-04): the lock name is DB-scoped (see
 * `getSingleWriterLockName`) so two separate galleries co-located on one
 * MySQL server do not false-alarm each other, and the loud error is only
 * emitted after a single ~25s re-probe so a rolling deploy's drain overlap
 * (old process holds the lock for up to ~15s while the new one boots) does
 * not cry wolf on every ordinary restart.
 *
 * C4-06 (run-10 c4, CRIT4-03/ARCH4-01): a lapse (keepalive failure or
 * connection error) no longer disarms the guard permanently. It warns once,
 * then schedules an unref'd 60s re-acquire loop: on success the guard is
 * quietly re-armed (the lapse was transient — DB restart/failover/blip); on
 * CONTENTION it emits the loud topology error, because finding the lock held
 * by someone else right after a lapse IS the second-instance detection this
 * guard exists for. Connect failures during re-acquire stay quiet and retry.
 * `stopSingleWriterGuard` sets a `stopping` latch so a clean shutdown never
 * logs a scary lapse warning and no reprobe/re-acquire can take ownership
 * after stop (TRC4-03 / CR4-04).
 */

const KEEPALIVE_INTERVAL_MS = 60_000;
const REPROBE_DELAY_MS = 25_000;
const REACQUIRE_INTERVAL_MS = 60_000;

let heldConnection: Connection | null = null;
let keepaliveTimer: NodeJS.Timeout | null = null;
let reprobeTimer: NodeJS.Timeout | null = null;
let reacquireTimer: NodeJS.Timeout | null = null;
let lapseWarned = false;
let contentionEmittedSinceLapse = false;
let stopping = false;

function clearKeepalive(): void {
    if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
    }
}

function clearReprobe(): void {
    if (reprobeTimer) {
        clearTimeout(reprobeTimer);
        reprobeTimer = null;
    }
}

function clearReacquire(): void {
    if (reacquireTimer) {
        clearTimeout(reacquireTimer);
        reacquireTimer = null;
    }
}

function warnLapse(err: unknown): void {
    if (lapseWarned || stopping) return;
    lapseWarned = true;
    console.warn(
        '[single-writer-guard] The MySQL connection backing the singleton guard was lost; the guard has lapsed. Scheduling background re-acquire attempts:',
        err,
    );
}

async function openGuardConnection(
    context: 'startup' | 're-probe' | 're-acquire' = 'startup',
): Promise<{ conn: Connection; lockName: string } | null> {
    try {
        const options = getMysqlConnectionOptions();
        const lockName = getSingleWriterLockName(String(options.database ?? ''));
        const conn = await mysql.createConnection(options);
        return { conn, lockName };
    } catch (err) {
        // TRC4-02: word the failure for the path it actually fired on — a
        // re-probe/re-acquire connect failure 25s+ into the process is not
        // "at startup".
        console.warn(
            `[single-writer-guard] Could not connect to MySQL to probe the singleton lock (${context}); ` +
            (context === 'startup'
                ? 'skipping (this does not affect app startup):'
                : 'will retry in the background (this does not affect the app):'),
            err,
        );
        return null;
    }
}

async function tryAcquire(conn: Connection, lockName: string): Promise<boolean> {
    const [rows] = await conn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
        'SELECT GET_LOCK(?, 0) AS acquired',
        [lockName],
    );
    return isAdvisoryLockAcquired(rows[0]?.acquired ?? null);
}

function holdConnection(conn: Connection): void {
    // Lock acquired: hold this connection open for the process lifetime.
    // Its liveness (and the GET_LOCK it holds) is exactly the signal a
    // future second instance's own probe would observe as "already taken" —
    // closing it here would defeat the guard.
    heldConnection = conn;
    lapseWarned = false;
    contentionEmittedSinceLapse = false;
    conn.on('error', (err) => {
        // A dropped connection silently releases the advisory lock
        // server-side: warn once that the guard's liveness signal has lapsed,
        // then hand off to the background re-acquire loop (C4-06).
        warnLapse(err);
        if (heldConnection === conn) {
            heldConnection = null;
            clearKeepalive();
            scheduleReacquire();
        }
    });

    // C3-02: keep the held connection query-active so MySQL's wait_timeout
    // never reaps it. The interval is unref'd — it must not hold the process
    // open at shutdown.
    keepaliveTimer = setInterval(() => {
        conn.query('SELECT 1').catch((err) => {
            warnLapse(err);
            if (heldConnection === conn) {
                heldConnection = null;
            }
            clearKeepalive();
            conn.end().catch(() => {});
            scheduleReacquire();
        });
    }, KEEPALIVE_INTERVAL_MS);
    keepaliveTimer.unref?.();
}

/**
 * C4-06: after a lapse, keep trying to re-acquire on a fresh dedicated
 * connection (unref'd, quiet on connect failures). Success re-arms the guard
 * silently; contention means another live instance took the freed lock — the
 * exact condition the guard exists to detect — so emit the loud topology
 * error (once per lapse) and keep retrying quietly in case that holder is
 * itself transient.
 */
function scheduleReacquire(): void {
    if (stopping || heldConnection || reacquireTimer) return;
    reacquireTimer = setTimeout(() => {
        void reacquireOnce();
    }, REACQUIRE_INTERVAL_MS);
    reacquireTimer.unref?.();
}

async function reacquireOnce(): Promise<void> {
    reacquireTimer = null;
    if (stopping || heldConnection) return;
    const opened = await openGuardConnection('re-acquire');
    if (!opened) {
        scheduleReacquire();
        return;
    }
    const { conn, lockName } = opened;
    try {
        if (stopping) {
            await conn.end().catch(() => {});
            return;
        }
        if (await tryAcquire(conn, lockName)) {
            if (stopping) {
                // Shutdown raced the acquire: never take ownership after stop.
                await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
                await conn.end().catch(() => {});
                return;
            }
            console.warn(
                '[single-writer-guard] Re-acquired the singleton advisory lock after a lapse; the guard is re-armed.',
            );
            holdConnection(conn);
            return;
        }
        if (!contentionEmittedSinceLapse) {
            contentionEmittedSinceLapse = true;
            emitLoudTopologyError(lockName);
        }
        await conn.end().catch(() => {});
        scheduleReacquire();
    } catch (err) {
        console.warn(
            '[single-writer-guard] Error while re-acquiring the singleton advisory lock; will retry in the background:',
            err,
        );
        await conn.end().catch(() => {});
        scheduleReacquire();
    }
}

function emitLoudTopologyError(lockName: string): void {
    console.error(`
================================================================================
[single-writer-guard] ANOTHER LIVE GALLERYKIT INSTANCE DETECTED ON THIS DATABASE
--------------------------------------------------------------------------------
This process could not acquire the '${lockName}' MySQL
advisory lock (the single-writer/singleton liveness lock) — probed twice,
${Math.round(REPROBE_DELAY_MS / 1000)}s apart — because another running GalleryKit web process pointed at the
SAME database already holds it.

GalleryKit ships a single-web-instance / single-writer topology. Per-process
in-memory coordination — the restore-maintenance mutation fence, upload
quota tracking, and several rate-limit fast paths — is NOT safe across
multiple concurrently running instances that share this database. See
CLAUDE.md, "Runtime topology", for details.

This is a WARNING only. Startup is continuing.
================================================================================`);
}

async function reprobeOnce(): Promise<void> {
    reprobeTimer = null;
    if (heldConnection || stopping) return;
    const opened = await openGuardConnection('re-probe');
    if (!opened) {
        scheduleReacquire();
        return;
    }
    const { conn, lockName } = opened;
    try {
        if (await tryAcquire(conn, lockName)) {
            if (stopping) {
                // Shutdown raced the reprobe: never take ownership after stop
                // (CR4-04 — previously this leaked a held connection+interval
                // that only process.exit() cleaned up).
                await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
                await conn.end().catch(() => {});
                return;
            }
            // The initial contention was transient (rolling-deploy drain
            // overlap, or a crashed holder MySQL has since reclaimed).
            // Hold quietly — no operator noise for a normal restart.
            holdConnection(conn);
            return;
        }
        contentionEmittedSinceLapse = true;
        emitLoudTopologyError(lockName);
        await conn.end().catch(() => {});
        scheduleReacquire();
    } catch (err) {
        console.warn(
            '[single-writer-guard] Error while re-probing the singleton advisory lock; will retry in the background (this does not affect the app):',
            err,
        );
        await conn.end().catch(() => {});
        scheduleReacquire();
    }
}

export async function startSingleWriterGuard(): Promise<void> {
    stopping = false;
    if (heldConnection) {
        // Already holding the lock from an earlier call in this process.
        return;
    }

    const opened = await openGuardConnection();
    if (!opened) return;
    const { conn, lockName } = opened;

    try {
        if (await tryAcquire(conn, lockName)) {
            holdConnection(conn);
            return;
        }

        // Lock unavailable: do NOT cry wolf yet — a rolling deploy's old
        // process legitimately holds the lock through its drain window.
        // Re-probe once after REPROBE_DELAY_MS; only a persistent holder
        // earns the loud topology error (C3-03).
        await conn.end().catch(() => {});
        reprobeTimer = setTimeout(() => {
            void reprobeOnce();
        }, REPROBE_DELAY_MS);
        reprobeTimer.unref?.();
    } catch (err) {
        console.warn(
            '[single-writer-guard] Error while probing the singleton advisory lock at startup; skipping (this does not affect app startup):',
            err,
        );
        await conn.end().catch(() => {});
    }
}

export async function stopSingleWriterGuard(): Promise<void> {
    // Latch FIRST: suppresses lapse warnings from a keepalive/RELEASE_LOCK
    // race during clean shutdown (TRC4-03) and blocks any in-flight
    // reprobe/re-acquire from taking ownership after stop (CR4-04).
    stopping = true;
    clearReprobe();
    clearReacquire();
    clearKeepalive();
    const conn = heldConnection;
    heldConnection = null;
    if (!conn) return;

    try {
        const options = getMysqlConnectionOptions();
        await conn.query('SELECT RELEASE_LOCK(?)', [
            getSingleWriterLockName(String(options.database ?? '')),
        ]);
    } catch (err) {
        console.debug('[single-writer-guard] RELEASE_LOCK failed during shutdown:', err);
    } finally {
        await conn.end().catch(() => {});
    }
}
