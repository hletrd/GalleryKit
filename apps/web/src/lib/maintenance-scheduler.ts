import { db, sessions } from '@/db';
import { sql } from 'drizzle-orm';

import { purgeOldAuditLog } from '@/lib/audit';
import { purgeOldBuckets } from '@/lib/rate-limit';
import { purgeOldViewEvents } from '@/lib/view-retention';

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

let startupSweepRun = false;
let maintenanceInterval: ReturnType<typeof setInterval> | undefined;

export async function purgeExpiredSessions() {
    try {
        await db.delete(sessions).where(sql`${sessions.expiresAt} < NOW()`);
    } catch (err) {
        console.error('Failed to purge expired sessions', err);
    }
}

export function runMaintenanceSweep(): void {
    purgeExpiredSessions().catch(err => console.debug('purgeExpiredSessions failed:', err));
    purgeOldBuckets().catch(err => console.debug('purgeOldBuckets failed:', err));
    purgeOldAuditLog().catch(err => console.debug('purgeOldAuditLog failed:', err));
    purgeOldViewEvents().catch(err => console.debug('purgeOldViewEvents failed:', err));
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
}
