import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordAndEvict,
  removeEntry,
  totalCacheSize,
  isAdminRoute,
  isImageDerivative,
  touchMeta,
  resolveCachedEntryAge,
  evictIfExpired,
  type CacheEntry,
  type CacheStore,
  type MetaStore,
} from '../lib/sw-cache';

// ─── In-memory test doubles ──────────────────────────────────────────────────

class MockCacheStore implements CacheStore {
  deleted: string[] = [];

  async keys(): Promise<{ url: string }[]> {
    return [];
  }

  async delete(url: string): Promise<boolean> {
    this.deleted.push(url);
    return true;
  }
}

class MockMetaStore implements MetaStore {
  private data = new Map<string, CacheEntry>();

  async getAll(): Promise<Map<string, CacheEntry>> {
    return new Map(this.data);
  }

  async setAll(entries: Map<string, CacheEntry>): Promise<void> {
    this.data = new Map(entries);
  }

  /** Convenience: read current state for assertions */
  snapshot(): Map<string, CacheEntry> {
    return new Map(this.data);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('sw-cache: isAdminRoute', () => {
  it('matches /admin', () => {
    expect(isAdminRoute('http://localhost/admin')).toBe(true);
  });

  it('matches /admin/dashboard', () => {
    expect(isAdminRoute('http://localhost/admin/dashboard')).toBe(true);
  });

  it('matches /en/admin/', () => {
    expect(isAdminRoute('http://localhost/en/admin/')).toBe(true);
  });

  it('matches /ko/admin/settings', () => {
    expect(isAdminRoute('http://localhost/ko/admin/settings')).toBe(true);
  });

  it('matches /api/admin/db', () => {
    expect(isAdminRoute('http://localhost/api/admin/db')).toBe(true);
  });

  it('does NOT match /en/gallery', () => {
    expect(isAdminRoute('http://localhost/en/gallery')).toBe(false);
  });

  it('does NOT match /administrator', () => {
    expect(isAdminRoute('http://localhost/administrator')).toBe(false);
  });

  it('does NOT match /api/public', () => {
    expect(isAdminRoute('http://localhost/api/public')).toBe(false);
  });
});

describe('sw-cache: isImageDerivative', () => {
  it('matches /uploads/avif/foo.avif', () => {
    expect(isImageDerivative('http://localhost/uploads/avif/foo.avif')).toBe(true);
  });

  it('matches /uploads/webp/foo.webp', () => {
    expect(isImageDerivative('http://localhost/uploads/webp/foo.webp')).toBe(true);
  });

  it('matches /uploads/jpeg/foo.jpg', () => {
    expect(isImageDerivative('http://localhost/uploads/jpeg/foo.jpg')).toBe(true);
  });

  it('matches locale-prefixed upload derivatives', () => {
    expect(isImageDerivative('http://localhost/en/uploads/jpeg/foo.jpg')).toBe(true);
    expect(isImageDerivative('http://localhost/ko/uploads/avif/foo.avif')).toBe(true);
  });

  it('does NOT match /uploads/original/foo.jpg', () => {
    expect(isImageDerivative('http://localhost/uploads/original/foo.jpg')).toBe(false);
  });

  it('does NOT match locale-prefixed originals', () => {
    expect(isImageDerivative('http://localhost/ko/uploads/original/foo.jpg')).toBe(false);
  });

  it('does NOT match /icons/icon-192.png', () => {
    expect(isImageDerivative('http://localhost/icons/icon-192.png')).toBe(false);
  });
});

describe('sw-cache: recordAndEvict LRU eviction', () => {
  let cache: MockCacheStore;
  let meta: MockMetaStore;

  beforeEach(() => {
    cache = new MockCacheStore();
    meta = new MockMetaStore();
  });

  it('records an entry without eviction when under cap', async () => {
    const evicted = await recordAndEvict(
      'http://localhost/uploads/avif/a.avif',
      1024,
      cache,
      meta,
      50 * 1024 * 1024,
    );
    expect(evicted).toBe(0);
    expect(cache.deleted).toHaveLength(0);
    const snap = meta.snapshot();
    expect(snap.size).toBe(1);
    expect(snap.get('http://localhost/uploads/avif/a.avif')?.size).toBe(1024);
  });

  it('skips zero-size records so LRU accounting cannot hide cached bytes', async () => {
    const evicted = await recordAndEvict(
      'http://localhost/uploads/avif/zero.avif',
      0,
      cache,
      meta,
      50 * 1024 * 1024,
    );

    expect(evicted).toBe(0);
    expect(meta.snapshot().size).toBe(0);
    expect(cache.deleted).toHaveLength(0);
  });

  it('evicts the oldest entry when adding a new one would exceed cap', async () => {
    const cap = 10;

    // Pre-populate two entries that together fill the cap
    await meta.setAll(
      new Map([
        [
          'http://localhost/uploads/avif/old.avif',
          { url: 'http://localhost/uploads/avif/old.avif', size: 6, timestamp: 1000 },
        ],
        [
          'http://localhost/uploads/avif/newer.avif',
          { url: 'http://localhost/uploads/avif/newer.avif', size: 4, timestamp: 2000 },
        ],
      ]),
    );

    // Adding 5 bytes would push total to 15, exceeding cap of 10
    const evicted = await recordAndEvict(
      'http://localhost/uploads/avif/new.avif',
      5,
      cache,
      meta,
      cap,
    );

    // Should have evicted at least 'old.avif' (oldest, 6 bytes) to get back under 10
    expect(evicted).toBeGreaterThan(0);
    expect(cache.deleted).toContain('http://localhost/uploads/avif/old.avif');

    const snap = meta.snapshot();
    // new entry should be present
    expect(snap.has('http://localhost/uploads/avif/new.avif')).toBe(true);
    // total should be <= cap
    let total = 0;
    for (const e of snap.values()) total += e.size;
    expect(total).toBeLessThanOrEqual(cap);
  });

  it('evicts multiple entries until under cap', async () => {
    const cap = 10;

    // Three small entries totalling 9 bytes
    await meta.setAll(
      new Map([
        ['http://localhost/uploads/avif/a.avif', { url: 'http://localhost/uploads/avif/a.avif', size: 3, timestamp: 100 }],
        ['http://localhost/uploads/avif/b.avif', { url: 'http://localhost/uploads/avif/b.avif', size: 3, timestamp: 200 }],
        ['http://localhost/uploads/avif/c.avif', { url: 'http://localhost/uploads/avif/c.avif', size: 3, timestamp: 300 }],
      ]),
    );

    // Adding 8 bytes pushes total to 17 — must evict at least 2 entries
    await recordAndEvict(
      'http://localhost/uploads/avif/big.avif',
      8,
      cache,
      meta,
      cap,
    );

    expect(cache.deleted.length).toBeGreaterThanOrEqual(2);
    // Oldest entries evicted first
    expect(cache.deleted[0]).toBe('http://localhost/uploads/avif/a.avif');
    expect(cache.deleted[1]).toBe('http://localhost/uploads/avif/b.avif');
  });

  // AGG-R5C2-15 (TEST-R5C2-04): use fake timers so the timestamp advance is
  // deterministic — no wall-clock sleep that makes CI flaky under load.
  it('updates timestamp on re-insert (upsert semantics)', async () => {
    vi.useFakeTimers();
    try {
      const url = 'http://localhost/uploads/avif/same.avif';
      await recordAndEvict(url, 100, cache, meta, 50 * 1024 * 1024);
      const first = meta.snapshot().get(url)!.timestamp;

      // Advance the system clock by 50 ms so Date.now() returns a higher value.
      vi.setSystemTime(Date.now() + 50);
      await recordAndEvict(url, 200, cache, meta, 50 * 1024 * 1024);
      const second = meta.snapshot().get(url)!.timestamp;

      expect(second).toBeGreaterThan(first);
      expect(meta.snapshot().get(url)!.size).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  // AGG-H3 (run-6 cycle-2): the head-walk eviction (no sort) relies on
  // insertion order == recency. A re-recorded ("touched") entry MUST move to
  // the Map tail so it is treated as most-recent and survives eviction over an
  // older, untouched entry. Without the delete-then-set upsert this would
  // regress: the touched entry would keep its original (front) position and be
  // evicted as if it were old.
  it('a re-recorded entry survives eviction over an older untouched one (recency reorder)', async () => {
    const cap = 10;
    const A = 'http://localhost/uploads/avif/a.avif';
    const B = 'http://localhost/uploads/avif/b.avif';
    // Insert A then B (A is oldest by insertion order).
    await recordAndEvict(A, 4, cache, meta, cap);
    await recordAndEvict(B, 4, cache, meta, cap);
    // Re-touch A — it must move to the tail (now most-recent).
    await recordAndEvict(A, 4, cache, meta, cap);
    // Now add C (4 bytes) → total 12 > cap 10 → must evict the oldest, which
    // is now B (A was just touched), NOT A.
    const C = 'http://localhost/uploads/avif/c.avif';
    await recordAndEvict(C, 4, cache, meta, cap);

    const snap = meta.snapshot();
    expect(snap.has(A)).toBe(true);           // touched → survives
    expect(snap.has(C)).toBe(true);           // newest → survives
    expect(cache.deleted).toContain(B);       // oldest-by-recency → evicted
    expect(snap.has(B)).toBe(false);
  });

  it('serializes concurrent metadata writes so tracked cache entries are not lost', async () => {
    const A = 'http://localhost/uploads/avif/concurrent-a.avif';
    const B = 'http://localhost/uploads/avif/concurrent-b.avif';

    await Promise.all([
      recordAndEvict(A, 4, cache, meta, 50),
      recordAndEvict(B, 5, cache, meta, 50),
    ]);

    const snap = meta.snapshot();
    expect([...snap.keys()].sort()).toEqual([A, B].sort());
    expect(await totalCacheSize(meta)).toBe(9);
  });
});

describe('sw-cache: removeEntry', () => {
  it('removes a tracked entry from the meta store', async () => {
    const meta = new MockMetaStore();
    await meta.setAll(
      new Map([
        ['http://localhost/uploads/avif/x.avif', { url: 'http://localhost/uploads/avif/x.avif', size: 500, timestamp: 1 }],
      ]),
    );
    await removeEntry('http://localhost/uploads/avif/x.avif', meta);
    expect(meta.snapshot().size).toBe(0);
  });
});

describe('sw-cache: totalCacheSize', () => {
  it('sums all entry sizes', async () => {
    const meta = new MockMetaStore();
    await meta.setAll(
      new Map([
        ['http://localhost/uploads/avif/a.avif', { url: 'http://localhost/uploads/avif/a.avif', size: 100, timestamp: 1 }],
        ['http://localhost/uploads/avif/b.avif', { url: 'http://localhost/uploads/avif/b.avif', size: 200, timestamp: 2 }],
      ]),
    );
    expect(await totalCacheSize(meta)).toBe(300);
  });

  it('returns 0 for empty store', async () => {
    const meta = new MockMetaStore();
    expect(await totalCacheSize(meta)).toBe(0);
  });
});

// R4C6 TEST-R4C6-11: quota-eviction accounting parity with the shipped
// template — entries the browser already evicted (delete() → false) must
// not count toward `evicted` bytes, but their metadata is still dropped.
describe('sw-cache: recordAndEvict quota-evicted entries (R4C6 TEST-R4C6-11)', () => {
  class PhantomCacheStore extends MockCacheStore {
    constructor(private readonly phantoms: Set<string>) {
      super();
    }

    override async delete(url: string): Promise<boolean> {
      await super.delete(url);
      return !this.phantoms.has(url);
    }
  }

  it('pays down the tracked total for phantom entries so real entries are NOT over-evicted (C4-02/DBG4-02)', async () => {
    const phantomUrl = 'http://localhost/uploads/avif/phantom.avif';
    const realUrl = 'http://localhost/uploads/avif/real.avif';
    const cache = new PhantomCacheStore(new Set([phantomUrl]));
    const meta = new MockMetaStore();
    await meta.setAll(
      new Map([
        [phantomUrl, { url: phantomUrl, size: 600, timestamp: 1 }],
        [realUrl, { url: realUrl, size: 600, timestamp: 2 }],
      ]),
    );

    // Cap 1000; adding 300 pushes the TRACKED total to 1500. Dropping the
    // phantom's 600 tracked-but-not-occupied bytes brings it to 900 — under
    // cap — so the walk must STOP there: the real entry survives and zero
    // Cache Storage bytes are reported evicted. (The pre-C4-02 code kept the
    // phantom's bytes in `total` and sacrificed the real entry for them.)
    const evicted = await recordAndEvict('http://localhost/uploads/avif/new.avif', 300, cache, meta, 1000);

    expect(evicted).toBe(0);
    const snapshot = meta.snapshot();
    expect(snapshot.has(phantomUrl)).toBe(false);
    expect(snapshot.has(realUrl)).toBe(true);
    expect(snapshot.has('http://localhost/uploads/avif/new.avif')).toBe(true);
  });

  it('reports only actually-freed bytes when real evictions are still needed past a phantom', async () => {
    const phantomUrl = 'http://localhost/uploads/avif/phantom.avif';
    const realUrl = 'http://localhost/uploads/avif/real.avif';
    const cache = new PhantomCacheStore(new Set([phantomUrl]));
    const meta = new MockMetaStore();
    await meta.setAll(
      new Map([
        [phantomUrl, { url: phantomUrl, size: 600, timestamp: 1 }],
        [realUrl, { url: realUrl, size: 600, timestamp: 2 }],
      ]),
    );

    // Cap 1000; adding 600 → tracked total 1800. Phantom drops it to 1200
    // (still over, contributes 0 evicted); the real entry's genuine eviction
    // frees 600 (total 600, under cap). The just-written entry survives.
    const evicted = await recordAndEvict('http://localhost/uploads/avif/new.avif', 600, cache, meta, 1000);

    expect(evicted).toBe(600);
    const snapshot = meta.snapshot();
    expect(snapshot.has(phantomUrl)).toBe(false);
    expect(snapshot.has(realUrl)).toBe(false);
    expect(snapshot.has('http://localhost/uploads/avif/new.avif')).toBe(true);
  });

  it('DBG4-02 repro: accumulated phantoms must not evict a fresh write that fits the cap', async () => {
    // Two 20 MB phantoms (quota-evicted by the browser) + one genuinely
    // fresh 20 MB write against a 50 MB cap: real occupancy is 20 MB. The
    // pre-C4-02 walk could never pay the phantoms' 40 MB down, so it evicted
    // the entry it had JUST written and emptied the whole meta map.
    const mb = 1024 * 1024;
    const p1 = 'http://localhost/uploads/avif/p1.avif';
    const p2 = 'http://localhost/uploads/avif/p2.avif';
    const fresh = 'http://localhost/uploads/avif/fresh.avif';
    const cache = new PhantomCacheStore(new Set([p1, p2]));
    const meta = new MockMetaStore();
    await meta.setAll(
      new Map([
        [p1, { url: p1, size: 20 * mb, timestamp: 1 }],
        [p2, { url: p2, size: 20 * mb, timestamp: 2 }],
      ]),
    );

    const evicted = await recordAndEvict(fresh, 20 * mb, cache, meta, 50 * mb);

    expect(evicted).toBe(0);
    const snapshot = meta.snapshot();
    expect(snapshot.has(fresh)).toBe(true);
    expect(snapshot.has(p1)).toBe(false);
  });
});

// C2-11 (run-10 c2): meta-first recency touch + expiry, mirroring the
// template's touchMeta/evictExpiredCachedImage/cachedImageAge trio.
describe('sw-cache: touchMeta', () => {
  it('creates a meta entry with the known size when none exists', async () => {
    const meta = new MockMetaStore();
    const url = 'http://localhost/uploads/avif/a.avif';
    await touchMeta(url, 1234, meta);
    const entry = meta.snapshot().get(url);
    expect(entry?.size).toBe(1234);
    expect(entry?.timestamp).toBeTypeOf('number');
  });

  it('keeps the existing tracked size instead of the passed knownSize', async () => {
    const meta = new MockMetaStore();
    const url = 'http://localhost/uploads/avif/a.avif';
    await meta.setAll(new Map([[url, { url, size: 999, timestamp: 100 }]]));
    await touchMeta(url, 1, meta);
    expect(meta.snapshot().get(url)?.size).toBe(999);
  });

  it('bumps the timestamp and moves the entry to the tail (recency reorder)', async () => {
    vi.useFakeTimers();
    try {
      const meta = new MockMetaStore();
      const A = 'http://localhost/uploads/avif/a.avif';
      const B = 'http://localhost/uploads/avif/b.avif';
      await meta.setAll(
        new Map([
          [A, { url: A, size: 10, timestamp: 100 }],
          [B, { url: B, size: 10, timestamp: 200 }],
        ]),
      );
      vi.setSystemTime(300);
      await touchMeta(A, 10, meta);
      const keys = [...meta.snapshot().keys()];
      expect(keys).toEqual([B, A]);
      expect(meta.snapshot().get(A)?.timestamp).toBe(300);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never grows tracked total (no eviction concern) even repeated', async () => {
    const meta = new MockMetaStore();
    const url = 'http://localhost/uploads/avif/a.avif';
    await touchMeta(url, 500, meta);
    await touchMeta(url, 999999, meta);
    expect(await totalCacheSize(meta)).toBe(500);
  });

  // PERF3-03 / C3-22 (run-10 c3): size-0 meta entries under-count the LRU cap.
  it('resolves the real body size lazily when no size is known (knownSize 0)', async () => {
    const meta = new MockMetaStore();
    const url = 'http://localhost/uploads/avif/a.avif';
    const resolveSize = vi.fn(async () => 4321);
    await touchMeta(url, 0, meta, resolveSize);
    expect(resolveSize).toHaveBeenCalledTimes(1);
    expect(meta.snapshot().get(url)?.size).toBe(4321);
  });

  it('does not invoke resolveSize when a size is already tracked', async () => {
    const meta = new MockMetaStore();
    const url = 'http://localhost/uploads/avif/a.avif';
    await meta.setAll(new Map([[url, { url, size: 999, timestamp: 100 }]]));
    const resolveSize = vi.fn(async () => 4321);
    await touchMeta(url, 0, meta, resolveSize);
    expect(resolveSize).not.toHaveBeenCalled();
    expect(meta.snapshot().get(url)?.size).toBe(999);
  });

  it('SKIPS the meta write entirely when the size is unresolvable (never records size 0)', async () => {
    const meta = new MockMetaStore();
    const url = 'http://localhost/uploads/avif/a.avif';
    await touchMeta(url, 0, meta, async () => 0);
    expect(meta.snapshot().has(url)).toBe(false);
    await touchMeta(url, 0, meta, async () => {
      throw new Error('blob read failed');
    });
    expect(meta.snapshot().has(url)).toBe(false);
    await touchMeta(url, 0, meta);
    expect(meta.snapshot().has(url)).toBe(false);
  });
});

describe('sw-cache: resolveCachedEntryAge', () => {
  const now = 10_000;

  it('prefers the meta timestamp when a meta entry exists', () => {
    const metaEntry: CacheEntry = { url: 'x', size: 1, timestamp: 9_000 };
    expect(resolveCachedEntryAge(metaEntry, 1, now)).toBe(1_000);
  });

  it('falls back to the header timestamp when no meta entry exists', () => {
    expect(resolveCachedEntryAge(undefined, 7_000, now)).toBe(3_000);
  });

  it('returns Infinity when neither meta nor header timestamp is usable', () => {
    expect(resolveCachedEntryAge(undefined, null, now)).toBe(Infinity);
    expect(resolveCachedEntryAge(undefined, 0, now)).toBe(Infinity);
    expect(resolveCachedEntryAge(undefined, Number.NaN, now)).toBe(Infinity);
  });

  it('ignores a non-finite meta timestamp and falls back to the header', () => {
    const metaEntry: CacheEntry = { url: 'x', size: 1, timestamp: Number.NaN };
    expect(resolveCachedEntryAge(metaEntry, 4_000, now)).toBe(6_000);
  });
});

describe('sw-cache: evictIfExpired', () => {
  let cache: MockCacheStore;
  let meta: MockMetaStore;

  beforeEach(() => {
    cache = new MockCacheStore();
    meta = new MockMetaStore();
  });

  it('does not evict a fresh entry (meta timestamp within max age)', async () => {
    const url = 'http://localhost/uploads/avif/a.avif';
    await meta.setAll(new Map([[url, { url, size: 10, timestamp: 9_000 }]]));
    const evicted = await evictIfExpired(url, cache, meta, 60_000, null, 10_000);
    expect(evicted).toBe(false);
    expect(cache.deleted).toHaveLength(0);
    expect(meta.snapshot().has(url)).toBe(true);
  });

  it('evicts an entry whose meta timestamp exceeds max age', async () => {
    const url = 'http://localhost/uploads/avif/a.avif';
    await meta.setAll(new Map([[url, { url, size: 10, timestamp: 0 }]]));
    const evicted = await evictIfExpired(url, cache, meta, 1_000, null, 10_000);
    expect(evicted).toBe(true);
    expect(cache.deleted).toContain(url);
    expect(meta.snapshot().has(url)).toBe(false);
  });

  it('treats a repeatedly-touched (confirmed-fresh) entry as fresh even though no header timestamp advances', async () => {
    // Simulates the C2-11 fix: touchMeta keeps bumping the meta timestamp on
    // every 304/same-ETag confirmation without ever rewriting the response
    // header, so expiry must not fall back to a stale/absent header once a
    // meta record exists.
    const url = 'http://localhost/uploads/avif/a.avif';
    await touchMeta(url, 10, meta);
    const evicted = await evictIfExpired(url, cache, meta, 60_000, null, Date.now());
    expect(evicted).toBe(false);
  });

  it('falls back to the header timestamp when no meta record exists', async () => {
    const url = 'http://localhost/uploads/avif/legacy.avif';
    // No meta entry at all (e.g. pre-change entry) — header says it was
    // cached 5s ago, which exceeds the 1s max age used here.
    const evicted = await evictIfExpired(url, cache, meta, 1_000, 5_000, 10_000);
    expect(evicted).toBe(true);
    expect(cache.deleted).toContain(url);
  });

  it('never discards a concurrent same-URL touch (TRC9-01: atomic read-decide-delete)', async () => {
    // Regression for the TOCTOU the pre-9b shape had: the eviction read went
    // through the queue but the decision + delete ran OUTSIDE it, so a
    // touchMeta enqueued between the read and the delete committed a fresh
    // timestamp that the unconditional delete then silently discarded.
    // With the atomic op, the two operations serialize whole-op: the stale
    // eviction runs first (it was enqueued first), then the touch re-creates
    // the entry — the confirmed-fresh touch must SURVIVE, whichever side of
    // the eviction it lands on.
    const url = 'http://localhost/uploads/avif/a.avif';
    await meta.setAll(new Map([[url, { url, size: 10, timestamp: 0 }]]));

    const evictPromise = evictIfExpired(url, cache, meta, 1_000, null, 10_000);
    // Enqueued synchronously right behind the eviction op — exactly the
    // interleaving position that used to land BETWEEN the read and delete.
    const touchPromise = touchMeta(url, 10, meta);
    const [evicted] = await Promise.all([evictPromise, touchPromise]);

    expect(evicted).toBe(true);
    // The touch's committed write survives the eviction instead of being
    // silently discarded (the entry is re-tracked with a fresh timestamp;
    // its bytes refetch on next load — a counted phantom, never a lost
    // confirmed-fresh record).
    const entry = meta.snapshot().get(url);
    expect(entry).toBeDefined();
    expect(entry!.timestamp).toBeGreaterThan(0);
  });
});
