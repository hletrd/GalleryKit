export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { assertNoLegacyPublicOriginalUploads } = await import('@/lib/upload-paths');
        await assertNoLegacyPublicOriginalUploads({ failInProduction: true });
        const { bootstrapImageProcessingQueue } = await import('@/lib/image-queue');
        await bootstrapImageProcessingQueue();

        const gracefulShutdown = async (signal: string) => {
            console.debug(`[Shutdown] ${signal} received, draining queue...`);
            let completed = false;
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
                    ]).then(() => { completed = true; }),
                    shutdownTimeout,
                ]);
                if (completed) {
                    console.debug('[Shutdown] In-flight queue work drained, exiting.');
                } else {
                    console.error('[Shutdown] In-flight queue work was NOT fully drained before timeout.');
                }
            } catch (e) {
                console.error('[Shutdown] Failed to drain queue:', e);
            }
            // C4-A3: Exit with code 1 on timeout so the orchestrator (Docker,
            // systemd) knows shutdown was truncated, not clean. A clean exit
            // (code 0) signals success, which is incorrect when work was
            // forcibly terminated.
            process.exitCode = completed ? 0 : 1;
        };

        // C4-A4: Use process.on (not process.once) with a handled-state guard
        // so repeated signals (e.g., SIGTERM from Docker after grace period)
        // are handled gracefully rather than falling through to the default
        // handler (immediate exit).
        let shutdownInProgress = false;
        process.on('SIGTERM', () => {
            if (shutdownInProgress) {
                console.debug('[Shutdown] SIGTERM received while shutdown already in progress, ignoring.');
                return;
            }
            shutdownInProgress = true;
            gracefulShutdown('SIGTERM');
        });
        process.on('SIGINT', () => {
            if (shutdownInProgress) {
                console.debug('[Shutdown] SIGINT received while shutdown already in progress, ignoring.');
                return;
            }
            shutdownInProgress = true;
            gracefulShutdown('SIGINT');
        });
    }
}
