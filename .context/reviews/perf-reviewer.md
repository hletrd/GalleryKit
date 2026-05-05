# Performance Review — Cycle 21

## Review Scope
Service worker cache efficiency, React cache() deduplication, semantic search CPU profile, image processing pipeline concurrency, DB query patterns, and memory usage.

## Findings

### C21-PERF-01: Service Worker HTML Cache Has No Size Limit or Eviction
**File**: `apps/web/src/public/sw.js` (lines 18, 143-178)
**Severity**: Low
**Confidence**: High

The `HTML_CACHE` stores every HTML page the user visits. Unlike `IMAGE_CACHE` which has a 50MB LRU eviction policy, the HTML cache has NO size limit and NO eviction.

**Impact**: A user browsing a large gallery could accumulate hundreds of HTML responses in cache storage, potentially hitting browser storage limits and evicting more valuable image caches.
**Fix**: Add LRU eviction policy to HTML_CACHE with a conservative cap (e.g., 5MB or 50 entries).

---

### C21-PERF-02: Bootstrap Cleanup Tasks Run Repeatedly
**File**: `apps/web/src/lib/image-queue.ts` (lines 576-592)
**Severity**: Low
**Confidence**: Medium

`bootstrapImageProcessingQueue` runs `cleanOrphanedTmpFiles`, `purgeExpiredSessions`, `purgeOldBuckets`, and `purgeOldAuditLog` on every bootstrap call. Bootstrap is triggered on startup, after failed jobs, and after queue drains. These cleanup tasks are idempotent but wasteful. `purgeExpiredSessions` and `purgeOldAuditLog` can be expensive on large tables.

**Impact**: Unnecessary DB and filesystem pressure, especially during recovery from transient failures.
**Fix**: Track whether cleanup has run in the current process and skip redundant invocations, or move cleanup exclusively to the hourly GC interval.

---

### C21-PERF-03: Semantic Search Scans Up to 5000 Embeddings with No Early Exit
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 150-160)
**Severity**: Low
**Confidence**: Medium

The semantic search endpoint ALWAYS scans `SEMANTIC_SCAN_LIMIT` (5000) most-recent embeddings, even when the query is very short or the topK is small. With a stub encoder, this is fast (SHA-256 + cosine similarity), but with a real ONNX model, 5000 x 512-dim cosine similarities would be expensive.

**Impact**: Fixed overhead per semantic search query regardless of actual need.
**Fix**: Consider adaptive scan limits or index-based approximate nearest neighbor search when transitioning to real embeddings.

---

### C21-PERF-04: `recordAndEvict` Sorts Entire Metadata Array on Every Image Cache Update
**File**: `apps/web/src/public/sw.js:79-106`
**Severity**: Low
**Confidence**: Medium

Every time a new image is cached, `recordAndEvict` sorts ALL metadata entries by timestamp. For a gallery with hundreds of images viewed in a session, this is O(n log n) on every single image fetch.

**Impact**: At personal-gallery scale this is imperceptible (~1-2ms per sort). Not worth fixing unless scaling beyond this range.
**Fix**: Use a more efficient data structure (e.g., min-heap) or batch eviction.

---

## Verified Prior Fixes
- C18-PERF-01 (SW cache key mismatch): FIXED.
- C19-PERF-01 (SW recordAndEvict sort): Still present, informational only.
- Image processing concurrency is appropriately capped.
- `sharp.cache(false)` prevents libvips buffer accumulation.
- `React.cache()` deduplicates SSR queries.
