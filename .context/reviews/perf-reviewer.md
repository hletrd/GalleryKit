# Performance Review — Cycle 11 (perf-reviewer)

**Reviewer:** perf-reviewer
**HEAD:** bb463062 (master, as of 2026-06-13)
**Scope:** Whole-repo performance audit — DB queries, image pipeline, CLIP scan, SW cache, React components
**Verdict: APPROVE — ZERO real performance defects found. The codebase has converged.**

---

## Summary

After a full audit of all performance-sensitive surfaces, no real performance defects were found. All findings from cycles 1–10 have been resolved; there is nothing remaining that a senior engineer would commit to fixing.

---

## What Was Verified

### 1. CLIP Semantic Scan (hard-cap + index — primary directive)

- `SEMANTIC_SCAN_LIMIT = 5000` confirmed at `clip-embeddings.ts:18`.
- Scan query in `api/search/semantic/route.ts` and `api/search/similar/[id]/route.ts`:
  ```sql
  SELECT ... FROM image_embeddings
  WHERE modelVersion = ?
  ORDER BY updatedAt DESC
  LIMIT 5000
  ```
- Index `idx_image_embeddings_model_version_updated (model_version, updated_at)` confirmed in `schema.ts`. This composite index fully covers the `WHERE + ORDER BY` shape — MySQL uses the index range scan on `model_version = ?` and then traverses the `updated_at` B-tree in descending order with no filesort. Verified, not assumed from comments.
- `dotProduct()` is O(512) per row. 5000 rows × 512 dimensions = 2.56 M FP multiplications — trivial (~1 ms in practice).
- `topK()` runs filter → `Array.sort` → slice on ≤5000 scored elements; O(n log n) on ≤5000, no issue.
- Enrichment query on top-K result IDs: bounded by `SEMANTIC_TOP_K_MAX = 50`, fetched via single `inArray` + `leftJoin(topics)`. Not a scan.

### 2. `data.ts` — All Listing Queries

- All listing queries bounded by `LISTING_QUERY_LIMIT = 100`.
- All tag fetches use batched `inArray` or `tagNamesAgg` GROUP_CONCAT — no N+1 patterns.
- `getImage()` uses `Promise.all` for tags + prev + next (3 parallel queries).
- `getSharedGroup()` uses a single batch tag fetch.
- `getMapImages()` bounded by `MAP_MAX_MARKERS = 10000` with index on `(map_visible, latitude, longitude)`.
- `getImageIdsForSitemap()` capped at 50000.
- `searchImages()` short-circuits when main query fills the limit (no over-fetch).
- All hot paths wrapped in `cache()` for SSR deduplication.

### 3. Image Processing Queue (`image-queue.ts`)

- PQueue concurrency: 1 (env `QUEUE_CONCURRENCY` override available).
- Bootstrap: keyset-paginated (BOOTSTRAP_BATCH_SIZE = 500), cursor-based. No table scans.
- Retry Maps and permanently-failed IDs Maps are bounded (MAX_RETRY_MAP_SIZE = 10000; MAX_PERMANENTLY_FAILED_IDS = 1000).
- Hourly GC interval: armed exactly once, guarded by `!state.gcInterval`.
- `notInArray` exclude-list: at most 1000 IDs in the IN() clause — within MySQL optimizer limits.

### 4. Admin Backfill Runner (`admin-backfill-runner.ts`)

- Keyset-paginated batch fetch (BATCH_SIZE = 100) with `id > cursor ORDER BY id ASC`. No full-table re-scans.
- Query shape: `WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < N) AND id > cursor`. No composite index on `(processed, pipeline_version, id)` — this is an infrequent admin-only operation; filesort at personal-gallery scale (< 100k rows) is not a defect.
- Connection pool budget capping: at pool limit 10, workers capped at max 2. No pool exhaustion risk.
- Per-image advisory lock with 0-second (non-blocking) timeout.

### 5. Service Worker LRU Cache (`public/sw.js` + `sw-cache.ts`)

- LRU: delete-then-set insertion-order recency. O(n) total-size recomputation per call is an accepted trade-off (whole-blob JSON storage; noted in code comments). Not a new defect.
- O(n log n) sort removed in prior cycles — confirmed absent.
- 50 MB cap enforced. HEAD ETag probe: 300 ms timeout.
- HTML offline cache: 24 h TTL, 50-entry cap.

### 6. View Count Buffer

- Bounded Maps with FIFO eviction. Exponential backoff on DB flush failures. Null-timer fix confirmed.

### 7. React Masonry Grid

- Pure CSS columns layout (not `useMemo` for reorder). The CLAUDE.md reference to "useMemo for reorder" is a documentation artifact from before the CSS rewrite; it is not a live code issue. No React re-render storms found.

### 8. Schema Indexes

All query-critical indexes confirmed present:
| Index | Columns |
|-------|---------|
| `idx_images_processed_capture_date` | (processed, capture_date, created_at) |
| `idx_images_processed_created_at` | (processed, created_at) |
| `idx_images_topic` | (topic, processed, capture_date, created_at) |
| `idx_image_embeddings_model_version_updated` | (model_version, updated_at) |
| `idx_image_tags_tag_id` | (tag_id) |
| `idx_images_uploaded_by` | (uploaded_by) |

---

## Issues Found

**None.**

---

## Recommendation

**APPROVE.** No CRITICAL, HIGH, MEDIUM, or LOW performance issues detected. The codebase has genuinely converged on the performance axis as of cycle 11.
