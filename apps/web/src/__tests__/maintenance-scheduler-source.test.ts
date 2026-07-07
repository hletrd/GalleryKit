import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INSTRUMENTATION_SRC = readFileSync(resolve(__dirname, '../instrumentation.ts'), 'utf8');
const IMAGE_QUEUE_SRC = readFileSync(resolve(__dirname, '../lib/image-queue.ts'), 'utf8');
const MAINTENANCE_SRC = readFileSync(resolve(__dirname, '../lib/maintenance-scheduler.ts'), 'utf8');

describe('maintenance scheduler ownership (run-10 cycle 5)', () => {
    it('starts site maintenance from instrumentation before image queue bootstrap', () => {
        expect(INSTRUMENTATION_SRC).toContain("await import('@/lib/maintenance-scheduler')");
        expect(INSTRUMENTATION_SRC).toContain('startMaintenanceScheduler();');
        expect(INSTRUMENTATION_SRC.indexOf('startMaintenanceScheduler();'))
            .toBeLessThan(INSTRUMENTATION_SRC.indexOf('bootstrapImageProcessingQueue()'));
    });

    it('keeps site-wide retention jobs out of image-queue bootstrap', () => {
        expect(IMAGE_QUEUE_SRC).not.toContain("from '@/lib/rate-limit'");
        expect(IMAGE_QUEUE_SRC).not.toContain("from '@/lib/audit'");
        expect(IMAGE_QUEUE_SRC).not.toContain("from '@/lib/view-retention'");
        expect(IMAGE_QUEUE_SRC).not.toContain('purgeExpiredSessions');
        expect(MAINTENANCE_SRC).toContain('purgeExpiredSessions');
        expect(MAINTENANCE_SRC).toContain('purgeOldBuckets');
        expect(MAINTENANCE_SRC).toContain('purgeOldAuditLog');
        expect(MAINTENANCE_SRC).toContain('purgeOldViewEvents');
    });

    it('skips and drains maintenance sweeps during restore windows', () => {
        expect(MAINTENANCE_SRC).toContain("from '@/lib/restore-maintenance'");
        expect(MAINTENANCE_SRC).toContain('isRestoreMaintenanceActive()');
        expect(MAINTENANCE_SRC).toContain('activeMaintenanceSweeps');
        expect(MAINTENANCE_SRC).toContain('drainMaintenanceSweepsForRestore');
    });
});
