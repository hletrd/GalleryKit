/**
 * GalleryKit Service Worker
 *
 * Strategies:
 *  - Image derivatives (/uploads/avif|webp|jpeg/): stale-while-revalidate,
 *    50 MB LRU cap, admin-route bypass.
 *  - HTML routes: network-first, 24 h fallback cache.
 *  - /admin/* and /api/admin/*: always bypass to network.
 *  - 401/403 responses: never cached.
 *
 * 1a97faf is replaced at build time by scripts/build-sw.ts.
 *
 * US-P24 PWA story.
 */

const SW_VERSION = '1a97faf';
const IMAGE_CACHE = 'gk-images-' + SW_VERSION;
const HTML_CACHE = 'gk-html-' + SW_VERSION;
const META_CACHE = 'gk-meta-' + SW_VERSION;

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB
const HTML_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

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

// ─── Fetch strategies ────────────────────────────────────────────────────────

async function staleWhileRevalidateImage(request) {
  const imageCache = await caches.open(IMAGE_CACHE);
  const cached = await imageCache.match(request);

  const revalidate = fetch(request.clone())
    .then(async (networkResponse) => {
      if (isSensitiveResponse(networkResponse)) return networkResponse;
      if (!networkResponse.ok) return networkResponse;
      const clone = networkResponse.clone();
      const blob = await clone.blob();
      const size = blob.size;
      await imageCache.put(request, networkResponse.clone());
      await recordAndEvict(request.url, size);
      return networkResponse;
    })
    .catch(() => null);

  if (cached) {
    // Serve stale immediately, revalidate in background
    revalidate.catch(() => {});
    return cached;
  }

  // No cache — wait for network
  const response = await revalidate;
  return response ?? new Response('Network error', { status: 503 });
}

async function networkFirstHtml(request) {
  try {
    const networkResponse = await fetch(request.clone());
    if (isSensitiveResponse(networkResponse)) return networkResponse;
    if (networkResponse.ok) {
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
        if (age > HTML_MAX_AGE_MS) {
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
