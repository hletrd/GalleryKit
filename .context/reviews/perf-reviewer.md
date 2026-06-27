# PERF-REVIEWER — Cycle 17 / HEAD 7b5c1943

**Date:** 2026-06-27
**Scope:** Performance + Concurrency — DB query efficiency, connection-pool pressure,
Sharp/libvips CPU, React render performance, in-memory data structures, blocking hot paths.
**Baseline:** 16 prior cycles; gates green at HEAD. This pass is additive — no regressions found.

---

## Confirmed Fixed (Cycle 16 Carry-overs)

### CF-01 — PERF-16-01: `getGalleryConfig()` hoisting in image-queue (VERIFIED CORRECT)
**File:** `apps/web/src/lib/image-queue.ts:384–518`

The bootstrap/legacy path (`if (!quality && !imageSizes)`) reads `getGalleryConfig()` exactly
once at line ~395 and stores `config.semanticSearchMode` into `resolvedSemanticMode`. The
embedding IIFE at lines 506–518 reads `let semanticMode = resolvedSemanticMode ?? 'disabled'`
and only falls back to its own `getGalleryConfig()` call when `resolvedSemanticMode === null`
(i.e., normal upload jobs where the outer path did not set it). Result:

- Bootstrap batch (500 images): **1 config `SELECT`** shared across all images in the batch.
- Normal upload job: **1 config `SELECT`** in the embedding IIFE per job (unchanged from
  pre-fix, since these never go through the bootstrap gate).

No double-read regression. Caption IIFE does not call `getGalleryConfig()` at all — resolved
before the IIFE.

### CF-02 — CR-16-01: Upload tracker TOCTOU (VERIFIED CORRECT)
**File:** `apps/web/src/app/actions/images.ts:184–228`

The fix closes two races correctly:

1. **First-insert race (cold key):** Tracker entry is created and `set()` into the Map at
   lines 191–194 _before_ any quota check. Concurrent requests sharing the same key now
   mutate the same object reference rather than racing into two separate literal objects.
2. **Check-then-claim race:** All quota checks (lines 205–222) are synchronous with no
   `await` between them and the claim (lines 226–228). The claim (`tracker.bytes +=`,
   `tracker.count +=`) lands before the first `await` (disk space check at line 234).
   On rollback (disk shortage, topic not found, later failures) `settleUploadTrackerClaim`
   reverses the claim correctly at all three early-exit points.

The advisory lock `gallerykit_upload_processing_contract` guards the `imageSizes`/
`strip_gps_on_upload` contract, not per-upload concurrency; the TOCTOU fix addresses the
latter correctly at the in-process Map level.

### CF-03 — `image_embeddings` scan index (VERIFIED PRESENT)
**File:** `apps/web/src/db/schema.ts:285`

`idx_image_embeddings_model_version_updated` on `(modelVersion, updatedAt)` correctly covers
`WHERE model_version = ? ORDER BY updated_at DESC LIMIT 2000` used by the semantic search
scan. Added in migration 0022 (AGG-C8-03). No gap.

---

## New Findings

### PERF-17-01 — HIGH: `getAdminImagesLite` orders by `updated_at` with no supporting index
**File:** `apps/web/src/lib/data.ts:840`

```
.orderBy(desc(images.updated_at), desc(images.created_at), desc(images.id))
```

This is the only masonry-list query that orders by `updated_at` rather than `capture_date`.
The existing composite indexes are:

- `idx_images_processed_capture_date` — `(processed, capture_date, created_at)`
- `idx_images_processed_created_at` — `(processed, created_at)`

Neither covers `updated_at`. Even when the `WHERE processed = true/false` predicate uses one
of these indexes for filtering, MySQL must then filesort the full qualifying result set on
`updated_at DESC`. For an admin with 1 000 processed images this is a full in-memory sort
over all images.

The four public-facing masonry queries (`getImagesLite`, `getImagesLitePage`, `getImages`,
`getImagesForSmartCollection`) all order by `(capture_date DESC, created_at DESC, id DESC)`
and use `idx_images_processed_capture_date` for predicate pushdown. The admin query
silently misses all index coverage for its sort step.

**Impact:** Admin image listing latency grows linearly with total image count.

**Fix candidate:**
```sql
-- apps/web/drizzle/00NN_add_admin_updated_at_index.sql
ALTER TABLE images ADD INDEX idx_images_processed_updated_at
  (processed, updated_at, created_at, id);
```
Add to `schema.ts` and a new migration file. Note: with `GROUP BY images.id` (PERF-17-02)
still present, this index cannot eliminate the filesort entirely, but it narrows the
filtered row set before grouping and may allow MySQL to use it for the filesort over grouped
rows in some optimizer paths. Even partial coverage reduces the scan cost.

---

### PERF-17-02 — HIGH: `GROUP BY images.id` + `ORDER BY capture_date` forces filesort on all masonry queries
**File:** `apps/web/src/lib/data.ts:773–963` (all five listing functions)

Every masonry listing query shares this structure:
```sql
SELECT images.*, GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name) AS tag_names
FROM images
LEFT JOIN imageTags ON images.id = imageTags.imageId
LEFT JOIN tags      ON imageTags.tagId = tags.id
GROUP BY images.id
ORDER BY images.capture_date DESC, images.created_at DESC, images.id DESC
LIMIT n
```

MySQL 8 cannot use `idx_images_processed_capture_date` to satisfy the ORDER BY when the
query also has `GROUP BY images.id`. The optimizer uses the index for predicate access but
must then materialize all qualifying grouped rows and filesort them on
`(capture_date DESC, created_at DESC, id DESC)`.

For a gallery of 500 photos with average tag coverage of 2 tags each:
- ~1 000 rows scanned across the JOIN (500 images × 2 tag rows)
- 500 groups formed
- Filesort over 500 rows

The cursor-based keyset path in `getImagesLite` (line 773) minimizes the sort set to the
window following the cursor, so cursor pages are cheaper. But the first page, all offset
pages (`getImagesLitePage`), and smart-collection queries always sort the full qualifying set.

**Root cause:** `GROUP_CONCAT` requires `GROUP BY images.id`, which breaks the sort-index
elimination that the existing `(processed, capture_date, created_at)` index would otherwise
provide on an ungrouped query.

**Options:**
1. **Subquery / derived table pattern** — run `SELECT id FROM images WHERE … ORDER BY
   capture_date DESC, created_at DESC, id DESC LIMIT n` on the index alone, then JOIN
   tags to that small result set. Eliminates the filesort; requires query restructuring
   at all five call sites.
2. **Accept current design** — at typical gallery scale (hundreds to low thousands of
   images), the filesort over 30-500 rows is sub-millisecond and not user-visible. Add
   an explicit comment in `data.ts` documenting that the accepted pattern trades sort-index
   elimination for aggregation simplicity. Revisit with `EXPLAIN ANALYZE` if gallery exceeds
   ~5 000 images.

Given the cursor-pagination mitigation in `getImagesLite`, option 2 is defensible now.
Option 1 is the correct long-term fix for large galleries.

---

### PERF-17-03 — MEDIUM: `COUNT(*) OVER()` materializes full qualifying result set on every paginated request
**File:** `apps/web/src/lib/data.ts:882, 1408`

Both `getImagesLitePage` (admin tag-filter search) and `getImagesForSmartCollection`
(public smart collections) include:
```js
total_count: sql<number>`COUNT(*) OVER()`
```
alongside `GROUP BY images.id`. MySQL evaluates this window function after the grouping
step — it counts grouped rows (photos, not tag-fanout rows — correct). However, the window
function requires the engine to materialize ALL qualifying grouped rows before any row with
the correct count can be emitted. `LIMIT` and `OFFSET` apply after materialization.

For a gallery with 500 photos, every first-page request:
1. Scans ~500 × avg_tags rows through the LEFT JOINs
2. Groups all 500 rows by `images.id`
3. Counts all 500 grouped rows via the window function
4. Filesorts the 500-row set by `(capture_date DESC, …)`
5. Returns page slice of 31

All 500 rows are fully processed to return 31.

**Note:** The comment at line 1394 explicitly documents that forking the select shape to
omit `COUNT(*) OVER()` on cursor pages was evaluated and rejected (perf/architect,
run4-cycle5). This finding is informational — the design is accepted. At current gallery
scale this is not a user-visible bottleneck. Flag for revisit if admin performance degrades
past ~2 000 images or if smart collections with complex predicates become common.

---

### PERF-17-04 — MEDIUM: Normal upload path pays 1 `SELECT admin_settings` per image due to React.cache() scope
**File:** `apps/web/src/lib/gallery-config.ts:217`, `apps/web/src/lib/image-queue.ts:506–518`

```js
export const getGalleryConfig = cache(_getGalleryConfig);
```

React's `cache()` deduplicates within a single React server rendering request. It provides
no cross-call deduplication outside SSR context. In the image processing queue (background
Node.js, no active SSR request), each call to `getGalleryConfig()` is a fresh
`SELECT … FROM admin_settings` query.

- Bootstrap path: fixed by PERF-16-01 — 1 read per batch (CF-01).
- **Normal upload path:** `resolvedSemanticMode` is `null` (not set by the bootstrap gate),
  so the embedding IIFE calls `getGalleryConfig()` for **each queued upload job** individually.
  This is 1 `SELECT admin_settings` per uploaded image.

For a 50-photo batch upload, this triggers 50 consecutive `SELECT admin_settings` queries
on the 10-connection pool, even though the admin settings are unchanged between images.

**Fix candidate:** Snapshot `semanticSearchMode` (and `autoAltTextEnabled` — already
resolved before the IIFE but via a similar per-job read path) into `ImageProcessingJob`
at enqueue time alongside the existing config snapshot fields (`imageQualityWebp`,
`imageQualityAvif`, `imageQualityJpeg`, `imageSizes`, etc.). The job already carries all
other processing-relevant settings as a snapshot; extending this to include
`semanticSearchMode` and `autoAltTextEnabled` would eliminate all per-image config reads
on the normal upload path. This matches the established config-snapshot design intent.

**Impact:** Low at default queue concurrency (1). Measurable but not blocking on 50-photo
batches. Worth fixing for correctness of the snapshot model.

---

### PERF-17-05 — MEDIUM: Resize handler schedules new RAF without cancelling previous one
**File:** `apps/web/src/components/home-client.tsx:53–62`

```js
const handleResize = () => {
    rafId = requestAnimationFrame(() => { … set state … });
};
window.addEventListener('resize', handleResize);
```

Each `resize` event schedules a new `requestAnimationFrame`. On rapid window resizing
(dragging the browser edge), multiple RAFs accumulate. The previous `rafId` is overwritten
by assignment but the previous callback is not cancelled, so stale callbacks execute and
trigger redundant `setState` calls.

**Fix:**
```js
const handleResize = () => {
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { … set state … });
};
```

Standard debounce-via-RAF pattern. At current scale each RAF body is cheap and the setState
calls are idempotent, so this is medium rather than high severity.

---

### PERF-17-06 — LOW: Scroll-restore chains 3 RAF frames without timeout fallback
**File:** `apps/web/src/components/home-client.tsx:159–160`

```js
const r1 = requestAnimationFrame(restore);
const r2 = requestAnimationFrame(() => requestAnimationFrame(restore));
```

This queues `restore` at frame +1 and frame +3 to allow layout stabilization after
hydration. Both handles are cancelled on cleanup. No issues with the pattern itself, but:

- If the page is in background (tab hidden), `requestAnimationFrame` does not fire and
  scroll restore silently never executes.
- No timeout fallback: if layout is still unstable after 3 frames (e.g., slow rendering
  of many images), the first call may land on an incorrect position.

This is an accepted trade-off for SSR+hydration scroll restoration without a
layout-complete signal. Add a `setTimeout` fallback (e.g., 200 ms) if users report
missed scroll restoration on slow connections.

---

### PERF-17-07 — LOW: Semantic scan fetches ~4 MB per query; main-thread cosine loop is bounded at current scale
**File:** `apps/web/src/app/api/search/semantic/route.ts:251–281`

The scan fetches up to 2 000 rows × 2 048 bytes = ~4 MB of MEDIUMBLOB data per query.
The similarity loop performs 2 000 × 512 = 1 024 000 floating-point multiplications
synchronously on the Node.js main thread.

At current production scale (~445 embeddings): ~0.9 MB per query, ~229 K FP ops — trivial.
The `idx_image_embeddings_model_version_updated` index (CF-03) ensures no table scan.
The per-IP rate limit (30 req/min) bounds worst-case throughput.

**Flag for revisit** if embedding corpus exceeds ~10 000 rows, at which point the 4 MB
fetch + 5 M FP multiplications at 30 RPM becomes material event-loop jank. Options at
that scale: offload computation to `node:worker_threads`, reduce `SEMANTIC_SCAN_LIMIT`,
or adopt an ANN (approximate nearest-neighbor) index.

---

## Verified Correct (No Issues)

### useDisplayCapability snapshot memoization
**File:** `apps/web/src/lib/use-display-capability.ts:47–84`

Module-level `_cachedSnapshot` is returned unchanged when both `colorGamut` and `isHdr`
match the cached object (value comparison at lines 76–84). New object allocated only on
actual value change. `getServerSnapshot()` returns the stable `SERVER_DEFAULT` constant.
This correctly prevents the React #185 `useSyncExternalStore` infinite re-render loop.
**No issue.**

### Histogram worker offload
**File:** `apps/web/src/components/histogram.tsx`

Pixel extraction happens on the main thread (Canvas 2D — unavoidable), but `ImageData`
is transferred to the Web Worker as a `Transferable` at line 165, avoiding a buffer copy.
The O(n-pixels) histogram computation runs off the main thread. Recomputes on resize are
bounded to a 256-px canvas. Pattern is sound. **No issue.**

### Bounded in-memory Maps
**File:** `apps/web/src/lib/image-queue.ts`

- `permanentlyFailedIds`: capped at `MAX_PERMANENTLY_FAILED_IDS = 1 000`, FIFO eviction.
- `retryCounts`, `claimRetryCounts`, `lastErrors`: capped at `MAX_RETRY_MAP_SIZE = 10 000`,
  FIFO eviction.
- Bootstrap: `BOOTSTRAP_BATCH_SIZE = 500`, cursor-paginated on `images.id`.
- View-count buffer: `MAX_VIEW_COUNT_BUFFER_SIZE = 1 000`, chunked flush at 5, exponential
  backoff, `MAX_VIEW_COUNT_RETRY_SIZE = 500`.

All bounds correct. **No issue.**

---

## Summary

| ID | Severity | File | Issue |
|----|----------|------|-------|
| PERF-17-01 | HIGH | `data.ts:840` | `getAdminImagesLite` orders by `updated_at`; no index covers it — filesort over all images |
| PERF-17-02 | HIGH | `data.ts:773–963` | `GROUP BY images.id` + `ORDER BY capture_date` forces filesort on all masonry queries |
| PERF-17-03 | MEDIUM | `data.ts:882, 1408` | `COUNT(*) OVER()` materializes full qualifying set on every paginated page request |
| PERF-17-04 | MEDIUM | `gallery-config.ts:217`, `image-queue.ts:506` | `React.cache()` is request-scoped; normal upload jobs each pay 1 `SELECT admin_settings` |
| PERF-17-05 | MEDIUM | `home-client.tsx:53` | Resize RAF not cancelled before rescheduling; stale callbacks accumulate |
| PERF-17-06 | LOW | `home-client.tsx:159` | 3-RAF scroll restore chain has no timeout fallback for background tabs |
| PERF-17-07 | LOW | `semantic/route.ts:251` | ~4 MB MEDIUMBLOB scan + 1 M FP multiplications per query on main thread (acceptable at ≤445 embeddings; flag at 10 k+) |
| CF-01 | FIXED | `image-queue.ts:384–518` | PERF-16-01 `getGalleryConfig()` hoisting for bootstrap — verified correct |
| CF-02 | FIXED | `actions/images.ts:184–228` | CR-16-01 upload tracker TOCTOU — verified correct |
| CF-03 | FIXED | `schema.ts:285` | `image_embeddings (model_version, updatedAt)` index — verified present |

**Counts: 2 HIGH, 3 MEDIUM, 2 LOW. No regressions from prior cycles.**

---

## Top Actionable Items

1. **PERF-17-01** (`data.ts:840`) — Add `idx_images_processed_updated_at(processed, updated_at, created_at, id)` to `schema.ts` and a new migration file. One index, one migration, covers the admin listing sort path.

2. **PERF-17-04** (`image-queue.ts:506`) — Snapshot `semanticSearchMode` (and `autoAltTextEnabled`) into `ImageProcessingJob` at enqueue time, alongside existing config fields. Eliminates 1 `SELECT admin_settings` per normal upload job. Consistent with the established snapshot-at-enqueue design.

3. **PERF-17-05** (`home-client.tsx:53`) — Add `cancelAnimationFrame(rafId)` before rescheduling in the resize handler. One-line fix.

4. **PERF-17-02** (`data.ts:773–963`) — Add an explicit comment documenting the accepted filesort trade-off from the `GROUP BY images.id` + `ORDER BY capture_date` pattern. No functional change needed at current scale; plan a subquery refactor if gallery exceeds ~5 000 images.
