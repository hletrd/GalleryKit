/**
 * backfill-p3-icc.ts
 *
 * One-shot operator script — NOT run automatically. Invoke manually:
 *
 *   cd apps/web && npx tsx scripts/backfill-p3-icc.ts
 *
 * What it does
 * ────────────
 * For every processed image row, re-runs processImageFormats() against the
 * stored original to regenerate AVIF / WebP / JPEG derivatives with the
 * post-fix encoder. The new pipeline (see CM-CRIT-1, CM-HIGH-1, CM-HIGH-2,
 * CM-HIGH-4 in process-image.ts) produces:
 *   - strict P3 detection so wider-than-P3 sources are converted to sRGB
 *     instead of being mistagged as Display-P3,
 *   - explicit pixel conversion via toColorspace + matching ICC tag via
 *     withIccProfile (no EXIF leak),
 *   - autoOrient applied so iPhone landscape photos are upright.
 *
 * The serve-upload route emits an ETag containing IMAGE_PIPELINE_VERSION
 * (CM-HIGH-5), so once the original file is reprocessed any cached client
 * copy will revalidate against the new ETag and re-fetch automatically.
 *
 * The script is idempotent at the row level: each row's existing
 * derivatives are replaced atomically by processImageFormats(). Re-running
 * after a successful pass simply re-emits identical bytes.
 *
 * Concurrency is capped at BACKFILL_CONCURRENCY (default 2) to avoid
 * starving the live web process during long re-runs.
 *
 * CM-HIGH-6 fix: pre-fix script referenced a non-existent `icc_profile_name`
 * column. The actual schema column is `color_space`. The script now reads
 * filename_original from the row and re-runs the full encoder, rather than
 * trying to retag derivative bytes in place with a stale ICC profile name.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs/promises';
import PQueue from 'p-queue';
import { processImageFormats } from '../src/lib/process-image';
import { resolveOriginalUploadPath } from '../src/lib/upload-paths';

// ---------------------------------------------------------------------------
// Minimal type for DB rows we need
// ---------------------------------------------------------------------------

export interface ImageRow {
    id: number;
    filename_original: string;
    filename_avif: string;
    filename_webp: string;
    filename_jpeg: string;
    color_space: string | null;
    width: number;
}

// ---------------------------------------------------------------------------
// Single-row reprocessor — exported for unit tests.
// ---------------------------------------------------------------------------

export async function reprocessRow(row: ImageRow): Promise<'processed' | 'skipped' | 'error'> {
    const originalPath = await resolveOriginalUploadPath(row.filename_original);
    try {
        await fs.access(originalPath);
    } catch {
        return 'skipped';
    }

    try {
        await processImageFormats(
            originalPath,
            row.filename_webp,
            row.filename_avif,
            row.filename_jpeg,
            row.width,
            undefined,
            undefined,
            row.color_space,
        );
        return 'processed';
    } catch (err) {
        console.error(`  [error] id=${row.id}: ${err}`);
        return 'error';
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const { db } = await import('../src/db');
    const { sql } = await import('drizzle-orm');

    console.log('[backfill-p3-icc] Fetching candidate rows from DB…');

    // Pull all processed rows. We re-emit derivatives for every row because
    // the post-fix encoder pipeline produces different bytes (toColorspace,
    // withIccProfile, autoOrient) for sRGB sources too — not just wide-gamut
    // ones. This is the point of the IMAGE_PIPELINE_VERSION cutover.
    const rawRows = await db.execute(sql`
        SELECT id, filename_original, filename_avif, filename_webp, filename_jpeg,
               color_space, width
        FROM images
        WHERE processed = TRUE
        ORDER BY id ASC
    `);
    const rows = rawRows as unknown as ImageRow[];

    console.log(`[backfill-p3-icc] ${rows.length} processed image(s) found.`);

    if (rows.length === 0) {
        console.log('[backfill-p3-icc] Nothing to do. Exiting.');
        process.exit(0);
    }

    const concurrency = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY) || 2);
    const queue = new PQueue({ concurrency });
    let skipped = 0;
    let processed = 0;
    let errors = 0;
    const reportEvery = Math.max(1, Math.floor(rows.length / 20));

    for (const [index, row] of rows.entries()) {
        queue.add(async () => {
            const outcome = await reprocessRow(row);
            if (outcome === 'processed') processed++;
            else if (outcome === 'skipped') skipped++;
            else errors++;

            if ((index + 1) % reportEvery === 0) {
                console.log(`  [progress] ${index + 1}/${rows.length} processed=${processed} skipped=${skipped} errors=${errors}`);
            }
        });
    }

    await queue.onIdle();

    console.log(`\n[backfill-p3-icc] Done. processed=${processed} skipped=${skipped} errors=${errors}`);
    process.exit(errors > 0 ? 1 : 0);
}

// Only run main() when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error('[backfill-p3-icc] Fatal:', err);
        process.exit(1);
    });
}
