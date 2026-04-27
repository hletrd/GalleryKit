# Perf Reviewer — Cycle 1 Fresh Review (2026-04-27)

## Inventory

Full codebase review from performance perspective. Key files:
- `lib/data.ts` — query patterns, pagination, GROUP_CONCAT
- `lib/process-image.ts` — Sharp pipeline, concurrency, ICC parsing
- `lib/image-queue.ts` — PQueue, bootstrap, claim locking
- `lib/rate-limit.ts` — in-memory Maps, DB-backed buckets
- `lib/upload-tracker-state.ts` — in-memory upload tracking
- `lib/auth-rate-limit.ts` — login/password rate limiting
- `app/actions/images.ts` — upload flow, file I/O
- `app/actions/public.ts` — load-more, search rate limiting
- `components/photo-viewer.tsx` — memoization, blur style
- `lib/blur-data-url.ts` — validation overhead

---

## Findings

### C1-PR-01: `searchImages` runs 3 sequential DB queries when results are insufficient
**File:** `apps/web/src/lib/data.ts:793-880`
**Severity:** Medium | **Confidence:** High

The `searchImages` function runs up to 3 sequential DB queries:
1. Main LIKE search on title/description/camera_model/topic/label
2. Tag LIKE search (only if main results < effectiveLimit)
3. Alias LIKE search (only if combined results < effectiveLimit)

Each query is a separate DB round-trip. The short-circuit at line 811 (`results.length >= effectiveLimit`) helps on popular search terms, but unpopular terms trigger all 3 sequential queries. For a search with 0 main results, this is 3 sequential round-trips.

**Fix:** Consider running queries 2 and 3 in parallel when both are needed (i.e., when main results are 0). Alternatively, use a single UNION query. The short-circuit optimization already covers the common case.

---

### C1-PR-02: `getAdminImagesLite` does not use pagination — fetches all admin rows
**File:** `apps/web/src/lib/data.ts:466-488`
**Severity:** Low | **Confidence:** High

`getAdminImagesLite` defaults to `limit: 100, offset: 0` but the admin dashboard may need to browse beyond 100 images. The function accepts limit/offset parameters but the dashboard may load all images via repeated calls. The `getImagesLite` public counterpart also defaults to 101 limit. These are reasonable defaults but the admin view has no cursor-based pagination, relying on offset which degrades at high offsets.

**Fix:** For personal-gallery scale (a few thousand images), this is acceptable. If the gallery grows, consider cursor-based pagination using `(capture_date, created_at, id)` as a composite cursor.

---

### C1-PR-03: `photo-viewer.tsx` — blur style memoization is correct but `image?.blur_data_url` dependency
**File:** `apps/web/src/components/photo-viewer.tsx:103-112`
**Severity:** Low | **Confidence:** Low (not a real issue)

The `blurStyle` memo depends on `image?.blur_data_url`. When the image changes during navigation, the memo recalculates. This is correct and the memoization prevents unnecessary style recalculation on unrelated re-renders. No issue found.

**Status:** Not a real issue — memoization is correctly implemented.

---

### C1-PR-04: `bootstrapImageProcessingQueue` scans up to 500 pending images without batching DB insert
**File:** `apps/web/src/lib/image-queue.ts:382-459`
**Severity:** Low | **Confidence:** Medium

The bootstrap function fetches up to `BOOTSTRAP_BATCH_SIZE = 500` pending images in a single query, then enqueues each one individually via `enqueueImageProcessing`. Each enqueue adds to the PQueue. If there are 500 pending images, this creates 500 queue entries synchronously. The PQueue handles this via its concurrency limit (2 by default), so at most 2 run concurrently. However, the queue `add()` calls happen synchronously in a tight loop, which could block the event loop for very large pending sets.

**Fix:** For personal-gallery scale this is acceptable. If the gallery grows, consider yielding between queue adds (e.g., processing in chunks with `await` points).

---

### C1-PR-05: `viewCountBuffer` flush creates a copy of the entire Map before processing
**File:** `apps/web/src/lib/data.ts:48-53`
**Severity:** Low | **Confidence:** High

```ts
const batch = new Map(viewCountBuffer);
viewCountBuffer.clear();
```

`flushGroupViewCounts` creates a copy of the entire buffer map and clears the original. With `MAX_VIEW_COUNT_BUFFER_SIZE = 1000`, this creates a second Map of up to 1000 entries. This is an intentional design choice to allow concurrent increments to continue writing to the (now-empty) original buffer while the flush processes the snapshot. The memory overhead is bounded at ~1000 entries * (number key + number value) = ~16 KB, which is negligible.

**Status:** Not a real issue — the buffer-and-swap pattern is correct and bounded.

---

### C1-PR-06: `processImageFormats` creates 3 parallel Sharp pipelines that each iterate over sizes
**File:** `apps/web/src/lib/process-image.ts:398-461`
**Severity:** Low | **Confidence:** Medium

`generateForFormat` iterates over sorted sizes sequentially within each format. The three formats (webp, avif, jpeg) run in parallel via `Promise.all`. Each format creates its own `sharp(inputPath)` instance with `clone()` per size. For a default of 4 sizes and 3 formats, this is 12 Sharp operations, but only 3 run truly in parallel (one per format), with sizes processed sequentially within each format. The `copyFile` optimization for duplicate sizes avoids redundant encoding. This is well-designed.

**Status:** Not a real issue — parallelism is correctly scoped.

---

### C1-PR-07: ICC profile parsing iterates up to 100 tags in a hot path
**File:** `apps/web/src/lib/process-image.ts:308-351`
**Severity:** Low | **Confidence:** High

The ICC parsing loop caps at `tagCount = Math.min(icc.readUInt32BE(128), 100)` and breaks early when the `desc` tag is found. In practice, the `desc` tag is usually among the first few entries. The 100-cap is a safety bound, not the typical path. The parsing is synchronous but runs once per upload during the Sharp pipeline, so the latency is negligible compared to the actual image conversion.

**Status:** Not a real issue — the cap is appropriate and the early break is correct.
