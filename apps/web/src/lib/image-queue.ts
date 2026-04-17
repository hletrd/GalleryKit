import PQueue from 'p-queue';
import path from 'path';
import fs from 'fs/promises';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { connection, db, images, sessions } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { processImageFormats, deleteImageVariants, UPLOAD_DIR_ORIGINAL, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '@/lib/process-image';
import { drainProcessingQueueForShutdown } from '@/lib/queue-shutdown';
import { purgeOldBuckets } from '@/lib/rate-limit';

const processingQueueKey = Symbol.for('gallerykit.imageProcessingQueue');
const CLAIM_RETRY_DELAY_MS = 5000;

export type ImageProcessingJob = {
    id: number;
    filenameOriginal: string;
    filenameWebp: string;
    filenameAvif: string;
    filenameJpeg: string;
    width: number;
};

export type ProcessingQueueState = {
    queue: PQueue;
    enqueued: Set<number>;
    retryCounts: Map<number, number>;
    bootstrapped: boolean;
    shuttingDown: boolean;
    shutdownPromise?: Promise<void>;
    gcInterval?: ReturnType<typeof setInterval>;
};

export const getProcessingQueueState = (): ProcessingQueueState => {
    const globalWithQueue = globalThis as typeof globalThis & {
        [processingQueueKey]?: ProcessingQueueState;
    };

    if (!globalWithQueue[processingQueueKey]) {
        globalWithQueue[processingQueueKey] = {
            queue: new PQueue({ concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2 }),
            enqueued: new Set<number>(),
            retryCounts: new Map<number, number>(),
            bootstrapped: false,
            shuttingDown: false,
        };
    }

    return globalWithQueue[processingQueueKey]!;
};

function getProcessingLockName(jobId: number) {
    return `gallerykit:image-processing:${jobId}`;
}

async function acquireImageProcessingClaim(jobId: number): Promise<PoolConnection | null> {
    const lockConnection = await connection.getConnection();
    try {
        const [rows] = await lockConnection.query<(RowDataPacket & { acquired: number | null })[]>(
            'SELECT GET_LOCK(?, 0) AS acquired',
            [getProcessingLockName(jobId)],
        );
        if (rows[0]?.acquired === 1) {
            return lockConnection;
        }
    } catch (err) {
        lockConnection.release();
        throw err;
    }

    lockConnection.release();
    return null;
}

async function releaseImageProcessingClaim(jobId: number, lockConnection: PoolConnection | null) {
    if (!lockConnection) return;

    try {
        await lockConnection.query('SELECT RELEASE_LOCK(?)', [getProcessingLockName(jobId)]);
    } finally {
        lockConnection.release();
    }
}

export async function shutdownImageProcessingQueue(
    state: ProcessingQueueState = getProcessingQueueState(),
    queue: Pick<PQueue, 'pause' | 'clear' | 'onPendingZero'> = state.queue,
) {
    await drainProcessingQueueForShutdown(state, queue);
}

export const enqueueImageProcessing = (job: ImageProcessingJob) => {
    const state = getProcessingQueueState();
    if (state.shuttingDown) {
        console.debug(`[Queue] Ignoring job ${job.id} during shutdown`);
        return;
    }
    if (state.enqueued.has(job.id)) return;

    console.debug(`[Queue] Enqueuing job ${job.id}`);
    state.enqueued.add(job.id);
    state.queue.start();

    const MAX_RETRIES = 3;

    state.queue.add(async () => {
        console.debug(`[Queue] Processing job ${job.id} started`);
        let lockConnection: PoolConnection | null = null;
        try {
            lockConnection = await acquireImageProcessingClaim(job.id);
            if (!lockConnection) {
                console.debug(`[Queue] Job ${job.id} already claimed by another worker, retrying later`);
                const retryTimer = setTimeout(() => {
                    enqueueImageProcessing(job);
                }, CLAIM_RETRY_DELAY_MS);
                retryTimer.unref?.();
                return;
            }

            // US-009: Claim check — verify the row still exists and is unprocessed
            const [check] = await db.select({ id: images.id }).from(images)
                .where(and(eq(images.id, job.id), eq(images.processed, false)));
            if (!check) {
                console.debug(`[Queue] Image ${job.id} no longer pending, skipping`);
                return;
            }

            const originalPath = path.join(UPLOAD_DIR_ORIGINAL, job.filenameOriginal);

            try {
                await fs.access(originalPath);
            } catch {
                console.error(`[Queue] File not found for job ${job.id}: ${originalPath}`);
                return;
            }

            // Pass file path so Sharp uses native mmap instead of pinning on the heap.
            await processImageFormats(
                originalPath,
                job.filenameWebp,
                job.filenameAvif,
                job.filenameJpeg,
                job.width,
            );

            // US-001: Conditional update — only mark processed if still unprocessed (not deleted)
            const [updateResult] = await db.update(images)
                .set({ processed: true })
                .where(and(eq(images.id, job.id), eq(images.processed, false)));

            if (updateResult.affectedRows === 0) {
                // Image was deleted during processing
                console.debug(`[Queue] Image ${job.id} was deleted during processing, cleaning up`);
                await Promise.all([
                    deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp),
                    deleteImageVariants(UPLOAD_DIR_AVIF, job.filenameAvif),
                    deleteImageVariants(UPLOAD_DIR_JPEG, job.filenameJpeg),
                ]);
                return;
            }

            console.debug(`[Queue] Job ${job.id} complete`);
            // revalidatePath removed from per-job callback to avoid ISR cache
            // thrashing — uploading 10 images was triggering 11 homepage
            // invalidations. The single revalidatePath after the upload loop
            // (in uploadImages) is sufficient.
        } catch (err) {
            console.error(`Background processing failed for ${job.id}`, err);
            const retries = (state.retryCounts.get(job.id) || 0) + 1;
            if (retries < MAX_RETRIES) {
                state.retryCounts.set(job.id, retries);
                console.warn(`[Queue] Retrying job ${job.id} (attempt ${retries + 1}/${MAX_RETRIES})`);
                state.enqueued.delete(job.id);
                enqueueImageProcessing(job);
                return;
            }
            state.retryCounts.delete(job.id);
            console.error(`[Queue] Job ${job.id} failed ${MAX_RETRIES} times, giving up`);
        } finally {
            await releaseImageProcessingClaim(job.id, lockConnection).catch((err) => {
                console.debug(`[Queue] Failed to release lock for job ${job.id}:`, err);
            });
            state.enqueued.delete(job.id);
        }
    });
};

export async function purgeExpiredSessions() {
    try {
        await db.delete(sessions).where(sql`${sessions.expiresAt} < NOW()`);
    } catch (err) {
        console.error('Failed to purge expired sessions', err);
    }
}

export const bootstrapImageProcessingQueue = async () => {
    const state = getProcessingQueueState();
    if (state.bootstrapped || state.shuttingDown) return;

    try {
        // Select only columns needed for enqueue — skip blob-like fields for potentially hundreds of rows.
        const pending = await db.select({
            id: images.id,
            filename_original: images.filename_original,
            filename_webp: images.filename_webp,
            filename_avif: images.filename_avif,
            filename_jpeg: images.filename_jpeg,
            width: images.width,
        }).from(images).where(eq(images.processed, false));
        for (const image of pending) {
            enqueueImageProcessing({
                id: image.id,
                filenameOriginal: image.filename_original,
                filenameWebp: image.filename_webp,
                filenameAvif: image.filename_avif,
                filenameJpeg: image.filename_jpeg,
                width: image.width,
            });

        }
        state.bootstrapped = true;

        // US-004: Purge expired sessions and stale rate-limit buckets on startup and periodically
        purgeExpiredSessions();
        purgeOldBuckets().catch(err => console.debug('purgeOldBuckets failed:', err));
        if (state.gcInterval) clearInterval(state.gcInterval);
        state.gcInterval = setInterval(() => {
            purgeExpiredSessions();
            purgeOldBuckets().catch(err => console.debug('purgeOldBuckets failed:', err));
        }, 60 * 60 * 1000); // every hour
    } catch (err: unknown) {
        // Suppress connection refused errors during build/startup
        if (!(err instanceof Error && (('code' in err && (err as { code: string }).code === 'ECONNREFUSED') || (err.cause && typeof err.cause === 'object' && 'code' in err.cause && (err.cause as { code: string }).code === 'ECONNREFUSED')))) {
            console.error('Failed to bootstrap image processing queue', err);
        } else {
             console.warn('Could not connect to database to bootstrap queue (ECONNREFUSED). Skipping.');
        }
    }
};

// Auto-bootstrap when this module is imported
void bootstrapImageProcessingQueue();
