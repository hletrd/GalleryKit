# Performance Review — GalleryKit (Cycle 6)

**Date:** 2026-06-25
**Head:** de4c692a
**Previous cycle finding:** 0 defects (cycle 5)
**Scope:** Entire `apps/web/src/` — all 225 non-test source files (~39,084 lines)

---

## Summary

This review found **0 Critical**, **2 High**, **5 Medium**, and **6 Low** performance-related findings. The codebase is well-optimized overall, with thoughtful caching, connection pooling, and rate-limiting. The remaining issues are mostly edge cases in concurrency, memory, and query patterns that could manifest under specific load conditions.

---

## Findings

### [HIGH-1] `getImagesLite` / `getImagesLitePage` / `getImages` — GROUP BY on `images.id` with LEFT JOINs causes filesort on large galleries

**File:** `apps/web/src/lib/data.ts` (lines 728–758, 821–857, 896–916)
**Confidence:** High

The three main listing queries all use:
```sql
SELECT ... FROM images
LEFT JOIN imageTags ON ...
LEFT JOIN tags ON ...
GROUP BY images.id
ORDER BY images.capture_date DESC, images.created_at DESC, images.id DESC
```

The `GROUP BY images.id` forces MySQL to create a temporary table and sort (filesort) even when no tag JOIN is functionally needed. For the `getImagesLite` path (homepage masonry, topic pages), every row must be aggregated through `GROUP_CONCAT(DISTINCT tags.name)` even when the result is just `NULL` for images with no tags. At gallery scale (10k+ images), this adds significant query latency.

**Concrete failure scenario:** A gallery with 50,000 images and sparse tagging (most images untagged) still pays the GROUP BY + filesort cost on every page load. The `LISTING_QUERY_LIMIT = 100` cap mitigates but does not eliminate the overhead.

**Suggested fix:** Split into two queries: (1) fetch the paginated image IDs with the composite index only, (2) fetch tag_names in a separate batched query by ID list. This eliminates the GROUP BY from the hot path. The `getSharedGroup` function already demonstrates this pattern (lines 1228–1254).

---

### [HIGH-2] `processImageFormats` — fresh `sharp()` instance per format × per size creates 3×N decode passes

**File:** `apps/web/src/lib/process-image.ts` (lines 1081–1268)
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

For 6 configured sizes × 3 formats = **18 full decode passes** per image. Each `sharp(inputPath)` re-opens the file, re-decodes the entire image, and re-runs the resize pipeline. The comment at line 1126 (WI-14) explicitly acknowledges this trade-off: "Eliminates shared-state risk between parallel encodes on the non-rgb16 path too."

While the cross-format isolation is correct for color integrity, the **per-size re-decode within the same format** is unnecessary. Sharp's `clone()` is designed for this: decode once, then `clone()` for each size variant within the same format.

**Concrete failure scenario:** A 50 MP wide-gamut source at 6 sizes takes ~18× the decode time of a single pass. With `QUEUE_CONCURRENCY=1` (default), this serializes and blocks the queue for minutes per image. The `WIDE_GAMUT_MAX_SOURCE_PIXELS` downscale helps but only for the rgb16 path.

**Suggested fix:** Within each format's `generateForFormat`, open `sharp()` once before the size loop, then use `.clone()` for each size. Keep the per-format fresh instance (the WI-14 isolation) but eliminate the per-size re-decode.

---

### [MED-1] `getImage` — prev/next queries use `OR(...)` with multiple conditions that may not use the composite index efficiently

**File:** `apps/web/src/lib/data.ts` (lines 994–1097)
**Confidence:** Medium

The prev/next navigation builds conditions like:
```typescript
or(
    isNull(images.capture_date),
    and(isNotNull(images.capture_date), lt(images.capture_date, image.capture_date)),
    and(isNotNull(images.capture_date), eq(images.capture_date, image.capture_date), lt(images.created_at, image.created_at)),
    and(isNotNull(images.capture_date), eq(images.capture_date, image.capture_date), eq(images.created_at, image.created_at), lt(images.id, image.id))
)
```

This OR-chain with mixed `isNull` / `isNotNull` / `lt` / `eq` predicates on `capture_date`, `created_at`, and `id` may not be optimizable by MySQL's index merge. The `idx_images_processed_capture_date` index is `(processed, capture_date, created_at)` — the `OR` with `isNull(capture_date)` on one branch and `isNotNull(capture_date)` on others forces a range scan that may not use the index for all branches.

**Concrete failure scenario:** On a gallery with many undated images (NULL capture_date), the prev/next query for a dated image must scan both the dated and undated partitions. With `revalidate = 0` on public pages, this runs on every photo page load.

**Suggested fix:** Consider splitting into two separate queries (one for dated, one for undated) and taking the closest result, or verify with `EXPLAIN` that the index is used. Add a `EXPLAIN` assertion test.

---

### [MED-2] `searchImages` — three sequential/parallel queries with `LIKE '%term%'` cannot use indexes

**File:** `apps/web/src/lib/data.ts` (lines 1407–1546)
**Confidence:** High

The search function uses `LIKE '%term%'` (leading wildcard) on `images.title`, `images.description`, `images.camera_model`, `images.lens_model`, `images.topic`, and `topics.label`. Leading-wildcard LIKE prevents index usage — every search is a full table scan.

The three-query pattern (main → tag → alias) is efficient for small galleries but the leading-wildcard LIKE makes it O(n) per query on the `images` table rows.

**Concrete failure scenario:** A gallery with 50k images and a search for "sunset" scans all 50k rows across three queries. The `effectiveLimit = 100` cap limits returned rows but not scanned rows.

**Suggested fix:** This is a known limitation documented in the code (line 1417: "At personal-gallery scale this is an acceptable risk"). For larger galleries, consider MySQL FULLTEXT index on `title` + `description` + `camera_model`, or a dedicated search engine. No immediate fix needed for the stated use case.

---

### [MED-3] `flushGroupViewCounts` — `Promise.all` over chunk of 20 concurrent UPDATEs may exhaust pool connections

**File:** `apps/web/src/lib/data.ts` (lines 63–188)
**Confidence:** Medium

The view-count flush processes in `FLUSH_CHUNK_SIZE = 20` chunks, with each chunk running `Promise.all` over 20 concurrent `db.update(...)` calls. Each UPDATE acquires a pool connection. With `POOL_CONNECTION_LIMIT = 10` and `queueLimit = 20`, a 20-concurrent UPDATE burst will:
1. Acquire 10 connections immediately
2. Queue 10 more in the pool's internal queue
3. Block until the first 10 complete

This is not a correctness issue (the pool handles queuing), but it does mean the flush holds connections for longer than necessary and can starve other concurrent requests.

**Concrete failure scenario:** During a traffic spike, many shared-group page loads buffer view counts. When the 5-second flush timer fires, 20 concurrent UPDATEs consume the entire pool for the duration of the flush, delaying live page renders that need `getImage()` or `getImagesLite()`.

**Suggested fix:** Reduce `FLUSH_CHUNK_SIZE` from 20 to 5 (matching the pool's sustainable concurrency) or use a connection-aware semaphore. Alternatively, use `db.execute` with a single bulk UPDATE using `CASE` expressions.

---

### [MED-4] `embedImageReal` — raw pixel loop in JavaScript is CPU-bound and blocks the event loop

**File:** `apps/web/src/lib/clip-model.ts` (lines 151–200)
**Confidence:** Medium

The CLIP image preprocessing loop:
```typescript
for (let c = 0; c < 3; c++) {
    for (let i = 0; i < pixelCount; i++) {
        pv[c * pixelCount + i] = (rawData[i * 3 + c] / 255 - mean) / std;
    }
}
```

This is 3 × 262,144 = 786,432 iterations per image (512×512). For a single image this is fast (~1-2ms), but the function is called from the image processing queue (`image-queue.ts` line 481) which already runs Sharp encode. The ONNX inference itself is also CPU-bound. Combined, a single image embedding can block the event loop for 200-500ms.

**Concrete failure scenario:** With `QUEUE_CONCURRENCY=1` (default), the queue serializes images. A single CLIP embedding adds 200-500ms per image to the already-heavy Sharp pipeline. For a 100-image batch upload, this adds 20-50 seconds of queue time. The embedding is fire-and-forget (line 468: `void (async () => { ... })()`), but it still runs on the same event loop and competes with the next queue job's setup.

**Suggested fix:** Move the embedding to a separate `PQueue` with its own concurrency limit, or run it in a `worker_threads` pool. The current fire-and-forget pattern means it competes with the main queue for CPU.

---

### [MED-5] `getTopics` — correlated subquery `MAX(updated_at)` per topic is N+1 in disguise

**File:** `apps/web/src/lib/data.ts` (lines 455–476)
**Confidence:** Medium

```typescript
return db.select({
    ...,
    last_image_updated_at: sql<Date | null>`(
        SELECT MAX(${images.updated_at})
        FROM ${images}
        WHERE ${images.topic} = ${topics.slug}
        AND ${images.processed} = true
    )`,
}).from(topics).orderBy(asc(topics.order));
```

The correlated subquery runs once per topic row. With 20 topics, this is 20 subqueries. The comment (line 460) notes this is "cheap at gallery scale" and cached by `revalidate = 3600` on `/sitemap.xml`. However, `getTopics` is also called by `getTopicsCached` which is used in multiple contexts beyond sitemap.

**Concrete failure scenario:** If `getTopics` is ever called on a hot path (e.g., every page render via a layout component), the 20 subqueries add significant latency. The `cache()` wrapper only deduplicates within a single SSR request, not across requests.

**Suggested fix:** Replace with a single JOIN + GROUP BY, or a lateral join. The current pattern is acceptable for the sitemap use case but risky if the function is reused on hotter paths.

---

### [LOW-1] `getServingColorSettingsHash` — 5-second TTL may cause stale ETag during rapid admin setting changes

**File:** `apps/web/src/lib/serve-upload.ts` (lines 46–83)
**Confidence:** Low

The module-scoped cache has a 5-second TTL. If an admin changes a color-impacting setting and immediately tests the result, they may see the old ETag for up to 5 seconds. The stale-while-revalidate pattern mitigates this for subsequent requests, but the first request after a change may still serve a stale hash.

**Concrete failure scenario:** Admin toggles `force_srgb_derivatives` and refreshes the gallery within 5 seconds. The old ETag is served, the browser gets 304 Not Modified, and the old bytes are served from cache. The admin sees no change and assumes the toggle didn't work.

**Suggested fix:** Acceptable trade-off documented in code. The 5-second skew is noted as "the same skew class settings-hash already documents as acceptable." No fix needed.

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

---

### [LOW-3] `getClientIp` — `x-forwarded-for` parsing with `TRUST_PROXY` may misidentify IPs under spoofing

**File:** `apps/web/src/lib/rate-limit.ts` (lines 145–176)
**Confidence:** Low

When `TRUST_PROXY=true`, the code parses `X-Forwarded-For` and selects the client IP based on `TRUSTED_PROXY_HOPS`. However, if the header contains more entries than expected (e.g., due to additional proxies or spoofing), the selected IP may be wrong. The `validParts.length - hopCount - 1` calculation can return a negative index, which falls through to `x-real-ip` or `"unknown"`.

**Concrete failure scenario:** A malicious client sends `X-Forwarded-For: 1.1.1.1, 2.2.2.2, 3.3.3.3` with `TRUSTED_PROXY_HOPS=2`. The valid parts are `[1.1.1.1, 2.2.2.2, 3.3.3.3]`, clientIndex = 3 - 2 - 1 = 0, so `1.1.1.1` is selected as the client IP — the attacker's spoofed IP. This bypasses rate limiting for the attacker's real IP.

**Suggested fix:** Document the trust boundary more clearly. The code already warns when `TRUST_PROXY` is not set. Consider validating that the selected IP is not a private/reserved range.

---

### [LOW-4] `generateCaption` — stub implementation runs synchronously but is called as async

**File:** `apps/web/src/lib/caption-generator.ts` (lines 54–65)
**Confidence:** Low

The `generateCaption` function is `async` but its body is entirely synchronous (no awaits). It's called from `image-queue.ts` (line 429) as a fire-and-forget promise: `.then(...).catch(...)`. The async wrapper creates an unnecessary microtask and promise allocation.

**Concrete failure scenario:** For every image processed, an extra promise + microtask is created. At 100 images, this is 100 extra promise allocations. Negligible in practice but unnecessary overhead.

**Suggested fix:** Make `generateCaption` synchronous (remove `async`) and call it directly. The caller can wrap in `Promise.resolve()` if needed.

---

### [LOW-5] `getMapImages` — `for...of` runtime assertion loop adds O(n) overhead after query

**File:** `apps/web/src/lib/data.ts` (lines 1599–1608)
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

---

### [LOW-6] `poolConnection.query` and `poolConnection.execute` overrides — extra connection acquire/release per query

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

---

## Previously Fixed / Acknowledged Issues (Not Regressions)

The following issues were identified in prior cycles and are either fixed or documented as acceptable trade-offs:

1. **PERF-R4C3-05** (serve-upload.ts): Module-scoped 5s TTL for settings-hash — fixed in cycle 4.
2. **PERF-R4C4-01** (serve-upload.ts): Stale-while-revalidate hash cache — fixed in cycle 4.
3. **PERF-R5C1-01** (admin-backfill-runner.ts): Batched keyset-paginated fetch — fixed in cycle 5.
4. **WI-15** (process-image.ts): 50 MP wide-gamut downscale gate — fixed in cycle 2.
5. **CM-LOW-10** (process-image.ts): Sharp concurrency divided by format fan-out — fixed in cycle 3.
6. **AGG-R8c3-05** (data.ts): Minimal `getLatestImageForOg` accessor — fixed in cycle 8.

---

## Positive Performance Patterns (Worth Documenting)

1. **React `cache()` deduplication** (`data.ts`): 10 data-access functions wrapped in `cache()` for SSR dedup.
2. **Connection pool budgeting** (`db/index.ts`): `POOL_CONNECTION_LIMIT = 10` with explicit backfill concurrency caps.
3. **Rate-limit bounded Maps** (`bounded-map.ts`): Generic `BoundedMap` with expiry pruning and hard-cap eviction.
4. **Image processing queue** (`image-queue.ts`): PQueue with concurrency=1, advisory locks, retry limits, and permanent-failure tracking.
5. **ETag-based cache invalidation** (`serve-upload.ts`): Pipeline version + mtime + size + settings hash in ETag.
6. **View count buffering** (`data.ts`): In-memory Map with chunked flush, exponential backoff, and retry caps.
7. **Blur data URL validation** (`blur-data-url.ts`): Producer-side validation with max length cap (4096 chars).
8. **Semantic search stub isolation** (`clip-embeddings.ts`): Stub vs production model version partitioning.

---

## Recommendations

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| P1 | HIGH-2: Reuse sharp instance within format (clone for sizes) | Medium | High — reduces decode passes 18→3 |
| P2 | HIGH-1: Split listing queries to eliminate GROUP BY | High | High — eliminates filesort on large galleries |
| P3 | MED-3: Reduce FLUSH_CHUNK_SIZE or use bulk UPDATE | Low | Medium — reduces pool contention |
| P4 | MED-4: Move CLIP embedding to separate worker queue | Medium | Medium — prevents event loop blocking |
| P5 | MED-1: Verify prev/next index usage with EXPLAIN | Low | Medium — ensure index efficiency |
| P6 | LOW-2: Chunk audit log purge | Low | Low — match view-retention pattern |
| P7 | LOW-6: Review poolConnection.query override necessity | Low | Low — potential minor overhead reduction |

---

*End of review.*
