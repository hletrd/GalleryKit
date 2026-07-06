export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { syncRestoreMaintenanceFromDurable } = await import('@/lib/restore-maintenance-durable');
        syncRestoreMaintenanceFromDurable();
        const { assertNoLegacyPublicOriginalUploads } = await import('@/lib/upload-paths');
        await assertNoLegacyPublicOriginalUploads({ failInProduction: true });
        const { bootstrapImageProcessingQueue } = await import('@/lib/image-queue');
        await bootstrapImageProcessingQueue();

        // AGG-R11C11-L13: Pre-warm geoip-lite at startup so the first analytics
        // lookup does not pay the 50-100 ms module-load penalty on the hot path.
        // The module is optional (dev environments may not have the data files).
        try {
            await import('geoip-lite');
        } catch {
            // geoip-lite data files not present — lookups will gracefully fall
            // back to 'unknown' country code in analytics.ts
        }

        // C2-03 (run-10 c2): WARN-ONLY single-writer boot guard. Fire-and-forget
        // — never awaited in a way that would delay boot. startSingleWriterGuard
        // handles all its own errors internally and never rejects; the .catch
        // here is defense-in-depth only (an unhandled rejection is fatal under
        // Node's default policy).
        import('@/lib/single-writer-guard')
            .then(({ startSingleWriterGuard }) => startSingleWriterGuard())
            .catch((err) => {
                console.warn('[Startup] single-writer guard failed to initialize (non-fatal):', err);
            });

        const gracefulShutdown = async (signal: string) => {
            console.debug(`[Shutdown] ${signal} received, draining queue...`);
            let completed = false;
            // R12C12 AGG-R12-01: capture the sentinel timer so it can be cleared
            // once the drain resolves. `.unref()` so the timer alone never keeps
            // the event loop alive, and clearing it prevents a FALSE
            // "[Shutdown] Timed out after 15s" warning after a clean sub-15s drain.
            let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
            const shutdownTimeout = new Promise<void>((resolve) => {
                shutdownTimer = setTimeout(() => {
                    console.warn('[Shutdown] Timed out after 15s, forcing exit with queued jobs remaining');
                    resolve();
                }, 15_000);
                shutdownTimer.unref?.();
            });
            try {
                const { shutdownImageProcessingQueue } = await import('@/lib/image-queue');
                const { flushBufferedSharedGroupViewCounts } = await import('@/lib/data');
                const { drainBackgroundDbWrites } = await import('@/lib/background-db-writes');
                const { stopSingleWriterGuard } = await import('@/lib/single-writer-guard');
                await Promise.race([
                    Promise.all([
                        shutdownImageProcessingQueue(),
                        flushBufferedSharedGroupViewCounts(),
                        drainBackgroundDbWrites(),
                        stopSingleWriterGuard(),
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
            } finally {
                if (shutdownTimer) clearTimeout(shutdownTimer);
            }
            // C4-A3: Exit with code 1 on timeout so the orchestrator (Docker,
            // systemd) knows shutdown was truncated, not clean. A clean exit
            // (code 0) signals success, which is incorrect when work was
            // forcibly terminated.
            const exitCode = completed ? 0 : 1;
            process.exitCode = exitCode;
            // R12C12 AGG-R12-01: explicitly exit. The MySQL connection pool holds
            // ref'd sockets that keep the event loop alive, so without this the
            // process never terminates on its own — Docker then SIGKILLs it at the
            // stop timeout (exit 137). The drain above has already finished (or
            // timed out), so exiting now is safe and lets the orchestrator see a
            // prompt, intentional exit code.
            process.exit(exitCode);
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
