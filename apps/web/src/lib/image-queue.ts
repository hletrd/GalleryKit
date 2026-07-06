import PQueue from 'p-queue';
import path from 'path';
import fs from 'fs/promises';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { connection, db, images, sessions, imageEmbeddings } from '@/db';
import { eq, and, sql, asc, gt, notInArray, isNull } from 'drizzle-orm';
import { processImageFormats, deleteImageVariants, IMAGE_PIPELINE_VERSION } from '@/lib/process-image';
import type { ImageQualitySettings } from '@/lib/process-image';
import { MIN_IMAGE_SIZE, type JpegChromaSubsampling } from '@/lib/gallery-config-shared';
import { UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG, resolveOriginalUploadPath } from '@/lib/upload-paths';
import { getGalleryConfig, type GalleryConfig } from '@/lib/gallery-config';
import { drainProcessingQueueForShutdown } from '@/lib/queue-shutdown';
import { purgeOldBuckets } from '@/lib/rate-limit';
import { purgeOldAuditLog } from '@/lib/audit';
import { purgeOldViewEvents } from '@/lib/view-retention';
import { cleanOrphanedTopicTempFiles } from '@/lib/process-topic-image';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { isValidFilename, hasMySQLErrorCode } from '@/lib/validation';

/** C1-19 (run-10 cycle-1, TRC-02): FK rejection for an image deleted while its
 *  un-awaited embedding write was in flight — expected, not an error. */
function isMissingImageFkError(err: unknown): boolean {
    return hasMySQLErrorCode(err, 'ER_NO_REFERENCED_ROW_2')
        || hasMySQLErrorCode(err, 'ER_NO_REFERENCED_ROW');
}
import { getImageProcessingLockName, isAdvisoryLockAcquired } from '@/lib/advisory-locks';
import { generateCaption } from '@/lib/caption-generator';
import { embedImageStub } from '@/lib/clip-inference';
import { embeddingToBuffer, STUB_MODEL_VERSION, PRODUCTION_MODEL_VERSION } from '@/lib/clip-embeddings';
import { embedImageReal } from '@/lib/clip-model';
import { toMySqlDateTime } from '@/lib/mysql-datetime';
import { parseBoundedPositiveInteger } from '@/lib/env';

export const ORPHANED_DERIVATIVE_TEMP_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Remove stale orphaned derivative temp/backup files from upload directories.
 * Fresh files may belong to a sidecar backfill that overlaps a web restart, so
 * cleanup is age-gated instead of deleting every matching filename at startup.
 */
export async function cleanOrphanedTmpFiles(now: number = Date.now()): Promise<void> {
    const dirs = [UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG];
    // C7R-RPL-09 / AGG7R-13: scan directories in parallel. Prior
    // sequential for-loop stacked readdir+unlink latency per dir at
    // bootstrap; with 3 dirs and independent I/O the parallel form
    // shaves ~10-30ms off startup without any correctness impact.
    await Promise.all(dirs.map(async (dir) => {
        try {
            const entries = await fs.readdir(dir);
            const tempFiles = entries.filter(f => f.endsWith('.tmp') || f.endsWith('.bak'));
            if (tempFiles.length === 0) return;
            const staleFiles: string[] = [];
            await Promise.all(tempFiles.map(async (f) => {
                const filePath = path.join(dir, f);
                try {
                    const stat = await fs.stat(filePath);
                    if (now - stat.mtimeMs >= ORPHANED_DERIVATIVE_TEMP_MIN_AGE_MS) {
                        staleFiles.push(f);
                    }
                } catch (err) {
                    const code = err && typeof err === 'object' && 'code' in err
                        ? (err as { code?: unknown }).code
                        : null;
                    if (code !== 'ENOENT') throw err;
                }
            }));
            if (staleFiles.length === 0) return;
            // C6R-RPL-04 / AGG6R-03: log AFTER unlink so the count reflects
            // files actually removed (not files merely discovered). Prior
            // behavior claimed "Removing N" before any unlink ran, which
            // misrepresents the operation if unlinks quietly fail.
            const settled = await Promise.allSettled(
                staleFiles.map(f => fs.unlink(path.join(dir, f))),
            );
            const removed = settled.filter(r => r.status === 'fulfilled').length;
            const failures = settled.length - removed;
            if (failures > 0) {
                console.warn(`[Cleanup] Removed ${removed}/${settled.length} stale orphaned derivative temp files from ${dir} (${failures} unlink errors)`);
            } else {
                console.debug(`[Cleanup] Removed ${removed} stale orphaned derivative temp files from ${dir}`);
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
            console.warn(`[Cleanup] Failed to scan ${dir} for stale orphaned derivative temp files:`, err);
        }
    }));
}

const processingQueueKey = Symbol.for('gallerykit.imageProcessingQueue');
/** Tracks whether one-time bootstrap cleanup has run in this process. */
let bootstrapCleanupRun = false;
const CLAIM_RETRY_DELAY_MS = 5000;
const BOOTSTRAP_BATCH_SIZE = 500;
const BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE = 50;
const BOOTSTRAP_EMBEDDING_RETRY_CONCURRENCY = 2;
const BOOTSTRAP_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_MAP_SIZE = 10000;
/** Maximum number of permanently-failed IDs to track. FIFO eviction when exceeded. */
const MAX_PERMANENTLY_FAILED_IDS = 1000;
const DEFAULT_DB_POOL_CONNECTION_LIMIT = 10;
export const IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS = (poolLimit: number): number =>
    Math.max(3, Math.ceil(poolLimit / 2));

export function resolveImageQueueConcurrency(
    requested: number,
    poolLimit: number = DEFAULT_DB_POOL_CONNECTION_LIMIT,
): number {
    const limit = Number.isFinite(poolLimit) ? poolLimit : DEFAULT_DB_POOL_CONNECTION_LIMIT;
    const reserved = IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS(limit);
    // Each worker can hold one advisory-lock connection while also needing a
    // transient DB connection for row checks and updates.
    const cap = Math.max(1, Math.floor((limit - reserved) / 2));
    const req = Math.max(1, Math.floor(requested) || 1);
    return Math.min(req, cap);
}

const REQUESTED_QUEUE_CONCURRENCY = parseBoundedPositiveInteger(
    process.env.QUEUE_CONCURRENCY,
    { fallback: 1, max: 8 },
);
const QUEUE_CONCURRENCY = resolveImageQueueConcurrency(REQUESTED_QUEUE_CONCURRENCY);

export type ProcessingSettingsSnapshot = {
    quality: ImageQualitySettings;
    imageSizes?: number[];
    forceSrgbDerivatives: boolean;
    wideGamutJpegChroma: JpegChromaSubsampling;
    avifEffort: number;
    sdrJpegChroma: JpegChromaSubsampling;
    wideGamutMaxSourcePixels: number;
    autoAltTextEnabled: boolean;
    semanticSearchMode: 'disabled' | 'stub' | 'production';
};

export function createProcessingSettingsSnapshot(config: GalleryConfig): ProcessingSettingsSnapshot {
    return {
        quality: {
            webp: config.imageQualityWebp,
            avif: config.imageQualityAvif,
            jpeg: config.imageQualityJpeg,
        },
        imageSizes: config.imageSizes.length > 0 ? config.imageSizes : undefined,
        forceSrgbDerivatives: config.forceSrgbDerivatives,
        wideGamutJpegChroma: config.wideGamutJpegChroma,
        avifEffort: config.avifEffort,
        sdrJpegChroma: config.sdrJpegChroma,
        wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
        autoAltTextEnabled: config.autoAltTextEnabled,
        semanticSearchMode: config.semanticSearchMode,
    };
}

function applyRuntimeSemanticGate(mode: 'disabled' | 'stub' | 'production'): 'disabled' | 'stub' | 'production' {
    if (mode === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') {
        return 'disabled';
    }
    return mode;
}

export function serializeProcessingSettingsSnapshot(snapshot: ProcessingSettingsSnapshot): string {
    return JSON.stringify(snapshot);
}

function isProcessingSettingsSnapshot(value: unknown): value is ProcessingSettingsSnapshot {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<ProcessingSettingsSnapshot>;
    return Boolean(
        candidate.quality
        && typeof candidate.quality.webp === 'number'
        && typeof candidate.quality.avif === 'number'
        && typeof candidate.quality.jpeg === 'number'
        && (candidate.imageSizes === undefined || (
            Array.isArray(candidate.imageSizes)
            && candidate.imageSizes.every((size) => Number.isInteger(size) && size >= MIN_IMAGE_SIZE)
        ))
        && typeof candidate.forceSrgbDerivatives === 'boolean'
        && ['4:4:4', '4:2:2', '4:2:0'].includes(String(candidate.wideGamutJpegChroma))
        && typeof candidate.avifEffort === 'number'
        && ['4:4:4', '4:2:2', '4:2:0'].includes(String(candidate.sdrJpegChroma))
        && typeof candidate.wideGamutMaxSourcePixels === 'number'
        && typeof candidate.autoAltTextEnabled === 'boolean'
        && ['disabled', 'stub', 'production'].includes(String(candidate.semanticSearchMode))
    );
}

function parseProcessingSettingsSnapshot(raw: string | null): ProcessingSettingsSnapshot | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as unknown;
        return isProcessingSettingsSnapshot(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function applyProcessingSettingsSnapshot(job: ImageProcessingJob, snapshot: ProcessingSettingsSnapshot): ImageProcessingJob {
    return {
        ...job,
        quality: snapshot.quality,
        imageSizes: snapshot.imageSizes,
        forceSrgbDerivatives: snapshot.forceSrgbDerivatives,
        wideGamutJpegChroma: snapshot.wideGamutJpegChroma,
        avifEffort: snapshot.avifEffort,
        sdrJpegChroma: snapshot.sdrJpegChroma,
        wideGamutMaxSourcePixels: snapshot.wideGamutMaxSourcePixels,
        autoAltTextEnabled: snapshot.autoAltTextEnabled,
        semanticSearchMode: snapshot.semanticSearchMode,
    };
}

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
    // CR-R9C6-01: the upload path always supplies quality+imageSizes, so the
    // `if (!quality && !imageSizes)` config-load gate below never enters on a
    // real upload. Carry the remaining 6 admin-tunable processing settings on
    // the job (snapshotted at upload time, same intent as quality/imageSizes)
    // so a fresh upload honors them. The bootstrap path omits these (and
    // quality/imageSizes), so the gate still loads them from config there.
    forceSrgbDerivatives?: boolean;
    wideGamutJpegChroma?: JpegChromaSubsampling;
    avifEffort?: number;
    sdrJpegChroma?: JpegChromaSubsampling;
    wideGamutMaxSourcePixels?: number;
    autoAltTextEnabled?: boolean;
    // Historical processing snapshots include this field. Keep accepting it so
    // pending rows deserialize, but post-processing embedding writes resolve the
    // current runtime semantic mode after processed=true; do not use this
    // upload-time value for embedding writes.
    semanticSearchMode?: 'disabled' | 'stub' | 'production';
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
     *  These are excluded from bootstrap re-scans to prevent infinite re-enqueue loops.
     *  A Set bounded by MAX_PERMANENTLY_FAILED_IDS (1000) with insertion-order (FIFO)
     *  eviction of the oldest entry once the cap is exceeded (see the add-site below).
     *  At personal-gallery scale the number of permanently-failed images is negligible,
     *  so the cap is rarely approached. */
    permanentlyFailedIds: Set<number>;
    bootstrapped: boolean;
    shuttingDown: boolean;
    shutdownPromise?: Promise<void>;
    gcInterval?: ReturnType<typeof setInterval>;
    bootstrapRetryTimer?: ReturnType<typeof setTimeout>;
    bootstrapContinuationScheduled?: boolean;
    bootstrapCursorId: number | null;
    sideEffects: Set<Promise<void>>;
    /** C1-06 (run-10 cycle-1, PERF-01): in-flight dedupe for the missing-embedding
     *  retry scan. Every bootstrap invocation (continuation batches, 30 s retry
     *  timers, restore resume) previously launched a NEW full scan from cursor 0;
     *  overlapping scans re-embedded the same rows and starved the shared CLIP
     *  inference queue that visitor semantic search waits on. */
    embeddingBootstrapInFlight?: Promise<void> | null;
};

export const getProcessingQueueState = (): ProcessingQueueState => {
    const globalWithQueue = globalThis as typeof globalThis & {
        [processingQueueKey]?: ProcessingQueueState;
    };

    const existing = globalWithQueue[processingQueueKey];
    // AGG-R11C11-L1: runtime shape validation — if a test or future code path
    // sets the global symbol to a non-object value, re-initialize instead of
    // crashing. Mirrors the defensive pattern in admin-backfill-runner.ts.
    // R12C12 AGG-R12-11: a bare `'queue' in existing` key-presence check let a
    // malformed `{queue: null, enqueued: …, bootstrapped: …}` global through and
    // returned corrupt state (later `state.queue.add()` TypeErrors). Validate the
    // VALUE types of the load-bearing fields, not just key presence.
    if (
        existing
        && typeof existing === 'object'
        && 'queue' in existing
        && existing.queue
        && typeof existing.queue.add === 'function'
        && existing.enqueued instanceof Set
        && 'bootstrapped' in existing
    ) {
        if (!(existing.sideEffects instanceof Set)) {
            existing.sideEffects = new Set<Promise<void>>();
        }
        return existing;
    }

    const newState: ProcessingQueueState = {
        // One image-processing job can already encode AVIF/WebP/JPEG and
        // use multiple libvips workers. Default to one foreground-friendly
        // job per web process; operators can raise QUEUE_CONCURRENCY, but the
        // effective value is clamped against the shared DB pool so foreground
        // processing cannot consume the live request reserve.
        // R16C16 CR-16-03: `|| 1` deliberately coerces 0, NaN, and unset to 1 —
        // a 0-concurrency PQueue would never drain (every upload would hang
        // unprocessed), so there is no valid 0 value to honor here.
        queue: new PQueue({ concurrency: QUEUE_CONCURRENCY }),
        enqueued: new Set<number>(),
        retryCounts: new Map<number, number>(),
        claimRetryCounts: new Map<number, number>(),
        lastErrors: new Map<number, string>(),
        permanentlyFailedIds: new Set<number>(),
        bootstrapped: false,
        shuttingDown: false,
        bootstrapContinuationScheduled: false,
        bootstrapCursorId: null,
        sideEffects: new Set<Promise<void>>(),
    };
    globalWithQueue[processingQueueKey] = newState;
    return newState;
};

function trackQueueSideEffect(state: ProcessingQueueState, task: Promise<void>) {
    state.sideEffects.add(task);
    task.finally(() => {
        state.sideEffects.delete(task);
    }).catch(() => {});
}

async function storeImageEmbeddingForMode(
    imageId: number,
    originalPath: string,
    semanticMode: 'stub' | 'production',
) {
    if (isRestoreMaintenanceActive()) {
        console.debug(`[Queue] Skipping embedding generation for image ${imageId} during restore maintenance`);
        return;
    }

    let embedding: Float32Array;
    let modelVersion: string;
    if (semanticMode === 'production') {
        embedding = await embedImageReal(originalPath);
        modelVersion = PRODUCTION_MODEL_VERSION;
    } else {
        embedding = embedImageStub(imageId);
        modelVersion = STUB_MODEL_VERSION;
    }
    // AGG-C10-01: store the RAW 2048-byte little-endian float32 buffer directly
    // into the MEDIUMBLOB. See schema.ts/image-queue embedding comments.
    if (isRestoreMaintenanceActive()) {
        console.debug(`[Queue] Skipping embedding write for image ${imageId} during restore maintenance`);
        return;
    }
    const buf = embeddingToBuffer(embedding);
    const embeddingValue = buf as unknown as string;
    await db.insert(imageEmbeddings)
        .values({
            imageId,
            embedding: embeddingValue,
            modelVersion,
        })
        .onDuplicateKeyUpdate({
            set: {
                embedding: embeddingValue,
                modelVersion,
            },
        });
    console.debug(`[Queue] Embedding stored for image ${imageId} (model=${modelVersion})`);
}

async function bootstrapMissingActiveEmbeddings(state: ProcessingQueueState) {
    let semanticMode: 'disabled' | 'stub' | 'production';
    try {
        const cfg = await getGalleryConfig();
        semanticMode = applyRuntimeSemanticGate(cfg.semanticSearchMode);
    } catch {
        return;
    }
    if (semanticMode === 'disabled') return;

    const activeModelVersion = semanticMode === 'production'
        ? PRODUCTION_MODEL_VERSION
        : STUB_MODEL_VERSION;
    let cursorId = 0;
    for (;;) {
        const rows = await db.select({
            id: images.id,
            filename_original: images.filename_original,
        })
            .from(images)
            .leftJoin(imageEmbeddings, and(
                eq(imageEmbeddings.imageId, images.id),
                eq(imageEmbeddings.modelVersion, activeModelVersion),
            ))
            .where(and(
                eq(images.processed, true),
                gt(images.id, cursorId),
                isNull(imageEmbeddings.imageId),
            ))
            .orderBy(asc(images.id))
            .limit(BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE);

        for (let i = 0; i < rows.length; i += BOOTSTRAP_EMBEDDING_RETRY_CONCURRENCY) {
            const chunk = rows.slice(i, i + BOOTSTRAP_EMBEDDING_RETRY_CONCURRENCY);
            const tasks = chunk.map((row) => (async () => {
                try {
                    if (!row.filename_original) return;
                    const originalPath = await resolveOriginalUploadPath(row.filename_original);
                    if (!originalPath) return;
                    await storeImageEmbeddingForMode(row.id, originalPath, semanticMode);
                } catch (err) {
                    console.warn(`[Queue] Failed to retry missing embedding for image ${row.id}:`, err);
                }
            })());
            for (const task of tasks) {
                trackQueueSideEffect(state, task);
            }
            await Promise.allSettled(tasks);
        }

        const lastRow = rows.at(-1);
        if (!lastRow || rows.length < BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE) {
            break;
        }
        cursorId = lastRow.id;
    }
}

async function drainQueueSideEffects(state: ProcessingQueueState) {
    while (state.sideEffects.size > 0) {
        await Promise.allSettled(Array.from(state.sideEffects));
    }
}

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
        const [rows] = await lockConnection.query<(RowDataPacket & { acquired: unknown })[]>(
            'SELECT GET_LOCK(?, 0) AS acquired',
            [getProcessingLockName(jobId)],
        );
        if (isAdvisoryLockAcquired(rows[0]?.acquired)) {
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

/**
 * Enqueue an image processing job.
 *
 * @returns `true` if the job was already enqueued or is now enqueued;
 *          `false` if the job was rejected (shutting down, restore maintenance
 *          active, invalid filenames, or permanently failed).
 */
export function enqueueImageProcessing(job: ImageProcessingJob): boolean {
    const state = getProcessingQueueState();
    if (state.shuttingDown || isRestoreMaintenanceActive()) {
        console.debug(`[Queue] Ignoring job ${job.id} while processing is unavailable`);
        return false;
    }
    if (!hasValidJobFilenames(job)) {
        console.error(`[Queue] Rejecting job ${job.id} with invalid filename metadata`);
        return false;
    }
    // C11-MED-02: skip permanently-failed images so claim-retry timers
    // don't re-enqueue a job that already exceeded MAX_RETRIES.
    if (state.permanentlyFailedIds.has(job.id)) {
        console.debug(`[Queue] Skipping job ${job.id} — permanently failed`);
        return false;
    }
    if (state.enqueued.has(job.id)) return true;

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
                    // C1-04 (run-10 cycle-1, TRC-01): claim exhaustion previously
                    // left the row processed=false with processing_error NULL, so
                    // the next bootstrap scan re-discovered and re-enqueued the
                    // same job forever with no admin-visible signal. Persist a
                    // distinguishable failure (surfaces in the admin failed-images
                    // panel with Retry) and track it as permanently failed in this
                    // process — retryFailedImage clears both on manual retry.
                    state.permanentlyFailedIds.add(job.id);
                    try {
                        await db.update(images)
                            .set({
                                processing_error: `Could not acquire the image-processing lock after ${claimRetries} attempts. Another worker may still hold gallerykit:image-processing:${job.id}; retry after it releases.`,
                                failed_at: toMySqlDateTime(new Date()),
                            })
                            .where(and(eq(images.id, job.id), eq(images.processed, false)));
                    } catch (dbErr) {
                        console.error(`[Queue] Failed to persist claim-exhaustion error for job ${job.id}:`, dbErr);
                    }
                    state.bootstrapped = false;
                    state.bootstrapCursorId = null;
                    scheduleBootstrapRetry(state, `[Queue] Job ${job.id} could not acquire a processing claim after ${claimRetries} attempts.`);
                    return;
                }
                state.claimRetryCounts.set(job.id, claimRetries);
                const delay = CLAIM_RETRY_DELAY_MS * Math.min(claimRetries, 5); // escalating up to 25s
                console.debug(`[Queue] Job ${job.id} already claimed by another worker, retrying later (attempt ${claimRetries}/${MAX_CLAIM_RETRIES})`);
                // C4-A1: Remove from enqueued BEFORE scheduling retry so the retry
                // actually re-adds the job to the queue. Without this, enqueueImageProcessing
                // hits the `state.enqueued.has(job.id)` guard at line 259 and returns
                // immediately, leaving the job stuck forever.
                state.enqueued.delete(job.id);
                const retryTimer = setTimeout(() => {
                    enqueueImageProcessing(job);
                }, delay);
                retryTimer.unref?.();
                claimRetryScheduled = true;
                return;
            }

            // C4-A2: Reset claimRetryScheduled on successful claim so the finally
            // block cleans up claimRetryCounts. Without this, a job that retries
            // claim once then succeeds leaves claimRetryScheduled=true, so
            // claimRetryCounts is never deleted.
            claimRetryScheduled = false;

            // US-009: Claim check — verify the row still exists and is unprocessed
            const [check] = await db.select({ id: images.id, topic: images.topic }).from(images)
                .where(and(eq(images.id, job.id), eq(images.processed, false)));
            if (!check) {
                console.debug(`[Queue] Image ${job.id} no longer pending, skipping`);
                return;
            }

            const originalPath = await resolveOriginalUploadPath(job.filenameOriginal);
            if (!originalPath) {
                throw new Error(`[Queue] Original file not found for job ${job.id}: no candidate path exists`);
            }

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
            // CR-R9C6-01: seed all 6 processing settings from the upload-time
            // job snapshot. The upload path now supplies these, so a fresh
            // upload honors them WITHOUT entering the config-load gate below
            // (which it never does because it always supplies quality).
            // `?? false` / leaving undefined preserves the prior default
            // behavior for jobs that don't carry the field.
            let autoAltTextEnabled = job.autoAltTextEnabled ?? false;
            let forceSrgbDerivatives = job.forceSrgbDerivatives ?? false;
            // C3-A6: chroma values flow as the narrow JpegChromaSubsampling
            // union end-to-end (gallery-config → here → process-image) so
            // process-image's encode site no longer needs the runtime cast.
            let wideGamutJpegChroma: JpegChromaSubsampling | undefined = job.wideGamutJpegChroma;
            let avifEffort: number | undefined = job.avifEffort;
            // C2-A5 / C2-A6: SDR JPEG chroma + wide-gamut max source pixels
            let sdrJpegChroma: JpegChromaSubsampling | undefined = job.sdrJpegChroma;
            let wideGamutMaxSourcePixels: number | undefined = job.wideGamutMaxSourcePixels;
            if (!quality && !imageSizes) {
                // Bootstrap / legacy re-enqueue path: the job carries none of the
                // processing settings, so load them all from current config.
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
                .set({ processed: true, pipeline_version: IMAGE_PIPELINE_VERSION, was_downscaled: wasDownscaled, avif_10bit: avif10bit, processing_error: null, failed_at: null, processing_settings_json: null })
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

            // US-P52: Tracked caption side effect. It does not block the queue
            // job's processed=true transition, but restore/shutdown drains it.
            // Runs after Sharp processing completes and processed=true is committed.
            trackQueueSideEffect(state, (async () => {
                try {
                    const caption = await generateCaption(
                        { imageId: job.id, camera_model: job.camera_model, capture_date: job.capture_date },
                        autoAltTextEnabled,
                    );
                    if (caption === null) return;
                    await db.update(images)
                        .set({ alt_text_suggested: caption })
                        .where(eq(images.id, job.id));
                    console.debug(`[Queue] Caption stored for image ${job.id}`);
                } catch (captionErr) {
                    console.warn(`[Queue] Caption generation failed for image ${job.id}:`, captionErr);
                }
            })());

            // US-P51: Tracked embedding side effect. It does not block the
            // queue job's processed=true transition, but restore/shutdown drains it.
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
            //   Provenance: every row records `modelVersion: STUB_MODEL_VERSION`
            //   (currently 'stub-sha256-v1', see lib/clip-embeddings.ts). The REAL
            //   CLIP encoder MUST NOT trust or serve rows whose `modelVersion`
            //   is a stub identifier — gate reads/writes on the model version and
            //   re-embed (or ignore) stub rows rather than overwriting blindly.
            //   The `model_version` column on image_embeddings already distinguishes
            //   stub rows, so no schema migration is needed for that future encoder
            //   to tell stub vectors apart from production ones.
            trackQueueSideEffect(state, (async () => {
                let semanticMode: 'disabled' | 'stub' | 'production' = 'disabled';
                try {
                    const cfg = await getGalleryConfig();
                    semanticMode = applyRuntimeSemanticGate(cfg.semanticSearchMode);
                } catch {
                    // DB unavailable — skip silently. Semantic embedding mode is
                    // resolved at write time, not from the upload-time processing
                    // snapshot, so a mode flip while a job waits in the queue cannot
                    // write stale stub rows over the active production model.
                }
                if (semanticMode === 'disabled') return;
                try {
                    await storeImageEmbeddingForMode(job.id, originalPath, semanticMode);
                } catch (embedErr) {
                    // C1-19 (run-10 cycle-1, TRC-02): the embedding write is
                    // intentionally un-awaited by the main job, so deleting a
                    // just-processed image can race it into an expected FK
                    // rejection (the image row is gone; imageEmbeddings.imageId
                    // cascades on delete). That is normal day-2 admin behavior,
                    // not a bug — log it at debug, keep real failures at warn.
                    if (isMissingImageFkError(embedErr)) {
                        console.debug(`[Queue] Skipped embedding for image ${job.id} — image was deleted before the embedding write landed.`);
                    } else {
                        console.warn(`[Queue] Failed to store embedding for image ${job.id}:`, embedErr);
                    }
                }
            })());

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
                // C1-20 (run-10 cycle-1, DBG-02): code-point-safe truncation —
                // a raw UTF-16 .slice can bisect a surrogate pair at offset 512,
                // storing an unpaired surrogate that mysql2 serializes as U+FFFD.
                // Same pattern as truncateCodePoints (caption-generator.ts) and
                // admin-tokens.ts label truncation.
                const truncatedError = lastErrorMsg.length > 512
                    ? Array.from(lastErrorMsg).slice(0, 512).join('')
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
            // C1-04 (run-10 cycle-1, TRC-01): a swallowed RELEASE_LOCK failure on
            // a still-alive session leaks the advisory lock onto a pooled
            // connection and can durably wedge every future claim for this id —
            // log loudly, not at debug.
            await releaseImageProcessingClaim(job.id, lockConnection).catch((err) => {
                console.error(`[Queue] Failed to release lock for job ${job.id}:`, err);
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
    return true;
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
        const baseConditions = [eq(images.processed, false), isNull(images.processing_error)];
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
            processing_settings_json: images.processing_settings_json,
        })
            .from(images)
            .where(pendingWhere)
            .orderBy(asc(images.id))
            .limit(BOOTSTRAP_BATCH_SIZE);
        for (const image of pending) {
            const snapshot = parseProcessingSettingsSnapshot(image.processing_settings_json);
            const job: ImageProcessingJob = {
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
            };
            enqueueImageProcessing(snapshot ? applyProcessingSettingsSnapshot(job, snapshot) : job);

        }
        const lastPending = pending.at(-1);
        if (lastPending) {
            state.bootstrapCursorId = lastPending.id;
        }
        // C9-07: processed=true is committed before embedding side effects run.
        // If the process restarts or the side effect transiently fails, retry a
        // bounded batch of processed rows missing the active model embedding.
        // C1-06 (run-10 cycle-1, PERF-01): guarded so overlapping bootstrap
        // invocations cannot stack concurrent full scans.
        if (!state.embeddingBootstrapInFlight) {
            const bootstrapEmbeddingRetry = bootstrapMissingActiveEmbeddings(state)
                .catch((err) => {
                    console.debug('bootstrapMissingActiveEmbeddings failed:', err);
                })
                .finally(() => {
                    state.embeddingBootstrapInFlight = null;
                });
            state.embeddingBootstrapInFlight = bootstrapEmbeddingRetry;
            trackQueueSideEffect(state, bootstrapEmbeddingRetry);
        }
        // R10-M14: When pending.length === 0 during a CONTINUATION scan
        // (bootstrapCursorId !== null), we cannot distinguish "no more pending
        // images" from "all pending images in this batch are permanently failed".
        // Only set bootstrapped = true when we got a non-empty batch that is
        // smaller than the batch size (meaning we've reached the end), OR when
        // the cursor is null (first scan) and the batch is empty (truly no
        // pending images). An empty continuation batch keeps bootstrapped = false
        // so the retry timer will re-run bootstrap from the beginning (cursor
        // is reset to null), discovering valid pending images after any failed
        // batch.
        if (pending.length === 0 && state.bootstrapCursorId === null) {
            // First scan returned empty — truly no pending images
            state.bootstrapped = true;
            state.bootstrapCursorId = null;
        } else if (pending.length === 0) {
            // Empty continuation batch — might have missed valid images after
            // permanently failed ones. Reset cursor and retry from beginning.
            state.bootstrapped = false;
            state.bootstrapCursorId = null;
            scheduleBootstrapRetry(state, '[Queue] Bootstrap continuation returned zero pending images.');
        } else if (pending.length < BOOTSTRAP_BATCH_SIZE) {
            // Non-empty batch smaller than limit — reached the end
            state.bootstrapped = true;
            state.bootstrapCursorId = null;
        } else {
            // Full batch — schedule continuation to scan after the cursor
            state.bootstrapped = false;
            state.bootstrapCursorId = lastPending ? lastPending.id : null;
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
            // AGG-H2 (run-6 cycle-2): retention sweep for the anonymous
            // *_views analytics tables (default 395 days / VIEW_RETENTION_DAYS)
            // so per-IP-only-limited anonymous writes can't grow them unbounded
            // on the single MySQL writer.
            purgeOldViewEvents().catch(err => console.debug('purgeOldViewEvents failed:', err));
        }
        // AGG-M12 (run-6 cycle-2): arm the hourly GC timer ONCE. Previously
        // every successful bootstrap batch cleared + re-armed a fresh 1-hour
        // countdown, so during a large multi-batch bootstrap (e.g. 10k pending
        // images = many BOOTSTRAP_BATCH_SIZE continuation runs) the periodic
        // purges never fired — the timer kept getting reset before reaching the
        // hour. Guarding on !state.gcInterval keeps the cadence stable across
        // continuation batches. (bootstrapCleanupRun above already covers the
        // one-shot startup purge, so dropping the per-batch re-arm loses nothing.)
        if (!state.gcInterval) {
            state.gcInterval = setInterval(() => {
                purgeExpiredSessions().catch(err => console.debug('purgeExpiredSessions failed:', err));
                purgeOldBuckets().catch(err => console.debug('purgeOldBuckets failed:', err));
                purgeOldAuditLog().catch(err => console.debug('purgeOldAuditLog failed:', err));
                // AGG-H2: hourly retention sweep for the *_views analytics tables.
                purgeOldViewEvents().catch(err => console.debug('purgeOldViewEvents failed:', err));
                pruneRetryMaps(state);
            }, 60 * 60 * 1000); // every hour
            state.gcInterval.unref?.();
        }
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
    await drainQueueSideEffects(state);
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
