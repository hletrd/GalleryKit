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
 * older than IMAGE_PIPELINE_VERSION (currently 5). For each candidate:
 *   - fetches the stored original,
 *   - re-runs processImageFormats() with the current encoder settings
 *     (P3-from-wide mapping, toColorspace + withIccProfile, autoOrient),
 *   - updates pipeline_version = 5 on success.
 *
 * Idempotency
 * ───────────
 * Images with pipeline_version >= 5 are skipped. Re-running after a
 * successful pass is a no-op (all rows already at version 5).
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
import { processImageFormats } from '../src/lib/process-image';
import { resolveOriginalUploadPath } from '../src/lib/upload-paths';
import { LOCK_COLOR_PIPELINE_BACKFILL } from '../src/lib/advisory-locks';

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
    const { db, connection } = await import('../src/db');
    const { sql } = await import('drizzle-orm');

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

    // Fetch processed images with pipeline_version < 5 (or NULL).
    const rawRows = await db.execute(sql`
        SELECT id, filename_original, filename_avif, filename_webp, filename_jpeg,
               color_space, width
        FROM images
        WHERE processed = TRUE
          AND (pipeline_version IS NULL OR pipeline_version < 5)
        ORDER BY id ASC
    `);
    const rows = rawRows as unknown as ImageRow[];

    console.log(`[backfill-color-pipeline] ${rows.length} candidate image(s) found.`);

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

    for (const [index, row] of rows.entries()) {
        queue.add(async () => {
            const outcome = await reprocessRow(row);
            if (outcome === 'processed') {
                processed++;
                // Mark this row as pipeline version 5.
                await db.execute(sql`
                    UPDATE images SET pipeline_version = 5 WHERE id = ${row.id}
                `);
            } else if (outcome === 'skipped') {
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
