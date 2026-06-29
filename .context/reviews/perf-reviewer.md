# Perf Reviewer Report - Cycle 17/100

Review lane: `perf-reviewer`
Scope: current `HEAD` only (`5e054f80`)
Write scope: this file only
Angles: CPU, memory, DB query shape/index use, concurrency, backpressure, file I/O, cache behavior, UI responsiveness, deploy/runtime performance.

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then built the review inventory from the current repository file list and repo-wide sweeps. The relevant surfaces inspected were:

- Public Next pages/routes: home, topic, smart collection, photo, shared photo/group, map, timeline/year, feeds, sitemap, upload serving, OG routes, semantic and similar search APIs.
- Admin pages/routes/actions: dashboard, analytics, uploads, Lightroom upload, settings/backfill, DB backup download/restore-adjacent code, image delete/update paths.
- Data layer and schema: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, Drizzle schema/index definitions, MySQL pool setup, migrations/journal shape.
- Image/queue/runtime paths: upload limits/tracker, image queue, image processing, Sharp concurrency, CLIP model/inference helpers, embedding storage/backfill scripts, instrumentation shutdown.
- Client performance paths: masonry gallery, load-more, search, map loader/client, grid picture, photo viewer/lightbox, service worker cache.
- Ops/deploy paths: Dockerfile, docker-compose, deploy script, upload serving, cache headers, runtime health/liveness.
- Tests/source contracts: rate limit, semantic scan limit, service worker cache, touch-target audit, timeline/query contracts, queue/shutdown tests, data/tag SQL contracts.

## Findings

### 1. Confirmed: CLIP inference admission has an unbounded, abort-insensitive wait queue

Severity: High
Confidence: High

Files/regions:
- `apps/web/src/lib/clip-model.ts:53-71`
- `apps/web/src/app/api/search/semantic/route.ts:248-255`
- `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`
- `apps/web/src/lib/image-queue.ts:303-321`

`withInferenceSlot()` limits active CLIP inference with `CLIP_INFERENCE_CONCURRENCY`, but waiting callers are stored in an unbounded `inferenceWaiters: Array<() => void>`. There is no pending limit, timeout, priority, or `AbortSignal` removal. The semantic route checks `isRequestAborted()` before calling `embedTextReal()`, but once a request is waiting in `withInferenceSlot()`, client disconnects do not remove the waiter and the model work will still run when a slot opens.

Failure scenario: production semantic mode runs with the default CLIP concurrency of 1. A burst of semantic searches, similar-photo requests, and upload/embedding side effects queues hundreds of waiters. If many clients disconnect, their closures stay in memory and still consume ONNX/transformer CPU later. Per-IP rate limits reduce one abuse vector, but they do not provide a process-wide model-work backlog cap, and image-queue side effects share the same inference gate.

Suggested fix: replace the manual waiter array with a bounded async queue/semaphore that accepts an `AbortSignal`, max pending count, and max wait time. Return 429/503 when saturated, remove aborted waiters, and expose queue depth in logs/health. Consider separate admission classes for interactive text search and background image embeddings so upload backfill cannot starve user-facing search.

### 2. Confirmed: Initial gallery/smart-collection pages use `COUNT(*) OVER()` after tag joins and grouping

Severity: Medium-High
Confidence: High

Files/regions:
- `apps/web/src/lib/data.ts:878-907`
- `apps/web/src/lib/data.ts:1409-1453`
- `apps/web/src/app/[locale]/(public)/page.tsx:149-176`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:166-176`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-103`
- `apps/web/src/db/schema.ts:114-120`

The initial public listing query selects image fields, left-joins tags, aggregates `GROUP_CONCAT(...)`, groups by `images.id`, orders by `capture_date DESC, created_at DESC, id DESC`, and computes `COUNT(*) OVER()` before applying `LIMIT`. Smart collections use the same pattern for initial pages. The current listing indexes cover `(processed, capture_date, created_at)` and `(topic, processed, capture_date, created_at)`, but do not include `id`, and the join/group/window shape prevents a cheap early-stop page fetch.

Failure scenario: a gallery grows to tens of thousands of processed images with several tags per image. Every dynamic home/topic/smart-collection first page can force MySQL to join and group a large matching set, compute a window count over it, sort, and only then return 31 rows. Bot/crawler traffic against `revalidate = 0` public pages amplifies DB CPU and pool occupancy.

Suggested fix: split the listing path. First select only page image IDs with a keyset-compatible index and `LIMIT pageSize + 1`, then fetch tags for those IDs in a second batched query. Remove exact `totalCount` from the hot path or compute/cache it separately. Add tie-breaker indexes that match the actual order, for example `(processed, capture_date, created_at, id)` and topic/tag-specific variants where justified by EXPLAIN.

### 3. Confirmed: Batch image deletion repeats full derivative-directory scans per image and format

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/src/app/actions/images.ts:807-845`
- `apps/web/src/lib/process-image.ts:575-664`

`deleteImages()` processes selected images with bounded concurrency, but each selected image calls `deleteImageVariantsStrict(..., [])` for WebP, AVIF, and JPEG. Passing an empty size list intentionally triggers `collectImageVariantFilenames()` to scan the entire derivative directory so it can find historical size variants. For 100 selected images, that can be 300 full directory scans before unlinking files.

Failure scenario: an admin deletes 100 images on a NAS-backed or disk-constrained host with large derivative directories. The DB rows are deleted first, then cleanup repeatedly walks the same directories. This can create high disk I/O, slow server-action completion, and cleanup failure exposure even though concurrency is capped.

Suggested fix: add a batch cleanup helper that scans each derivative directory once, matches all selected basenames/prefixes, and unlinks matches with bounded concurrency. Preserve strict failure aggregation. A smaller alternative is to delete only current configured deterministic sizes inline and move historical orphan sweeps to a scheduled/admin maintenance job.

### 4. Confirmed: GPS stripping reads and rewrites whole originals in memory on upload

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/src/lib/process-image.ts:1738-1822`
- `apps/web/src/app/actions/images.ts:381-388`
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-381`

`stripGpsFromOriginal()` does `await fs.readFile(filePath)` for the retained original before container-aware GPS stripping, and writes the scrubbed buffer to a temp file. The upload paths call this after the original has already been streamed to disk. For large allowed originals, the process can hold the original buffer, scrubbed/output buffer, and fallback Sharp pipeline memory at once.

Failure scenario: `strip_gps_on_upload` is enabled and an admin uploads multiple 150-200 MB JPEG/HEIF/WebP originals. The upload save path itself is streaming, but GPS stripping re-materializes each original in memory. On the small production host described in the repo docs, overlapping uploads can trigger GC pauses, RSS spikes, or process restarts.

Suggested fix: stream or segment-write GPS stripping where possible. If the buffer-based implementation remains, add a process-wide GPS-strip semaphore and a separate max-original-size guard for in-process stripping. Surface a clear admin warning/rejection when the retained original is too large to scrub safely.

### 5. Likely: Public keyword search can still run multiple leading-wildcard scans per admitted query

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/src/app/actions/public.ts:236-318`
- `apps/web/src/lib/data.ts:1537-1555`
- `apps/web/src/lib/data.ts:1582-1613`

The public search action validates and rate-limits input, then `searchImages()` runs `LIKE '%term%'` style predicates across image title, description, camera, lens, topic slug, and topic label. If that branch does not fill the limit, it concurrently runs tag-name and topic-alias searches with joins, grouping, and the same gallery ordering. The query is bounded by result limit, but the predicates are leading-wildcard and cannot use ordinary B-tree indexes for selective lookup.

Failure scenario: many users or crawlers submit short valid terms such as two common Latin letters or CJK terms. Each admitted request can scan a large portion of `images`, then scan/join tags and aliases. The in-memory/DB rate limit controls one IP, but a small distributed burst can still pin DB CPU.

Suggested fix: move public keyword search to a dedicated indexed search surface: MySQL FULLTEXT/ngram, a materialized normalized search table, or an external search index. Add stricter short-term handling by language, cache popular queries, and avoid launching tag/alias branches for terms below a selectivity threshold.

### 6. Likely: Service worker performs synchronous HEAD revalidation on the cached-image display path

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/public/sw.template.js:34-38`
- `apps/web/public/sw.template.js:223-285`

For cached images with an ETag, the service worker waits for a network `HEAD` request before returning the cached response. The timeout is capped at 300 ms, and the code falls back to stale-serve on failure, but the HEAD still sits on the display path for every cached tile.

Failure scenario: a warm-cache masonry page opens on mobile or a high-RTT network with 30 cached images above and near the fold. The service worker can issue 30 HEAD requests and delay each cached response by one RTT, up to 300 ms in bad conditions. The LCP image can be delayed even though the bytes are already in Cache Storage, and the extra requests compete with real image/page work.

Suggested fix: serve cached images immediately and revalidate in the background, with a short metadata TTL or settings/pipeline-version marker to limit stale color windows. If synchronous freshness is retained for recent admin color changes, coalesce HEAD requests per URL and skip the HEAD when the cached metadata was validated recently.

### 7. Likely: The gallery client accumulates every loaded image in React state and the DOM

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/src/components/home-client.tsx:124-130`
- `apps/web/src/components/home-client.tsx:286-421`
- `apps/web/src/components/load-more.tsx:41-96`
- `apps/web/src/components/load-more.tsx:116-133`

`HomeClient` appends every load-more page into `allImages` and maps the full array into masonry cards. `LoadMore` uses an IntersectionObserver sentinel with a 200 px root margin, so ordinary scrolling can continue appending pages until the result set is exhausted. There is no virtualization, DOM cap, or handoff to route-level pagination after a threshold.

Failure scenario: a visitor scrolls through 2,000 photos. All cards, links, picture/img nodes, badges, overlays, and associated React data remain live. Column layout, hover/focus styles, image lazy-loading bookkeeping, and React reconciliation get slower, causing memory growth and INP regressions on mid-range devices.

Suggested fix: use a virtualized/windowed masonry strategy, or switch to route/page segmentation after a bounded number of auto-loaded pages. A pragmatic intermediate fix is to disable auto-load after N pages and require explicit pagination, while preserving scroll restoration.

### 8. Likely: Lightroom upload materializes large multipart bodies before streaming work begins

Severity: Medium
Confidence: Medium-High

Files/regions:
- `apps/web/src/app/api/admin/lr/upload/route.ts:93-112`
- `apps/web/src/app/api/admin/lr/upload/route.ts:114-155`
- `apps/web/src/lib/upload-limits.ts:1-6`
- `apps/web/src/lib/process-image.ts:887-910`

The Lightroom route requires and checks `Content-Length`, preclaims upload quota, then calls `await request.formData()`. Only after the framework has parsed the multipart body does the route validate the `File` and pass it to `saveOriginalAndGetMetadata()`, which streams to disk. The per-file cap is 200 MiB plus multipart overhead, and the rolling total default is 2 GiB.

Failure scenario: several authenticated Lightroom clients or retries upload near-200 MiB files at the same time. The route can hold parsed multipart `File` bodies in process memory before the stream-to-disk path starts. The upload tracker is per actor/IP and byte-window based, not a global active-body semaphore, so admitted concurrent uploads can exceed available RSS.

Suggested fix: parse multipart uploads with a streaming parser directly to a temp file under a global active-byte semaphore. Reject or 503 when active upload bytes exceed a configured ceiling. Keep the existing per-actor quotas, but add process-wide backpressure before body materialization.

### 9. Likely: Map route can send and hydrate up to 10,000 markers plus 10,000 fallback list links

Severity: Medium
Confidence: Medium-High

Files/regions:
- `apps/web/src/lib/data.ts:1648-1677`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`
- `apps/web/src/components/map/map-client.tsx:76-143`
- `apps/web/src/db/schema.ts:114-120`

`getMapImages()` caps the public map at 10,000 rows and filters on processed images, map-visible topics, and non-null latitude/longitude. The server page serializes all markers to the client and also renders a full accessible fallback list. The client then computes bounds with arrays of every latitude/longitude and renders one Leaflet `<Marker>` per marker. The schema has no GPS/map-oriented index or denormalized `has_gps`/`map_visible` key.

Failure scenario: a large GPS-visible gallery loads `/map`. The DB must scan/filter many processed rows, the page ships a large marker payload, React hydrates thousands of list items, and Leaflet instantiates thousands of marker layers. Mobile browsers are likely to stall or exceed memory before the user can interact.

Suggested fix: move the map to a bbox/paged API, cluster markers, and virtualize or collapse the fallback list. Add a generated `has_gps` column or denormalized map visibility flag with an index matching the public map filter/order if all-marker mode remains.

### 10. Risk: Timeline/archive date predicates are intentionally non-sargable

Severity: Low-Medium
Confidence: High

Files/regions:
- `apps/web/src/lib/data-timeline.ts:97-117`
- `apps/web/src/lib/data-timeline.ts:129-145`
- `apps/web/src/lib/data-timeline.ts:186-207`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84`

The timeline code uses `MONTH(capture_date)`, `DAY(capture_date)`, and `YEAR(capture_date)` predicates. Comments already document that only the `processed = true` prefix of `idx_images_processed_capture_date` helps for the year/month paths. The page is dynamic and can fetch year lists plus one year of photos.

Failure scenario: the gallery grows beyond personal scale or a crawler hits timeline/year pages repeatedly. MySQL evaluates date functions per processed row, then groups/join tags for up to 501 photos. This is bounded today, but it becomes a predictable archive-page hotspot as the table grows.

Suggested fix: rewrite year/month filters as range predicates where possible, for example `capture_date >= 'YYYY-01-01' AND capture_date < 'YYYY+1-01-01'`. For on-this-day, add generated month/day columns with an index, or precompute a small date archive table.

### 11. Risk: Admin dashboard and analytics fan out enough parallel DB work to consume the small pool

Severity: Low-Medium
Confidence: Medium

Files/regions:
- `apps/web/src/db/index.ts:23-38`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:26-36`

The MySQL pool has `connectionLimit: 10` and `queueLimit: 20`. The admin dashboard starts seven DB/config operations in one `Promise.all`, and analytics starts five aggregate queries in parallel. Individually these are admin-only and bounded, but they share the same pool as public traffic, image queue claims, view-count flushes, semantic search, and uploads.

Failure scenario: two admin tabs load dashboard/analytics during image processing or semantic search. The parallel fanout can occupy most pool slots, then public listing/search requests and background queue work hit the 20-entry pool queue. The user-visible failure mode is intermittent DB timeout or "too many queued requests" under normal admin use plus background load.

Suggested fix: sequence cheap config/settings reads after the main data query, combine dashboard counts where possible, and reserve a smaller concurrency budget for admin aggregate pages. Longer term, split background/analytics work onto a separate pool or add a request-scoped DB concurrency limiter.

### 12. Risk: Semantic/similar search scans and scores every selected embedding in-process

Severity: Low-Medium
Confidence: Medium

Files/regions:
- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/lib/clip-embeddings.ts:164-168`
- `apps/web/src/app/api/search/semantic/route.ts:261-305`
- `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`

Both semantic routes scan up to `SEMANTIC_SCAN_LIMIT` embeddings, decode every vector, compute a score for every row, then `filter().sort().slice()` the full scored list. The default scan limit is 2,000 and the env hard cap is 25,000, so this is bounded. The risk is that increasing the env to improve recall linearly increases memory/CPU per request and uses a full sort where top-K selection would be enough.

Failure scenario: an operator raises `SEMANTIC_SCAN_LIMIT` to 25,000 for better recall. A few concurrent semantic/similar requests decode tens of thousands of 512-d vectors and sort all qualifying scores in the Node process, competing with image processing and public request handling.

Suggested fix: keep the default low unless backed by profiling. Replace full sort with a size-K heap/selection algorithm, and consider vector search storage or approximate nearest-neighbor indexing before raising the scan cap. Add metrics for scanned rows, decoded rows, scoring time, and queue wait time.

## Positive controls observed

- Rate-limit maps and upload trackers are bounded (`BoundedMap`, upload tracker cap/pruning), and search/OG/share/admin token surfaces have explicit limits.
- Image queue foreground concurrency is capped, bootstrap pending rows are limited per pass, and shutdown drains queue work plus buffered view counts with a timeout.
- Sharp/libvips concurrency and input pixel limits are explicitly bounded.
- Upload serving has a settings-hash TTL/inflight dedupe and streams file responses with abort-aware cleanup.
- The Docker/deploy path uses standalone output, a liveness-only health check, explicit signal handling, and post-deploy Docker prune after the new container is up.

## Coverage gaps

- I did not run tests, benchmarks, Lighthouse, Playwright traces, production SQL `EXPLAIN`, or live load tests; this was a read-only source review.
- I did not inspect production table cardinalities, slow-query logs, browser field data, CDN/cache logs, or MySQL runtime config.
- Severity for DB findings is based on query shape and repository scale assumptions from `CLAUDE.md`; confirm with `EXPLAIN ANALYZE` against production-like data before choosing index/migration details.
- I did not validate generated `apps/web/public/sw.js` separately from `sw.template.js` beyond confirming both exist in the search inventory; fixes should update the template and regeneration flow.

## Final missed-issue sweep

I re-swept for unbounded `Map`/collections, `Promise.all` fanout, `COUNT(*) OVER`, `YEAR()`/`MONTH()`, `request.formData()`, `SEMANTIC_SCAN_LIMIT`, `PQueue`, service-worker cache behavior, deploy scripts, and upload/image-processing paths. The findings above are the actionable performance/concurrency issues I would carry forward. I did not find a new confirmed deploy-script runtime performance bug beyond the existing operational tradeoffs documented in the Docker/deploy files.
