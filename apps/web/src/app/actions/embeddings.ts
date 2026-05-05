'use server';

/**
 * US-P51: Backfill server action for CLIP semantic search embeddings.
 *
 * Iterates processed images that lack an embedding row, generates embeddings
 * via the stub inference (or real ONNX when replaced), and upserts them.
 * Concurrency is bounded at 2 to avoid overloading the server.
 */

import { db, images, imageEmbeddings } from '@/db';
import { eq, notExists, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { isAdmin } from '@/app/actions/auth';
import { requireSameOriginAdmin } from '@/lib/action-guards';
import { embedImageStub } from '@/lib/clip-inference';
import { embeddingToBuffer, CLIP_MODEL_VERSION, SEMANTIC_SCAN_LIMIT } from '@/lib/clip-embeddings';

const BACKFILL_CONCURRENCY = 2;
const BACKFILL_BATCH_SIZE = 100;

export type BackfillEmbeddingsResult =
    | { status: 'ok'; processed: number; skipped: number }
    | { status: 'unauthorized' | 'error'; message: string };

export async function backfillClipEmbeddings(): Promise<BackfillEmbeddingsResult> {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { status: 'unauthorized', message: t('unauthorized') };
    const originError = await requireSameOriginAdmin();
    if (originError) return { status: 'unauthorized', message: originError };

    try {
        // Select processed images without an embedding row (up to SEMANTIC_SCAN_LIMIT to bound the operation)
        const pending = await db
            .select({ id: images.id })
            .from(images)
            .where(
                and(
                    eq(images.processed, true),
                    notExists(
                        db.select({ imageId: imageEmbeddings.imageId })
                            .from(imageEmbeddings)
                            .where(eq(imageEmbeddings.imageId, images.id)),
                    ),
                ),
            )
            .limit(SEMANTIC_SCAN_LIMIT);

        let processed = 0;
        let skipped = 0;

        // Process in batches with bounded concurrency
        for (let batchStart = 0; batchStart < pending.length; batchStart += BACKFILL_BATCH_SIZE) {
            const batch = pending.slice(batchStart, batchStart + BACKFILL_BATCH_SIZE);

            // Run BACKFILL_CONCURRENCY items concurrently within each batch
            for (let i = 0; i < batch.length; i += BACKFILL_CONCURRENCY) {
                const chunk = batch.slice(i, i + BACKFILL_CONCURRENCY);
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
                    } catch {
                        skipped++;
                    }
                }));
            }
        }

        return { status: 'ok', processed, skipped };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return { status: 'error', message };
    }
}
