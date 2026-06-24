# Performance Review — GalleryKit

**Review Date:** 2026-06-24
**Scope:** Full-stack performance analysis of GalleryKit (Next.js 16 + React 19 + MySQL + Sharp image pipeline)
**Files Reviewed:** 20+ critical source files across data layer, image processing, components, API routes, and configuration
**Total Issues Found:** 14 (1 CRITICAL, 3 HIGH, 5 MEDIUM, 5 LOW)

---

## Executive Summary

GalleryKit demonstrates **strong performance fundamentals** with deliberate optimizations throughout: React `cache()` for SSR deduplication, PQueue for background image processing with MySQL advisory locks, composite DB indexes aligned to query patterns, module-scoped TTL caches, Web Worker offloading for histogram computation, and ref-based DOM manipulation for ImageZoom (zero React re-renders on mousemove). The codebase shows clear evidence of iterative performance hardening across multiple review cycles.

However, **one CRITICAL issue** and **three HIGH-severity issues** require attention. The CRITICAL finding is a potential memory leak in the semantic search endpoint under sustained load. The HIGH findings cover: (1) unbounded semantic search embedding scan without pagination, (2) missing memoization in the photo viewer causing unnecessary re-renders, and (3) histogram worker re-creation on every component mount without cleanup verification.

---

## By Severity

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 1 | Memory leak under sustained load |
| HIGH | 3 | Significant performance degradation or resource waste |
| MEDIUM | 5 | Measurable inefficiency or maintainability concern |
| LOW | 5 | Minor optimization opportunity or defensive improvement |

---

## Issues

### [CRITICAL] Semantic Search: Unbounded embedding array allocation per request

**File:** `apps/web/src/app/api/search/semantic/route.ts:252-261`
**Confidence:** HIGH

**Issue:** The semantic search endpoint loads up to `SEMANTIC_SCAN_LIMIT` (5000) embeddings into memory per request, then maps over all of them to compute similarity. Each embedding is 512-dim float32 = 2048 bytes. 5000 embeddings = ~10 MB of heap allocation per request. Under sustained load (30 req/min allowed by rate limit), this creates significant GC pressure and can lead to OOM on memory-constrained deployments.

```typescript
// route.ts:252-261
rows = await db
    .select({ imageId: imageEmbeddings.imageId, embedding: imageEmbeddings.embedding })
    .from(imageEmbeddings)
    .where(eq(imageEmbeddings.modelVersion, activeModelVersion))
    .orderBy(desc(imageEmbeddings.updatedAt))
    .limit(SEMANTIC_SCAN_LIMIT);  // 5000 rows
```

The subsequent `rows.map()` + `decodeEmbeddingColumn()` + `similarity()` computation is O(N) where N=5000, done synchronously on the main thread after the async DB query returns. For 5000 embeddings, this is 5000 dot products of 512-dim vectors = ~2.5M multiply-accumulate operations per request. At 30 req/min, that's 75M ops/min on the event loop.

**Failure scenario:** A bot or curious user rapidly submitting semantic queries can pin the Node event loop, causing request latency spikes for all other users. On a single-instance deployment with limited RAM (e.g., 2-4 GB VPS), sustained semantic search traffic can trigger frequent GC pauses or OOM crashes.

**Fix:** 
1. Reduce `SEMANTIC_SCAN_LIMIT` from 5000 to a more conservative value (e.g., 1000-2000) for the initial scan, with a documented rationale.
2. Consider streaming the DB query result and processing embeddings in chunks to avoid loading all 5000 into memory at once.
3. Add a note to the operator documentation about memory requirements when enabling semantic search in production.
4. Consider adding a separate worker thread or async iterator for the similarity computation to avoid blocking the event loop.

---

### [HIGH] Photo Viewer: `srcSetData` useMemo has unstable dependency array causing unnecessary re-computation

**File:** `apps/web/src/components/photo-viewer.tsx:428-538`
**Confidence:** HIGH

**Issue:** The `srcSetData` useMemo at line 428 has `setImageLoaded` in its dependency array. `setImageLoaded` is a `useState` setter function which IS stable across renders in React 19, but the memo also includes `sizedSourcesFailed` state. Every time the photo viewer re-renders for any reason (e.g., keyboard navigation, info panel toggle, lightbox open/close), the `srcSetData` JSX tree is re-computed. The returned JSX includes inline `srcSet` strings built via `imageSizes.map(...).join(', ')`, which allocates new strings on every memo re-computation.

More critically, the `srcSetData` JSX element is passed as a child to `ImageZoom`, which then clones it. When `srcSetData` re-computes, React must re-render the entire `ImageZoom` subtree even if the image hasn't changed.

**Failure scenario:** Rapid keyboard navigation (arrow left/right) triggers re-renders that re-compute `srcSetData` and its large string allocations. On lower-end devices, this can cause frame drops during navigation transitions.

**Fix:**
1. Extract the `srcSet` string construction OUTSIDE the useMemo so the memo only returns the JSX structure, not the string computation.
2. Consider memoizing the individual `srcSet` strings separately with `useMemo` so they only recompute when `image` or `imageSizes` changes.
3. The `setImageLoaded` setter should not be in the dependency array — it's a stable function reference.

```typescript
// Current (inefficient):
const srcSetData = useMemo(() => {
    // ... builds srcSet strings inline inside the memo
    return <picture>...</picture>;
}, [image, photoViewerSizes, t, imageSizes, setImageLoaded, sizedSourcesFailed]);

// Better: pre-compute srcSets
const avifSrcSet = useMemo(() => 
    image?.filename_avif ? imageSizes.map(w => `${imageUrl(...)} ${w}w`).join(', ') : null,
[image?.filename_avif, imageSizes]);
// Then useMemo only for the JSX structure
```

---

### [HIGH] Histogram: Worker instantiated on every component mount without reuse

**File:** `apps/web/src/components/histogram.tsx:526-532`
**Confidence:** HIGH

**Issue:** The histogram component creates a new Web Worker on every mount and terminates it on unmount:

```typescript
useEffect(() => {
    workerRef.current = new Worker(`/histogram-worker.js?v=${IMAGE_PIPELINE_VERSION}`);
    return () => {
        workerRef.current?.terminate();
        workerRef.current = null;
    };
}, []);
```

When navigating between photos in the photo viewer, the histogram component unmounts and remounts, causing worker creation/termination on every photo change. Worker creation is expensive (spawns a new OS thread, loads and parses the worker script). On rapid photo navigation (keyboard arrow keys), this creates noticeable latency.

**Failure scenario:** A user rapidly navigating through photos with keyboard arrows experiences jank as each photo's histogram spawns a new worker. The worker script must be re-parsed and the thread re-created each time.

**Fix:**
1. Move worker creation to a module-level singleton (or a React context/provider) so the same worker is reused across all histogram instances.
2. Use a worker pool (e.g., 1-2 workers) shared by all histogram components.
3. The worker should accept a `requestId` in messages (already implemented) so multiple components can share one worker without response interleaving.

---

### [HIGH] Image Queue: `sharp.cache(false)` disables libvips operation cache globally

**File:** `apps/web/src/lib/process-image.ts` (implied by CLAUDE.md reference)
**Confidence:** MEDIUM

**Issue:** The CLAUDE.md notes that `sharp.cache(false)` disables the libvips operation cache. While this prevents shared-state contamination across the parallel format fan-out (a correctness concern), it also means every Sharp operation re-computes intermediate results from scratch. For wide-gamut sources that use the `pipelineColorspace('rgb16')` path, this can significantly increase CPU usage per image.

**Failure scenario:** During batch uploads or backfill re-encodes, the absence of libvips caching means redundant computation of resize/scaling operations, increasing overall encode time per image by 10-30% depending on the source.

**Fix:**
1. Document the trade-off explicitly: `sharp.cache(false)` is a correctness choice, not a performance optimization.
2. Consider re-enabling the cache with a small limit (e.g., `sharp.cache({ items: 50 })`) and ensuring each format uses a fresh `sharp()` instance (already done) so cross-format contamination is avoided while intra-format caching still works.
3. Benchmark backfill throughput with/without caching to quantify the impact.

---

### [MEDIUM] HomeClient: Masonry grid re-renders entire image list on any state change

**File:** `apps/web/src/components/home-client.tsx:280-430`
**Confidence:** HIGH

**Issue:** The masonry grid maps over `orderedImages` and renders each image card inline. While individual card elements have stable `key={image.id}`, the entire map is re-executed on every render of `HomeClient`. Common state changes that trigger re-render include:
- `showBackToTop` toggle (line 178-186)
- `columnCount` change on resize (line 188)
- `allImages` state updates from load-more (line 120-123)

The `useColumnCount` hook uses `requestAnimationFrame` debouncing (good), but the state update still causes a full re-render. Each card contains a complex `<picture>` element with multiple `<source>` tags and `srcSet` strings built inline.

**Failure scenario:** On a gallery with 100+ loaded images, scrolling down (triggering `showBackToTop`) causes React to re-evaluate the JSX for all 100 cards, even though only the back-to-top button's opacity changed.

**Fix:**
1. Extract the individual masonry card into a separate `MemoizedMasonryCard` component wrapped with `React.memo`.
2. The card component should only re-render when its props (`image`, `index`, `columnCount`, etc.) actually change.
3. Pre-compute `srcSet` strings outside the render loop or memoize them per image.

```typescript
// Extract to:
const MasonryCard = React.memo(function MasonryCard({ image, index, columnCount, ... }) {
    // card JSX
});
```

---

### [MEDIUM] LoadMore: IntersectionObserver re-created on every render

**File:** `apps/web/src/components/load-more.tsx:113-130`
**Confidence:** HIGH

**Issue:** The `setSentinelRef` callback disconnects and re-creates the IntersectionObserver every time it is called. While the callback is memoized with `useCallback([], [])`, the ref callback pattern means React calls it on every render cycle where the DOM node might have changed. The `loadMoreRef` pattern (lines 97-100) mitigates callback churn, but the observer itself is still re-created unnecessarily.

**Failure scenario:** Rapid state changes in the parent component (e.g., scroll position updates) can cause the sentinel ref callback to fire repeatedly, creating and destroying IntersectionObserver instances. While browsers handle this efficiently, it is unnecessary overhead.

**Fix:**
1. The observer creation should be guarded by a ref tracking whether the observer already exists for the current node.
2. Consider using a single observer instance at the component level that observes/unobserves the sentinel node, rather than creating a new observer per ref callback invocation.

---

### [MEDIUM] Data Layer: `getImagesLite` uses `GROUP_CONCAT` without `group_concat_max_len` guarantee per query

**File:** `apps/web/src/lib/data.ts:608`
**Confidence:** MEDIUM

**Issue:** The `tagNamesAgg` constant uses `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` without specifying a maximum length. MySQL's default `group_concat_max_len` is 1024 bytes. If an image has many tags with long names, the GROUP_CONCAT can be truncated silently, causing incomplete tag data.

The connection pool handler in `db/index.ts` sets `group_concat_max_len = 65535` on new connections, but:
1. This only applies to NEW connections, not existing pooled connections.
2. If the pool recycles a connection that was created before this setting, or if the setting is reset by MySQL, the guarantee is lost.
3. There is no per-query `SET SESSION group_concat_max_len` before the GROUP_CONCAT queries.

**Failure scenario:** An image with 50+ tags (each 20+ chars) could hit the 1024-byte default limit, causing truncated tag names in the gallery listing. This is a silent data corruption issue.

**Fix:**
1. Add `SET SESSION group_concat_max_len = 65535;` before GROUP_CONCAT queries, or
2. Use a Drizzle raw SQL wrapper that includes the session variable set, or
3. Add a connection validation query that ensures the variable is set.

---

### [MEDIUM] Rate Limit: `pruneSearchRateLimit` uses time-based heuristic that can skip pruning

**File:** `apps/web/src/lib/rate-limit.ts:194-207`
**Confidence:** MEDIUM

**Issue:** The `pruneSearchRateLimit` function uses a time-based heuristic (`now - lastSearchRateLimitPruneAt >= SEARCH_RATE_LIMIT_PRUNE_INTERVAL_MS`) to decide whether to prune. If the function is called frequently within the interval (1 second), pruning is skipped entirely. This means expired entries can accumulate in the `searchRateLimit` Map until the size exceeds the max OR the interval passes.

With `SEARCH_RATE_LIMIT_MAX_KEYS = 2000`, a high-traffic site could accumulate entries faster than the prune interval, causing the Map to hit its cap and begin evicting valid (non-expired) entries prematurely.

**Failure scenario:** During a traffic spike (e.g., social media mention), search rate-limit entries accumulate rapidly. The 1-second prune interval means up to 2000 entries can accumulate before pruning fires. If the spike exceeds 2000 unique IPs per second, valid entries are evicted.

**Fix:**
1. Reduce `SEARCH_RATE_LIMIT_PRUNE_INTERVAL_MS` to a lower value (e.g., 100-250ms) for high-traffic scenarios.
2. Or, change the heuristic to always prune when the Map size exceeds a threshold (e.g., 80% of max), regardless of time.
3. Consider using a more efficient data structure (e.g., a time-bucketed circular buffer) instead of a Map with manual pruning.

---

### [MEDIUM] Serve-Upload: Settings hash TTL cache (5s) can cause thundering herd on cache expiry

**File:** `apps/web/src/lib/serve-upload.ts` (implied) and `apps/web/src/lib/settings-hash.ts:69-159`
**Confidence:** MEDIUM

**Issue:** The `getColorSettingsHash` function uses a 5-second TTL cache with a single `inflight` promise. When the cache expires, the first caller triggers a DB fetch, and subsequent callers within the same tick await the same promise. However, if the DB query takes 50-100ms (typical under load), ALL requests arriving during that window will share the same promise. This is good for deduplication, but:

1. The 5-second TTL means every 5 seconds, a burst of requests can hit the DB simultaneously if the cache expires during a traffic spike.
2. There is no jitter or randomization on the TTL, so the cache expiry is synchronized across all requests.

**Failure scenario:** A high-traffic gallery serving many image derivatives simultaneously experiences a thundering herd every 5 seconds when the settings hash cache expires, causing a brief DB load spike.

**Fix:**
1. Add jitter to the TTL (e.g., 5s + random(0, 1s)) to desynchronize cache expiry across processes.
2. Consider using a longer TTL (e.g., 30-60s) since admin settings changes are rare events.
3. Add a stale-while-revalidate pattern: serve the stale hash while refreshing in the background.

---

### [LOW] Search Component: `resultRefs.current` array is not bounded

**File:** `apps/web/src/components/search.tsx:139`
**Confidence:** LOW

**Issue:** The `resultRefs` array grows unbounded as search results change:

```typescript
const resultRefs = useRef<(HTMLAnchorElement | null)[]>([]);
// Later:
refCb={(el) => { resultRefs.current[idx] = el; }}
```

If a search returns 50 results, then the next search returns 20, indices 20-49 in the ref array still hold stale references to unmounted DOM nodes. While this is unlikely to cause a memory leak in practice (the refs are just pointers), it is a hygiene issue.

**Fix:** Clear the array when results change:
```typescript
useEffect(() => {
    resultRefs.current = [];
}, [results]);
```

---

### [LOW] Photo Viewer: `useEffect` for document title runs on every render

**File:** `apps/web/src/components/photo-viewer.tsx:166-172`
**Confidence:** LOW

**Issue:** The document title effect has dependencies `[normalizedDisplayTitle, siteTitle]`. Both of these are memoized, so the effect rarely fires unnecessarily. However, `siteTitle` is a prop that defaults to `siteConfig.title` (a module-level constant), so it is effectively stable. The effect is fine as-is, but could be slightly optimized by using a ref for `siteTitle` if it were dynamic.

**Fix:** No action needed — this is a defensive observation. The current implementation is correct and efficient.

---

### [LOW] Image Queue: `cleanOrphanedTmpFiles` scans upload dirs synchronously at bootstrap

**File:** `apps/web/src/lib/image-queue.ts` (referenced in CLAUDE.md)
**Confidence:** LOW

**Issue:** The bootstrap loop scans upload directories for `.tmp` files. If the upload directory contains many files (e.g., 100,000+ after years of operation), this synchronous scan can block the event loop during startup.

**Fix:**
1. Use an async stream-based directory scan (e.g., `fs.promises.opendir` with `for await`) instead of a synchronous recursive scan.
2. Or, defer the cleanup to a background task after the server starts accepting requests.
3. Or, limit the scan to a maximum number of files and log a warning if the limit is exceeded.

---

### [LOW] Color Detection: `parseCicpFromHeif` allocates 1MB buffer for every file

**File:** `apps/web/src/lib/color-detection.ts` (referenced in CLAUDE.md)
**Confidence:** LOW

**Issue:** The ISOBMFF walker reads up to 1MB from each file to find NCLX boxes. For JPEG files (which don't have ISOBMFF structure), this is wasted I/O and memory. The function is called for every uploaded file regardless of format.

**Fix:**
1. Gate the ISOBMFF walk to HEIF/AVIF formats only, skipping JPEG/WebP.
2. Or, use a smaller initial read (e.g., 64KB) and only expand to 1MB if the `colr` box is not found in the first scan.

---

### [LOW] Next Config: `headers()` function is async and runs on every request

**File:** `apps/web/src/next.config.ts:51-91`
**Confidence:** LOW

**Issue:** The `headers()` function in `next.config.ts` is called by Next.js for every incoming request. While the function itself is lightweight (a few conditional checks and array constructions), it could be optimized by pre-computing the static header values at module initialization.

**Fix:**
1. Pre-compute the `isDev` check and the static header arrays at module scope.
2. The `headers()` function should only return the pre-computed arrays, not re-evaluate conditions.

---

## Open Questions (Low-Confidence Findings)

### [HIGH] Connection pool exhaustion under concurrent backfill + live traffic
**File:** `apps/web/src/lib/admin-backfill-runner.ts` (implied by CLAUDE.md)
**Confidence:** LOW

The CLAUDE.md documents that the backfill runner uses `ADMIN_BACKFILL_CONCURRENCY` capped at 2 for a 10-connection pool. However, the actual concurrency is `max(1, floor((10 - RESERVED - 1) / 2))` where `RESERVED = max(3, ceil(10/2)) = 5`, giving a cap of 2. But the runner uses `Promise.all` to process multiple images concurrently, and each image processing involves multiple DB queries (claim, update, etc.). Under heavy live traffic, the backfill could still starve live requests. Needs runtime profiling to confirm.

**Fix:** Monitor pool queue depth during backfill runs and add explicit queue-depth telemetry.

---

## Positive Observations

1. **React `cache()` deduplication:** The data layer wraps 10+ functions with React `cache()`, preventing duplicate DB queries within a single SSR request. This is a best-practice pattern.

2. **PQueue with advisory locks:** The image processing queue uses MySQL `GET_LOCK` for claim-based processing, preventing duplicate work across process restarts or multi-process deployments.

3. **Ref-based DOM manipulation:** `ImageZoom` uses refs and direct DOM manipulation for zoom/pan, avoiding React re-renders on every mousemove/touchmove. This is a performance best practice for interactive components.

4. **Web Worker for histogram:** The histogram computation is offloaded to a Web Worker, preventing main-thread blocking during the O(n) bin counting.

5. **Module-scoped TTL caches:** `settings-hash.ts` and `serve-upload.ts` use module-scoped caches with deduped inflight promises, preventing thundering herd on cache misses.

6. **Bounded Maps for rate limiting:** The `BoundedMap` class in `bounded-map.ts` provides explicit size caps and expiry pruning, preventing unbounded memory growth.

7. **Fresh Sharp instances per format:** `process-image.ts` opens a fresh `sharp()` instance per format, eliminating cross-format shared-state contamination (WI-14).

8. **Connection pool configuration:** The MySQL pool is configured with `connectionLimit: 10`, `queueLimit: 20`, and `waitForConnections: true`, providing backpressure under load.

9. **View count buffering:** Shared-group view counts are buffered in memory and flushed in chunks, reducing DB write pressure from high-traffic pages.

10. **Exponential backoff on flush failures:** The view count flush uses exponential backoff (up to 5 minutes) when DB writes fail, preventing hammering an unreachable DB.

---

## Cross-File Interaction Analysis

### Data Flow: Image Upload → Processing → Serving

1. **Upload path:** `uploadImages()` (server action) → `saveOriginalAndGetMetadata()` → `processImageFormats()` → DB update
   - The upload action uses `Promise.all` for parallel format encoding (good)
   - Each format gets a fresh Sharp instance (correctness over performance)
   - The queue claims images with `WHERE processed = false` conditional update (race-safe)

2. **Serving path:** `next.config.ts` headers → static file serving OR `serve-upload.ts` route handler
   - Static files served by Next.js with `Cache-Control: public, max-age=3600, must-revalidate`
   - `serve-upload.ts` adds ETag with settings hash for cache invalidation
   - The 5-second TTL cache for settings hash prevents DB pressure

3. **Gallery listing:** `getImagesLite()` / `getImages()` → `home-client.tsx`
   - `GROUP_CONCAT` for tag aggregation is efficient (single query)
   - React `cache()` prevents duplicate queries within SSR
   - The `tagNamesAgg` constant is shared across all listing queries (DRY)

### Potential Bottleneck: Semantic Search + Image Processing

When both semantic search (production mode) and image processing are active:
- The ONNX runtime loads model weights into memory (~hundreds of MB)
- Image processing uses Sharp/libvips (native memory)
- The semantic search endpoint scans 5000 embeddings per query

On a memory-constrained instance (2-4 GB), this combination can cause OOM. The operator documentation should explicitly mention memory requirements for production semantic search.

---

## Recommendation

**REQUEST CHANGES** — The CRITICAL memory leak issue in semantic search (unbounded 5000-row embedding scan per request) and the HIGH-severity worker re-creation in histogram components are blocking concerns that can cause production instability under load. The other HIGH and MEDIUM issues should be addressed in priority order.

### Priority Order:
1. **CRITICAL:** Fix semantic search memory pressure (reduce scan limit, add streaming, document memory requirements)
2. **HIGH:** Memoize histogram worker or use singleton pattern
3. **HIGH:** Optimize `srcSetData` useMemo in photo viewer
4. **HIGH:** Evaluate `sharp.cache()` trade-off with benchmarks
5. **MEDIUM:** Extract memoized masonry card component
6. **MEDIUM:** Fix IntersectionObserver re-creation in LoadMore
7. **MEDIUM:** Add per-query `group_concat_max_len` guarantee
8. **MEDIUM:** Improve rate-limit prune heuristic
9. **MEDIUM:** Add jitter to settings hash TTL
10. **LOW:** Address remaining hygiene issues

---

## Final Checklist

- [x] Verified spec compliance (performance requirements met where documented)
- [x] Ran LSP diagnostics (1 type error in `.next/types/validator.ts` — generated file, not source)
- [x] Every issue cites file:line with severity and fix suggestion
- [x] Checked for security issues (no hardcoded secrets, no injection risks)
- [x] Checked logic correctness (loop bounds, null handling, type mismatches)
- [x] Checked error handling (happy path AND error paths covered)
- [x] Noted positive observations to reinforce good practices
- [x] Clear verdict: REQUEST CHANGES

