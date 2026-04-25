import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queueAddMock } = vi.hoisted(() => ({
    queueAddMock: vi.fn(),
}));

vi.mock('p-queue', () => ({
    default: class MockPQueue {
        add = queueAddMock;
        start = vi.fn();
    },
}));

vi.mock('@/db', () => ({
    connection: { getConnection: vi.fn() },
    db: {},
    images: {},
    sessions: {},
}));

vi.mock('@/lib/process-image', () => ({
    processImageFormats: vi.fn(),
    deleteImageVariants: vi.fn(),
}));

vi.mock('@/lib/upload-paths', () => ({
    UPLOAD_DIR_WEBP: '/tmp/webp',
    UPLOAD_DIR_AVIF: '/tmp/avif',
    UPLOAD_DIR_JPEG: '/tmp/jpeg',
    resolveOriginalUploadPath: vi.fn(),
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: vi.fn(),
}));

vi.mock('@/lib/queue-shutdown', () => ({
    drainProcessingQueueForShutdown: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
    purgeOldBuckets: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
    purgeOldAuditLog: vi.fn(),
}));

vi.mock('@/lib/process-topic-image', () => ({
    cleanOrphanedTopicTempFiles: vi.fn(),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: vi.fn(() => false),
}));

import { enqueueImageProcessing, getProcessingQueueState } from '@/lib/image-queue';

describe('enqueueImageProcessing filename guard', () => {
    beforeEach(() => {
        queueAddMock.mockReset();
        const state = getProcessingQueueState();
        state.enqueued.clear();
        state.retryCounts.clear();
        state.claimRetryCounts.clear();
        state.shuttingDown = false;
    });

    it('rejects DB-sourced path traversal filenames before queueing work', () => {
        enqueueImageProcessing({
            id: 7,
            filenameOriginal: '../secret.jpg',
            filenameWebp: 'safe.webp',
            filenameAvif: 'safe.avif',
            filenameJpeg: 'safe.jpg',
            width: 1200,
        });

        const state = getProcessingQueueState();
        expect(state.enqueued.has(7)).toBe(false);
        expect(queueAddMock).not.toHaveBeenCalled();
    });

    it('marks bootstrap stale and schedules a retry scan after repeated processing failures', async () => {
        vi.useFakeTimers();
        const state = getProcessingQueueState();
        state.bootstrapped = true;

        enqueueImageProcessing({
            id: 8,
            filenameOriginal: 'original.jpg',
            filenameWebp: 'safe.webp',
            filenameAvif: 'safe.avif',
            filenameJpeg: 'safe.jpg',
            width: 1200,
        });

        for (let attempt = 0; attempt < 3; attempt++) {
            const task = queueAddMock.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined;
            expect(task).toBeDefined();
            await task!();
        }

        expect(state.bootstrapped).toBe(false);
        expect(state.bootstrapRetryTimer).toBeDefined();
        if (state.bootstrapRetryTimer) {
            clearTimeout(state.bootstrapRetryTimer);
            state.bootstrapRetryTimer = undefined;
        }
        vi.useRealTimers();
    });
});
