/**
 * backfill-color-pipeline.ts
 *
 * One-shot operator script — NOT run automatically. Invoke manually:
 *
 *   cd apps/web && npx tsx scripts/backfill-color-pipeline.ts
 *
 * What it does
 * ────────────
 * Re-processes existing images that were encoded with a pipeline version
 * older than IMAGE_PIPELINE_VERSION (currently 7). For each candidate:
 *   - fetches the stored original,
 *   - re-runs processImageFormats() with the current encoder settings
 *     (P3-from-wide mapping, toColorspace + withIccProfile, autoOrient),
 *   - re-runs detectColorSignals() on the original to refresh DB color columns,
 *   - updates pipeline_version + color columns atomically on success.
 *
 * Idempotency
 * ───────────
 * Images with pipeline_version >= 7 are skipped by default. Re-running after
 * a successful pass is a no-op (all rows already at version 7).
 *
 * The serve-upload route emits an ETag containing IMAGE_PIPELINE_VERSION
 * (CM-HIGH-5), so once an image is reprocessed any cached client copy
 * will revalidate against the new ETag and re-fetch automatically.
 *
 * Concurrency is capped at BACKFILL_CONCURRENCY (default 2, max 8) to avoid
 * starving the live web process during long re-runs.
 *
 * Advisory lock
 * ─────────────
 * Uses MySQL GET_LOCK so two concurrent backfill invocations cannot race the
 * same rows. The sidecar waits briefly, then exits non-zero if another full
 * run is still active. The lock is released automatically when the dedicated
 * connection closes.
 *
 * The sidecar and in-app runner both acquire the same
 * `gallerykit_color_pipeline_backfill` advisory lock, so full backfill runs
 * are mutually exclusive. Per-image retry actions use their own
 * `gallerykit:image-processing:{id}` claims instead of the global backfill lock.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs/promises';
import PQueue from 'p-queue';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import sharp from 'sharp';
import { processImageFormats, IMAGE_PIPELINE_VERSION, MAX_INPUT_PIXELS, resolveColorPipelineDecision, deleteImageVariants, type ImageQualitySettings } from '../src/lib/process-image';
import { detectColorSignals } from '../src/lib/color-detection';
import { resolveOriginalUploadPath, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '../src/lib/upload-paths';
import { LOCK_COLOR_PIPELINE_BACKFILL, getImageProcessingLockName, isAdvisoryLockAcquired } from '../src/lib/advisory-locks';
import { destroyPooledAdvisoryLockConnectionOnAcquireError, releasePooledAdvisoryLocks } from '../src/lib/advisory-lock-release';
import { parseBoundedPositiveInteger } from '../src/lib/env';
import { getGalleryConfigDetachedStrict } from '../src/lib/gallery-config';
import type { JpegChromaSubsampling } from '../src/lib/gallery-config-shared';
import { assertNoDurableRestoreMaintenanceForScript } from '../src/lib/restore-maintenance-durable';

const SCRIPT_NAME = 'backfill-color-pipeline';

// ---------------------------------------------------------------------------
// Minimal type for DB rows we need
// ---------------------------------------------------------------------------

export interface ImageRow {
    id: number;
    filename_original: string;
    filename_avif: string;
    filename_webp: string;
    filename_jpeg: string;
    icc_profile_name: string | null;
    color_primaries: string | null;
    width: number;
}

interface ReprocessSignals {
    icc_profile_name: string | null;
    color_primaries: string | null;
    transfer_function: string | null;
    matrix_coefficients: string | null;
    is_hdr: boolean;
    has_gain_map: boolean;
    color_pipeline_decision: string | null;
    was_downscaled: boolean;
    // Run-2 Cycle 1 AGG-02: the re-encode can flip the delivered AVIF bit
    // depth (10-bit vs 8-bit) when libheif/effort/settings change. avif_10bit
    // is a PUBLIC field (delivered-bit-depth chip), and both the normal
    // upload path (image-queue.ts) and the in-app runner persist it. This
    // script must too, or a sidecar backfill leaves the public value stale.
    avif_10bit: boolean;
}

/**
 * Run-2 Cycle 2 AGG2-01: derivative-only columns persisted when the re-encode
 * succeeds but color detection THROWS. We refresh the public `avif_10bit`
 * (delivered-bit-depth chip) and admin-only `was_downscaled` to match the fresh
 * bytes, but deliberately leave `pipeline_version` and the color columns
 * untouched so a later run re-detects (preserving the cycle-1 AGG-01 resume
 * invariant). This mirrors `admin-backfill-runner.ts:268-273` so both backfill
 * paths persist the SAME columns on the detection-failure branch — previously
 * the runner wrote these two columns here while the script wrote nothing,
 * leaving the public `avif_10bit` value stale after a sidecar backfill.
 */
interface ReprocessDerivativeOnly {
    was_downscaled: boolean;
    avif_10bit: boolean;
}

interface ReprocessResult {
    outcome: 'processed' | 'skipped' | 'error' | 'deleted-mid-reencode';
    signals?: ReprocessSignals;
    /** Set ONLY on the detection-failure branch (encode ok, detection threw). */
    derivativeOnly?: ReprocessDerivativeOnly;
}

/** Per-format derivative filenames for a single image row. */
export type BatchFilenames = { filename_webp: string; filename_avif: string; filename_jpeg: string };

/**
 * AGG-C5-01 (run-9 c2): the delete-mid-reencode orphan-cleanup, extracted to a
 * module-level export so the production sidecar's `affectedRows===0` cleanup
 * contract is unit-testable in isolation (the in-`main` `flushBatch` is a closure
 * and cannot be reached from a test). Uses the full-directory-scan ({size}=[])
 * form so EVERY variant is removed regardless of the configured size list —
 * identical contract to admin-backfill-runner.ts's
 * cleanupDeletedMidReencodeVariants. ENOENT-tolerant via deleteImageVariants.
 */
export async function cleanupDeletedMidReencodeVariants(files: BatchFilenames): Promise<void> {
    const settled = await Promise.allSettled([
        deleteImageVariants(UPLOAD_DIR_WEBP, files.filename_webp, []),
        deleteImageVariants(UPLOAD_DIR_AVIF, files.filename_avif, []),
        deleteImageVariants(UPLOAD_DIR_JPEG, files.filename_jpeg, []),
    ]);
    for (const result of settled) {
        if (result.status === 'rejected') {
            console.warn(
                '[backfill-color-pipeline] Failed to clean deleted-mid-reencode derivative:',
                result.reason,
            );
        }
    }
}

function rowFilenames(row: ImageRow): BatchFilenames {
    return {
        filename_webp: row.filename_webp,
        filename_avif: row.filename_avif,
        filename_jpeg: row.filename_jpeg,
    };
}

/**
 * AGG-C5-01/C76-01: pure decision helper — given each batched UPDATE's
 * affectedRows, confirmed row-existence state, and per-row filenames, return the
 * files whose row was deleted mid-reencode and must have their just-written
 * derivatives cleaned up. MySQL affectedRows counts changed rows by default, so
 * affectedRows===0 is not enough; the caller must confirm the row is absent.
 */
export function collectDeletedMidReencodeFiles(
    results: { affectedRows: number; rowStillExists: boolean; files: BatchFilenames }[],
): BatchFilenames[] {
    return results
        .filter((r) => r.affectedRows === 0 && !r.rowStillExists)
        .map((r) => r.files);
}

export async function confirmBackfillUpdateResults(
    results: { id: number; affectedRows: number; files: BatchFilenames }[],
    rowExists: (id: number) => Promise<boolean>,
): Promise<{ id: number; affectedRows: number; files: BatchFilenames; rowStillExists: boolean }[]> {
    return Promise.all(results.map(async (result) => ({
        ...result,
        rowStillExists: result.affectedRows === 0 ? await rowExists(result.id) : true,
    })));
}

/**
 * AGG-C4-04 (run-6 cycle-4, tracer TRC-C4-01): of the detection-failure rows in
 * a batch (the `derivativeBatch` entries — the ones that incremented
 * `detectionFailures`), count how many were actually deleted mid-reencode. Those
 * rows no longer exist, so they must NOT keep `detectionFailures` elevated.
 * A zero changed-row update on a still-existing row is not deleted; keep it
 * counted as a detection failure so a later run retries color metadata.
 */
export function countDeletedMidReencodeDetectionFailures(
    derivativeResults: { affectedRows: number; rowStillExists: boolean }[],
): number {
    return derivativeResults.filter((r) => r.affectedRows === 0 && !r.rowStillExists).length;
}

/**
 * AGG-C4-03 (run-6 cycle-4, TE-C4-03): the sidecar's process exit code is the
 * entire point of the AGG-C3-04 fix, yet `main()`'s exit-code expression was
 * untested. Extracted as a pure helper so the matrix is unit-testable. Exits
 * non-zero on hard errors OR on detection failures (re-encoded but color
 * detection threw, so pipeline_version was deliberately NOT advanced and the
 * rows remain backfill candidates) — a CI/cron wrapper keying on the exit code
 * can then distinguish a clean run from one that left color metadata stale.
 */
export function computeBackfillExitCode(counts: { errors: number; detectionFailures: number }): 0 | 1 {
    return counts.errors > 0 || counts.detectionFailures > 0 ? 1 : 0;
}

interface BackfillSettings {
    quality: ImageQualitySettings;
    sizes: number[];
    forceSrgbDerivatives: boolean;
    wideGamutJpegChroma: JpegChromaSubsampling;
    avifEffort: number;
    sdrJpegChroma: JpegChromaSubsampling;
    wideGamutMaxSourcePixels: number;
}

// ---------------------------------------------------------------------------
// Single-row reprocessor — exported for unit tests.
// ---------------------------------------------------------------------------

export async function reprocessRow(
    row: ImageRow,
    settings?: BackfillSettings,
    rowExists?: (id: number) => Promise<boolean>,
): Promise<ReprocessResult> {
    const originalPath = await resolveOriginalUploadPath(row.filename_original);
    if (!originalPath) {
        return { outcome: 'skipped' };
    }
    try {
        await fs.access(originalPath);
    } catch {
        return { outcome: 'skipped' };
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
            settings?.quality,
            settings?.sizes,
            row.icc_profile_name,
            settings?.forceSrgbDerivatives,
            row.color_primaries ? { colorPrimaries: row.color_primaries } : null,
            settings?.wideGamutJpegChroma,
            settings?.avifEffort,
            settings?.sdrJpegChroma,
            settings?.wideGamutMaxSourcePixels,
            { assertWritable: () => assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME) },
        );
        wasDownscaled = result.wasDownscaled;
        // AGG-02: capture the delivered AVIF bit depth so the UPDATE below
        // refreshes the public avif_10bit column to match the new bytes.
        avif10bit = result.avif10bit;
    } catch (err) {
        console.error(`  [error] id=${row.id}: ${err}`);
        if (rowExists) {
            const stillExists = await rowExists(row.id).catch((existsErr) => {
                console.warn(`  [warn] id=${row.id}: could not verify row existence after encode failure: ${existsErr}`);
                return true;
            });
            if (!stillExists) {
                await cleanupDeletedMidReencodeVariants(rowFilenames(row));
                return { outcome: 'deleted-mid-reencode' };
            }
        }
        return { outcome: 'error' };
    }

    // R7-M4: re-run color detection after successful re-encode so DB color
    // columns stay in sync with the current detection logic.
    try {
        const image = sharp(originalPath, {
            limitInputPixels: MAX_INPUT_PIXELS,
            failOn: 'error',
            sequentialRead: true,
        });
        const metadata = await image.metadata();
        const signals = await detectColorSignals(originalPath, image, metadata);
        const colorPipelineDecision = resolveColorPipelineDecision(signals.iccProfileName, signals);
        return {
            outcome: 'processed',
            signals: {
                icc_profile_name: signals.iccProfileName,
                color_primaries: signals.colorPrimaries,
                transfer_function: signals.transferFunction,
                matrix_coefficients: signals.matrixCoefficients,
                is_hdr: signals.isHdr,
                has_gain_map: signals.hasGainMap,
                color_pipeline_decision: colorPipelineDecision,
                was_downscaled: wasDownscaled,
                avif_10bit: avif10bit,
            },
        };
    } catch (err) {
        // Detection failed but encoding succeeded. AGG2-01: persist the
        // freshly-encoded derivative columns (was_downscaled, avif_10bit)
        // WITHOUT advancing pipeline_version, so the public avif_10bit chip
        // reflects the new bytes and the row stays a backfill candidate for a
        // later detection retry. Mirrors admin-backfill-runner.ts:268-273.
        console.warn(`  [warn] id=${row.id}: detection failed after re-encode: ${err}`);
        return {
            outcome: 'processed',
            derivativeOnly: { was_downscaled: wasDownscaled, avif_10bit: avif10bit },
        };
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const BATCH_SIZE = 100;

async function acquireImageProcessingClaim(
    connection: { getConnection: () => Promise<PoolConnection> },
    imageId: number,
): Promise<PoolConnection | null> {
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
        destroyPooledAdvisoryLockConnectionOnAcquireError(lockConn, `sidecar image processing claim ${imageId}`, err);
        throw err;
    }
    lockConn.release();
    return null;
}

async function releaseImageProcessingClaim(imageId: number, lockConn: PoolConnection | null) {
    if (!lockConn) return;
    await releasePooledAdvisoryLocks(
        lockConn,
        [getImageProcessingLockName(imageId)],
        `sidecar image processing claim ${imageId}`,
    );
}

async function main() {
    const forceReencode = process.argv.includes('--force-reencode');

    assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);

    const { db, connection } = await import('../src/db');
    const { sql } = await import('drizzle-orm');

    console.log('[backfill-color-pipeline] Acquiring advisory lock…');

    // Acquire a dedicated connection for the advisory lock.
    // GET_LOCK scope is connection-bound; releasing the connection
    // automatically releases the lock on MySQL close.
    const lockConn = await connection.getConnection();
    let lockAcquired = false;
    try {
        const [lockRows] = await lockConn.query<(RowDataPacket & { acquired: unknown })[]>(
            'SELECT GET_LOCK(?, 10) AS acquired',
            [LOCK_COLOR_PIPELINE_BACKFILL],
        );
        lockAcquired = isAdvisoryLockAcquired(lockRows[0]?.acquired);
    } catch (err) {
        console.error('[backfill-color-pipeline] Advisory lock query failed:', err);
        lockConn.release();
        process.exit(1);
    }

    if (!lockAcquired) {
        console.error('[backfill-color-pipeline] Another backfill is already running. Exiting.');
        lockConn.release();
        process.exit(1);
    }

    assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);

    // R8-CRIT: resolve current admin settings while holding the shared
    // backfill lock so an admin settings save cannot commit between the
    // snapshot and the re-encode work. This mirrors the in-app runner.
    const config = await getGalleryConfigDetachedStrict();
    const backfillSettings: BackfillSettings = {
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

    console.log('[backfill-color-pipeline] Lock acquired. Fetching candidate rows…');
    assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);

    // R5-M3: Fetch processed images whose pipeline_version is behind
    // (or NULL). Pipeline version mismatch alone is sufficient to trigger
    // re-encode — a decided row may still have stale encode bytes after a
    // pipeline version bump (new chroma defaults, new effort, new rgb16).
    // --force-reencode bypasses the version check to re-encode ALL processed
    // images regardless of current version.
    let whereClause = sql`processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < ${IMAGE_PIPELINE_VERSION})`;
    if (forceReencode) {
        whereClause = sql`processed = TRUE`;
    }

    const concurrency = parseBoundedPositiveInteger(process.env.BACKFILL_CONCURRENCY, {
        fallback: 2,
        max: 8,
    });
    const queue = new PQueue({ concurrency });
    let skipped = 0;
    let skippedLocked = 0;
    let processed = 0;
    let errors = 0;
    // AGG-C3-04 (CR3-01 / tracer D3): rows whose re-encode SUCCEEDED but whose
    // post-encode color detection THREW — persisted derivative-only WITHOUT a
    // pipeline_version bump (so they remain backfill candidates). Counted as
    // `processed` for the resume contract, but tracked separately so the exit
    // code + summary can distinguish "re-encoded + detection-clean" from
    // "re-encoded but color metadata still stale". Without this an all-detection
    // -failure run exits 0, hiding gallery-wide stale color metadata from a
    // CI/cron wrapper. Mirrors the in-app runner's lastRunHadFailures semantics.
    let detectionFailures = 0;
    // AGG-C4-02: rows whose UPDATE matched 0 rows because the image was deleted
    // mid-reencode. NOT a failure (the image is gone, idempotent retry is moot)
    // and NOT counted as processed — surfaced separately.
    let deletedMidReencode = 0;
    let totalCandidates = 0;
    let lastCandidateId = 0;
    let pageCount = 0;
    const reportEvery = BATCH_SIZE;

    async function fetchCandidatePage(): Promise<ImageRow[]> {
        const rawRows = await db.execute(sql`
            SELECT id, filename_original, filename_avif, filename_webp, filename_jpeg,
                   icc_profile_name, color_primaries, width
            FROM images
            WHERE ${whereClause} AND id > ${lastCandidateId}
            ORDER BY id ASC
            LIMIT ${BATCH_SIZE}
        `);
        // drizzle's mysql2 `db.execute(sql)` returns the underlying mysql2 tuple
        // `[rows, fields]`, not just the row array. Newer drizzle releases or
        // different driver shims may return rows directly. Unwrap defensively
        // so the script works either way — without this guard, iterating
        // produces `[rows, fields]` as two "rows" and every field accessor
        // returns undefined → resolveOriginalUploadPath crashes.
        return (Array.isArray(rawRows) && Array.isArray(rawRows[0])
            ? rawRows[0]
            : rawRows) as unknown as ImageRow[];
    }

    // R7-L8: batch DB updates to reduce round-trips.
    // AGG-C4-02 (run-9 c1 ARCH-R9-01): carry the per-format filenames into each
    // batch item so a row deleted mid-reencode (its UPDATE matches 0 rows) can
    // have its freshly-written derivative files cleaned up — mirroring the
    // affectedRows===0 guard the in-app runner (admin-backfill-runner.ts) and
    // the upload queue (image-queue.ts) already carry. Without this, a delete
    // that races a backfill re-encode of the SAME id (deleteImage does NOT take
    // the per-image processing lock) orphans the just-written variants on disk.
    const updateBatch: { id: number; signals: ReprocessSignals; files: BatchFilenames }[] = [];
    // AGG2-01: detection-failure rows persist only the derivative columns
    // (no pipeline_version bump, no color columns) so they remain backfill
    // candidates for a later detection retry.
    const derivativeBatch: { id: number; derivative: ReprocessDerivativeOnly; files: BatchFilenames }[] = [];

    function pendingUpdates(): number {
        return updateBatch.length + derivativeBatch.length;
    }

    async function rowExists(id: number): Promise<boolean> {
        const raw = await db.execute(sql`SELECT id FROM images WHERE id = ${id} LIMIT 1`);
        const rowsForId = (Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw) as unknown[];
        return Array.isArray(rowsForId) && rowsForId.length > 0;
    }

    async function flushBatch(): Promise<void> {
        if (pendingUpdates() === 0) return;
        assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);
        const items = updateBatch.splice(0, updateBatch.length);
        const derivativeItems = derivativeBatch.splice(0, derivativeBatch.length);
        // Collect rows whose UPDATE matched 0 rows (deleted mid-reencode). The
        // filesystem cleanup runs AFTER the transaction commits so a best-effort
        // unlink error can never roll back legitimate sibling-row updates in the
        // same batch.
        const updateResults: { id: number; affectedRows: number; files: BatchFilenames }[] = [];
        await db.transaction(async (tx) => {
            for (const item of items) {
                const [res] = await tx.execute(sql`
                    UPDATE images SET
                        pipeline_version = ${IMAGE_PIPELINE_VERSION},
                        icc_profile_name = ${item.signals.icc_profile_name ?? null},
                        color_primaries = ${item.signals.color_primaries ?? null},
                        transfer_function = ${item.signals.transfer_function ?? null},
                        matrix_coefficients = ${item.signals.matrix_coefficients ?? null},
                        is_hdr = ${item.signals.is_hdr},
                        has_gain_map = ${item.signals.has_gain_map},
                        color_pipeline_decision = ${item.signals.color_pipeline_decision ?? null},
                        was_downscaled = ${item.signals.was_downscaled},
                        avif_10bit = ${item.signals.avif_10bit},
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ${item.id}
                `);
                updateResults.push({ id: item.id, affectedRows: (res as ResultSetHeader)?.affectedRows ?? 0, files: item.files });
            }
            for (const item of derivativeItems) {
                const [res] = await tx.execute(sql`
                    UPDATE images SET
                        was_downscaled = ${item.derivative.was_downscaled},
                        avif_10bit = ${item.derivative.avif_10bit},
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ${item.id}
                `);
                updateResults.push({ id: item.id, affectedRows: (res as ResultSetHeader)?.affectedRows ?? 0, files: item.files });
            }
        });
        const confirmedUpdateResults = await confirmBackfillUpdateResults(updateResults, rowExists);
        // AGG-C5-01: partition + cleanup via the module-level exported helpers
        // (unit-tested in backfill-color-pipeline-deleted-mid-reencode.test.ts).
        const deletedMidReencodeFiles = collectDeletedMidReencodeFiles(confirmedUpdateResults);
        if (deletedMidReencodeFiles.length > 0) {
            // The row was deleted while we re-encoded it. The deletion already
            // unlinked the original variants; deleteImageVariants is
            // ENOENT-tolerant, so this only removes the leftover files our
            // re-encode just re-materialized. Not a failure — adjust the
            // processed tally and surface the count.
            deletedMidReencode += deletedMidReencodeFiles.length;
            processed -= deletedMidReencodeFiles.length;
            // AGG-C4-04: a row counted as a detection failure (it incremented
            // detectionFailures when reprocessRow returned derivativeOnly) may
            // ALSO be one of the rows just found deleted mid-reencode. Those rows
            // are gone, so they must not keep detectionFailures elevated — else
            // the exit code is spuriously non-zero for a row that no longer
            // exists. The derivative-slice results sit AFTER the success-row
            // results in updateResults (derivativeItems are pushed last), so
            // slice from items.length to recover exactly the detection-failure
            // UPDATE outcomes and subtract their deleted overlap.
            const derivativeResults = confirmedUpdateResults.slice(items.length);
            detectionFailures -= countDeletedMidReencodeDetectionFailures(derivativeResults);
            await Promise.all(deletedMidReencodeFiles.map(cleanupDeletedMidReencodeVariants));
            console.log(`  [batch-flush] ${deletedMidReencodeFiles.length} row(s) deleted mid-reencode — orphaned derivatives cleaned up`);
        }
        const updatedOk = items.length + derivativeItems.length - deletedMidReencodeFiles.length;
        console.log(`  [batch-flush] ${updatedOk} row(s) updated (${derivativeItems.length} derivative-only)`);
    }

    async function processRows(rows: ImageRow[]): Promise<void> {
        const queuedTasks: Promise<void>[] = [];
        for (const row of rows) {
            queuedTasks.push(queue.add(async () => {
                assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);
                let claimConn: PoolConnection | null;
                try {
                    claimConn = await acquireImageProcessingClaim(connection, row.id);
                } catch (err) {
                    console.warn(`[backfill-color-pipeline] id=${row.id} claim acquire failed:`, err);
                    skippedLocked++;
                    return;
                }
                if (!claimConn) {
                    skippedLocked++;
                    return;
                }
                try {
                    const result = await reprocessRow(row, backfillSettings, rowExists);
                    if (result.outcome === 'processed') {
                        processed++;
                        const files = rowFilenames(row);
                        if (result.signals) {
                            updateBatch.push({ id: row.id, signals: result.signals, files });
                        } else if (result.derivativeOnly) {
                            // AGG2-01: detection failed but encode succeeded — persist
                            // the derivative columns without bumping pipeline_version.
                            // AGG-C3-04: track these so the exit code/summary can flag
                            // a run that left color metadata stale despite re-encoding.
                            detectionFailures++;
                            derivativeBatch.push({ id: row.id, derivative: result.derivativeOnly, files });
                        }
                        // Hold the per-image claim through persistence. This keeps
                        // the sidecar's lock window aligned with the in-app runner
                        // and live queue: re-encode, detect, and DB update are one
                        // protected sequence for this row.
                        await flushBatch();
                    } else if (result.outcome === 'skipped') {
                        skipped++;
                    } else if (result.outcome === 'deleted-mid-reencode') {
                        deletedMidReencode++;
                    } else {
                        errors++;
                    }
                } finally {
                    await releaseImageProcessingClaim(row.id, claimConn).catch(() => undefined);
                }

                if ((processed + skipped + skippedLocked + errors + deletedMidReencode) % reportEvery === 0) {
                    console.log(
                        `  [progress] candidates=${totalCandidates} processed=${processed} skipped=${skipped} skippedLocked=${skippedLocked} errors=${errors} detectionFailures=${detectionFailures}`,
                    );
                }
            }));
        }

        const taskResults = await Promise.allSettled(queuedTasks);
        const rejectedTaskResults = taskResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (rejectedTaskResults.length > 0) {
            errors += rejectedTaskResults.length;
            for (const result of rejectedTaskResults) {
                console.error('[backfill-color-pipeline] queued task failed:', result.reason);
            }
        }

        await flushBatch();
    }

    for (;;) {
        assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);
        const rows = await fetchCandidatePage();
        if (rows.length === 0) break;
        pageCount++;
        totalCandidates += rows.length;
        lastCandidateId = rows.at(-1)?.id ?? lastCandidateId;
        console.log(`  [page ${pageCount}] fetched ${rows.length} candidate image(s), last_id=${lastCandidateId}`);
        await processRows(rows);
        if (rows.length < BATCH_SIZE) break;
    }

    if (totalCandidates === 0) {
        console.log(`[backfill-color-pipeline] No candidate image(s) found. (force=${forceReencode})`);
    } else {
        console.log(`[backfill-color-pipeline] ${totalCandidates} candidate image(s) scanned across ${pageCount} page(s). (force=${forceReencode})`);
    }

    console.log(`\n[backfill-color-pipeline] Done. processed=${processed} skipped=${skipped} skippedLocked=${skippedLocked} errors=${errors} detectionFailures=${detectionFailures} deletedMidReencode=${deletedMidReencode}`);
    if (detectionFailures > 0) {
        // AGG-C3-04: re-encode succeeded but color detection failed on these
        // rows; pipeline_version was deliberately NOT advanced so they remain
        // backfill candidates for a later retry. Surface loudly so a CI/cron
        // wrapper does not mistake an all-detection-failure run for success.
        console.warn(`[backfill-color-pipeline] WARNING: ${detectionFailures} row(s) re-encoded but color detection failed (pipeline_version NOT advanced — they will be retried on the next run).`);
    }

    // Release advisory lock explicitly before closing the connection.
    try {
        await lockConn.query('SELECT RELEASE_LOCK(?)', [LOCK_COLOR_PIPELINE_BACKFILL]);
    } catch {
        // Lock is released on connection close anyway.
    }
    lockConn.release();

    // AGG-C3-04 / AGG-C4-03: exit non-zero on hard errors OR on detection
    // failures, so a wrapper can distinguish a clean run from one that left
    // color metadata stale. Detection failures are recoverable (retried next
    // run) but must not be reported as success. Computed via the exported
    // helper so the matrix is unit-tested.
    process.exit(computeBackfillExitCode({ errors, detectionFailures }));
}

// Only run main() when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error('[backfill-color-pipeline] Fatal:', err);
        process.exit(1);
    });
}
