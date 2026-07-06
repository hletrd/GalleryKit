/**
 * C1-03 (run-10 cycle-1) — closes deferred C77-ARCH-01 (High, aged 8+ cycles):
 * restore-window fence for foreground admin mutations.
 *
 * Problem: every mutating admin action checks `getRestoreMaintenanceMessage()`
 * ONCE at entry. A mutation admitted a moment BEFORE the durable restore
 * maintenance marker flips can still be awaiting mid-body when the restore
 * imports the dump, and then commit its writes INTO the freshly restored
 * database — silent post-restore corruption.
 *
 * Mechanism (process-local, correct for the documented single-web-instance /
 * single-writer topology in CLAUDE.md — same scope as `restore-maintenance`'s
 * process flag):
 *
 * - Each mutating admin action holds a SHARED slot for its whole body via
 *   `using slot = acquireAdminMutationSlot()` (TS explicit resource
 *   management — `Symbol.dispose` runs on EVERY exit path: return, throw,
 *   early-return). Acquisition fails while the exclusive side is active.
 *   (The durable maintenance MARKER is checked by every action at entry,
 *   before the slot; the barrier itself deliberately has no dependency on
 *   the restore-maintenance module — a mutation that slips past its entry
 *   check before the marker flips is exactly what the drain below handles.)
 * - The restore acquires the EXCLUSIVE side after setting the durable
 *   maintenance marker: new mutations are refused (marker + exclusive flag),
 *   and `drainAdminMutations()` waits for in-flight slot holders to settle
 *   before the import starts. If holders do not settle within the timeout
 *   (e.g. an upload blocked on the upload-processing-contract lock that the
 *   restore itself holds — a bounded, self-resolving wait-cycle), the restore
 *   ABORTS rather than importing over concurrent writes.
 *
 * Reentrancy: slots are counted, so an action that internally invokes another
 * slot-holding helper simply increments the count twice.
 */

type BarrierState = {
    inFlight: number;
    exclusiveActive: boolean;
    drainWaiters: Array<() => void>;
};

const barrierKey = Symbol.for('gallerykit.adminMutationBarrier');

function getBarrierState(): BarrierState {
    const globalWithBarrier = globalThis as typeof globalThis & {
        [barrierKey]?: BarrierState;
    };
    const existing = globalWithBarrier[barrierKey];
    if (
        existing
        && typeof existing === 'object'
        && typeof existing.inFlight === 'number'
        && Array.isArray(existing.drainWaiters)
    ) {
        return existing;
    }
    const fresh: BarrierState = { inFlight: 0, exclusiveActive: false, drainWaiters: [] };
    globalWithBarrier[barrierKey] = fresh;
    return fresh;
}

function notifyDrainWaitersIfIdle(state: BarrierState) {
    if (state.inFlight !== 0) return;
    const waiters = state.drainWaiters.splice(0, state.drainWaiters.length);
    for (const waiter of waiters) waiter();
}

export type AdminMutationSlot = { acquired: boolean } & Disposable;

/**
 * Acquire a shared foreground-mutation slot for the calling action's whole
 * body. Use with a `using` declaration so release is exit-path-proof:
 *
 *     using mutationSlot = acquireAdminMutationSlot();
 *     if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
 */
export function acquireAdminMutationSlot(): AdminMutationSlot {
    const state = getBarrierState();
    if (state.exclusiveActive) {
        return { acquired: false, [Symbol.dispose]() { /* nothing held */ } };
    }
    state.inFlight++;
    let released = false;
    return {
        acquired: true,
        [Symbol.dispose]() {
            if (released) return;
            released = true;
            state.inFlight--;
            notifyDrainWaitersIfIdle(state);
        },
    };
}

/** Default drain budget before a restore gives up and aborts. */
export const ADMIN_MUTATION_DRAIN_TIMEOUT_MS = 30_000;

/**
 * Restore side: block new mutation slots and wait for in-flight holders to
 * settle. Returns true when drained; false on timeout (caller must abort the
 * restore and call releaseAdminMutationExclusive()).
 */
export async function drainAdminMutationsForRestore(
    timeoutMs: number = ADMIN_MUTATION_DRAIN_TIMEOUT_MS,
): Promise<boolean> {
    const state = getBarrierState();
    state.exclusiveActive = true;
    if (state.inFlight === 0) return true;

    return new Promise<boolean>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            const idx = state.drainWaiters.indexOf(onIdle);
            if (idx !== -1) state.drainWaiters.splice(idx, 1);
            resolve(false);
        }, timeoutMs);
        timer.unref?.();
        function onIdle() {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(true);
        }
        state.drainWaiters.push(onIdle);
        // Re-check: a holder may have released between the inFlight check
        // above and the waiter registration.
        notifyDrainWaitersIfIdle(state);
    });
}

/** Clear the exclusive flag once the restore window ends (success or abort). */
export function releaseAdminMutationExclusive(): void {
    getBarrierState().exclusiveActive = false;
}

/** Test-only introspection helper. */
export function getAdminMutationBarrierSnapshot(): { inFlight: number; exclusiveActive: boolean } {
    const state = getBarrierState();
    return { inFlight: state.inFlight, exclusiveActive: state.exclusiveActive };
}
