import PQueue from 'p-queue';
import path from 'path';
import fs from 'fs/promises';
import { db, images, sessions } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { processImageFormats, deleteImageVariants, UPLOAD_DIR_ORIGINAL, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '@/lib/process-image';

const processingQueueKey = Symbol.for('gallerykit.imageProcessingQueue');

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
    bootstrapped: boolean;
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
            bootstrapped: false,
        };
    }

    return globalWithQueue[processingQueueKey]!;
};

export const enqueueImageProcessing = (job: ImageProcessingJob) => {
    const state = getProcessingQueueState();
    if (state.enqueued.has(job.id)) return;

    console.debug(`[Queue] Enqueuing job ${job.id}`);
    state.enqueued.add(job.id);
    state.queue.start();

    // Explicitly add to queue
    state.queue.add(async () => {
        console.debug(`[Queue] Processing job ${job.id} started`);
        try {
            // US-009: Claim check — verify the row still exists and is unprocessed
            const [check] = await db.select({ id: images.id }).from(images)
                .where(and(eq(images.id, job.id), eq(images.processed, false)));
            if (!check) {
                console.debug(`[Queue] Image ${job.id} no longer pending, skipping`);
                return;
            }

            const originalPath = path.join(UPLOAD_DIR_ORIGINAL, job.filenameOriginal);

            // Check if file exists before processing to avoid errors
            try {
                await fs.access(originalPath);
            } catch {
                console.error(`[Queue] File not found for job ${job.id}: ${originalPath}`);
                return;
            }

            // Pass file path (not buffer) so Sharp uses native mmap — avoids
            // pinning the entire image (up to 200MB) on the Node.js heap.
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
                // Image was deleted during processing — clean up generated format files
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
        } finally {
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
    if (state.bootstrapped) return;

    try {
        // Select only the columns needed for enqueue — avoids fetching blob-like fields
        // (blur_data_url, description) for potentially hundreds of unprocessed images.
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

        // US-004: Purge expired sessions on startup and periodically
        purgeExpiredSessions();
        if (state.gcInterval) clearInterval(state.gcInterval);
        state.gcInterval = setInterval(purgeExpiredSessions, 60 * 60 * 1000); // every hour
    } catch (err: unknown) {
        // Suppress connection refused errors during build/startup to avoid noise
        if (!(err instanceof Error && (('code' in err && (err as { code: string }).code === 'ECONNREFUSED') || (err.cause && typeof err.cause === 'object' && 'code' in err.cause && (err.cause as { code: string }).code === 'ECONNREFUSED')))) {
            console.error('Failed to bootstrap image processing queue', err);
        } else {
             console.warn('Could not connect to database to bootstrap queue (ECONNREFUSED). Skipping.');
        }
    }
};

// Auto-bootstrap when this module is imported
void bootstrapImageProcessingQueue();
