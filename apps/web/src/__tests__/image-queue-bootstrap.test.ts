import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pendingImage = (id: number) => ({
    id,
    filename_original: `original-${id}.jpg`,
    filename_webp: `image-${id}.webp`,
    filename_avif: `image-${id}.avif`,
    filename_jpeg: `image-${id}.jpg`,
    width: 1200,
});

async function loadQueueModule({
    pending,
    pendingBatches,
    reject,
    resolveIdle = false,
}: {
    pending?: Array<ReturnType<typeof pendingImage>>;
    pendingBatches?: Array<Array<ReturnType<typeof pendingImage>>>;
    reject?: Error;
    resolveIdle?: boolean;
}) {
    vi.resetModules();
    delete (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for('gallerykit.imageProcessingQueue')];

    const batches = pendingBatches ? [...pendingBatches] : [pending ?? []];
    const queueAddMock = vi.fn();
    const queueOnIdleMock = vi.fn(() => (resolveIdle ? Promise.resolve() : new Promise<void>(() => {})));
    const limitMock = vi.fn(async () => {
        if (reject) throw reject;
        return batches.shift() ?? [];
    });
    const orderByMock = vi.fn(() => ({ limit: limitMock }));
    const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    const selectMock = vi.fn(() => ({ from: fromMock }));
    const gtMock = vi.fn(() => 'gt');

    vi.doMock('p-queue', () => ({
        default: class MockPQueue {
            add = queueAddMock;
            onIdle = queueOnIdleMock;
            pause = vi.fn();
            clear = vi.fn();
            onPendingZero = vi.fn(async () => {});
            start = vi.fn();
        },
    }));

    vi.doMock('@/db', () => ({
        connection: { getConnection: vi.fn() },
        db: {
            select: selectMock,
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
        },
        sessions: { expiresAt: 'expiresAt' },
    }));

    vi.doMock('drizzle-orm', () => ({
        eq: vi.fn(() => 'eq'),
        and: vi.fn(() => 'and'),
        sql: vi.fn(() => 'sql'),
        asc: vi.fn(() => 'asc'),
        gt: gtMock,
    }));

    vi.doMock('@/lib/process-image', () => ({
        processImageFormats: vi.fn(),
        deleteImageVariants: vi.fn(),
    }));
    vi.doMock('@/lib/upload-paths', () => ({
        UPLOAD_DIR_WEBP: '/tmp/webp',
        UPLOAD_DIR_AVIF: '/tmp/avif',
        UPLOAD_DIR_JPEG: '/tmp/jpeg',
        resolveOriginalUploadPath: vi.fn(),
    }));
    vi.doMock('@/lib/gallery-config', () => ({
        getGalleryConfig: vi.fn(),
    }));
    vi.doMock('@/lib/queue-shutdown', () => ({
        drainProcessingQueueForShutdown: vi.fn(),
    }));
    vi.doMock('@/lib/rate-limit', () => ({
        purgeOldBuckets: vi.fn(),
    }));
    vi.doMock('@/lib/audit', () => ({
        purgeOldAuditLog: vi.fn(),
    }));
    vi.doMock('@/lib/process-topic-image', () => ({
        cleanOrphanedTopicTempFiles: vi.fn(),
    }));
    vi.doMock('@/lib/restore-maintenance', () => ({
        isRestoreMaintenanceActive: vi.fn(() => false),
    }));

    const queueModule = await import('@/lib/image-queue');
    return {
        ...queueModule,
        queueAddMock,
        queueOnIdleMock,
        limitMock,
        gtMock,
    };
}

describe('bootstrapImageProcessingQueue', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.resetModules();
        delete (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for('gallerykit.imageProcessingQueue')];
        vi.doUnmock('p-queue');
        vi.doUnmock('@/db');
        vi.doUnmock('drizzle-orm');
    });

    it('caps each bootstrap pass and schedules a continuation for large backlogs', async () => {
        const pending = Array.from({ length: 500 }, (_, idx) => pendingImage(idx + 1));
        const {
            bootstrapImageProcessingQueue,
            getProcessingQueueState,
            queueAddMock,
            queueOnIdleMock,
            limitMock,
        } = await loadQueueModule({ pending });

        await bootstrapImageProcessingQueue();

        expect(limitMock).toHaveBeenCalledWith(500);
        expect(queueAddMock).toHaveBeenCalledTimes(500);
        const state = getProcessingQueueState();
        expect(state.bootstrapped).toBe(false);
        expect(state.bootstrapContinuationScheduled).toBe(true);
        expect(queueOnIdleMock).toHaveBeenCalledTimes(1);
    });



    it('continues scanning after the previous batch cursor so later rows are not starved', async () => {
        const firstBatch = Array.from({ length: 500 }, (_, idx) => pendingImage(idx + 1));
        const secondBatch = [pendingImage(501), pendingImage(502)];
        const {
            bootstrapImageProcessingQueue,
            getProcessingQueueState,
            queueAddMock,
            limitMock,
            gtMock,
        } = await loadQueueModule({ pendingBatches: [firstBatch, secondBatch], resolveIdle: true });

        await bootstrapImageProcessingQueue();
        await vi.waitFor(() => expect(limitMock).toHaveBeenCalledTimes(2));

        expect(queueAddMock).toHaveBeenCalledTimes(502);
        expect(gtMock).toHaveBeenCalledWith('id', 500);
        const state = getProcessingQueueState();
        expect(state.bootstrapped).toBe(true);
        expect(state.bootstrapCursorId).toBeNull();
    });
    it('retries bootstrap after a transient database connection refusal', async () => {
        vi.useFakeTimers();
        const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        const {
            bootstrapImageProcessingQueue,
            getProcessingQueueState,
            limitMock,
        } = await loadQueueModule({ reject: err });

        await bootstrapImageProcessingQueue();

        expect(getProcessingQueueState().bootstrapRetryTimer).toBeDefined();
        expect(limitMock).toHaveBeenCalledTimes(1);

        limitMock.mockImplementationOnce(async () => []);
        await vi.advanceTimersByTimeAsync(30_000);

        expect(limitMock).toHaveBeenCalledTimes(2);
        expect(getProcessingQueueState().bootstrapped).toBe(true);
    });
});
