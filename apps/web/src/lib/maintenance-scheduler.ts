import { db, sessions } from '@/db';
import { sql } from 'drizzle-orm';

import { purgeOldAuditLog } from '@/lib/audit';
import { purgeOldBuckets } from '@/lib/rate-limit';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { purgeOldViewEvents } from '@/lib/view-retention';
import { drainPendingFileDeletions } from '@/lib/pending-file-deletions';
import { flushPendingSessionRevocations } from '@/lib/pending-session-revocations';

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

let startupSweepRun = false;
let maintenanceInterval: ReturnType<typeof setInterval> | undefined;
let maintenanceSweepInFlight: Promise<void> | undefined;
const activeMaintenanceSweeps = new Set<Promise<void>>();

export async function purgeExpiredSessions() {
    try {
        await db.delete(sessions).where(sql`${sessions.expiresAt} < NOW()`);
    } catch (err) {
        console.error('Failed to purge expired sessions', err);
    }
}

async function runMaintenanceTask(label: string, task: () => Promise<unknown>): Promise<void> {
    if (isRestoreMaintenanceActive()) return;
    try {
        await task();
    } catch (err) {
        console.debug(`${label} failed:`, err);
    }
}

async function runMaintenanceSweepOnce(): Promise<void> {
    if (isRestoreMaintenanceActive()) return;
    await runMaintenanceTask('purgeExpiredSessions', purgeExpiredSessions);
    // C7-01 (run-10 cycle 7b): hourly backstop for logout revocations that a
    // restore window skipped (primary flush point is the restore-marker clear
    // in db-actions.ts). runMaintenanceTask's restore-active guard keeps this
    // from deleting rows mid-import.
    await runMaintenanceTask('flushPendingSessionRevocations', flushPendingSessionRevocations);
    // Retry filesystem cleanup rows left behind by interrupted deletes or by
    // restores that reintroduced pending-deletion DB rows after the files were
    // already removed.
    await runMaintenanceTask('drainPendingFileDeletions', drainPendingFileDeletions);
    await runMaintenanceTask('purgeOldBuckets', purgeOldBuckets);
    await runMaintenanceTask('purgeOldAuditLog', purgeOldAuditLog);
    await runMaintenanceTask('purgeOldViewEvents', purgeOldViewEvents);
}

export function runMaintenanceSweep(): void {
    if (maintenanceSweepInFlight) return;
    const sweep = runMaintenanceSweepOnce();
    maintenanceSweepInFlight = sweep;
    activeMaintenanceSweeps.add(sweep);
    sweep.finally(() => {
        activeMaintenanceSweeps.delete(sweep);
        if (maintenanceSweepInFlight === sweep) {
            maintenanceSweepInFlight = undefined;
        }
    }).catch(err => {
        console.debug('runMaintenanceSweep failed:', err);
    });
}

export async function drainMaintenanceSweepsForRestore(timeoutMs = 5000): Promise<boolean> {
    if (activeMaintenanceSweeps.size === 0) return true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
        timeout.unref?.();
    });
    const drained = Promise.allSettled(Array.from(activeMaintenanceSweeps)).then(() => true);
    const result = await Promise.race([drained, timeoutPromise]);
    if (timeout) clearTimeout(timeout);
    return result;
}

export async function stopMaintenanceScheduler(options: { timeoutMs?: number } = {}): Promise<boolean> {
    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
        maintenanceInterval = undefined;
    }
    return drainMaintenanceSweepsForRestore(options.timeoutMs ?? 5000);
}

export function startMaintenanceScheduler(): void {
    if (!startupSweepRun) {
        startupSweepRun = true;
        runMaintenanceSweep();
    }

    if (maintenanceInterval) return;
    maintenanceInterval = setInterval(runMaintenanceSweep, MAINTENANCE_INTERVAL_MS);
    maintenanceInterval.unref?.();
}

export function stopMaintenanceSchedulerForTests(): void {
    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
        maintenanceInterval = undefined;
    }
    startupSweepRun = false;
    maintenanceSweepInFlight = undefined;
    activeMaintenanceSweeps.clear();
}
