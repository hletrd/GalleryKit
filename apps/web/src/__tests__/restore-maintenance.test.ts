import { describe, expect, it } from 'vitest';

import { beginRestoreMaintenance, cleanupOriginalIfRestoreMaintenanceBegan, endRestoreMaintenance, getRestoreMaintenanceMessage, isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

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

    it('returns a caller-provided block message while the maintenance window is active', () => {
        endRestoreMaintenance();
        expect(getRestoreMaintenanceMessage('blocked')).toBeNull();

        expect(beginRestoreMaintenance()).toBe(true);
        expect(getRestoreMaintenanceMessage('blocked')).toBe('blocked');

        endRestoreMaintenance();
        expect(getRestoreMaintenanceMessage('blocked')).toBeNull();
    });

    it('cleans up the saved original when restore begins before the upload write boundary', async () => {
        endRestoreMaintenance();
        const cleanupCalls: string[] = [];
        const cleanup = async (filename: string) => {
            cleanupCalls.push(filename);
        };

        expect(await cleanupOriginalIfRestoreMaintenanceBegan('file.jpg', cleanup)).toBe(false);
        expect(cleanupCalls).toEqual([]);

        expect(beginRestoreMaintenance()).toBe(true);
        expect(await cleanupOriginalIfRestoreMaintenanceBegan('file.jpg', cleanup)).toBe(true);
        expect(cleanupCalls).toEqual(['file.jpg']);

        endRestoreMaintenance();
    });
});
