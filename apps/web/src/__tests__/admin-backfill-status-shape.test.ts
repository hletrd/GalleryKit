/**
 * Run-6 Cycle 1 AGG-6 — getBackfillStatus() exposes the extended counter shape.
 *
 * plan-325 item-1's stated test obligation was to pin that `getBackfillStatus()`
 * returns the full last-run counter shape the admin UI depends on. After AGG-1
 * (run-6 c1) that shape additionally includes the REAL `processed` count and the
 * fatal `errors` count, both forwarded straight from runner state. This test
 * locks the forwarding so a future refactor cannot silently drop a field the UI
 * reads (which would regress the AGG-1 honesty fix — the UI renders `processed`
 * and `errors` directly, never reconstructed).
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
    isAdmin: vi.fn(async () => true),
    getCurrentUser: vi.fn(async () => ({ id: 1, username: 'admin' })),
    getRestoreMaintenanceMessage: vi.fn((): string | null => null),
    getAdminBackfillCandidateCount: vi.fn(async () => 3),
    readAdminBackfillState: vi.fn(() => ({
        running: false,
        lastQueuedCount: 5,
        processed: 2,
        errors: 1,
        completedRuns: 4,
        lastError: 'ER_LOCK_DEADLOCK',
        skippedMissingOriginal: 1,
        skippedLocked: 0,
        encodeFailures: 1,
        detectionFailures: 0,
        lastRunNoCandidates: false,
        lastRunHadFailures: true,
    })),
}));

const ADMIN_BACKFILL_ACTION_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'actions', 'admin-backfill.ts'),
    'utf8',
);

vi.mock('@/app/actions/auth', () => ({
    isAdmin: mocks.isAdmin,
    getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: vi.fn(async () => (k: string) => k),
}));

// The action imports getAdminBackfillCandidateCount + readAdminBackfillState
// from the runner module. Mock both; readAdminBackfillState returns a fully
// populated state so we can assert every field is forwarded.
vi.mock('@/lib/admin-backfill-runner', () => ({
    getAdminBackfillCandidateCount: mocks.getAdminBackfillCandidateCount,
    readAdminBackfillState: mocks.readAdminBackfillState,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: mocks.getRestoreMaintenanceMessage,
}));

import { getBackfillStatus } from '@/app/actions/admin-backfill';

describe('AGG-6: getBackfillStatus forwards the extended runner-state shape', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isAdmin.mockResolvedValue(true);
        mocks.getCurrentUser.mockResolvedValue({ id: 1, username: 'admin' });
        mocks.getRestoreMaintenanceMessage.mockReturnValue(null);
        mocks.getAdminBackfillCandidateCount.mockResolvedValue(3);
    });

    it('returns processed + errors + failure/skip counters + lastError', async () => {
        const res = await getBackfillStatus();

        expect(res.ok).toBe(true);
        expect(res.running).toBe(false);
        expect(res.candidateCount).toBe(3);
        // AGG-1: the REAL successful count and fatal-error count the UI renders
        // directly (never reconstructed by subtraction).
        expect(res.processed).toBe(2);
        expect(res.errors).toBe(1);
        // The pre-existing observability counters stay forwarded.
        expect(res.encodeFailures).toBe(1);
        expect(res.detectionFailures).toBe(0);
        expect(res.skippedMissingOriginal).toBe(1);
        expect(res.skippedLocked).toBe(0);
        expect(res.lastRunNoCandidates).toBe(false);
        expect(res.lastRunHadFailures).toBe(true);
        expect(res.lastError).toBe('ER_LOCK_DEADLOCK');
        expect(res.completedRuns).toBe(4);
        expect(res.lastQueuedCount).toBe(5);
    });

    it('returns an unauthorized error shape when not admin', async () => {
        mocks.isAdmin.mockResolvedValueOnce(false);
        const res = await getBackfillStatus();
        expect(res.ok).toBe(false);
        expect(res.error).toBeTruthy();
    });

    it('short-circuits restore maintenance before auth or candidate counting', async () => {
        mocks.getRestoreMaintenanceMessage.mockReturnValueOnce('restoreInProgress');

        const res = await getBackfillStatus();

        expect(res).toEqual({
            ok: false,
            running: false,
            candidateCount: 0,
            error: 'restoreInProgress',
        });
        expect(mocks.isAdmin).not.toHaveBeenCalled();
        expect(mocks.getAdminBackfillCandidateCount).not.toHaveBeenCalled();
        expect(mocks.readAdminBackfillState).not.toHaveBeenCalled();
    });

    it('triggerBackfill is fenced by restore maintenance and the admin mutation barrier', () => {
        const functionIndex = ADMIN_BACKFILL_ACTION_SRC.indexOf('export async function triggerBackfill');
        expect(functionIndex).toBeGreaterThanOrEqual(0);
        const maintenanceIndex = ADMIN_BACKFILL_ACTION_SRC.indexOf('const maintenanceError = getRestoreMaintenanceMessage', functionIndex);
        const adminIndex = ADMIN_BACKFILL_ACTION_SRC.indexOf('if (!(await isAdmin()))', functionIndex);
        const slotIndex = ADMIN_BACKFILL_ACTION_SRC.indexOf('using mutationSlot = acquireAdminMutationSlot();', maintenanceIndex);
        const triggerIndex = ADMIN_BACKFILL_ACTION_SRC.indexOf('const result = await triggerAdminBackfill();', slotIndex);

        expect(ADMIN_BACKFILL_ACTION_SRC).toContain("from '@/lib/admin-mutation-barrier'");
        expect(ADMIN_BACKFILL_ACTION_SRC).toContain("from '@/lib/restore-maintenance'");
        expect(maintenanceIndex).toBeGreaterThan(functionIndex);
        expect(adminIndex).toBeGreaterThan(maintenanceIndex);
        expect(slotIndex).toBeGreaterThan(maintenanceIndex);
        expect(triggerIndex).toBeGreaterThan(slotIndex);
    });
});
