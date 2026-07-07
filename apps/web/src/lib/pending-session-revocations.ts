import { db, sessions } from '@/db';
import { inArray } from 'drizzle-orm';

/**
 * C7-01 (run-10 cycle 7b, 5-lane agreement): `logout()` during a
 * restore-maintenance / mutation-barrier window used to clear the cookie and
 * redirect (looking like a full logout) while silently DROPPING the
 * server-side session-row delete — the token stayed verifiable for up to its
 * remaining 24 h lifetime. Failing the logout loudly would break the
 * deliberate "the cookie always clears locally" UX (3acf638a), so instead the
 * skipped revocation is QUEUED here and flushed once the window closes.
 *
 * The flush point after a restore is also the only semantically correct one:
 * the restore import REPLACES the sessions table with backup contents, so a
 * pre-import delete would be undone by the import itself.
 *
 * Residual risk (accepted, documented): the queue is process-local — a crash
 * between the skipped delete and the flush loses the pending revocation. The
 * cookie is already cleared at that point, so the gap only matters for a
 * token exfiltrated by a third party, which is the same exposure the session
 * TTL already bounds.
 */

const MAX_PENDING_REVOCATIONS = 256;

// ARCH9-02 (loop-B cycle 9): survive module re-instantiation (dev-mode Fast
// Refresh / duplicate module graphs) via the same `globalThis + Symbol.for`
// guard used by the six sibling coordination-state modules
// (admin-mutation-barrier, restore-maintenance, image-queue,
// upload-tracker-state, admin-backfill-runner, storage/index). A silently
// reset queue would drop restore-window session revocations with no log.
const pendingRevocationsKey = Symbol.for('gallerykit.pendingSessionRevocations');

type PendingRevocationsGlobal = typeof globalThis & {
    [pendingRevocationsKey]?: Set<string>;
};

function getPending(): Set<string> {
    const globalWithPending = globalThis as PendingRevocationsGlobal;
    if (!(globalWithPending[pendingRevocationsKey] instanceof Set)) {
        globalWithPending[pendingRevocationsKey] = new Set<string>();
    }
    return globalWithPending[pendingRevocationsKey]!;
}

/** Queue a session-token hash whose DB delete was skipped by a restore window. */
export function enqueuePendingSessionRevocation(tokenHash: string): void {
    if (!tokenHash) return;
    const pending = getPending();
    if (pending.size >= MAX_PENDING_REVOCATIONS && !pending.has(tokenHash)) {
        // Bounded set: evict the oldest entry (Set preserves insertion order).
        const oldest = pending.values().next().value;
        if (oldest !== undefined) pending.delete(oldest);
    }
    pending.add(tokenHash);
}

export function pendingSessionRevocationCount(): number {
    return getPending().size;
}

/**
 * Delete every queued session row. Entries are only removed from the queue
 * after the DELETE commits, so a failed flush retries on the next call (the
 * hourly maintenance sweep is the backstop). Never throws.
 *
 * @returns the number of queued revocations flushed (0 on failure or empty).
 */
export async function flushPendingSessionRevocations(): Promise<number> {
    const pending = getPending();
    if (pending.size === 0) return 0;
    const hashes = Array.from(pending);
    try {
        await db.delete(sessions).where(inArray(sessions.id, hashes));
    } catch (err) {
        console.error(
            'Failed to flush pending session revocations; they remain queued for the next sweep:',
            err,
        );
        return 0;
    }
    for (const hash of hashes) {
        pending.delete(hash);
    }
    return hashes.length;
}

/** Test-only reset. */
export function _clearPendingSessionRevocationsForTest(): void {
    getPending().clear();
}
