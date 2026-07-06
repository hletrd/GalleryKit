import { afterEach, describe, expect, it } from 'vitest';

/**
 * C1-03 (run-10 cycle-1) — restore-window admin mutation fence
 * (closes deferred C77-ARCH-01).
 */

import {
    acquireAdminMutationSlot,
    drainAdminMutationsForRestore,
    releaseAdminMutationExclusive,
    getAdminMutationBarrierSnapshot,
} from '@/lib/admin-mutation-barrier';

afterEach(() => {
    // Reset the exclusive flag between tests; slots are always released by
    // the tests themselves (using-declaration semantics).
    releaseAdminMutationExclusive();
});

describe('acquireAdminMutationSlot', () => {
    it('grants and releases a shared slot via Symbol.dispose (using declaration)', () => {
        expect(getAdminMutationBarrierSnapshot().inFlight).toBe(0);
        {
            using slot = acquireAdminMutationSlot();
            expect(slot.acquired).toBe(true);
            expect(getAdminMutationBarrierSnapshot().inFlight).toBe(1);
        }
        expect(getAdminMutationBarrierSnapshot().inFlight).toBe(0);
    });

    it('releases on throw paths too', () => {
        expect(() => {
            using slot = acquireAdminMutationSlot();
            expect(slot.acquired).toBe(true);
            throw new Error('boom');
        }).toThrow('boom');
        expect(getAdminMutationBarrierSnapshot().inFlight).toBe(0);
    });

    it('is refused while the exclusive (restore) side is active', async () => {
        await drainAdminMutationsForRestore(10);
        using slot = acquireAdminMutationSlot();
        expect(slot.acquired).toBe(false);
        releaseAdminMutationExclusive();
        using slot2 = acquireAdminMutationSlot();
        expect(slot2.acquired).toBe(true);
    });

    it('release is idempotent', () => {
        const slot = acquireAdminMutationSlot();
        expect(slot.acquired).toBe(true);
        slot[Symbol.dispose]();
        slot[Symbol.dispose]();
        expect(getAdminMutationBarrierSnapshot().inFlight).toBe(0);
    });
});

describe('drainAdminMutationsForRestore', () => {
    it('resolves immediately when no mutation is in flight', async () => {
        await expect(drainAdminMutationsForRestore(50)).resolves.toBe(true);
        expect(getAdminMutationBarrierSnapshot().exclusiveActive).toBe(true);
    });

    it('waits for an in-flight mutation to settle, then drains', async () => {
        const slot = acquireAdminMutationSlot();
        expect(slot.acquired).toBe(true);
        const drain = drainAdminMutationsForRestore(1_000);
        // New mutations are refused while draining.
        using blocked = acquireAdminMutationSlot();
        expect(blocked.acquired).toBe(false);
        // The in-flight holder settles -> drain resolves true.
        slot[Symbol.dispose]();
        await expect(drain).resolves.toBe(true);
    });

    it('times out (returns false) when a holder never settles, and recovers after release', async () => {
        const stuck = acquireAdminMutationSlot();
        expect(stuck.acquired).toBe(true);
        await expect(drainAdminMutationsForRestore(20)).resolves.toBe(false);
        // Caller aborts the restore and releases the exclusive side.
        releaseAdminMutationExclusive();
        stuck[Symbol.dispose]();
        using next = acquireAdminMutationSlot();
        expect(next.acquired).toBe(true);
    });
});
