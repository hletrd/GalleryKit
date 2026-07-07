import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WP21 (C2-34, run-10 cycle-2): bound each bootstrapMissingActiveEmbeddings
 * invocation to the semantic scan limit.
 *
 * Before this change, the embedding-bootstrap retry walked EVERY processed
 * image missing an active-model embedding with no cap — a huge backlog would
 * scan the entire images table in one background invocation. This drives the
 * real bootstrapImageProcessingQueue() (which launches the embedding scan as
 * a tracked side effect) with a mocked db.select chain that distinguishes
 * the plain pending-images query (no leftJoin) from the embedding-scan query
 * (leftJoin), and asserts the scan stops once SEMANTIC_SCAN_LIMIT rows have
 * been scanned, logging a single continuation line.
 */

function embeddingRow(id: number) {
    return { id, filename_original: `original-${id}.jpg` };
}

async function loadQueueModule({
    embeddingBatches,
    semanticSearchMode = 'stub',
    scanLimit = 100,
}: {
    embeddingBatches: Array<Array<ReturnType<typeof embeddingRow>>>;
    semanticSearchMode?: 'disabled' | 'stub' | 'production';
    scanLimit?: number;
}) {
    vi.resetModules();
    delete (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for('gallerykit.imageProcessingQueue')];

    const batches = [...embeddingBatches];
    const embeddingLimitMock = vi.fn(async () => batches.shift() ?? []);
    const embeddingOrderByMock = vi.fn(() => ({ limit: embeddingLimitMock }));
    const embeddingWhereMock = vi.fn(() => ({ orderBy: embeddingOrderByMock }));
    const leftJoinMock = vi.fn(() => ({ where: embeddingWhereMock }));

    const pendingLimitMock = vi.fn(async () => []);
    const pendingOrderByMock = vi.fn(() => ({ limit: pendingLimitMock }));
    const pendingWhereMock = vi.fn(() => ({ orderBy: pendingOrderByMock }));

    // .from() is shared by both queries; which branch runs depends on
    // whether the caller chains .where() directly (main pending-images
    // query) or .leftJoin() first (embedding-scan query).
    const fromMock = vi.fn(() => ({
        where: pendingWhereMock,
        leftJoin: leftJoinMock,
    }));
    const selectMock = vi.fn(() => ({ from: fromMock }));

    vi.doMock('p-queue', () => ({
        default: class MockPQueue {
            add = vi.fn();
            start = vi.fn();
        },
    }));

    vi.doMock('@/db', () => ({
        connection: { getConnection: vi.fn() },
        db: {
            select: selectMock,
            insert: vi.fn(() => ({
                values: vi.fn(() => ({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) })),
            })),
            delete: vi.fn(() => ({ where: vi.fn() })),
        },
        images: {
            id: 'id',
            filename_original: 'filename_original',
            filename_webp: 'filename_webp',
            filename_avif: 'filename_avif',
            filename_jpeg: 'filename_jpeg',
            width: 'width',
            processed: 'processed',
            processing_error: 'processing_error',
            processing_settings_json: 'processing_settings_json',
        },
        sessions: { expiresAt: 'expiresAt' },
        imageEmbeddings: { imageId: 'imageId', modelVersion: 'modelVersion' },
        // C2-08 (WP7): image-queue.ts now imports POOL_CONNECTION_LIMIT from @/db.
        POOL_CONNECTION_LIMIT: 10,
    }));

    vi.doMock('drizzle-orm', () => ({
        eq: vi.fn(() => 'eq'),
        and: vi.fn(() => 'and'),
        sql: vi.fn(() => 'sql'),
        asc: vi.fn(() => 'asc'),
        gt: vi.fn(() => 'gt'),
        notInArray: vi.fn(() => 'notInArray'),
        isNull: vi.fn(() => 'isNull'),
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
        // Resolving to null short-circuits storeImageEmbeddingForMode before
        // it needs embedImageStub/embeddingToBuffer/db.insert to succeed —
        // this test is only about scan-count capping, not embedding writes.
        resolveOriginalUploadPath: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/gallery-config', () => ({
        getGalleryConfig: vi.fn(async () => ({ semanticSearchMode })),
        getGalleryConfigDetached: vi.fn(async () => ({ semanticSearchMode })),
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
    vi.doMock('@/lib/caption-generator', () => ({ generateCaption: vi.fn(async () => null) }));
    vi.doMock('@/lib/clip-inference', () => ({ embedImageStub: vi.fn(() => new Float32Array()) }));
    vi.doMock('@/lib/clip-model', () => ({ embedImageReal: vi.fn(async () => new Float32Array()) }));
    vi.doMock('@/lib/clip-embeddings', () => ({
        embeddingToBuffer: vi.fn(() => Buffer.from([])),
        STUB_MODEL_VERSION: 'stub-sha256-v1',
        PRODUCTION_MODEL_VERSION: 'jina-clip-v2-d512-q8',
        SEMANTIC_SCAN_LIMIT: scanLimit,
    }));

    const queueModule = await import('@/lib/image-queue');
    return { ...queueModule, embeddingLimitMock };
}

describe('bootstrapMissingActiveEmbeddings scan cap (WP21 / C2-34)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        delete (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for('gallerykit.imageProcessingQueue')];
        vi.doUnmock('p-queue');
        vi.doUnmock('@/db');
        vi.doUnmock('drizzle-orm');
    });

    it('stops scanning once SEMANTIC_SCAN_LIMIT rows have been scanned and logs a continuation line', async () => {
        const batch1 = Array.from({ length: 50 }, (_, i) => embeddingRow(i + 1));
        const batch2 = Array.from({ length: 50 }, (_, i) => embeddingRow(i + 51));
        const batch3 = Array.from({ length: 50 }, (_, i) => embeddingRow(i + 101));

        const { bootstrapImageProcessingQueue, getProcessingQueueState, embeddingLimitMock } =
            await loadQueueModule({ embeddingBatches: [batch1, batch2, batch3], scanLimit: 100 });

        await bootstrapImageProcessingQueue();
        const state = getProcessingQueueState();
        await Promise.allSettled(Array.from(state.sideEffects));

        // Two full 50-row batches reach the 100-row cap before a 3rd batch
        // would be requested — the cap check runs before issuing the query.
        expect(embeddingLimitMock).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('embedding bootstrap reached scan cap (100)'),
        );
    });

    it('does not warn when the backlog finishes under the cap', async () => {
        const shortBatch = Array.from({ length: 10 }, (_, i) => embeddingRow(i + 1));

        const { bootstrapImageProcessingQueue, getProcessingQueueState, embeddingLimitMock } =
            await loadQueueModule({ embeddingBatches: [shortBatch], scanLimit: 100 });

        await bootstrapImageProcessingQueue();
        const state = getProcessingQueueState();
        await Promise.allSettled(Array.from(state.sideEffects));

        expect(embeddingLimitMock).toHaveBeenCalledTimes(1);
        expect(console.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('embedding bootstrap reached scan cap'),
        );
    });

    it('does not scan at all when semantic search is disabled', async () => {
        const batch1 = Array.from({ length: 50 }, (_, i) => embeddingRow(i + 1));

        const { bootstrapImageProcessingQueue, getProcessingQueueState, embeddingLimitMock } =
            await loadQueueModule({ embeddingBatches: [batch1], semanticSearchMode: 'disabled', scanLimit: 100 });

        await bootstrapImageProcessingQueue();
        const state = getProcessingQueueState();
        await Promise.allSettled(Array.from(state.sideEffects));

        expect(embeddingLimitMock).not.toHaveBeenCalled();
    });
});

/**
 * TRC3-01 / C3-07 (run-10 c3): the scan cursor must persist ACROSS
 * invocations. The C2-34 cap relied on embedded rows dropping out of the
 * isNull filter — false for permanently-failing rows, so a stuck prefix
 * ≥ SEMANTIC_SCAN_LIMIT restarted at id 0 every call and starved every
 * newer row forever. (The mocked resolveOriginalUploadPath returning null
 * makes EVERY scanned row a stuck row here — exactly the starvation shape.)
 */
describe('embedding-scan cursor persistence (TRC3-01 / C3-07)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        delete (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for('gallerykit.imageProcessingQueue')];
        vi.doUnmock('p-queue');
        vi.doUnmock('@/db');
        vi.doUnmock('drizzle-orm');
    });

    it('persists the resume cursor on cap-hit, resumes past the stuck prefix, and wraps to 0 on clean completion', async () => {
        const batch1 = Array.from({ length: 50 }, (_, i) => embeddingRow(i + 1));
        const batch2 = Array.from({ length: 50 }, (_, i) => embeddingRow(i + 51));
        const batch3 = Array.from({ length: 10 }, (_, i) => embeddingRow(i + 101));

        const { bootstrapImageProcessingQueue, getProcessingQueueState, embeddingLimitMock } =
            await loadQueueModule({ embeddingBatches: [batch1, batch2, batch3], scanLimit: 100 });

        // Invocation 1: hits the 100-row cap after two batches (all rows stay
        // "stuck" because resolveOriginalUploadPath is mocked to null).
        await bootstrapImageProcessingQueue();
        const state = getProcessingQueueState();
        await Promise.allSettled(Array.from(state.sideEffects));
        expect(embeddingLimitMock).toHaveBeenCalledTimes(2);
        // Pre-fix this stayed 0 (implicit restart); now it records the resume point.
        expect(state.embeddingScanCursorId).toBe(100);

        // Invocation 2: must RESUME past the stuck prefix (gt id > 100), not
        // rescan it — the third batch (ids 101-110) is reached and, being a
        // short batch, completes the pass cleanly, wrapping the cursor to 0
        // so a later invocation retries the failed prefix.
        state.bootstrapped = false;
        await bootstrapImageProcessingQueue();
        await Promise.allSettled(Array.from(state.sideEffects));
        expect(embeddingLimitMock).toHaveBeenCalledTimes(3);
        const drizzle = await import('drizzle-orm');
        const gtCalls = vi.mocked(drizzle.gt).mock.calls;
        expect(gtCalls.some((call) => call[1] === 100)).toBe(true);
        expect(state.embeddingScanCursorId).toBe(0);
    });
});
