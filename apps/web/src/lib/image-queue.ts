import PQueue from 'p-queue';
import path from 'path';
import fs from 'fs/promises';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { connection, db, images, sessions } from '@/db';
import { eq, and, sql, asc, gt } from 'drizzle-orm';
import { processImageFormats, deleteImageVariants } from '@/lib/process-image';
import type { ImageQualitySettings } from '@/lib/process-image';
import { UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG, resolveOriginalUploadPath } from '@/lib/upload-paths';
import { getGalleryConfig } from '@/lib/gallery-config';
import { drainProcessingQueueForShutdown } from '@/lib/queue-shutdown';
import { purgeOldBuckets } from '@/lib/rate-limit';
import { purgeOldAuditLog } from '@/lib/audit';
import { cleanOrphanedTopicTempFiles } from '@/lib/process-topic-image';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { isValidFilename } from '@/lib/validation';

/**
 * Remove orphaned .tmp files from upload directories.
 * These are created during atomic rename in processImageFormats and may
 * persist if the process crashes between link and rename.
 */
async function cleanOrphanedTmpFiles(): Promise<void> {
    const dirs = [UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG];
    // C7R-RPL-09 / AGG7R-13: scan directories in parallel. Prior
    // sequential for-loop stacked readdir+unlink latency per dir at
    // bootstrap; with 3 dirs and independent I/O the parallel form
    // shaves ~10-30ms off startup without any correctness impact.
    await Promise.all(dirs.map(async (dir) => {
        try {
            const entries = await fs.readdir(dir);
            const tmpFiles = entries.filter(f => f.endsWith('.tmp'));
            if (tmpFiles.length === 0) return;
            // C6R-RPL-04 / AGG6R-03: log AFTER unlink so the count reflects
            // files actually removed (not files merely discovered). Prior
            // behavior claimed "Removing N" before any unlink ran, which
            // misrepresents the operation if unlinks quietly fail.
            const settled = await Promise.allSettled(
                tmpFiles.map(f => fs.unlink(path.join(dir, f))),
            );
            const removed = settled.filter(r => r.status === 'fulfilled').length;
            const failures = settled.length - removed;
            if (failures > 0) {
                console.warn(`[Cleanup] Removed ${removed}/${settled.length} orphaned .tmp files from ${dir} (${failures} unlink errors)`);
            } else {
                console.debug(`[Cleanup] Removed ${removed} orphaned .tmp files from ${dir}`);
            }
        } catch (err) {
            // C8R-RPL-04 / AGG8R-08: narrow the catch. ENOENT is
            // expected at bootstrap before the upload dirs exist;
            // anything else (EACCES, EIO, EMFILE, ...) signals a
            // misconfiguration or runtime fault that an operator
            // needs to see in the logs. The prior broad `catch {}`
            // silenced all of these.
            const code = err && typeof err === 'object' && 'code' in err
                ? (err as { code?: unknown }).code
                : null;
            if (code === 'ENOENT') {
                return;
            }
            console.warn(`[Cleanup] Failed to scan ${dir} for orphaned .tmp files:`, err);
        }
    }));
}

const processingQueueKey = Symbol.for('gallerykit.imageProcessingQueue');
const CLAIM_RETRY_DELAY_MS = 5000;
const BOOTSTRAP_BATCH_SIZE = 500;
const BOOTSTRAP_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_MAP_SIZE = 10000;

/** Prune retry Maps to prevent unbounded growth from abandoned jobs. */
function pruneRetryMaps(state: ProcessingQueueState) {
    for (const map of [state.retryCounts, state.claimRetryCounts] as const) {
        if (map.size <= MAX_RETRY_MAP_SIZE) continue;
        const excess = map.size - MAX_RETRY_MAP_SIZE;
        let evicted = 0;
        for (const key of map.keys()) {
            if (evicted >= excess) break;
            map.delete(key);
            evicted++;
        }
    }
}

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
    claimRetryCounts: Map<number, number>;
    bootstrapped: boolean;
    shuttingDown: boolean;
    shutdownPromise?: Promise<void>;
    gcInterval?: ReturnType<typeof setInterval>;
    bootstrapRetryTimer?: ReturnType<typeof setTimeout>;
    bootstrapContinuationScheduled?: boolean;
    bootstrapCursorId: number | null;
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
            claimRetryCounts: new Map<number, number>(),
            bootstrapped: false,
            shuttingDown: false,
            bootstrapContinuationScheduled: false,
            bootstrapCursorId: null,
        };
    }

    return globalWithQueue[processingQueueKey]!;
};

function getProcessingLockName(jobId: number) {
    return `gallerykit:image-processing:${jobId}`;
}

function hasValidJobFilenames(job: ImageProcessingJob) {
    return isValidFilename(job.filenameOriginal)
        && isValidFilename(job.filenameWebp)
        && isValidFilename(job.filenameAvif)
        && isValidFilename(job.filenameJpeg);
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
    if (state.shuttingDown || isRestoreMaintenanceActive()) {
        console.debug(`[Queue] Ignoring job ${job.id} while processing is unavailable`);
        return;
    }
    if (!hasValidJobFilenames(job)) {
        console.error(`[Queue] Rejecting job ${job.id} with invalid filename metadata`);
        return;
    }
    if (state.enqueued.has(job.id)) return;

    console.debug(`[Queue] Enqueuing job ${job.id}`);
    state.enqueued.add(job.id);
    state.queue.start();

    const MAX_RETRIES = 3;

    state.queue.add(async () => {
        console.debug(`[Queue] Processing job ${job.id} started`);
        let retried = false;
        let claimRetryScheduled = false;
        let lockConnection: PoolConnection | null = null;
        try {
            lockConnection = await acquireImageProcessingClaim(job.id);
            if (!lockConnection) {
                const claimRetries = (state.claimRetryCounts.get(job.id) || 0) + 1;
                const MAX_CLAIM_RETRIES = 10;
                if (claimRetries >= MAX_CLAIM_RETRIES) {
                    state.claimRetryCounts.delete(job.id);
                    state.enqueued.delete(job.id);
                    console.error(`[Queue] Job ${job.id} failed to acquire claim ${claimRetries} times, giving up`);
                    return;
                }
                state.claimRetryCounts.set(job.id, claimRetries);
                const delay = CLAIM_RETRY_DELAY_MS * Math.min(claimRetries, 5); // escalating up to 25s
                console.debug(`[Queue] Job ${job.id} already claimed by another worker, retrying later (attempt ${claimRetries}/${MAX_CLAIM_RETRIES})`);
                const retryTimer = setTimeout(() => {
                    enqueueImageProcessing(job);
                }, delay);
                retryTimer.unref?.();
                claimRetryScheduled = true;
                return;
            }

            // US-009: Claim check — verify the row still exists and is unprocessed
            const [check] = await db.select({ id: images.id }).from(images)
                .where(and(eq(images.id, job.id), eq(images.processed, false)));
            if (!check) {
                console.debug(`[Queue] Image ${job.id} no longer pending, skipping`);
                return;
            }

            const originalPath = await resolveOriginalUploadPath(job.filenameOriginal);

            try {
                await fs.access(originalPath);
            } catch {
                console.error(`[Queue] File not found for job ${job.id}: ${originalPath}`);
                return;
            }

            // Pass file path so Sharp uses native mmap instead of pinning on the heap.
            // Read admin-configured quality and size settings from DB (cached per SSR request).
            let quality: ImageQualitySettings | undefined;
            let imageSizes: number[] | undefined;
            try {
                const config = await getGalleryConfig();
                quality = {
                    webp: config.imageQualityWebp,
                    avif: config.imageQualityAvif,
                    jpeg: config.imageQualityJpeg,
                };
                imageSizes = config.imageSizes.length > 0 ? config.imageSizes : undefined;
            } catch {
                // DB unavailable during processing — use Sharp defaults (90/85/90)
            }
            await processImageFormats(
                originalPath,
                job.filenameWebp,
                job.filenameAvif,
                job.filenameJpeg,
                job.width,
                quality,
                imageSizes,
            );

            // Verify all 3 output formats exist and are non-zero before marking processed
            const verifyFile = (filePath: string) => fs.stat(filePath).then(s => s.size > 0).catch(() => false);
            const webpPath = path.join(UPLOAD_DIR_WEBP, job.filenameWebp);
            const avifPath = path.join(UPLOAD_DIR_AVIF, job.filenameAvif);
            const jpegPath = path.join(UPLOAD_DIR_JPEG, job.filenameJpeg);
            const [webpOk, avifOk, jpegOk] = await Promise.all([
                verifyFile(webpPath),
                verifyFile(avifPath),
                verifyFile(jpegPath),
            ]);
            if (!webpOk || !avifOk || !jpegOk) {
                throw new Error(`Image processing incomplete for ${job.id}: webp=${webpOk} avif=${avifOk} jpeg=${jpegOk}`);
            }

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
                retried = true;
                return;
            }
            state.retryCounts.delete(job.id);
            console.error(`[Queue] Job ${job.id} failed ${MAX_RETRIES} times, giving up`);
        } finally {
            await releaseImageProcessingClaim(job.id, lockConnection).catch((err) => {
                console.debug(`[Queue] Failed to release lock for job ${job.id}:`, err);
            });
            if (!retried) {
                state.enqueued.delete(job.id);
                state.retryCounts.delete(job.id);
                if (!claimRetryScheduled) {
                    state.claimRetryCounts.delete(job.id);
                }
            }
            pruneRetryMaps(state);
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

function isConnectionRefusedError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const directCode = 'code' in err ? (err as { code?: unknown }).code : undefined;
    if (directCode === 'ECONNREFUSED') return true;
    const cause = err.cause;
    return !!(
        cause
        && typeof cause === 'object'
        && 'code' in cause
        && (cause as { code?: unknown }).code === 'ECONNREFUSED'
    );
}

function scheduleBootstrapRetry(state: ProcessingQueueState, reason: string) {
    if (state.bootstrapRetryTimer || state.shuttingDown || isRestoreMaintenanceActive()) return;
    console.warn(`${reason} Retrying image queue bootstrap in ${BOOTSTRAP_RETRY_DELAY_MS / 1000}s.`);
    state.bootstrapRetryTimer = setTimeout(() => {
        state.bootstrapRetryTimer = undefined;
        bootstrapImageProcessingQueue().catch((err) => console.debug('bootstrapImageProcessingQueue retry failed:', err));
    }, BOOTSTRAP_RETRY_DELAY_MS);
    state.bootstrapRetryTimer.unref?.();
}

function scheduleBootstrapContinuation(state: ProcessingQueueState) {
    if (state.bootstrapContinuationScheduled) return;
    state.bootstrapContinuationScheduled = true;
    state.queue.onIdle()
        .then(() => {
            state.bootstrapContinuationScheduled = false;
            if (!state.shuttingDown && !isRestoreMaintenanceActive()) {
                bootstrapImageProcessingQueue().catch((err) => console.debug('bootstrapImageProcessingQueue continuation failed:', err));
            }
        })
        .catch((err) => {
            state.bootstrapContinuationScheduled = false;
            console.debug('bootstrap continuation scheduling failed:', err);
        });
}

export const bootstrapImageProcessingQueue = async () => {
    const state = getProcessingQueueState();
    if (state.bootstrapped || state.shuttingDown || isRestoreMaintenanceActive() || state.bootstrapContinuationScheduled) return;

    try {
        if (state.bootstrapRetryTimer) {
            clearTimeout(state.bootstrapRetryTimer);
            state.bootstrapRetryTimer = undefined;
        }
        // Select only columns needed for enqueue and cap the in-memory backlog per bootstrap pass.
        // Continue from the highest scanned id so a small set of permanently failing low-id rows cannot
        // monopolize every bootstrap batch and starve later pending rows.
        const pendingWhere = state.bootstrapCursorId === null
            ? eq(images.processed, false)
            : and(eq(images.processed, false), gt(images.id, state.bootstrapCursorId));
        const pending = await db.select({
            id: images.id,
            filename_original: images.filename_original,
            filename_webp: images.filename_webp,
            filename_avif: images.filename_avif,
            filename_jpeg: images.filename_jpeg,
            width: images.width,
        })
            .from(images)
            .where(pendingWhere)
            .orderBy(asc(images.id))
            .limit(BOOTSTRAP_BATCH_SIZE);
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
        const lastPending = pending.at(-1);
        if (lastPending) {
            state.bootstrapCursorId = lastPending.id;
        }
        state.bootstrapped = pending.length < BOOTSTRAP_BATCH_SIZE;
        if (state.bootstrapped) {
            state.bootstrapCursorId = null;
        } else {
            scheduleBootstrapContinuation(state);
        }

        // Clean up orphaned .tmp files from crashed image processing runs.
        // These are created during atomic rename in processImageFormats and
        // may persist if the process crashes between link and rename.
        cleanOrphanedTmpFiles().catch(err => console.debug('cleanOrphanedTmpFiles failed:', err));
        cleanOrphanedTopicTempFiles().catch(err => console.debug('cleanOrphanedTopicTempFiles failed:', err));

        // US-004: Purge expired sessions, stale rate-limit buckets, and old audit log entries on startup and periodically
        purgeExpiredSessions().catch(err => console.debug('purgeExpiredSessions failed:', err));
        purgeOldBuckets().catch(err => console.debug('purgeOldBuckets failed:', err));
        purgeOldAuditLog().catch(err => console.debug('purgeOldAuditLog failed:', err));
        if (state.gcInterval) clearInterval(state.gcInterval);
        state.gcInterval = setInterval(() => {
            purgeExpiredSessions().catch(err => console.debug('purgeExpiredSessions failed:', err));
            purgeOldBuckets().catch(err => console.debug('purgeOldBuckets failed:', err));
            purgeOldAuditLog().catch(err => console.debug('purgeOldAuditLog failed:', err));
            pruneRetryMaps(state);
        }, 60 * 60 * 1000); // every hour
        state.gcInterval.unref?.();
    } catch (err: unknown) {
        if (isConnectionRefusedError(err)) {
            scheduleBootstrapRetry(state, 'Could not connect to database to bootstrap queue (ECONNREFUSED).');
        } else {
            console.error('Failed to bootstrap image processing queue', err);
            scheduleBootstrapRetry(state, 'Image queue bootstrap failed.');
        }
    }
};

export async function quiesceImageProcessingQueueForRestore(
    state: ProcessingQueueState = getProcessingQueueState(),
    queue: Pick<PQueue, 'pause' | 'clear' | 'onPendingZero'> = state.queue,
) {
    queue.pause();
    await queue.onPendingZero();
    queue.clear();
    state.enqueued.clear();
    state.retryCounts.clear();
    state.claimRetryCounts.clear();
    state.bootstrapped = false;
    state.bootstrapContinuationScheduled = false;
    state.bootstrapCursorId = null;
    if (state.bootstrapRetryTimer) {
        clearTimeout(state.bootstrapRetryTimer);
        state.bootstrapRetryTimer = undefined;
    }
}

export async function resumeImageProcessingQueueAfterRestore(
    state: ProcessingQueueState = getProcessingQueueState(),
    queue: Pick<PQueue, 'start'> = state.queue,
) {
    if (state.shuttingDown) {
        return;
    }

    queue.start();
    await bootstrapImageProcessingQueue();
}
