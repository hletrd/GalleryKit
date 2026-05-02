/**
 * sw-cache.ts — Pure LRU cache eviction logic for the GalleryKit service worker.
 *
 * This module is intentionally runtime-agnostic: it does NOT reference the
 * global `caches` API directly. Instead callers pass a CacheStore interface
 * so that Vitest can inject a lightweight in-memory mock without a SW context.
 *
 * US-P24 PWA story — LRU 50 MB cap, admin-route bypass.
 */

export const IMAGE_CACHE_NAME = 'gk-images-v1';
export const HTML_CACHE_NAME = 'gk-html-v1';
export const MAX_IMAGE_CACHE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Minimal subset of the Cache API used by this module. */
export interface CacheEntry {
  url: string;
  size: number;
  timestamp: number;
}

/**
 * CacheStore — minimal interface that both the real `caches.open()` result
 * and test doubles implement.
 */
export interface CacheStore {
  keys(): Promise<{ url: string }[]>;
  delete(url: string): Promise<boolean>;
}

/**
 * MetaStore — stores per-entry metadata (size + timestamp) keyed by URL.
 * In the real SW, this is a second Cache whose single entry is a JSON blob.
 * In tests, it is an in-memory Map.
 */
export interface MetaStore {
  getAll(): Promise<Map<string, CacheEntry>>;
  setAll(entries: Map<string, CacheEntry>): Promise<void>;
}

// ─── Admin-route bypass ───────────────────────────────────────────────────────

/**
 * Returns true when the request URL must NEVER be cached (admin pages,
 * admin API routes, and any response carrying no-store semantics handled
 * at call site).
 */
export function isAdminRoute(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    // Match /[locale]/admin/* and /api/admin/*
    return (
      /^\/[a-z]{2}(-[A-Z]{2})?\/admin(\/|$)/.test(pathname) ||
      /^\/api\/admin(\/|$)/.test(pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Returns true for image derivative paths that should use
 * stale-while-revalidate caching.
 */
export function isImageDerivative(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    return (
      pathname.startsWith('/uploads/avif/') ||
      pathname.startsWith('/uploads/webp/') ||
      pathname.startsWith('/uploads/jpeg/')
    );
  } catch {
    return false;
  }
}

// ─── LRU eviction ────────────────────────────────────────────────────────────

/**
 * Record a new cache entry in the metadata store. If adding `newSize` bytes
 * would push the total over `maxBytes`, evict the oldest entries (LRU) from
 * both the metadata store and the cache store until the total is within cap.
 *
 * @returns number of bytes evicted
 */
export async function recordAndEvict(
  url: string,
  newSize: number,
  cache: CacheStore,
  meta: MetaStore,
  maxBytes: number = MAX_IMAGE_CACHE_BYTES,
): Promise<number> {
  const entries = await meta.getAll();

  // Upsert the new entry
  entries.set(url, { url, size: newSize, timestamp: Date.now() });

  // Compute total
  let total = 0;
  for (const e of entries.values()) {
    total += e.size;
  }

  let evicted = 0;

  if (total > maxBytes) {
    // Sort by timestamp ascending (oldest first)
    const sorted = Array.from(entries.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );

    for (const entry of sorted) {
      if (total <= maxBytes) break;
      // Never evict the entry we just added if we can avoid it — but if we
      // absolutely must (e.g. single entry > cap) we do so anyway.
      await cache.delete(entry.url);
      evicted += entry.size;
      total -= entry.size;
      entries.delete(entry.url);
    }
  }

  await meta.setAll(entries);
  return evicted;
}

/**
 * Remove the metadata entry for a URL (e.g. when the cache returns a miss
 * on keys() reconciliation).
 */
export async function removeEntry(
  url: string,
  meta: MetaStore,
): Promise<void> {
  const entries = await meta.getAll();
  entries.delete(url);
  await meta.setAll(entries);
}

/**
 * Return the total byte size tracked in the metadata store.
 */
export async function totalCacheSize(meta: MetaStore): Promise<number> {
  const entries = await meta.getAll();
  let total = 0;
  for (const e of entries.values()) {
    total += e.size;
  }
  return total;
}
