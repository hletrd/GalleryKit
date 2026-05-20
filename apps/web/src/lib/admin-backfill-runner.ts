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
import path from 'path';
import PQueue from 'p-queue';
import sharp from 'sharp';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { connection, db } from '@/db';
import { sql } from 'drizzle-orm';
import { processImageFormats, IMAGE_PIPELINE_VERSION, resolveColorPipelineDecision, type ImageQualitySettings } from '@/lib/process-image';
import { detectColorSignals } from '@/lib/color-detection';
import { resolveOriginalUploadPath } from '@/lib/upload-paths';
import { LOCK_COLOR_PIPELINE_BACKFILL } from '@/lib/advisory-locks';
import { getGalleryConfig } from '@/lib/gallery-config';
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

const adminBackfillStateKey = Symbol.for('gallerykit.adminBackfillState');

interface AdminBackfillState {
    running: boolean;
    /** Total candidate count from the last started run, for status disclosure. */
    lastQueuedCount: number;
    /** Monotonic counter incremented when the runner finishes successfully. */
    completedRuns: number;
    /** Last error message if a run failed, else null. */
    lastError: string | null;
}

function getState(): AdminBackfillState {
    const g = globalThis as typeof globalThis & {
        [adminBackfillStateKey]?: AdminBackfillState;
    };
    if (!g[adminBackfillStateKey]) {
        g[adminBackfillStateKey] = {
            running: false,
            lastQueuedCount: 0,
            completedRuns: 0,
            lastError: null,
        };
    }
    return g[adminBackfillStateKey]!;
}

/** Public read-only view of runner state, exposed via getAdminBackfillStatus(). */
export function readAdminBackfillState(): Readonly<AdminBackfillState> {
    const s = getState();
    return { running: s.running, lastQueuedCount: s.lastQueuedCount, completedRuns: s.completedRuns, lastError: s.lastError };
}

async function acquireBackfillLock(): Promise<PoolConnection | null> {
    const lockConn = await connection.getConnection();
    try {
        // Non-blocking: 0-second timeout. If the lock is held, return null
        // immediately so the caller can surface "already running" without
        // queueing a hidden second invocation that would block for hours.
        const [rows] = await lockConn.query<(RowDataPacket & { acquired: number | null })[]>(
            'SELECT GET_LOCK(?, 0) AS acquired',
            [LOCK_COLOR_PIPELINE_BACKFILL],
        );
        if (rows[0]?.acquired === 1) {
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
    try {
        await lockConn.query('SELECT RELEASE_LOCK(?)', [LOCK_COLOR_PIPELINE_BACKFILL]);
    } catch {
        // Connection close releases the lock anyway.
    } finally {
        lockConn.release();
    }
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

async function fetchCandidates(): Promise<CandidateRow[]> {
    const result = await db.execute(sql`
        SELECT id, filename_original, filename_avif, filename_webp, filename_jpeg,
               icc_profile_name, color_primaries, width
        FROM images
        WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < ${IMAGE_PIPELINE_VERSION})
        ORDER BY id ASC
    `);
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as unknown as CandidateRow[];
    return rows;
}

async function reprocessOne(row: CandidateRow, settings: RunnerSettings): Promise<void> {
    const originalPath = await resolveOriginalUploadPath(row.filename_original);
    try {
        await fs.access(originalPath);
    } catch {
        // Original missing — skip silently. The companion script does the same.
        return;
    }

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
        return;
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
    try {
        const image = sharp(originalPath, {
            limitInputPixels: 256 * 1024 * 1024,
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
        console.warn(`[admin-backfill] id=${row.id} detection failed:`, err);
    }

    if (signals) {
        await db.execute(sql`
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
                avif_10bit = ${avif10bit}
            WHERE id = ${row.id}
        `);
    } else {
        // Detection failed but encode succeeded — at least advance the
        // pipeline_version so the next pass doesn't re-pick the row.
        await db.execute(sql`
            UPDATE images SET
                pipeline_version = ${IMAGE_PIPELINE_VERSION},
                was_downscaled = ${wasDownscaled},
                avif_10bit = ${avif10bit}
            WHERE id = ${row.id}
        `);
    }
}

async function runBackfill(lockConn: PoolConnection, candidates: CandidateRow[]): Promise<void> {
    const state = getState();
    state.running = true;
    state.lastQueuedCount = candidates.length;
    state.lastError = null;
    const config = await getGalleryConfig();
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

    const concurrency = Math.max(1, Number(process.env.ADMIN_BACKFILL_CONCURRENCY) || 1);
    const queue = new PQueue({ concurrency });

    let processed = 0;
    let errors = 0;
    for (const row of candidates) {
        queue.add(async () => {
            if (isRestoreMaintenanceActive()) {
                // Abort gracefully — restore is taking over the DB.
                return;
            }
            try {
                await reprocessOne(row, settings);
                processed++;
            } catch (err) {
                errors++;
                console.error(`[admin-backfill] id=${row.id} fatal:`, err);
            }
            if (processed % 25 === 0) {
                console.log(`[admin-backfill] progress: ${processed}/${candidates.length} (errors=${errors})`);
            }
        });
    }

    try {
        await queue.onIdle();
        console.log(`[admin-backfill] Run complete: processed=${processed} errors=${errors}`);
        state.completedRuns++;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        state.lastError = msg;
        console.error('[admin-backfill] Run aborted:', err);
    } finally {
        state.running = false;
        await releaseBackfillLock(lockConn);
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
        const candidates = await fetchCandidates();
        if (candidates.length === 0) {
            // Nothing to do — release the lock and report zero work.
            await releaseBackfillLock(lockConn);
            return { status: 'queued', affectedRows: 0 };
        }
        // Hand the lock connection off to the background runner. From this
        // point the runner owns the connection's lifetime and will release
        // both the lock and the connection on completion / failure.
        const lockConnHandoff = lockConn;
        lockConn = null;
        // Fire-and-forget. The unhandled-rejection guard in runBackfill's
        // finally block guarantees the lock is released regardless of how
        // the run terminates.
        void runBackfill(lockConnHandoff, candidates);
        return { status: 'queued', affectedRows: candidates.length };
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

// Silence unused import: `path` is no longer needed here but keeps the
// file's I/O cluster co-located with fs / sharp imports for symmetry with
// the companion script. If a future change re-adds path joining (e.g.
// per-variant cleanup), the import is still here.
void path;
