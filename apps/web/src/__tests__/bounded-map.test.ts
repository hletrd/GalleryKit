/**
 * TEST-R5C1-02: BoundedMap unit tests.
 * Covers: expiry pruning, prune return-value, hard-cap eviction order,
 * createResetAtBoundedMap expiry, createWindowBoundedMap window expiry,
 * overwrite of existing key does not double-count toward cap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    BoundedMap,
    createResetAtBoundedMap,
    createWindowBoundedMap,
} from '@/lib/bounded-map';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

// ── 1. Expiry pruning removes only expired entries ────────────────────────────

describe('BoundedMap expiry pruning', () => {
    it('removes only expired entries, keeps non-expired ones', () => {
        const now = 1_000_000;
        vi.setSystemTime(now);

        const map = new BoundedMap<string, { resetAt: number }>(
            100,
            (entry, t) => entry.resetAt <= t
        );
        map.set('expired', { resetAt: now - 1 }); // already past
        map.set('fresh', { resetAt: now + 10_000 }); // still valid

        map.prune(now);

        expect(map.has('expired')).toBe(false);
        expect(map.has('fresh')).toBe(true);
    });

    it('removes all expired entries when multiple are expired', () => {
        const now = 2_000_000;
        const map = new BoundedMap<string, { resetAt: number }>(
            100,
            (entry, t) => entry.resetAt <= t
        );
        for (let i = 0; i < 5; i++) {
            map.set(`exp${i}`, { resetAt: now - 1 });
        }
        map.set('keep', { resetAt: now + 1 });

        map.prune(now);

        expect(map.size).toBe(1);
        expect(map.has('keep')).toBe(true);
    });
});

// ── 2. prune return-value semantics ──────────────────────────────────────────

describe('BoundedMap prune return value', () => {
    it('returns true when at least one entry was removed', () => {
        const now = 3_000_000;
        const map = new BoundedMap<string, { resetAt: number }>(
            100,
            (entry, t) => entry.resetAt <= t
        );
        map.set('exp', { resetAt: now - 1 });
        const changed = map.prune(now);
        expect(changed).toBe(true);
    });

    it('returns false when nothing was removed (all fresh, under cap)', () => {
        const now = 4_000_000;
        const map = new BoundedMap<string, { resetAt: number }>(
            100,
            (entry, t) => entry.resetAt <= t
        );
        map.set('fresh', { resetAt: now + 10_000 });
        const changed = map.prune(now);
        expect(changed).toBe(false);
    });

    it('returns true when hard-cap eviction fires', () => {
        const now = 5_000_000;
        const map = new BoundedMap<string, { resetAt: number }>(
            2,
            (entry, t) => entry.resetAt <= t
        );
        // Insert 3 fresh entries — none expired, but cap is 2
        map.set('a', { resetAt: now + 1000 });
        map.set('b', { resetAt: now + 1000 });
        map.set('c', { resetAt: now + 1000 });
        const changed = map.prune(now);
        expect(changed).toBe(true);
    });
});

// ── 3. Hard-cap eviction order ────────────────────────────────────────────────

describe('BoundedMap hard-cap eviction order', () => {
    it('maxKeys=3, insert 5, oldest 2 evicted, newest 3 retained', () => {
        const now = 6_000_000;
        const map = new BoundedMap<string, { resetAt: number }>(
            3,
            (entry, t) => entry.resetAt <= t
        );
        // Insert 5 entries in order; none are expired
        map.set('k1', { resetAt: now + 10_000 });
        map.set('k2', { resetAt: now + 10_000 });
        map.set('k3', { resetAt: now + 10_000 });
        map.set('k4', { resetAt: now + 10_000 });
        map.set('k5', { resetAt: now + 10_000 });

        map.prune(now);

        expect(map.size).toBe(3);
        // Oldest two (k1, k2) should be evicted; newest three (k3, k4, k5) retained
        expect(map.has('k1')).toBe(false);
        expect(map.has('k2')).toBe(false);
        expect(map.has('k3')).toBe(true);
        expect(map.has('k4')).toBe(true);
        expect(map.has('k5')).toBe(true);
    });
});

// ── 4. createResetAtBoundedMap expiry honors resetAt ─────────────────────────

describe('createResetAtBoundedMap', () => {
    it('expiry fires exactly when resetAt <= now', () => {
        const now = 7_000_000;
        const map = createResetAtBoundedMap<string>(100);
        map.set('boundary', { count: 1, resetAt: now }); // at exactly now → expired
        map.set('future', { count: 1, resetAt: now + 1 }); // 1ms after → not expired

        map.prune(now);

        expect(map.has('boundary')).toBe(false);
        expect(map.has('future')).toBe(true);
    });

    it('entries survive until their resetAt passes', () => {
        const start = 8_000_000;
        vi.setSystemTime(start);
        const map = createResetAtBoundedMap<string>(100);
        map.set('entry', { count: 1, resetAt: start + 5000 });

        // Before expiry
        map.prune(start + 4999);
        expect(map.has('entry')).toBe(true);

        // After expiry
        map.prune(start + 5000);
        expect(map.has('entry')).toBe(false);
    });
});

// ── 5. createWindowBoundedMap window expiry ───────────────────────────────────

describe('createWindowBoundedMap', () => {
    it('entry expires when now - lastAttempt > windowMs', () => {
        const now = 9_000_000;
        const windowMs = 15 * 60 * 1000; // 15 minutes
        const map = createWindowBoundedMap<string>(100, windowMs);
        map.set('old', { count: 3, lastAttempt: now - windowMs - 1 }); // just past window
        map.set('recent', { count: 1, lastAttempt: now - windowMs + 1 }); // just inside window

        map.prune(now);

        expect(map.has('old')).toBe(false);
        expect(map.has('recent')).toBe(true);
    });

    it('entry at exactly windowMs boundary is NOT expired (> not >=)', () => {
        const now = 10_000_000;
        const windowMs = 60_000;
        const map = createWindowBoundedMap<string>(100, windowMs);
        map.set('boundary', { count: 1, lastAttempt: now - windowMs }); // exact boundary

        map.prune(now);

        // now - lastAttempt = windowMs, which is NOT > windowMs → NOT expired
        expect(map.has('boundary')).toBe(true);
    });
});

// ── 6. Overwrite of existing key does not double-count toward cap ─────────────

describe('BoundedMap overwrite semantics', () => {
    it('overwriting an existing key does not grow the size', () => {
        const now = 11_000_000;
        const map = new BoundedMap<string, { resetAt: number }>(
            3,
            (entry, t) => entry.resetAt <= t
        );
        map.set('a', { resetAt: now + 1000 });
        map.set('b', { resetAt: now + 1000 });
        map.set('c', { resetAt: now + 1000 });

        expect(map.size).toBe(3);

        // Overwrite 'a' — should not grow to 4
        map.set('a', { resetAt: now + 2000 });

        expect(map.size).toBe(3);
    });

    it('overwriting key and then pruning: cap not triggered, no eviction', () => {
        const now = 12_000_000;
        const map = new BoundedMap<string, { resetAt: number }>(
            3,
            (entry, t) => entry.resetAt <= t
        );
        map.set('x', { resetAt: now + 1000 });
        map.set('y', { resetAt: now + 1000 });
        // Overwrite 'x' — still 2 entries
        map.set('x', { resetAt: now + 5000 });

        map.prune(now);

        // Still 2 entries, no eviction
        expect(map.size).toBe(2);
        expect(map.has('x')).toBe(true);
        expect(map.has('y')).toBe(true);
    });
});
