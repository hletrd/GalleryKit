import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WP20 (C2-32, run-10 cycle-2): processing-failure retry backoff.
 *
 * Before this change, a processing failure (Sharp crash, transient FS/DB
 * blip) re-enqueued synchronously with zero delay, unlike the claim-retry
 * path which already used an escalating setTimeout(...).unref() schedule.
 * This drives the real queue worker closure (the p-queue mock captures and
 * synchronously runs the task) with a connection mock that always fails the
 * claim step, forcing the outer catch's processing-failure retry path on
 * every attempt, and asserts:
 *   - the re-enqueue is NOT scheduled synchronously (no new task added to
 *     the queue until fake timers are advanced past the delay), and
 *   - the delay escalates with the retry attempt, and
 *   - after MAX_RETRIES the job still permanently fails (existing contract
 *     unchanged).
 */

const { queueAddMock, getConnectionMock } = vi.hoisted(() => ({
    queueAddMock: vi.fn(),
    getConnectionMock: vi.fn(),
}));

vi.mock('p-queue', () => ({
    default: class MockPQueue {
        add = queueAddMock;
        start = vi.fn();
    },
}));

const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
};

vi.mock('@/db', () => ({
    connection: { getConnection: getConnectionMock },
    db: {
        select: vi.fn(() => ({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: 42, topic: null }]) })),
        update: vi.fn(() => updateChain),
    },
    images: { id: 'id', processed: 'processed' },
    sessions: {},
    // C2-08 (WP7): image-queue.ts now imports POOL_CONNECTION_LIMIT from @/db.
    POOL_CONNECTION_LIMIT: 10,
}));

vi.mock('@/lib/process-image', () => ({
    processImageFormats: vi.fn(),
    deleteImageVariants: vi.fn(),
    IMAGE_PIPELINE_VERSION: 7,
}));
vi.mock('@/lib/upload-paths', () => ({
    UPLOAD_DIR_WEBP: '/tmp/webp',
    UPLOAD_DIR_AVIF: '/tmp/avif',
    UPLOAD_DIR_JPEG: '/tmp/jpeg',
    resolveOriginalUploadPath: vi.fn(async (fn: string) => `/tmp/original/${fn}`),
}));
vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: vi.fn(),
    getGalleryConfigUncached: vi.fn(),
}));
vi.mock('@/lib/queue-shutdown', () => ({ drainProcessingQueueForShutdown: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ purgeOldBuckets: vi.fn() }));
vi.mock('@/lib/audit', () => ({ purgeOldAuditLog: vi.fn() }));
vi.mock('@/lib/process-topic-image', () => ({ cleanOrphanedTopicTempFiles: vi.fn() }));
vi.mock('@/lib/restore-maintenance', () => ({ isRestoreMaintenanceActive: vi.fn(() => false) }));
vi.mock('@/lib/caption-generator', () => ({ generateCaption: vi.fn(async () => null) }));

import { enqueueImageProcessing, getProcessingQueueState } from '@/lib/image-queue';

function runLastQueuedTask() {
    const task = queueAddMock.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined;
    expect(task, 'a queue task must have been enqueued').toBeDefined();
    return task!();
}

describe('processing-failure retry backoff (WP20 / C2-32)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        queueAddMock.mockReset();
        getConnectionMock.mockReset();
        // Every claim attempt fails: getConnection() resolves to undefined,
        // so acquireImageProcessingClaim's lockConnection.query(...) throws —
        // this is caught by the queue task's outer catch (the same
        // processing-failure path a Sharp crash or DB blip would hit).
        getConnectionMock.mockResolvedValue(undefined);
        const state = getProcessingQueueState();
        state.enqueued.clear();
        state.retryCounts.clear();
        state.claimRetryCounts.clear();
        state.lastErrors.clear();
        state.permanentlyFailedIds.clear();
        state.shuttingDown = false;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const job = {
        id: 42,
        filenameOriginal: 'orig.jpg',
        filenameWebp: 'out.webp',
        filenameAvif: 'out.avif',
        filenameJpeg: 'out.jpg',
        width: 1200,
    };

    it('does not re-enqueue synchronously on a processing failure', async () => {
        enqueueImageProcessing(job);
        const task = queueAddMock.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined;
        expect(task, 'a queue task must have been enqueued').toBeDefined();
        queueAddMock.mockClear();

        await task!();

        // The prior behavior called enqueueImageProcessing(job) synchronously
        // in the catch block, which would show up here as a NEW add() call
        // with zero elapsed fake-timer time. The fixed behavior only
        // schedules a setTimeout — no new queue.add() until it fires.
        expect(queueAddMock).not.toHaveBeenCalled();

        const state = getProcessingQueueState();
        expect(state.retryCounts.get(job.id)).toBe(1);
        expect(state.enqueued.has(job.id)).toBe(false);
    });

    it('re-enqueues after the escalating delay elapses, and the delay grows with each attempt', async () => {
        enqueueImageProcessing(job);

        // Attempt 1 fails -> retries=1 -> delay = 5000 * 1 = 5000ms.
        await runLastQueuedTask();
        expect(queueAddMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4999);
        expect(queueAddMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(queueAddMock).toHaveBeenCalledTimes(2);

        // Attempt 2 fails -> retries=2 -> delay = 5000 * 2 = 10000ms.
        await runLastQueuedTask();
        await vi.advanceTimersByTimeAsync(9999);
        expect(queueAddMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(queueAddMock).toHaveBeenCalledTimes(3);
    });

    it('still permanently fails after MAX_RETRIES, advancing timers between attempts', async () => {
        enqueueImageProcessing(job);
        const state = getProcessingQueueState();
        // Dirty the bootstrap state up front so the reset-on-permanent-
        // failure assertions below are non-vacuous (they'd trivially pass
        // against the fresh-state defaults otherwise).
        state.bootstrapped = true;
        state.bootstrapCursorId = 999;

        for (let attempt = 1; attempt <= 3; attempt++) {
            await runLastQueuedTask();
            if (attempt < 3) {
                await vi.advanceTimersByTimeAsync(5000 * Math.min(attempt, 5));
            }
        }

        expect(state.permanentlyFailedIds.has(job.id)).toBe(true);
        expect(state.retryCounts.has(job.id)).toBe(false);
        expect(state.bootstrapped).toBe(false);
        expect(state.bootstrapCursorId).toBeNull();
    });
});
