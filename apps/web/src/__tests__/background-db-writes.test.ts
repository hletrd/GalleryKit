import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isRestoreMaintenanceActiveMock } = vi.hoisted(() => ({
    isRestoreMaintenanceActiveMock: vi.fn(),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

import {
    drainBackgroundDbWritesForRestore,
    getBackgroundDbWriteCountForTests,
    trackBackgroundDbWrite,
} from '@/lib/background-db-writes';

describe('background DB write restore drain', () => {
    beforeEach(async () => {
        isRestoreMaintenanceActiveMock.mockReset();
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        await drainBackgroundDbWritesForRestore();
    });

    it('drains already scheduled writes before restore import proceeds', async () => {
        let releaseWrite!: () => void;
        const write = trackBackgroundDbWrite(() => new Promise<string>((resolve) => {
            releaseWrite = () => resolve('done');
        }));

        expect(getBackgroundDbWriteCountForTests()).toBe(1);
        const drained = drainBackgroundDbWritesForRestore();

        releaseWrite();
        await drained;
        await expect(write).resolves.toBe('done');
        expect(getBackgroundDbWriteCountForTests()).toBe(0);
    });

    it('does not schedule new writes while restore maintenance is active', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);
        const write = vi.fn(async () => 'done');

        await expect(trackBackgroundDbWrite(write)).resolves.toBeUndefined();

        expect(write).not.toHaveBeenCalled();
        expect(getBackgroundDbWriteCountForTests()).toBe(0);
    });
});
