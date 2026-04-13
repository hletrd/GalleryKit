export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        // Graceful shutdown: drain the image processing queue before exit.
        // Without this, SIGTERM kills in-flight Sharp jobs, leaving partial
        // files on disk and processed=false in the DB.
        process.once('SIGTERM', async () => {
            console.log('[Shutdown] SIGTERM received, draining queue...');
            try {
                // Access the queue via the same global Symbol used by actions.ts.
                // This avoids importing from 'use server' which restricts exports.
                const queueKey = Symbol.for('gallerykit.imageProcessingQueue');
                const state = (globalThis as Record<symbol, unknown>)[queueKey] as
                    { queue: { pause: () => void; onIdle: () => Promise<void> }; gcInterval?: ReturnType<typeof setInterval> } | undefined;

                if (state) {
                    state.queue.pause();
                    if (state.gcInterval) clearInterval(state.gcInterval);
                    await state.queue.onIdle();
                    console.log('[Shutdown] Queue drained, exiting.');
                } else {
                    console.log('[Shutdown] No active queue, exiting.');
                }
            } catch (e) {
                console.error('[Shutdown] Failed to drain queue:', e);
            }
            process.exit(0);
        });
    }
}
