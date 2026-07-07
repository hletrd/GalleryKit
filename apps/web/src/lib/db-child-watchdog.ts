import type { ChildProcessWithoutNullStreams } from 'child_process';

/**
 * Watchdog for the DB backup/restore/migration child processes
 * (mysqldump / mysql / migrate.js), extracted from db-actions.ts so its
 * control flow is behaviorally testable (C7-15, run-10 cycle 7b — the
 * `'use server'` action file may only export async server actions, so the
 * sync helper could not be exported from there).
 *
 * Contract (peer commit 9cd8d3e8 hardened the ordering):
 * - After DB_CHILD_PROCESS_TIMEOUT_MS the child's stdio is destroyed, the
 *   child gets SIGTERM, a SIGKILL grace timer is armed BEFORE `onTimeout`
 *   runs (so an onTimeout that throws/settles synchronously cannot skip the
 *   force-kill), and `onTimeout(err)` is invoked exactly once.
 * - A child that exits/closes before the timeout marks itself settled and
 *   cancels the SIGKILL grace timer.
 * - The returned cleanup cancels the main timer and detaches the settle
 *   listeners ONLY when the timeout has not fired. After the timeout fired,
 *   cleanup is a no-op: kill escalation must survive a late cleanup call,
 *   AND the settle listeners must stay attached so a child that exits during
 *   the SIGKILL grace window still cancels the force-kill — otherwise an
 *   unconditional cleanup caller would leave the grace timer uncancellable
 *   and SIGKILL an already-exited (worst case PID-reused) process
 *   (AGG8b-14 / CRIT8-04, run-10 c8b). The listeners are `once`-registered,
 *   so leaving them attached leaks nothing after the child settles.
 */
export const DB_CHILD_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
export const DB_CHILD_PROCESS_KILL_GRACE_MS = 5000;

export function armDbChildProcessWatchdog(
    child: ChildProcessWithoutNullStreams,
    label: string,
    onTimeout: (err: Error) => void,
): () => void {
    let fired = false;
    let childSettled = false;
    let forceKill: ReturnType<typeof setTimeout> | null = null;
    const markSettled = () => {
        childSettled = true;
        if (forceKill) {
            clearTimeout(forceKill);
            forceKill = null;
        }
    };
    child.once('exit', markSettled);
    child.once('close', markSettled);
    const timeout = setTimeout(() => {
        fired = true;
        const err = new Error(`${label} timed out after ${DB_CHILD_PROCESS_TIMEOUT_MS}ms`);
        child.stdin.destroy(err);
        child.stdout.destroy(err);
        child.stderr.destroy(err);
        child.kill('SIGTERM');
        forceKill = setTimeout(() => {
            if (!childSettled) child.kill('SIGKILL');
        }, DB_CHILD_PROCESS_KILL_GRACE_MS);
        forceKill.unref?.();
        onTimeout(err);
    }, DB_CHILD_PROCESS_TIMEOUT_MS);
    timeout.unref?.();

    return () => {
        // AGG8b-14 / CRIT8-04: after the timeout fired, do NOT detach the
        // settle listeners — a late child exit still has to cancel the
        // SIGKILL grace timer even when a caller runs cleanup unconditionally.
        if (fired) return;
        clearTimeout(timeout);
        markSettled();
        child.off('exit', markSettled);
        child.off('close', markSettled);
    };
}
