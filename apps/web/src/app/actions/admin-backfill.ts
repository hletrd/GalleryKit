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
    if (!(await isAdmin())) {
        return { ok: false, status: 'error', error: t('unauthorized') };
    }
    const originError = await requireSameOriginAdmin();
    if (originError) return { ok: false, status: 'error', error: originError };

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

/** @action-origin-exempt: read-only status check (no DB writes, no mutations). */
export async function getBackfillStatus(): Promise<{
    ok: boolean;
    running: boolean;
    candidateCount: number;
    error?: string;
}> {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) {
        return { ok: false, running: false, candidateCount: 0, error: t('unauthorized') };
    }
    try {
        const candidateCount = await getAdminBackfillCandidateCount();
        const { running } = readAdminBackfillState();
        return { ok: true, running, candidateCount };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, running: false, candidateCount: 0, error: msg };
    }
}
