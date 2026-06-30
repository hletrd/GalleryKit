import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { beginRestoreMaintenance, cleanupOriginalIfRestoreMaintenanceBegan, endRestoreMaintenance, getRestoreMaintenanceMessage, isRestoreMaintenanceActive, setRestoreMaintenanceActiveForProcess } from '@/lib/restore-maintenance';
import {
    beginDurableRestoreMaintenance,
    clearDurableRestoreMaintenanceForRecovery,
    endDurableRestoreMaintenance,
    isDurableRestoreMaintenanceMarked,
} from '@/lib/restore-maintenance-durable';

describe('restore maintenance state', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'gk-restore-maint-'));
        vi.stubEnv('RESTORE_MAINTENANCE_MARKER_PATH', join(tempDir, 'restore-maintenance.json'));
        endRestoreMaintenance();
    });

    afterEach(() => {
        endRestoreMaintenance();
        vi.unstubAllEnvs();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('activates and clears the maintenance window', () => {
        expect(isRestoreMaintenanceActive()).toBe(false);
        expect(beginRestoreMaintenance()).toBe(true);
        expect(isRestoreMaintenanceActive()).toBe(true);

        endRestoreMaintenance();
        expect(isRestoreMaintenanceActive()).toBe(false);
    });

    it('refuses overlapping maintenance windows', () => {
        expect(beginRestoreMaintenance()).toBe(true);
        expect(beginRestoreMaintenance()).toBe(false);
    });

    it('returns a caller-provided block message while the maintenance window is active', () => {
        expect(getRestoreMaintenanceMessage('blocked')).toBeNull();

        expect(beginRestoreMaintenance()).toBe(true);
        expect(getRestoreMaintenanceMessage('blocked')).toBe('blocked');

        endRestoreMaintenance();
        expect(getRestoreMaintenanceMessage('blocked')).toBeNull();
    });

    it('cleans up the saved original when restore begins before the upload write boundary', async () => {
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

    it('recovers durable maintenance after in-process state is cleared', async () => {
        expect(beginDurableRestoreMaintenance()).toBe(true);

        vi.resetModules();
        const reloadedProcess = await import('@/lib/restore-maintenance');
        const reloadedDurable = await import('@/lib/restore-maintenance-durable');

        reloadedProcess.setRestoreMaintenanceActiveForProcess(false);
        expect(reloadedProcess.isRestoreMaintenanceActive()).toBe(false);
        expect(reloadedDurable.syncRestoreMaintenanceFromDurable()).toBe(true);
        expect(reloadedProcess.isRestoreMaintenanceActive()).toBe(true);
        reloadedDurable.endDurableRestoreMaintenance();
        expect(reloadedProcess.isRestoreMaintenanceActive()).toBe(false);
    });

    it('clears process maintenance if durable marker creation fails', () => {
        vi.stubEnv('RESTORE_MAINTENANCE_MARKER_PATH', tempDir);

        expect(() => beginDurableRestoreMaintenance()).toThrow();
        expect(isRestoreMaintenanceActive()).toBe(false);
    });

    it('clears process maintenance even when durable marker removal fails', () => {
        const markerDir = join(tempDir, 'restore-maintenance.json');
        mkdirSync(markerDir);

        expect(beginRestoreMaintenance()).toBe(true);
        expect(() => endDurableRestoreMaintenance()).toThrow();
        expect(isRestoreMaintenanceActive()).toBe(false);
    });

    it('exposes an explicit recovery helper for stale durable markers', () => {
        expect(beginDurableRestoreMaintenance()).toBe(true);
        setRestoreMaintenanceActiveForProcess(false);

        expect(isDurableRestoreMaintenanceMarked()).toBe(true);
        clearDurableRestoreMaintenanceForRecovery();

        expect(isDurableRestoreMaintenanceMarked()).toBe(false);
        expect(isRestoreMaintenanceActive()).toBe(false);
    });
});
