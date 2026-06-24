# Performance Review — GalleryKit (Cycle 10)

**Date:** 2026-06-25
**Head:** 87065049
**Previous cycle finding:** 0 defects (cycle 9)
**Scope:** Entire `apps/web/src/` — all non-test source files (~40,000+ lines)

---

## Summary

This review found **0 Critical**, **1 High**, **3 Medium**, and **4 Low** performance-related findings. The codebase continues to be well-optimized overall. Since cycle 9, the most notable changes are documentation fixes (DOC-01 through DOC-20), a CLIP cosine similarity epsilon fix (CODE-02), and a tailwind safelist cleanup (CSS-01). No new architectural performance regressions were introduced. The remaining issues are edge cases in concurrency, memory, and query patterns that could manifest under specific load conditions. All previous cycle findings remain documented below; none have been addressed since cycle 9 (they were deferred as acceptable trade-offs or require significant refactoring).

---

## Findings

### [HIGH-1] `processImageFormats` — fresh `sharp()` instance per format × per size creates 3×N decode passes

**File:** `apps/web/src/lib/process-image.ts` (lines 1099–1104, inside `generateForFormat`)
**Confidence:** High

The `generateForFormat` function creates a **fresh `sharp()` instance for every format AND every size**:
```typescript
for (const size of sortedSizes) {
    const base = needsRgb16
        ? sharp(processingInputPath, ...).pipelineColorspace('rgb16').resize({ width: resizeWidth })
        : sharp(processingInputPath, ...).resize({ width: resizeWidth });
    // ... encode to webp/avif/jpeg
}
```

For 6 configured sizes × 3 formats = **18 full decode passes** per image. Each `sharp(inputPath)` re-opens the file, re-decodes the entire image, and re-runs the resize pipeline. The comment at line 1095 (WI-14 / R8-R8) explicitly acknowledges this trade-off: "fresh sharp instance per format for ALL paths, not just rgb16. Eliminates shared-state risk between parallel encodes on the non-rgb16 path too."

While the cross-format isolation is correct for color integrity, the **per-size re-decode within the same format** is unnecessary. Sharp's `clone()` is designed for this: decode once, then `clone()` for each size variant within the same format.

**Concrete failure scenario:** A 50 MP wide-gamut source at 6 sizes takes ~18× the decode time of a single pass. With `QUEUE_CONCURRENCY=1` (default), this serializes and blocks the queue for minutes per image. The `WIDE_GAMUT_MAX_SOURCE_PIXELS` downscale helps but only for the rgb16 path.

**Suggested fix:** Within each format's `generateForFormat`, open `sharp()` once before the size loop, then use `.clone()` for each size. Keep the per-format fresh instance (the WI-14 isolation) but eliminate the per-size re-decode. This reduces 18 decode passes to 3 (one per format) for a 6× speedup on the decode portion.

**Status:** Unchanged since cycle 9. Deferred as a significant refactor requiring careful testing of the color pipeline.

---

### [MED-1] `getImage` — prev/next queries use `OR(...)` with multiple conditions that may not use the composite index efficiently

**File:** `apps/web/src/lib/data.ts` (lines 994–1102)
**Confidence:** Medium

The prev/next navigation builds conditions like:
```typescript
or(
    isNull(images.capture_date),
    and(isNotNull(images.capture_date), lt(images.capture_date, image.capture_date)),
    and(isNotNull(images.capture_date), eq(images.capture_date, image.capture_date), lt(images.created_at, image.created_at)),
    and(isNotNull(images.capture_date), eq(images.capture_date, image.created_at), eq(images.created_at, image.created_at), lt(images.id, image.id))
)
```

This OR-chain with mixed `isNull` / `isNotNull` / `lt` / `eq` predicates on `capture_date`, `created_at`, and `id` may not be optimizable by MySQL's index merge. The `idx_images_processed_capture_date` index is `(processed, capture_date, created_at)` — the `OR` with `isNull(capture_date)` on one branch and `isNotNull(capture_date)` on others forces a range scan that may not use the index for all branches.

**Concrete failure scenario:** On a gallery with many undated images (NULL capture_date), the prev/next query for a dated image must scan both the dated and undated partitions. With `revalidate = 0` on public pages, this runs on every photo page load.

**Suggested fix:** Consider splitting into two separate queries (one for dated, one for undated) and taking the closest result, or verify with `EXPLAIN` that the index is used. Add a `EXPLAIN` assertion test.

**Status:** Unchanged since cycle 9. The dynamic condition building (C6-AGG6R-01) improved the query shape but the OR-chain index efficiency concern remains.

---

### [MED-2] `searchImages` — three sequential/parallel queries with `LIKE '%term%'` cannot use indexes

**File:** `apps/web/src/lib/data.ts` (lines 1412–1551)
**Confidence:** High

The search function uses `LIKE '%term%'` (leading wildcard) on `images.title`, `images.description`, `images.camera_model`, `images.lens_model`, `images.topic`, and `topics.label`. Leading-wildcard LIKE prevents index usage — every search is a full table scan.

The three-query pattern (main → tag → alias) is efficient for small galleries but the leading-wildcard LIKE makes it O(n) per query on the `images` table rows.

**Concrete failure scenario:** A gallery with 50k images and a search for "sunset" scans all 50k rows across three queries. The `effectiveLimit = 100` cap limits returned rows but not scanned rows.

**Suggested fix:** This is a known limitation documented in the code (line 1426: "At personal-gallery scale this is an acceptable risk"). For larger galleries, consider MySQL FULLTEXT index on `title` + `description` + `camera_model`, or a dedicated search engine. No immediate fix needed for the stated use case.

**Status:** Unchanged since cycle 9. Acceptable trade-off at personal-gallery scale.

---

### [MED-3] `flushGroupViewCounts` — `Promise.all` over chunk of 20 concurrent UPDATEs may exhaust pool connections

**File:** `apps/web/src/lib/data.ts` (lines 66–194)
**Confidence:** Medium

The view-count flush processes in `FLUSH_CHUNK_SIZE = 20` chunks, with each chunk running `Promise.all` over 20 concurrent `db.update(...)` calls. Each UPDATE acquires a pool connection. With `POOL_CONNECTION_LIMIT = 10` and `queueLimit = 20`, a 20-concurrent UPDATE burst will:
1. Acquire 10 connections immediately
2. Queue 10 more in the pool's internal queue
3. Block until the first 10 complete

This is not a correctness issue (the pool handles queuing), but it does mean the flush holds connections for longer than necessary and can starve other concurrent requests.

**Concrete failure scenario:** During a traffic spike, many shared-group page loads buffer view counts. When the 5-second flush timer fires, 20 concurrent UPDATEs consume the entire pool for the duration of the flush, delaying live page renders that need `getImage()` or `getImagesLite()`.

**Suggested fix:** Reduce `FLUSH_CHUNK_SIZE` from 20 to 5 (matching the pool's sustainable concurrency) or use a connection-aware semaphore. Alternatively, use `db.execute` with a single bulk UPDATE using `CASE` expressions.

**Status:** Unchanged since cycle 9. The C30-03 retry logic and C5-AGG-02 cap were added but the chunk size remains 20.

---

### [LOW-1] `getServingColorSettingsHash` — 5-second TTL may cause stale ETag during rapid admin setting changes

**File:** `apps/web/src/lib/serve-upload.ts` (lines 46–83)
**Confidence:** Low

The module-scoped cache has a 5-second TTL. If an admin changes a color-impacting setting and immediately tests the result, they may see the old ETag for up to 5 seconds. The stale-while-revalidate pattern mitigates this for subsequent requests, but the first request after a change may still serve a stale hash.

**Concrete failure scenario:** Admin toggles `force_srgb_derivatives` and refreshes the gallery within 5 seconds. The old ETag is served, the browser gets 304 Not Modified, and the old bytes are served from cache. The admin sees no change and assumes the toggle didn't work.

**Suggested fix:** Acceptable trade-off documented in code. The 5-second skew is noted as "the same skew class settings-hash already documents as acceptable." No fix needed.

**Status:** Unchanged since cycle 9. Documented acceptable trade-off.

---

### [LOW-2] `purgeOldAuditLog` — unbounded DELETE without LIMIT may lock the audit_log table

**File:** `apps/web/src/lib/audit.ts` (lines 57–78)
**Confidence:** Low

```typescript
await db.delete(auditLog).where(lt(auditLog.created_at, cutoff));
```

Unlike `purgeOldViewEvents` which uses chunked DELETE with `LIMIT`, the audit log purge is a single unbounded DELETE. On a busy gallery with years of audit events, this could delete millions of rows in one statement, holding a table lock.

**Concrete failure scenario:** A gallery with 5 years of audit logs (millions of rows) triggers the hourly purge. The single DELETE locks the `audit_log` table for seconds, blocking concurrent audit writes from admin actions.

**Suggested fix:** Add `LIMIT` chunking to match the `purgeOldViewEvents` pattern (VIEW_PURGE_BATCH = 5000, MAX_BATCHES_PER_TABLE = 200).

**Status:** Unchanged since cycle 9. The R4C6 COR-R4C6-10 guard prevents negative retention but not the unbounded DELETE.

---

### [LOW-3] `generateCaption` — stub implementation runs synchronously but is called as async

**File:** `apps/web/src/lib/caption-generator.ts` (lines 54–65)
**Confidence:** Low

The `generateCaption` function is `async` but its body is entirely synchronous (no awaits). It's called from `image-queue.ts` (line 439) as a fire-and-forget promise: `.then(...).catch(...)`. The async wrapper creates an unnecessary microtask and promise allocation.

**Concrete failure scenario:** For every image processed, an extra promise + microtask is created. At 100 images, this is 100 extra promise allocations. Negligible in practice but unnecessary overhead.

**Suggested fix:** Make `generateCaption` synchronous (remove `async`) and call it directly. The caller can wrap in `Promise.resolve()` if needed.

**Status:** Unchanged since cycle 9. The stub is documented as deferred until real ONNX inference ships.

---

### [LOW-4] `getMapImages` — `for...of` runtime assertion loop adds O(n) overhead after query

**File:** `apps/web/src/lib/data.ts` (lines 1604–1613)
**Confidence:** Low

```typescript
for (const row of rows) {
    if (!row.topic_map_visible) {
        throw new Error(`[getMapImages] GPS leak guard: image ${row.id} belongs to a map_visible=false topic.`);
    }
}
```

The runtime assertion loop iterates over all 10,000 (max) returned rows. This is O(n) overhead after the DB query. The INNER JOIN on `topics.map_visible = true` should already guarantee this invariant at the SQL level.

**Concrete failure scenario:** A gallery with 10,000 GPS-tagged images triggers the map page. After the DB returns 10,000 rows, the JavaScript loop iterates all of them. At 10k rows this is ~0.1ms — negligible but unnecessary.

**Suggested fix:** Remove the runtime assertion or make it a debug-only check (`if (process.env.NODE_ENV === 'development')`). The SQL JOIN is the authoritative guard.

**Status:** Unchanged since cycle 9. Defense-in-depth pattern; acceptable overhead.

---

### [LOW-5] `poolConnection.query` and `poolConnection.execute` overrides — extra connection acquire/release per query

**File:** `apps/web/src/db/index.ts` (lines 99–115)
**Confidence:** Low

```typescript
poolConnection.query = (async (...args) => {
    const queryConnection = await poolConnection.getConnection();
    try {
        return await queryConnection.query(...args);
    } finally {
        queryConnection.release();
    }
}) as typeof poolConnection.query;
```

The overridden `query` and `execute` methods acquire a connection, run the query, and release it. This adds two pool operations (get + release) per query. The standard mysql2 pool's `.query()` already does this internally but may be more efficient (it uses the pool's internal queue directly).

**Concrete failure scenario:** Every Drizzle query goes through this wrapper. For a page that makes 10 queries, this is 20 extra pool operations (get + release × 10). The overhead is small (~0.1ms per operation) but adds up under load.

**Suggested fix:** Verify if this override is still necessary. The original purpose was to ensure `group_concat_max_len` is set on every connection (via the `connection` event handler). The `getConnection()` override already awaits the init promise. The `.query()` override may be redundant if mysql2's native pool.query handles connection lifecycle correctly.

**Status:** Unchanged since cycle 9. The C4R-RPL2-01 fix added the `connection` event handler with Symbol-based tracking; the `.query()` override may now be redundant.

---

### [LOW-6] `analytics-data.ts` — `getTopPhotosByViews` and `getTopTopicsByViews` use `count(imageViews.id)` with GROUP BY that may filesort on large datasets

**File:** `apps/web/src/lib/analytics-data.ts` (lines 37–75)
**Confidence:** Low

The `getTopPhotosByViews` and `getTopTopicsByViews` functions use:
```typescript
.groupBy(imageViews.imageId, images.title, images.topic)
.orderBy(desc(sql`viewCount`))
```

The `ORDER BY` references an aliased aggregate (`viewCount`) which is not in the GROUP BY. MySQL must compute the aggregate for all groups, then sort the result — a filesort. For the 'all' window with millions of view events, this could be expensive.

**Concrete failure scenario:** An admin opens the analytics page with the 'all' time window on a gallery with 5 years of data. The query must aggregate all non-bot view events, then sort by the computed count. With the `(bot, viewed_at, country_code)` index, the 'all' window falls back to a covering-index temp-table aggregation (documented in PERF-R5C2-01).

**Suggested fix:** The analytics page defaults to 30d/90d windows where the composite index serves a covering range scan. The 'all' window is an edge case. Documented as acceptable trade-off in PERF-R5C2-01. No fix needed unless EXPLAIN shows it as a hot path.

**Status:** Documented in cycle 5 as deferred pending EXPLAIN evidence.

---

## New Findings (Cycle 10)

### [MED-4] `loadMoreImages` / `loadMoreSmartCollectionImages` — duplicate rate-limit pre-increment pattern adds DB round-trip per scroll

**File:** `apps/web/src/app/actions/public.ts` (lines 82–142, 180–240)
**Confidence:** Medium

Both `loadMoreImages` and `loadMoreSmartCollectionImages` duplicate the same rate-limit pattern:
1. `preIncrementLoadMoreAttempt(ip, now)` — in-memory map update
2. `await incrementRateLimit(ip, 'load_more', ...)` — DB round-trip
3. `await checkRateLimit(ip, 'load_more', ...)` — second DB round-trip

This is 2 DB round-trips per load-more scroll event. At 120 req/min budget, a user scrolling rapidly triggers 2 round-trips per scroll. The DB-backed increment+check provides accuracy across restarts but at the cost of per-request latency.

**Concrete failure scenario:** A user on a slow network scrolls through 10 pages of a gallery. Each scroll triggers 2 DB round-trips (increment + check) plus the actual `getImagesLite` query. The rate-limit overhead is ~2-4ms per scroll — small but measurable on high-latency connections.

**Suggested fix:** The in-memory pre-increment already provides the primary defense. Consider making the DB increment fire-and-forget (don't await it) or batching it. The current pattern is correct for security but could be optimized for latency.

**Note:** This is a MEDIUM finding because the pattern is correct and the overhead is small, but it represents a measurable per-request cost that could be optimized.

---

### [LOW-7] `clip-embeddings.ts` `cosineSimilarity` — epsilon check is correct but the loop is unvectorized JavaScript

**File:** `apps/web/src/lib/clip-embeddings.ts` (lines 35–50)
**Confidence:** Low

The `cosineSimilarity` function (fixed in CODE-02 to use epsilon-based zero check) iterates 512 elements in a plain JavaScript loop:
```typescript
for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
}
```

For the semantic search route, this runs against up to `SEMANTIC_SCAN_LIMIT = 2000` vectors per query = 1,024,000 iterations. At ~2ns per iteration (optimistic for V8), this is ~2ms per query. The `dotProduct` fast path (for unit vectors) skips the sqrt but still iterates 512 × 2000 = 1,024,000 times.

**Concrete failure scenario:** With semantic search enabled and 2000 embeddings, each query spends ~2-5ms in JavaScript vector math. This is acceptable for a non-real-time search feature but could become a bottleneck if the scan limit is raised.

**Suggested fix:** Acceptable for the current `SEMANTIC_SCAN_LIMIT = 2000`. If the limit is raised or query volume increases, consider using SIMD-optimized math (e.g., `mathjs`, `ndarray`, or a WebAssembly module). The current brute-force scan is documented as a deliberate simplicity trade-off.

**Status:** The epsilon fix (CODE-02) was the only change since cycle 9. The loop structure is unchanged.

---

## Previously Fixed / Acknowledged Issues (Not Regressions)

The following issues were identified in prior cycles and are either fixed or documented as acceptable trade-offs:

1. **PERF-R4C3-05** (serve-upload.ts): Module-scoped 5s TTL for settings-hash — fixed in cycle 4.
2. **PERF-R4C4-01** (serve-upload.ts): Stale-while-revalidate hash cache — fixed in cycle 4.
3. **PERF-R5C1-01** (admin-backfill-runner.ts): Batched keyset-paginated fetch — fixed in cycle 5.
4. **WI-15** (process-image.ts): 50 MP wide-gamut downscale gate — fixed in cycle 2.
5. **CM-LOW-10** (process-image.ts): Sharp concurrency divided by format fan-out — fixed in cycle 3.
6. **AGG-R8c3-05** (data.ts): Minimal `getLatestImageForOg` accessor — fixed in cycle 8.
7. **HIGH-1** (data.ts): GROUP BY filesort on listing queries — acknowledged in cycle 6, still present but acceptable at stated scale.
8. **MED-5** (data.ts): Correlated subquery in `getTopics` — acknowledged in cycle 6, cached by `revalidate = 3600` on sitemap.
9. **PERF-R5C2-01** (analytics-data.ts): Analytics 'all' window filesort — acknowledged in cycle 5, deferred pending EXPLAIN evidence.
10. **C9-MED-01** (data.ts): `viewCountRetryCount` collect-then-delete pattern — fixed in cycle 9 (consistency with BoundedMap).
11. **C9-MED-02** (image-queue.ts): `pruneRetryMaps` collect-then-delete pattern — fixed in cycle 9.

---

## Positive Performance Patterns (Worth Documenting)

1. **React `cache()` deduplication** (`data.ts`): 10+ data-access functions wrapped in `cache()` for SSR dedup.
2. **Connection pool budgeting** (`db/index.ts`): `POOL_CONNECTION_LIMIT = 10` with explicit backfill concurrency caps.
3. **Rate-limit bounded Maps** (`bounded-map.ts`): Generic `BoundedMap` with expiry pruning and hard-cap eviction.
4. **Image processing queue** (`image-queue.ts`): PQueue with concurrency=1, advisory locks, retry limits, and permanent-failure tracking.
5. **ETag-based cache invalidation** (`serve-upload.ts`): Pipeline version + mtime + size + settings hash in ETag.
6. **View count buffering** (`data.ts`): In-memory Map with chunked flush, exponential backoff, and retry caps.
7. **Blur data URL validation** (`blur-data-url.ts`): Producer-side validation with max length cap (4096 chars).
8. **Semantic search stub isolation** (`clip-embeddings.ts`): Stub vs production model version partitioning.
9. **Service Worker LRU cache** (`sw-cache.ts`): 50 MB cap with insertion-order recency tracking (O(n) eviction, no sort).
10. **Histogram Web Worker** (`histogram.tsx`): Off-main-thread computation with transferable ArrayBuffers.
11. **Photo viewer blur crossfade** (`photo-viewer.tsx`): CSS background-image blur placeholder with AnimatePresence fade.
12. **ImageZoom ref-based DOM manipulation** (`image-zoom.tsx`): Direct style mutation avoids React re-renders on every mousemove/touchmove.
13. **Lightbox controls auto-hide** (`lightbox.tsx`): Ref-based timer management avoids ~100 effect re-registrations per 5-min slideshow.
14. **Search debounce** (`search.tsx`): 300ms debounce with request ID cancellation for stale responses.
15. **LoadMore IntersectionObserver** (`load-more.tsx`): 200px rootMargin with ref-based callback to avoid observer recreation.
16. **Smart collection AST compiler** (`smart-collections.ts`): Depth-limited (max 4), allowlisted columns, parameterized SQL — no injection risk.
17. **Settings hash compile-time guard** (`settings-hash.ts`): `_ColorKeysAreSettingKeys` type guard catches typos at `tsc` time.
18. **CLIP model lazy singleton** (`clip-model.ts`): `getModelBundle()` loads `@huggingface/transformers` only on first real encode, not at module init.
19. **Analytics data layer** (`analytics-data.ts`): Composite index-aware queries with documented covering scan behavior.
20. **Backfill connection budgeting** (`admin-backfill-runner.ts`): `resolveBackfillConcurrency` caps at `floor((LIMIT - RESERVED - 1) / 2)` to prevent pool starvation.

---

## Recommendations

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| P1 | HIGH-1: Reuse sharp instance within format (clone for sizes) | Medium | High — reduces decode passes 18→3 |
| P2 | MED-3: Reduce FLUSH_CHUNK_SIZE or use bulk UPDATE | Low | Medium — reduces pool contention |
| P3 | MED-4: Optimize loadMore rate-limit DB round-trips | Low | Low-Medium — reduces per-scroll latency |
| P4 | MED-1: Verify prev/next index usage with EXPLAIN | Low | Medium — ensure index efficiency |
| P5 | MED-2: Document FULLTEXT upgrade path for search | Low | Low — future-proofing for large galleries |
| P6 | LOW-2: Chunk audit log purge | Low | Low — match view-retention pattern |
| P7 | LOW-5: Review poolConnection.query override necessity | Low | Low — potential minor overhead reduction |
| P8 | LOW-6: Monitor analytics 'all' window filesort | Low | Low — deferred pending EXPLAIN evidence |
| P9 | LOW-7: Monitor semantic search vector math latency | Low | Low — acceptable at current scan limit |

---

## Verdict

**COMMENT** — No new CRITICAL or HIGH-confidence HIGH findings. The codebase remains well-optimized with thoughtful caching, connection pooling, and rate-limiting. The one HIGH finding (per-size sharp re-decode) is a known architectural trade-off documented since cycle 9. New findings in this cycle are MEDIUM and LOW severity, representing optimization opportunities rather than blocking defects.

*End of review.*
