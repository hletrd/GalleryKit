import PQueue from 'p-queue';
import path from 'path';
import fs from 'fs/promises';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { connection, db, images, sessions, imageEmbeddings } from '@/db';
import { eq, and, sql, asc, gt, notInArray } from 'drizzle-orm';
import { processImageFormats, deleteImageVariants, IMAGE_PIPELINE_VERSION } from '@/lib/process-image';
import type { ImageQualitySettings } from '@/lib/process-image';
import type { JpegChromaSubsampling } from '@/lib/gallery-config-shared';
import { UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG, resolveOriginalUploadPath } from '@/lib/upload-paths';
import { getGalleryConfig } from '@/lib/gallery-config';
import { drainProcessingQueueForShutdown } from '@/lib/queue-shutdown';
import { purgeOldBuckets } from '@/lib/rate-limit';
import { purgeOldAuditLog } from '@/lib/audit';
import { cleanOrphanedTopicTempFiles } from '@/lib/process-topic-image';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { isValidFilename } from '@/lib/validation';
import { getImageProcessingLockName } from '@/lib/advisory-locks';
import { generateCaption } from '@/lib/caption-generator';
import { embedImageStub } from '@/lib/clip-inference';
import { embeddingToBuffer, CLIP_MODEL_VERSION } from '@/lib/clip-embeddings';
import { toMySqlDateTime } from '@/lib/mysql-datetime';

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
/** Tracks whether one-time bootstrap cleanup has run in this process. */
let bootstrapCleanupRun = false;
const CLAIM_RETRY_DELAY_MS = 5000;
const BOOTSTRAP_BATCH_SIZE = 500;
const BOOTSTRAP_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_MAP_SIZE = 10000;
/** Maximum number of permanently-failed IDs to track. FIFO eviction when exceeded. */
const MAX_PERMANENTLY_FAILED_IDS = 1000;

/** Prune retry Maps to prevent unbounded growth from abandoned jobs.
 *
 *  Eviction is FIFO (insertion-order via Map.keys() iteration), not LRU.
 *  This is acceptable for a single-writer topology: recently-accessed
 *  entries are not moved to the end of iteration order, so a frequently-
 *  retried low-id job at the head of the Map is evicted first. For the
 *  bounded sizes used here (MAX_RETRY_MAP_SIZE = 10000) and a personal-
 *  gallery scale, FIFO is sufficient — the Maps rarely approach capacity.
 */
// C9-MED-02: collect-then-delete pattern (matching BoundedMap.prune()
// and C8-MED-01) for consistency with the project convention. ES6
// guarantees Map deletion during for-of iteration is safe, but the
// explicit collect-then-delete pattern is clearer for reviewers.
function pruneRetryMaps(state: ProcessingQueueState) {
    for (const map of [state.retryCounts, state.claimRetryCounts, state.lastErrors] as const) {
        if (map.size <= MAX_RETRY_MAP_SIZE) continue;
        const excess = map.size - MAX_RETRY_MAP_SIZE;
        const evictKeys: number[] = [];
        for (const key of map.keys()) {
            if (evictKeys.length >= excess) break;
            evictKeys.push(key);
        }
        for (const key of evictKeys) {
            map.delete(key);
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
    topic?: string | null;
    quality?: ImageQualitySettings;
    imageSizes?: number[];
    iccProfileName?: string | null;
    // R6-H1: full color signals for bootstrap NCLX preservation. ProcessImageFormats
    // consumes colorPrimaries; the remaining fields future-proof the bootstrap.
    colorSignals?: {
        colorPrimaries?: string | null;
        transferFunction?: string | null;
        matrixCoefficients?: string | null;
        isHdr?: boolean;
        hasGainMap?: boolean;
    } | null;
    // US-P52: EXIF hints for caption stub / future ONNX inference
    camera_model?: string | null;
    capture_date?: string | null;
};

export type ProcessingQueueState = {
    queue: PQueue;
    enqueued: Set<number>;
    retryCounts: Map<number, number>;
    claimRetryCounts: Map<number, number>;
    /** C7-DEBUG-01: last error message per job ID for permanent-failure diagnostics. */
    lastErrors: Map<number, string>;
    /** C1F-DB-02: IDs of images that have permanently failed processing (MAX_RETRIES exceeded).
     *  These are excluded from bootstrap re-scans to prevent infinite re-enqueue loops. */
    permanentlyFailedIds: Set<number>;
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
            // One image-processing job can already encode AVIF/WebP/JPEG and
            // use multiple libvips workers. Default to one foreground-friendly
            // job per web process; operators can raise QUEUE_CONCURRENCY after
            // sizing it together with SHARP_CONCURRENCY.
            queue: new PQueue({ concurrency: Number(process.env.QUEUE_CONCURRENCY) || 1 }),
            enqueued: new Set<number>(),
            retryCounts: new Map<number, number>(),
            claimRetryCounts: new Map<number, number>(),
            lastErrors: new Map<number, string>(),
            permanentlyFailedIds: new Set<number>(),
            bootstrapped: false,
            shuttingDown: false,
            bootstrapContinuationScheduled: false,
            bootstrapCursorId: null,
        };
    }

    return globalWithQueue[processingQueueKey]!;
};

function getProcessingLockName(jobId: number) {
    return getImageProcessingLockName(jobId);
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
    queue: Pick<PQueue, 'pause' | 'clear' | 'onIdle'> = state.queue,
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
    // C11-MED-02: skip permanently-failed images so claim-retry timers
    // don't re-enqueue a job that already exceeded MAX_RETRIES.
    if (state.permanentlyFailedIds.has(job.id)) {
        console.debug(`[Queue] Skipping job ${job.id} — permanently failed`);
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
                    state.bootstrapped = false;
                    state.bootstrapCursorId = null;
                    scheduleBootstrapRetry(state, `[Queue] Job ${job.id} could not acquire a processing claim after ${claimRetries} attempts.`);
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
            const [check] = await db.select({ id: images.id, topic: images.topic }).from(images)
                .where(and(eq(images.id, job.id), eq(images.processed, false)));
            if (!check) {
                console.debug(`[Queue] Image ${job.id} no longer pending, skipping`);
                return;
            }

            const originalPath = await resolveOriginalUploadPath(job.filenameOriginal);

            try {
                await fs.access(originalPath);
            } catch (err) {
                throw new Error(`[Queue] Original file not found for job ${job.id}: ${originalPath}`, {
                    cause: err,
                });
            }

            // Pass file path so Sharp uses native mmap instead of pinning on the heap.
            // Prefer upload-time snapshots so one accepted upload action cannot
            // straddle later admin config changes while it waits in the queue.
            let quality: ImageQualitySettings | undefined = job.quality;
            let imageSizes: number[] | undefined = job.imageSizes;
            let autoAltTextEnabled = false;
            let forceSrgbDerivatives = false;
            // C3-A6: chroma values flow as the narrow JpegChromaSubsampling
            // union end-to-end (gallery-config → here → process-image) so
            // process-image's encode site no longer needs the runtime cast.
            let wideGamutJpegChroma: JpegChromaSubsampling | undefined;
            let avifEffort: number | undefined;
            // C2-A5 / C2-A6: SDR JPEG chroma + wide-gamut max source pixels
            let sdrJpegChroma: JpegChromaSubsampling | undefined;
            let wideGamutMaxSourcePixels: number | undefined;
            if (!quality && !imageSizes) {
                try {
                    const config = await getGalleryConfig();
                    quality = {
                        webp: config.imageQualityWebp,
                        avif: config.imageQualityAvif,
                        jpeg: config.imageQualityJpeg,
                    };
                    imageSizes = config.imageSizes.length > 0 ? config.imageSizes : undefined;
                    autoAltTextEnabled = config.autoAltTextEnabled;
                    forceSrgbDerivatives = config.forceSrgbDerivatives;
                    wideGamutJpegChroma = config.wideGamutJpegChroma;
                    avifEffort = config.avifEffort;
                    sdrJpegChroma = config.sdrJpegChroma;
                    wideGamutMaxSourcePixels = config.wideGamutMaxSourcePixels;
                } catch {
                    // DB unavailable during processing — use Sharp defaults (90/85/90)
                }
            }
            const { wasDownscaled, avif10bit } = await processImageFormats(
                originalPath,
                job.filenameWebp,
                job.filenameAvif,
                job.filenameJpeg,
                job.width,
                quality,
                imageSizes,
                job.iccProfileName,
                forceSrgbDerivatives,
                job.colorSignals,
                wideGamutJpegChroma,
                avifEffort,
                sdrJpegChroma,
                wideGamutMaxSourcePixels,
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
            // R10-H2: clear any prior processing_error / failed_at on success.
            const [updateResult] = await db.update(images)
                .set({ processed: true, pipeline_version: IMAGE_PIPELINE_VERSION, was_downscaled: wasDownscaled, avif_10bit: avif10bit, processing_error: null, failed_at: null })
                .where(and(eq(images.id, job.id), eq(images.processed, false)));

            if (updateResult.affectedRows === 0) {
                // Image was deleted during processing.
                // AGG-C4-04 (run-9 c1 CRT-2): pass `[]` (empty sizes) so
                // deleteImageVariants does a FULL directory scan and removes
                // every `{name}_{size}{ext}` variant — including derivatives at
                // NON-default configured sizes (image_sizes is admin-tunable up
                // to 8 sizes). The 2-arg form defaulted to DEFAULT_OUTPUT_SIZES
                // and would have orphaned non-default-size variants on this
                // delete-during-processing race. Matches the backfill runner's
                // cleanupDeletedMidReencodeVariants and the sidecar (AGG-C4-02).
                console.debug(`[Queue] Image ${job.id} was deleted during processing, cleaning up`);
                await Promise.all([
                    deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp, []),
                    deleteImageVariants(UPLOAD_DIR_AVIF, job.filenameAvif, []),
                    deleteImageVariants(UPLOAD_DIR_JPEG, job.filenameJpeg, []),
                ]);
                return;
            }

            // US-P52: Fire-and-forget caption hook. MUST NOT block the queue job.
            // Runs after Sharp processing completes and processed=true is committed.
            generateCaption(
                { imageId: job.id, camera_model: job.camera_model, capture_date: job.capture_date },
                autoAltTextEnabled,
            ).then(async (caption) => {
                if (caption === null) return;
                try {
                    await db.update(images)
                        .set({ alt_text_suggested: caption })
                        .where(eq(images.id, job.id));
                    console.debug(`[Queue] Caption stored for image ${job.id}`);
                } catch (captionErr) {
                    console.warn(`[Queue] Failed to store caption for image ${job.id}:`, captionErr);
                }
            }).catch((captionErr) => {
                console.warn(`[Queue] Caption generation failed for image ${job.id}:`, captionErr);
            });

            // US-P51: Fire-and-forget embedding hook. MUST NOT block the queue job.
            // Runs after Sharp processing + processed=true is committed. Gated by
            // semantic_search_mode admin setting so it is a no-op by default.
            //
            // BUG-R5C2-05 / AGG-R5C2-09 — stub-embedding contract:
            //   In 'stub' mode this DELIBERATELY writes embeddings. They power the
            //   admin opt-in demo semantic search (the /api/search/semantic route
            //   serves 'stub' mode, with a visitor-facing "experimental" disclaimer).
            //   These vectors are NOT semantically meaningful — `embedImageStub`
            //   produces a deterministic-but-random vector keyed off the image id,
            //   so cosine similarity between a query and an image embedding is
            //   essentially random. This is intentional, consistent with the
            //   plan-319 honesty posture (stub-serving stays; we make it honest).
            //
            //   Provenance: every row records `modelVersion: CLIP_MODEL_VERSION`
            //   (currently 'stub-sha256-v1', see lib/clip-embeddings.ts). A future
            //   REAL CLIP encoder MUST NOT trust or serve rows whose `modelVersion`
            //   is a stub identifier — gate reads/writes on the model version and
            //   re-embed (or ignore) stub rows rather than overwriting blindly.
            //   The `model_version` column on image_embeddings already distinguishes
            //   stub rows, so no schema migration is needed for that future encoder
            //   to tell stub vectors apart from production ones.
            void (async () => {
                let semanticMode: 'disabled' | 'stub' | 'production' = 'disabled';
                try {
                    const cfg = await getGalleryConfig();
                    semanticMode = cfg.semanticSearchMode;
                } catch {
                    // DB unavailable — skip silently
                }
                if (semanticMode === 'disabled') return;
                try {
                    const embedding = embedImageStub(job.id);
                    const buf = embeddingToBuffer(embedding);
                    const base64 = buf.toString('base64');
                    await db.insert(imageEmbeddings)
                        .values({
                            imageId: job.id,
                            embedding: base64,
                            modelVersion: CLIP_MODEL_VERSION,
                        })
                        .onDuplicateKeyUpdate({
                            set: {
                                embedding: base64,
                                modelVersion: CLIP_MODEL_VERSION,
                            },
                        });
                    console.debug(`[Queue] Embedding stored for image ${job.id}`);
                } catch (embedErr) {
                    console.warn(`[Queue] Failed to store embedding for image ${job.id}:`, embedErr);
                }
            })();

            console.debug(`[Queue] Job ${job.id} complete`);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`Background processing failed for ${job.id}`, err);
            state.lastErrors.set(job.id, errorMsg);
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
            const lastErrorMsg = state.lastErrors.get(job.id) ?? 'unknown';
            console.error(`[Queue] Job ${job.id} failed ${MAX_RETRIES} times, giving up. Last error: ${lastErrorMsg}`);
            // C1F-DB-02: Track permanently failed IDs so the bootstrap query
            // can exclude them, preventing infinite re-enqueue loops. The set
            // is capped (MAX_PERMANENTLY_FAILED_IDS) with FIFO eviction to
            // prevent unbounded memory growth.
            state.permanentlyFailedIds.add(job.id);
            if (state.permanentlyFailedIds.size > MAX_PERMANENTLY_FAILED_IDS) {
                const oldest = state.permanentlyFailedIds.values().next().value;
                if (oldest !== undefined) {
                    state.permanentlyFailedIds.delete(oldest);
                    // C7-MED-05: clean up associated retry maps when evicting from
                    // permanentlyFailedIds, so stale entries don't accumulate in
                    // claimRetryCounts and retryCounts for IDs that are no longer
                    // tracked as permanently failed.
                    state.claimRetryCounts.delete(oldest);
                    state.retryCounts.delete(oldest);
                    state.lastErrors.delete(oldest);
                }
            }
            // R10-H2: persist processing error and failure timestamp to DB
            // so the admin dashboard can surface failed images with retry.
            // R4C2 COR-R4C2-01: failed_at is a DATETIME(mode:'string') column;
            // the prior `new Date().toISOString()` value carries a trailing
            // `Z` that MySQL strict mode rejects with ER 1292, so this UPDATE
            // threw on EVERY permanent failure and the catch below swallowed
            // it — processing_error AND failed_at never persisted and the
            // admin failed-images panel stayed empty. toMySqlDateTime renders
            // the accepted 'YYYY-MM-DD HH:MM:SS' literal.
            try {
                const truncatedError = lastErrorMsg.length > 512
                    ? lastErrorMsg.slice(0, 512)
                    : lastErrorMsg;
                await db.update(images)
                    .set({ processing_error: truncatedError, failed_at: toMySqlDateTime(new Date()) })
                    .where(eq(images.id, job.id));
            } catch (dbErr) {
                console.error(`[Queue] Failed to persist processing error for job ${job.id}:`, dbErr);
            }

            // Reschedule bootstrap to discover other pending images. The
            // permanently-failed ID is excluded from the bootstrap query
            // (notInArray on permanentlyFailedIds), so this does NOT cause
            // infinite re-enqueue of the same failed job — only other
            // unprocessed images that are not in the permanently-failed set
            // will be discovered on the next scan (C16-AGG-01).
            state.bootstrapped = false;
            state.bootstrapCursorId = null;
            scheduleBootstrapRetry(state, `[Queue] Job ${job.id} remains pending after ${MAX_RETRIES} processing attempts.`);
        } finally {
            await releaseImageProcessingClaim(job.id, lockConnection).catch((err) => {
                console.debug(`[Queue] Failed to release lock for job ${job.id}:`, err);
            });
            if (!retried) {
                state.enqueued.delete(job.id);
                state.retryCounts.delete(job.id);
                state.lastErrors.delete(job.id);
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
        // C1F-DB-02: exclude permanently-failed IDs from the bootstrap query so
        // they are not re-enqueued indefinitely.
        const baseConditions = [eq(images.processed, false)];
        if (state.bootstrapCursorId !== null) {
            baseConditions.push(gt(images.id, state.bootstrapCursorId));
        }
        if (state.permanentlyFailedIds.size > 0) {
            baseConditions.push(notInArray(images.id, [...state.permanentlyFailedIds]));
        }
        const pendingWhere = baseConditions.length === 1
            ? baseConditions[0]
            : and(...baseConditions);
        const pending = await db.select({
            id: images.id,
            filename_original: images.filename_original,
            filename_webp: images.filename_webp,
            filename_avif: images.filename_avif,
            filename_jpeg: images.filename_jpeg,
            width: images.width,
            topic: images.topic,
            capture_date: images.capture_date,
            camera_model: images.camera_model,
            icc_profile_name: images.icc_profile_name,
            color_primaries: images.color_primaries,
            transfer_function: images.transfer_function,
            matrix_coefficients: images.matrix_coefficients,
            is_hdr: images.is_hdr,
            has_gain_map: images.has_gain_map,
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
                topic: image.topic,
                capture_date: image.capture_date,
                camera_model: image.camera_model,
                iccProfileName: image.icc_profile_name,
                colorSignals: {
                    colorPrimaries: image.color_primaries,
                    transferFunction: image.transfer_function,
                    matrixCoefficients: image.matrix_coefficients,
                    isHdr: image.is_hdr,
                    hasGainMap: image.has_gain_map,
                },
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
        if (!bootstrapCleanupRun) {
            bootstrapCleanupRun = true;
            purgeExpiredSessions().catch(err => console.debug('purgeExpiredSessions failed:', err));
            purgeOldBuckets().catch(err => console.debug('purgeOldBuckets failed:', err));
            purgeOldAuditLog().catch(err => console.debug('purgeOldAuditLog failed:', err));
        }
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
    queue: Pick<PQueue, 'pause' | 'clear' | 'onIdle'> = state.queue,
) {
    // COR-R4C12-01: clear() MUST precede the onIdle() await. p-queue emits
    // `idle` only when size === 0 && pending === 0, and a PAUSED queue never
    // starts queued tasks — so `pause(); await onIdle()` deadlocked forever
    // whenever >= 1 job was queued behind the in-flight one (batch-upload
    // N >= 2 photos at QUEUE_CONCURRENCY=1, then restore mid-processing).
    // The hung restoreDatabase action then never reached its finally:
    // endRestoreMaintenance() never ran and the restore/upload advisory-lock
    // connections were held forever, wedging uploads, processing, and all
    // future restores until a container restart. Clearing first drops the
    // queued jobs (intended — the post-restore bootstrap re-discovers
    // `processed = false` rows via `bootstrapped = false` below) and lets
    // `idle` fire as soon as the in-flight job (if any) completes. Mirrors
    // drainProcessingQueueForShutdown's pause -> clear -> onIdle order.
    // (History: c6627ec8 swapped the original, deadlock-free onPendingZero()
    // for onIdle() without reordering; its message inverted p-queue's actual
    // semantics — onPendingZero waits for RUNNING tasks, ignoring queued
    // ones, and is emitted unconditionally when pending hits 0.)
    // New-job interleaving between clear() and onIdle() is impossible here:
    // beginRestoreMaintenance() runs before quiesce, so
    // enqueueImageProcessing rejects, and the queue is paused anyway.
    queue.pause();
    queue.clear();
    await queue.onIdle();
    state.enqueued.clear();
    state.retryCounts.clear();
    state.claimRetryCounts.clear();
    state.lastErrors.clear();
    // C1F-DB-02: clear permanently-failed IDs on restore — the DB restore
    // may fix the underlying issue (e.g., corrupt original file replaced).
    state.permanentlyFailedIds.clear();
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
