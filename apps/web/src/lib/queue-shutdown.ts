export type QueueShutdownLike = {
    pause: () => void;
    clear: () => void;
    onIdle: () => Promise<void>;
};

export type QueueShutdownStateLike = {
    enqueued: Set<number>;
    shuttingDown: boolean;
    shutdownPromise?: Promise<void>;
    gcInterval?: ReturnType<typeof setInterval>;
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

        queue.pause();
        queue.clear();
        state.enqueued.clear();
        await queue.onIdle();
    })();

    await state.shutdownPromise;
}
