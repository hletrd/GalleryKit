/**
 * backfill-cicp-recheck.ts
 *
 * One-shot diagnostic script — NOT run automatically. Invoke manually:
 *
 *   cd apps/web && npx tsx scripts/backfill-cicp-recheck.ts
 *
 * What it does
 * ────────────
 * Re-runs detectColorSignals on all HEIF/AVIF/HEIC original files and
 * compares the freshly-detected values against the stored DB columns
 * (color_primaries, transfer_function, matrix_coefficients, is_hdr).
 *
 * Logs flip counts so operators can decide whether a backfill is needed
 * after NCLX map fixes (A1).
 *
 * Idempotency
 * ───────────
 * This script is read-only: it never writes to the DB or filesystem.
 * Safe to run at any time.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs/promises';
import sharp from 'sharp';
import PQueue from 'p-queue';
import type { RowDataPacket } from 'mysql2';
import { detectColorSignals } from '../src/lib/color-detection';
import { resolveOriginalUploadPath } from '../src/lib/upload-paths';

interface DbRow extends RowDataPacket {
    id: number;
    filename_original: string;
    color_primaries: string | null;
    transfer_function: string | null;
    matrix_coefficients: string | null;
    is_hdr: boolean;
}

interface FlipCounts {
    primaries: number;
    transfer: number;
    matrix: number;
    hdr: number;
    total: number;
}

async function main() {
    const { db } = await import('../src/db');
    const { sql } = await import('drizzle-orm');

    console.log('[backfill-cicp-recheck] Fetching HEIF/AVIF/HEIC rows…');

    const rawRows = await db.execute(sql`
        SELECT id, filename_original, color_primaries, transfer_function, matrix_coefficients, is_hdr
        FROM images
        WHERE original_format IN ('heif', 'avif', 'heic')
        ORDER BY id ASC
    `);
    const rows = rawRows as unknown as DbRow[];

    console.log(`[backfill-cicp-recheck] ${rows.length} candidate image(s) found.`);

    if (rows.length === 0) {
        console.log('[backfill-cicp-recheck] Nothing to do. Exiting.');
        process.exit(0);
    }

    const concurrency = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY) || 2);
    const queue = new PQueue({ concurrency });
    const flips: FlipCounts = { primaries: 0, transfer: 0, matrix: 0, hdr: 0, total: 0 };
    let checked = 0;
    let missing = 0;
    let errors = 0;
    const reportEvery = Math.max(1, Math.floor(rows.length / 20));

    for (const row of rows) {
        queue.add(async () => {
            const originalPath = await resolveOriginalUploadPath(row.filename_original);
            try {
                await fs.access(originalPath);
            } catch {
                missing++;
                return;
            }

            try {
                const image = sharp(originalPath);
                const metadata = await image.metadata();
                const signals = await detectColorSignals(originalPath, image, metadata);

                const primariesChanged = signals.colorPrimaries !== (row.color_primaries ?? 'unknown');
                const transferChanged = signals.transferFunction !== (row.transfer_function ?? 'unknown');
                const matrixChanged = signals.matrixCoefficients !== (row.matrix_coefficients ?? 'unknown');
                const hdrChanged = signals.isHdr !== row.is_hdr;

                if (primariesChanged || transferChanged || matrixChanged || hdrChanged) {
                    flips.total++;
                    if (primariesChanged) flips.primaries++;
                    if (transferChanged) flips.transfer++;
                    if (matrixChanged) flips.matrix++;
                    if (hdrChanged) flips.hdr++;
                }
            } catch (err) {
                console.error(`  [error] id=${row.id}: ${err}`);
                errors++;
            }

            checked++;
            if (checked % reportEvery === 0 || checked === rows.length) {
                console.log(`[backfill-cicp-recheck] ${checked}/${rows.length} checked (flips=${flips.total}, missing=${missing}, errors=${errors})`);
            }
        });
    }

    await queue.onEmpty();

    console.log('\n[backfill-cicp-recheck] Done.');
    console.log(`  Total rows checked: ${checked}`);
    console.log(`  Missing originals:  ${missing}`);
    console.log(`  Errors:             ${errors}`);
    console.log(`  Flip counts:`);
    console.log(`    color_primaries:   ${flips.primaries}`);
    console.log(`    transfer_function: ${flips.transfer}`);
    console.log(`    matrix_coefficients: ${flips.matrix}`);
    console.log(`    is_hdr:            ${flips.hdr}`);
    console.log(`    total (any field): ${flips.total}`);

    process.exit(0);
}

main().catch((err) => {
    console.error('[backfill-cicp-recheck] Fatal error:', err);
    process.exit(1);
});
