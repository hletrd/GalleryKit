# Perf Reviewer Report - Cycle 24

Review lane: `perf-reviewer`
Scope: current `HEAD` `0cc094dd76d51e88fe163c0b7075e3f0b341f74c`
Mode: review-only. No application/source files were modified.

## Inventory

I reviewed current HEAD from performance, concurrency, CPU/memory, query efficiency, image-processing cost, cache behavior, and UI responsiveness angles. I first inventoried the source tree with `find apps/web/src -type f \( -name '*.ts' -o -name '*.tsx' \)`, `find apps/web/src/app ...`, `find apps/web/src/lib ...`, and targeted `rg` sweeps for pagination, count windows, semantic scans, date functions, marker rendering, smart collections, and client accumulation.

Review-relevant files/regions examined:

- Rules/docs: `AGENTS.md`, `CLAUDE.md`, and the prior `.context/reviews/` perf history for stale-finding avoidance.
- Public page/query paths: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `c/[slug]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/smart-collections.ts`, and `apps/web/src/db/schema.ts`.
- Client responsiveness: `apps/web/src/components/home-client.tsx`, `load-more.tsx`, `search.tsx`, `lightbox.tsx`, `photo-viewer.tsx`, `histogram.tsx`, `map/map-loader.tsx`, `map/map-client.tsx`, `grid-picture.tsx`, and `optimistic-image.tsx`.
- Search/CLIP: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/app/actions/embeddings.ts`, and CLIP tests/contracts.
- Upload/image processing/backfill: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, color/GPS/ICC helpers, and related queue/backfill tests.
- Admin/analytics/export/runtime controls: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/bounded-map.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/sw-cache.ts`, and deployment/runtime docs.

## Confirmed Issues

### PERF-C24-01 - Dynamic public first pages still pay exact grouped count work

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/data.ts:878-907` builds `getImagesLitePage()` with `LEFT JOIN imageTags`, `LEFT JOIN tags`, `GROUP BY images.id`, `COUNT(*) OVER()`, ordered pagination, `LIMIT`, and `OFFSET`.
- `apps/web/src/lib/data.ts:1417-1461` repeats the `COUNT(*) OVER()` grouped shape for initial smart-collection pages.
- `apps/web/src/app/[locale]/(public)/page.tsx:164-166` calls `getImagesLitePage(..., PAGE_SIZE, 0)` for the home first page.
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:174-176` calls the same counted query for topic first pages.
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101` calls the counted smart-collection query before rendering the first 30 cards.

Problem: the response is bounded to about 30 visible cards, but MySQL still has to aggregate tags, group images, sort, and compute an exact total across the full matching set. These public routes are dynamic (`revalidate = 0`), so a normal first-page hit repeats the work instead of amortizing it through ISR.

Concrete failure scenario: a gallery grows to tens of thousands of processed images with several tags per image. Crawler or social traffic against `/`, a topic page, a tag-filtered page, or a public smart collection repeatedly forces full grouped count work just to render one page of thumbnails, raising DB CPU/temp-table pressure and TTFB.

Fix: split public first paint from exact totals. Use the existing bounded/keyset listing shape plus `limit + 1` for `hasMore`, fetch tags only for returned image IDs, and either remove public exact totals, cache them briefly, or compute them through a cheaper separate path. For smart collections, make exact totals optional/async unless a predicate is known to be index-backed.

### PERF-C24-02 - The map route can ship and mount 10,000 photos at once

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/data.ts:1658-1685` caps `/map` at `MAP_MAX_MARKERS = 10000` and returns all matching GPS rows in one query.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-50` maps every returned row into a serialized marker payload.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:68-75` passes the full marker array to the client map.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:77-89` also renders a full accessible list for every marker.
- `apps/web/src/components/map/map-client.tsx:86-90` computes bounds over every marker and `apps/web/src/components/map/map-client.tsx:119-140` mounts one Leaflet `<Marker>` and `<Popup>` per marker.

Problem: the DB result is capped, but the cap is still far above what a single server-rendered payload plus React/Leaflet marker tree can handle smoothly on mid-range devices. The page does not cluster, virtualize the list, or fetch markers by viewport.

Concrete failure scenario: an opted-in travel/archive topic contains 8,000-10,000 geotagged photos. `/map` serializes the full marker array, renders a 10,000-row list, and Leaflet mounts thousands of marker objects on load, causing long main-thread work, high memory use, and poor INP.

Fix: lower the initial cap substantially and add viewport-bbox fetching with clustering. Keep the accessible list scoped to visible or paged results, with an explicit "show more/list all" path if needed. Use server-side tile/bbox APIs for marker data instead of one full payload.

### PERF-C24-03 - Infinite masonry keeps all loaded cards mounted

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/components/home-client.tsx:124-130` stores all loaded images in `allImages` and appends by copying the accumulated array.
- `apps/web/src/components/home-client.tsx:286-411` maps every accumulated image into masonry card DOM and picture/image elements.
- `apps/web/src/components/load-more.tsx:41-61` fetches more pages and calls `onLoadMore(page.images)` when the sentinel loads another page.

Problem: the infinite-scroll path has no virtualization, windowing, or automatic-load cap. Every page a visitor loads remains in React state, the DOM, image lazy-load bookkeeping, and CSS column layout.

Concrete failure scenario: a visitor scrolls through thousands of images on mobile. DOM size, heap, layout cost, and React reconciliation grow linearly with scroll depth, degrading scroll smoothness and interaction latency.

Fix: virtualize/window the masonry grid or cap automatic infinite loading after a fixed number of pages and switch to explicit pagination. Preserve scroll restoration with cursors/page anchors while recycling offscreen cards.

### PERF-C24-04 - CSV export still materializes the whole export in memory

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:79-84` documents the in-memory CSV profile.
- `apps/web/src/app/[locale]/admin/db-actions.ts:102-117` loads up to 50,000 grouped image rows with `GROUP_CONCAT`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:124-152` builds a full `csvLines` array and then joins it into one string.
- `apps/web/src/app/[locale]/admin/db-actions.ts:156-159` returns the full CSV string in the server-action response.

Problem: the 50,000-row cap prevents unbounded OOM, but this still holds the DB result set, per-row CSV strings, and final joined CSV string during one server action. The browser also receives the whole string before download can begin.

Concrete failure scenario: an admin exports a large gallery with long titles/descriptions/tags while public traffic or image processing is active. Node heap and browser heap spike, GC pauses increase, and the admin tab blocks until the full payload arrives.

Fix: move CSV export to an authenticated streaming route or background export job. Stream rows through a CSV formatter with backpressure, or create an owner-only temporary export file and return a normal file response.

## Likely Issues

### PERF-C24-05 - Admin analytics fans out aggregate scans on the shared DB pool

Severity: Low-Medium
Confidence: Medium
Status: Likely

Files/regions:

- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:26-36` starts five analytics queries concurrently in one `Promise.all`.
- `apps/web/src/lib/analytics-data.ts:28-46`, `62-79`, `112-127`, `161-180`, and `192-207` run grouped aggregate queries for photos, topics, countries, shared groups, and referrers.
- `apps/web/src/lib/analytics-data.ts:93-111` and `188-191` document that `window=all` falls back to broader covering-index/temp-table aggregation.

Problem: one admin page can consume several DB pool slots and aggregate over view-event tables at the same time. The default window is bounded, but the `all` window intentionally removes the date predicate.

Concrete failure scenario: an admin opens `/admin/analytics?window=all` during a traffic spike or upload/backfill. Five grouped scans contend with public pages, rate limits, queue work, and view flushing on the same DB.

Fix: add short TTL caching per analytics window, sequence/cap analytics aggregate concurrency, or materialize daily/hourly rollups for dashboard summaries.

### PERF-C24-06 - Topic navigation helper computes sitemap-only freshness on public page renders

Severity: Low
Confidence: Medium
Status: Likely

Files/regions:

- `apps/web/src/lib/data.ts:509-529` returns all topics and computes `last_image_updated_at` with a correlated `SELECT MAX(images.updated_at)` per topic.
- `apps/web/src/db/schema.ts:116-120` has image indexes for processed/capture/created/topic paths but no `(topic, processed, updated_at)` index for that max lookup.
- `apps/web/src/components/nav.tsx:8-20` calls `getTopicsCached()` for the public nav.
- `apps/web/src/app/[locale]/(public)/layout.tsx:4-12` includes `Nav` on public pages.
- `apps/web/src/app/[locale]/(public)/page.tsx:156`, `[topic]/page.tsx:168-170`, and `c/[slug]/page.tsx:103-108` also request topics for page-body data.

Problem: sitemap freshness needs `last_image_updated_at`, but nav/body topic lists do not. Dynamic public pages still pay correlated aggregate work that is not needed to render labels, order, images, or map visibility.

Concrete failure scenario: a gallery has many topics and a large image table. Ordinary public page views repeatedly run per-topic `MAX(updated_at)` subqueries; the existing topic index is ordered by capture/created rather than updated time, so the DB has to probe topic partitions rather than seeking directly to the latest update.

Fix: split helpers by purpose. Use a lean `getTopicsForNavigation()` for nav/body rendering and keep `getTopicsWithLastImageUpdatedAt()` for sitemap/lastmod. If freshness is needed frequently, add `(topic, processed, updated_at)` or maintain a denormalized topic timestamp.

## Risks Needing Manual Validation

### PERF-C24-R1 - Semantic and similar search remain bounded brute-force vector scans

Severity: Low-Medium
Confidence: Medium
Status: Risk needing manual validation

Files/regions:

- `apps/web/src/lib/clip-embeddings.ts:36-44` allows `SEMANTIC_SCAN_LIMIT` up to 25,000, defaulting to 2,000.
- `apps/web/src/app/api/search/semantic/route.ts:263-307` scans rows, decodes every embedding, scores every row, and then calls `topK`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:164-201` uses the same scan/score/top-K pattern for similar photos.
- `apps/web/src/lib/clip-embeddings.ts:135-168` decodes blobs to `Float32Array` and sorts all threshold-passing matches before slicing.

Risk: current same-origin/rate-limit/scan caps are real mitigations, and this is not a confirmed defect at the default 2,000-row scan. If production raises the cap toward 25,000 or multiple semantic requests overlap, each request performs thousands of blob decodes, dot products, object allocations, and a full sort of qualifying matches.

Manual validation: capture p95/p99 semantic and similar route latency, heap allocation, and DB time at production-like embedding counts and configured `SEMANTIC_SCAN_LIMIT`.

Fix if hot: move to a vector/ANN index or prefiltered candidate set, maintain a bounded min-heap instead of sorting all matches, and keep the operational cap near measured CPU budget.

### PERF-C24-R2 - Timeline/date archive predicates are still non-sargable by design

Severity: Low
Confidence: High
Status: Risk needing manual validation

Files/regions:

- `apps/web/src/lib/data-timeline.ts:92-116` uses `MONTH(capture_date)` and `DAY(capture_date)` for On This Day.
- `apps/web/src/lib/data-timeline.ts:129-145` selects and orders distinct years with `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:178-213` documents and uses `YEAR(capture_date) = ?` plus optional `MONTH(capture_date) = ?`.

Risk: the code documents the tradeoff as acceptable at personal-gallery scale. At larger row counts or if timeline/archive pages become crawl hotspots, MySQL can use the `processed` prefix but cannot directly seek into `capture_date` through these function predicates.

Manual validation: run `EXPLAIN ANALYZE` for timeline and On This Day queries with production row counts and realistic processed-image distribution.

Fix if hot: rewrite year/month pages to date ranges and add generated month/day columns or a small precomputed date archive table for On This Day.

### PERF-C24-R3 - Image processing is bounded, but format fan-out is still the dominant CPU path

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

Files/regions:

- `apps/web/src/lib/process-image.ts:36-57` caps Sharp/libvips concurrency and disables Sharp cache.
- `apps/web/src/lib/process-image.ts:1220-1437` generates JPEG/WebP/AVIF variants and runs the format branches with `Promise.allSettled`.
- `apps/web/src/lib/image-queue.ts:87-90` defaults queue concurrency to 1 with a cap.
- `apps/web/src/lib/admin-backfill-runner.ts:96-142` clamps backfill concurrency while reserving live DB connections.

Risk: no unbounded queue/memory bug was confirmed. The remaining risk is operational: if `image_sizes`, source megapixels, or queue/backfill concurrency are raised, per-image work scales by formats times sizes, and AVIF is especially CPU-heavy.

Manual validation: profile queue/backfill CPU, RSS, and wall time with the largest expected source images and current production `image_sizes`.

Fix if hot: keep queue/backfill concurrency conservative, avoid increasing derivative counts without a benchmark, and consider lower-priority/off-host processing for bulk backfills.

## Final Sweep

- Query efficiency: swept listings, smart collections, map, timeline, analytics, topic navigation, semantic/similar search, share/photo lookups, and schema indexes. The findings above cover the query shapes that still have meaningful scale risk.
- Concurrency and memory: swept upload admission, image queue, backfill runner, CLIP inference queue, bounded maps, rate limiters, shared-view buffering, and CSV export. Queue/backfill/CLIP paths are bounded; CSV export remains the clear whole-payload memory issue.
- Image processing: checked Sharp concurrency/cache settings, max input pixel guard, AVIF probe singleton, variant generation, atomic output verification, queue retry/deletion handling, and backfill concurrency. No new unbounded image-processing defect was confirmed.
- Cache behavior: checked public dynamic routes, React `cache()` usage, derivative upload serving, service-worker helpers, sitemap/feed/OG surfaces, and config reads. The main cache-related issue is dynamic public pages paying exact counts rather than caching or decoupling totals.
- UI responsiveness: checked masonry, load-more, search debounce/abort, map route splitting, Leaflet marker rendering, lightbox/photo viewer preloading, and histogram worker use. The confirmed UI issues are all-loaded masonry DOM and all-at-once map markers/list.
- Skipped-file confirmation: no review-relevant application/source area was intentionally skipped. Generated/binary artifacts, screenshots, dependency directories, and historical review files were not audited line-by-line except where needed for current-cycle context.

## Validation Notes

No source edits were made. No benchmarks, production `EXPLAIN ANALYZE`, lint, typecheck, or test suite were run because this was a static review artifact task. Findings that depend on data scale should be prioritized with production-like row counts, route timing, heap profiles, and MySQL query plans before implementing indexes or changing UI contracts.

Finding count: 6 issues plus 3 manual-validation risks. Critical/high findings: 0.
