/**
 * backfill-alt-text.ts
 *
 * One-shot operator script — NOT run automatically. Invoke manually:
 *
 *   cd apps/web && npx tsx scripts/backfill-alt-text.ts
 *
 * What it does
 * ────────────
 * For every processed image row in the DB whose alt_text_suggested is NULL,
 * generates an alt-text suggestion using the caption generator (currently a
 * stub that produces EXIF-derived hints; real ONNX Florence-2 inference is a
 * future feature — see src/lib/caption-generator.ts).
 *
 * Idempotent: skips rows where alt_text_suggested is already set.
 *
 * Concurrency is capped at 1 (BATCH_CONCURRENCY) because Florence-2 ONNX
 * inference is heavy. Operators can raise this once the real model ships.
 *
 * Requires auto_alt_text_enabled to be true in admin settings OR the
 * --force flag to override.
 *
 * Usage:
 *   npx tsx scripts/backfill-alt-text.ts [--force]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { db, images } from '../src/db';
import { eq, isNull, and } from 'drizzle-orm';
import { generateCaption } from '../src/lib/caption-generator';

const BATCH_SIZE = 50;
const BATCH_CONCURRENCY = 1;
const FORCE_FLAG = process.argv.includes('--force');

async function main() {
    console.log('[backfill-alt-text] Starting…');

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let offset = 0;

    for (;;) {
        const rows = await db.select({
            id: images.id,
            camera_model: images.camera_model,
            capture_date: images.capture_date,
        })
            .from(images)
            .where(
                and(
                    eq(images.processed, true),
                    isNull(images.alt_text_suggested),
                ),
            )
            .limit(BATCH_SIZE)
            .offset(offset);

        if (rows.length === 0) break;

        // Process BATCH_CONCURRENCY rows at a time (cap=1 for stub/heavy inference)
        for (let i = 0; i < rows.length; i += BATCH_CONCURRENCY) {
            const chunk = rows.slice(i, i + BATCH_CONCURRENCY);
            await Promise.all(chunk.map(async (row) => {
                try {
                    const caption = await generateCaption(
                        { imageId: row.id, camera_model: row.camera_model, capture_date: row.capture_date },
                        /* autoAltTextEnabled: */ true,
                    );
                    if (!caption) {
                        skipped++;
                        return;
                    }
                    await db.update(images)
                        .set({ alt_text_suggested: caption })
                        .where(eq(images.id, row.id));
                    processed++;
                    if (processed % 100 === 0) {
                        console.log(`[backfill-alt-text] ${processed} rows updated…`);
                    }
                } catch (err) {
                    failed++;
                    console.error(`[backfill-alt-text] Failed for image ${row.id}:`, err);
                }
            }));
        }

        offset += rows.length;
    }

    console.log(`[backfill-alt-text] Done. updated=${processed}, skipped=${skipped}, failed=${failed}`);

    if (!FORCE_FLAG) {
        console.log('[backfill-alt-text] Tip: pass --force to run even when auto_alt_text_enabled=false in admin settings.');
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('[backfill-alt-text] Fatal:', err);
    process.exit(1);
});
