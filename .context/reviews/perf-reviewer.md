# Cycle 13 Performance / Concurrency Review

Role: `perf-reviewer`  
Date: 2026-07-07  
Scope: CPU/memory, DB/query behavior, caching, async race conditions, UI responsiveness, bundle/build costs, and resource cleanup.  
Mutation boundary: report artifact only. Source code and plans were not modified.

## Inventory

- Guidance read: `AGENTS.md`, project `CLAUDE.md`, and the code-review workflow guidance.
- Inventory method: `rg --files`, route/API listing, targeted `rg` sweeps for `PQueue`, `Promise.all`, dynamic routes, `GROUP BY`, non-sargable SQL functions, timers/listeners, upload/body parsing, semantic scans, cleanup directory walks, cache headers, and deploy/runtime settings.
- Performance-relevant files examined: `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/lib/**`, `apps/web/src/db/**`, `apps/web/scripts/**`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, root and web `package.json`, and prior review artifacts under `.context/reviews/`.
- Final sweep covered common missed areas: public dynamic pages, public API/body limits, background queues, image encode fan-out, CLIP/vector scans, analytics fire-and-forget writers, upload quota maps, DB restore/maintenance drains, client event listener cleanup, worker cleanup, map hydration, and derivative/original file cleanup.

## Findings

### PERF-C13-01: Batch image deletion repeatedly scans full derivative directories

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- Location: `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:588-627`, `apps/web/src/lib/process-image.ts:644-660`

`deleteImages()` bounds selected images and chunks cleanup, but each selected image still calls `deleteImageVariantsStrict(..., [])` for WebP, AVIF, and JPEG. Passing `[]` triggers full-directory scan mode so historical size variants are found. That means a 100-image batch can do up to 300 derivative-directory walks.

Failure scenario: on a NAS-backed or disk-constrained host with tens of thousands of derivative files, a large admin delete can spend seconds walking the same three directories repeatedly after DB rows are already gone, contending with image serving and encoder writes.

Suggested fix: add a batch cleanup helper that scans each derivative directory once per batch, indexes entries by selected base filename prefixes, and deletes matching variants. Keep strict single-image cleanup as-is, but avoid per-image full scans inside `deleteImages()`.

### PERF-C13-02: Live queue and in-app backfill reserve pool headroom independently, not globally

- Severity: Medium
- Confidence: High
- Status: Confirmed concurrency issue
- Location: `apps/web/src/db/index.ts:21-41`, `apps/web/src/lib/image-queue.ts:120-140`, `apps/web/src/lib/image-queue.ts:431-440`, `apps/web/src/lib/admin-backfill-runner.ts:96-141`, `apps/web/src/lib/admin-backfill-runner.ts:713-724`

The web DB pool has `connectionLimit: 10`. The live image queue clamps itself to leave roughly half the pool for live requests. The in-app admin backfill uses a similar local formula. Those formulas are correct in isolation, but they do not subtract each other when both background lanes run in the same web process.

Failure scenario: an admin starts color backfill while uploads are being processed. The queue and backfill can each believe they reserved five live connections, while their combined lock/update pattern can consume nearly all ten pool slots. Public photo pages and admin operations can then sit behind the mysql2 pool queue or hit `queueLimit: 20`.

Suggested fix: introduce one shared background DB/CPU budget for image processing and in-app backfill, or a small advisory semaphore table/lock namespace with weighted leases. Budget workers against the combined active background lanes, not per subsystem.

### PERF-C13-03: Sidecar color backfill concurrency is not pool-budget clamped

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- Location: `apps/web/scripts/backfill-color-pipeline.ts:383-387`, `apps/web/src/db/index.ts:31-41`, `apps/web/src/lib/admin-backfill-runner.ts:129-141`

The sidecar backfill script accepts `BACKFILL_CONCURRENCY` with fallback 2 and max 8, then constructs `new PQueue({ concurrency })`. Unlike the in-app runner, it does not use the pool-budget formula. The script imports the normal DB module, so each sidecar process can also open a 10-connection pool.

Failure scenario: an operator runs `BACKFILL_CONCURRENCY=8` during live traffic or while the web queue is encoding uploads. The sidecar can drive up to eight encode/update workers plus advisory-lock work from a separate process, increasing MySQL server load and CPU/disk contention outside the web process's safeguards.

Suggested fix: reuse `resolveBackfillConcurrency()` or extract a shared budget helper usable by scripts. Also consider checking for active live queue/backfill locks before allowing high sidecar concurrency, with an explicit override for maintenance windows.

### PERF-C13-04: Dynamic homepage runs a non-sargable on-this-day query on every render

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- Location: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:232-234`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/lib/data-timeline.ts:102-130`, `apps/web/src/db/schema.ts:123-130`

The homepage is `revalidate = 0` and always renders `OnThisDayWidget`. That widget calls `getOnThisDayImages()`, whose filter wraps `capture_date` with `MONTH()` and `DAY()`. The code comment notes this is not sargable, and the image indexes do not include generated month/day keys.

Failure scenario: as dated images grow, every homepage request scans/group-sorts a larger set just to return six rows, alongside the main listing query and count query. This makes home latency and DB CPU scale with archive size.

Suggested fix: add generated `capture_month`/`capture_day` or `capture_month_day` columns and a covering index such as `(processed, capture_month_day, capture_date, created_at, id)`. Query equality on those generated columns. A per-day cache can reduce repeats but should not be the only fix.

### PERF-C13-05: Timeline year list uses `YEAR(capture_date)` on an uncached public route

- Severity: Low
- Confidence: Medium
- Status: Risk needing validation
- Location: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-80`, `apps/web/src/lib/data-timeline.ts:139-159`, `apps/web/src/db/schema.ts:123-130`

`/timeline` is dynamic and always calls `getTimelineYears()`. The query selects and orders by `YEAR(capture_date)`, which prevents direct use of a plain `capture_date` index for year equality/distinct lookup.

Failure scenario: a large archive with many dated images can turn timeline entry into a full processed/date scan plus distinct/order work before the selected-year page query runs.

Suggested fix: add a generated `capture_year` column and index `(processed, capture_year, capture_date, created_at, id)`, or maintain a small year summary table during image writes/backfills. Validate first with `EXPLAIN ANALYZE` on production-like row counts.

### PERF-C13-06: Public listing queries aggregate tags before limiting the page

- Severity: Medium
- Confidence: Medium
- Status: Risk needing validation
- Location: `apps/web/src/lib/data.ts:786-828`, `apps/web/src/lib/data.ts:893-940`

`getImagesLite()` and `getImagesLitePage()` join `image_tags`/`tags`, compute `GROUP_CONCAT`, group by `images.id`, order, and then apply `LIMIT`. The count was split into a lean parallel query, but the row query can still group tag rows for many candidates before returning 30-31 images.

Failure scenario: on broad home/topic pages in a tag-heavy gallery, uncached listing requests can create temporary grouping/sort work proportional to matching images rather than the page size.

Suggested fix: use a two-phase listing query. First fetch page image IDs from `images` using only image predicates and the covering sort index. Then aggregate tags only for those IDs and restore page order in application code or SQL.

### PERF-C13-07: Public text search relies on multi-query substring scans

- Severity: Medium
- Confidence: Medium
- Status: Risk needing validation
- Location: `apps/web/src/lib/data.ts:1574-1655`, `apps/web/src/lib/data.ts:1682-1713`

`searchImages()` runs substring `containsLike` predicates across image text fields, topic labels, tags, and aliases. If the main query does not fill the limit, tag and alias queries run in parallel with their own joins, grouping, and ordering.

Failure scenario: short or low-selectivity terms can scan large parts of `images`, `tags`, and `topic_aliases` per public search attempt. The rate limiter helps, but one allowed request can still be expensive on a large archive.

Suggested fix: validate with `EXPLAIN ANALYZE` for common terms. If this is material, add MySQL FULLTEXT indexes/search mode, a normalized search table, or a trigram-like auxiliary index. Also consider raising the minimum query length for non-semantic search.

### PERF-C13-08: Semantic search and similar-photo routes brute-force embedding blobs per request

- Severity: Medium
- Confidence: Medium
- Status: Risk needing validation
- Location: `apps/web/src/lib/clip-embeddings.ts:36-48`, `apps/web/src/lib/clip-embeddings.ts:80-87`, `apps/web/src/lib/clip-embeddings.ts:188-235`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`, `apps/web/src/lib/rate-limit.ts:393-416`

Semantic routes read up to `SEMANTIC_SCAN_LIMIT` embedding blobs, decode each row, and score in-process. The default scan is 2,000, but the hard cap is 25,000. Semantic rate limiting is process-local, not DB-backed like other public expensive actions.

Failure scenario: at the 25,000 hard cap, a request reads roughly 50 MB of raw 512-dim float vectors before row/object overhead, then scores them on the same Node process that serves SSR and upload queues. Concurrent requests can create GC pressure and event-loop latency.

Suggested fix: keep production caps conservative unless measured. For growth, move to a vector index/store, a cached in-memory matrix with single-flight refresh and worker-thread scoring, or a DB/vector extension. Make semantic rate limiting durable if multi-instance or restarts become common.

### PERF-C13-09: Lightroom upload route may materialize a max-size multipart file before disk streaming

- Severity: Medium
- Confidence: Medium
- Status: Risk needing validation
- Location: `apps/web/src/app/api/admin/lr/upload/route.ts:60-74`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-128`, `apps/web/src/app/api/admin/lr/upload/route.ts:178-186`, `apps/web/src/app/api/admin/lr/upload/route.ts:346-348`, `apps/web/src/lib/process-image.ts:887-923`

The LR route correctly requires `Content-Length`, caps size, and serializes multipart parsing to one in-flight request. However, it calls `request.formData()` before `saveOriginalAndGetMetadata()` streams the resulting `File` to disk. The route therefore depends on Next/undici multipart buffering behavior for peak RSS.

Failure scenario: a 200 MB upload can be represented as a large `File`/Blob during parse, then streamed to disk and decoded by Sharp metadata/blur/color probes. Even with one parser slot, this can produce large transient memory pressure on the web process.

Suggested fix: measure RSS during max-size LR uploads. If material, replace `request.formData()` with a streaming multipart parser that writes the file part directly to the private original directory after auth/content-length checks, then passes the path into the existing metadata pipeline.

### PERF-C13-10: Public map can hydrate up to 10,000 markers and a duplicate accessible list

- Severity: Medium
- Confidence: High
- Status: Confirmed scale issue
- Location: `apps/web/src/lib/data.ts:1741-1791`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/app/[locale]/(public)/map/page.tsx:89-109`, `apps/web/src/components/map/map-client.tsx:77-94`, `apps/web/src/components/map/map-client.tsx:108-140`

`getMapImages()` caps the public map at 10,000 markers. The page serializes that marker array to the client, renders the map markers/popups, and also renders a full accessible `<ul>` over the same marker list. `FitBounds` allocates latitude and longitude arrays and spreads them into `Math.min`/`Math.max`.

Failure scenario: a travel-heavy archive with thousands of GPS-visible photos sends a large RSC/client payload and hydrates thousands of React Leaflet objects. Mobile browsers can become main-thread bound before the map is interactive.

Suggested fix: lower the initial SSR marker cap, cluster or fetch markers by viewport, virtualize/paginate the accessible list, and compute bounds in one pass without spread arrays. If GPS usage grows, add a GPS-oriented index or summary to avoid scanning non-GPS rows.

## Confirmed Mitigations / No Finding

- Image encode CPU is intentionally bounded: Sharp concurrency is divided by format fan-out and cache is disabled (`apps/web/src/lib/process-image.ts:36-57`), while each image still generates WebP/AVIF/JPEG in parallel (`apps/web/src/lib/process-image.ts:1433-1440`).
- Uploads are serialized client-side for browser uploads and LR multipart parsing is process-bounded to one parser slot; this limits self-contention, though PERF-C13-09 still needs RSS validation.
- Analytics fire-and-forget writes are bounded to two active DB writes and 1,000 pending tasks (`apps/web/src/lib/background-db-writes.ts:3-10`, `apps/web/src/lib/background-db-writes.ts:42-75`).
- The single-writer guard uses a dedicated non-pooled MySQL connection and unref'd timers, so it does not permanently consume the app pool or keep the process alive (`apps/web/src/lib/single-writer-guard.ts:18-21`, `apps/web/src/lib/single-writer-guard.ts:142-173`).
- Client components checked for common timer/listener leaks (`home-client`, `load-more`, `search`, `histogram`, `photo-viewer`, `lightbox`, map). The reviewed paths generally abort fetches, clear timers, disconnect observers, terminate workers, or remove listeners.
- Build/runtime costs are mostly accounted for: native-heavy packages are externalized in Next config (`apps/web/next.config.ts:45-50`), Node 24 standalone output is used, and Docker signal handling is documented for graceful drain (`apps/web/Dockerfile:136-148`, `apps/web/Dockerfile:191-198`).
- Static upload derivatives carry a one-hour revalidation cache policy in Next and nginx (`apps/web/next.config.ts:55-73`, `apps/web/nginx/default.conf:215-218`).

## Final Sweep / Skipped Files

- No source, schema, migration, test, deploy, or plan file was edited.
- No files were intentionally skipped after the inventory pass. Low-risk files outside the performance surface, such as static locale text and already-generated UI screenshots, were not line-reviewed because they do not execute or affect concurrency/resource behavior.
- Validation still recommended before implementation: `EXPLAIN ANALYZE` for PERF-C13-04 through PERF-C13-07 on production-like data, RSS profiling for PERF-C13-09, and browser performance traces for PERF-C13-10 on a high-marker fixture.
