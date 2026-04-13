export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        // Graceful shutdown: drain the image processing queue before exit.
        // Without this, SIGTERM kills in-flight Sharp jobs, leaving partial
        // files on disk and processed=false in the DB.
        process.once('SIGTERM', async () => {
            console.log('[Shutdown] SIGTERM received, draining queue...');
            try {
                const { shutdownImageProcessingQueue } = await import('@/lib/image-queue');
                await shutdownImageProcessingQueue();
                console.log('[Shutdown] In-flight queue work drained, exiting.');
            } catch (e) {
                console.error('[Shutdown] Failed to drain queue:', e);
            }
            process.exit(0);
        });
    }
}
