# Performance Review — Cycle 16

**Reviewer:** PERF-REVIEWER subagent  
**Date:** 2026-06-27  
**Scope:** DB query patterns, N+1, missing indexes, Sharp pipeline, concurrency/pool budget, UI re-renders, bundle/LCP/CLS/INP, caching/ETag correctness  
**Prior cycle carried-over items:** PERF-15-01 through PERF-15-06

---

## Summary Table

| ID | Severity | Status | Location | Description |
|----|----------|--------|----------|-------------|
| PERF-15-02 | — | **FIXED** | `histogram.tsx:440-466` | rAF debounce with breakpoint-only state update |
| PERF-15-04 | — | **FIXED** | `schema.ts:229` | `(imageId, viewed_at)` index present on `image_views` |
| PERF-15-01 | MEDIUM | OPEN | `schema.ts`, `data.ts:527,840` | Missing `(processed, updated_at)` index — full scan on feed and sitemap |
| PERF-16-01 | LOW-MEDIUM | NEW | `image-queue.ts:501` | Embedding IIFE calls `getGalleryConfig()` per job; React `cache()` has no effect in queue context |
| PERF-15-03 | LOW | OPEN | `data.ts:1241-1285` | `getSharedGroup()` — 3 sequential DB round-trips |
| PERF-15-05 | LOW | OPEN | `data.ts` | `leftJoin` on `imageTags`/`tags` in tag-filtered paths could be `innerJoin` |
| PERF-15-06 | LOW | OPEN (partial) | `image-queue.ts:383` | Bootstrap `getGalleryConfig()` gated to legacy jobs only |
| PERF-16-02 | INFO | NEW | `dashboard/page.tsx:18` | `getTags()` uncached in admin dashboard — single admin route, negligible |
| PERF-16-03 | INFO | NEW | `data.ts:511-516` | `getTopics()` correlated `MAX(updated_at)` subquery — row probe per topic partition, acknowledged in code |
| PERF-16-04 | INFO | NEW | `[topic]/page.tsx:141-176` | Topic page: 3 sequential DB waves — irreducible given routing constraints |

---

## Verified Fixed Items

### PERF-15-02 — Histogram rAF Debounce (FIXED)

`apps/web/src/components/histogram.tsx:440-466`

The `rafId` ref guard and breakpoint-only `setCanvasDims` with object-equality check `(prev.width === next.width && prev.height === next.height ? prev : next)` are correctly implemented. No `requestAnimationFrame` is enqueued if one is already pending, and the state setter returns the previous stable reference when dimensions are unchanged — preventing `useState` churn on resize. Fully resolved.

### PERF-15-04 — `image_views` imageId Index (FIXED)

`apps/web/src/db/schema.ts:229`

`idxImageViewsImageIdViewedAt: index('idx_image_views_image_id_viewed_at').on(table.imageId, table.viewed_at)` is present in schema and migration. Per-photo analytics queries filtering on `(imageId, viewed_at)` use this index. Fully resolved.

---

## Open Items — Carry-Over

### PERF-15-01 — Missing `(processed, updated_at)` Index (MEDIUM, OPEN)

**Locations:**
- `apps/web/src/lib/data.ts:527` — `getLatestImageUpdatedAt()`: `MAX(updated_at) WHERE processed=true` — full table scan on every sitemap request
- `apps/web/src/lib/data.ts:840` — `getImagesForFeed()`: `ORDER BY updated_at DESC, created_at DESC, id DESC WHERE processed=true` — filesort before LIMIT
- `apps/web/src/lib/data.ts:511-516` — `getTopics()`: correlated `MAX(updated_at)` subquery per topic — row probe on every image in the `idx_images_topic` partition since `updated_at` is not in that index

All three queries filter `processed=true` and aggregate/sort on `updated_at`. No composite index covers `(processed, updated_at)`.

**Fix:** Migration:
```sql
ALTER TABLE images ADD INDEX idx_images_processed_updated_at (processed, updated_at);
```

For the correlated subquery in `getTopics()`, a second extension `(topic, processed, updated_at)` would additionally cover the per-topic `MAX(updated_at)` subquery. The simple `(processed, updated_at)` index is the minimum needed for `getLatestImageUpdatedAt` and `getImagesForFeed`.

At personal-gallery scale the impact is bounded but the feed/sitemap routes are public and uncached on some code paths. The index is cheap to add.

---

### PERF-15-03 — `getSharedGroup()` 3 Sequential Round-Trips (LOW, OPEN)

**Location:** `apps/web/src/lib/data.ts:1241-1285`

Three sequential awaits:
1. Group lookup by key → `group.id` (required for step 2)
2. `sharedGroupImages` JOIN `images` → `imageId[]` (required for step 3)
3. Tags batch query via `inArray(imageTags.imageId, ids)`

Steps 1→2→3 are the minimum achievable depth given that `group.id` (step 1 output) and `imageId[]` (step 2 output) are both needed before the subsequent step. No parallelization is possible without a structural JOIN that combines all three in one query. At personal-gallery scale (small group sizes) the three-hop cost is ~3 × MySQL round-trip latency (~3-9 ms on localhost). Acceptable but worth a denormalized JOIN if group loading ever becomes a hot path.

---

### PERF-15-05 — `leftJoin` → `innerJoin` Opportunity (LOW, OPEN)

When listing queries (`getImagesLite`, `getImagesLitePage`) are called with a tag filter, the `WHERE` condition on `imageTags.tagId` makes the LEFT JOIN behave as an INNER JOIN semantically. Explicit `innerJoin` is clearer and allows the optimizer to choose a hash join or nested loop without null-check overhead. Low real-world impact at personal-gallery scale.

---

### PERF-15-06 — Bootstrap `getGalleryConfig()` Per Legacy Job (LOW, OPEN — partially addressed)

**Location:** `apps/web/src/lib/image-queue.ts:383`

The call at line 383 is inside `if (!quality && !imageSizes)` — only fires for legacy/re-enqueued jobs that pre-date the upload-time config snapshot. Fresh uploads carry their config inline and skip this. The legacy path is rare in production after all queued jobs clear. No change needed until PERF-16-01 (below) is addressed, at which point both calls can share the same hoisted config read.

---

## New Findings — Cycle 16

### PERF-16-01 — Embedding IIFE `getGalleryConfig()` Per Processed Job (LOW-MEDIUM, NEW)

**Location:** `apps/web/src/lib/image-queue.ts:501`

The per-job callback contains a fire-and-forget embedding IIFE that independently calls `getGalleryConfig()` to decide whether semantic search is enabled:

```typescript
void (async () => {
    const cfg = await getGalleryConfig();  // line 501 — independent call
    if (cfg.semantic_search_mode !== 'disabled') {
        // generate and store embedding
    }
})();
```

`getGalleryConfig` is defined as `cache(_getGalleryConfig)` in `gallery-config.ts`. React's `cache()` is **request-scoped**: it deduplicates calls within a single React render pass / SSR request cycle and is a no-op outside that context. The image queue worker runs as a background Node.js async task with no associated HTTP request — there is no React request-scope store — so `cache()` provides zero deduplication here. Every invocation of the embedding IIFE issues an independent `SELECT key, value FROM admin_settings` query.

**Impact quantified:**
- On the production deployment (semantic search enabled, `QUEUE_CONCURRENCY=1`), every uploaded image triggers this path — one extra `admin_settings` SELECT per job.
- At queue concurrency = 1, these are sequential, so the cost is a single extra ~1-2 ms round-trip per job. At personal-gallery scale (infrequent uploads) the aggregate cost is negligible.
- The architectural pattern is wrong regardless: the bootstrap call at line 383 and the embedding IIFE at line 501 could share one config read per job invocation.

**Confidence:** High — React `cache()` scope is documented in the React 19 API reference; the queue worker's execution context is confirmed to be outside any Next.js request.

**Fix (LOW priority):**
```typescript
// Before the embedding IIFE, hoist the config read:
const cfg = quality && imageSizes
    ? { /* already have inline config */ }
    : await getGalleryConfig();
const semanticMode = cfg?.semantic_search_mode ?? 'disabled';

void (async () => {
    if (semanticMode !== 'disabled') {
        // generate embedding
    }
})();
```
Alternatively, add a module-level TTL cache (like the `settingsHashCache` in `serve-upload.ts`) that persists across job invocations and refreshes every N seconds.

---

### PERF-16-02 — Admin Dashboard Uses Uncached `getTags()` (INFO, NEW)

**Location:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:18`

```typescript
getTags(),  // uncached — bypasses React cache() deduplication
```

`data.ts` exports both `getTags()` (plain async, no React cache) and `getTagsCached = cache(_getTags)`. The admin dashboard calls the uncached form. Since the admin dashboard is an authenticated, single-user route rendered once per navigation (not concurrently), there is no deduplication opportunity being missed in practice. All public routes confirmed to use `getTagsCached()`.

**Action:** None required. Informational. Could be trivially changed to `getTagsCached()` for consistency, but the runtime impact is zero at admin-single-session scale.

---

### PERF-16-03 — `getTopics()` Correlated `MAX(updated_at)` Subquery (INFO, NEW)

**Location:** `apps/web/src/lib/data.ts:511-516`

```typescript
last_image_updated_at: sql<Date | null>`(
    SELECT MAX(${images.updated_at})
    FROM ${images}
    WHERE ${images.topic} = ${topics.slug}
    AND ${images.processed} = true
)`,
```

The existing `idx_images_topic(topic, processed, capture_date, created_at)` locates the matching image rows per topic, but since `updated_at` is not in the index, every matched row in the partition must be heap-fetched to extract `updated_at` for the MAX aggregation. The code comment at line 502 explicitly acknowledges this: "MAX(updated_at) requires a row probe per topic-slug partition."

The query is called only from the sitemap route (`/sitemap.xml`) which has `revalidate = 3600` ISR, so the per-row probe cost is amortized over an hour. At personal-gallery scale (dozens of topics, hundreds of images per topic) the overhead is bounded and acceptable. A follow-on composite index `(topic, processed, updated_at)` would convert row probes to index range scans but is not needed at current scale.

**Action:** Defer to when PERF-15-01 is addressed; note the `(topic, processed, updated_at)` extension as an optional follow-on.

---

### PERF-16-04 — Topic Page: 3 Sequential DB Waves (INFO, NEW)

**Location:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:141-176`

The topic page body function issues data fetches in 3 sequential waves:

1. **Wave 1** (line 141-145): `getLocale()` + `getTopicBySlugCached(topic)` — must resolve before wave 2 because the alias redirect check (`topicData.slug !== topic`) requires the resolved topic.
2. **Wave 2** (line 166-170): `getSeoSettings()` + `getGalleryConfig()` + `getTagsCached(topicData.slug)` + `getTopicsCached()` — parallel batch, but blocked on wave 1.
3. **Wave 3** (line 176): `getImagesLitePage(topicData.slug, filterTags, PAGE_SIZE, 0)` — blocked on wave 2 (needs `topicData.slug` for topic filter and `allTags` for tag slug validation).

This is the minimum achievable depth: the alias redirect must be resolved (wave 1) before the canonical slug is known, and the canonical slug is needed for both the tag filter (wave 2 `getTagsCached`) and the image listing (wave 3). The routing contract cannot be collapsed without prefetching the topic slug in a Next.js layout, which would change the routing architecture.

**Action:** None. Pattern is correct. Documented here for completeness.

---

## Sharp Pipeline Assessment (No New Issues)

`process-image.ts` reviewed for concurrency, memory, and correctness:

- **Fresh-decode per format (WI-14):** Each `generateForFormat` call constructs a new `sharp(processingInputPath, …)` instance. No shared-state cross-format contamination. Confirmed at lines 1162-1165.
- **rgb16 pipeline for wide-gamut:** `pipelineColorspace('rgb16')` applied only when `isWideGamutSource && !isDciP3`. DCI-P3 correctly skips rgb16. Correct.
- **OOM guard:** Wide-gamut sources above `WIDE_GAMUT_MAX_SOURCE_PIXELS` (default 50 M px) are downscaled to a lossless TIFF intermediate before rgb16 fan-out (lines 1053-1083). The intermediate is UUID-suffixed under `os.tmpdir()` and cleaned up on error.
- **10-bit AVIF probe:** `canUseHighBitdepthAvif()` is a process-level Promise singleton — called once per process lifetime, not per image. No probe overhead per encode.
- **`sequentialRead: true`:** Present on all `sharp()` constructors — streams large HEIF/RAW files without random-access I/O.
- **`limitInputPixels`:** Passed per constructor call, correctly bounded by `IMAGE_MAX_INPUT_PIXELS` env var.

No new Sharp pipeline performance issues found.

---

## Service Worker Assessment (No New Issues)

`public/sw.template.js` reviewed:

- **HEAD revalidation timeout:** `AbortSignal.timeout(300)` bounds the synchronous freshness probe — a slow network aborts the HEAD probe and serves the cached bytes immediately, with background revalidation. Correct.
- **304 short-circuit:** `revalidatePromise` is now created lazily (after the HEAD confirms staleness), so a 304 response genuinely skips the body GET. LRU recency is bumped via `bumpLruTimestamp()`. Correct.
- **LRU cap:** 50 MB IMAGE_CACHE cap with O(1) LRU management via `sw-cached-at` header timestamps. No per-eviction sort pass.
- **HTML offline cache:** Correctly excludes admin routes and admin-rendered pages via `x-gk-admin-render: 1` response header set in `proxy.ts`.

No new service worker performance issues found.

---

## ETag / Caching Assessment (No New Issues)

`serve-upload.ts` module-scoped settings-hash cache: 5-second TTL with stale-while-revalidate — no per-request `admin_settings` DB reads on the image-serving hot path. ETag: `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`. Hash covers all 9 `COLOR_IMPACTING_KEYS` including sorted `image_sizes`. Correct.

---

## `useSyncExternalStore` / Re-Render Assessment (No New Issues)

`use-display-capability.ts`: Module-level `_cachedSnapshot` memoization confirmed. `getSnapshot` returns the previous stable object reference when display capability is unchanged — preventing the `useSyncExternalStore` infinite-loop (React #185). Correct.

`photo-viewer.tsx` and `lightbox.tsx`: Standard `useMemo`/`useCallback` usage with correct dependency arrays. `srcSetData` and `blurStyle` memoized in both. No unbounded re-render patterns identified.

---

## Priority Recommendations

1. **PERF-15-01** (MEDIUM): Add migration `idx_images_processed_updated_at (processed, updated_at)`. One-line schema + migration SQL; accelerates `getLatestImageUpdatedAt`, `getImagesForFeed`, and (with extended form) the `getTopics()` correlated subquery.
2. **PERF-16-01** (LOW-MEDIUM): Hoist `getGalleryConfig()` to the outer `processImageJob` scope and pass `semanticMode` into the embedding IIFE, eliminating the per-job `admin_settings` SELECT when semantic search is active. Can also consolidate the legacy-path bootstrap call (PERF-15-06) at the same time.
3. **PERF-15-03** (LOW): Add a code comment documenting the 3-hop minimum; consider a single denormalized JOIN if group loading becomes a hot path.
4. **PERF-15-05** (LOW): Change `leftJoin` to `innerJoin` on `imageTags/tags` in tag-filtered listing paths.
