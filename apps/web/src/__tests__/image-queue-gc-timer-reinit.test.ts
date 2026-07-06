import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * WP22 (C2-33, run-10 cycle-2): duplicate hourly GC timer on state re-init.
 *
 * getProcessingQueueState's defensive re-init path (AGG-R12-11) replaces a
 * malformed global state object with a fresh one. If the malformed object
 * still carried an armed hourly gcInterval, dropping the reference alone
 * leaked the timer — it kept firing against an object nothing else
 * references, forever, once per hour. The fix clears that stale interval
 * before constructing the replacement state.
 */

const processingQueueKey = Symbol.for('gallerykit.imageProcessingQueue');

async function loadQueueModule() {
    vi.resetModules();
    delete (globalThis as typeof globalThis & { [key: symbol]: unknown })[processingQueueKey];

    vi.doMock('p-queue', () => ({
        default: class MockPQueue {
            add = vi.fn();
            start = vi.fn();
        },
    }));
    vi.doMock('@/db', () => ({
        connection: { getConnection: vi.fn() },
        db: {},
        images: {},
        sessions: {},
        imageEmbeddings: {},
        // C2-08 (WP7): image-queue.ts now imports POOL_CONNECTION_LIMIT from @/db.
        POOL_CONNECTION_LIMIT: 10,
    }));
    vi.doMock('@/lib/process-image', () => ({
        processImageFormats: vi.fn(),
        deleteImageVariants: vi.fn(),
        IMAGE_PIPELINE_VERSION: 7,
    }));
    vi.doMock('@/lib/upload-paths', () => ({
        UPLOAD_DIR_WEBP: '/tmp/webp',
        UPLOAD_DIR_AVIF: '/tmp/avif',
        UPLOAD_DIR_JPEG: '/tmp/jpeg',
        resolveOriginalUploadPath: vi.fn(),
    }));
    vi.doMock('@/lib/gallery-config', () => ({
        getGalleryConfig: vi.fn(),
        getGalleryConfigUncached: vi.fn(),
    }));
    vi.doMock('@/lib/queue-shutdown', () => ({ drainProcessingQueueForShutdown: vi.fn() }));
    vi.doMock('@/lib/rate-limit', () => ({ purgeOldBuckets: vi.fn() }));
    vi.doMock('@/lib/audit', () => ({ purgeOldAuditLog: vi.fn() }));
    vi.doMock('@/lib/view-retention', () => ({ purgeOldViewEvents: vi.fn() }));
    vi.doMock('@/lib/process-topic-image', () => ({ cleanOrphanedTopicTempFiles: vi.fn() }));
    vi.doMock('@/lib/restore-maintenance', () => ({ isRestoreMaintenanceActive: vi.fn(() => false) }));
    vi.doMock('@/lib/advisory-locks', () => ({
        getImageProcessingLockName: vi.fn(),
        isAdvisoryLockAcquired: vi.fn(),
    }));
    vi.doMock('@/lib/caption-generator', () => ({ generateCaption: vi.fn() }));
    vi.doMock('@/lib/clip-inference', () => ({ embedImageStub: vi.fn() }));
    vi.doMock('@/lib/clip-model', () => ({ embedImageReal: vi.fn() }));
    vi.doMock('@/lib/clip-embeddings', () => ({
        embeddingToBuffer: vi.fn(),
        STUB_MODEL_VERSION: 'stub',
        PRODUCTION_MODEL_VERSION: 'prod',
        SEMANTIC_SCAN_LIMIT: 2000,
    }));

    return import('@/lib/image-queue');
}

describe('getProcessingQueueState GC timer re-init (WP22 / C2-33)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        vi.resetModules();
        delete (globalThis as typeof globalThis & { [key: symbol]: unknown })[processingQueueKey];
        vi.doUnmock('p-queue');
        vi.doUnmock('@/db');
        vi.doUnmock('drizzle-orm');
    });

    it('clears the orphaned gcInterval when the defensive re-init replaces a malformed state', async () => {
        const { getProcessingQueueState } = await loadQueueModule();
        const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

        const staleInterval = setInterval(() => {}, 60 * 60 * 1000);
        staleInterval.unref?.();
        // Malformed: `queue` is not a live PQueue (missing a functioning
        // `.add`), so getProcessingQueueState's shape guard falls through to
        // the defensive re-init path (the AGG-R12-11 scenario) instead of
        // returning this object as-is.
        (globalThis as typeof globalThis & Record<symbol, unknown>)[processingQueueKey] = {
            queue: null,
            enqueued: new Set<number>(),
            bootstrapped: false,
            gcInterval: staleInterval,
        };

        const state = getProcessingQueueState();

        expect(clearIntervalSpy).toHaveBeenCalledWith(staleInterval);
        expect(state.gcInterval).toBeUndefined();
        // The replacement is a genuinely fresh, valid state, not the
        // malformed object echoed back.
        expect(typeof state.queue.add).toBe('function');
    });

    it('does not attempt to clear an interval when no prior state exists', async () => {
        const { getProcessingQueueState } = await loadQueueModule();
        const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

        getProcessingQueueState();

        expect(clearIntervalSpy).not.toHaveBeenCalled();
    });

    it('does not clear anything when the existing state is well-formed and has no armed gcInterval yet', async () => {
        const { getProcessingQueueState } = await loadQueueModule();
        // First call constructs the fresh (well-formed, gcInterval-less)
        // state and caches it on the global.
        const first = getProcessingQueueState();
        expect(first.gcInterval).toBeUndefined();

        const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
        const second = getProcessingQueueState();

        expect(second).toBe(first);
        expect(clearIntervalSpy).not.toHaveBeenCalled();
    });
});

/**
 * ARCH3-04 / C3-20 (run-10 c3): per-job retry timers are tracked on state so
 * the defensive re-init clears them alongside gcInterval (same leaked-timer
 * class C2-33 fixed) and shutdown can clear parked backoff timers.
 */
describe('per-job retry timer tracking (ARCH3-04 / C3-20)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        vi.resetModules();
        delete (globalThis as typeof globalThis & { [key: symbol]: unknown })[processingQueueKey];
        vi.doUnmock('p-queue');
        vi.doUnmock('@/db');
        vi.doUnmock('drizzle-orm');
    });

    it('clears tracked retry timers when the defensive re-init replaces a malformed state', async () => {
        const { getProcessingQueueState } = await loadQueueModule();
        const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

        const parkedRetry = setTimeout(() => {}, 60_000);
        parkedRetry.unref?.();
        (globalThis as typeof globalThis & Record<symbol, unknown>)[processingQueueKey] = {
            queue: null,
            enqueued: new Set<number>(),
            bootstrapped: false,
            retryTimers: new Set([parkedRetry]),
        };

        const state = getProcessingQueueState();

        expect(clearTimeoutSpy).toHaveBeenCalledWith(parkedRetry);
        expect(state.retryTimers instanceof Set).toBe(true);
        expect(state.retryTimers.size).toBe(0);
    });

    it('clears parked retry timers on shutdown before draining the queue', async () => {
        const { getProcessingQueueState, shutdownImageProcessingQueue } = await loadQueueModule();
        const state = getProcessingQueueState();
        const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

        const parkedRetry = setTimeout(() => {}, 60_000);
        parkedRetry.unref?.();
        state.retryTimers.add(parkedRetry);

        await shutdownImageProcessingQueue(state, {
            pause: vi.fn(),
            clear: vi.fn(),
            onIdle: vi.fn(async () => {}),
        });

        expect(clearTimeoutSpy).toHaveBeenCalledWith(parkedRetry);
        expect(state.retryTimers.size).toBe(0);
    });
});
