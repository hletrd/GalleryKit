/**
 * sw-cache.ts — Pure LRU cache eviction logic for the GalleryKit service worker.
 *
 * This module is intentionally runtime-agnostic: it does NOT reference the
 * global `caches` API directly. Instead callers pass a CacheStore interface
 * so that Vitest can inject a lightweight in-memory mock without a SW context.
 *
 * R4C6 TEST-R4C6-11: this module is the unit-tested REFERENCE for the
 * SHIPPED copy in `public/sw.template.js` — keep the two in lockstep
 * (the template cannot import modules without an SW bundler step).
 * `__tests__/sw-template-contract.test.ts` pins the template against
 * semantic drift.
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

let metaMutationQueue: Promise<unknown> = Promise.resolve();

function withMetaMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = metaMutationQueue.then(operation, operation);
  metaMutationQueue = run.catch(() => undefined);
  return run;
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
    // Match /admin/*, /[locale]/admin/*, and /api/admin/*
    return (
      /^\/admin(\/|$)/.test(pathname) ||
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
    return /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?uploads\/(?:avif|webp|jpeg)\//.test(pathname);
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
  return withMetaMutation(async () => {
    const entries = await meta.getAll();

    // AGG-H3 (run-6 cycle-2): upsert as delete-then-set so the Map's insertion
    // order tracks RECENCY. A plain Map.set() on an existing key updates the
    // value but keeps the key's original insertion position, so iteration order
    // would NOT reflect recency after a re-touch — which is why the old code had
    // to Array.from(...).sort() (O(n log n)) on every near-cap write. Moving a
    // re-touched entry to the tail lets eviction be a simple head-walk (oldest
    // first) with no sort.
    entries.delete(url);
    entries.set(url, { url, size: newSize, timestamp: Date.now() });

    // Total is still summed once here (O(n)) because the metadata is rebuilt
    // from the persisted JSON blob each call; that re-parse is inherent to the
    // whole-blob storage model (out of scope to change this cycle). The
    // avoidable cost the review flagged was the per-write O(n log n) sort, which
    // the insertion-order recency above eliminates.
    let total = 0;
    for (const e of entries.values()) {
      total += e.size;
    }

    let evicted = 0;

    if (total > maxBytes) {
      // Head-walk in insertion (= recency) order: oldest entries come first, so
      // we evict from the front until under cap. No sort needed.
      for (const entry of entries.values()) {
        if (total <= maxBytes) break;
        // Never evict the entry we just added if we can avoid it — but if we
        // absolutely must (e.g. single entry > cap) we do so anyway.
        const deleted = await cache.delete(entry.url);
        // R4C6 TEST-R4C6-11: only adjust the running total / evicted count
        // when the entry was actually present in the cache. Browser quota
        // evictions may have removed it independently of our metadata Map —
        // the shipped template gained this guard and the reference module
        // had drifted behind it (and overcounted `evicted`).
        if (deleted) {
          evicted += entry.size;
          total -= entry.size;
        }
        entries.delete(entry.url);
      }
    }

    await meta.setAll(entries);
    return evicted;
  });
}

/**
 * Remove the metadata entry for a URL (e.g. when the cache returns a miss
 * on keys() reconciliation).
 */
export async function removeEntry(
  url: string,
  meta: MetaStore,
): Promise<void> {
  await withMetaMutation(async () => {
    const entries = await meta.getAll();
    entries.delete(url);
    await meta.setAll(entries);
  });
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

// ─── Recency touch + expiry (C2-11, run-10 c2) ─────────────────────────────
//
// The shipped template's staleWhileRevalidateImage HEAD-probe/304 flow (and
// its refreshCachedImageTimestamp/evictExpiredCachedImage/cachedImageAge
// helpers) still lives only in public/sw.template.js — it depends on a live
// fetch() Response and the ambient `caches` API, so it is not mirrored here
// (see AGG-R8c3-11/TEST-3 in sw-template-contract.test.ts). The two pieces
// below ARE pure and runtime-agnostic, so they mirror the template's
// meta-first recency logic for unit coverage: touchMeta updates ONLY the
// LRU meta timestamp for a confirmed-fresh entry (no body rewrite, no
// eviction), and resolveCachedEntryAge/evictIfExpired implement the
// meta-timestamp-first, header-fallback age check used by the template's
// evictExpiredCachedImage.

/**
 * Bump the recency timestamp of an existing LRU meta entry (or create one)
 * without touching the cache store. Mirrors the template's `touchMeta`:
 * used when the server confirms a cached response is still fresh (304 /
 * same-ETag), so only recency changes — never eviction, since no size grows.
 */
export async function touchMeta(
  url: string,
  knownSize: number,
  meta: MetaStore,
): Promise<void> {
  return withMetaMutation(async () => {
    const entries = await meta.getAll();
    const existing = entries.get(url);
    // AGG-H3 (run-6 cycle-2): delete-then-set so the touched entry moves to
    // the Map's tail, keeping insertion order == recency for the head-walk
    // eviction in recordAndEvict.
    entries.delete(url);
    entries.set(url, {
      url,
      size: existing && existing.size ? existing.size : knownSize,
      timestamp: Date.now(),
    });
    await meta.setAll(entries);
  });
}

/**
 * Resolve a cached entry's age for stale-expiry checks. Prefers the LRU
 * meta store's timestamp — kept current by touchMeta / recordAndEvict on
 * every confirmed-fresh revalidation without any body rewrite — and falls
 * back to a response-header-derived timestamp only when no meta record
 * exists. A header-only fallback stops advancing once an entry has been
 * touched without rewriting the response, so treating it as authoritative
 * whenever meta already exists would age out entries the server keeps
 * confirming as fresh.
 */
export function resolveCachedEntryAge(
  metaEntry: CacheEntry | undefined,
  headerTimestamp: number | null,
  now: number = Date.now(),
): number {
  if (metaEntry && Number.isFinite(metaEntry.timestamp)) {
    return now - metaEntry.timestamp;
  }
  if (headerTimestamp !== null && Number.isFinite(headerTimestamp) && headerTimestamp > 0) {
    return now - headerTimestamp;
  }
  return Infinity;
}

/**
 * Evict a cache entry (and its meta record) if its resolved age exceeds
 * `maxAgeMs`. Mirrors the template's `evictExpiredCachedImage`.
 *
 * @returns true if the entry was evicted.
 */
export async function evictIfExpired(
  url: string,
  cache: CacheStore,
  meta: MetaStore,
  maxAgeMs: number,
  headerTimestamp: number | null = null,
  now: number = Date.now(),
): Promise<boolean> {
  const entries = await meta.getAll();
  const age = resolveCachedEntryAge(entries.get(url), headerTimestamp, now);
  if (age > maxAgeMs) {
    await cache.delete(url);
    await removeEntry(url, meta);
    return true;
  }
  return false;
}
