import * as fs from 'fs';
import * as path from 'path';
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
    IMAGE_PIPELINE_VERSION: 5,
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

    it('C9-TE-02: pruneRetryMaps FIFO eviction uses collect-then-delete pattern', () => {
        // C9-MED-02: the pruneRetryMaps function collects keys into an array
        // first, then deletes in a separate loop. This matches the project
        // convention (BoundedMap.prune(), C8-MED-01, C9-MED-01).
        //
        // Regression guard: if pruneRetryMaps is rewritten to delete during
        // for-of iteration, this test fails.
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'lib', 'image-queue.ts'),
            'utf8',
        );

        // Verify MAX_RETRY_MAP_SIZE constant
        expect(source).toMatch(/const\s+MAX_RETRY_MAP_SIZE\s*=\s*10000\b/);

        // Verify the collect-then-delete pattern in pruneRetryMaps:
        // 1. collect excess keys into evictKeys array
        // 2. break when enough keys collected
        // 3. delete collected keys in a separate loop
        expect(source).toMatch(
            /const\s+evictKeys\s*:\s*number\[\]\s*=\s*\[\]\s*;\s*\n\s*for\s*\(\s*const\s+key\s+of\s+map\.keys\(\)\s*\)\s*\{\s*\n\s*if\s*\(\s*evictKeys\.length\s*>=\s*excess\s*\)\s*break\s*;\s*\n\s*evictKeys\.push\s*\(\s*key\s*\)\s*;\s*\n\s*\}\s*\n\s*for\s*\(\s*const\s+key\s+of\s+evictKeys\s*\)\s*\{\s*\n\s*map\.delete\s*\(\s*key\s*\)/
        );
    });

    it('marks bootstrap stale and schedules a retry scan after repeated processing failures', async () => {
        vi.useFakeTimers();
        const state = getProcessingQueueState();
        state.bootstrapped = true;
        state.bootstrapCursorId = 500;

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
        expect(state.bootstrapCursorId).toBeNull();
        expect(state.bootstrapRetryTimer).toBeDefined();
        if (state.bootstrapRetryTimer) {
            clearTimeout(state.bootstrapRetryTimer);
            state.bootstrapRetryTimer = undefined;
        }
        vi.useRealTimers();
    });
});
