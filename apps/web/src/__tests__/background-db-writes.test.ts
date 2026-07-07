import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isRestoreMaintenanceActiveMock } = vi.hoisted(() => ({
    isRestoreMaintenanceActiveMock: vi.fn(),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

import {
    ANALYTICS_DB_WRITE_CONCURRENCY,
    ANALYTICS_DB_WRITE_MAX_PENDING,
    drainBackgroundDbWritesForRestore,
    getAnalyticsDbWriteStateForTests,
    getBackgroundDbWriteCountForTests,
    trackAnalyticsDbWrite,
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

    it('returns false when a tracked write does not settle within the restore drain budget', async () => {
        let releaseWrite!: () => void;
        const write = trackBackgroundDbWrite(() => new Promise<string>((resolve) => {
            releaseWrite = () => resolve('stuck-done');
        }));

        expect(getBackgroundDbWriteCountForTests()).toBe(1);
        // A stuck write must not hang the drain forever — the bounded restore
        // drain aborts with `false` so the restore caller can release its locks.
        await expect(drainBackgroundDbWritesForRestore(20)).resolves.toBe(false);

        // Clean up so the never-settled write does not leak into later tests.
        releaseWrite();
        await write;
        await drainBackgroundDbWritesForRestore();
        expect(getBackgroundDbWriteCountForTests()).toBe(0);
    });

    it('does not schedule new writes while restore maintenance is active', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);
        const write = vi.fn(async () => 'done');

        await expect(trackBackgroundDbWrite(write)).resolves.toBeUndefined();

        expect(write).not.toHaveBeenCalled();
        expect(getBackgroundDbWriteCountForTests()).toBe(0);
    });

    it('bounds anonymous analytics write concurrency and backlog', async () => {
        const releases: Array<() => void> = [];
        const write = vi.fn(() => new Promise<void>((resolve) => {
            releases.push(resolve);
        }));

        const writes = Array.from(
            { length: ANALYTICS_DB_WRITE_MAX_PENDING + 1 },
            () => trackAnalyticsDbWrite(write),
        );

        expect(write).toHaveBeenCalledTimes(ANALYTICS_DB_WRITE_CONCURRENCY);
        expect(getAnalyticsDbWriteStateForTests()).toEqual({
            active: ANALYTICS_DB_WRITE_CONCURRENCY,
            queued: ANALYTICS_DB_WRITE_MAX_PENDING - ANALYTICS_DB_WRITE_CONCURRENCY,
            tracked: ANALYTICS_DB_WRITE_MAX_PENDING,
        });

        while (getAnalyticsDbWriteStateForTests().tracked > 0) {
            for (const release of releases.splice(0)) {
                release();
            }
            await Promise.resolve();
        }
        await drainBackgroundDbWritesForRestore();
        await expect(Promise.all(writes)).resolves.toHaveLength(ANALYTICS_DB_WRITE_MAX_PENDING + 1);
        expect(getAnalyticsDbWriteStateForTests()).toEqual({ active: 0, queued: 0, tracked: 0 });
        expect(write).toHaveBeenCalledTimes(ANALYTICS_DB_WRITE_MAX_PENDING);
    });
});
