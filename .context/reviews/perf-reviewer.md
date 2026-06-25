# Performance Review — GalleryKit (HEAD bcd67b12)

**Reviewer:** perf-reviewer agent
**Date:** 2026-06-25
**Scope:** Full codebase — apps/web/src/ and all subdirectories, plus config, scripts, and deployment artifacts
**Angle:** Performance, concurrency, CPU/memory usage, UI responsiveness, database query efficiency, caching strategies, and bottlenecks

---

## Executive Summary

GalleryKit demonstrates mature performance engineering with deliberate trade-offs documented inline. The codebase avoids most critical anti-patterns (no unbounded result sets, no blocking event loops, no memory leaks in the hot path). However, several medium-severity issues remain: N+1 query patterns in bulk operations, suboptimal React re-render patterns, missing `cache()` wrappers on frequently-called data functions, rate-limit state that is process-local and uncoordinated, and a brute-force O(n) semantic search scan with no vector index. None of these are show-stoppers for a single-writer personal gallery, but they represent concrete scalability ceilings and user-visible latency risks.

**Confidence labels:** High = verified by reading exact code; Medium = inferred from patterns or adjacent code; Low = speculative based on architectural knowledge.

---

## 1. Database Query Efficiency

### 1.1 N+1 UPDATE loop in `bulkUpdateImages()` — HIGH

**File:** `apps/web/src/app/actions/images.ts:1021-1031`

```typescript
for (const { id, caption } of toUpdate) {
    await tx.update(images)
        .set({ title: caption })
        .where(eq(images.id, id));
}
```

**Problem:** If `bulkUpdateImages` is called with 50 images and the "apply suggested alt-text" mode is active, this issues 50 separate `UPDATE` statements inside the transaction. A single bulk `UPDATE ... SET title = CASE id WHEN 1 THEN 'caption1' WHEN 2 THEN 'caption2' END WHERE id IN (...)` would collapse this to one query.

**Failure scenario:** Admin bulk-applies auto-alt-text to 200 images. The transaction holds for 200 sequential round-trips (each ~1-3 ms) = 200-600 ms of transaction duration, blocking the connection pool and delaying other requests. At 200 images this is already perceptible in the admin UI.

**Confidence:** High — exact code verified.

### 1.2 Per-tag resolution loops in `bulkUpdateImages()` — HIGH

**File:** `apps/web/src/app/actions/images.ts:1036-1047` (add tags), `1052-1059` (remove tags)

```typescript
for (const name of addTagNames) {
    const resolved = await ensureTagRecord(tx, cleanName, slug);
    // ... one SELECT (or SELECT+INSERT) per unique tag name
    await tx.insert(imageTags).ignore().values(
        ids.map(imageId => ({ imageId, tagId: resolved.tag.id }))
    );
}
```

**Problem:** Tag resolution is per-tag-name, not batched. Adding 10 tags to 50 images = 10 tag-resolution queries (each `ensureTagRecord` does a SELECT, possibly an INSERT). The `imageTags` INSERTs are batched per-tag, but the resolution is not.

**Failure scenario:** Admin bulk-adds 20 tags to 100 images. 20 tag-resolution queries + 20 batched INSERTs = 40 DB round-trips inside the transaction. The connection pool (10 connections) is not exhausted, but the transaction duration grows linearly with tag count.

**Confidence:** High — exact code verified.

### 1.3 Per-file tag resolution in `uploadImages()` — HIGH

**File:** `apps/web/src/app/actions/images.ts:403-419`

```typescript
for (const file of files) {
    // ...
    for (const cleanName of uniqueTagNames) {
        const resolvedTag = await ensureTagRecord(db, cleanName, slug);
        // ...
    }
}
```

**Problem:** Tag resolution is inside the per-file loop. Uploading 20 files each with 5 tags = 100 tag-resolution queries. Tags should be pre-resolved across all files before the per-file loop.

**Failure scenario:** Batch upload of 50 photos with 5 tags each = 250 tag-resolution queries. The connection pool queues these, and the upload action duration grows linearly with file count × tag count.

**Confidence:** High — exact code verified.

### 1.4 `getImageCount()` and `getTags()` lack `cache()` wrappers — HIGH

**File:** `apps/web/src/lib/data.ts:540-542`, `544-568`

```typescript
export async function getTags(topic?: string) {
    return _getTags(topic);
}

export async function getImageCount(...) { ... }
```

**Problem:** Neither function is wrapped in React `cache()`. In a complex page render (e.g., a topic page that renders a sidebar + masonry grid + pagination), `getImageCount()` may be called multiple times by different components, issuing duplicate `COUNT(*)` queries. `getTags()` is similarly unwrapped.

**Failure scenario:** A topic page with sidebar tag cloud + masonry grid + pagination calls `getImageCount()` 3 times per render = 3 identical `COUNT(*)` queries. At gallery scale this is cheap, but it is wasted work.

**Confidence:** High — exact code verified. The file already wraps 10 functions with `cache()` (lines 1616-1630), but these two are omitted.

### 1.5 `searchImages()` has no `cache()` wrapper — MEDIUM

**File:** `apps/web/src/lib/data.ts:1412`

**Problem:** `searchImages()` is not cached. A search page that renders results + pagination + sidebar may call it multiple times. However, search is inherently user-specific (different queries), so caching is less valuable here. Still, within a single render, duplicate calls are possible.

**Confidence:** High — exact code verified.

### 1.6 `group_concat_max_len` init query on every connection — MEDIUM

**File:** `apps/web/src/db/index.ts:60-68`

```typescript
poolConnection.on('connection', (connection) => {
    const initPromise = callbackConnection.promise().query('SET group_concat_max_len = 65535')
        .then(() => undefined)
        .catch((err) => { console.error(...); });
    (connection as unknown as Record<symbol, Promise<void>>)[connectionInitSymbol] = initPromise;
});
```

**Problem:** Every fresh pool connection executes a `SET SESSION group_concat_max_len = 65535` query. With 10 connections and keepalive, this is amortized, but under load (connection churn) it adds ~1 ms per fresh connection. The comment acknowledges this is a per-connection cost.

**Mitigation:** Could be set globally in MySQL `my.cnf` instead, eliminating per-connection overhead entirely. The current approach is defensible for portability (no `my.cnf` dependency), but it is a known overhead.

**Confidence:** High — exact code verified.

### 1.7 `getAdminImagesLite()` and `getFailedImages()` lack `cache()` — MEDIUM

**File:** `apps/web/src/lib/data.ts:923-945`, `948-962`

**Problem:** Admin dashboard queries are not cached. The admin page may call these multiple times per render (e.g., for different tabs or components). However, admin pages are low-traffic and dynamic, so the impact is minimal.

**Confidence:** High — exact code verified.

---

## 2. Image Processing Pipeline (CPU/Memory)

### 2.1 `sharp.cache(false)` disables libvips operation cache entirely — MEDIUM

**File:** `apps/web/src/lib/process-image.ts:53`

```typescript
sharp.cache(false);
```

**Problem:** Disables the libvips operation cache entirely. The comment (line 51-52) explains this is intentional: "server processes never see cache hits (every UUID is fresh) and the libvips operation cache pins buffers in heap." However, this is a blunt instrument. For a long-running process that processes many images, the cache could help with intra-image operations (e.g., the same Sharp instance reused for multiple resizes). The current design uses fresh `sharp()` instances per format (WI-14), so cache hits are rare, but the disable is still a deliberate trade-off that increases CPU usage.

**Failure scenario:** Processing a 50 MP wide-gamut source requires multiple decode passes (metadata, blur, per-format encoding). Without cache, each decode is full cost. At personal-gallery scale this is acceptable; at batch-backfill scale it adds up.

**Confidence:** High — exact code and comment verified.

### 2.2 Full-file buffer read for AVIF NCLX verification — HIGH

**File:** `apps/web/src/lib/process-image.ts:200-209`

```typescript
async function _verifyAvifNclx(filePath: string, ...): Promise<void> {
    const buffer = await fs.readFile(filePath);  // <-- reads ENTIRE file
    const { ok, message } = verifyAvifNclxInBuffer(buffer.subarray(0, 4096), ...);
    // ... only uses first 4 KB
}
```

**Problem:** `_verifyAvifNclx()` reads the entire AVIF file into memory even though `verifyAvifNclxInBuffer` only inspects the first 4 KB. The `_verifyWebpIccChunk()` function was already fixed (line 250-272) to use a partial read via `fs.open()` + `handle.read(1024)`. The same pattern should be applied here.

**Failure scenario:** A 200 MB AVIF file is read entirely into memory just to verify the first 4 KB. Under concurrent processing (QUEUE_CONCURRENCY > 1), this transiently allocates 200 MB per concurrent job. With the default concurrency of 1, this is a single large allocation that spikes RSS.

**Confidence:** High — exact code verified. The WebP verifier fix (line 250-272) demonstrates the correct pattern.

### 2.3 `metadata()` called twice per image — MEDIUM

**File:** `apps/web/src/lib/process-image.ts:812` (in `saveOriginalAndGetMetadata`) and `990` (in `processImageFormats`)

**Problem:** `metadata()` is called once in `saveOriginalAndGetMetadata()` and again in `processImageFormats()`. The second call is intentional (comment at line 987-989: "read BOTH dimensions fresh from Sharp to avoid mixed-freshness inconsistency if the original file is modified between upload and processing"). However, this adds a second decode pass.

**Failure scenario:** A 100 MB TIFF requires two full metadata decodes. At personal-gallery scale this is ~10-30 ms overhead per image. For a batch of 100 images, this is 1-3 seconds of extra CPU.

**Confidence:** High — exact code and comment verified.

### 2.4 Full-file buffer read for GPS stripping — MEDIUM

**File:** `apps/web/src/lib/process-image.ts:1559` (via `stripGpsFromOriginal()`)

```typescript
const input = await fs.readFile(filePath);
```

**Problem:** `stripGpsFromOriginal()` reads the entire original file (up to 200 MB) into memory. The lossless scrubbers operate on buffers, so the entire file must be loaded. For Tier 1 (lossless byte-level scrubbing), this is unavoidable with the current buffer-based design.

**Failure scenario:** Uploading a 200 MB TIFF reads the entire file into memory for GPS stripping, then again for Sharp processing. Peak memory per upload job = ~400 MB (original + Sharp internal buffers). With QUEUE_CONCURRENCY=1, this is manageable; with higher concurrency, RSS spikes.

**Confidence:** High — exact code verified. The comment at line 1559 acknowledges this.

### 2.5 10-bit AVIF probe is a Promise-singleton — LOW (positive)

**File:** `apps/web/src/lib/process-image.ts:69-100`

**Problem:** The 10-bit AVIF probe uses a Promise-singleton to avoid redundant probes. This is a positive pattern. However, the probe itself creates a 2x2 image and encodes it with `bitdepth: 10`. If libheif rejects 10-bit, the probe fails and all subsequent wide-gamut AVIFs are encoded at 8-bit. This is correct behavior but means the probe result is process-global and cannot be refreshed without restart.

**Confidence:** High — exact code verified. This is a documented positive pattern, not a bug.

---

## 3. React Component Performance

### 3.1 `home-client.tsx` masonry grid re-calculates on every resize — MEDIUM

**File:** `apps/web/src/components/home-client.tsx:47-59`

```typescript
const handleResize = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
        update();
        rafId = null;
    });
};
window.addEventListener('resize', handleResize);
```

**Problem:** The rAF-debounced resize handler still fires React state updates on every valid resize. The `update()` function sets both `viewportWidth` and `count` state. Even when the column count hasn't changed (e.g., resizing within the same breakpoint), React re-renders the entire masonry grid.

**Failure scenario:** User resizes the browser window slowly. Each resize event triggers a rAF, which updates state, which re-renders all visible masonry cards. For a 30-image page, this is 30 re-renders per resize frame. The `useMemo` on `allImages` (line 140-150) helps, but the JSX `.map()` still re-executes.

**Mitigation:** The `update()` function could compare the new count to the current count and only call `setCount` when it changes. `setViewportWidth` is needed for `containIntrinsicSize` calculations, but it could be stored in a ref instead of state to avoid re-renders.

**Confidence:** High — exact code verified.

### 3.2 `home-client.tsx` IIFE inside `.map()` on every render — HIGH

**File:** `apps/web/src/components/home-client.tsx:323-401`

```typescript
{images.map((image) => {
    const displayTitle = getPhotoDisplayTitleFromTagNames(image, topicsMap, t, untitledFallbackTitle);
    const altText = getConcisePhotoAltText(image, topicsMap, t, untitledFallbackTitle);
    // ... large IIFE building <picture> with imageSizes.map(...)
    return ( ... );
})}
```

**Problem:** For every image in the masonry grid, `getPhotoDisplayTitleFromTagNames`, `getConcisePhotoAltText`, and the `<picture>` builder IIFE run on every parent re-render. The `images` array is memoized via `useMemo` (line 140-150), but any parent state change (e.g., `showBackToTop`, `isLoading`) triggers a re-render of the entire grid.

**Failure scenario:** User scrolls down, triggering `LoadMore` to fetch more images. The `isLoading` state change re-renders the entire grid, re-executing all title/alt computations and `<picture>` builders for every already-visible image.

**Mitigation:** Extract a `MasonryCard` component wrapped in `React.memo` and memoize the computed values with `useMemo`.

**Confidence:** High — exact code verified.

### 3.3 `photo-viewer.tsx` missing `useMemo` on `currentIndex` — MEDIUM

**File:** `apps/web/src/components/photo-viewer.tsx:115` (approximate, based on search)

```typescript
const currentIndex = images.findIndex((img) => img.id === currentImageId);
```

**Problem:** O(n) array search on every render. If `images` is large (e.g., 100+ photos in a shared group), this is a linear scan on every state change.

**Mitigation:** Should be `useMemo(() => images.findIndex(...), [images, currentImageId])`.

**Confidence:** Medium — exact line not directly read, but the pattern is confirmed by the search agent.

### 3.4 `photo-viewer.tsx` inline function passed as prop — MEDIUM

**File:** `apps/web/src/components/photo-viewer.tsx:580` (approximate)

```typescript
<LightboxTrigger onClick={() => setShowLightbox(true)} />
```

**Problem:** New function reference on every render, causing `LightboxTrigger` to re-render even if memoized. However, `LightboxTrigger` is a simple component (line 47-53 in `lightbox.tsx`) with no `React.memo`, so the impact is minimal.

**Confidence:** Medium — exact line not directly read.

### 3.5 `search.tsx` `SearchResultItem` not wrapped in `React.memo` — MEDIUM

**File:** `apps/web/src/components/search.tsx:56-107`

```typescript
function SearchResultItem({ image, query, onSelect, refCb, isActive, isLast }: SearchResultItemProps) {
    // ... not wrapped in React.memo
}
```

**Problem:** Every keystroke re-renders all search result items because the parent `Search` re-renders on `query` change. The `SearchResultItem` has internal state (`imgSrc`, `fallbackTriedRef`) that survives re-renders, but the JSX still re-executes.

**Failure scenario:** User types a 10-character query. Each character change re-renders all 20 search results = 200 re-renders. The images are small (48x48 thumbnails), but the DOM reconciliation cost is non-zero.

**Mitigation:** Wrap `SearchResultItem` in `React.memo`.

**Confidence:** High — exact code verified.

### 3.6 `useTranslation()` wrapper creates new object on every call — MEDIUM

**File:** `apps/web/src/components/i18n-provider.tsx:15-19`

```typescript
export function useTranslation() {
    const t = useTranslations();
    const locale = useLocale();
    return { t, locale }; // New object every time
}
```

**Problem:** Every consumer receives a new object reference on every render, causing unnecessary re-renders in components that depend on stable references. This is a known React anti-pattern.

**Failure scenario:** `PhotoViewer` calls `useTranslation()` and passes `t` to child components. Every state change in `PhotoViewer` creates a new `t` object, causing `ColorDetailsSection`, `InfoBottomSheet`, etc. to re-render even if their other props are unchanged.

**Mitigation:** Wrap the return in `useMemo(() => ({ t, locale }), [t, locale])`.

**Confidence:** Medium — exact line not directly read, but the pattern is confirmed by the search agent.

### 3.7 `lightbox.tsx` keyboard handler re-registers on `colorPipOpen` changes — MEDIUM

**File:** `apps/web/src/components/lightbox.tsx:306-357` (approximate)

**Problem:** The keyboard handler effect has `colorPipOpen` in its dependency array. `colorPipOpen` changes frequently (user toggles the color details panel), causing the keyboard handler to re-register.

**Mitigation:** Use a ref for `colorPipOpen` to keep the effect stable.

**Confidence:** Medium — exact line not directly read.

### 3.8 `upload-dropzone.tsx` stale closure in async loop — LOW

**File:** `apps/web/src/components/upload-dropzone.tsx:259-260` (approximate)

```typescript
setCompletedCount(completedSoFar);
setProgress(Math.round((completedSoFar / totalFiles) * 100));
```

**Problem:** In an async loop, using the captured `completedSoFar` variable instead of functional update can lead to stale closure issues. However, the loop is sequential and `completedSoFar` is incremented synchronously before the `setState` calls, so the practical risk is low.

**Confidence:** Medium — exact line not directly read.

---

## 4. Caching Strategies

### 4.1 Missing `cache()` on `getLatestImageUpdatedAt()` — HIGH

**File:** `apps/web/src/lib/data.ts:488-495`

```typescript
export async function getLatestImageUpdatedAt(): Promise<Date | null> {
    const [row] = await db
        .select({ latest: sql<Date | null>`MAX(${images.updated_at})` })
        .from(images)
        .where(eq(images.processed, true))
        .limit(1);
    return row?.latest ?? null;
}
```

**Problem:** Not wrapped in `cache()`. This is called by the sitemap generation (`sitemap.ts`) and potentially by other metadata consumers. Each call issues a `MAX(updated_at)` query.

**Failure scenario:** A page render that includes sitemap metadata + OG card + footer calls this 3 times = 3 identical queries.

**Confidence:** High — exact code verified.

### 4.2 `getGalleryConfig()` cached only per-request — MEDIUM

**File:** `apps/web/src/lib/gallery-config.ts:210`

```typescript
const getGalleryConfig = cache(async () => { ... });
```

**Problem:** `cache()` only deduplicates within a single RSC request. Multiple concurrent clients each trigger their own DB query. The `admin_settings` table is small (a few dozen rows), but the query is executed once per request. For a gallery with 100 concurrent visitors, this is 100 identical queries per second.

**Mitigation:** A short module-scoped TTL cache (similar to `serve-upload.ts` pattern, line 46-83) would reduce this to 1 query per TTL window. The settings change infrequently (admin edits), so a 5-second TTL is safe.

**Confidence:** High — exact code verified.

### 4.3 Admin getter functions not cached — MEDIUM

**Files:**
- `apps/web/src/app/actions/admin-users.ts:61` — `getAdminUsers()`
- `apps/web/src/app/actions/settings.ts:19` — `getGallerySettingsAdmin()`
- `apps/web/src/app/actions/seo.ts:27` — `getSeoSettingsAdmin()`

**Problem:** These read-only admin getters query the DB on every call without `cache()` wrappers. The admin dashboard may call them multiple times per render.

**Failure scenario:** Admin dashboard renders a settings page that calls `getGallerySettingsAdmin()` 3 times (for different sections) = 3 identical queries.

**Confidence:** Medium — exact lines not directly read, but pattern confirmed by search agent.

### 4.4 ETag on OG routes missing settings hash and pipeline version — MEDIUM

**File:** `apps/web/src/app/api/og/route.tsx:93-96` (approximate)

```typescript
const etag = '"' + createHash('sha256').update(`${topicRecord.slug}|${topicLabel}|${tagList.join(',')}|${siteTitle}`).digest('hex').slice(0, 32) + '"';
```

**Problem:** The ETag does NOT include the `settings-hash` or `IMAGE_PIPELINE_VERSION`. If an admin changes SEO settings (e.g., `siteTitle`) or the pipeline version bumps, existing cached OG images will still be served with 304 Not Modified because the ETag hasn't changed.

**Failure scenario:** Admin changes `siteTitle` in settings. Social media platforms that have cached the OG image will continue serving the old title until the cache expires (24 hours, per `stale-while-revalidate=86400`).

**Confidence:** Medium — exact line not directly read.

### 4.5 Missing ETag on per-photo OG route — MEDIUM

**File:** `apps/web/src/app/api/og/photo/[id]/route.tsx:227-232` (approximate)

**Problem:** Returns `Cache-Control` but no `ETag` header. Without ETag, the `stale-while-revalidate` directive has no revalidation key. The browser/CDN cannot send `If-None-Match` for conditional requests.

**Failure scenario:** A cached OG photo card is re-requested. The CDN serves the cached copy unconditionally (no 304 possibility) because there is no ETag to compare.

**Confidence:** Medium — exact line not directly read.

### 4.6 `serve-upload.ts` has excellent caching — HIGH (positive)

**File:** `apps/web/src/lib/serve-upload.ts:46-83`

The module-scoped TTL cache + stale-while-revalidate pattern for settings-hash computation is a well-engineered solution. It reduces DB queries from "one per image request" to "one per 5-second window" while preserving correctness.

**Confidence:** High — exact code verified. This is a positive finding.

---

## 5. Rate Limiting and Concurrency

### 5.1 Shared `'unknown'` bucket when `TRUST_PROXY` unset — HIGH

**File:** `apps/web/src/lib/rate-limit.ts:170-176` (approximate)

```typescript
const ip = 'unknown';
// [SECURITY] warning: ALL users share a single rate-limit bucket
```

**Problem:** When `TRUST_PROXY` is not set and proxy headers are present, `getClientIp()` returns `'unknown'` for ALL clients. After 5 failed login attempts from ANY IP, ALL users are locked out for 15 minutes. This is a documented operational risk but is unmitigated.

**Failure scenario:** A botnet probes the login page from 1000 IPs. Each IP gets 5 attempts, but they all share the same `'unknown'` bucket. After 5 total attempts, ALL legitimate users are locked out for 15 minutes.

**Confidence:** High — the pattern is documented in the code and CLAUDE.md.

### 5.2 In-memory rate limits are process-local (no cross-process coordination) — MEDIUM

**File:** `apps/web/src/lib/rate-limit.ts:77-87`

```typescript
const ogRateLimit = createResetAtBoundedMap<string>(OG_RATE_LIMIT_MAX_KEYS);
const shareRateLimit = createResetAtBoundedMap<string>(SHARE_RATE_LIMIT_MAX_KEYS);
```

**Problem:** In a multi-process deployment (e.g., PM2 cluster mode), each process has its own independent rate-limit state. A client could exhaust the budget on one process and get a fresh budget on another.

**Failure scenario:** GalleryKit is deployed with 4 PM2 workers. An attacker sends 30 OG requests to worker 1 (rate limited), then 30 to worker 2 (rate limited), then 30 to worker 3, etc. Total allowed = 120 requests/min instead of 30.

**Mitigation:** This is documented in CLAUDE.md as a known limitation of the single-writer topology. Not a bug, but a scalability ceiling.

**Confidence:** High — exact code verified.

### 5.3 OG and share rate limits have no DB backup — MEDIUM

**File:** `apps/web/src/lib/rate-limit.ts:77-87`

**Problem:** `ogRateLimit` and `shareRateLimit` use only in-memory `BoundedMap` with NO DB backup. On process restart, all accumulated rate-limit state is lost. Contrast with `login` and `search` which use both in-memory and DB-backed counters.

**Failure scenario:** Process restarts (e.g., deploy, crash). An attacker that was previously rate-limited gets a fresh budget immediately.

**Confidence:** High — exact code verified.

### 5.4 Semantic and similar-photo rate limits share the same bucket — MEDIUM

**File:** `apps/web/src/lib/rate-limit.ts:283-321` (approximate)

**Problem:** Both `/api/search/semantic` (POST, expensive: CLIP embedding + brute-force scan) and `/api/search/similar/[id]` (GET, expensive: CLIP embedding + brute-force scan) use the SAME `preIncrementSemanticAttempt` / `rollbackSemanticAttempt` budget. A client doing semantic text searches consumes the same 30 req/min bucket as one doing image-to-image similarity searches. These are different operations with different costs.

**Failure scenario:** A user does 20 semantic text searches, then tries 20 image-to-image similarity searches. The second batch is rate-limited because the shared bucket is exhausted.

**Confidence:** Medium — exact line not directly read.

### 5.5 Semantic/share rate limit BoundedMaps never pruned by hourly GC — LOW

**File:** `apps/web/src/lib/rate-limit.ts:286-317` (approximate)

**Problem:** `semanticRateLimit` and `shareRateLimit` have `prune()` functions but are never called by the hourly GC in `image-queue.ts`. Over long process lifetimes, these Maps may grow toward their caps even though many entries are expired.

**Failure scenario:** Process runs for months without restart. The `semanticRateLimit` Map approaches its 2000-key cap. New legitimate users are evicted (FIFO) even though most entries are stale.

**Confidence:** Medium — exact line not directly read.

### 5.6 No rate limiting on health/live endpoints — LOW

**File:** `apps/web/src/app/api/health/route.ts:7`, `apps/web/src/app/api/live/route.ts:3`

**Problem:** Public GET routes with NO rate limiting. Could be used for DoS amplification if called rapidly. However, these are lightweight endpoints (health is liveness-only, live is a static response), so the impact is minimal.

**Confidence:** Medium — exact line not directly read.

---

## 6. Memory Usage and Leaks

### 6.1 `nextHistogramRequestId` unbounded counter — LOW

**File:** `apps/web/src/components/histogram.tsx:114` (approximate)

```typescript
let nextHistogramRequestId = 0;
// ... increments via ++nextHistogramRequestId at line 134
```

**Problem:** Module-scope counter that increments on every histogram worker request. Over an extremely long browser session, this could theoretically grow to `Number.MAX_SAFE_INTEGER`. In practice, a user would need to open ~9 quadrillion histograms, so this is not a realistic concern.

**Confidence:** Medium — exact line not directly read.

### 6.2 View count buffer has no automatic TTL eviction — MEDIUM

**File:** `apps/web/src/lib/data.ts:17-32`

```typescript
let viewCountBuffer = new Map<number, number>();
// NOTE: This Map has NO automatic eviction. Entries are only cleared when the buffer empties.
```

**Problem:** If the process crashes before `flushGroupViewCounts` runs, all buffered view counts are lost permanently. The `viewCountFlushTimer` is set with `setTimeout` but `unref()` is called, so it won't keep the process alive. However, the buffer is bounded by `MAX_VIEW_COUNT_BUFFER_SIZE = 1000`, so it cannot grow unbounded.

**Failure scenario:** Process crashes while the buffer has 500 entries. All 500 view count increments are lost permanently. The shared group's `view_count` is best-effort by design, so this is documented behavior.

**Confidence:** High — exact code verified.

### 6.3 `image-queue.ts` retry Maps have FIFO eviction — LOW (positive)

**File:** `apps/web/src/lib/image-queue.ts:98-103`

```typescript
function pruneRetryMaps(state: ProcessingQueueState) {
    for (const map of [state.retryCounts, state.claimRetryCounts, state.lastErrors] as const) {
        if (map.size <= MAX_RETRY_MAP_SIZE) continue;
        // ... FIFO eviction
    }
}
```

**Problem:** The comment (line 85-93) acknowledges that FIFO eviction is not LRU: "recently-accessed entries are not moved to the end of iteration order, so a frequently-retried low-id job at the head of the Map is evicted first." However, the cap is 10,000 entries, which is large enough that this is unlikely to matter at personal-gallery scale.

**Confidence:** High — exact code verified.

---

## 7. Semantic Search Scalability

### 7.1 Brute-force O(n) semantic search scan — HIGH

**File:** `apps/web/src/app/api/search/semantic/route.ts:252-262` (approximate)

**Problem:** The semantic search endpoint scans up to `SEMANTIC_SCAN_LIMIT = 2000` embeddings with no vector index (ANN/HNSW). For each query, it:
1. Reads up to 2000 embedding rows from the DB
2. Decodes each MEDIUMBLOB (2048 bytes) into a Float32Array
3. Computes cosine similarity (or dot product) against the query embedding
4. Sorts all scores and returns top-K

This is O(n) in the number of embeddings scanned. Linear growth with gallery size.

**Failure scenario:** Gallery has 5000 images. Semantic search scans 2000 (the limit). Each query reads ~4 MB of embedding data from the DB (2000 × 2048 bytes) and performs 2000 dot products (512-dim each = ~1M float ops). At 30 queries/min, this is ~120 MB/min of DB read traffic + 30M float ops/min. On a single-core VPS, this is noticeable CPU load.

**Mitigation:** This is a known architectural trade-off for the single-MySQL topology. The `SEMANTIC_SCAN_LIMIT` cap prevents unbounded growth. For larger galleries, an ANN index (e.g., pgvector, Milvus, or FAISS) would be needed.

**Confidence:** High — the scan limit and brute-force approach are documented in CLAUDE.md and the code.

### 7.2 `topK()` sorts entire array when only top K needed — MEDIUM

**File:** `apps/web/src/lib/clip-embeddings.ts:138-143`

```typescript
export function topK(matches: ScoredMatch[], k: number, threshold: number): ScoredMatch[] {
    return matches
        .filter(m => m.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
}
```

**Problem:** With `SEMANTIC_SCAN_LIMIT = 2000`, this sorts up to 2000 elements when only `SEMANTIC_TOP_K_MAX = 50` are needed. O(n log n) instead of O(n log k) with a min-heap. At 2000 elements this is sub-millisecond in JS, but it becomes a bottleneck if `SEMANTIC_SCAN_LIMIT` is increased.

**Failure scenario:** Operator increases `SEMANTIC_SCAN_LIMIT` to 10000 for a larger gallery. Each query now sorts 10000 elements = ~1-2 ms of extra CPU per query. At 30 queries/min, this is negligible, but it scales poorly.

**Confidence:** High — exact code verified.

---

## 8. Service Worker and Offline Performance

### 8.1 SW HEAD revalidation bounded by 300ms timeout — HIGH (positive)

**File:** `apps/web/public/sw.template.js` (referenced via `sw-cache.ts`)

The synchronous HEAD revalidation is bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` (300 ms). On a slow/hung network, the probe aborts and the SW serves cached bytes immediately + revalidates in the background. This prevents the masonry paint from stalling on per-tile network probes.

**Confidence:** High — documented in CLAUDE.md and verified by the `sw-cache.ts` reference implementation.

### 8.2 HTML offline cache is admin-route-aware — HIGH (positive)

**File:** `apps/web/public/sw.template.js` (referenced)

The `networkFirstHtml` strategy caches public pages explicitly as an offline-only fallback, excluding admin routes and any page rendered with an admin session (identified by `x-gk-admin-render: 1` header). This prevents caching personalized admin pages in the SW.

**Confidence:** High — documented in CLAUDE.md.

---

## 9. Bundle Size and Loading

### 9.1 `geoip-lite` loaded lazily but never warmed — LOW

**File:** `apps/web/src/lib/analytics.ts:33-47` (approximate)

**Problem:** `geoip-lite` is loaded lazily on first analytics call. The module load + GeoLite2 parse costs ~40MB of memory and some CPU. This is fire-and-forget (not user-facing), but the first view after process restart is slower.

**Failure scenario:** Process restarts. First visitor to the gallery triggers the `geoip-lite` load, adding ~50-100ms latency to the first view-event logging. Subsequent views are fast.

**Confidence:** Medium — exact line not directly read.

### 9.2 `next/image` used for all images — HIGH (positive)

**File:** Throughout components

The codebase uses `next/image` (or the custom `OptimisticImage` wrapper) for all image rendering, which provides automatic lazy loading, responsive sizing, and blur placeholders. This is a positive performance pattern.

**Confidence:** High — observed across multiple components.

---

## 10. Operational and Deployment Performance

### 10.1 Docker auto-prune after deploy — HIGH (positive)

**File:** `apps/web/deploy.sh` (referenced in CLAUDE.md)

The deploy script auto-prunes Docker containers, images, builder cache, and volumes after every deploy. This prevents disk exhaustion, which previously caused production outages.

**Confidence:** High — documented in CLAUDE.md.

### 10.2 Single-writer topology limits horizontal scaling — MEDIUM

**File:** Documented in CLAUDE.md

**Problem:** The runtime topology is explicitly single-writer. Process-local state (rate limits, upload quota tracking, image queue, backfill runner status) prevents horizontal scaling without moving to a shared store (Redis, etc.).

**Failure scenario:** Operator tries to scale the web service to 3 instances behind a load balancer. Rate limits become 3x weaker (each process has its own budget), upload quotas are tracked per-process (a user could upload 3x the limit by hitting different instances), and the image queue would have 3 independent workers potentially racing the same rows.

**Confidence:** High — documented in CLAUDE.md as a known limitation.

---

## 11. Positive Performance Patterns (Worth Noting)

### 11.1 React `cache()` on 10 data functions — HIGH

**File:** `apps/web/src/lib/data.ts:1616-1630`

10 data-access functions are wrapped in React `cache()` for SSR deduplication: `getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`, `getSeoSettings`.

This prevents duplicate DB queries within the same SSR request when multiple components call the same data function.

### 11.2 `Promise.all` for parallel DB queries — HIGH

**File:** `apps/web/src/lib/data.ts:1056-1102`

`getImage()` fetches tags, prev, and next images in parallel via `Promise.all`, reducing the sequential 3-query worst case to a single round-trip.

### 11.3 Cursor-based pagination — HIGH

**File:** `apps/web/src/lib/data.ts:623-718`

The listing queries use cursor-based pagination (keyset pagination) with `capture_date DESC, created_at DESC, id DESC`, avoiding the OFFSET performance cliff for large result sets.

### 11.4 `getLatestImageForOg()` minimal query — HIGH

**File:** `apps/web/src/lib/data.ts:881-895`

The OG metadata path uses a minimal `SELECT id, title` with no tag JOIN and no aggregation, avoiding the heavy `GROUP_CONCAT` work of the full masonry listing query.

### 11.5 `serve-upload.ts` stale-while-revalidate hash cache — HIGH

**File:** `apps/web/src/lib/serve-upload.ts:46-83`

The module-scoped TTL cache + stale-while-revalidate pattern reduces DB queries from "one per image request" to "one per 5-second window" while preserving correctness.

### 11.6 Image processing queue with advisory locks — HIGH

**File:** `apps/web/src/lib/image-queue.ts`

The PQueue-based image processing queue uses MySQL advisory locks per-image to prevent concurrent processing of the same image across restarts or multi-process deployments.

### 11.7 `limitInputPixels` decompression bomb protection — HIGH

**File:** `apps/web/src/lib/process-image.ts:274-279`

Sharp's `limitInputPixels` is configured to prevent decompression bomb attacks, with a default cap of 256M pixels.

### 11.8 `sequentialRead: true` for large originals — HIGH

**File:** `apps/web/src/lib/process-image.ts:808`

Sharp is configured with `sequentialRead: true` to cap peak memory on large originals by streaming pixels instead of loading the entire image into memory at once.

---

## Summary of Findings

| Category | Count | Max Severity | Key Files |
|----------|-------|--------------|-----------|
| N+1 Queries | 4 | Medium | `images.ts` |
| Blocking Operations | 3 | Medium | `process-image.ts` |
| React Inefficiencies | 7 | Medium | Multiple components |
| Missing Caching | 6 | Medium | `data.ts`, `gallery-config.ts`, action files |
| Rate Limiting | 6 | Medium-High | `rate-limit.ts`, API routes |
| Memory Leaks | 2 | Low | `histogram.tsx`, `data.ts` |
| Image Processing | 3 | Medium | `process-image.ts` |
| Sorting/Filtering | 2 | Low-Medium | `clip-embeddings.ts` |
| Semantic Search | 2 | High (scalability) | `api/search/semantic/route.ts` |
| Other | 2 | Low | Various |

---

## Recommendations (Prioritized)

### P1 (High Impact, Low Effort)

1. **Add `cache()` to `getLatestImageUpdatedAt()`** — `apps/web/src/lib/data.ts:488`. One-line change.
2. **Add `cache()` to `getImageCount()`** — `apps/web/src/lib/data.ts:544`. One-line change.
3. **Fix AVIF NCLX verifier to use partial read** — `apps/web/src/lib/process-image.ts:200-209`. Copy the WebP verifier pattern (lines 250-272).
4. **Wrap `SearchResultItem` in `React.memo`** — `apps/web/src/components/search.tsx:56`. One-line change.

### P2 (Medium Impact, Medium Effort)

5. **Batch UPDATE in `bulkUpdateImages()`** — `apps/web/src/app/actions/images.ts:1021-1031`. Replace per-row loop with a single `CASE WHEN` bulk UPDATE.
6. **Pre-resolve tags in `uploadImages()`** — `apps/web/src/app/actions/images.ts:403-419`. Move tag resolution outside the per-file loop.
7. **Add module-scoped TTL cache to `getGalleryConfig()`** — `apps/web/src/lib/gallery-config.ts:210`. Similar to `serve-upload.ts` pattern.
8. **Memoize `currentIndex` in `photo-viewer.tsx`** — Add `useMemo` for the `findIndex` computation.
9. **Add ETag to per-photo OG route** — `apps/web/src/app/api/og/photo/[id]/route.tsx`.
10. **Include settings hash in OG route ETag** — `apps/web/src/app/api/og/route.tsx`.

### P3 (Low Impact, or Architectural)

11. **Separate semantic and similar-photo rate-limit buckets** — `apps/web/src/lib/rate-limit.ts`.
12. **Add DB backup to OG/share rate limits** — `apps/web/src/lib/rate-limit.ts`.
13. **Consider ANN index for semantic search** — For galleries > 2000 images, the brute-force scan will become a bottleneck. Evaluate pgvector, Milvus, or FAISS.
14. **Optimize `topK()` with a min-heap** — `apps/web/src/lib/clip-embeddings.ts:138-143`. Replace `.sort()` with a partial sort or min-heap for O(n log k) instead of O(n log n).
15. **Set `group_concat_max_len` globally in MySQL** — `apps/web/src/db/index.ts:60-68`. Eliminate per-connection init query overhead.
