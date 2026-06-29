# Perf Reviewer Report - Cycle 19

Review lane: `perf-reviewer`
Scope: current `HEAD` (`26f1a66d033ae247b1841f18dfa893c77463557f`)
Mode: review-only. Source files were not modified.

## Inventory

I read the workspace `AGENTS.md` instructions and `CLAUDE.md`, then inventoried the tracked performance/concurrency surface. The focused tracked inventory covered 549 files across `apps/web/src`, `apps/web/scripts`, Drizzle schema/migrations, nginx/service-worker/runtime config, and the prior `.context/reviews` / `.context/plans` performance history.

Relevant paths examined:

- Data/query paths: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `smart-collections.ts`, `analytics-data.ts`, Drizzle schema indexes, public pages, admin dashboard/analytics pages, public search/load-more actions, semantic/similar routes.
- CPU/memory/background paths: `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, CLIP model/embedding helpers, browser and Lightroom upload paths, GPS stripping, sidecar backfill scripts.
- Runtime/cache paths: `db/index.ts`, instrumentation/shutdown, `serve-upload.ts`, `public/sw.template.js`, generated `public/sw.js`, nginx, Docker/Next config.
- UI responsiveness paths: masonry home grid/load-more, search UI, photo viewer/lightbox, map client, upload dropzone, timeline/year/share grids, histogram worker.
- Missed-issue sweep: repo-wide static scans for `COUNT(*) OVER`, leading scans, `fs.readFile`, `Buffer.from`/`Buffer.concat`, long `Promise.all` fanout, workers/timers/listeners, locks, and existing TODO/PERF/deferred notes.

## Findings

### PERF-C19-01 - Image queue can starve the shared MySQL pool while Sharp work holds advisory-lock connections

Severity: Medium
Confidence: High

Files/regions:

- `apps/web/src/db/index.ts:23-38`
- `apps/web/src/lib/image-queue.ts:76-90`
- `apps/web/src/lib/image-queue.ts:446-472`
- `apps/web/src/lib/image-queue.ts:513-630`
- `apps/web/src/lib/image-queue.ts:812-815`

Problem: the shared MySQL pool has 10 connections and queue limit 20. Each image-processing job acquires a MySQL advisory lock on a pooled connection, then keeps that same connection open while it resolves the original, loads config if needed, and runs `processImageFormats()` / Sharp work. `QUEUE_CONCURRENCY` defaults to 1, but can be raised to 8.

Failure scenario: an operator raises `QUEUE_CONCURRENCY` during a large upload or bootstrap. Eight active jobs can pin eight of ten DB connections for CPU/IO-bound encodes, while those jobs and live requests still need transient DB connections for row checks, config reads, status writes, public pages, search, and rate limits. The pool queue can fill behind encode-duration locks, causing request latency spikes or DB queue failures.

Fix: replace the long advisory-lock hold with a durable short DB claim (`UPDATE ... WHERE processed=false AND claim expired`) and release the DB connection before Sharp work, then re-check before final update. If advisory locks remain, move them to a dedicated lock pool whose budget is not shared with live request queries, and cap queue concurrency from the effective pool budget the way `admin-backfill-runner` already does.

### PERF-C19-02 - Initial listing and smart-collection pages still combine tag aggregation with `COUNT(*) OVER()`

Severity: Medium
Confidence: High

Files/regions:

- `apps/web/src/lib/data.ts:878-914`
- `apps/web/src/lib/data.ts:1409-1453`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-103`
- `apps/web/src/db/schema.ts:115-120`

Problem: initial home/topic/admin-lite and smart-collection page fetches select image fields, join tags, `GROUP_CONCAT`, `GROUP BY images.id`, sort by gallery chronology, and compute `COUNT(*) OVER()` before returning a small page. The cursor/load-more path is better, but the first-page path still asks MySQL to count/group the full match set.

Failure scenario: a gallery reaches tens of thousands of photos with multiple tags per image, or a public smart collection matches a broad slice. A crawler or repeated public first-page requests can force large join/group/window work to return about 30-100 cards.

Fix: split the query. First fetch page IDs with an indexed keyset query and `LIMIT pageSize + 1`; then fetch tags only for those IDs. Remove exact totals from public hot paths, cache them, or compute them through a separate cheap count with its own plan. For smart collections, keep the cursor-only branch and avoid `COUNT(*) OVER()` on initial public render unless the UI truly needs exact `totalCount`.

### PERF-C19-03 - Public keyword search uses leading-wildcard scans after admission

Severity: Medium
Confidence: High

Files/regions:

- `apps/web/src/app/actions/public.ts:236-318`
- `apps/web/src/lib/data.ts:1482-1624`

Problem: the public search action validates, pre-increments in-memory and DB-backed rate limits, then calls `searchImages()`. The data path runs `%term%` matching across image text/camera/lens/topic fields and may also run tag-name and alias searches. Result counts are bounded, but leading wildcards are not selective on normal B-tree indexes.

Failure scenario: distributed users or crawlers submit many valid short terms. Per-IP limits reduce abuse, but admitted requests can still scan a large processed-image slice and compete with the single shared MySQL pool.

Fix: move keyword search to an indexed search surface: MySQL FULLTEXT/ngram, a normalized materialized search table, or a dedicated search index. Until then, consider stricter short-query handling and skip tag/alias branches when the query is too broad to be selective.

### PERF-C19-04 - Semantic and similar search brute-force scan and score embeddings on the request thread

Severity: Low-Medium
Confidence: High

Files/regions:

- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/lib/clip-embeddings.ts:164-168`
- `apps/web/src/app/api/search/semantic/route.ts:259-303`
- `apps/web/src/app/api/search/similar/[id]/route.ts:142-175`

Problem: semantic and similar search cap the scan, but they still fetch up to `SEMANTIC_SCAN_LIMIT` embeddings, decode every vector, compute a dot/cosine score, filter, sort, and slice in the Next.js request process. The default scan cap is 2,000 and the hard env clamp is 25,000.

Failure scenario: production semantic search is enabled and the corpus exceeds the default scan limit, or an operator raises the limit for recall. A burst of admitted searches can spend CPU and heap on vector decode/scoring/sort, blocking the Node event loop and contending with public rendering.

Fix: use a vector index/ANN store or move scoring to a worker thread with bounded concurrency and cancellation. If the current in-process scan remains, keep the cap conservative, add request-time budget logging, and replace full sort with a fixed-size min-heap for top-K.

### PERF-C19-05 - GPS stripping materializes large retained originals in memory

Severity: Low-Medium
Confidence: High

Files/regions:

- `apps/web/src/lib/process-image.ts:1737-1818`
- `apps/web/src/lib/gps-exif-strip.ts:222-360`
- `apps/web/src/lib/gps-exif-strip.ts:379-575`
- `apps/web/src/app/actions/images.ts:383-395`
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`

Problem: upload save streams originals to disk, but `stripGpsFromOriginal()` then reads the full retained original with `fs.readFile(filePath)`. The lossless scrubbers copy whole buffers for JPEG/TIFF/HEIF/WebP, and fallback re-encode can add Sharp memory pressure.

Failure scenario: GPS stripping is enabled and an admin ingests several large 150-200 MB originals. Even with sequential browser upload behavior, one request can hold the original buffer plus copied scrubbed buffers and native Sharp allocations, creating RSS spikes and GC pauses on the documented small single-host deployment.

Fix: add a process-wide GPS-strip semaphore and stricter max-size guard for in-process stripping. Longer term, implement streaming/container-segment rewriting for JPEG/WebP/TIFF/ISOBMFF so the whole original and its copy are not resident at once.

### PERF-C19-06 - Batch image deletion repeats derivative-directory scans per image and format

Severity: Low-Medium
Confidence: High

Files/regions:

- `apps/web/src/app/actions/images.ts:818-842`
- `apps/web/src/lib/process-image.ts:575-664`

Problem: batch delete limits image cleanup concurrency, but each image still calls `deleteImageVariantsStrict(..., [])` for WebP, AVIF, and JPEG. Passing `[]` intentionally scans the whole derivative directory to catch historical size variants, so deleting 100 images can cause 300 full directory scans.

Failure scenario: an admin bulk-deletes a large set on NAS-backed storage or after many size changes. DB deletion commits first, then the action spends substantial wall time walking the same directories repeatedly and doing heavy disk I/O.

Fix: add a batch cleanup helper that scans each derivative directory once, matches all selected basenames/prefixes, and unlinks matches with bounded concurrency. Keep strict failure aggregation. Alternative: delete deterministic current-size files inline and move historical orphan cleanup to a maintenance sweep.

### PERF-C19-07 - Public map can serialize and hydrate 10,000 markers plus 10,000 fallback links

Severity: Low-Medium
Confidence: Medium-High

Files/regions:

- `apps/web/src/lib/data.ts:1641-1677`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`
- `apps/web/src/components/map/map-client.tsx:76-143`

Problem: `getMapImages()` caps output at 10,000 rows, but the map page serializes all markers, renders an accessible fallback list entry for each marker, computes bounds from full latitude/longitude arrays, and mounts one Leaflet `<Marker>` per row.

Failure scenario: a large GPS-visible gallery opens `/map` on mobile. The server ships a large payload, React hydrates thousands of fallback links, and Leaflet creates thousands of marker layers before the page is comfortably interactive.

Fix: move map data to a bbox/paged API with clustering. Collapse or virtualize the fallback list. If all-marker mode remains, add a generated `has_gps`/map-visible column and an index matching the public map filter/order.

### PERF-C19-08 - Timeline/archive predicates use non-sargable date functions

Severity: Low-Medium
Confidence: High

Files/regions:

- `apps/web/src/lib/data-timeline.ts:88-116`
- `apps/web/src/lib/data-timeline.ts:125-145`
- `apps/web/src/lib/data-timeline.ts:172-207`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:80-91`

Problem: timeline queries use `MONTH(capture_date)`, `DAY(capture_date)`, and `YEAR(capture_date)` predicates/order expressions. The source comments correctly document that these are not sargable and only the `processed` prefix narrows the scan.

Failure scenario: archive pages become a crawler or visitor hotspot on a larger gallery. MySQL evaluates date functions over the processed slice, then joins/groups tags for up to 501 rows.

Fix: rewrite year/month filters as range predicates. For on-this-day, add generated month/day columns plus an index, or precompute a small archive/date table.

### PERF-C19-09 - Service-worker cached image hits wait on synchronous `HEAD` revalidation

Severity: Low-Medium
Confidence: High

Files/regions:

- `apps/web/public/sw.template.js:31-38`
- `apps/web/public/sw.template.js:224-286`

Problem: cached image derivatives with ETags do a synchronous network `HEAD` before returning cached bytes. The timeout is capped at 300 ms, which bounds the worst case, but the probe is still on the display path for every cached tile.

Failure scenario: a warm-cache masonry page opens on mobile/high-latency network with many cached tiles. Dozens of HEAD probes can delay near-fold paints and compete with the actual page/image work even though Cache Storage already has the bytes.

Fix: serve cached bytes immediately and revalidate in the background with a short metadata TTL or settings/pipeline version marker. If synchronous freshness remains required, coalesce per-URL HEADs and skip recently validated entries.

### PERF-C19-10 - Infinite masonry keeps every loaded card in React state and DOM

Severity: Low-Medium
Confidence: High

Files/regions:

- `apps/web/src/components/home-client.tsx:124-130`
- `apps/web/src/components/home-client.tsx:286-409`
- `apps/web/src/components/load-more.tsx:41-96`
- `apps/web/src/components/load-more.tsx:116-133`

Problem: `HomeClient` appends every loaded page into `allImages` with a full array copy and maps the full loaded set into masonry cards. `LoadMore` auto-triggers through an IntersectionObserver sentinel; there is no virtualization, page cap, or DOM window.

Failure scenario: a visitor scrolls through thousands of photos. All prior cards, links, images, badges, overlays, and React props remain live, increasing heap, style/layout cost, and reconciliation work. Mid-range phones can see scroll and INP degradation.

Fix: use windowed/virtualized masonry, or stop auto-loading after a bounded number of pages and switch to explicit pagination. Preserve scroll restoration for the retained window.

### PERF-C19-11 - Admin dashboard/analytics parallel fanout can consume most of the small shared pool

Severity: Low-Medium
Confidence: Medium

Files/regions:

- `apps/web/src/db/index.ts:23-38`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:26-36`
- `apps/web/src/lib/analytics-data.ts:28-46`
- `apps/web/src/lib/analytics-data.ts:62-80`
- `apps/web/src/lib/analytics-data.ts:112-128`
- `apps/web/src/lib/analytics-data.ts:161-180`
- `apps/web/src/lib/analytics-data.ts:192-208`

Problem: dashboard starts seven data operations in one `Promise.all`, and analytics starts five aggregate queries in parallel. These share the same 10-connection pool with public traffic, uploads, image queue locks, semantic search, and view flushes.

Failure scenario: two admin tabs load dashboard/analytics while queue processing or public requests are active. Parallel aggregates and list queries occupy most available connections, increasing latency or queue-limit failures for unrelated requests.

Fix: cap admin aggregate concurrency, combine dashboard count/settings queries where practical, and sequence low-priority admin queries after primary page data. Longer term, split analytics/background work onto separate pool budgets.

### PERF-C19-12 - Admin failed-image list is unbounded

Severity: Low
Confidence: High

Files/regions:

- `apps/web/src/lib/data.ts:1000-1013`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`

Problem: `getFailedImages()` returns every unprocessed row with `processing_error IS NOT NULL` ordered by `failed_at`, and the dashboard fetches it in the same fanout as the main admin page. There is no limit, cursor, or dedicated failed-row index visible in schema.

Failure scenario: a broken encoder/config causes a large batch of failures. The dashboard loads all failed rows and payloads at once, adding DB work and UI memory exactly when the operator is trying to recover.

Fix: limit/paginate failed images in the dashboard and add an index for the failed-image predicate/order if the failure list is expected to grow. Surface a count plus the most recent N failures on the main dashboard.

## Mitigated / Not Re-filed

- The old CLIP inference backlog issue is fixed in current source: `apps/web/src/lib/clip-model.ts:53-127` has `CLIP_INFERENCE_MAX_PENDING`, queue timeout, and bounded waiter admission.
- Image format generation now has explicit Sharp controls: `apps/web/src/lib/process-image.ts:36-57` disables Sharp cache and caps libvips concurrency relative to CPU count.
- Admin color backfill is materially better than the live image queue: `apps/web/src/lib/admin-backfill-runner.ts:96-142` computes a pool-budgeted concurrency cap, and `apps/web/src/lib/admin-backfill-runner.ts:633-780` processes keyset batches through `PQueue` before fetching the next batch.
- Common N+1 risks were checked and are mostly batched: shared-group image tags are fetched with one `IN` query in `apps/web/src/lib/data.ts:1285-1308`, photo detail uses parallel bounded lookups in `apps/web/src/lib/data.ts:1108-1154`, and search only enriches tags/aliases when needed in `apps/web/src/lib/data.ts:1532-1613`.

## Coverage Confirmation

I completed a final missed-issue sweep across query shapes, file/buffer materialization, long-lived locks, background queues, timers/listeners, service-worker cache paths, and high-cardinality UI surfaces. No critical or high-severity performance/concurrency issue was found in the current tree. The active risks above are mostly scale thresholds and shared-resource contention risks for the documented single-instance deployment.

No runtime benchmarks or `EXPLAIN ANALYZE` runs were performed; this is a static repository-wide review with line-cited failure scenarios and fixes.
