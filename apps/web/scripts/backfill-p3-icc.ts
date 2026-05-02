/**
 * backfill-p3-icc.ts
 *
 * One-shot operator script — NOT run automatically. Invoke manually:
 *
 *   cd apps/web && npx tsx scripts/backfill-p3-icc.ts
 *
 * What it does
 * ────────────
 * For every image row in the DB whose source ICC profile indicates a P3 or
 * wider gamut (resolveAvifIccProfile returns 'p3'), re-emits AVIF derivatives
 * that carry the Display P3 ICC profile via Sharp's withMetadata({ icc: 'p3' }).
 *
 * Idempotent: skips any AVIF file whose embedded ICC profile already contains
 * P3 metadata (non-null ICC buffer that differs from a freshly-generated sRGB
 * AVIF is treated as "already tagged"). A row is also skipped if the AVIF base
 * file does not exist on disk (never processed, or deleted).
 *
 * Only AVIF files are re-emitted. WebP and JPEG derivatives are not changed —
 * they remain sRGB for universal compatibility.
 *
 * Concurrency is capped at 2 to avoid OOM on the default single-instance
 * deployment (QUEUE_CONCURRENCY controls the live upload queue; this script
 * uses its own limit so it does not compete with ongoing uploads).
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import PQueue from 'p-queue';
import { resolveAvifIccProfile, extractIccProfileName } from '../src/lib/process-image';
import { UPLOAD_DIR_AVIF } from '../src/lib/upload-paths';

// ---------------------------------------------------------------------------
// Minimal type for DB rows we need
// ---------------------------------------------------------------------------

interface ImageRow {
    id: number;
    filename_avif: string;
    icc_profile_name: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true if the AVIF at filePath already carries a P3 ICC profile.
 * We compare the embedded profile against a freshly-generated sRGB reference:
 * if they differ, the file already has a non-sRGB (i.e. P3) profile.
 */
let _srgbIccRef: Buffer | null = null;
async function getSrgbIccRef(): Promise<Buffer> {
    if (_srgbIccRef) return _srgbIccRef;
    const buf = await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
        .withMetadata({ icc: 'srgb' })
        .avif({ quality: 50 })
        .toBuffer();
    const meta = await sharp(buf).metadata();
    _srgbIccRef = meta.icc ?? Buffer.alloc(0);
    return _srgbIccRef;
}

async function avifAlreadyHasP3(avifPath: string): Promise<boolean> {
    let meta: sharp.Metadata;
    try {
        meta = await sharp(avifPath).metadata();
    } catch {
        return false; // file missing or corrupt — treat as not tagged
    }
    if (!meta.icc || meta.icc.length === 0) return false;

    const srgbRef = await getSrgbIccRef();
    // If the embedded ICC differs from sRGB reference it must be P3 (we only
    // ever write 'srgb' or 'p3' from GalleryKit). Belt-and-suspenders: also
    // check the profile name via the existing ICC parser.
    if (!meta.icc.equals(srgbRef)) return true;

    const profileName = extractIccProfileName(meta.icc);
    return resolveAvifIccProfile(profileName) === 'p3';
}

/**
 * Re-emit all AVIF size variants for a base filename with P3 ICC.
 * Scans the AVIF directory for files matching the UUID stem.
 */
async function retagAvifVariants(baseFilename: string): Promise<number> {
    const ext = path.extname(baseFilename); // '.avif'
    const stem = path.basename(baseFilename, ext); // uuid part

    // Collect all matching variants (uuid.avif, uuid_640.avif, etc.)
    let entries: string[];
    try {
        const dir = await fs.opendir(UPLOAD_DIR_AVIF);
        entries = [];
        for await (const entry of dir) {
            if (!entry.isFile()) continue;
            if (entry.name === baseFilename || (entry.name.startsWith(`${stem}_`) && entry.name.endsWith(ext))) {
                entries.push(entry.name);
            }
        }
    } catch (err) {
        console.error(`  [skip] Cannot read AVIF dir: ${err}`);
        return 0;
    }

    let retagged = 0;
    for (const filename of entries) {
        const filePath = path.join(UPLOAD_DIR_AVIF, filename);
        const tmpPath = filePath + '.retag.tmp';
        try {
            await sharp(filePath)
                .withMetadata({ icc: 'p3' })
                .avif({ quality: 85 }) // match default; idempotent on re-run
                .toFile(tmpPath);
            await fs.rename(tmpPath, filePath);
            retagged++;
        } catch (err) {
            console.error(`  [error] Failed to retag ${filename}: ${err}`);
            await fs.unlink(tmpPath).catch(() => {});
        }
    }
    return retagged;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const { db } = await import('../src/db');
    const { sql } = await import('drizzle-orm');

    console.log('[backfill-p3-icc] Fetching candidate rows from DB…');

    // Pull all rows that have an icc_profile_name indicating P3 or wider gamut.
    // We filter in JS (resolveAvifIccProfile) to reuse the canonical logic.
    const rows = await db.execute<ImageRow>(sql`
        SELECT id, filename_avif, icc_profile_name
        FROM images
        WHERE processed = TRUE
          AND icc_profile_name IS NOT NULL
        ORDER BY id ASC
    `);

    const candidates = rows.filter(
        (r) => resolveAvifIccProfile(r.icc_profile_name) === 'p3',
    );

    console.log(`[backfill-p3-icc] ${candidates.length} P3-source image(s) found.`);

    if (candidates.length === 0) {
        console.log('[backfill-p3-icc] Nothing to do. Exiting.');
        process.exit(0);
    }

    const queue = new PQueue({ concurrency: 2 });
    let skipped = 0;
    let processed = 0;
    let errors = 0;

    for (const row of candidates) {
        queue.add(async () => {
            const avifBase = path.join(UPLOAD_DIR_AVIF, row.filename_avif);

            // Check the base file exists
            try {
                await fs.access(avifBase);
            } catch {
                console.log(`  [skip] id=${row.id} — AVIF file not found on disk`);
                skipped++;
                return;
            }

            // Idempotency check
            if (await avifAlreadyHasP3(avifBase)) {
                console.log(`  [skip] id=${row.id} — AVIF already carries P3 ICC`);
                skipped++;
                return;
            }

            console.log(`  [process] id=${row.id} icc="${row.icc_profile_name}" → re-tagging AVIF variants…`);
            try {
                const count = await retagAvifVariants(row.filename_avif);
                console.log(`  [done] id=${row.id} — ${count} variant(s) retagged`);
                processed++;
            } catch (err) {
                console.error(`  [error] id=${row.id}: ${err}`);
                errors++;
            }
        });
    }

    await queue.onIdle();

    console.log(`\n[backfill-p3-icc] Done. processed=${processed} skipped=${skipped} errors=${errors}`);
    process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('[backfill-p3-icc] Fatal:', err);
    process.exit(1);
});
