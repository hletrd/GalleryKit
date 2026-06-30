# Perf Reviewer Report - Cycle 20

Review lane: `perf-reviewer`
Scope: current `HEAD` (`5c55b68c`)
Mode: review-only. Implementation files were not modified.

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then reviewed the repository for performance, concurrency, CPU/memory, DB query cost, image processing, caching, UI responsiveness, background jobs, and cross-file resource contention. The focused inventory covered 797 source/config/test/script/migration files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/public` after excluding persisted uploads/resources.

Relevant files and regions reviewed:

- DB/query surfaces: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/analytics-data.ts`, public pages, admin dashboard/analytics pages, search/load-more actions, semantic/similar routes, and Drizzle migrations/indexes.
- CPU/memory/background surfaces: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, browser upload, Lightroom upload, GPS stripping, restore, and queue shutdown.
- Runtime/cache surfaces: `apps/web/src/lib/serve-upload.ts`, upload routes, `apps/web/public/sw.template.js`, generated `apps/web/public/sw.js`, `apps/web/next.config.ts`, Docker/deploy scripts, and service-worker behavior.
- UI responsiveness surfaces: masonry home/load-more, map client, search UI, photo viewer/lightbox, bulk image manager, upload dropzone, timeline/year/share grids, bottom sheets, and widgets.
- Sweep patterns: `COUNT(*) OVER`, leading-wildcard `LIKE`, `fs.readFile`/whole-buffer work, `Buffer.concat`, broad `Promise.all`, long-lived DB locks, queues/timers/listeners, cache revalidation, and TODO/PERF/deferred notes.

## Confirmed Issues

### PERF-C20-01 - Image processing jobs can pin most of the shared MySQL pool during Sharp work

Severity: Medium
Confidence: High
Status: Open
Impact: Pool starvation and live request latency during large uploads or bootstrap processing when queue concurrency is raised.

Files/regions:

- `apps/web/src/db/index.ts:23-38` defines a 10-connection shared pool with `queueLimit: 20`.
- `apps/web/src/lib/image-queue.ts:87-90` allows `QUEUE_CONCURRENCY` up to 8.
- `apps/web/src/lib/image-queue.ts:446-463` acquires a MySQL advisory lock on a pooled connection.
- `apps/web/src/lib/image-queue.ts:513-546` starts each job by acquiring that lock.
- `apps/web/src/lib/image-queue.ts:554-637` keeps the lock connection held while checking the row, resolving the original, optionally reading config, and running `processImageFormats()`.
- `apps/web/src/lib/image-queue.ts:812-815` releases the lock only in the final `finally`.

Problem: a queue job holds a pooled MySQL connection for the entire CPU/IO-bound image processing window. At the shipped default concurrency of 1 this is usually tolerable, but the environment cap allows 8 concurrent jobs against a 10-connection pool.

Concrete failure scenario: during a large upload/bootstrap, an operator raises `QUEUE_CONCURRENCY=8`. Eight jobs can pin eight DB connections for Sharp encodes while those jobs and live routes still need transient DB connections for config reads, final row writes, public page loads, search, and rate limits. The pool queue can fill and produce broad request latency or connection acquisition failures.

Suggested fix: replace the long advisory-lock hold with a short durable claim (`UPDATE ... WHERE processed=false AND claim expired`) and release the DB connection before Sharp work, then re-check before final update. If advisory locks remain, move them to a dedicated lock pool or cap queue concurrency from the effective pool budget the way `admin-backfill-runner` does.

Competing hypothesis: default concurrency is 1, so this is not the normal fresh-install path. It remains actionable because the env cap exposes an 8-worker mode while all work shares the same small pool.

### PERF-C20-02 - Initial listing and smart-collection pages still combine tag aggregation with `COUNT(*) OVER()`

Severity: Medium
Confidence: High
Status: Open
Impact: First-page public gallery and smart-collection renders can spend DB CPU on full-match join/group/window work instead of bounded page work.

Files/regions:

- `apps/web/src/lib/data.ts:878-907` selects public fields, `GROUP_CONCAT`, `COUNT(*) OVER()`, joins tags, groups by image, sorts, and offsets for `getImagesLitePage()`.
- `apps/web/src/lib/data.ts:1417-1461` avoids the count on cursor loads but keeps `COUNT(*) OVER()` plus tag joins for the initial/offset smart-collection branch.
- `apps/web/src/lib/data.ts:860-875` derives total count and has-more from the windowed rows.

Problem: first-page public listing paths return a small page, but ask MySQL to join/group/sort the full matching set and compute an exact total.

Concrete failure scenario: a gallery reaches tens of thousands of processed images with multiple tags per image. A broad topic, home page, or smart collection hit by crawlers forces large join/group/window work to return about 30 cards, competing with the shared pool.

Suggested fix: split into two phases: fetch page IDs with an indexed keyset query and `LIMIT pageSize + 1`, then fetch tags only for those IDs. Remove exact totals from hot public pages, cache them, or compute counts through a separate low-priority path. For smart collections, make the initial page use the cursor/lookahead shape unless the UI truly needs exact `totalCount`.

### PERF-C20-03 - Public keyword search uses leading-wildcard scans after admission

Severity: Medium
Confidence: High
Status: Open
Impact: Admitted public search requests can force large table/index scans and compete with gallery reads on the shared MySQL writer.

Files/regions:

- `apps/web/src/lib/data.ts:1490-1563` searches title/description/camera/lens/topic/topic label with `containsLike(..., searchTerm)`.
- `apps/web/src/lib/data.ts:1601-1621` may also run tag and topic-alias searches in parallel when the main query does not fill the limit.

Problem: result counts are bounded, but `%term%` searches across multiple text fields are not selective on normal B-tree indexes. The tag/alias fallback can add extra scans after a valid public search is admitted.

Concrete failure scenario: crawlers or distributed users submit many valid short terms. Per-IP limits reduce abuse, but admitted requests can still scan a large processed-image slice and compete with the DB pool.

Suggested fix: move public keyword search to an indexed surface: MySQL FULLTEXT/ngram, a materialized normalized search table, or a dedicated search index. Until then, consider stricter short-query rules and skip tag/alias branches for broad low-signal terms.

### PERF-C20-04 - Semantic and similar search brute-force decode/score embeddings on the request thread

Severity: Low-Medium
Confidence: High
Status: Open
Impact: Semantic/similar search can consume request-thread CPU and heap in proportion to the configured scan limit.

Files/regions:

- `apps/web/src/lib/clip-embeddings.ts:36-44` defaults scan limit to 2,000 and hard-clamps env tuning at 25,000.
- `apps/web/src/lib/clip-embeddings.ts:164-168` filters, fully sorts, and slices all scored matches.
- `apps/web/src/app/api/search/semantic/route.ts:263-307` fetches up to the scan limit, decodes every embedding, scores all rows, and sorts on the request path.
- `apps/web/src/app/api/search/similar/[id]/route.ts:140-175` does the same scan/score/top-K shape for image-to-image search.

Problem: scan size is bounded, but the current design still performs vector decode, score, and full sort inside the Next.js request process.

Concrete failure scenario: production semantic search is enabled and the corpus exceeds the default scan limit, or an operator raises the scan limit for recall. A burst of admitted searches can spend CPU and heap on vector work, delaying public rendering and other API work in the same Node process.

Suggested fix: use ANN/vector indexing, or move scoring to a worker thread with explicit concurrency and cancellation. If the brute-force scan remains, keep limits conservative, add request-time budget logging, and replace full sort with a fixed-size min-heap for top-K.

### PERF-C20-05 - GPS stripping materializes retained originals and scrubbed copies in memory

Severity: Low-Medium
Confidence: High
Status: Open
Impact: Large GPS-stripped uploads can spike Node heap/RSS and GC pressure before the queued Sharp derivative pipeline even starts.

Files/regions:

- `apps/web/src/lib/process-image.ts:1737-1764` reads the entire original with `fs.readFile()` and writes a scrubbed buffer when lossless stripping succeeds.
- `apps/web/src/lib/process-image.ts:1772-1792` falls back to Sharp re-encode while still retaining the input buffer for some format decisions.
- `apps/web/src/app/actions/images.ts:382-395` calls `stripGpsFromOriginal()` during browser upload when GPS stripping is enabled.
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-385` calls the same function for Lightroom upload.

Problem: uploads stream originals to disk, but GPS stripping then loads whole originals into JS memory and can allocate a second scrubbed buffer plus Sharp native memory.

Concrete failure scenario: GPS stripping is enabled and an admin ingests large 150-200 MB originals. One request can hold the original buffer, scrubbed output, and native re-encode buffers, causing RSS spikes and GC pauses on the single-host deployment.

Suggested fix: add a process-wide GPS-strip semaphore and size guard for in-process stripping. Longer term, implement streaming/container-segment rewrites for JPEG/WebP/TIFF/ISOBMFF so the original and scrubbed copy are not resident simultaneously.

### PERF-C20-06 - Batch deletion repeats derivative-directory scans per image and format

Severity: Low-Medium
Confidence: High
Status: Open
Impact: Admin batch delete can stretch action latency and create avoidable derivative-directory I/O pressure.

Files/regions:

- `apps/web/src/lib/process-image.ts:575-627` scans a derivative directory whenever `sizes` is empty.
- `apps/web/src/app/actions/images.ts:818-842` batch delete passes `[]` for WebP, AVIF, and JPEG cleanup for every selected image.

Problem: cleanup concurrency is bounded, but each selected image can still trigger full scans of three derivative directories to catch historical variants.

Concrete failure scenario: an admin bulk-deletes 100 photos on NAS-backed storage. After the DB delete commits, cleanup can perform about 300 full directory walks, stretching action time and adding disk pressure.

Suggested fix: add a batch cleanup helper that scans each derivative directory once, matches all selected basenames/prefixes, and unlinks matches with bounded concurrency. Alternatively, delete deterministic current-size variants inline and move historical orphan cleanup to a maintenance sweep.

### PERF-C20-07 - Public map can serialize and hydrate 10,000 markers plus 10,000 fallback links

Severity: Low-Medium
Confidence: Medium-High
Status: Open
Impact: The public map can become a large server payload plus heavy client hydration/Leaflet mount path on GPS-rich galleries.

Files/regions:

- `apps/web/src/lib/data.ts:1649-1685` caps map output at 10,000 rows.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:38-50` maps every row into serialized marker props.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:77-89` renders a fallback list item for every marker.
- `apps/web/src/components/map/map-client.tsx:76-93` computes bounds over full latitude/longitude arrays.
- `apps/web/src/components/map/map-client.tsx:119-140` renders one Leaflet `<Marker>` per marker.

Problem: the previous unbounded map query is capped, but the cap is still large enough to create a heavy public payload and hydration path.

Concrete failure scenario: a large GPS-visible gallery opens `/map` on mobile. The server serializes thousands of markers, React hydrates thousands of links, and Leaflet mounts thousands of marker layers before the page is interactive.

Suggested fix: move map data to a bbox/paged API with clustering. Collapse or virtualize the fallback list. If all-marker mode remains, add a generated `has_gps`/map-visible index that matches the public map filter/order.

### PERF-C20-08 - Timeline/archive predicates use non-sargable date functions

Severity: Low-Medium
Confidence: High
Status: Open
Impact: Timeline and archive pages can evaluate date functions across the processed-image slice instead of using range seeks.

Files/regions:

- `apps/web/src/lib/data-timeline.ts:97-116` uses `MONTH(capture_date)` and `DAY(capture_date)` for On This Day.
- `apps/web/src/lib/data-timeline.ts:129-145` selects and orders by `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:186-207` filters year/month pages with `YEAR()` and optional `MONTH()`.

Problem: source comments correctly acknowledge that these predicates are not sargable. MySQL can narrow on `processed`, but still evaluates date functions across the processed slice.

Concrete failure scenario: timeline/year pages become crawler or visitor hotspots on a larger gallery. MySQL evaluates date functions over many processed rows, then joins/groups tags for up to 501 rows.

Suggested fix: rewrite year/month filters as date ranges. For On This Day, add generated month/day columns plus an index, or precompute a small archive/date table.

### PERF-C20-09 - Service-worker cached image hits wait on synchronous `HEAD` revalidation

Severity: Low-Medium
Confidence: High
Status: Open
Impact: Warm-cache image display can wait on a network `HEAD` round trip per cached derivative before paint.

Files/regions:

- `apps/web/public/sw.template.js:31-38` and `apps/web/public/sw.js:31-38` set `HEAD_REVALIDATE_TIMEOUT_MS = 300`.
- `apps/web/public/sw.template.js:224-286` and `apps/web/public/sw.js:224-286` await a `HEAD` probe before serving a cached ETag image.

Problem: the timeout bounds worst-case latency, but every cached ETag image still places a network probe on the display path before returning bytes already in Cache Storage.

Concrete failure scenario: a warm-cache masonry page opens on a high-latency mobile connection. Dozens of cached tiles can each wait up to a HEAD RTT before painting, even though stale-while-revalidate could show the cached derivative immediately.

Suggested fix: serve cached images immediately and revalidate in the background with a short metadata TTL or pipeline/settings version marker. If synchronous freshness remains required, coalesce per-URL HEADs and skip recently validated entries.

### PERF-C20-10 - Infinite masonry keeps every loaded card in React state and DOM

Severity: Low-Medium
Confidence: High
Status: Open
Impact: Infinite scroll memory, DOM size, style/layout cost, and reconciliation cost grow with every loaded page.

Files/regions:

- `apps/web/src/components/home-client.tsx:124-130` appends every loaded page into `allImages` with a full array copy.
- `apps/web/src/components/home-client.tsx:286-409` maps every loaded image into card DOM.
- `apps/web/src/components/load-more.tsx:41-96` fetches more pages and appends them.
- `apps/web/src/components/load-more.tsx:116-133` auto-triggers loading through an IntersectionObserver sentinel.

Problem: there is no virtualization, DOM window, or auto-load cap. All prior cards remain live as the user scrolls.

Concrete failure scenario: a visitor scrolls through thousands of photos. Heap, style/layout, image bookkeeping, and reconciliation costs grow with total loaded history, degrading scroll and INP on mid-range phones.

Suggested fix: use a virtualized/windowed masonry implementation, or stop auto-loading after a bounded number of pages and switch to explicit pagination while preserving scroll restoration.

### PERF-C20-11 - Admin dashboard/analytics parallel fanout can consume most of the shared pool

Severity: Low-Medium
Confidence: Medium
Status: Open
Impact: Admin-only pages can occupy most pool connections with concurrent aggregate/listing work, affecting unrelated live traffic.

Files/regions:

- `apps/web/src/db/index.ts:23-38` defines the 10-connection pool.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27` starts seven data operations in one `Promise.all`.
- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:26-36` starts five aggregate queries in one `Promise.all`.
- `apps/web/src/lib/analytics-data.ts:28-46`, `apps/web/src/lib/analytics-data.ts:62-80`, `apps/web/src/lib/analytics-data.ts:112-128`, `apps/web/src/lib/analytics-data.ts:161-180`, and `apps/web/src/lib/analytics-data.ts:192-208` run aggregate/grouped analytics queries.

Problem: admin pages fan out several DB operations concurrently against the same pool used by public traffic, queue locks, uploads, semantic search, and view flushes.

Concrete failure scenario: two admin tabs load dashboard/analytics while queue processing or public requests are active. Parallel aggregates and listing queries occupy most available connections, increasing latency for unrelated requests.

Suggested fix: cap admin aggregate concurrency, combine dashboard count/settings queries where practical, and sequence low-priority admin queries after primary page data. Longer term, split analytics/background work onto separate pool budgets.

### PERF-C20-12 - CSV export materializes up to 50,000 rows and duplicates the payload in the browser

Severity: Low-Medium
Confidence: High
Status: Open
Impact: Large admin CSV exports can create avoidable server heap pressure, network payload latency, and client heap duplication.

Files/regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:65-70` documents that the server action materializes up to 50,000 rows as a CSV string.
- `apps/web/src/app/[locale]/admin/db-actions.ts:88-103` runs one grouped query with `GROUP_CONCAT` and `.limit(50000)`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:110-138` builds a `csvLines` array and then joins it into one `csvContent` string.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:103-124` receives that full string in the browser and wraps it in a `Blob` before download.

Problem: the current export is bounded, but it still holds large DB row materialization, per-row CSV strings, the final CSV string, and then a browser Blob copy across one interactive admin request.

Concrete failure scenario: an admin exports a 50,000-row gallery while the live app is also processing images. The server action keeps a large result set/string workload on the Node heap, then the admin tab duplicates the returned CSV into a Blob, causing visible pause or memory pressure on lower-memory devices.

Suggested fix: move CSV export to a streaming authenticated route or temp-file job. Stream rows from MySQL to CSV with backpressure, audit after completion, and return a file response instead of a server-action string.

### PERF-C20-13 - CLIP embedding backfills reuse the public semantic scan limit as an operational batch cap

Severity: Low-Medium
Confidence: High
Status: Open
Impact: Embedding backfill throughput and completeness are coupled to a public request-path safety limit, making larger galleries require repeated manual runs and easy to leave partially embedded.

Files/regions:

- `apps/web/scripts/backfill-clip-embeddings.ts:72` imports `SEMANTIC_SCAN_LIMIT`, the public request scan cap.
- `apps/web/scripts/backfill-clip-embeddings.ts:116-147` stops selecting rows after `processed + failed` reaches `SEMANTIC_SCAN_LIMIT`, default 2,000.
- `apps/web/scripts/backfill-clip-embeddings.ts:195` exits the loop when a batch is smaller than `BATCH_SIZE`, so the scan-limit stop requires another invocation to continue.
- `apps/web/src/app/actions/embeddings.ts:20` imports the same public cap, and `apps/web/src/app/actions/embeddings.ts:103-124` loads at most `SEMANTIC_SCAN_LIMIT` pending rows into memory before processing.

Problem: `SEMANTIC_SCAN_LIMIT` is documented and implemented as a per-request brute-force search safety budget, but the backfill paths use it as their corpus processing ceiling.

Concrete failure scenario: an operator enables production semantic search on an 8,000-photo gallery with the default scan limit of 2,000. One documented backfill invocation embeds only the first slice, and semantic/similar search silently ignores the remaining photos until the operator notices and reruns the sidecar several times.

Suggested fix: split the knobs. Keep `SEMANTIC_SCAN_LIMIT` for public request scoring, and add an explicit `CLIP_BACKFILL_MAX_ROWS` or no default run cap for operator backfills. Process via keyset batches until no rows remain, with progress logging/status and an optional explicit stop limit for maintenance windows.

## Mitigated / Not Re-filed

- Cycle 19's admin failed-image unbounded list is no longer current: the dashboard still fetches failed images, but this sweep did not find the old unbounded `getFailedImages()` shape in the cited region; the remaining admin concern is pool fanout, not failed-row payload size.
- The CLIP inference queue abort issue is mitigated in current source: semantic search passes `request.signal` into `embedTextReal()` at `apps/web/src/app/api/search/semantic/route.ts:250-257`, and `clip-model.ts` now accepts queued abort handling.
- The public mutating-route alias scanner issue is mitigated by current scanner/tests; it is not re-filed as a performance issue.
- Sharp global pressure has explicit mitigations in `process-image.ts` (cache/concurrency controls), so I did not promote generic image-encoding CPU cost beyond the concrete queue/pool and GPS-strip findings above.

## Risks Needing Validation

- The query-cost findings should be confirmed with production-like `EXPLAIN ANALYZE` and row counts before choosing indexes or query rewrites.
- The service-worker `HEAD` finding needs RUM or WebPageTest evidence to quantify real paint impact; the synchronous path is confirmed, but user-visible severity depends on latency and cache-hit mix.
- Map and masonry severity depends on actual corpus size and device mix. The code paths are confirmed; the threshold for remediation should be based on observed marker/card counts and INP/heap.

## Coverage Confirmation

Final missed-issues sweep rechecked relevant DB queries, locks, background queues, timers, file-buffer paths, cache paths, semantic search, upload processing, admin fanout, and high-cardinality UI surfaces. I did not skip relevant source areas under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, or `apps/web/public`; persisted upload/resource blobs were intentionally excluded.

Finding count: 13 confirmed issues, 3 validation risks, 0 high/critical findings.
