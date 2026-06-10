/**
 * GalleryKit Service Worker
 *
 * Strategies:
 *  - Image derivatives (/uploads/avif|webp|jpeg/): stale-while-revalidate,
 *    50 MB LRU cap, admin-route bypass.
 *  - HTML routes: network-first, 24 h OFFLINE-ONLY fallback cache.
 *    R4C6 COR-R4C6-05: every public page ships the framework-default
 *    `no-store` (revalidate = 0 dynamic rendering), so honoring
 *    Cache-Control here left this cache permanently empty — the PWA
 *    offline story never functioned. Caching 200 GET HTML is therefore
 *    an EXPLICIT, narrow exemption: entries are served exclusively when
 *    the network is unreachable, expire after 24 h, and pages rendered
 *    WITH an admin session are excluded via the `x-gk-admin-render`
 *    response header set by proxy.ts (the SW cannot read the request
 *    Cookie header — it is a Fetch-spec forbidden header, which is why
 *    the old cookie sniff never worked).
 *  - /admin/* and /api/admin/*: always bypass to network.
 *  - 401/403 and non-OK responses: never cached.
 *
 * 3adbd2d4-p7 is replaced at build time by scripts/build-sw.ts.
 *
 * US-P24 PWA story.
 */

const SW_VERSION = '3adbd2d4-p7';
const IMAGE_CACHE = 'gk-images-' + SW_VERSION;
const HTML_CACHE = 'gk-html-' + SW_VERSION;
const META_CACHE = 'gk-meta-' + SW_VERSION;

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB
const HTML_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h
const MAX_HTML_ENTRIES = 50; // cap HTML cache to avoid unbounded growth

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAdminRoute(pathname) {
  return (
    /^\/[a-z]{2}(-[A-Z]{2})?\/admin(\/|$)/.test(pathname) ||
    /^\/api\/admin(\/|$)/.test(pathname)
  );
}

function isImageDerivative(pathname) {
  return (
    pathname.startsWith('/uploads/avif/') ||
    pathname.startsWith('/uploads/webp/') ||
    pathname.startsWith('/uploads/jpeg/')
  );
}

function isHtmlRoute(request) {
  return request.headers.get('Accept')?.includes('text/html') ?? false;
}

function isSensitiveResponse(response) {
  if (!response) return true;
  if (response.status === 401 || response.status === 403) return true;
  const cc = response.headers.get('Cache-Control') ?? '';
  return cc.includes('no-store');
}

// ─── Metadata store (LRU tracking) ──────────────────────────────────────────

async function getMeta() {
  const cache = await caches.open(META_CACHE);
  const resp = await cache.match('/__meta__');
  if (!resp) return new Map();
  try {
    const data = await resp.json();
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

async function setMeta(entries) {
  const cache = await caches.open(META_CACHE);
  const obj = Object.fromEntries(entries);
  await cache.put(
    '/__meta__',
    new Response(JSON.stringify(obj), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

// ─── LRU eviction ────────────────────────────────────────────────────────────

async function recordAndEvict(url, newSize) {
  const imageCache = await caches.open(IMAGE_CACHE);
  const entries = await getMeta();

  entries.set(url, { url, size: newSize, timestamp: Date.now() });

  let total = 0;
  for (const e of entries.values()) total += e.size;

  if (total > MAX_IMAGE_BYTES) {
    const sorted = Array.from(entries.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    for (const entry of sorted) {
      if (total <= MAX_IMAGE_BYTES) break;
      const deleted = await imageCache.delete(entry.url);
      // Only adjust the running total if the entry was actually present
      // in the cache. Browser quota evictions may have removed it
      // independently of our metadata Map.
      if (deleted) {
        total -= entry.size;
      }
      entries.delete(entry.url);
    }
  }

  await setMeta(entries);
}

async function evictHtmlCacheIfNeeded() {
  const htmlCache = await caches.open(HTML_CACHE);
  const keys = await htmlCache.keys();
  if (keys.length <= MAX_HTML_ENTRIES) return;

  const entries = [];
  for (const key of keys) {
    const resp = await htmlCache.match(key);
    const ts = Number(resp?.headers?.get('sw-cached-at')) || 0;
    entries.push({ key, ts });
  }

  entries.sort((a, b) => a.ts - b.ts);
  const toDelete = entries.slice(0, entries.length - MAX_HTML_ENTRIES);
  for (const { key } of toDelete) {
    await htmlCache.delete(key);
  }
}

// ─── Fetch strategies ────────────────────────────────────────────────────────

/**
 * R4C9 PERF-R4C9-02: bump only the recency timestamp of a cached image's
 * LRU entry — no body fetch, no cache.put. Used on the 304 path where the
 * server confirmed the cached bytes are authoritative. Keeps a known size
 * if one is already tracked (Content-Length may be absent on some cached
 * responses); never triggers eviction because no size grows.
 */
async function touchMeta(url, knownSize) {
  const entries = await getMeta();
  const existing = entries.get(url);
  entries.set(url, {
    url,
    size: existing && existing.size ? existing.size : knownSize,
    timestamp: Date.now(),
  });
  await setMeta(entries);
}

async function staleWhileRevalidateImage(request) {
  const imageCache = await caches.open(IMAGE_CACHE);
  // C18-MED-01: use request.url (string) as the cache key so it matches
  // the string key used in recordAndEvict's imageCache.delete(entry.url).
  // The Cache API accepts strings for match/put/delete; using the same
  // key type throughout prevents silent eviction failures.
  const cacheKey = request.url;
  const cached = await imageCache.match(cacheKey);

  // R4C9 PERF-R4C9-02: the revalidating GET is LAZY — a single-flight
  // closure dispatched only when actually needed. The previous shape
  // created the fetch Promise eagerly at function entry, so the documented
  // R11-M1 "304 short-circuits the revalidate body fetch" never happened:
  // every cached view still issued the full GET, re-put identical bytes,
  // and rewrote the whole LRU meta document (N concurrent read-modify-write
  // cycles per gallery paint).
  let revalidatePromise = null;
  const startRevalidate = () => {
    if (!revalidatePromise) {
      revalidatePromise = fetch(request.clone())
        .then(async (networkResponse) => {
          if (isSensitiveResponse(networkResponse)) return networkResponse;
          if (!networkResponse.ok) return networkResponse;
          const clone = networkResponse.clone();
          const blob = await clone.blob();
          const size = blob.size;
          await imageCache.put(cacheKey, networkResponse.clone());
          await recordAndEvict(request.url, size);
          return networkResponse;
        })
        .catch(() => null);
    }
    return revalidatePromise;
  };

  if (cached) {
    // R10-H3: when admin flips a color-impacting setting the server-side ETag
    // changes immediately. Without this check the SW would serve old cached
    // bytes for one full visit cycle and only update on the next, leaving
    // the photographer's audience seeing visibly stale colors for one extra
    // load. Do a cheap HEAD revalidation against the cached ETag; if the
    // server's ETag differs, serve the network response synchronously
    // instead of returning the stale cache entry.
    //
    // R11-M1 / R4C9: send If-None-Match so the server can answer 304 when
    // the cached entry is still authoritative. A 304 now genuinely skips
    // the body fetch (no GET is in flight yet); only the LRU recency
    // timestamp is touched. A 200 with a differing ETag means the cache is
    // stale, so we dispatch the revalidate and serve the network response.
    const cachedEtag = cached.headers.get('ETag');
    if (cachedEtag) {
      try {
        const head = await fetch(request.url, {
          method: 'HEAD',
          headers: { 'If-None-Match': cachedEtag },
        });
        if (head.status === 304) {
          // Server confirms cache is fresh — serve cached, no body fetch.
          const cachedSize = Number(cached.headers.get('Content-Length')) || 0;
          touchMeta(request.url, cachedSize).catch(() => {});
          return cached;
        }
        if (head.ok) {
          const networkEtag = head.headers.get('ETag');
          if (networkEtag && networkEtag !== cachedEtag) {
            const fresh = await startRevalidate();
            if (fresh) return fresh;
          }
        }
      } catch {
        // HEAD probe failed — fall through to stale-serve below
      }
    }
    // Serve stale immediately, revalidate in background (true SWR path:
    // no ETag to probe, probe network-failed, or probe answered 200 with
    // the same ETag — the latter still refreshes the entry in background
    // exactly as before).
    startRevalidate();
    return cached;
  }

  // No cache — wait for network
  const response = await startRevalidate();
  return response ?? new Response('Network error', { status: 503 });
}

async function networkFirstHtml(request) {
  try {
    const networkResponse = await fetch(request.clone());
    // R4C6 COR-R4C6-05: deliberate Cache-Control exemption — see the
    // header comment. `.ok` excludes 401/403/redirect-error responses;
    // `x-gk-admin-render` excludes pages rendered with an admin session
    // (server-decided; the request Cookie header is unreadable in SW).
    // The image path keeps full isSensitiveResponse semantics.
    if (networkResponse.ok && networkResponse.headers.get('x-gk-admin-render') !== '1') {
      const htmlCache = await caches.open(HTML_CACHE);
      // Stamp the cached response with a timestamp so the 24 h max-age
      // check on cache fallback (line ~148) is actually reachable.
      const headers = new Headers(networkResponse.headers);
      headers.set('sw-cached-at', String(Date.now()));
      const responseToCache = new Response(networkResponse.clone().body, {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers,
      });
      await htmlCache.put(request, responseToCache);
      await evictHtmlCacheIfNeeded();
    }
    return networkResponse;
  } catch {
    // Network failed — try cache fallback
    const htmlCache = await caches.open(HTML_CACHE);
    const cached = await htmlCache.match(request);
    if (cached) {
      // Honour 24 h max-age
      const dateHeader = cached.headers.get('sw-cached-at');
      if (dateHeader) {
        const age = Date.now() - Number(dateHeader);
        if (!Number.isNaN(age) && age > HTML_MAX_AGE_MS) {
          await htmlCache.delete(request);
          return new Response('Offline', { status: 503 });
        }
      }
      return cached;
    }
    return new Response('Offline', { status: 503 });
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates immediately
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge all caches not belonging to this SW version
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              (k.startsWith('gk-images-') ||
                k.startsWith('gk-html-') ||
                k.startsWith('gk-meta-')) &&
              k !== IMAGE_CACHE &&
              k !== HTML_CACHE &&
              k !== META_CACHE,
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return;
  }

  // Admin routes — always bypass to network
  if (isAdminRoute(pathname)) return;

  // Image derivatives — stale-while-revalidate
  if (isImageDerivative(pathname)) {
    event.respondWith(staleWhileRevalidateImage(request));
    return;
  }

  // HTML routes — network-first with 24 h fallback
  if (isHtmlRoute(request)) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  // Everything else — pass through to network
});
