import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isRestoreMaintenanceActive: vi.fn(),
    drainPendingFileDeletions: vi.fn(async () => undefined),
    flushPendingSessionRevocations: vi.fn(async () => undefined),
    purgeOldAuditLog: vi.fn(async () => undefined),
    purgeOldBuckets: vi.fn(async () => undefined),
    purgeOldViewEvents: vi.fn(async () => undefined),
    dbDeleteWhere: vi.fn(async () => undefined),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: mocks.isRestoreMaintenanceActive,
}));

vi.mock('@/lib/pending-file-deletions', () => ({
    drainPendingFileDeletions: mocks.drainPendingFileDeletions,
}));

vi.mock('@/lib/pending-session-revocations', () => ({
    flushPendingSessionRevocations: mocks.flushPendingSessionRevocations,
}));

vi.mock('@/lib/audit', () => ({
    purgeOldAuditLog: mocks.purgeOldAuditLog,
}));

vi.mock('@/lib/rate-limit', () => ({
    purgeOldBuckets: mocks.purgeOldBuckets,
}));

vi.mock('@/lib/view-retention', () => ({
    purgeOldViewEvents: mocks.purgeOldViewEvents,
}));

vi.mock('@/db', () => ({
    db: {
        delete: () => ({
            where: mocks.dbDeleteWhere,
        }),
    },
    sessions: {
        expiresAt: Symbol('sessions.expires_at'),
    },
}));

vi.mock('drizzle-orm', () => ({
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

import { runMaintenanceSweepOnce } from '@/lib/maintenance-scheduler';

describe('maintenance scheduler pending deletion drain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isRestoreMaintenanceActive.mockReturnValue(false);
    });

    it('skips the pending file deletion drain while restore maintenance is active', async () => {
        mocks.isRestoreMaintenanceActive.mockReturnValue(true);

        await runMaintenanceSweepOnce();

        expect(mocks.drainPendingFileDeletions).not.toHaveBeenCalled();
        expect(mocks.flushPendingSessionRevocations).not.toHaveBeenCalled();
        expect(mocks.dbDeleteWhere).not.toHaveBeenCalled();
    });

    it('runs the pending file deletion drain when restore maintenance is inactive', async () => {
        await runMaintenanceSweepOnce();

        expect(mocks.drainPendingFileDeletions).toHaveBeenCalledTimes(1);
        expect(mocks.flushPendingSessionRevocations).toHaveBeenCalledTimes(1);
    });
});
