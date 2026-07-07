# Cycle 11 Performance / Concurrency / Resource Review

Role: `perf-reviewer`
Date: 2026-07-07
Scope: whole-repository read-only review from performance, concurrency, CPU/memory, database query efficiency, cache behavior, queueing, and UI responsiveness perspectives.
Mutation boundary: report artifact only. No source, schema, plan, deploy, service, database, generated asset, or test fixture was edited.

## Inventory

- Read first: `AGENTS.md`, `CLAUDE.md`.
- Built file inventory with `rg --files`: 909 repository files visible to ripgrep, including 605 TypeScript/TSX files under `apps/web/src`.
- Focused the line-by-line pass on the runtime app and operational surfaces: `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/nginx`, deploy helpers, tests that encode performance contracts, and prior `.context/reviews` history.
- Final missed-issue sweep searched for: dynamic public routes, large limits, offset pagination, `GROUP_CONCAT`/`GROUP BY`, non-sargable date functions, unbounded `Promise.all`, queue/bootstrap fan-out, brute-force embedding scans, cleanup directory walks, cache/rate-limit gaps, and large client hydration paths.

## Findings

### PERF-C11-01: Batch image deletion still scans derivative directories once per image per format

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- Location: `apps/web/src/app/actions/images.ts:735-744`, `apps/web/src/app/actions/images.ts:859-884`, `apps/web/src/lib/process-image.ts:575-664`

`deleteImage()` and `deleteImages()` pass `[]` to `deleteImageVariantsStrict()` so old size variants are removed after image-size changes. That calls `collectImageVariantFilenames()` in full-directory scan mode. The batch action limits selected IDs to 100 and chunks image cleanup, but each image still scans WebP, AVIF, and JPEG directories independently.

Failure scenario: deleting 100 photos on a gallery with tens of thousands of derivative files can perform up to 300 directory walks, with several walks active concurrently. On NAS-backed or disk-constrained deployments this can stall the admin request, contend with image serving and encoder writes, and create avoidable filesystem pressure after the DB rows have already been deleted.

Concrete fix: add a batch cleanup helper for `deleteImages()` that scans each derivative directory once, indexes entries by selected base filename prefixes, and deletes matching variants. Keep single-image cleanup strict, but avoid repeated whole-directory scans inside one batch. If historical-size cleanup is desired globally, move it to a low-priority one-shot sweep keyed by size-config changes.

### PERF-C11-02: Dynamic homepage runs a non-sargable on-this-day query on every render

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- Location: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:232-234`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/lib/data-timeline.ts:102-130`, `apps/web/src/db/schema.ts:123-130`

The public homepage is `revalidate = 0` so every render includes `OnThisDayWidget`. That server component calls `getOnThisDayImages()`, whose predicates are `MONTH(capture_date)` and `DAY(capture_date)`. The code comment correctly notes those predicates are not sargable. Current image indexes include processed/capture/update/topic paths, but no generated month/day key.

Failure scenario: as the archive grows, normal homepage traffic makes MySQL scan and group all processed rows with non-null `capture_date` to find six matching photos. This work runs alongside the homepage masonry query, nav topic/tag queries, and count query, increasing pool pressure and making homepage latency scale with total dated image count rather than the six returned rows.

Concrete fix: add stored generated columns such as `capture_month` and `capture_day` or a `capture_month_day` key, then add a covering index like `(processed, capture_month, capture_day, capture_date, created_at, id)`. Query those equality columns instead of wrapping `capture_date`. A short per-day cache for the widget can further reduce repeated work, but the DB predicate should be made indexable first.

### PERF-C11-03: Public listing queries still aggregate tags before limiting the page

- Severity: Medium
- Confidence: Medium
- Status: Likely risk from current query shape
- Location: `apps/web/src/lib/data.ts:786-828`, `apps/web/src/lib/data.ts:893-940`, `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:20`

The first-page and load-more listing query joins `image_tags` and `tags`, computes `GROUP_CONCAT`, groups by `images.id`, orders by the gallery sort key, and only then applies the page limit. The split count query fixed the prior window-function materialization problem, but the row query can still aggregate tags for many rows outside the returned 30 or 31 items.

Failure scenario: a tag-heavy gallery with broad home/topic pages grows into tens of thousands of processed images. Every uncached public page render and cursor fetch can spend CPU and temporary table work grouping tag rows before the limit can discard almost all of them.

Concrete fix: use a two-phase listing query. First select the page of image IDs using only image-table predicates and the covering sort index. Then join/aggregate tags for those IDs only, preserving the page order. Keep the existing lean count query separate.

### PERF-C11-04: Semantic search and similar-photo routes perform per-request brute-force blob scans on the Node event loop

- Severity: Medium
- Confidence: Medium
- Status: Likely risk when production semantic search is enabled and the embedding table grows
- Location: `apps/web/src/lib/clip-embeddings.ts:36-48`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`, `apps/web/src/lib/rate-limit.ts:393-416`

Both semantic routes read up to `SEMANTIC_SCAN_LIMIT` embedding blobs, decode each row, and score every vector in-process. The default scan is 2,000 rows, but the hard cap is 25,000. The semantic rate limiter is process-local and bounded by IP, unlike the DB-backed public search/load-more limiters.

Failure scenario: with 512-dimension `Float32Array` embeddings, a 25,000-row scan is about 50 MB of raw vector payload before row/object overhead. Multiple concurrent semantic requests can allocate and score large arrays on the same Node process that serves public pages and queues CLIP inference, causing event-loop latency, GC churn, and DB bandwidth pressure even though each request is individually capped.

Concrete fix: move similarity search off the public request path as the dataset grows: use a vector index/store, a materialized in-memory matrix with single-flight refresh and bounded memory, or chunked scoring in a worker thread. Also consider a DB-backed semantic limiter or lower public hard cap so per-process restarts or multi-instance deployments do not reset expensive-work budgets.

### PERF-C11-05: Public map hydrates up to 10,000 markers plus a duplicate list

- Severity: Medium
- Confidence: High
- Status: Confirmed scale issue
- Location: `apps/web/src/lib/data.ts:1741-1777`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/app/[locale]/(public)/map/page.tsx:89-110`, `apps/web/src/components/map/map-client.tsx:77-140`

`getMapImages()` is capped, but the cap is 10,000. The dynamic map page serializes the full marker set into client props, hydrates one React Leaflet `<Marker>` per marker, renders one `<Popup>` per marker, and also renders an accessible `<ul>` over the same marker array. `FitBounds` allocates latitude/longitude arrays and spreads them into `Math.min`/`Math.max`.

Failure scenario: a map-visible travel archive with thousands of GPS photos ships a large RSC/client payload and asks mobile browsers to hydrate thousands of React/Leaflet objects before interaction. The page can become main-thread bound even though the query is technically limited.

Concrete fix: load markers by viewport/bounds with clustering or a canvas/WebGL marker layer. Lower the initial SSR marker cap, virtualize or paginate the accessible list, and compute bounds in a single pass without spread arrays. If map usage becomes common, add a GPS-oriented index or generated `has_gps` key to avoid scanning non-GPS rows.

### PERF-C11-06: Public smart collections can expose expensive predicates on uncached routes

- Severity: Medium
- Confidence: Medium
- Status: Likely risk from current compiler and route behavior
- Location: `apps/web/src/lib/smart-collections.ts:142-147`, `apps/web/src/lib/smart-collections.ts:221-267`, `apps/web/src/lib/data.ts:1488-1544`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-120`

Smart collection AST size is bounded, but `contains` compiles to leading-wildcard `LIKE`, tag `contains` compiles through an `IN` subquery, and the public collection page is dynamic. Initial collection renders run a grouped listing query and a separate count over the compiled condition.

Failure scenario: an admin publishes a collection with broad predicates such as camera/lens `contains` or tag `contains`. Visitors or crawlers repeatedly hitting `/c/[slug]` can force broad image scans, tag subqueries, grouping, and count work on every request.

Concrete fix: classify smart-collection predicates at save/publish time as index-friendly or expensive. Warn or block public publication of expensive shapes, add targeted indexes for supported public predicates, or materialize collection membership and refresh it when image metadata or tags change.

### PERF-C11-07: Admin photo page does duplicate image fan-out for authenticated viewers

- Severity: Low
- Confidence: High
- Status: Confirmed issue
- Location: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:148-159`, `apps/web/src/lib/data.ts:1057-1080`, `apps/web/src/lib/data.ts:1152-1198`

The photo page always starts `getImageCached(imageId)` and then, when the viewer is an admin and the public image exists, calls `getImageForViewerCached(imageId, true)`. Each image fetch path performs the primary image lookup, then fans out to tags, previous image, and next image queries.

Failure scenario: an authenticated admin browsing photo pages performs the public image lookup plus the admin lookup for every page body. With metadata generation also resolving a public image for the same route, admin navigation can do materially more DB work than public navigation and consume extra pool slots for no user-visible benefit.

Concrete fix: resolve `isAdmin()` first or in parallel with config/translation work, then perform exactly one body image fetch using the needed select shape. For example, branch to `getImageForViewerCached(imageId, true)` for admins and `getImageCached(imageId)` for public users. If metadata already needs the public shape, do not use that body fetch as a prerequisite for the admin fetch.

### PERF-C11-08: Startup orphan-temp cleanup uses unbounded stat/unlink fan-out

- Severity: Low
- Confidence: High
- Status: Confirmed issue
- Location: `apps/web/src/lib/image-queue.ts:40-96`, `apps/web/src/lib/image-queue.ts:1226-1230`, `apps/web/src/lib/process-topic-image.ts:146-168`

Image queue bootstrap starts orphan cleanup for derivative temp/backup files and topic temp files. Both cleanup helpers scan directories and then call `Promise.all` over every matching temp file for `stat`, followed by another unbounded fan-out for unlink.

Failure scenario: after a crash, failed backfill, or repeated interrupted deploys, thousands of `.tmp`, `.bak`, or `tmp-*` files can accumulate. The next process start can launch thousands of filesystem operations at once, delaying readiness and risking `EMFILE` or I/O saturation on a small host.

Concrete fix: process stat/unlink work through a small bounded concurrency helper or fixed-size batches. Keep the current age gate and non-fatal cleanup behavior, but cap simultaneous filesystem operations.

## Reviewed Without New Findings

- Maintenance scheduler: prior overlap risk appears fixed. `runMaintenanceSweep()` now single-flights via `maintenanceSweepInFlight` before tracking active sweeps (`apps/web/src/lib/maintenance-scheduler.ts:41-50`).
- Image processing queue: queue concurrency is clamped against the DB pool, embedding bootstrap is single-flighted, and per-image processing uses advisory locks. I did not find a new double-processing path.
- Sharp pipeline: high CPU/memory work is intentional and bounded by queue settings, `sharp.concurrency()`, input-pixel limits, and `sharp.cache(false)`. The parallel WebP/AVIF/JPEG generation remains a throughput/latency tradeoff rather than a correctness bug.
- Public route rate limits: search/load-more and mutating public APIs use pre-increment limiters before expensive work. Semantic routes remain process-local by design under the documented single-instance topology, which is why they are reported as a scale risk above.
- Cache policy: uploaded derivative cache headers avoid `immutable`, matching the documented backfill-in-place behavior. Service-worker caches are bounded.
- Deploy disk hygiene: deploy health-checks before prune and avoids `volume prune -a`; no new deploy-time resource issue was found in the static pass.

## Final Missed-Issue Sweep

No Critical or High performance/concurrency defect was confirmed in this static review. The main remaining risks are bounded but scale-sensitive: repeated derivative directory scans, non-sargable dynamic homepage queries, grouped listing aggregation before limit, brute-force semantic vector scans, large map hydration, expensive public smart-collection predicates, duplicate admin photo DB fan-out, and unbounded temp-cleanup filesystem fan-out.

No load tests, browser traces, production MySQL `EXPLAIN`, production deploy commands, or database mutations were run. The review is based on static inspection, repository inventory, current source line references, and cross-file behavior tracing.
