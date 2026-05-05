/**
 * CRI-38-01 / D44-P01: Generic bounded Map that handles expiry pruning
 * and hard-cap eviction. Replaces the duplicated prune+evict pattern
 * across rate-limit.ts, auth-rate-limit.ts, and actions/public.ts.
 *
 * Two expiry strategies are supported:
 * 1. `resetAt`-based: entry expires when `entry.resetAt <= now`
 * 2. Window-based: entry expires when `now - entry.lastAttempt > windowMs`
 *
 * Consumers pick the strategy by providing an `isExpired` callback.
 */

/** Entry shape for `resetAt`-based rate-limit maps. */
export interface ResetAtEntry {
    count: number;
    resetAt: number;
}

/** Entry shape for window-based rate-limit maps. */
export interface WindowEntry {
    count: number;
    lastAttempt: number;
}

export type RateLimitEntry = ResetAtEntry | WindowEntry;

/**
 * A bounded Map that prunes expired entries and evicts oldest entries
 * when `prune()` is called. Consumers should invoke `prune()` before
 * reads and writes to enforce the hard cap and expiry policy.
 */
export class BoundedMap<K, V> {
    private readonly map = new Map<K, V>();
    private readonly maxKeys: number;
    private readonly isExpired: (entry: V, now: number) => boolean;

    /**
     * @param maxKeys  Hard cap on the number of entries. When exceeded,
     *                 the oldest entries (insertion-order) are evicted.
     * @param isExpired  Predicate that returns true when an entry should
     *                   be pruned (e.g., its reset time has passed).
     */
    constructor(maxKeys: number, isExpired: (entry: V, now: number) => boolean) {
        this.maxKeys = maxKeys;
        this.isExpired = isExpired;
    }

    /** Underlying Map reference for direct reads (e.g., `.get()`, `.has()`). */
    get data(): Map<K, V> {
        return this.map;
    }

    get size(): number {
        return this.map.size;
    }

    get(key: K): V | undefined {
        return this.map.get(key);
    }

    has(key: K): boolean {
        return this.map.has(key);
    }

    set(key: K, value: V): this {
        this.map.set(key, value);
        return this;
    }

    delete(key: K): boolean {
        return this.map.delete(key);
    }

    clear(): void {
        this.map.clear();
    }

    keys(): IterableIterator<K> {
        return this.map.keys();
    }

    /** Iterate over entries for external consumers that need full access. */
    entries(): IterableIterator<[K, V]> {
        return this.map.entries();
    }

    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.map[Symbol.iterator]();
    }

    /**
     * Prune expired entries and enforce the hard cap.
     * Call periodically (e.g., before each rate-limit check).
     *
     * @param now  Current timestamp in ms (Date.now()).
     * @returns true if pruning was performed.
     */
    prune(now: number): boolean {
        const before = this.map.size;

        // C7-MED-01: collect expired keys first, then delete in a separate pass.
        // ES6 guarantees that Map.prototype.delete() during for...of iteration is
        // safe (the iterator accounts for deletions), but the collect-then-delete
        // pattern is clearer for reviewers and avoids any future-spec concerns.
        const expiredKeys: K[] = [];
        for (const [key, entry] of this.map) {
            if (this.isExpired(entry, now)) {
                expiredKeys.push(key);
            }
        }
        for (const key of expiredKeys) {
            this.map.delete(key);
        }

        // Hard cap: evict oldest entries if still over limit
        if (this.map.size > this.maxKeys) {
            const excess = this.map.size - this.maxKeys;
            const evictKeys: K[] = [];
            for (const key of this.map.keys()) {
                if (evictKeys.length >= excess) break;
                evictKeys.push(key);
            }
            for (const key of evictKeys) {
                this.map.delete(key);
            }
        }

        return this.map.size !== before;
    }
}

// ── Convenience constructors for the two common expiry strategies ──────

/** Create a BoundedMap where entries expire when `entry.resetAt <= now`. */
export function createResetAtBoundedMap<K>(maxKeys: number): BoundedMap<K, ResetAtEntry> {
    return new BoundedMap<K, ResetAtEntry>(maxKeys, (entry, now) => entry.resetAt <= now);
}

/** Create a BoundedMap where entries expire when `now - entry.lastAttempt > windowMs`. */
export function createWindowBoundedMap<K>(maxKeys: number, windowMs: number): BoundedMap<K, WindowEntry> {
    return new BoundedMap<K, WindowEntry>(maxKeys, (entry, now) => now - entry.lastAttempt > windowMs);
}
