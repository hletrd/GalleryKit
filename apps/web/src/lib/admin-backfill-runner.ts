/**
 * admin-backfill-runner.ts
 *
 * Cycle 4 RPF loop R27-UX-HIGH-1 — in-app color-pipeline backfill trigger
 * (Path A from .context/plans/photographer-r27/phase-d-workflow-ergonomics.md).
 *
 * This module is the runtime cousin of `scripts/backfill-color-pipeline.ts`.
 * The script runs from a sidecar `--rm` Docker container with full source
 * mounts; this module runs INSIDE the live web process when a photographer
 * clicks "Re-encode existing photos" in the admin settings UI.
 *
 * Concurrency / safety contract
 * ─────────────────────────────
 * - The runner acquires the `gallerykit_color_pipeline_backfill` advisory
 *   lock on a dedicated connection for the FULL duration of the run. The
 *   companion shell script uses the same lock name, so the in-app trigger
 *   and the shell sidecar serialize cleanly — you cannot accidentally race
 *   the two.
 * - The advisory lock is acquired NON-BLOCKING (`GET_LOCK(name, 0)`). If
 *   it's held (another runner is in flight), the caller receives
 *   `{ status: 'already_running' }` rather than queueing a second invocation
 *   that would silently sit waiting on the lock for hours.
 * - Concurrency is capped at `ADMIN_BACKFILL_CONCURRENCY` (default 1) —
 *   we ship 1 because the in-app runner shares Sharp + libheif worker
 *   capacity with the live image-processing queue. Operators on a host
 *   with spare CPU can raise this; the env var is read at runner start.
 *   AGG-R5C3-05 + AGG-5 (run-6 c1): the requested value is ALSO clamped to a
 *   connection-budget cap so a background re-encode cannot pin the shared DB
 *   pool and starve live traffic. Each worker can hold up to 2 pool
 *   connections at once (per-image claim + transient db.execute) and the
 *   whole-run advisory lock pins 1 more; we additionally RESERVE roughly half
 *   the pool for live request traffic. The effective ceiling is therefore
 *   `cap = max(1, floor((POOL_CONNECTION_LIMIT - RESERVED - 1) / 2))` with
 *   `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` → cap = 2 at the
 *   shipped pool size of 10 (a backfill then pins at most 1 + 2×2 = 5,
 *   leaving ≥ 5 free so live photo/gallery renders don't queue behind
 *   encode-duration connection holds). See `resolveBackfillConcurrency` below
 *   for the authoritative arithmetic. Requests above the cap are clamped DOWN
 *   and a warning is logged. A pool-exhausted claim acquire is treated as a
 *   `locked` skip (row retried next run), never a tight error spin.
 * - The runner is INVISIBLE to the existing PQueue image-processing queue
 *   (which only claims `processed = false` rows). Re-encoding processed
 *   images is structured as a parallel, dedicated path here so we don't
 *   touch the upload→processed claim invariant.
 * - The runner DOES NOT block the server action that started it. The
 *   action returns immediately with `{ status: 'queued', affected_rows: N }`
 *   and the heavy lift runs as a fire-and-forget promise on the Node event
 *   loop. If the process is killed mid-backfill, the next invocation will
 *   pick up where this one left off (rows are selected by
 *   `pipeline_version < CURRENT` so already-completed rows are filtered
 *   out automatically).
 */

import fs from 'fs/promises';
import PQueue from 'p-queue';
import sharp from 'sharp';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { connection, db, POOL_CONNECTION_LIMIT } from '@/db';
import { sql } from 'drizzle-orm';
import { processImageFormats, IMAGE_PIPELINE_VERSION, MAX_INPUT_PIXELS, resolveColorPipelineDecision, deleteImageVariants, type ImageQualitySettings } from '@/lib/process-image';
import { detectColorSignals } from '@/lib/color-detection';
import { resolveOriginalUploadPath, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '@/lib/upload-paths';
import { LOCK_COLOR_PIPELINE_BACKFILL, getImageProcessingLockName, isAdvisoryLockAcquired } from '@/lib/advisory-locks';
import { releasePooledAdvisoryLocks } from '@/lib/advisory-lock-release';
import { getGalleryConfigDetached } from '@/lib/gallery-config';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import type { JpegChromaSubsampling } from '@/lib/gallery-config-shared';

interface CandidateRow {
    id: number;
    filename_original: string;
    filename_avif: string;
    filename_webp: string;
    filename_jpeg: string;
    icc_profile_name: string | null;
    color_primaries: string | null;
    width: number;
}

interface RunnerSettings {
    quality: ImageQualitySettings;
    sizes: number[];
    forceSrgbDerivatives: boolean;
    wideGamutJpegChroma: JpegChromaSubsampling;
    avifEffort: number;
    sdrJpegChroma: JpegChromaSubsampling;
    wideGamutMaxSourcePixels: number;
}

export type AdminBackfillStatus =
    | { status: 'queued'; affectedRows: number }
    | { status: 'already_running' }
    | { status: 'unavailable'; reason: string }
    | { status: 'error'; reason: string };

/**
 * Number of pool connections held back for live request traffic while a
 * backfill runs. AGG-5 (run-6 c1): a SINGLE live `getImage()` fires a ~3-way
 * `Promise.all` (image row + prev + next + tag aggregation), so reserving only 1
 * connection — as the original AGG-R5C3-05 arithmetic did — is not enough to
 * render even one photo page concurrently with a backfill. Reserve roughly half
 * the pool (at least one full getImage fan-out) so live gallery/photo pages keep
 * headroom and don't queue behind encode-duration connection holds.
 */
export const BACKFILL_RESERVED_LIVE_CONNECTIONS = (poolLimit: number): number =>
    Math.max(3, Math.ceil(poolLimit / 2));

/**
 * AGG-R5C3-05 + AGG-5 (run-6 c1): cap the backfill's effective concurrency
 * against the shared DB pool budget, reserving headroom for live traffic.
 *
 * Connection budget arithmetic:
 *   - the whole-run advisory lock pins 1 connection for the run's lifetime;
 *   - each in-flight backfill worker can hold up to 2 connections at once —
 *     the per-image processing claim connection (held across encode → detect →
 *     UPDATE) plus the transient `db.execute` UPDATE connection;
 *   - we reserve RESERVED (≈ half the pool, ≥ one full live getImage fan-out)
 *     for live request traffic;
 *   - so N workers + the lock must fit in `LIMIT − RESERVED`:
 *     `1 + 2N <= LIMIT − RESERVED`  ⇒  `N <= (LIMIT − RESERVED − 1) / 2`.
 *
 * At LIMIT = 10, RESERVED = max(3, 5) = 5, so the cap is floor((10−5−1)/2) =
 * floor(4/2) = 2 — a backfill pins at most 1 (lock) + 2×2 = 5 connections,
 * leaving ≥ 5 for live traffic (≥ one full getImage fan-out plus slack).
 * Operators who raise ADMIN_BACKFILL_CONCURRENCY above the cap are silently
 * clamped DOWN to it so a background maintenance op can never pin the pool and
 * 500 live requests. The cap never drops below 1.
 */
export function resolveBackfillConcurrency(
    requested: number,
    poolLimit: number = POOL_CONNECTION_LIMIT,
): number {
    // Guard against a non-finite pool limit (e.g. a test mock of @/db that omits
    // POOL_CONNECTION_LIMIT, making the imported binding undefined). Fall back to
    // the shipped pool size so the cap arithmetic never yields NaN — a NaN
    // concurrency would silently freeze PQueue and run zero tasks.
    const limit = Number.isFinite(poolLimit) ? poolLimit : 10;
    const reserved = BACKFILL_RESERVED_LIVE_CONNECTIONS(limit);
    const cap = Math.max(1, Math.floor((limit - reserved - 1) / 2));
    const req = Math.max(1, Math.floor(requested) || 1);
    return Math.min(req, cap);
}

const adminBackfillStateKey = Symbol.for('gallerykit.adminBackfillState');

interface AdminBackfillState {
    running: boolean;
    /** Total candidate count from the last started run, for status disclosure. */
    lastQueuedCount: number;
    /**
     * AGG-1 (run-6 c1): the LAST run's REAL successfully-re-encoded row count,
     * mirrored from the runner's `processed` local. The admin UI must read this
     * directly rather than reconstructing it by subtracting failures/skips from
     * `lastQueuedCount` — that reconstruction silently dropped `errors` (fatal
     * per-row UPDATE failures) and used the pre-run candidate snapshot, so a run
     * where every row's version-bump UPDATE threw reported the failed rows as
     * "re-encoded". Reset to 0 at the start of every run.
     */
    processed: number;
    /**
     * AGG-1 (run-6 c1): the LAST run's fatal per-row error count, mirrored from
     * the runner's `errors` local (the `catch` around `reprocessOne` — deadlock /
     * lock-timeout / connection-drop on the version-bump UPDATE). Previously this
     * counter lived only as a function-local and was never surfaced, so a
     * fatal-only run looked clean to every status consumer. Reset to 0 at the
     * start of every run.
     */
    errors: number;
    /** Monotonic counter incremented when the runner finishes successfully. */
    completedRuns: number;
    /**
     * Last error message if a run failed, else null.
     *
     * AGG-19 (plan-330 Unit B): this is a single SCALAR, so at concurrency > 1
     * it is last-writer-wins across workers — whichever worker failed last wins
     * the message. The failure COUNTS (`errors`, `encodeFailures`,
     * `detectionFailures`) stay correct because each worker increments its own
     * tally; only this one human-readable message reflects the most recent
     * failure. Do NOT treat `lastError` as a per-row failure log.
     */
    lastError: string | null;
    /**
     * AGG-R5C3-04: true when the LAST completed run recorded any encode or
     * detection failure (or a fatal per-row error). `completedRuns` still
     * increments on a with-failures run — a run that finished is "complete" —
     * but this flag lets the admin status surface distinguish a clean run from
     * one where every row encode-failed, instead of both reading as success.
     * Reset to false at the start of every run.
     */
    lastRunHadFailures: boolean;
    /** True when the last completed trigger found no pipeline-version candidates. */
    lastRunNoCandidates: boolean;
    // AGG-R5C2-10 (COR-R5C2-01/-02) observability counters. All additive and
    // backward-compatible — existing consumers (admin-backfill.ts destructures
    // only `running`) are unaffected. These reflect the LAST run's tallies and
    // are reset to 0 at the start of every run.
    /** Rows skipped because the original file was missing on disk. */
    skippedMissingOriginal: number;
    /**
     * Rows skipped because the per-image processing advisory lock was held by
     * the live queue worker (or a concurrent retryFailedImage). These rows are
     * NOT version-bumped and remain backfill candidates for a later run.
     */
    skippedLocked: number;
    /** Rows whose re-encode (processImageFormats) threw. No version bump. */
    encodeFailures: number;
    /**
     * Rows whose re-encode succeeded but color detection threw. Derivative
     * columns are persisted WITHOUT a pipeline_version bump so a later run
     * retries detection (documented resume contract).
     */
    detectionFailures: number;
    /**
     * AGG-R8c3-03: rows whose version-bump UPDATE matched 0 rows because the
     * image was deleted DURING this re-encode. The just-written derivative
     * files were cleaned up (no orphan). Neither a success nor a fatal error.
     */
    deletedMidReencode: number;
}

function getState(): AdminBackfillState {
    const g = globalThis as typeof globalThis & {
        [adminBackfillStateKey]?: AdminBackfillState;
    };
    if (!g[adminBackfillStateKey]) {
        g[adminBackfillStateKey] = {
            running: false,
            lastQueuedCount: 0,
            processed: 0,
            errors: 0,
            completedRuns: 0,
            lastError: null,
            skippedMissingOriginal: 0,
            skippedLocked: 0,
            encodeFailures: 0,
            detectionFailures: 0,
            deletedMidReencode: 0,
            lastRunHadFailures: false,
            lastRunNoCandidates: false,
        };
    }
    // Defensive backfill for state objects created before these fields existed
    // (e.g. a globalThis symbol seeded by an older module version or a test).
    const s = g[adminBackfillStateKey]!;
    s.processed ??= 0;
    s.errors ??= 0;
    s.skippedMissingOriginal ??= 0;
    s.skippedLocked ??= 0;
    s.encodeFailures ??= 0;
    s.detectionFailures ??= 0;
    s.deletedMidReencode ??= 0;
    s.lastRunHadFailures ??= false;
    s.lastRunNoCandidates ??= false;
    return s;
}

function resetPerRunCounters(state: AdminBackfillState, queuedCount: number) {
    state.lastQueuedCount = queuedCount;
    state.processed = 0;
    state.errors = 0;
    state.lastError = null;
    state.skippedMissingOriginal = 0;
    state.skippedLocked = 0;
    state.encodeFailures = 0;
    state.detectionFailures = 0;
    state.deletedMidReencode = 0;
    state.lastRunHadFailures = false;
    state.lastRunNoCandidates = false;
}

/**
 * AGG-R5C3-22 (TEST-R5C3-11): test-only reset of the globalThis-backed runner
 * state. Tests previously poked the `Symbol.for('gallerykit.adminBackfillState')`
 * global directly and had to hand-list every field — drifting out of sync the
 * moment a new counter was added. Routing the reset through the module that owns
 * the state keeps the field set in one place. Guarded so it is inert outside a
 * test runner.
 */
export function _resetAdminBackfillStateForTesting(): void {
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
        throw new Error('_resetAdminBackfillStateForTesting is test-only');
    }
    const g = globalThis as typeof globalThis & {
        [adminBackfillStateKey]?: AdminBackfillState;
    };
    g[adminBackfillStateKey] = {
        running: false,
        lastQueuedCount: 0,
        processed: 0,
        errors: 0,
        completedRuns: 0,
        lastError: null,
        skippedMissingOriginal: 0,
        skippedLocked: 0,
        encodeFailures: 0,
        detectionFailures: 0,
        deletedMidReencode: 0,
        lastRunHadFailures: false,
        lastRunNoCandidates: false,
    };
}

/** Public read-only view of runner state, exposed via getAdminBackfillStatus(). */
export function readAdminBackfillState(): Readonly<AdminBackfillState> {
    const s = getState();
    return {
        running: s.running,
        lastQueuedCount: s.lastQueuedCount,
        processed: s.processed,
        errors: s.errors,
        completedRuns: s.completedRuns,
        lastError: s.lastError,
        skippedMissingOriginal: s.skippedMissingOriginal,
        skippedLocked: s.skippedLocked,
        encodeFailures: s.encodeFailures,
        detectionFailures: s.detectionFailures,
        deletedMidReencode: s.deletedMidReencode,
        lastRunHadFailures: s.lastRunHadFailures,
        lastRunNoCandidates: s.lastRunNoCandidates,
    };
}

async function acquireBackfillLock(): Promise<PoolConnection | null> {
    const lockConn = await connection.getConnection();
    try {
        // Non-blocking: 0-second timeout. If the lock is held, return null
        // immediately so the caller can surface "already running" without
        // queueing a hidden second invocation that would block for hours.
        const [rows] = await lockConn.query<(RowDataPacket & { acquired: unknown })[]>(
            'SELECT GET_LOCK(?, 0) AS acquired',
            [LOCK_COLOR_PIPELINE_BACKFILL],
        );
        if (isAdvisoryLockAcquired(rows[0]?.acquired)) {
            return lockConn;
        }
        lockConn.release();
        return null;
    } catch (err) {
        lockConn.release();
        throw err;
    }
}

async function releaseBackfillLock(lockConn: PoolConnection | null) {
    if (!lockConn) return;
    // C7-02 (run-10 cycle 7b): the previous catch-and-release-anyway shape
    // could return a connection that STILL HOLDS the global backfill lock to
    // the pool, making every future in-app backfill return `already_running`
    // until process restart. The shared helper destroys the connection on a
    // failed RELEASE_LOCK instead (and never throws).
    await releasePooledAdvisoryLocks(lockConn, [LOCK_COLOR_PIPELINE_BACKFILL], 'color pipeline backfill');
}

// TRC-R5C2-01 (AGG-R5C2-08): per-image processing claim. The runner re-encodes
// `processed = TRUE` rows, which the live PQueue worker normally never touches
// (it only claims `processed = FALSE`). But `retryFailedImage` can re-enqueue a
// processed row, and the queue worker claims the SAME `gallerykit:image-processing:{id}`
// advisory lock before encoding. Acquiring that lock here (non-blocking, 0-second
// timeout — identical semantics to image-queue.ts:193) means the backfill SKIPS a
// row that the queue worker is actively re-encoding rather than racing it into a
// double-encode / interleaved-write of the same derivative files.
async function acquireImageProcessingClaim(imageId: number): Promise<PoolConnection | null> {
    const lockConn = await connection.getConnection();
    try {
        const [rows] = await lockConn.query<(RowDataPacket & { acquired: unknown })[]>(
            'SELECT GET_LOCK(?, 0) AS acquired',
            [getImageProcessingLockName(imageId)],
        );
        if (isAdvisoryLockAcquired(rows[0]?.acquired)) {
            return lockConn;
        }
    } catch (err) {
        lockConn.release();
        throw err;
    }
    lockConn.release();
    return null;
}

async function releaseImageProcessingClaim(imageId: number, lockConn: PoolConnection | null) {
    if (!lockConn) return;
    // C7-02 (run-10 cycle 7b): destroy-don't-release on a failed RELEASE_LOCK
    // so the per-image claim cannot leak onto a live pooled session (which
    // would permanently block this image's reprocessing). Never throws.
    await releasePooledAdvisoryLocks(
        lockConn,
        [getImageProcessingLockName(imageId)],
        `backfill image processing claim ${imageId}`,
    );
}

async function fetchCandidateCount(): Promise<number> {
    const result = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM images
        WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < ${IMAGE_PIPELINE_VERSION})
    `);
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as unknown as Array<{ cnt: number | bigint | string }>;
    if (!rows[0]) return 0;
    return Number(rows[0].cnt);
}

// PERF-R5C1-01: keyset-paginated batch fetch — mirrors backfill-color-pipeline.ts.
// Each call returns at most BATCH_SIZE rows with id > cursor, ordered ASC.
// Processing each batch through PQueue before fetching the next keeps memory
// residency O(batch) rather than O(gallery).
const BATCH_SIZE = 100;

async function fetchCandidateBatch(cursor: number): Promise<CandidateRow[]> {
    // ARCH-R5C2-04: this per-batch re-query intentionally REPLACES the old
    // start-of-run candidate snapshot. There is no frozen ID list; each batch
    // re-evaluates `pipeline_version < CURRENT` against live data. Correctness of
    // that non-snapshot design rests on two invariants:
    //   (a) the `gallerykit_color_pipeline_backfill` advisory lock serializes
    //       backfills, so no concurrent backfill is advancing pipeline_version on
    //       rows this run still expects to see; and
    //   (b) fresh uploads land at pipeline_version = CURRENT (set by the upload /
    //       queue path), so a newly-uploaded image is NEVER a candidate and can
    //       never appear mid-run to shift the keyset window.
    // Together they guarantee the keyset walk visits every stale row exactly once
    // and terminates, even though the candidate set is re-read every batch.
    const result = await db.execute(sql`
        SELECT id, filename_original, filename_avif, filename_webp, filename_jpeg,
               icc_profile_name, color_primaries, width
        FROM images
        WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < ${IMAGE_PIPELINE_VERSION})
          AND id > ${cursor}
        ORDER BY id ASC
        LIMIT ${BATCH_SIZE}
    `);
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as unknown as CandidateRow[];
    return rows;
}

// AGG-R5C2-10 (COR-R5C2-01/-02): discriminated result so the runner loop can
// tally WHY a row did not get a version bump, instead of swallowing every
// early-return into an undifferentiated "processed" count. Each `ok: false`
// reason maps 1:1 to a real early-return path below.
type ReprocessResult =
    | { ok: true }
    | { ok: false; reason: 'missing-original' | 'locked' | 'encode-failed' | 'detection-failed' | 'deleted-mid-reencode'; error?: unknown };

// AGG-R8c3-03 (run-8 c3): when the version-bump UPDATE matches 0 rows the image
// was deleted DURING this re-encode (deleteImage does NOT hold the per-image
// processing lock the backfill claims, so a concurrent delete unlinks the old
// files while we are mid-encode, then our processImageFormats re-materializes
// fresh derivatives — orphaning them for a row that no longer exists). Mirror
// the upload queue worker's behavior (image-queue.ts: affectedRows===0 →
// cleanup) by removing the just-written variant files. Pass [] sizes so the
// directory scan removes ALL size variants we may have written, not only the
// current config's sizes.
async function cleanupDeletedMidReencodeVariants(row: CandidateRow): Promise<void> {
    await Promise.all([
        deleteImageVariants(UPLOAD_DIR_WEBP, row.filename_webp, []),
        deleteImageVariants(UPLOAD_DIR_AVIF, row.filename_avif, []),
        deleteImageVariants(UPLOAD_DIR_JPEG, row.filename_jpeg, []),
    ]).catch((err) => {
        // Best-effort, like deleteImage's own cleanup — log but don't throw,
        // so a stray unlink failure doesn't escalate to a fatal per-row error.
        console.warn(`[admin-backfill] id=${row.id} deleted-mid-reencode variant cleanup incomplete:`, err);
    });
}

async function imageRowStillExists(id: number): Promise<boolean> {
    const result = await db.execute(sql`SELECT id FROM images WHERE id = ${id} LIMIT 1`);
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
}

async function cleanupIfUpdateMissedDeletedRow(
    updateResult: unknown,
    row: CandidateRow,
): Promise<boolean> {
    if ((updateResult as { affectedRows?: number } | undefined)?.affectedRows !== 0) {
        return false;
    }

    // MySQL's default affectedRows for UPDATE is changed rows, not matched rows.
    // A same-value re-encode update can report 0 while the image still exists, so
    // only treat it as deleted-mid-reencode after a fresh existence probe.
    if (await imageRowStillExists(row.id)) {
        return false;
    }

    await cleanupDeletedMidReencodeVariants(row);
    return true;
}

async function reprocessOne(row: CandidateRow, settings: RunnerSettings): Promise<ReprocessResult> {
    const originalPath = await resolveOriginalUploadPath(row.filename_original);
    if (!originalPath) {
        return { ok: false, reason: 'missing-original' };
    }
    try {
        await fs.access(originalPath);
    } catch {
        // Original missing — skip silently. The companion script does the same.
        return { ok: false, reason: 'missing-original' };
    }

    // AGG-R8-09 (run-8 c2): re-validate the stored source width BEFORE the
    // re-encode (mirrors the upload path's process-image.ts dimension guard). A
    // legacy/corrupt row with width <= 0 would otherwise reach
    // processImageFormats and surface as an OPAQUE Sharp `.resize({width:0})`
    // throw counted as a generic `encode-failed`. We still classify it as
    // `encode-failed` (so it is idempotent — NO version bump — and stays a
    // candidate for a future run after the row is repaired), but log it
    // distinctly so an operator can tell a bad-metadata row apart from a real
    // encode failure. width is NOT NULL in schema; this is a defensive guard
    // against pre-validation legacy data, not an expected path.
    if (!Number.isFinite(row.width) || row.width <= 0) {
        console.error(
            `[admin-backfill] id=${row.id} skipped: invalid stored source width (${row.width}). ` +
            `Row needs metadata repair before it can be re-encoded; left at its current pipeline_version for a later run.`,
        );
        return { ok: false, reason: 'encode-failed' };
    }

    // ── LOCK-CRITICAL (AGG-R5C3-17) ──────────────────────────────────────────
    // TRC-R5C2-01: claim the per-image processing lock for the FULL re-encode +
    // detection + UPDATE window. If the live queue worker (or a concurrent
    // retryFailedImage) holds it, skip this row — no version bump, so it stays a
    // candidate for the next run. The acquire and the protected `try` below are
    // deliberately adjacent: nothing may run between a successful acquire and the
    // `try` whose `finally` releases the lock, or a throw there would leak the
    // claim connection. Released in `finally` after the DB UPDATE.
    //
    // AGG-R5C3-05: acquireImageProcessingClaim may throw if the shared pool is
    // exhausted (getConnection() rejects). Treat that exactly like a held lock —
    // a `locked` skip with NO version bump — so a saturated pool degrades into
    // "retry this row next run" instead of escaping to the queue task's
    // catch-and-increment, which would tight-loop errors++ with no backoff under
    // sustained exhaustion.
    let claimConn: PoolConnection | null;
    try {
        claimConn = await acquireImageProcessingClaim(row.id);
    } catch (err) {
        console.warn(`[admin-backfill] id=${row.id} claim acquire failed (pool exhausted?):`, err);
        return { ok: false, reason: 'locked', error: err };
    }
    if (!claimConn) {
        return { ok: false, reason: 'locked' };
    }

    try {
        let wasDownscaled = false;
        let avif10bit = false;
        try {
            const result = await processImageFormats(
                originalPath,
                row.filename_webp,
                row.filename_avif,
                row.filename_jpeg,
                row.width,
                settings.quality,
                settings.sizes,
                row.icc_profile_name,
                settings.forceSrgbDerivatives,
                row.color_primaries ? { colorPrimaries: row.color_primaries } : null,
                settings.wideGamutJpegChroma,
                settings.avifEffort,
                settings.sdrJpegChroma,
                settings.wideGamutMaxSourcePixels,
            );
            wasDownscaled = result.wasDownscaled;
            avif10bit = result.avif10bit;
        } catch (err) {
            console.error(`[admin-backfill] id=${row.id} encode failed:`, err);
            const stillExists = await imageRowStillExists(row.id).catch((existsErr) => {
                console.warn(`[admin-backfill] id=${row.id} could not verify row existence after encode failure:`, existsErr);
                return true;
            });
            if (!stillExists) {
                await cleanupDeletedMidReencodeVariants(row);
                return { ok: false, reason: 'deleted-mid-reencode' };
            }
            return { ok: false, reason: 'encode-failed', error: err };
        }

        // Re-detect color signals from the original so DB columns stay in sync
        // with the current detection logic (mirrors backfill-color-pipeline.ts).
        let signals: {
            icc_profile_name: string | null;
            color_primaries: string | null;
            transfer_function: string | null;
            matrix_coefficients: string | null;
            is_hdr: boolean;
            has_gain_map: boolean;
            color_pipeline_decision: string | null;
        } | null = null;
        let detectionError: unknown = null;
        try {
            const image = sharp(originalPath, {
                limitInputPixels: MAX_INPUT_PIXELS,
                failOn: 'error',
                sequentialRead: true,
            });
            const metadata = await image.metadata();
            const detected = await detectColorSignals(originalPath, image, metadata);
            signals = {
                icc_profile_name: detected.iccProfileName,
                color_primaries: detected.colorPrimaries,
                transfer_function: detected.transferFunction,
                matrix_coefficients: detected.matrixCoefficients,
                is_hdr: detected.isHdr,
                has_gain_map: detected.hasGainMap,
                color_pipeline_decision: resolveColorPipelineDecision(detected.iccProfileName, detected),
            };
        } catch (err) {
            detectionError = err;
            console.warn(`[admin-backfill] id=${row.id} detection failed:`, err);
        }

        if (signals) {
            const [updateResult] = await db.execute(sql`
                UPDATE images SET
                    pipeline_version = ${IMAGE_PIPELINE_VERSION},
                    icc_profile_name = ${signals.icc_profile_name ?? null},
                    color_primaries = ${signals.color_primaries ?? null},
                    transfer_function = ${signals.transfer_function ?? null},
                    matrix_coefficients = ${signals.matrix_coefficients ?? null},
                    is_hdr = ${signals.is_hdr},
                    has_gain_map = ${signals.has_gain_map},
                    color_pipeline_decision = ${signals.color_pipeline_decision ?? null},
                    was_downscaled = ${wasDownscaled},
                    avif_10bit = ${avif10bit},
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ${row.id}
            `);
            // C76-01: affectedRows can be 0 for same-value updates on live rows;
            // cleanup only when a follow-up existence probe confirms deletion.
            if (await cleanupIfUpdateMissedDeletedRow(updateResult, row)) {
                return { ok: false, reason: 'deleted-mid-reencode' };
            }
            return { ok: true };
        }

        // R-run2c1 AGG-01: detection failed but encode succeeded. Do NOT
        // advance pipeline_version — the re-encode is idempotent, so leaving
        // the row behind the current version lets a later backfill retry
        // detection and recover the (now stale) color columns. Previously
        // this branch bumped pipeline_version, which permanently stranded the
        // row's color metadata: candidate selection is `pipeline_version <
        // CURRENT`, so a bumped row is NEVER re-picked, contradicting the
        // "pick up where it left off" resume contract documented in this
        // file's header. The operator script (backfill-color-pipeline.ts)
        // already has the correct semantics (no version bump on detection
        // failure); this aligns the in-app runner with it. We still persist
        // the freshly-encoded derivatives' was_downscaled / avif_10bit so
        // those public-facing fields reflect the new bytes even while the
        // color columns await a successful detection retry.
        const [updateResult] = await db.execute(sql`
            UPDATE images SET
                was_downscaled = ${wasDownscaled},
                avif_10bit = ${avif10bit},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${row.id}
        `);
        // AGG-R8c3-03/C76-01: the encode succeeded and wrote derivatives even
        // though detection failed. If the row is confirmed gone, clean those
        // files; if the row still exists and the UPDATE was a same-value no-op,
        // keep the derivatives and report detection-failed so the row retries.
        if (await cleanupIfUpdateMissedDeletedRow(updateResult, row)) {
            return { ok: false, reason: 'deleted-mid-reencode' };
        }
        return { ok: false, reason: 'detection-failed', error: detectionError };
    } finally {
        // Release the per-image claim AFTER the DB UPDATE so the lock window
        // covers the whole re-encode→detect→persist sequence.
        await releaseImageProcessingClaim(row.id, claimConn).catch(() => undefined);
    }
}

async function runBackfill(lockConn: PoolConnection): Promise<void> {
    // R29-CRIT-1: every state mutation, config read, and queue construction
    // lives INSIDE the try block so the finally clause is the single
    // release point for the in-process `running` flag, the MySQL advisory
    // lock, and the lock connection itself.
    //
    // PERF-R5C1-01: batched keyset-paginated fetch. Each batch of at most
    // BATCH_SIZE rows is enqueued and drained through PQueue before the next
    // batch is fetched, keeping memory residency O(batch) not O(gallery).
    const state = getState();
    try {
        state.running = true;
        // AGG-R5C2-10: reset the per-run observability tallies at the start of
        // every run so the surfaced counters reflect THIS run, not a sum across
        // runs (which would be misleading for the admin status disclosure).
        // AGG-1 (run-6 c1): processed + errors are reset here too so the admin
        // sees THIS run's real successful count and fatal-error count, not a
        // stale carry-over or a snapshot-derived reconstruction.
        resetPerRunCounters(state, state.lastQueuedCount);
        // C3-04 (run-10 c3, ARCH3-02/VER3-03): runBackfill is launched
        // DETACHED (fire-and-forget from the admin action), outside any
        // request store — the request-cached accessor can memoize across
        // runs there, re-encoding at STALE settings after an admin flips a
        // color/quality key. Same invariant as image-queue's three detached
        // call sites (02bea8d6); pinned by
        // detached-uncached-config-wiring.test.ts.
        const config = await getGalleryConfigDetached();
        const settings: RunnerSettings = {
            quality: {
                webp: config.imageQualityWebp,
                avif: config.imageQualityAvif,
                jpeg: config.imageQualityJpeg,
            },
            sizes: config.imageSizes,
            forceSrgbDerivatives: config.forceSrgbDerivatives,
            wideGamutJpegChroma: config.wideGamutJpegChroma,
            avifEffort: config.avifEffort,
            sdrJpegChroma: config.sdrJpegChroma,
            wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
        };

        // AGG-R5C3-05: clamp the requested concurrency to the pool-budget cap so
        // this background op cannot pin the whole shared connection pool and 500
        // live traffic. See resolveBackfillConcurrency for the arithmetic.
        const requestedConcurrency = Number(process.env.ADMIN_BACKFILL_CONCURRENCY) || 1;
        const concurrency = resolveBackfillConcurrency(requestedConcurrency);
        if (concurrency < Math.max(1, Math.floor(requestedConcurrency) || 1)) {
            console.warn(
                `[admin-backfill] ADMIN_BACKFILL_CONCURRENCY=${requestedConcurrency} exceeds the ` +
                    `pool-budget cap; clamped to ${concurrency} (pool limit ${POOL_CONNECTION_LIMIT}).`,
            );
        }
        const queue = new PQueue({ concurrency });

        let processed = 0;
        let errors = 0;
        // AGG-R5C2-10 observability tallies — written through to `state` so the
        // admin status disclosure can surface them. `skipped` is the sum of the
        // two skip reasons (missing original + locked) for the human-readable log.
        let skippedMissingOriginal = 0;
        let skippedLocked = 0;
        let encodeFailures = 0;
        let detectionFailures = 0;
        let deletedMidReencode = 0;
        let cursor = 0;

        for (;;) {
            if (isRestoreMaintenanceActive()) {
                console.info('[admin-backfill] Restore maintenance detected — aborting batch loop.');
                break;
            }
            const batch = await fetchCandidateBatch(cursor);
            if (batch.length === 0) break;

            for (const row of batch) {
                queue.add(async () => {
                    if (isRestoreMaintenanceActive()) {
                        return;
                    }
                    try {
                        const result = await reprocessOne(row, settings);
                        if (result.ok) {
                            processed++;
                        } else {
                            switch (result.reason) {
                                case 'missing-original':
                                    skippedMissingOriginal++;
                                    break;
                                case 'locked':
                                    skippedLocked++;
                                    break;
                                case 'encode-failed':
                                    encodeFailures++;
                                    // Surface the encode failure for the admin UI
                                    // (COR-R5C2-02) — these rows keep their stale
                                    // pipeline_version and need an operator's eye.
                                    state.lastError =
                                        result.error instanceof Error ? result.error.message : String(result.error);
                                    break;
                                case 'detection-failed':
                                    detectionFailures++;
                                    break;
                                case 'deleted-mid-reencode':
                                    // AGG-R8c3-03: row vanished during re-encode;
                                    // variants cleaned up. Not a success, not a
                                    // failure — its own tally so the counter
                                    // partition (f3667858) stays exact.
                                    deletedMidReencode++;
                                    break;
                            }
                        }
                    } catch (err) {
                        errors++;
                        // AGG-1 (run-6 c1): a fatal per-row error (the version-bump
                        // UPDATE threw) must also populate lastError, not just the
                        // encode-failed branch above. Otherwise a fatal-only run
                        // surfaces the with-failures banner with NO error message —
                        // the admin sees "failures" but no detail. Last-writer-wins
                        // across workers at concurrency>1 (counts stay correct; the
                        // scalar message reflects whichever worker threw last —
                        // documented in AdminBackfillState).
                        state.lastError = err instanceof Error ? err.message : String(err);
                        console.error(`[admin-backfill] id=${row.id} fatal:`, err);
                    }
                    // Mirror the per-run tallies into shared state continuously so a
                    // mid-run status poll sees live progress, not just the final value.
                    state.processed = processed;
                    state.errors = errors;
                    state.skippedMissingOriginal = skippedMissingOriginal;
                    state.skippedLocked = skippedLocked;
                    state.encodeFailures = encodeFailures;
                    state.detectionFailures = detectionFailures;
                    state.deletedMidReencode = deletedMidReencode;
                    const handled =
                        processed + skippedMissingOriginal + skippedLocked + encodeFailures + detectionFailures + deletedMidReencode + errors;
                    if (handled % 25 === 0) {
                        console.info(
                            `[admin-backfill] progress: processed=${processed} errors=${errors} ` +
                                `skippedMissingOriginal=${skippedMissingOriginal} skippedLocked=${skippedLocked} ` +
                                `encodeFailures=${encodeFailures} detectionFailures=${detectionFailures} ` +
                                `deletedMidReencode=${deletedMidReencode}`,
                        );
                    }
                });
            }
            // Drain the batch fully before fetching the next one.
            await queue.onIdle();

            // Advance keyset cursor to the highest id in this batch.
            cursor = batch[batch.length - 1]!.id;

            if (batch.length < BATCH_SIZE) {
                // Last batch — no more rows to fetch.
                break;
            }
        }

        // Final flush of the tallies into shared state (covers the case where the
        // last handled count was not a multiple of 25).
        state.processed = processed;
        state.errors = errors;
        state.skippedMissingOriginal = skippedMissingOriginal;
        state.skippedLocked = skippedLocked;
        state.encodeFailures = encodeFailures;
        state.detectionFailures = detectionFailures;
        state.deletedMidReencode = deletedMidReencode;
        // AGG-R5C3-04: a run is "complete" whether or not rows failed, but the
        // completion signal must distinguish the two. completedRuns increments
        // either way; lastRunHadFailures records whether the run was clean.
        // AGG-R8c3-03: deletedMidReencode is NOT a failure — the row was
        // deliberately deleted concurrently and the orphaned derivatives were
        // cleaned up; it does not need an operator's eye, so it must not flip
        // the WITH-FAILURES banner.
        const hadFailures = encodeFailures > 0 || detectionFailures > 0 || errors > 0;
        state.lastRunHadFailures = hadFailures;
        console.info(
            `[admin-backfill] Run complete ${hadFailures ? 'WITH FAILURES' : '(clean)'}: ` +
                `processed=${processed} errors=${errors} ` +
                `skippedMissingOriginal=${skippedMissingOriginal} skippedLocked=${skippedLocked} ` +
                `encodeFailures=${encodeFailures} detectionFailures=${detectionFailures} ` +
                `deletedMidReencode=${deletedMidReencode}`,
        );
        state.completedRuns++;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        state.lastError = msg;
        console.error('[admin-backfill] Run aborted:', err);
    } finally {
        state.running = false;
        await releaseBackfillLock(lockConn).catch(() => undefined);
    }
}

/**
 * Entry point called by the server action. Returns synchronously with a
 * status that tells the UI what happened; the actual encode work runs
 * fire-and-forget on the event loop.
 */
export async function triggerAdminBackfill(): Promise<AdminBackfillStatus> {
    if (isRestoreMaintenanceActive()) {
        return { status: 'unavailable', reason: 'restore_in_progress' };
    }
    const state = getState();
    if (state.running) {
        // Belt-and-braces: even if the advisory lock could be acquired by a
        // process that just released it, in-process state says we're busy.
        return { status: 'already_running' };
    }
    let lockConn: PoolConnection | null = null;
    try {
        lockConn = await acquireBackfillLock();
        if (!lockConn) {
            return { status: 'already_running' };
        }
        // PERF-R5C1-01: use the count query for the up-front disclosure only.
        // The actual candidate fetch is now batched inside runBackfill.
        const candidateCount = await fetchCandidateCount();
        if (candidateCount === 0) {
            // Nothing to do — record a distinct completed no-candidate state
            // so stale failure/counter state from the previous run cannot
            // survive, without presenting it as a clean re-encode.
            resetPerRunCounters(state, 0);
            state.lastRunNoCandidates = true;
            state.completedRuns++;
            await releaseBackfillLock(lockConn);
            return { status: 'queued', affectedRows: 0 };
        }
        // Store the up-front count for the UI status disclosure.
        state.lastQueuedCount = candidateCount;
        // Hand the lock connection off to the background runner. From this
        // point the runner owns the connection's lifetime and will release
        // both the lock and the connection on completion / failure.
        const lockConnHandoff = lockConn;
        lockConn = null;
        // Fire-and-forget. R29-CRIT-1: the runner now wraps EVERYTHING
        // (state mutation, config read, queue construction, queue drain)
        // inside a single try/finally so the lock + state are always
        // released. The `.catch()` here is belt-and-braces — if the
        // runner ever throws synchronously BEFORE entering its try block
        // (e.g. a `getState()` re-entrancy bug), we swallow the rejection
        // here rather than escalate to an unhandledRejection that newer
        // Node versions will use to terminate the process.
        runBackfill(lockConnHandoff).catch((err) => {
            console.error('[admin-backfill] runner rejected synchronously:', err);
        });
        return { status: 'queued', affectedRows: candidateCount };
    } catch (err) {
        if (lockConn) {
            await releaseBackfillLock(lockConn).catch(() => undefined);
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { status: 'error', reason: msg };
    }
}

/** Cheap synchronous count read for status endpoints / UI polling. */
export async function getAdminBackfillCandidateCount(): Promise<number> {
    return fetchCandidateCount();
}
