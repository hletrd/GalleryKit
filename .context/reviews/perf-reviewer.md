# Performance & Concurrency Review — GalleryKit

**Reviewer:** perf-reviewer specialist
**Cycle:** 3
**HEAD:** b1e9e0da
**Date:** 2026-06-16
**Scope:** CPU/memory/I/O hotspots, DB query shapes, N+1, connection-pool & async-queue concurrency, Sharp pipeline throughput, UI responsiveness (re-render / layout-thrash / INP / CLS / LCP), service-worker cache, shared-state hazards, unbounded growth (Maps, caches, in-memory buffers).
**Method:** Read every hot-path file in full (`data.ts`, `image-queue.ts`, `process-image.ts` core, `admin-backfill-runner.ts`, `public/sw.js`, `sw-cache.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `analytics-data.ts`, `view-retention.ts`), all interaction components (`home-client`, `photo-navigation`, `image-zoom`, `histogram`, `lightbox`, `load-more`), `schema.ts` indexes, `db/index.ts` pool. Verified EVERY candidate against current HEAD before classifying. Cross-checked the prior cycle-2 findings (commit 8ccc8806) against the fixes that landed since.

## Verdict

This remains a **mature, heavily-optimized codebase** with no CRITICAL or genuinely-new HIGH performance defect. The two cycle-2 HIGH findings on the public hot path — the service-worker LRU O(n log n)-per-write sort (PERF-01) and the unbounded `getMapImages()` query (PERF-03) — are both **CLOSED** at this HEAD (commits `7119345a` and `3b69c877` respectively, verified in source below). What remains is a set of documented MEDIUM/LOW residuals, all deliberate correctness-over-throughput tradeoffs or admin-only paths, plus one small NEW avoidable-decode finding in the Sharp pipeline.

Confidence labels reflect how certain the impact scenario is, not severity.

---

## Severity Summary

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 4 | PERF-C3-01 … PERF-C3-04 |
| LOW | 5 | PERF-C3-05 … PERF-C3-09 |

---

## Closed since cycle 2 (verified at HEAD b1e9e0da)

- **PERF-01 (was HIGH) — SW LRU full re-sort per image cache write.** FIXED (commit `7119345a`). `recordAndEvict` in both `public/sw.js:95-126` and `lib/sw-cache.ts:95-149` now upserts as **delete-then-set** so Map insertion order tracks recency, and eviction is a **head-walk** (`for (const entry of entries.values())`, stop when `total <= cap`) — no `Array.from(...).sort()`. The O(n)-per-write size sum remains (inherent to the whole-blob meta store; explicitly scoped out and documented at `sw-cache.ts:114-118`), but the avoidable O(n log n) sort the review flagged is gone. `touchMeta` (the 304 path, `sw.js:156-170`) also delete-then-sets so a revalidated entry repositions to the tail.
- **PERF-03 (was HIGH) — `getMapImages()` unbounded result.** FIXED (commit `3b69c877`). `data.ts:1567` now defines `MAP_MAX_MARKERS = 10000` and the query carries `.orderBy(desc(capture_date), desc(created_at), desc(id)).limit(MAP_MAX_MARKERS)` (`data.ts:1593-1594`), with a deterministic order so WHICH markers survive the cap is stable. The two unindexed `IS NOT NULL` GPS predicates remain (no index recourse in MySQL for those), but the unbounded-payload lever is now bounded.
- **Serve-upload FD leak on client abort** — FIXED (`dd26e742`, referenced; serve path not re-implicated this cycle).
- **Analytics `*_views` retention sweep** — FIXED (`3f6ae0f7`). `lib/view-retention.ts` runs a chunked DELETE (`VIEW_PURGE_BATCH=5000`, `MAX_BATCHES_PER_TABLE=200`, defensive non-future cutoff) on the hourly GC. Verified bounded.
- **WebP ICC 1KB read** (`2784d244`) — confirmed present; reduces ICC-verify read cost on the WebP path.

---

## MEDIUM

### PERF-C3-01 — Unconditional full-source `sharp().metadata()` decode per image, even when not needed (NEW)
**File:** `apps/web/src/lib/process-image.ts:1019-1021`
**Confidence:** Medium

`processImageFormats` runs, on EVERY call:
```js
const inputMeta = await sharp(inputPath, { limitInputPixels, failOn:'error', sequentialRead:true, autoOrient:true }).metadata();
const baseHeight = (inputMeta.height && inputMeta.height > 0) ? inputMeta.height : 0;
const basePixels = baseWidth * baseHeight;
if (isWideGamutSource && basePixels > WIDE_GAMUT_MAX_SOURCE_PIXELS) { … }
```
`baseHeight` / `basePixels` are consumed ONLY by the `isWideGamutSource && basePixels > cap` wide-gamut downscale gate at `:1022`. `isWideGamutSource` is already known at `:987` (before this read). For every **sRGB / non-wide-gamut** upload (the common case for most cameras/phones in sRGB mode) this `.metadata()` call is pure overhead — its result is computed and discarded because the `if` short-circuits on `isWideGamutSource` first.

**Scenario:** A library of sRGB JPEGs (very common) pays one extra libvips header decode per image on both the upload queue path and every backfill re-encode. `metadata()` is a header parse, not a full pixel decode, so it's ~5-30 ms per image (the code's own comment at `:1011-1013` cites that range) — small per image, but it is `O(images)` waste on a full backfill of a large library, and it's trivially avoidable.

**Fix:** Gate the metadata read behind the only thing that uses it:
```js
let basePixels = 0;
if (isWideGamutSource) {
  const inputMeta = await sharp(inputPath, {…}).metadata();
  const baseHeight = (inputMeta.height && inputMeta.height > 0) ? inputMeta.height : 0;
  basePixels = baseWidth * baseHeight;
}
if (isWideGamutSource && basePixels > WIDE_GAMUT_MAX_SOURCE_PIXELS) { … }
```
No correctness change — the non-wide-gamut branch never reads `basePixels` today.

### PERF-C3-02 — Synchronous per-tile HEAD ETag probe on the warm-cache image display path
**File:** `apps/web/public/sw.js:233-257` (`staleWhileRevalidateImage`), bound `:38` (`HEAD_REVALIDATE_TIMEOUT_MS = 300`)
**Confidence:** Medium

When an image derivative is already cached, the SW does a **synchronous** `await fetch(url, {method:'HEAD', If-None-Match})` BEFORE returning the cached bytes (to catch an admin color-setting flip immediately, R10-H3). Each warm masonry paint scrolls many cached tiles into view; each cached tile that the SW intercepts issues its own HEAD round-trip and **awaits it** before the tile resolves. The 300 ms `AbortSignal.timeout` (commit `dd26e742`-era, `:239`) caps the worst case per tile, so this is already mitigated for the slow-network case — a hung probe aborts and stale-serves. But on a normal-latency connection a gallery of N warm tiles still fans out N concurrent HEAD requests per paint, each adding one RTT to that tile's first paint, and the browser's per-origin connection cap (6 for HTTP/1.1) serializes them.

**Scenario:** Revisiting a gallery offline-cached on a phone on a 150 ms-RTT mobile link: a 30-tile viewport fan-outs 30 HEADs, capped at 300 ms each but serialized 6-at-a-time over HTTP/1.1 → up to ~5 batches × 300 ms of probe latency layered onto the warm paint before tiles settle (worst case; healthy networks complete each HEAD in well under the cap and the effect is a single-RTT-per-tile nudge). This is the documented freshness/latency tradeoff (the code comment at `:222-232` is explicit that the synchronous HEAD is deliberate and MUST NOT be removed).

**Fix:** Not a defect to "fix" outright — the synchronous HEAD is an intentional color-freshness guarantee. Two non-regressing options if warm-paint latency becomes a measured problem: (a) skip the HEAD when the cached entry's own age is under a short freshness floor (e.g. don't re-probe an entry cached < 60 s ago, since an admin setting flip older than that would already have been caught on the prior visit); (b) gate the synchronous HEAD on `navigator.connection.effectiveType` so 2g/3g links go straight to stale-serve + background revalidate. Both preserve the "fresh colors after a setting change" intent on fast links. Document if deliberately left as-is.

### PERF-C3-03 — OFFSET pagination retained on the admin dashboard grid (deep-offset cost)
**File:** `apps/web/src/lib/data.ts:915-937` (`getAdminImagesLite`), caller `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:11-16` (`PAGE_SIZE=50`, page clamped to 1000)
**Confidence:** Medium

The admin dashboard grid uses `getAdminImagesLite(PAGE_SIZE, offset, true)` with `offset = (page-1)*50`, page clamped `[1,1000]`. The query is `LEFT JOIN imageTags + tags + GROUP_CONCAT + GROUP BY images.id ORDER BY capture_date DESC … LIMIT 51 OFFSET <offset>`. MySQL must walk and discard `offset` rows (up to 49,950 at page 1000) and build the GROUP_CONCAT temp table over the scanned set before returning the page. The public infinite-scroll path already moved to keyset cursors (`LoadMore` sends `initialCursor`, `load-more.tsx:49-50` uses `cursor ?? offset`; `getImagesLite`/`getImagesForSmartCollection` honor the cursor) — the admin grid is the legacy OFFSET remainder.

**Scenario:** An admin paging deep into a large gallery (page 200+ of a 10k+ image library) gets progressively slower page loads. Bounded by the page-1000 clamp and admin-only, so low blast radius; but page 1000 at a 50k-row gallery does a 50k-row walk + discard per load.

**Fix:** Route the admin grid through the existing keyset cursor machinery (it already exists for the public list). If random-access page jumps are a hard admin-UX requirement, leave OFFSET but document the deep-offset cost. `searchImages` (public.ts:137) also uses offset but is capped at 100 results, so its deep-offset exposure is negligible.

### PERF-C3-04 — `searchImages()` leading-wildcard `LIKE '%term%'` across 6 unindexed columns
**File:** `apps/web/src/lib/data.ts:1404-1543` (predicates `:1459-1466`)
**Confidence:** Medium

Public text search runs `LIKE '%escaped%'` on `title`, `description`, `camera_model`, `lens_model`, `topic`, and `topics.label`. The leading `%` defeats every B-tree prefix (including `idx_images_topic`), so the primary query is a full scan of the processed image set evaluating 6 `LIKE` predicates per row; there is no FULLTEXT index. Bounded by `effectiveLimit` (≤100) and the per-IP 30/min search rate limit, and the two secondary tag/alias queries run via `Promise.all` (`:1511-1531`) with a short-circuit when the main query already fills the limit (`:1478`) — all good mitigations — but the per-call cost still scales linearly with library size with no index recourse.

**Scenario:** Every public search of a popular term that DOESN'T fill from the title column full-scans the processed set. Fast at personal-gallery scale; grows linearly with the library.

**Fix:** Add a MySQL `FULLTEXT` index over `(title, description, camera_model, lens_model)` and switch the primary query to `MATCH … AGAINST` (keep `LIKE` as a fallback for short/partial tokens). Documented as acceptable at current scale in the source comment (`:1418-1420`); flagged for visibility, not as a defect.

---

## LOW

### PERF-C3-05 — `getImagesForFeed()` ORDER BY `updated_at` forces a filesort
**File:** `apps/web/src/lib/data.ts:771-794`; callers `feed.xml`/`[topic]/feed.xml` (`FEED_LIMIT=50`)
**Confidence:** High
Feed orders by `desc(updated_at), desc(created_at), desc(id)`, but no index keys on `updated_at` (`schema.ts` composites key on `capture_date`/`created_at`). MySQL filters by `processed` then filesorts the matching set, plus GROUP_CONCAT temp table. Bounded to 50 output rows but the sort spans the full filtered set. Low call cadence (crawlers/readers). Fix: add `(processed, updated_at, created_at)` index, or accept the filesort and document the deliberate omission.

### PERF-C3-06 — `getFailedImages()` filters/sorts on unindexed columns, no LIMIT
**File:** `apps/web/src/lib/data.ts:940-954`
**Confidence:** Medium
`WHERE processed=false AND processing_error IS NOT NULL ORDER BY failed_at DESC`, no index on `processing_error`/`failed_at`, no `.limit()`. Admin-only (dashboard failed-images panel, loaded on every dashboard render via the `Promise.all` at `dashboard/page.tsx:15-22`). On a healthy gallery the matching set is tiny. Pathological case: a mass-processing-failure deploy leaves thousands of rows matching and the unbounded filesorted result loads into the admin page at once. Fix: add `.limit()` for safety; `(processed, failed_at)` index if the panel becomes load-bearing.

### PERF-C3-07 — `getTopics()` correlated `MAX(updated_at)` subquery per topic + ORDER BY on unindexed `order`
**File:** `apps/web/src/lib/data.ts:452-473`
**Confidence:** Medium
Per-topic correlated `MAX(images.updated_at WHERE topic=slug AND processed)` subquery and `ORDER BY topics.order` (no index on `order`). Topics are few (tens); the subquery hits `idx_images_topic` per partition and the result is cached behind the `/sitemap.xml` `revalidate=3600` ISR window (documented `:457-459`). Acceptable at current scale; becomes N probes only if topic count grows large.

### PERF-C3-08 — Touch-swipe `setSwipeOffset` fires per `touchmove` (~60/s), re-rendering PhotoNavigation with fresh inline style objects
**File:** `apps/web/src/components/photo-navigation.tsx:93` (`setSwipeOffset` per move), inline transform styles `:160-205`
**Confidence:** Medium
`handleTouchMove` calls `setSwipeOffset(clampedOffset)` on every raw touchmove (~60/s for the swipe duration), re-rendering the component and allocating fresh `style={{opacity, transform, ...transitionStyle}}` objects for up to three indicator divs each frame. Confined to the active-swipe gesture on the photo viewer (NOT the scroll path). On mid/low-end phones this can drop frames mid-swipe. Fix: coalesce updates with `requestAnimationFrame` (one commit per frame) or drive the visual offset via a ref + direct style write (the `image-zoom.tsx` `applyTransform` pattern) instead of React state.

### PERF-C3-09 — `getBoundingClientRect()` read inside the wheel handler, followed by a transform write (layout-thrash shape)
**File:** `apps/web/src/components/image-zoom.tsx:103` (rect read), `:110` (`applyTransform` → `style.transform` write)
**Confidence:** Medium
The wheel-zoom handler reads `container.getBoundingClientRect()` per wheel event (~30-60/s while scroll-zooming over a zoomable image), then writes `style.transform` via `applyTransform` — the classic read-then-write layout-thrash sequence within one frame. Confined to the wheel-zoom interaction on the photo viewer; the rect reads at `:167` (double-tap) and `:243` (pinch start) are per-gesture and benign. Fix: cache the rect on pointer-enter / resize and reuse it within the gesture rather than re-reading it on every wheel event.

---

## Verified correct and well-built (not flagged)

- **Image queue (`image-queue.ts`)** — bounded retry/claim/error Maps with FIFO eviction + `pruneRetryMaps` cap (`:98-111`, `MAX_RETRY_MAP_SIZE=10000`), permanently-failed Set capped at 1000 with associated-map cleanup on eviction (`:501-514`), keyset bootstrap cursor (`:622-679`) so failing low-id rows can't starve later rows, per-image MySQL advisory-lock claim + conditional `WHERE processed=false` UPDATE (`:195-211`, `:370-372`), fire-and-forget caption/embedding hooks that never block the job (`:395-478`), hourly GC armed ONCE via `!state.gcInterval` guard (`:712`, the AGG-M12 fix), all timers `unref()`'d. The restore quiesce order `pause → clear → onIdle` (`:757-759`) is the documented deadlock-free ordering.
- **Sharp memory discipline (`process-image.ts`)** — `sharp.cache(false)` (`:53`), `sharp.concurrency = (cores-1)/3` to bound the libvips × format-fanout thread explosion (`:44`), file-path inputs for mmap (not heap buffers), `sequentialRead:true`, >50 MP wide-gamut downscale-to-TIFF before the rgb16 fan-out (`:1022-1042`), 10-bit AVIF gated on a Promise-singleton libheif probe (`:84-117`). The per-format/per-size fresh `sharp()` decode (`:1122-1127`, up to 8×3 decodes/image) is the documented WI-14/R8-R8 correctness tradeoff (eliminates cross-format/cross-size shared-state contamination); the same-resize-width hard-link dedup (`:1090-1099`) mitigates the small-original case. Deliberate CPU/throughput trade, not a defect — left unflagged this cycle (was PERF-04, accepted).
- **Admin backfill runner (`admin-backfill-runner.ts`)** — concurrency clamped to a pool-budget cap (`resolveBackfillConcurrency`, `:129-142`; `cap = max(1, floor((LIMIT-RESERVED-1)/2)) = 2` at pool 10) so a background re-encode reserves ≥ half the pool for live `getImage` fan-outs; NaN-guarded against a mocked pool limit (`:137`); keyset-paginated batches drained through PQueue before the next fetch (`O(batch)` residency, `:684-773`); per-image processing-claim lock so it never double-encodes against the live queue worker (`:343-359`); pool-exhausted claim treated as a `locked` skip (no error spin, `:485-493`); whole-run advisory lock with a single release point in `finally` (`:805-808`).
- **Rate-limit modules (`rate-limit.ts` / `auth-rate-limit.ts`)** — bounded Maps everywhere (`createResetAtBoundedMap` / `createWindowBoundedMap`), atomic upsert increment (`incrementRateLimit`, `:419-435`), transactional decrement to avoid lost updates (`decrementRateLimit`, `:461-491`), hourly `purgeOldBuckets` (`:497-500`), per-IP + per-account dual-bucket login limiting. Solid.
- **Analytics (`analytics-data.ts`)** — windowed breakdowns served as covering range scans on the `(bot, viewed_at, country_code)` / `(bot, viewed_at, referrer_host)` indexes (migration 0021); the `'all'` window's covering-index temp-table aggregation is bounded by view-event retention and the deferral is documented with an EXPLAIN-evidence gate (`:93-111`). View-event inserts are fire-and-forget single inserts with per-IP rate limiting (`public.ts:355-407`), never awaited on the render path. The shared-group `view_count` buffer (`data.ts:43-202`) is bounded (`MAX_VIEW_COUNT_BUFFER_SIZE=1000`, retry-count Map capped at 500, atomic Map-swap drain, exponential backoff on DB-outage flushes).
- **React data layer** — `React.cache()` on 9 read fns, `Promise.all` in `getImage` (tags+prev+next parallel, `:1048-1094`), keyset cursors implemented and used by load-more, `getLatestImageForOg` purpose-built minimal OG accessor (no tag JOIN/GROUP_CONCAT, `:873-887`). Compile-time privacy + large-payload (`blur_data_url`) guards on the public select shape.
- **UI components** — `home-client.tsx` masonry is pure CSS multi-column (no JS packer), scroll handler state-gated (`:181`), column count rAF-debounced (`:47-53`), load-more cursor-driven; `load-more.tsx` stores the callback in a ref so the IntersectionObserver isn't re-created on state churn (`:97-127`) and guards setState-after-unmount; `histogram.tsx` is worker-driven, 256-px canvas cap, lazy-mounted, single recompute per photo/format/resize, module-scope P3-context + AVIF-support + canvas-P3 probes; `lightbox.tsx` `showControls` is ref-throttled to one setState per 500 ms so `handleMouseMove` doesn't thrash (`:`showControls 500ms gate), slideshow timer in a ref. `image-zoom.tsx` drives transforms via refs + direct `style.transform` (no per-move re-render) except the wheel-rect read flagged in PERF-C3-09.
- **No unbounded module-level mutable state** — every module-scope Map/Set is either request-local, a bounded LRU (`blur-data-url.ts rejectionLog` cap 256), or the bounded view-count buffer. No `key={index}` anti-patterns.

## CLIP note (per review guard)

The `image_embeddings` write hook (`image-queue.ts:434-478`) and the similar/semantic linear-scan routes are reviewed for perf shape only and remain default-`disabled`. NOT proposing activation. The latent profile the prior cycle flagged (≤5000-vector synchronous decode+cosine on the event loop, no ANN index) is unchanged and should be addressed BEFORE any future enablement — out of scope to fix this cycle.

---

## Files examined (direct, full or targeted regions)

`lib/data.ts` (1663L full), `lib/image-queue.ts` (787L full), `lib/process-image.ts` (regions 1-120, 960-1280), `lib/admin-backfill-runner.ts` (872L full), `public/sw.js` (373L full), `lib/sw-cache.ts` (174L full), `lib/rate-limit.ts` (500L full), `lib/auth-rate-limit.ts` (137L full), `lib/analytics-data.ts` (214L full), `lib/view-retention.ts`, `lib/analytics.ts` (head), `lib/blur-data-url.ts` (rejection-log region), `db/schema.ts` (index inventory), `db/index.ts` (pool: limit 10 / queue 20 / keepalive), `components/home-client.tsx` (461L full), `components/photo-navigation.tsx` (253L full), `components/image-zoom.tsx` (374L full), `components/histogram.tsx` (715L full), `components/lightbox.tsx` (showControls/handleMouseMove regions), `components/load-more.tsx` (156L full), `app/actions/public.ts` (view-insert + search-offset regions), `app/actions/images.ts` (tag-loop region), `app/actions/tags.ts` (batch-tag region), `app/[locale]/admin/(protected)/dashboard/page.tsx`.

## Top findings

1. **PERF-C3-01 (MEDIUM, NEW)** — `process-image.ts:1019` runs a full `sharp().metadata()` header decode on EVERY upload/backfill even though `baseHeight`/`basePixels` are used only by the wide-gamut downscale gate; gate the read behind `isWideGamutSource` to drop one libvips decode per sRGB image (zero correctness change).
2. **PERF-C3-02 (MEDIUM)** — synchronous per-tile HEAD ETag probe on the warm-cache image path (`sw.js:233-257`) layers one RTT per cached tile onto warm masonry paints; already bounded by the 300 ms abort, but consider an age-floor or `effectiveType` gate on slow links (deliberate color-freshness tradeoff — document if left).
3. **PERF-C3-03 (MEDIUM)** — admin dashboard grid still uses OFFSET pagination (`data.ts:915-937`, page-clamped 1000) where the public list already uses keyset cursors; deep-offset walk grows with the gallery (admin-only, bounded).

Both cycle-2 HIGH findings (SW LRU sort, getMapImages unbounded) are verified CLOSED at HEAD b1e9e0da.
