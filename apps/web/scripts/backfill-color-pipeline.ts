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
 * Concurrency is capped at BACKFILL_CONCURRENCY (default 2) to avoid
 * starving the live web process during long re-runs.
 *
 * Advisory lock
 * ─────────────
 * Uses MySQL GET_LOCK so two concurrent backfill invocations serialize
 * rather than racing the same rows. The lock is released automatically
 * when the dedicated connection closes.
 *
 * KNOWN GAP (TRC-R5C2-01 rider, plan-322): unlike the in-app runner
 * (admin-backfill-runner.ts), this script does NOT claim the per-image
 * `gallerykit:image-processing:{id}` lock per row — its DB writes are
 * batched in flushBatch() decoupled from the per-row encode, so a per-row
 * lock would not cover the UPDATE window without restructuring the
 * batching. Operationally: do not trigger admin "Retry" on failed images
 * (retryFailedImage) while a sidecar run is active; the global backfill
 * lock already serializes this script against the in-app runner.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs/promises';
import PQueue from 'p-queue';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import sharp from 'sharp';
import { processImageFormats, IMAGE_PIPELINE_VERSION, resolveColorPipelineDecision, deleteImageVariants, type ImageQualitySettings } from '../src/lib/process-image';
import { detectColorSignals } from '../src/lib/color-detection';
import { resolveOriginalUploadPath, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '../src/lib/upload-paths';
import { LOCK_COLOR_PIPELINE_BACKFILL } from '../src/lib/advisory-locks';
import { getGalleryConfig } from '../src/lib/gallery-config';
import type { JpegChromaSubsampling } from '../src/lib/gallery-config-shared';

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
    outcome: 'processed' | 'skipped' | 'error';
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
    await Promise.all([
        deleteImageVariants(UPLOAD_DIR_WEBP, files.filename_webp, []),
        deleteImageVariants(UPLOAD_DIR_AVIF, files.filename_avif, []),
        deleteImageVariants(UPLOAD_DIR_JPEG, files.filename_jpeg, []),
    ]);
}

/**
 * AGG-C5-01: pure decision helper — given each batched UPDATE's affectedRows and
 * the per-row filenames, return the files whose row was deleted mid-reencode
 * (affectedRows===0) and must have their just-written derivatives cleaned up.
 * Extracted so the sidecar's delete-race partitioning is testable without a live
 * DB; `flushBatch` feeds it the ResultSetHeader.affectedRows it reads back.
 */
export function collectDeletedMidReencodeFiles(
    results: { affectedRows: number; files: BatchFilenames }[],
): BatchFilenames[] {
    return results.filter((r) => r.affectedRows === 0).map((r) => r.files);
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

export async function reprocessRow(row: ImageRow, settings?: BackfillSettings): Promise<ReprocessResult> {
    const originalPath = await resolveOriginalUploadPath(row.filename_original);
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
        );
        wasDownscaled = result.wasDownscaled;
        // AGG-02: capture the delivered AVIF bit depth so the UPDATE below
        // refreshes the public avif_10bit column to match the new bytes.
        avif10bit = result.avif10bit;
    } catch (err) {
        console.error(`  [error] id=${row.id}: ${err}`);
        return { outcome: 'error' };
    }

    // R7-M4: re-run color detection after successful re-encode so DB color
    // columns stay in sync with the current detection logic.
    try {
        const image = sharp(originalPath, {
            limitInputPixels: 256 * 1024 * 1024,
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

async function main() {
    const forceReencode = process.argv.includes('--force-reencode');

    const { db, connection } = await import('../src/db');
    const { sql } = await import('drizzle-orm');

    // R8-CRIT: resolve current admin settings so backfilled images produce
    // identical derivatives to what a fresh upload would produce.
    const config = await getGalleryConfig();
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

    console.log('[backfill-color-pipeline] Acquiring advisory lock…');

    // Acquire a dedicated connection for the advisory lock.
    // GET_LOCK scope is connection-bound; releasing the connection
    // automatically releases the lock on MySQL close.
    const lockConn = await connection.getConnection();
    let lockAcquired = false;
    try {
        const [lockRows] = await lockConn.query<(RowDataPacket & { acquired: number })[]>(
            'SELECT GET_LOCK(?, 10) AS acquired',
            [LOCK_COLOR_PIPELINE_BACKFILL],
        );
        lockAcquired = (lockRows[0]?.acquired ?? 0) === 1;
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

    console.log('[backfill-color-pipeline] Lock acquired. Fetching candidate rows…');

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

    const rawRows = await db.execute(sql`
        SELECT id, filename_original, filename_avif, filename_webp, filename_jpeg,
               icc_profile_name, color_primaries, width
        FROM images
        WHERE ${whereClause}
        ORDER BY id ASC
    `);
    // drizzle's mysql2 `db.execute(sql)` returns the underlying mysql2 tuple
    // `[rows, fields]`, not just the row array. Newer drizzle releases or
    // different driver shims may return rows directly. Unwrap defensively
    // so the script works either way — without this guard, iterating
    // produces `[rows, fields]` as two "rows" and every field accessor
    // returns undefined → resolveOriginalUploadPath crashes.
    const rows = (Array.isArray(rawRows) && Array.isArray(rawRows[0])
        ? rawRows[0]
        : rawRows) as unknown as ImageRow[];

    console.log(`[backfill-color-pipeline] ${rows.length} candidate image(s) found. (force=${forceReencode})`);

    if (rows.length === 0) {
        console.log('[backfill-color-pipeline] Nothing to do. Exiting.');
        lockConn.release();
        process.exit(0);
    }

    const concurrency = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY) || 2);
    const queue = new PQueue({ concurrency });
    let skipped = 0;
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
    const reportEvery = Math.max(1, Math.floor(rows.length / 20));

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

    async function flushBatch(): Promise<void> {
        if (pendingUpdates() === 0) return;
        const items = updateBatch.splice(0, updateBatch.length);
        const derivativeItems = derivativeBatch.splice(0, derivativeBatch.length);
        // Collect rows whose UPDATE matched 0 rows (deleted mid-reencode). The
        // filesystem cleanup runs AFTER the transaction commits so a best-effort
        // unlink error can never roll back legitimate sibling-row updates in the
        // same batch.
        const updateResults: { affectedRows: number; files: BatchFilenames }[] = [];
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
                        avif_10bit = ${item.signals.avif_10bit}
                    WHERE id = ${item.id}
                `);
                updateResults.push({ affectedRows: (res as ResultSetHeader)?.affectedRows ?? 0, files: item.files });
            }
            for (const item of derivativeItems) {
                const [res] = await tx.execute(sql`
                    UPDATE images SET
                        was_downscaled = ${item.derivative.was_downscaled},
                        avif_10bit = ${item.derivative.avif_10bit}
                    WHERE id = ${item.id}
                `);
                updateResults.push({ affectedRows: (res as ResultSetHeader)?.affectedRows ?? 0, files: item.files });
            }
        });
        // AGG-C5-01: partition + cleanup via the module-level exported helpers
        // (unit-tested in backfill-color-pipeline-deleted-mid-reencode.test.ts).
        const deletedMidReencodeFiles = collectDeletedMidReencodeFiles(updateResults);
        if (deletedMidReencodeFiles.length > 0) {
            // The row was deleted while we re-encoded it. The deletion already
            // unlinked the original variants; deleteImageVariants is
            // ENOENT-tolerant, so this only removes the leftover files our
            // re-encode just re-materialized. Not a failure — adjust the
            // processed tally and surface the count.
            deletedMidReencode += deletedMidReencodeFiles.length;
            processed -= deletedMidReencodeFiles.length;
            await Promise.all(deletedMidReencodeFiles.map(cleanupDeletedMidReencodeVariants));
            console.log(`  [batch-flush] ${deletedMidReencodeFiles.length} row(s) deleted mid-reencode — orphaned derivatives cleaned up`);
        }
        const updatedOk = items.length + derivativeItems.length - deletedMidReencodeFiles.length;
        console.log(`  [batch-flush] ${updatedOk} row(s) updated (${derivativeItems.length} derivative-only)`);
    }

    for (const [index, row] of rows.entries()) {
        queue.add(async () => {
            const result = await reprocessRow(row, backfillSettings);
            if (result.outcome === 'processed') {
                processed++;
                const files: BatchFilenames = {
                    filename_webp: row.filename_webp,
                    filename_avif: row.filename_avif,
                    filename_jpeg: row.filename_jpeg,
                };
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
                if (pendingUpdates() >= BATCH_SIZE) {
                    await flushBatch();
                }
            } else if (result.outcome === 'skipped') {
                skipped++;
            } else {
                errors++;
            }

            if ((index + 1) % reportEvery === 0) {
                console.log(
                    `  [progress] ${index + 1}/${rows.length} processed=${processed} skipped=${skipped} errors=${errors} detectionFailures=${detectionFailures}`,
                );
            }
        });
    }

    await queue.onIdle();

    // Flush any remaining rows.
    await flushBatch();

    console.log(`\n[backfill-color-pipeline] Done. processed=${processed} skipped=${skipped} errors=${errors} detectionFailures=${detectionFailures} deletedMidReencode=${deletedMidReencode}`);
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

    // AGG-C3-04: exit non-zero on hard errors OR on detection failures, so a
    // wrapper can distinguish a clean run from one that left color metadata
    // stale. Detection failures are recoverable (retried next run) but must
    // not be reported as success.
    process.exit(errors > 0 || detectionFailures > 0 ? 1 : 0);
}

// Only run main() when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error('[backfill-color-pipeline] Fatal:', err);
        process.exit(1);
    });
}
