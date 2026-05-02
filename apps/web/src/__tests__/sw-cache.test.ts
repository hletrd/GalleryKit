import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordAndEvict,
  removeEntry,
  totalCacheSize,
  isAdminRoute,
  isImageDerivative,
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

  it('does NOT match /uploads/original/foo.jpg', () => {
    expect(isImageDerivative('http://localhost/uploads/original/foo.jpg')).toBe(false);
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

  it('updates timestamp on re-insert (upsert semantics)', async () => {
    const url = 'http://localhost/uploads/avif/same.avif';
    await recordAndEvict(url, 100, cache, meta, 50 * 1024 * 1024);
    const first = meta.snapshot().get(url)!.timestamp;

    // Small delay to ensure timestamp changes
    await new Promise((r) => setTimeout(r, 2));
    await recordAndEvict(url, 200, cache, meta, 50 * 1024 * 1024);
    const second = meta.snapshot().get(url)!.timestamp;

    expect(second).toBeGreaterThanOrEqual(first);
    expect(meta.snapshot().get(url)!.size).toBe(200);
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
