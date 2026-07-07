# Cycle 7 Lane C Performance Review

Role: `perf-reviewer`
Scope: read-only source review, except this artifact. Source code was not modified.
Method: built a review inventory first, then traced image processing, queues, DB access/index use, public pages/API, analytics buffers, semantic search, React client components, cache/revalidation, and deploy/runtime scripts.

## Inventory Reviewed

- Image processing and queues: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- DB queries and indexes: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/drizzle/*`, `apps/web/scripts/migrate.js`.
- Public pages/API: `apps/web/src/app/[locale]/(public)/**`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/photo/[id]/route.ts`, feed/sitemap/robots routes, public actions in `apps/web/src/app/actions/public.ts`.
- Analytics and rate limiting: `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/rate-limit.ts`, public view recorders.
- React client/UI responsiveness: home grid/load-more, lightbox, map components, semantic search UI, admin upload/backfill/status components, media settings, and client wrappers under `apps/web/src/components/**`.
- Cache/revalidation/runtime: `revalidate` exports on public routes, React `cache()` wrappers in data/config modules, `apps/web/deploy.sh`, root deploy helper, `Dockerfile`, `docker-compose*.yml`, `next.config.ts`, `middleware.ts`, and nginx config.

## Findings

### PERF-C7-01: Public map can hydrate 10,000 Leaflet markers plus 10,000 list rows

- Severity: Medium
- Confidence: High
- Status: Confirmed from code
- Location: `apps/web/src/lib/data.ts:1736-1768`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-105`, `apps/web/src/components/map/map-client.tsx:80-140`

`getMapImages()` caps public GPS rows at `MAP_MAX_MARKERS = 10000` and returns all matching processed, map-visible photos in one query. `/map` is `revalidate = 0`, fetches that full set for every request, serializes all markers into the client island, renders all markers through React Leaflet, and also renders a duplicate accessible `<ul>` with one link per marker. `FitBounds` also allocates latitude/longitude arrays and spreads them into `Math.min`/`Math.max`.

Concrete failure scenario: once an operator enables map visibility for several high-volume topics, a mobile visit to `/map` can receive and hydrate thousands of marker objects, create thousands of Leaflet marker/popup components, and render thousands of DOM list items. That can freeze the main thread, inflate SSR response size, and make the page unresponsive even though the SQL query itself is bounded.

Suggested fix: replace the one-shot full-marker payload with a viewport/bounds API and cluster/canvas/WebGL marker layer, or lower the initial cap and require zoom/filtering to load more. Virtualize or paginate the accessible photo list. Compute bounds in one pass instead of allocating/spreading two arrays.

### PERF-C7-02: Timeline and On This Day public paths use non-sargable date predicates on uncached SSR pages

- Severity: Medium
- Confidence: High
- Status: Confirmed from code; runtime cost should be quantified with production `EXPLAIN`
- Location: `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:125-145`, `apps/web/src/lib/data-timeline.ts:172-207`, `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:232-234`, `apps/web/src/components/on-this-day-widget.tsx:10-22`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19-94`

`getOnThisDayImages()` filters with `MONTH(capture_date)` and `DAY(capture_date)`. `getTimelineYears()` uses `YEAR(capture_date)` for distinct/order, and `getTimelineImages()` uses `YEAR(capture_date)` plus optional `MONTH(capture_date)`. The comments correctly note these predicates are not sargable. The risk is amplified because the homepage and timeline page both export `revalidate = 0`; the homepage renders `OnThisDayWidget` during SSR, and `/timeline` runs both the year-list and selected-year queries per request.

Concrete failure scenario: as the gallery grows, every homepage hit scans the processed/capture-date population to find up to six On This Day images, and every timeline hit scans again for year discovery plus the selected year. Crawlers or repeated public traffic can turn low-cardinality widgets into sustained DB CPU despite small response sizes.

Suggested fix: make year filtering sargable with date ranges (`capture_date >= 'YYYY-01-01' AND capture_date < 'YYYY+1-01-01'`). For month/day matching, add generated stored columns or functional indexes for `capture_year`, `capture_month`, and `capture_month_day`, then query those columns. Add tag-based cache/revalidation for low-churn timeline/on-this-day results and invalidate on image upload, metadata change, and restore.

### PERF-C7-03: Semantic search scans and full-sorts all candidate vectors per public request

- Severity: Low
- Confidence: Medium
- Status: Likely; needs benchmark under production vector counts
- Location: `apps/web/src/lib/clip-embeddings.ts:32-44`, `apps/web/src/lib/clip-embeddings.ts:209-217`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`

`SEMANTIC_SCAN_LIMIT` defaults to 2,000 but can be configured up to 25,000. Both semantic search routes load the most recent embeddings, decode each vector, score every row, then call `topK()`, which filters and sorts the full scored list before slicing to K. The routes have rate limits and abort checks, so this is not unbounded, but the CPU shape is `O(scan_limit * embedding_dim + scan_limit log scan_limit)` per request.

Concrete failure scenario: with `SEMANTIC_SCAN_LIMIT=25000`, concurrent public semantic requests repeatedly decode and score 25k 512-dimensional vectors and full-sort all threshold-passing matches, increasing Node CPU and p95 latency. The DB and route caps prevent runaway behavior, but the route can still become a noticeable CPU hot path.

Suggested fix: keep a fixed-size min-heap or partial-selection buffer of size K while scanning, reducing ranking to `O(scan_limit log K)`. Consider a lower production cap, a cache for frequent query embeddings/results, or a real vector index if gallery size outgrows brute-force scan.

## Positive Performance Evidence

- Image processing sets Sharp global concurrency from a host budget and disables Sharp cache to reduce RSS growth. The encoder uses bounded input pixels, atomic write/rename patterns, and cleanup paths for partially written derivatives.
- The image queue clamps local concurrency against DB pool budget, uses per-image advisory locks, bounded retry maps/timers, cursor-based embedding/backfill scans, and shutdown drain hooks.
- Admin LR upload and regular upload paths have body/content-length caps, multipart parse-slot limits, upload tracker checks, and disk-space preflight checks before expensive processing.
- Analytics final inserts are queued with `ANALYTICS_DB_WRITE_CONCURRENCY = 2` and `ANALYTICS_DB_WRITE_MAX_PENDING = 1000`.
- Main gallery listing paths use paginated accessors and targeted OG metadata accessors rather than loading the entire gallery.
- Backfill scripts use advisory locks, keyset pagination, small batch sizes, and bounded concurrency.
- Public semantic routes rate-limit before expensive inference/scan work and check request aborts around expensive stages.

## Final Sweep

Commonly missed areas checked: N+1 joins in public listing/detail queries, queue saturation, retry timer growth, DB pool contention, blocking upload parsing, sharp memory behavior, unbounded analytics buffers, semantic scan limits, cache/revalidate choices, public route rate limits, map/timeline UI payload size, deploy pruning, and runtime scripts. No additional high-confidence performance defects were found in the reviewed code. Residual risk is operational: production cardinalities, MySQL `EXPLAIN` plans, and browser traces for the large map/timeline cases were not available in this read-only review.
