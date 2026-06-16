# Performance & Concurrency Review — GalleryKit (Cycle 2)

**Reviewer:** performance-reviewer specialist
**Commit:** 8ccc8806
**Date:** 2026-06-16
**Scope:** CPU hotspots, memory growth, unbounded structures, N+1, index effectiveness, event-loop blocking, Sharp buffers, concurrency hazards, UI responsiveness, caching correctness, pool/queue backpressure.
**Method:** Read core hot-path files directly (process-image.ts, image-queue.ts, rate-limit.ts, sw-cache.ts, sw.template.js, home-client.tsx, similar route, auth.ts); fan-out Explore agents over data.ts/schema.ts, all server actions + API routes, and all React components; cross-checked every flagged finding against source.

This is a **mature, heavily-optimized codebase**. Bounded Maps with eviction, advisory locks, fire-and-forget hooks, rAF-debounced resize, React `cache()` dedup, keyset cursors, and per-format fresh Sharp instances are all present and correct. The findings below are residual sharp edges, not systemic problems. Confidence labels reflect how certain the impact scenario is, not how severe.

---

## Severity Summary

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 3 | PERF-01, PERF-02, PERF-03 |
| MEDIUM | 7 | PERF-04 … PERF-10 |
| LOW | 8 | PERF-11 … PERF-18 |

No CRITICAL findings. No finding blocks correctness; all are throughput/latency/memory under scale or load.

---

## HIGH

### PERF-01 — Service-worker LRU rewrites + re-sorts the entire metadata blob on every image cache write
**File:** `apps/web/public/sw.template.js:87,101-116,130-138` (shipped SW) and reference `apps/web/src/lib/sw-cache.ts:95-141` (`recordAndEvict`)
**Confidence:** High

Every time the SW caches an image derivative it: (1) reads the full metadata Map (parsed from a single JSON blob `Response`), (2) sums all entry sizes O(n) (`sw.template.js:101-102`), (3) when over the 50 MB cap, builds `Array.from(entries.values()).sort((a,b)=>a.ts-b.ts)` — O(n log n) (`:105`), and (4) re-serializes the whole Map back via `JSON.stringify` into one cache entry (`:87`).

**Scenario:** With a 50 MB cap and typical 200-800 KB AVIF/WebP derivatives, the metadata Map holds ~60-250 entries steady-state. A visitor scrolling a large gallery triggers one `recordAndEvict` per derivative fetched — each doing a full O(n) sum + JSON serialize of the entire Map, and an O(n log n) sort once the cap is reached (i.e., on essentially every write thereafter, since the cache stays near-full). This is main-thread-adjacent work in the SW for every cached image; on low-end Android it adds measurable jank to scroll-driven prefetch. It also means concurrent fetches racing `getAll()`→mutate→`setAll()` can lose writes (last-writer-wins on the single blob), under-counting cache size and weakening the cap.

**Fix:** Keep a running `total` counter in the meta store rather than re-summing; maintain insertion-ordered keys (Map already preserves insertion order) so eviction is a head-walk instead of a full sort; batch/debounce `setAll` so a burst of fetches coalesces into one blob write. The lost-update race is inherent to "whole blob in one Cache entry" — acceptable for a best-effort cache, but the O(n log n)-per-write cost is the avoidable part.

---

### PERF-02 — `/api/search/similar/[id]` loads up to 5000 embeddings and runs cosine in a synchronous JS loop on the event loop
**File:** `apps/web/src/app/api/search/similar/[id]/route.ts:142-163`; constants in `apps/web/src/lib/clip-embeddings.ts:8-18` (`EMBEDDING_DIM=512`, `SEMANTIC_SCAN_LIMIT=5000`)
**Confidence:** High (deployed dark — see note)

The route SELECTs up to `SEMANTIC_SCAN_LIMIT=5000` production embeddings (`:142-147`), then synchronously: filters, `decodeEmbeddingColumn` (a 512-iteration `readFloatLE` loop per row), and `cosineSimilarity` (another 512-iteration loop per row) inside a single `.map()` (`:153-161`). That is ~5000 × (512 decode + 512 multiply-add) ≈ 5.1M float ops, fully synchronous, blocking the Node event loop for the duration. At 2048 bytes/vector the raw SELECT also pulls ~10 MB into heap per request.

**Scenario:** Each `/similar` call blocks the single Node event loop while it scans+scores. Under concurrency (N simultaneous requests), they serialize and each adds tens of ms of pure CPU; the in-memory rate limit (30/min/IP) bounds abuse but not legitimate fan-out from a popular photo page. There is no ANN index — it is a full linear scan every call.

**Note:** This is the **deployed-dark CLIP path** (default `semantic_search_mode=disabled`). Per the review brief I am NOT proposing activation; this is the latent perf profile to fix BEFORE any production enablement. Same shape exists in `/api/search/semantic` (text→embedding→linear scan).

**Fix (for when/if enabled):** Move scan+score off the event loop (worker thread / `setImmediate` chunking), or push cosine into MySQL (precomputed) / a vector index. At minimum, chunk the `.map()` with yields so a single request can't pin the loop. Cap result-set memory by streaming rows.

---

### PERF-03 — `getMapImages()` is an unbounded full-result query with no `LIMIT` and two unindexed `IS NOT NULL` predicates
**File:** `apps/web/src/lib/data.ts:1565-1593`; index inventory `apps/web/src/db/schema.ts:19-119`; caller `apps/web/src/app/[locale]/(public)/map/page.tsx:33`
**Confidence:** High

The map query is `images INNER JOIN topics WHERE processed=true AND topics.map_visible=true AND latitude IS NOT NULL AND longitude IS NOT NULL` with **no `.limit()`**. `latitude`/`longitude` have no index, and `topics.map_visible` has no index. The only usable index is the `processed` prefix; everything else is a scan-and-filter, and the entire matching set is returned to the public map page.

**Scenario:** With 10k+ geotagged images in map-visible topics, every public `/map` hit materializes the full result set (all GPS-bearing rows + topic labels) into memory and ships it to the client in one payload — growing linearly with the gallery, no pagination, no clustering. Combined with public freshness `revalidate=0` (every hit is dynamic), this is a per-request unbounded scan + unbounded serialization. It is the single most concrete public unbounded-result path in the codebase.

**Fix:** Add a `.limit()` (with viewport-bbox filtering or server-side clustering for large galleries). A composite partial-style index won't help the `IS NOT NULL` scan much in MySQL, so the bound is the real lever. If map data is relatively static, consider caching it behind a short TTL instead of `revalidate=0`.

---

## MEDIUM

### PERF-04 — Per-format × per-size fresh Sharp decode: up to 24 full source decodes per image
**File:** `apps/web/src/lib/process-image.ts:1061-1248` (`generateForFormat`), fan-out `:1253-1257`
**Confidence:** High

WI-14/R8-R8 (documented at `:1106-1108`) deliberately removed the shared `image`/`clone()` reuse and now constructs a **fresh `sharp(processingInputPath, …)` per format per size** (`:1110-1115`). With the admin-configurable ladder of up to 8 sizes × 3 formats, that is up to 24 independent decodes of the same source file per image (mitigated only by the same-resize-width hard-link dedup at `:1078-1087`, which fires only when consecutive sizes clamp to the same width on small originals).

**Scenario:** A 24 MP wide-gamut upload at the default 6 sizes decodes the source ~18 times (6×3) through libvips, each a full decode+resize. This is the dominant CPU cost of the upload pipeline. The trade is deliberate (eliminates cross-format/cross-size shared-state contamination, a documented past correctness bug), and `QUEUE_CONCURRENCY=1` + `sharp.concurrency()÷3` (`:44`) keep the box responsive — so this is a *known* CPU/throughput trade, not a defect. Flagged for visibility: re-encoding (backfill) of a large library is O(images × sizes × formats) decodes.

**Fix:** None recommended that doesn't reintroduce the contamination risk WI-14 fixed. If encode throughput becomes a bottleneck, consider decoding once to an intermediate rgb16 TIFF per image (already done for the >50 MP wide-gamut path at `:1013-1027`) and resizing from that for ALL sizes — a single decode amortized across the ladder. Validate it doesn't reintroduce the shared-state bug before adopting.

### PERF-05 — Sequential `await ensureTagRecord()` per tag during upload (N+1 round-trips)
**File:** `apps/web/src/app/actions/images.ts:399-415`
**Confidence:** Medium

Upload tag resolution loops `for (const cleanName of uniqueTagNames) { … await ensureTagRecord(db, …) }` — one DB round-trip per tag, sequentially. A 10-tag upload is 10 serial round-trips before the image row is written.

**Scenario:** Bulk upload of N files each carrying M tags serializes N×M tag lookups on the action path. Each `ensureTagRecord` is INSERT IGNORE + slug-collision check; the collision-detection semantics make naive `Promise.all` non-trivial (concurrent inserts of the same new tag race), so this is a deliberate correctness-over-throughput choice. At personal-gallery scale (handfuls of tags) the latency is small.

**Fix:** Pre-resolve existing tags in one `WHERE slug IN (...)` query, then only sequentially create the misses (usually 0-1). Keeps collision safety while collapsing the common all-hit case to a single round-trip.

### PERF-06 — `batchUpdateImageTags` adds tags one-at-a-time inside the transaction (await-in-loop ×2)
**File:** `apps/web/src/app/actions/tags.ts:397-425`
**Confidence:** Medium

Inside the transaction, each added tag does `await ensureTagRecord(tx, …)` (`:417`) then `await tx.insert(imageTags)…` (`:423`) — two serial round-trips per tag, holding the transaction (and its row locks) open for the full duration.

**Scenario:** Assigning 50 tags to one image is ~100 serial round-trips while the transaction holds locks, lengthening the lock window and risking lock-wait contention with concurrent edits on the same rows. Single-writer topology limits the contention blast radius.

**Fix:** Resolve all tag IDs first (batch `IN` select + minimal sequential creates for misses), then a single `INSERT IGNORE … VALUES (…multiple…)` into `imageTags`. Shrinks the transaction window dramatically.

### PERF-07 — `getImagesForFeed()` ORDER BY `updated_at` cannot use any index (filesort)
**File:** `apps/web/src/lib/data.ts:771-794`; callers `apps/web/src/app/feed.xml/route.ts:40` & `[topic]/feed.xml/route.ts:62` (`FEED_LIMIT=50`)
**Confidence:** High

The feed query orders by `desc(updated_at), desc(created_at), desc(id)`, but the only composite indexes key on `capture_date`/`created_at` (`schema.ts:114-116`) — there is no index with `updated_at` as a prefix. MySQL must filter by `processed` (index-usable) then **filesort** the matching set to satisfthe ORDER BY, plus the `GROUP_CONCAT` tag aggregation forces a temp table.

**Scenario:** Atom feed generation filesorts all processed rows (or all processed rows in a topic) to pick the top 50 by `updated_at`. Bounded to 50 output rows, but the *sort* is over the full filtered set, growing with the gallery. Feed cadence is low (crawlers/readers), so impact is moderate.

**Fix:** Either add an index `(processed, updated_at, created_at)` to serve the feed sort directly, or (cheaper) accept the filesort given the low call rate and small absolute table sizes at personal-gallery scale. Document the deliberate omission if not indexing.

### PERF-08 — `getFailedImages()` filters and sorts on unindexed columns (`processing_error IS NOT NULL`, ORDER BY `failed_at`)
**File:** `apps/web/src/lib/data.ts:940-954`
**Confidence:** Medium

`WHERE processed=false AND processing_error IS NOT NULL ORDER BY failed_at DESC` — no index on `processing_error` or `failed_at`, and no `LIMIT`. It is an admin-dashboard query.

**Scenario:** On a healthy gallery the `processed=false AND error IS NOT NULL` set is tiny, so the scan is cheap. The risk is a pathological case (mass processing failure after a bad deploy) where thousands of rows match and the unbounded, filesorted result is loaded into the admin page at once. Admin-only, low blast radius.

**Fix:** Add `.limit()` for safety and, if the failed-images panel becomes load-bearing, an index `(processed, failed_at)`.

### PERF-09 — `searchImages()` uses leading-wildcard `LIKE '%term%'` across multiple unindexed columns
**File:** `apps/web/src/lib/data.ts:1404-1543` (predicates `:1460-1466`)
**Confidence:** Medium

The text search does `LIKE '%escaped%'` on `title`, `description`, `camera_model`, `lens_model`, `topic`, and `topics.label`. Leading wildcards defeat every B-tree prefix (including the `idx_images_topic` topic prefix and the `tags.name`/`alias` unique indexes used by the secondary queries at `:1514-1530`). There is no FULLTEXT index. The query is bounded by `effectiveLimit` and `processed` narrows the set, and the three sub-queries run via `Promise.all` (`:1513`).

**Scenario:** Every public search full-scans the processed image set, evaluating 6 `LIKE '%…%'` predicates per row. The per-IP search rate limit (30/min) caps abuse, and at personal-gallery row counts the scan is fast — but it scales linearly with the library and has no index recourse.

**Fix:** Add a MySQL `FULLTEXT` index over `(title, description, camera_model, lens_model)` and switch to `MATCH … AGAINST` for the primary query (keep `LIKE` as a fallback). Substantially better than `%term%` scans as the gallery grows.

### PERF-10 — OFFSET-based pagination retained on listing queries (deep-offset cost)
**File:** `apps/web/src/lib/data.ts` — `getImages():893-913`, `getImagesLitePage():818-854`, `getAdminImagesLite():915-937` (cursor path exists for `getImagesLite`/`getImagesForSmartCollection`)
**Confidence:** Medium

Several listing functions still accept an `OFFSET`. MySQL must walk and discard `OFFSET` rows before returning the page, so page K costs O(K × pageSize) row visits even with the supporting index, and the `GROUP_CONCAT` group/temp-table runs over the scanned rows.

**Scenario:** Deep pagination (admin scrolling to page 50 of a large gallery, or a crawler walking `?offset=`) gets progressively slower. The codebase already implements keyset cursors (`getClientImageListCursor`, cursor branches in `getImagesLite`) — the OFFSET paths are the legacy remainder.

**Fix:** Route all infinite-scroll/admin-list pagination through the existing keyset cursor; retain OFFSET only where a true random-access jump is required (rare). Mostly a wiring change since the cursor machinery exists.

---

## LOW

### PERF-11 — Unbounded `getAdminTags()` GROUP BY with no LIMIT
**File:** `apps/web/src/app/actions/tags.ts:24-34`; caller `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx:7`
**Confidence:** Medium
`tags LEFT JOIN imageTags GROUP BY tags.id ORDER BY count DESC` with no LIMIT. Admin-only, rendered on the tags page. Fine for hundreds of tags; would aggregate the entire tag×imageTags join at 10k+ tags. Add a LIMIT or pagination if tag counts grow large.

### PERF-12 — Unbounded `getAdminUsers()` (no LIMIT)
**File:** `apps/web/src/app/actions/admin-users.ts:64-69`
**Confidence:** Low
`SELECT … FROM adminUsers ORDER BY created_at DESC` with no LIMIT. Admin count is intrinsically tiny (root admins), so practically a non-issue; noted for completeness.

### PERF-13 — `getTopics()` correlated `MAX(updated_at)` subquery per topic + ORDER BY on unindexed `order`
**File:** `apps/web/src/lib/data.ts:452-473`
**Confidence:** Medium
Per-topic correlated `MAX(images.updated_at WHERE processed)` subquery and `ORDER BY topics.order` (no index on `order`). Topics are few (tens), so the filesort + per-topic probe is cheap. If topic count ever grows, the correlated subquery becomes N probes. Acceptable at current scale.

### PERF-14 — Touch/swipe state update fires on every `touchmove` (~60/s) re-rendering the navigation component
**File:** `apps/web/src/components/photo-navigation.tsx:54-94` (`setSwipeOffset` per move); inline transform styles `:160-205`
**Confidence:** Medium
`handleTouchMove` calls `setSwipeOffset()` on every raw touchmove, causing a React re-render (and fresh inline style objects) ~60×/s for the duration of a swipe. Confined to the active-swipe gesture on the photo viewer (not the scroll path). On mid/low-end phones this can drop frames mid-swipe.
**Fix:** Coalesce updates with `requestAnimationFrame` (one state commit per frame) or drive the visual offset via a ref + direct style write (the `image-zoom` pattern) instead of state.

### PERF-15 — `getBoundingClientRect()` read inside the wheel handler in ImageZoom
**File:** `apps/web/src/components/image-zoom.tsx:103` (also `:167`, `:243`)
**Confidence:** Medium
The wheel handler reads `container.getBoundingClientRect()` on each event (30-60/s while scrolling over a zoomable image) and is followed by a `style.transform` write (`applyTransform`), the classic read-then-write layout-thrash shape. Confined to wheel-zoom interaction. `:167`/`:243` are per-gesture (double-tap / touchstart) and benign.
**Fix:** Cache the rect on pointer-enter / resize and reuse it within the gesture rather than re-reading per wheel event.

### PERF-16 — Inline style objects recreated per masonry tile on every parent render
**File:** `apps/web/src/components/home-client.tsx:290-294`
**Confidence:** Low
Each grid tile gets a fresh `style={{ aspectRatio, backgroundColor, containIntrinsicSize }}` object every render. **Lower impact than it appears:** the tile is a plain inline `<div>` (not a memoized child), and the masonry parent has very few re-render triggers — the scroll handler is state-gated (`:181`), column changes are rAF-debounced (`:49`), and there is no per-tile hover state lifting to the parent. So the object churn only occurs on genuine list changes (filter/load-more), not on scroll. Note also the masonry is **pure CSS multi-column** (`columns-N` classes, `:259`) — there is NO JS layout/reorder loop, so the CLAUDE.md "useMemo for reorder, rAF debounced resize" note refers to `useColumnCount`, not a JS masonry packer. No fix needed unless the parent gains hot re-render sources.

### PERF-17 — `SimilarThumb` children re-render with freshly-computed URLs on parent render
**File:** `apps/web/src/components/similar-photos.tsx:129-143,166`
**Confidence:** Low
`sizedSrc`/`baseSrc` are computed inside the results `.map()` and `SimilarThumb` is not `memo`-wrapped, so a parent re-render re-renders all thumbnails with new string props. The panel only mounts/fetches on user `open` (`:58`) so the list is small (topK) and the parent rarely re-renders. Minor; wrap `SimilarThumb` in `React.memo` if it ever lands in a hot parent.

### PERF-18 — `incrementRateLimit` + `checkRateLimit` are two separate DB round-trips on the login path
**File:** `apps/web/src/lib/rate-limit.ts:419-435` (`incrementRateLimit`), `:390-413` (`checkRateLimit`); login flow `apps/web/src/app/actions/auth.ts:131-146`
**Confidence:** Low
Login pre-increments (atomic upsert) then issues a separate SELECT to read the count — two round-trips per attempt, ×2 for the account bucket (4 DB ops before Argon2). This is a deliberate correctness design (pre-increment-before-verify is the documented TOCTOU fix at `auth.ts:124-126`, with in-memory Maps as the fast path and DB as cross-restart truth). The Argon2 verify (~100ms) dominates, so the extra round-trips are noise. Could fold increment+read into one `INSERT … ON DUPLICATE KEY UPDATE … RETURNING`-style pattern, but not worth the change. Noted only for completeness.

---

## What is correct and well-built (verified, not flagged)

- **Image queue** (`image-queue.ts`): bounded retry/claim/error Maps with FIFO eviction + `MAX_RETRY_MAP_SIZE` cap (`:80-110`), permanently-failed Set capped at 1000 (`:501-513`), keyset bootstrap cursor (`:622-678`) so failing low-id rows can't starve later rows, per-image MySQL advisory-lock claim + conditional `WHERE processed=false` UPDATE (`:194-211,369-371`), fire-and-forget caption/embedding hooks that never block the job (`:394-477`), hourly GC with `unref()` timers. Excellent.
- **Sharp memory discipline**: `sharp.cache(false)` (`:53`), `sharp.concurrency = (cores-1)/3` to bound the libvips×format-fanout thread explosion (`:44`), stream-to-disk upload (`:806-815`), file-path inputs for mmap (not heap buffers), `sequentialRead:true`, >50 MP wide-gamut downscale-to-TIFF before fan-out (`:1010-1030`). Strong.
- **Rate-limit module**: bounded Maps everywhere (`createResetAtBoundedMap`/`createWindowBoundedMap`), atomic upsert increment, transactional decrement to avoid lost updates (`:461-491`), hourly `purgeOldBuckets`. Solid.
- **Restore quiesce ordering** (`image-queue.ts:716-757`): the documented `pause → clear → onIdle` order that fixes the prior deadlock is correct.
- **React data layer**: `React.cache()` on 9 read functions, `Promise.all` in `getImage` (tags+prev+next parallel), keyset cursors implemented, `useColumnCount` rAF-debounced (`home-client.tsx:47-53`), `photo-viewer` memoizes `blurStyle`/`srcSetData`/`navigate`, lightbox histogram + color pip lazy-mounted only when opened. All correct.
- **No `key={index}` anti-patterns** found in any `.map` (all keyed on stable ids).
- **`useDisplayCapability`**: snapshot correctly memoized by value — no `useSyncExternalStore` infinite-loop risk.

---

## Files examined

**Read in full or in targeted regions (direct):** process-image.ts (1638L, regions 1-200/700-940/1040-1280), image-queue.ts (769L full), rate-limit.ts (500L full), sw-cache.ts (167L full), sw.template.js (eviction region), home-client.tsx (regions 20-300), photo-viewer.tsx (structure scan), similar/[id]/route.ts (120-210), auth.ts (118-178), clip-embeddings.ts (constants), data.ts (getMapImages/feed/listing regions), schema.ts (index inventory).

**Swept via Explore agents (cited, cross-checked):** all 14 server actions (`app/actions/*`), all 9 API routes (`app/api/**/route.ts`), data.ts (all 24 data-access functions), schema.ts (all tables/indexes), all `components/*.tsx` (home-client, photo-viewer, histogram, lightbox, image-zoom, photo-navigation, similar-photos, tag-filter, search).

**Total source files in `apps/web/src`:** 465. **Files directly examined or agent-swept with citations:** ~60 spanning every perf-relevant subsystem.

---

## Top 3 findings

1. **PERF-01 (HIGH)** — SW LRU re-sums + re-sorts + JSON-serializes the entire cache-metadata blob on every image cache write (`sw.template.js:87-138`); O(n log n) per write near the 50 MB cap, plus a whole-blob lost-update race.
2. **PERF-02 (HIGH, deployed-dark)** — `/api/search/similar` loads ≤5000 embeddings (~10 MB) and runs 5000× decode+cosine (≈5M float ops) synchronously on the event loop with no ANN index; fix before any CLIP enablement (`similar/[id]/route.ts:142-163`).
3. **PERF-03 (HIGH)** — `getMapImages()` is an unbounded, un-`LIMIT`ed full-result query with two unindexed `IS NOT NULL` GPS predicates, feeding the public `/map` page a payload that grows linearly with the gallery (`data.ts:1565-1593`).
