import { describe, expect, it, vi } from 'vitest';

import { drainProcessingQueueForShutdown } from '@/lib/queue-shutdown';

describe('drainProcessingQueueForShutdown', () => {
    it('pauses the queue, clears queued work, and waits for in-flight jobs', async () => {
        const pause = vi.fn();
        const clear = vi.fn();
        const onIdle = vi.fn().mockResolvedValue(undefined);
        const state = {
            enqueued: new Set([1, 2, 3]),
            shuttingDown: false,
        };

        await drainProcessingQueueForShutdown(state, {
            pause,
            clear,
            onIdle,
        });

        expect(state.shuttingDown).toBe(true);
        expect(state.enqueued.size).toBe(0);
        expect(pause).toHaveBeenCalledTimes(1);
        expect(clear).toHaveBeenCalledTimes(1);
        expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('reuses the same shutdown promise when called repeatedly', async () => {
        let resolvePending!: () => void;
        const pending = new Promise<void>((resolve) => {
            resolvePending = resolve;
        });
        const state = {
            enqueued: new Set<number>(),
            shuttingDown: false,
        };
        const queue = {
            pause: vi.fn(),
            clear: vi.fn(),
            onIdle: vi.fn().mockReturnValue(pending),
        };

        const firstCall = drainProcessingQueueForShutdown(state, queue);
        const secondCall = drainProcessingQueueForShutdown(state, queue);
        resolvePending();

        await Promise.all([firstCall, secondCall]);

        expect(queue.pause).toHaveBeenCalledTimes(1);
        expect(queue.clear).toHaveBeenCalledTimes(1);
        expect(queue.onIdle).toHaveBeenCalledTimes(1);
    });
});
