import { describe, expect, it } from 'vitest';

import { beginRestoreMaintenance, endRestoreMaintenance, isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

describe('restore maintenance state', () => {
    it('activates and clears the maintenance window', () => {
        endRestoreMaintenance();

        expect(isRestoreMaintenanceActive()).toBe(false);
        expect(beginRestoreMaintenance()).toBe(true);
        expect(isRestoreMaintenanceActive()).toBe(true);

        endRestoreMaintenance();
        expect(isRestoreMaintenanceActive()).toBe(false);
    });

    it('refuses overlapping maintenance windows', () => {
        endRestoreMaintenance();

        expect(beginRestoreMaintenance()).toBe(true);
        expect(beginRestoreMaintenance()).toBe(false);

        endRestoreMaintenance();
    });
});
