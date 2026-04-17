export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        // Graceful shutdown: drain the image processing queue before exit.
        // Without this, SIGTERM kills in-flight Sharp jobs, leaving partial
        // files on disk and processed=false in the DB.
        process.once('SIGTERM', async () => {
            console.log('[Shutdown] SIGTERM received, draining queue...');
            const shutdownTimeout = new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.warn('[Shutdown] Timed out after 15s, forcing exit with queued jobs remaining');
                    resolve();
                }, 15_000);
            });
            try {
                const { shutdownImageProcessingQueue } = await import('@/lib/image-queue');
                await Promise.race([shutdownImageProcessingQueue(), shutdownTimeout]);
                console.log('[Shutdown] In-flight queue work drained, exiting.');
            } catch (e) {
                console.error('[Shutdown] Failed to drain queue:', e);
            }
            process.exit(0);
        });
    }
}
