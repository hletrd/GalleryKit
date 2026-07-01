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

import { db, images, adminSettings } from '../src/db';
import { eq, isNull, and, gt, asc } from 'drizzle-orm';
import { generateCaption } from '../src/lib/caption-generator';
import { assertNoDurableRestoreMaintenanceForScript } from '../src/lib/restore-maintenance-durable';

const SCRIPT_NAME = 'backfill-alt-text';
const BATCH_SIZE = 50;
const BATCH_CONCURRENCY = 1;
const FORCE_FLAG = process.argv.includes('--force');

// DOC-R4C19-05: the header has always documented an auto_alt_text_enabled /
// --force gate, but the code never consulted the admin setting. Implement
// the documented contract, mirroring backfill-clip-embeddings.ts.
async function checkAutoAltTextEnabled(): Promise<boolean> {
    const rows = await db.select({ value: adminSettings.value })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'auto_alt_text_enabled'))
        .limit(1);
    return rows[0]?.value === 'true';
}

async function main() {
    console.log('[backfill-alt-text] Starting…');

    assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);

    if (!FORCE_FLAG) {
        const enabled = await checkAutoAltTextEnabled();
        if (!enabled) {
            console.log('[backfill-alt-text] auto_alt_text_enabled is false. Enable it in admin settings or run with --force to skip this check.');
            process.exit(0);
        }
    } else {
        console.log('[backfill-alt-text] --force flag set, skipping auto_alt_text_enabled check.');
    }

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    // COR-R4C19-04: keyset pagination instead of LIMIT/OFFSET. The UPDATEs
    // below remove rows from the WHERE set, so advancing an OFFSET skipped
    // ~half the backlog (each batch of updates shifted the remaining rows
    // left by a full batch). A strictly-increasing id cursor survives both
    // the shrinking filter AND rows that stay NULL forever (empty captions),
    // and turns each batch into an index range seek instead of an O(offset)
    // scan-and-discard.
    let cursor = 0;

    for (;;) {
        assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);
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
                    gt(images.id, cursor),
                ),
            )
            .orderBy(asc(images.id))
            .limit(BATCH_SIZE);

        if (rows.length === 0) break;
        cursor = rows[rows.length - 1].id;

        // Process BATCH_CONCURRENCY rows at a time (cap=1 for stub/heavy inference)
        for (let i = 0; i < rows.length; i += BATCH_CONCURRENCY) {
            const chunk = rows.slice(i, i + BATCH_CONCURRENCY);
            assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);
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
    }

    console.log(`[backfill-alt-text] Done. updated=${processed}, skipped=${skipped}, failed=${failed}`);

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('[backfill-alt-text] Fatal:', err);
    process.exit(1);
});
