export type QueueShutdownLike = {
    pause: () => void;
    clear: () => void;
    onIdle: () => Promise<void>;
};

export type QueueShutdownStateLike = {
    enqueued: Set<number>;
    sideEffects?: Set<Promise<void>>;
    shuttingDown: boolean;
    shutdownPromise?: Promise<void>;
    gcInterval?: ReturnType<typeof setInterval>;
    bootstrapRetryTimer?: ReturnType<typeof setTimeout>;
};

export async function drainProcessingQueueForShutdown(
    state: QueueShutdownStateLike,
    queue: QueueShutdownLike,
) {
    if (state.shutdownPromise) {
        await state.shutdownPromise;
        return;
    }

    state.shuttingDown = true;
    state.shutdownPromise = (async () => {
        if (state.gcInterval) {
            clearInterval(state.gcInterval);
            state.gcInterval = undefined;
        }
        // C4-C3: Clear the bootstrap retry timer so it doesn't keep the event
        // loop alive after shutdown. Without this, a retry timer armed before
        // shutdown fires after drain, keeping the process alive unnecessarily.
        if (state.bootstrapRetryTimer) {
            clearTimeout(state.bootstrapRetryTimer);
            state.bootstrapRetryTimer = undefined;
        }

        queue.pause();
        queue.clear();
        state.enqueued.clear();
        await queue.onIdle();
        while (state.sideEffects && state.sideEffects.size > 0) {
            await Promise.allSettled(Array.from(state.sideEffects));
        }
    })();

    await state.shutdownPromise;
}
