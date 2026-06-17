# Performance Review — Run-6 Cycle-10 (PERF-REVIEWER)

**HEAD:** 0502ae86 · branch master · 2026-06-17
**Scope:** Whole repo, performance-sensitive surface.
**Prior perf baseline:** cycle-8 (PERF-C8-01 embeddings index, PERF-C8-02 dotProduct fast-path — both landed: bbd311c5, f29cbda7). Cycle-9 perf: 0 findings.

**Verdict:** **ZERO real performance defects found.** Strong convergence after 9 prior cycles. No N+1, no missing index on a hot path, no unbounded memory growth, no render storm, no blocking sync op on a hot path, no resource leak, no user-controlled O(n²), no missing pagination cap. This cycle is a verification pass; below is what was inventoried and confirmed sound.

---

## Inventory & verification

### Data-access layer — `apps/web/src/lib/data.ts` (1663 lines)
- **All listing queries bounded.** `getImagesLite`, `getImagesLitePage`, `getImages`, `getAdminImagesLite`, `getImagesForFeed`, `getImagesForSmartCollection`, `searchImages` clamp to `LISTING_QUERY_LIMIT` (100). `getMapImages` capped at `MAP_MAX_MARKERS` (10000). `getImageIdsForSitemap` clamped to 50000.
- **`tagNamesAgg`** (line 605) — shared `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over `LEFT JOIN imageTags … tags … GROUP BY images.id`; locked by `data-tag-names-sql.test.ts`.
- **No N+1.** `getImage` runs tags+prev+next in `Promise.all` (line 1048). `getSharedGroup` batches all image tags in ONE `inArray` query (line 1229) → `Map<imageId,tags[]>`. `getImageByShareKey` collapses image+tags into one LEFT JOIN + GROUP_CONCAT.
- **Keyset pagination** (`buildCursorCondition`) order-compatible with `(capture_date DESC, created_at DESC, id DESC)`, rides `idx_images_processed_capture_date` / `idx_images_topic`.
- **View-count buffer** (lines 17-202) bounded (`MAX_VIEW_COUNT_BUFFER_SIZE` 1000, `MAX_VIEW_COUNT_RETRY_SIZE` 500), chunked flush (`FLUSH_CHUNK_SIZE` 20 vs 10-conn pool), exponential backoff, FIFO eviction.
- **React `cache()`** wraps 9 functions. `getLatestImageForOg` (line 873) is the minimal id+title OG accessor (no tag JOIN/aggregation).

### Schema indexes vs. query patterns — `apps/web/src/db/schema.ts`
Every hot path has a matching composite index: `images` `(processed,capture_date,created_at)`, `(processed,created_at)`, `(topic,processed,capture_date,created_at)`, `(user_filename)`, `(uploaded_by)`; `image_tags(tag_id)`; `image_views(bot,viewed_at,country_code)` + `(bot,viewed_at,referrer_host)`; **`image_embeddings(model_version,updated_at)`** (line 287) — exactly serves `WHERE model_version=? ORDER BY updated_at DESC LIMIT 5000`.

### Semantic / similar search vector path — **CONFIRMED BOUNDED & INDEXED**
- `app/api/search/semantic/route.ts` + `.../similar/[id]/route.ts`: cosine scan **hard-capped at `SEMANTIC_SCAN_LIMIT = 5000`** (`clip-embeddings.ts:18`), filtered by `model_version`, ordered by `updated_at DESC` — uses the composite index. Does NOT scan all embeddings unbounded; at 445 (≤5000) rows the in-memory O(n·512) dot product is sub-ms.
- **Production uses `dotProduct`** (vectors L2-normalized via `truncateAndNormalize`), skipping per-row norm+sqrt (AGG-C8-09). Stub mode retains `cosineSimilarity` (un-normalized) — correct.
- Both routes: 30/min/IP rate-limit (Pattern-2 rollback), same-origin gate, 8 KB body cap, production-only gate on similar. `topK` = filter→sort→slice over ≤5000, fine.

### Sharp pipeline — `apps/web/src/lib/process-image.ts` (1650 lines)
- Parallel AVIF/WebP/JPEG (`Promise.all`); per-format fresh `sharp(inputPath)` reads via mmap (no heap pin) — deliberate WI-14 contamination fix.
- **Same-resize-width variant dedup hard-links** (zero-copy, line 1090-1099) instead of re-encoding.
- Wide-gamut >50 MP downscale gate (`WIDE_GAMUT_MAX_SOURCE_PIXELS`, line 1004); fan-out capped at 8 sizes; `clone()` only for the 16px blur; `limitInputPixels` on every constructor. 10-bit AVIF on Promise-singleton libheif probe with per-image 8-bit fallback.

### Image queue — `apps/web/src/lib/image-queue.ts` (786 lines)
- `PQueue` concurrency 1 (tunable). **Cursor-paginated bootstrap** (`BOOTSTRAP_BATCH_SIZE` 500, `bootstrapCursorId`) — no unbounded backlog; continuation on `onIdle`.
- All retry Maps bounded (`MAX_RETRY_MAP_SIZE` 10000, `MAX_PERMANENTLY_FAILED_IDS` 1000) FIFO + associated-map cleanup. GC timer armed **once** (`!state.gcInterval`, AGG-M12). Caption/embedding hooks fire-and-forget — never block the job.

### Service worker LRU — `apps/web/src/lib/sw-cache.ts`
- `recordAndEvict` = delete-then-set insertion-order recency + **head-walk eviction (O(n))** (AGG-H3, 7119345a) — eliminated prior per-write O(n log n) sort. 50 MB cap. Single O(n) total-sum is inherent to whole-blob metadata model (documented out-of-scope).

### Front-end render behavior
- **`home-client.tsx` masonry**: pure CSS columns, NO JS layout/reorder loop. RAF-debounced resize, passive scroll listener with redundant-setState guard, all derived values memoized, above-fold priority mirrored to breakpoints. *(Doc nit only: CLAUDE.md still says masonry uses "useMemo for reorder" — the reorder is gone, now CSS columns. Cosmetic, not a defect.)*
- **`histogram.tsx`**: worker created **once** (`[]` deps, 526) + `terminate()` on unmount; decode effect AbortController + nulls handlers on cleanup; canvas 256×256.
- **`photo-viewer.tsx`**: every effect returns listener/timer cleanup; srcset in `useMemo`.
- **`similar-photos.tsx`**: lazy — fetch only on first toggle-open (`fetchedRef`), bounded results, renders null in non-production mode.
- **`load-more.tsx`**: `IntersectionObserver` disconnected on unmount (129); `queryVersionRef` stale-response guard checked before+after await; `mountedRef`+`loadingRef` guards.

### Analytics — `apps/web/src/lib/analytics-data.ts`
All 5 queries admin-only, LIMIT-bounded (20/30), use `(bot,viewed_at,*)` composite indexes. Windowed = covering range scan; 'all' = covering-index temp-table aggregation **bounded by 395-day view-event retention** (`purgeOldViewEvents`). 'all'-case index-reorder explicitly deferred pending EXPLAIN evidence (plan-322 entry 3) — correct. `data-timeline.ts`: 3 queries all LIMIT-bounded. `embeddings.ts` backfill action: `notExists` on indexed `(imageId,modelVersion)`, capped at `SEMANTIC_SCAN_LIMIT`.

---

## Items NOT re-reported (closed cycles 1-9, verified still in place)
SW O(n log n)→head-walk (7119345a) · map markers 10k LIMIT (3b69c877) · dotProduct + embeddings index (f29cbda7, bbd311c5) · OG minimal id+title query (e9040d17) · WebP ICC first-1KB read (2784d244) · queue GC timer armed once (d979c4ca) · getImage dead `sql FALSE` branches removed (C6-AGG6R-01).

## Conclusion
No actionable performance findings. The perf surface is mature and over-reviewed; speculative micro-optimizations would add risk without measurable benefit. The single cosmetic doc drift (masonry "reorder" wording in CLAUDE.md) is noted for whoever next edits that doc but is not a perf defect and does not warrant a standalone fix task.
