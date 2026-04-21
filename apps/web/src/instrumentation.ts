export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { assertNoLegacyPublicOriginalUploads } = await import('@/lib/upload-paths');
        await assertNoLegacyPublicOriginalUploads({ failInProduction: true });

        const gracefulShutdown = async (signal: string) => {
            console.log(`[Shutdown] ${signal} received, draining queue...`);
            const shutdownTimeout = new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.warn('[Shutdown] Timed out after 15s, forcing exit with queued jobs remaining');
                    resolve();
                }, 15_000);
            });
            try {
                const { shutdownImageProcessingQueue } = await import('@/lib/image-queue');
                const { flushBufferedSharedGroupViewCounts } = await import('@/lib/data');
                await Promise.race([
                    Promise.all([
                        shutdownImageProcessingQueue(),
                        flushBufferedSharedGroupViewCounts(),
                    ]).then(() => undefined),
                    shutdownTimeout,
                ]);
                console.log('[Shutdown] In-flight queue work drained, exiting.');
            } catch (e) {
                console.error('[Shutdown] Failed to drain queue:', e);
            }
            process.exit(0);
        };

        process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    }
}
