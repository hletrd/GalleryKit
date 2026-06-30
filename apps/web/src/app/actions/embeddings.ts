'use server';

/**
 * US-P51: Backfill server action for CLIP semantic search embeddings.
 *
 * Iterates processed images that lack an embedding row for the active model
 * version and upserts embeddings. Disabled mode is a no-op, stub mode writes
 * deterministic stub vectors, and operator-gated production mode uses the real
 * local CLIP encoder with PRODUCTION_MODEL_VERSION. Concurrency is bounded at 2
 * to avoid overloading the server.
 */

import { db, connection, images, imageEmbeddings } from '@/db';
import type { RowDataPacket } from 'mysql2/promise';
import { eq, notExists, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { requireSameOriginAdmin } from '@/lib/action-guards';
import { embedImageStub } from '@/lib/clip-inference';
import { embedImageReal } from '@/lib/clip-model';
import { embeddingToBuffer, STUB_MODEL_VERSION, PRODUCTION_MODEL_VERSION, SEMANTIC_SCAN_LIMIT } from '@/lib/clip-embeddings';
import { resolveOriginalUploadPath } from '@/lib/upload-paths';
import { getGalleryConfig } from '@/lib/gallery-config';
import { createResetAtBoundedMap } from '@/lib/bounded-map';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { LOCK_SEMANTIC_EMBEDDING_BACKFILL, isAdvisoryLockAcquired } from '@/lib/advisory-locks';

const BACKFILL_CONCURRENCY = 2;
const BACKFILL_BATCH_SIZE = 100;
const BACKFILL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const BACKFILL_MAX_KEYS = 100;
const backfillRateLimit = createResetAtBoundedMap<string>(BACKFILL_MAX_KEYS);

function pruneBackfillRateLimit(now: number) {
    backfillRateLimit.prune(now);
}

function preIncrementBackfillAttempt(key: string, now: number): boolean {
    pruneBackfillRateLimit(now);
    const entry = backfillRateLimit.get(key);
    if (!entry || entry.resetAt <= now) {
        backfillRateLimit.set(key, { count: 1, resetAt: now + BACKFILL_WINDOW_MS });
        return false;
    }
    // R15C15 CR-15-01: BoundedMap.get() returns a shallow copy, so `entry.count++`
    // mutated the discarded copy and this limit never advanced past 1. There is
    // no DB-backed fallback here (admin-gated action), so write back via .set().
    const next = { count: entry.count + 1, resetAt: entry.resetAt };
    backfillRateLimit.set(key, next);
    return next.count > 1;
}

export type BackfillEmbeddingsResult =
    | { status: 'ok'; processed: number; skipped: number }
    | { status: 'unauthorized' | 'error'; message: string };

export async function backfillClipEmbeddings(): Promise<BackfillEmbeddingsResult> {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { status: 'error', message: maintenanceError };
    const originError = await requireSameOriginAdmin();
    if (originError) return { status: 'unauthorized', message: originError };
    if (!(await isAdmin())) return { status: 'unauthorized', message: t('unauthorized') };

    // Rate-limit: once per hour per admin user
    const user = await getCurrentUser();
    const rateLimitKey = user?.id ? `backfill:${user.id}` : 'backfill:anonymous';
    if (preIncrementBackfillAttempt(rateLimitKey, Date.now())) {
        return { status: 'error', message: t('backfillRateLimited') };
    }

    // AGG-L1 (run-6 cycle-2): make this action MODE-AWARE, matching the two
    // authoritative embedding writers (image-queue.ts queue hook +
    // scripts/backfill-clip-embeddings.ts). Previously it unconditionally wrote
    // STUB_MODEL_VERSION rows even in production mode — so if it were ever wired
    // to a UI control while the deployment was in production, it would populate
    // rows the production search route (which reads PRODUCTION_MODEL_VERSION)
    // silently ignores. Now: disabled → no-op; stub → stub encoder; production →
    // real encoder + PRODUCTION_MODEL_VERSION (resolving the original upload
    // path per image, like the sidecar).
    // NOTE: no UI currently wires this action; the sidecar script remains the
    // canonical backfill entry point. This keeps the action honest if it is
    // ever surfaced. The dark-by-default guard means production only runs when
    // the operator has set the mode + SEMANTIC_SEARCH_ALLOW_PRODUCTION env.
    let semanticMode: 'disabled' | 'stub' | 'production' = 'disabled';
    try {
        semanticMode = (await getGalleryConfig()).semanticSearchMode;
    } catch {
        // DB unavailable — treat as disabled (no-op) rather than guessing.
    }
    if (semanticMode === 'disabled') {
        return { status: 'ok', processed: 0, skipped: 0 };
    }

    // AGG-C8-05 (run-6 cycle-8): hoist modelVersion ABOVE the candidate query so the
    // notExists subquery can filter on it. The canonical sidecar
    // (scripts/backfill-clip-embeddings.ts) selects images lacking a row FOR THE
    // ACTIVE model_version; without that filter here, an image carrying a stub-version
    // row was excluded even in production mode, so this action could never upgrade
    // stub→production rows (it would report processed:0). The action is still unwired
    // from any UI — the sidecar remains canonical — but this keeps the selection
    // honest and matching the sidecar if it is ever surfaced.
    const modelVersion = semanticMode === 'production' ? PRODUCTION_MODEL_VERSION : STUB_MODEL_VERSION;

    const lockConn = await connection.getConnection();
    let semanticBackfillLockHeld = false;
    try {
        const [lockRows] = await lockConn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            'SELECT GET_LOCK(?, 0) AS acquired',
            [LOCK_SEMANTIC_EMBEDDING_BACKFILL],
        );
        if (!isAdvisoryLockAcquired(lockRows[0]?.acquired)) {
            return { status: 'error', message: t('restoreInProgress') };
        }
        semanticBackfillLockHeld = true;

        const maintenanceAfterLock = getRestoreMaintenanceMessage(t('restoreInProgress'));
        if (maintenanceAfterLock) return { status: 'error', message: maintenanceAfterLock };

        // Select processed images without an embedding row FOR THE ACTIVE model_version
        // (bounded by SEMANTIC_SCAN_LIMIT), mirroring the sidecar's per-version selection.
        const pending = await db
            .select({ id: images.id, filenameOriginal: images.filename_original })
            .from(images)
            .where(
                and(
                    eq(images.processed, true),
                    notExists(
                        db.select({ imageId: imageEmbeddings.imageId })
                            .from(imageEmbeddings)
                            .where(
                                and(
                                    eq(imageEmbeddings.imageId, images.id),
                                    eq(imageEmbeddings.modelVersion, modelVersion),
                                ),
                            ),
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
                await Promise.all(chunk.map(async ({ id, filenameOriginal }) => {
                    try {
                        let embedding: Float32Array;
                        if (semanticMode === 'production') {
                            if (!filenameOriginal) { skipped++; return; }
                            const originalPath = await resolveOriginalUploadPath(filenameOriginal);
                            if (!originalPath) { skipped++; return; }
                            embedding = await embedImageReal(originalPath);
                        } else {
                            embedding = embedImageStub(id);
                        }
                        // AGG-C10-01: store the RAW buffer (not base64) so the read path
                        // (decodeEmbeddingColumn) round-trips it. The Drizzle `text()`
                        // column is a MEDIUMBLOB approximation, so cast through `unknown`.
                        const buf = embeddingToBuffer(embedding);
                        const embeddingValue = buf as unknown as string;
                        await db.insert(imageEmbeddings)
                            .values({
                                imageId: id,
                                embedding: embeddingValue,
                                modelVersion,
                            })
                            .onDuplicateKeyUpdate({
                                set: {
                                    embedding: embeddingValue,
                                    modelVersion,
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
        // R4C5 I18N-R4C5-03: raw err.message can carry driver/SQL internals
        // and is English-only on a localized admin surface. Localized
        // generic error across the boundary, detail to the server log
        // (C6-RPF-03 / R4C4-05 lineage).
        console.error('CLIP embedding backfill failed', err);
        return { status: 'error', message: t('embeddingBackfillFailed') };
    } finally {
        if (semanticBackfillLockHeld) {
            await lockConn.query('SELECT RELEASE_LOCK(?)', [LOCK_SEMANTIC_EMBEDDING_BACKFILL]).catch((err) => {
                console.debug('RELEASE_LOCK (semantic embedding backfill action) failed:', err);
            });
        }
        lockConn.release();
    }
}
