import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * COR-R4C12-01 — restore quiesce must not deadlock on a paused non-empty queue.
 *
 * p-queue 9.1.2 emits `idle` ONLY when `queue.size === 0 && pending === 0`
 * (`#tryToStartAnother`, and `clear()` itself). A PAUSED queue never starts
 * queued tasks, so `size` can never reach 0 by draining — the only remaining
 * `idle` emitter is `clear()`. The pre-fix order
 * `pause(); await onIdle(); clear()` therefore hung forever whenever >= 1 job
 * was queued behind the in-flight one (batch-upload N >= 2 photos at the
 * default QUEUE_CONCURRENCY=1, then restore while processing). The hung
 * restoreDatabase action never reached its finally: endRestoreMaintenance()
 * never ran and the restore/upload advisory-lock connections were held
 * forever — wedging uploads, processing, and all future restores until a
 * container restart.
 *
 * These tests inject a fake queue (via the existing injection parameter)
 * whose `onIdle` REJECTS — fails fast instead of hanging the suite — unless
 * `clear()` has already been called, faithfully modeling the reachability of
 * p-queue's `idle` event on a paused queue with queued items.
 */

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
    // C2-08 (WP7): image-queue.ts now imports POOL_CONNECTION_LIMIT from @/db.
    POOL_CONNECTION_LIMIT: 10,
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
    // C2-10 (WP19): image-queue.ts's detached-context call sites now use
    // getGalleryConfigDetached instead of the request-cached export.
    getGalleryConfigDetached: vi.fn(),
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

import { quiesceImageProcessingQueueForRestore, getProcessingQueueState } from '@/lib/image-queue';

type FakeQueue = {
    pause: () => void;
    clear: () => void;
    onIdle: () => Promise<void>;
};

/** Fake queue modeling p-queue 9.1.2 paused-queue semantics: `idle` is
 *  unreachable while queued items exist, and only `clear()` (or an
 *  in-flight completion AFTER clear) can make it fire. Rejects instead of
 *  hanging so a regression fails the suite fast. */
function makeSemanticFakeQueue() {
    const calls: string[] = [];
    let cleared = false;
    const queue: FakeQueue = {
        pause: () => {
            calls.push('pause');
        },
        clear: () => {
            calls.push('clear');
            cleared = true;
        },
        onIdle: () => {
            calls.push('onIdle');
            if (!cleared) {
                return Promise.reject(new Error(
                    'deadlock: onIdle awaited on a PAUSED queue with queued items '
                    + '— p-queue emits idle only at size===0 && pending===0, and a '
                    + 'paused queue can only reach size 0 via clear()',
                ));
            }
            return Promise.resolve();
        },
    };
    return { queue, calls };
}

function populateState() {
    const state = getProcessingQueueState();
    state.enqueued.clear();
    state.enqueued.add(11).add(12);
    state.retryCounts.clear();
    state.retryCounts.set(11, 2);
    state.claimRetryCounts.clear();
    state.claimRetryCounts.set(12, 1);
    state.lastErrors.clear();
    state.lastErrors.set(11, 'boom');
    state.permanentlyFailedIds.clear();
    state.permanentlyFailedIds.add(9);
    state.bootstrapped = true;
    state.bootstrapContinuationScheduled = true;
    state.bootstrapCursorId = 42;
    state.shuttingDown = false;
    if (state.bootstrapRetryTimer) {
        clearTimeout(state.bootstrapRetryTimer);
    }
    state.bootstrapRetryTimer = setTimeout(() => {}, 60_000);
    state.bootstrapRetryTimer.unref?.();
    return state;
}

describe('quiesceImageProcessingQueueForRestore — COR-R4C12-01 paused-queue liveness', () => {
    it('resolves under p-queue paused-queue semantics (clear() must precede the onIdle await)', async () => {
        const state = populateState();
        const { queue } = makeSemanticFakeQueue();

        // Pre-fix order (pause -> await onIdle -> clear) makes this REJECT
        // with the deadlock error above; post-fix it resolves.
        await expect(
            quiesceImageProcessingQueueForRestore(state, queue),
        ).resolves.toBeUndefined();

        // Post-quiesce state guarantees (unchanged contract): everything
        // reset so the post-restore bootstrap re-discovers pending rows.
        expect(state.enqueued.size).toBe(0);
        expect(state.retryCounts.size).toBe(0);
        expect(state.claimRetryCounts.size).toBe(0);
        expect(state.lastErrors.size).toBe(0);
        expect(state.permanentlyFailedIds.size).toBe(0);
        expect(state.bootstrapped).toBe(false);
        expect(state.bootstrapContinuationScheduled).toBe(false);
        expect(state.bootstrapCursorId).toBeNull();
        expect(state.bootstrapRetryTimer).toBeUndefined();
    });

    it('invokes pause -> clear -> onIdle in that exact order', async () => {
        const state = populateState();
        const { queue, calls } = makeSemanticFakeQueue();

        await quiesceImageProcessingQueueForRestore(state, queue);

        // The drain path (drainProcessingQueueForShutdown) already uses
        // clear-before-await; this pins quiesce to the same single
        // paused-queue ordering so the two consumers cannot drift again.
        expect(calls).toEqual(['pause', 'clear', 'onIdle']);
    });

    it('declares and drains tracked side effects before reporting restore quiescence', async () => {
        const source = readFileSync(path.join(__dirname, '..', 'lib', 'image-queue.ts'), 'utf8');

        expect(source).toContain('sideEffects: Set<Promise<void>>');
        expect(source).toContain('trackQueueSideEffect(state');
        // C1-06 (run-10 cycle-1): the retry scan is now launched behind an
        // in-flight dedupe guard, but it must STILL be tracked as a queue side
        // effect so restore quiescence drains it.
        expect(source).toContain('const bootstrapEmbeddingRetry = bootstrapMissingActiveEmbeddings(state)');
        expect(source).toMatch(/if\s*\(\s*!state\.embeddingBootstrapInFlight\s*\)/);
        expect(source).toContain('trackQueueSideEffect(state, bootstrapEmbeddingRetry)');
        expect(source).toContain('await drainQueueSideEffects(state)');
        expect(source).toContain('Skipping embedding write for image');
    });
});
