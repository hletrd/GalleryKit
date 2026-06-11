/**
 * backfill-clip-embeddings.ts
 *
 * One-shot operator script — NOT run automatically. Invoke manually:
 *
 *   cd apps/web && npx tsx scripts/backfill-clip-embeddings.ts
 *
 * What it does
 * ────────────
 * For every processed image row in the DB that lacks an image_embeddings row,
 * generates a 512-dim float32 embedding using the stub CLIP inference
 * (embedImageStub) and upserts it into image_embeddings.
 *
 * Idempotent: skips images that already have an embedding row.
 *
 * Concurrency is capped at BATCH_CONCURRENCY=2 as specified in US-P51.
 * Operators can raise this once the real ONNX inference ships.
 *
 * NOTE: stub embeddings are NOT semantically meaningful — cosine similarity
 * results will be essentially random. Enable semantic_search_enabled only
 * after running this script AND after real ONNX inference replaces the stub.
 *
 * Usage:
 *   npx tsx scripts/backfill-clip-embeddings.ts [--force]
 *
 * --force: skip the semantic_search_enabled check (useful for pre-population
 *          before enabling the setting in admin).
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { db, images, imageEmbeddings, adminSettings } from '../src/db';
import { eq, and, notExists, gt, asc } from 'drizzle-orm';
import { embedImageStub } from '../src/lib/clip-inference';
import { embeddingToBuffer, CLIP_MODEL_VERSION, SEMANTIC_SCAN_LIMIT } from '../src/lib/clip-embeddings';

const BATCH_SIZE = 50;
const BATCH_CONCURRENCY = 2;
const FORCE_FLAG = process.argv.includes('--force');

async function checkSemanticEnabled(): Promise<boolean> {
    const rows = await db.select({ value: adminSettings.value })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'semantic_search_enabled'))
        .limit(1);
    return rows[0]?.value === 'true';
}

async function main() {
    console.log('[backfill-clip-embeddings] Starting…');

    if (!FORCE_FLAG) {
        const enabled = await checkSemanticEnabled();
        if (!enabled) {
            console.log('[backfill-clip-embeddings] semantic_search_enabled is false. Enable it in admin settings or run with --force to skip this check.');
            process.exit(0);
        }
    } else {
        console.log('[backfill-clip-embeddings] --force flag set, skipping semantic_search_enabled check.');
    }

    let processed = 0;
    let failed = 0;
    // COR-R4C19-04: keyset pagination instead of LIMIT/OFFSET. Each upsert
    // removes its row from the notExists() WHERE set, so advancing an OFFSET
    // skipped ~half the backlog. A strictly-increasing id cursor survives
    // both the shrinking filter AND rows that keep matching after a failed
    // insert, and turns each batch into an index range seek.
    // (OBS-R4C19-E: the dead `skipped` counter is gone — every selected row
    // is either processed or failed.)
    let cursor = 0;

    for (;;) {
        // Select processed images without an embedding row
        const rows = await db
            .select({ id: images.id })
            .from(images)
            .where(
                and(
                    eq(images.processed, true),
                    gt(images.id, cursor),
                    notExists(
                        db.select({ imageId: imageEmbeddings.imageId })
                            .from(imageEmbeddings)
                            .where(eq(imageEmbeddings.imageId, images.id)),
                    ),
                ),
            )
            .orderBy(asc(images.id))
            .limit(BATCH_SIZE);

        if (rows.length === 0) break;
        cursor = rows[rows.length - 1].id;

        // Cap total scan to SEMANTIC_SCAN_LIMIT
        if (processed + failed + rows.length > SEMANTIC_SCAN_LIMIT) {
            console.log(`[backfill-clip-embeddings] Reached SEMANTIC_SCAN_LIMIT (${SEMANTIC_SCAN_LIMIT}). Stop here and re-run to continue.`);
            break;
        }

        // Process with bounded concurrency
        for (let i = 0; i < rows.length; i += BATCH_CONCURRENCY) {
            const chunk = rows.slice(i, i + BATCH_CONCURRENCY);
            await Promise.all(chunk.map(async ({ id }) => {
                try {
                    const embedding = embedImageStub(id);
                    const buf = embeddingToBuffer(embedding);
                    const base64 = buf.toString('base64');
                    await db.insert(imageEmbeddings)
                        .values({
                            imageId: id,
                            embedding: base64,
                            modelVersion: CLIP_MODEL_VERSION,
                        })
                        .onDuplicateKeyUpdate({
                            set: {
                                embedding: base64,
                                modelVersion: CLIP_MODEL_VERSION,
                            },
                        });
                    processed++;
                    if (processed % 100 === 0) {
                        console.log(`[backfill-clip-embeddings] Processed ${processed} images…`);
                    }
                } catch (err) {
                    console.error(`[backfill-clip-embeddings] Failed for image ${id}:`, err);
                    failed++;
                }
            }));
        }

        if (rows.length < BATCH_SIZE) break;
    }

    console.log(`[backfill-clip-embeddings] Done. processed=${processed} failed=${failed}`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('[backfill-clip-embeddings] Fatal error:', err);
    process.exit(1);
});
