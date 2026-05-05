# Performance Review — Cycle 7

## Summary

The application demonstrates sophisticated performance engineering across image processing, database querying, and caching. A few CPU and memory inefficiencies remain.

---

## C7-PERF-01: OG image generation lacks output-size bounding before base64 encoding — Medium

**File:** `apps/web/src/app/api/og/photo/[id]/route.tsx`
**Lines:** 74-82

**Finding:** The OG route fetches a JPEG derivative, converts to base64, and embeds it in a Satori JSX tree. The `OG_PHOTO_MAX_BYTES = 1 MB` guard checks the Buffer length AFTER the full fetch completes. A maliciously large derivative (if the upload pipeline is compromised) or a slow network could cause the fetch to consume memory before the size check rejects it. More critically, `fetch(photoUrl)` with `AbortSignal.timeout(10000)` does not bound the response body size — an attacker serving a multi-gigabyte response could OOM the Node process.

**Fix:** Add a streaming size check during `arrayBuffer()` consumption, or use a `fetch` wrapper that rejects when `content-length` exceeds `OG_PHOTO_MAX_BYTES`.

**Confidence:** Medium

---

## C7-PERF-02: `searchImagesAction` performs three DB queries sequentially when tags/aliases are present — Medium

**File:** `apps/web/src/lib/data.ts`
**Lines:** ~1050-1170

**Finding:** The search function runs `mainQuery` first, then conditionally runs `tagQuery` and `aliasQuery` if the first returns fewer results than the limit. This sequential execution means tag/alias searches always pay the latency of the main query first. At personal-gallery scale this is acceptable, but with 10k+ images the sequential penalty becomes noticeable.

**Fix:** Run all three queries in parallel with `Promise.all`, then merge and deduplicate results. The downside is potentially wasted DB work when the main query already fills the limit, but for most searches (especially with tag filters) the parallel form is faster.

**Confidence:** Medium

---

## C7-PERF-03: `flushGroupViewCounts` uses `Promise.all` over chunks of 20 — potential pool exhaustion — Low

**File:** `apps/web/src/lib/data.ts`
**Lines:** 82-87

**Finding:** View count flushes chunk updates with `Promise.all(chunk.map(...))`. Each chunk item is a separate `UPDATE` query. With `FLUSH_CHUNK_SIZE = 20` and a connection pool of 10, two concurrent flushes (rare but possible under heavy load) could exhaust the pool queue limit of 20, causing subsequent requests to wait.

**Fix:** The chunk size is already appropriately small relative to the pool. Consider serializing within each chunk (`for...of` with `await`) to be gentler on the pool, or document why 20 concurrent updates is acceptable.

**Confidence:** Low

---

## C7-PERF-04: `image-queue.ts` bootstrap scans entire `images` table — Low

**File:** `apps/web/src/lib/image-queue.ts`
**Lines:** ~140-180 (bootstrap)

**Finding:** The queue bootstrap uses cursor-based pagination (`WHERE id > lastId`) with `BOOTSTRAP_BATCH_SIZE = 500` to find unprocessed images. For a gallery with 100k images this requires 200 round-trips to the DB at startup. The query is simple (`SELECT id FROM images WHERE processed = false AND id > ? ORDER BY id LIMIT 500`) but still adds startup latency.

**Fix:** Add a composite index `(processed, id)` if not already present (the existing `idx_images_processed_created_at` covers `(processed, created_at)` but not `(processed, id)` for cursor-based scanning). Alternatively, accept the startup latency as a tradeoff for bounded memory usage.

**Confidence:** Low

---

## C7-PERF-05: `getImageCached` and `getGalleryConfig` use React `cache()` but not across requests — Low

**File:** `apps/web/src/lib/data.ts`, `apps/web/src/lib/gallery-config.ts`

**Finding:** React `cache()` deduplicates within a single SSR request but does NOT deduplicate across requests. A popular photo viewed by many users triggers identical DB queries for each request. There is no request-external caching layer (Redis, memoized Map with TTL).

**Fix:** This is architecturally intentional (no Redis dependency). Consider adding a simple in-memory LRU for immutable data like `getTopicsWithAliases` and `getGalleryConfig` that changes rarely. Document the intentional absence of cross-request caching for image data (images are mutable).

**Confidence:** Low

---

## Commendations

- `sharp.concurrency()` divided by format fan-out (3) prevents libuv thread starvation.
- `sharp.cache(false)` keeps RSS steady in long-running containers.
- Parallel AVIF/WebP/JPEG generation via `Promise.all` maximizes pipeline throughput.
- The view-count buffer with exponential backoff during DB outages is elegant and prevents hammering.
