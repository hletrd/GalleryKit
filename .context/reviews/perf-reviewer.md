# Perf Reviewer Report - Cycle 22

Review lane: `perf-reviewer`
Scope: current `HEAD` `ec7cd52883d4973e32f056324620154228190335`
Mode: review-only. Application/source files were not modified.

## Inventory

I read the workspace rules in `AGENTS.md` and `CLAUDE.md`, then reviewed the repository from the performance, concurrency, CPU/memory, DB query-shape, image-processing, caching, UI responsiveness, bundle, and deployment-resource angles. I also compared against the cycle 21 perf report and checked the current `2cc619bb..HEAD` delta so fixed/stale findings were not re-filed.

Relevant files and regions examined:

- Public gallery and pagination: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`, and `apps/web/src/lib/smart-collections.ts`.
- Timeline, archive, map, share, and photo viewer flows: `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/components/map/map-client.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, and `apps/web/src/components/histogram.tsx`.
- Search and CLIP: `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, and `apps/web/src/app/actions/embeddings.ts`.
- Upload/image processing/backfill: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/color-detection.ts`, and `apps/web/src/lib/icc-chromaticity.ts`.
- Admin, analytics, export, and runtime controls: `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/bounded-map.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/data.ts`, and `apps/web/src/db/schema.ts`.
- Caching/deployment/bundle surfaces: `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/sw-cache.ts`, `apps/web/scripts/build-sw.ts`, root `package.json`, and package/workspace metadata.

## Findings

### PERF-C22-01 - Dynamic public gallery first pages still pay grouped exact-count work

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/data.ts:878-907` builds `getImagesLitePage()` with `LEFT JOIN imageTags`, `LEFT JOIN tags`, `GROUP BY images.id`, `COUNT(*) OVER()`, ordered pagination, and offset.
- `apps/web/src/lib/data.ts:1446-1461` repeats the same `COUNT(*) OVER()` grouped shape for initial smart-collection pages.
- `apps/web/src/app/[locale]/(public)/page.tsx:14-16` disables ISR for home, and `apps/web/src/app/[locale]/(public)/page.tsx:164-166` calls the counted query for the first 30 cards.
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17` disables ISR for topics, and `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:174-176` calls the same counted query.
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:14` disables ISR for smart collections, and `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101` calls the counted smart-collection query.
- `apps/web/src/components/home-client.tsx:267-269` renders the exact `totalCount`, keeping the count in the public hot-path contract.

Problem: the first public page returns a small card set but asks MySQL to aggregate tags, group images, sort, and compute an exact count over the full matching set. Because the routes are `revalidate = 0`, the work is paid per request for home, topic, tag-filtered, and smart-collection first pages.

Concrete failure scenario: a larger gallery reaches tens of thousands of processed images with several tags per image. A crawler burst or social/link traffic against `/`, `/<topic>`, `?tags=...`, or `/c/<slug>` repeatedly forces full grouped count work just to render about 30 cards, competing with upload processing, public search, analytics, and rate-limit queries on the same single web/DB topology.

Suggested fix: split the initial card query into a bounded ID/keyset page query plus a second tag fetch only for those returned IDs. Remove exact totals from public first paint, cache them briefly, or compute a separate cheap count that does not share the tag aggregation. For smart collections, treat exact totals as optional/async unless a collection predicate is known to be cheap and index-backed.

### PERF-C22-02 - Infinite masonry keeps all loaded cards mounted

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/components/home-client.tsx:124-129` stores loaded images in `allImages` and appends each page by copying the full accumulated array.
- `apps/web/src/components/home-client.tsx:195-197` derives render count directly from that accumulated array.
- `apps/web/src/components/home-client.tsx:286-410` maps every accumulated image into masonry card DOM and picture elements.
- `apps/web/src/components/load-more.tsx:41-64` fetches and appends every loaded page.
- `apps/web/src/components/load-more.tsx:116-132` auto-triggers additional loads when the sentinel intersects.

Problem: the load-more path has no virtualization, windowing, or automatic-load cap. Every page a visitor scrolls through stays live in React state, DOM nodes, image loading bookkeeping, and column layout calculations.

Concrete failure scenario: a visitor scrolls deeply through a large gallery on a mid-range phone. Heap use, DOM size, image observer/lazy-load work, CSS column layout cost, and React reconciliation grow linearly with each loaded page, degrading scroll smoothness and INP.

Suggested fix: virtualize/window the masonry list or cap automatic infinite loading after a fixed number of pages and switch to explicit pagination. If scroll restoration is required, preserve cursor/page anchors while recycling offscreen cards instead of keeping the whole scroll history mounted.

### PERF-C22-03 - CSV export still materializes the full export in server and browser memory

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:79-84` documents the server action's in-memory CSV profile.
- `apps/web/src/app/[locale]/admin/db-actions.ts:102-117` loads up to 50,000 grouped image rows with `GROUP_CONCAT(...)`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:124-152` builds a `csvLines` array, clears the result array, then joins the full CSV string.
- `apps/web/src/app/[locale]/admin/db-actions.ts:156-159` returns the full CSV string in the server-action response.

Problem: the export is bounded but still holds a large DB result set, per-row CSV strings, and the final joined CSV string during one server action. The client also receives the full string before it can start the download, duplicating memory pressure in the browser. The later backup download route streams files, but this CSV export remains a whole-payload action response.

Concrete failure scenario: an admin exports a 50,000-row gallery while public traffic or image processing is active. Long descriptions and many tags can push the CSV well beyond the nominal comment estimate, causing Node GC pressure and a visible pause in the admin tab before download begins.

Suggested fix: move CSV export to an authenticated streaming route or background export job. Stream rows through a CSV formatter with backpressure, or write a temporary owner-only export file and return a file response. Keep the cap/truncation warning, but avoid returning the full CSV as a server-action string.

### PERF-C22-04 - Admin analytics fans out aggregate scans on the shared DB pool

Severity: Low-Medium
Confidence: Medium
Status: Likely

Files/regions:

- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36` starts five analytics queries in one `Promise.all`.
- `apps/web/src/lib/analytics-data.ts:28-46` aggregates top photos.
- `apps/web/src/lib/analytics-data.ts:62-79` aggregates top topics.
- `apps/web/src/lib/analytics-data.ts:112-127` aggregates country breakdowns.
- `apps/web/src/lib/analytics-data.ts:161-180` aggregates shared-group views.
- `apps/web/src/lib/analytics-data.ts:192-207` aggregates referrers.
- `apps/web/src/lib/analytics-data.ts:93-111` and `apps/web/src/lib/analytics-data.ts:188-191` note that the `all` window falls back to broader covering-index/temp-table aggregation.

Problem: the analytics page runs five grouped aggregate queries concurrently against the same pool used by public pages, uploads, queue state, rate limits, and view flushing. The default windows are bounded by date predicates, but `window=all` removes the date predicate and several queries become broader grouped scans.

Concrete failure scenario: an admin opens `/admin/analytics?window=all` during upload/backfill or a traffic spike. Five aggregate scans start at once, consuming pool slots and DB CPU/temp-table capacity, increasing latency for unrelated requests.

Suggested fix: materialize hourly/daily analytics rollups and query those for admin summaries. Short term, cache analytics results per window for a small TTL and sequence or cap aggregate concurrency so one admin page cannot consume a large share of the pool.

### PERF-C22-05 - Timeline/date archive filters remain non-sargable on dynamic public pages

Severity: Low
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/data-timeline.ts:88-116` uses `MONTH(capture_date)` and `DAY(capture_date)` for On This Day.
- `apps/web/src/lib/data-timeline.ts:129-142` selects and orders distinct years with `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:178-207` documents and uses `YEAR(capture_date) = ?` plus optional `MONTH(capture_date) = ?`.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:16` disables ISR, and `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84` loads years and the selected year's images per render.

Problem: MySQL can use the `processed` prefix, but the date functions prevent direct seeks into the `capture_date` portion of `idx_images_processed_capture_date`. The selected timeline page then joins/group-aggregates tags for up to 501 rows.

Concrete failure scenario: `/timeline` or a `?year=` URL becomes a crawl or visitor hotspot on a larger archive. MySQL repeatedly evaluates `YEAR()`/`MONTH()` over processed rows before it can return the year slice that a range predicate could seek directly.

Suggested fix: rewrite year/month filters as range predicates, such as `capture_date >= 'YYYY-01-01' AND capture_date < 'YYYY+1-01-01'`, with month ranges when needed. For On This Day, add generated `capture_month`/`capture_day` columns with a composite index, or precompute a small date archive table.

### PERF-C22-06 - Shared topic lists compute per-topic last image timestamps on common page renders

Severity: Low
Confidence: Medium
Status: Likely

Files/regions:

- `apps/web/src/lib/data.ts:509-529` returns all topics and adds `last_image_updated_at` through a correlated `SELECT MAX(images.updated_at)` per topic.
- `apps/web/src/db/schema.ts:115-119` defines image indexes for processed/capture/created/topic paths, but none align with `(topic, processed, updated_at)` for that max lookup.
- `apps/web/src/components/nav.tsx:8-20` calls `getTopicsCached()` for the public nav.
- `apps/web/src/app/[locale]/(public)/layout.tsx:4-8` includes `Nav` on public pages.
- `apps/web/src/app/[locale]/(public)/page.tsx:151-156`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:166-170`, and `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:103-108` also request topics for page body data.
- `apps/web/src/app/sitemap.ts:40-43` and `apps/web/src/app/sitemap.ts:64-72` use the timestamp for sitemap lastmod; that path is hourly ISR-cached.

Problem: sitemap freshness needs topic-level `last_image_updated_at`, but the general topic-list helper computes it for nav and page-body callers too. On dynamic public pages this adds correlated aggregate work that is unrelated to rendering the nav labels.

Concrete failure scenario: a gallery has many topics and a large image table. Ordinary home/topic/smart-collection page views repeatedly run per-topic `MAX(updated_at)` subqueries, scanning each topic's processed image slice because the available topic index is ordered by capture/created rather than updated time.

Suggested fix: split topic helpers by purpose. Keep a lean `getTopicsForNavigation()` for nav/body lists, and a sitemap-specific `getTopicsWithLastImageUpdatedAt()` that is ISR-cached. If topic lastmod is needed frequently outside the sitemap, add an index such as `(topic, processed, updated_at)` or maintain a denormalized topic timestamp updated on image changes.

## Final Sweep

- Image processing and queueing were rechecked across `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, and sidecar scripts. Sharp cache is disabled, libvips concurrency is capped relative to CPU/format fan-out, queue concurrency defaults to 1, backfill concurrency is capped, and deletion/retry maps are bounded. No new image-processing CPU/memory defect was confirmed.
- CLIP semantic and similar search were rechecked across the routes and `clip-model.ts`/`clip-embeddings.ts`. Inference slots, pending queue, scan limit, top-K limit, request size, same-origin checks, and rate limits are explicit. The brute-force vector scan is still the major intentional CPU path, but current caps make it an operational tuning concern rather than a code defect without production plan data.
- Rate-limit and module-level Maps were swept through `bounded-map.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `upload-tracker-state.ts`, `blur-data-url.ts`, and the shared-group view buffer in `data.ts`. The high-cardinality structures I found are bounded, expired, or tied to bounded request data.
- Feed, sitemap, OG, upload-serving, service-worker, and backup download paths were checked for cache headers, buffering, and route caps. The backup download route streams from a validated file handle; OG photo fetches are byte/time capped; sitemap is ISR-cached; derivative cache policy is consistent with mutable backfill bytes.
- Bundle/UI surfaces were sampled through nav/search/map/lightbox/histogram/gallery components. The map and Leaflet CSS are route-split, search uses debouncing and aborts semantic requests, and histogram work is worker-backed. The unbounded masonry DOM growth remains the main UI responsiveness finding.
- Deployment/resource files were checked in `Dockerfile`, `docker-compose.yml`, `deploy.sh`, and `next.config.ts`. The deployment remains intentionally single-instance/single-writer, uses standalone output, preserves bind-mounted mutable data, and prunes Docker artifacts after a successful `up -d`. No new deployment-resource defect was confirmed.

Skipped files: no source area was intentionally excluded, but this was a static source review rather than an exhaustive line-by-line audit of every generated/test/review artifact. Binary screenshots and historical review artifacts were not reviewed beyond using prior perf reports for context.

## Validation Notes

No source edits were made. No benchmark, production `EXPLAIN ANALYZE`, lint, typecheck, or test suite was run; this review is based on static inspection of current HEAD. DB-query findings should be prioritized with production-like row counts and query plans before choosing exact indexes, rollups, or UI contract changes.

Finding count: 6 current performance findings, 0 critical/high.
