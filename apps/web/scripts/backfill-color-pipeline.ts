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
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs/promises';
import PQueue from 'p-queue';
import type { RowDataPacket } from 'mysql2';
import sharp from 'sharp';
import { processImageFormats, IMAGE_PIPELINE_VERSION, resolveColorPipelineDecision, type ImageQualitySettings } from '../src/lib/process-image';
import { detectColorSignals } from '../src/lib/color-detection';
import { resolveOriginalUploadPath } from '../src/lib/upload-paths';
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
}

interface ReprocessResult {
    outcome: 'processed' | 'skipped' | 'error';
    signals?: ReprocessSignals;
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
            },
        };
    } catch (err) {
        // Detection failed but encoding succeeded — still mark as processed
        // so the stale color columns are at least no worse than before.
        console.warn(`  [warn] id=${row.id}: detection failed after re-encode: ${err}`);
        return { outcome: 'processed' };
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

    // Fetch processed images with pipeline_version < IMAGE_PIPELINE_VERSION (or NULL).
    // A2: skip rows that already have a non-null color_pipeline_decision
    // unless --force-reencode is passed — these rows were already correctly
    // labelled by a prior run and re-encoding is unnecessary.
    let whereClause = sql`processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < ${IMAGE_PIPELINE_VERSION})`;
    if (!forceReencode) {
        whereClause = sql`${whereClause} AND (color_pipeline_decision IS NULL)`;
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
    const reportEvery = Math.max(1, Math.floor(rows.length / 20));

    // R7-L8: batch DB updates to reduce round-trips.
    const updateBatch: { id: number; signals: ReprocessSignals }[] = [];

    async function flushBatch(): Promise<void> {
        if (updateBatch.length === 0) return;
        const items = updateBatch.splice(0, updateBatch.length);
        await db.transaction(async (tx) => {
            for (const item of items) {
                await tx.execute(sql`
                    UPDATE images SET
                        pipeline_version = ${IMAGE_PIPELINE_VERSION},
                        icc_profile_name = ${item.signals.icc_profile_name ?? null},
                        color_primaries = ${item.signals.color_primaries ?? null},
                        transfer_function = ${item.signals.transfer_function ?? null},
                        matrix_coefficients = ${item.signals.matrix_coefficients ?? null},
                        is_hdr = ${item.signals.is_hdr},
                        has_gain_map = ${item.signals.has_gain_map},
                        color_pipeline_decision = ${item.signals.color_pipeline_decision ?? null},
                        was_downscaled = ${item.signals.was_downscaled}
                    WHERE id = ${item.id}
                `);
            }
        });
        console.log(`  [batch-flush] ${items.length} row(s) updated`);
    }

    for (const [index, row] of rows.entries()) {
        queue.add(async () => {
            const result = await reprocessRow(row, backfillSettings);
            if (result.outcome === 'processed') {
                processed++;
                if (result.signals) {
                    updateBatch.push({ id: row.id, signals: result.signals });
                }
                if (updateBatch.length >= BATCH_SIZE) {
                    await flushBatch();
                }
            } else if (result.outcome === 'skipped') {
                skipped++;
            } else {
                errors++;
            }

            if ((index + 1) % reportEvery === 0) {
                console.log(
                    `  [progress] ${index + 1}/${rows.length} processed=${processed} skipped=${skipped} errors=${errors}`,
                );
            }
        });
    }

    await queue.onIdle();

    // Flush any remaining rows.
    await flushBatch();

    console.log(`\n[backfill-color-pipeline] Done. processed=${processed} skipped=${skipped} errors=${errors}`);

    // Release advisory lock explicitly before closing the connection.
    try {
        await lockConn.query('SELECT RELEASE_LOCK(?)', [LOCK_COLOR_PIPELINE_BACKFILL]);
    } catch {
        // Lock is released on connection close anyway.
    }
    lockConn.release();

    process.exit(errors > 0 ? 1 : 0);
}

// Only run main() when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error('[backfill-color-pipeline] Fatal:', err);
        process.exit(1);
    });
}
