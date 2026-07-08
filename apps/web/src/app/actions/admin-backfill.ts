'use server';

/**
 * admin-backfill.ts — server action for the in-app color-pipeline backfill
 * trigger (R27-UX-HIGH-1, Path A).
 *
 * The heavy lifting lives in `@/lib/admin-backfill-runner.ts`. This file is
 * the same-origin admin gate plus a thin status surface.
 */

import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { requireSameOriginAdmin } from '@/lib/action-guards';
import { logAuditEvent } from '@/lib/audit';
import { acquireAdminMutationSlot } from '@/lib/admin-mutation-barrier';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import {
    triggerAdminBackfill,
    getAdminBackfillCandidateCount,
    readAdminBackfillState,
    type AdminBackfillStatus,
} from '@/lib/admin-backfill-runner';

export interface TriggerBackfillResult {
    ok: boolean;
    /** Discriminated status. UI maps these to localized toasts. */
    status: AdminBackfillStatus['status'];
    affectedRows?: number;
    /** Set when status === 'error' or 'unavailable'. */
    error?: string;
}

export async function triggerBackfill(): Promise<TriggerBackfillResult> {
    const t = await getTranslations('serverActions');
    const originError = await requireSameOriginAdmin();
    if (originError) return { ok: false, status: 'error', error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { ok: false, status: 'unavailable', error: maintenanceError };
    }
    if (!(await isAdmin())) {
        return { ok: false, status: 'error', error: t('unauthorized') };
    }
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) {
        return { ok: false, status: 'unavailable', error: t('restoreInProgress') };
    }

    // AGG-20 (plan-330 Unit B): the candidate count `triggerAdminBackfill`
    // returns (`affectedRows`) is a count-then-handoff snapshot — a benign
    // TOCTOU. If a DB restore (or a concurrent run) lands between the count and
    // the runner's first loop iteration, the UI may briefly report "queued N"
    // while the runner actually no-ops on some/all of those rows. It self-heals
    // on the next status poll (which reads the runner's REAL processed/errors
    // counters, not this snapshot). Not a correctness defect: the number is an
    // upper-bound estimate for the toast, never the authoritative result.
    const result = await triggerAdminBackfill();
    switch (result.status) {
        case 'queued': {
            const currentUser = await getCurrentUser().catch(() => null);
            const userId = currentUser?.id ?? null;
            await logAuditEvent(
                userId,
                'admin_backfill_triggered',
                'images',
                undefined,
                undefined,
                { affected_rows: result.affectedRows },
            ).catch(() => undefined);
            return { ok: true, status: 'queued', affectedRows: result.affectedRows };
        }
        case 'already_running':
            return { ok: false, status: 'already_running' };
        case 'unavailable':
            return { ok: false, status: 'unavailable', error: t('restoreInProgress') };
        case 'error':
            return { ok: false, status: 'error', error: result.reason };
    }
}

export interface BackfillStatusResult {
    ok: boolean;
    running: boolean;
    candidateCount: number;
    /**
     * AGG-R5C3-04: last-run observability surfaced to the admin UI. Previously
     * the runner computed these counters but no consumer read them, so a run
     * where every row encode-failed looked identical to a clean run. All fields
     * reflect the LAST completed run.
     */
    completedRuns?: number;
    /** Candidate count captured when the last run started (its processed-total upper bound). */
    lastQueuedCount?: number;
    /**
     * AGG-1 (run-6 c1): the LAST run's REAL successfully-re-encoded count and
     * fatal-error count, mirrored straight from the runner state. The UI renders
     * `processed` from THIS field — never reconstructed by subtracting failures
     * from `lastQueuedCount`, which dropped `errors` and over-counted.
     */
    processed?: number;
    errors?: number;
    encodeFailures?: number;
    detectionFailures?: number;
    skippedMissingOriginal?: number;
    skippedLocked?: number;
    lastRunNoCandidates?: boolean;
    lastRunHadFailures?: boolean;
    lastError?: string | null;
    error?: string;
}

/** @action-origin-exempt: read-only status check (no DB writes, no mutations). */
export async function getBackfillStatus(): Promise<BackfillStatusResult> {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { ok: false, running: false, candidateCount: 0, error: maintenanceError };
    }
    if (!(await isAdmin())) {
        return { ok: false, running: false, candidateCount: 0, error: t('unauthorized') };
    }
    try {
        const candidateCount = await getAdminBackfillCandidateCount();
        const s = readAdminBackfillState();
        return {
            ok: true,
            running: s.running,
            candidateCount,
            completedRuns: s.completedRuns,
            lastQueuedCount: s.lastQueuedCount,
            processed: s.processed,
            errors: s.errors,
            encodeFailures: s.encodeFailures,
            detectionFailures: s.detectionFailures,
            skippedMissingOriginal: s.skippedMissingOriginal,
            skippedLocked: s.skippedLocked,
            lastRunNoCandidates: s.lastRunNoCandidates,
            lastRunHadFailures: s.lastRunHadFailures,
            lastError: s.lastError,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, running: false, candidateCount: 0, error: msg };
    }
}
