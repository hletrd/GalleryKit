/**
 * backfill-clip-embeddings.ts
 *
 * One-shot operator script — NOT run automatically. Invoke manually:
 *
 *   cd apps/web && npx tsx scripts/backfill-clip-embeddings.ts             # stub mode
 *   cd apps/web && npx tsx scripts/backfill-clip-embeddings.ts --production --force # pre-enable real encoder backfill
 *
 * In production the runtime container has prod-deps only and lacks tsx + the
 * TypeScript source files, so run this via an `--rm` sidecar off the just-built
 * image with read-only source mounts (the same pattern documented for the
 * color-pipeline backfill in CLAUDE.md), e.g.:
 *
 *   docker run --rm --network host \
 *     -v .../apps/web/src:/app/apps/web/src:ro \
 *     -v .../apps/web/scripts:/app/apps/web/scripts:ro \
 *     -v .../apps/web/tsconfig.json:/app/apps/web/tsconfig.json:ro \
 *     -v .../apps/web/data:/app/data \
 *     --env-file .../apps/web/.env.local \
 *     --user root -w /app/apps/web web-web:latest \
 *     sh -c "CLIP_MODELS_ROOT=/app/data/models/clip npx --yes tsx@4.22.4 scripts/backfill-clip-embeddings.ts --production --force"
 *
 * CLIP_INFERENCE_CONCURRENCY defaults to 1 and is capped by lib/clip-model.ts.
 * Raise it only after measuring CPU and RSS headroom on the deploy host.
 *
 * What it does
 * ────────────
 * For every processed image row in the DB that lacks an image_embeddings row
 * AT THE TARGET model_version, generates a 512-dim float32 embedding and upserts
 * it into image_embeddings (PK is image_id, so the upsert replaces any existing
 * row in place).
 *
 *   - default (stub):  embedImageStub(id)        → modelVersion = STUB_MODEL_VERSION
 *   - --production:    embedImageReal(<original>) → modelVersion = PRODUCTION_MODEL_VERSION
 *
 * Re-embed on model_version mismatch
 * ──────────────────────────────────
 * The skip condition is "this image already has an embedding row AT THE TARGET
 * model_version". A row embedded under a DIFFERENT model_version (e.g. a stub
 * `stub-sha256-v1` row when running `--production`) is therefore RE-SELECTED and
 * RE-EMBEDDED — the upsert overwrites the stale vector + version in place. This
 * is the migration mechanism that upgrades every throwaway stub row to a real
 * embedding after the real-CLIP rollout.
 *
 * Idempotent: a second run at the same target version selects nothing. If the
 * script logs that it reached SEMANTIC_SCAN_LIMIT, repeat the same command
 * until it finishes without that message.
 *
 * Concurrency is capped at BATCH_CONCURRENCY=2 as specified in US-P51.
 * Operators can raise this once the real ONNX inference ships.
 *
 * NOTE: stub embeddings are NOT semantically meaningful — cosine similarity
 * results will be essentially random. Run `--production` (after seeding the CLIP
 * model volume) to populate real embeddings before relying on semantic search.
 *
 * Usage:
 *   npx tsx scripts/backfill-clip-embeddings.ts [--production] [--force]
 *
 * --production: use the real jina-clip-v2 encoder + PRODUCTION_MODEL_VERSION
 *               instead of the stub.
 * --force:      skip the semantic_search_mode gate. Use this for pre-enable
 *               production backfills before flipping the DB setting; plain
 *               --production is only suitable after semantic_search_mode is
 *               already stub/production.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { db, connection, images, imageEmbeddings, adminSettings } from '../src/db';
import type { RowDataPacket } from 'mysql2/promise';
import { eq, and, notExists, gt, asc } from 'drizzle-orm';
import { embedImageStub } from '../src/lib/clip-inference';
import { embedImageReal } from '../src/lib/clip-model';
import { embeddingToBuffer, STUB_MODEL_VERSION, PRODUCTION_MODEL_VERSION, SEMANTIC_SCAN_LIMIT } from '../src/lib/clip-embeddings';
import { resolveOriginalUploadPath } from '../src/lib/upload-paths';
import { LOCK_SEMANTIC_EMBEDDING_BACKFILL, isAdvisoryLockAcquired } from '../src/lib/advisory-locks';
import { resolveSemanticSearchMode } from '../src/lib/gallery-config-shared';
import { assertNoDurableRestoreMaintenanceForScript } from '../src/lib/restore-maintenance-durable';

const SCRIPT_NAME = 'backfill-clip-embeddings';
const BATCH_SIZE = 50;
const BATCH_CONCURRENCY = 2;
const FORCE_FLAG = process.argv.includes('--force');
const PRODUCTION_FLAG = process.argv.includes('--production');

// Target model_version drives BOTH the upsert version AND the re-embed selection:
// images missing an embedding row AT THIS version are (re-)embedded.
const TARGET_MODEL_VERSION = PRODUCTION_FLAG ? PRODUCTION_MODEL_VERSION : STUB_MODEL_VERSION;

function logScanLimitReached() {
    console.log(`[backfill-clip-embeddings] Reached SEMANTIC_SCAN_LIMIT (${SEMANTIC_SCAN_LIMIT}). Stop here and re-run to continue.`);
}

async function checkSemanticModeEnabled(): Promise<boolean> {
    const rows = await db.select({ value: adminSettings.value })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'semantic_search_mode'))
        .limit(1);
    const resolvedMode = resolveSemanticSearchMode(
        rows[0]?.value,
        process.env.SEMANTIC_SEARCH_ALLOW_PRODUCTION === 'true',
    );
    return resolvedMode !== 'disabled';
}

async function main(): Promise<number> {
    console.log(`[backfill-clip-embeddings] Starting… mode=${PRODUCTION_FLAG ? 'production' : 'stub'} targetModelVersion=${TARGET_MODEL_VERSION}`);

    assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);

    const lockConn = await connection.getConnection();
    let semanticBackfillLockHeld = false;
    try {
        if (PRODUCTION_FLAG && process.env.SEMANTIC_SEARCH_ALLOW_PRODUCTION !== 'true') {
            console.error('[backfill-clip-embeddings] Refusing --production without SEMANTIC_SEARCH_ALLOW_PRODUCTION=true.');
            return 1;
        }

        const [lockRows] = await lockConn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            'SELECT GET_LOCK(?, 0) AS acquired',
            [LOCK_SEMANTIC_EMBEDDING_BACKFILL],
        );
        if (!isAdvisoryLockAcquired(lockRows[0]?.acquired)) {
            console.error('[backfill-clip-embeddings] Another semantic embedding backfill or database restore is active; retry later.');
            return 1;
        }
        semanticBackfillLockHeld = true;
        assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);

        if (!FORCE_FLAG) {
            const enabled = await checkSemanticModeEnabled();
            if (!enabled) {
                console.log('[backfill-clip-embeddings] semantic_search_mode is "disabled" (or unset). Set it to "stub"/"production" in admin settings or run with --force to skip this check.');
                return 0;
            }
        } else {
            console.log('[backfill-clip-embeddings] --force flag set, skipping semantic_search_mode check.');
        }

        let processed = 0;
        let failed = 0;
        const failedImageIds: number[] = [];
    // COR-R4C19-04: keyset pagination instead of LIMIT/OFFSET. Each upsert
    // removes its row from the notExists() WHERE set, so advancing an OFFSET
    // skipped ~half the backlog. A strictly-increasing id cursor survives
    // both the shrinking filter AND rows that keep matching after a failed
    // insert, and turns each batch into an index range seek.
    // (OBS-R4C19-E: the dead `skipped` counter is gone — every selected row
    // is either processed or failed.)
        let cursor = 0;

        for (;;) {
            assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);

            const remainingScanBudget = Math.max(SEMANTIC_SCAN_LIMIT - processed - failed, 0);
            if (remainingScanBudget === 0) {
                logScanLimitReached();
                break;
            }

        // Select processed images without an embedding row AT THE TARGET
        // model_version. A row embedded under a DIFFERENT version (e.g. a stub
        // row when running --production) still matches and gets re-embedded.
        // filename_original is needed for --production to resolve the original
        // file path the SAME way the upload hook (image-queue.ts) does; it is
        // cheap to select unconditionally and stub mode simply ignores it.
            const rows = await db
                .select({ id: images.id, filenameOriginal: images.filename_original })
                .from(images)
                .where(
                    and(
                        eq(images.processed, true),
                        gt(images.id, cursor),
                        notExists(
                            db.select({ imageId: imageEmbeddings.imageId })
                                .from(imageEmbeddings)
                                .where(and(
                                    eq(imageEmbeddings.imageId, images.id),
                                    eq(imageEmbeddings.modelVersion, TARGET_MODEL_VERSION),
                                )),
                        ),
                    ),
                )
                .orderBy(asc(images.id))
                .limit(Math.min(BATCH_SIZE, remainingScanBudget));

            if (rows.length === 0) break;
            cursor = rows[rows.length - 1].id;

            // Process with bounded concurrency
            for (let i = 0; i < rows.length; i += BATCH_CONCURRENCY) {
                const chunk = rows.slice(i, i + BATCH_CONCURRENCY);
                await Promise.all(chunk.map(async ({ id, filenameOriginal }) => {
                    try {
                        assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);
                        let embedding: Float32Array;
                        if (PRODUCTION_FLAG) {
                            if (!filenameOriginal) { failed++; failedImageIds.push(id); return; }
                            const originalPath = await resolveOriginalUploadPath(filenameOriginal);
                            if (!originalPath) { failed++; failedImageIds.push(id); return; }
                            embedding = await embedImageReal(originalPath);
                        } else {
                            embedding = embedImageStub(id);
                        }
                        // AGG-C10-01: store the RAW 2048-byte float32 buffer (not base64) so
                        // the read path (decodeEmbeddingColumn) round-trips it from MEDIUMBLOB.
                        const embeddingValue = embeddingToBuffer(embedding);
                        assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME);
                        await db.insert(imageEmbeddings)
                            .values({
                                imageId: id,
                                embedding: embeddingValue,
                                modelVersion: TARGET_MODEL_VERSION,
                            })
                            .onDuplicateKeyUpdate({
                                set: {
                                    embedding: embeddingValue,
                                    modelVersion: TARGET_MODEL_VERSION,
                                },
                            });
                        processed++;
                        if (processed % 100 === 0) {
                            console.log(`[backfill-clip-embeddings] Processed ${processed} images…`);
                        }
                    } catch (err) {
                        console.error(`[backfill-clip-embeddings] Failed for image ${id}:`, err);
                        failed++;
                        failedImageIds.push(id);
                    }
                }));
            }

            if (processed + failed >= SEMANTIC_SCAN_LIMIT) {
                logScanLimitReached();
                break;
            }

            if (rows.length < BATCH_SIZE) break;
        }

        console.log(`[backfill-clip-embeddings] Done. mode=${PRODUCTION_FLAG ? 'production' : 'stub'} processed=${processed} failed=${failed}`);
        if (failedImageIds.length > 0) {
            console.error(`[backfill-clip-embeddings] Failed image ids: ${failedImageIds.join(', ')}`);
        }
        return failed > 0 ? 1 : 0;
    } finally {
        if (semanticBackfillLockHeld) {
            await lockConn.query('SELECT RELEASE_LOCK(?)', [LOCK_SEMANTIC_EMBEDDING_BACKFILL]).catch((err) => {
                console.debug('[backfill-clip-embeddings] RELEASE_LOCK failed:', err);
            });
        }
        lockConn.release();
    }
}

main().then((exitCode) => {
    process.exit(exitCode);
}).catch((err) => {
    console.error('[backfill-clip-embeddings] Fatal error:', err);
    process.exit(1);
});
