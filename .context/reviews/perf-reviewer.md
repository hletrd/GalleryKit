# Cycle 14 Performance Review

Role: perf-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `c2da917d0fe9620bcbef3897570591080445592c`
Date: 2026-06-30

This is a current-HEAD repository review from the performance, concurrency, CPU/memory, database/query efficiency, image-processing throughput, caching, and UI responsiveness angles. I read `AGENTS.md` and `CLAUDE.md` first, then built an inventory before inspecting files. I did not modify production code.

## Inventory

Inventory scope:
- 531 tracked runtime/config/script files were inventoried with `git ls-files` across `apps/web/src/**/*.ts`, `apps/web/src/**/*.tsx`, `apps/web/scripts/*`, `apps/web/public/*.js`, `apps/web/nginx/*`, app config, Docker/deploy config, and package manifests.
- Reviewed server routes/pages/actions under `apps/web/src/app/**`, including public gallery/topic/photo/share/map/timeline/search/feed surfaces, admin dashboard/settings/analytics/backup surfaces, public/admin API routes, and Lightroom upload.
- Reviewed data/concurrency layers: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `smart-collections.ts`, `db/index.ts`, `db/schema.ts`, rate-limit and bounded-map helpers, view buffering, CLIP helpers, and upload trackers.
- Reviewed image pipeline: `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, CLIP model/jobs/paths, upload serving, and backfill scripts.
- Reviewed client/cache surfaces: masonry/load-more, photo viewer/lightbox, map, histogram worker, search/similar UI, admin upload/dashboard controls, `sw.template.js`, generated `sw.js`, and image-serving cache paths.

No relevant runtime/config/script files were intentionally skipped. Tests and `.context` history were used as contract/context evidence rather than as runtime hot paths. Generated build output, `node_modules`, runtime uploads/data, and `.git` were excluded.

## Confirmed Issues

### PERF-C14-01 - Public map still serializes and renders up to 10k markers and 10k links

Severity: High
Confidence: High

Evidence:
- `apps/web/src/lib/data.ts:1649-1676` caps `getMapImages()` at `MAP_MAX_MARKERS = 10000`, joins topics, filters GPS-visible rows, sorts them, and returns the full capped result.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:9-10` makes the map page dynamic with `revalidate = 0`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-35` fetches the full map result on every request.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:39-50` maps every returned row into a client marker payload.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:59-66` passes the full marker array through the RSC/client boundary, and `apps/web/src/app/[locale]/(public)/map/page.tsx:67-79` server-renders one link per marker.
- `apps/web/src/components/map/map-loader.tsx:9-12` disables SSR only for the Leaflet component; it does not avoid serializing the marker prop.
- `apps/web/src/components/map/map-client.tsx:76-93` computes bounds over all markers, and `apps/web/src/components/map/map-client.tsx:119-143` renders one Leaflet `<Marker>` and `<Popup>` per marker.
- `apps/web/src/db/schema.ts:43-44` stores latitude/longitude, while `apps/web/src/db/schema.ts:114-120` has no GPS/map-oriented index.

Concrete failure scenario:
An opted-in map-visible topic reaches thousands of GPS-tagged photos. `/map` then repeats a dynamic DB query, ships a large RSC payload, server-renders thousands of accessible links, and asks React/Leaflet to instantiate thousands of markers/popups on the browser main thread. At the documented 10k cap this can create long tasks, high memory use, slow navigation, and an unusable mobile map.

Concrete fix:
Keep the privacy guard, but stop treating 10k as a renderable UI cap. Use viewport/bounds-based fetching, clustering such as `supercluster`, and a paginated or virtualized accessible list. Add an EXPLAIN-backed index or materialized map table for the chosen query shape. If the first fix must be small, cap initially rendered markers far below 10k and show a zoom/filter state.

### PERF-C14-02 - Admin dashboard loads and renders every permanently failed image

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/lib/data.ts:1000-1013` defines `getFailedImages()` with `processed = false`, `processing_error IS NOT NULL`, `ORDER BY failed_at DESC`, and no limit.
- `apps/web/src/db/schema.ts:101-120` has no failed-list index shaped for `(processed, failed_at)` or failure status.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27` fetches `getFailedImages()` in the main dashboard `Promise.all`.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:73-120` synchronously renders every failed row into the initial dashboard DOM with retry controls.

Concrete failure scenario:
A corrupt import, unsupported-format batch, or missing-original incident creates thousands of permanently failed rows. Opening `/admin/dashboard` then scans and sorts all failures, serializes them into the RSC payload, hydrates them into client state, and renders all retry controls at once. The recovery dashboard becomes slow exactly when the admin needs it.

Concrete fix:
Add pagination or a small default limit for failed images, expose a separate failed count, and lazy-load additional failures. Add an index such as `(processed, failed_at)` or a more explicit processing-status index after checking MySQL `EXPLAIN`.

### PERF-C14-03 - Sidecar backfill scripts materialize and enqueue the full candidate set

Severity: Medium
Confidence: High

Evidence:
- `apps/web/scripts/backfill-color-pipeline.ts:279` defines `BATCH_SIZE = 100`, but `apps/web/scripts/backfill-color-pipeline.ts:342-359` first fetches every candidate image into `rows`.
- `apps/web/scripts/backfill-color-pipeline.ts:474-511` iterates all `rows`, calls `queue.add()` for every candidate, and only then waits for `queue.onIdle()`. The batch size only controls DB update flushing, not fetch or queue residency.
- `apps/web/scripts/backfill-cicp-recheck.ts:57-74` fetches every HEIF/AVIF/HEIC row into memory.
- `apps/web/scripts/backfill-cicp-recheck.ts:81-93` creates a queue and enqueues every row before `apps/web/scripts/backfill-cicp-recheck.ts:144` waits for idle.
- The in-app runner shows the desired bounded shape: `apps/web/src/lib/admin-backfill-runner.ts:381-410` fetches keyset batches of 100 and `apps/web/src/lib/admin-backfill-runner.ts:687-696` enqueues only the current batch.

Concrete failure scenario:
Running `backfill-color-pipeline.ts --force-reencode` on a large gallery or running the CICP diagnostic after a HEIF-heavy import creates an in-memory array of every candidate plus one PQueue closure per row before the first image finishes. A 50k-100k photo library can spend memory on queued work instead of processing, increasing RSS and GC pressure in the sidecar container.

Concrete fix:
Rewrite both scripts to use keyset batch loops like `admin-backfill-runner.ts`: count for progress only, fetch `WHERE id > cursor ORDER BY id LIMIT BATCH_SIZE`, enqueue/drain that batch, flush, advance the cursor, and repeat. Do not enqueue more rows than the current batch.

### PERF-C14-04 - GPS stripping materializes whole originals after the streaming save path

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/lib/process-image.ts:435-439` ties the processor max to the advertised upload file limit.
- `apps/web/src/lib/process-image.ts:887-910` streams accepted browser uploads to disk to avoid buffering large files during save.
- `apps/web/src/app/actions/images.ts:381-388` calls `stripGpsFromOriginal()` in the upload server action when `stripGpsOnUpload` is enabled.
- `apps/web/src/app/api/admin/lr/upload/route.ts:150-153` parses the Lightroom multipart body with `request.formData()`, and `apps/web/src/app/api/admin/lr/upload/route.ts:365-377` calls the same GPS stripper.
- `apps/web/src/lib/process-image.ts:1738-1764` immediately re-reads the entire original with `fs.readFile(filePath)` and may write a full scrubbed output buffer.
- `apps/web/src/lib/process-image.ts:1773-1788` can keep the original `input` buffer while Sharp re-encodes fallback formats.

Concrete failure scenario:
With GPS stripping enabled, a 200 MB original can exist as multipart/form state, an on-disk file, a full `fs.readFile` buffer, and a scrubbed or re-encode output buffer. A Lightroom publish burst or several large browser uploads can create GC churn or process OOM even though the initial browser upload writer is streaming and the image-processing queue is conservative.

Concrete fix:
Keep the streaming save, but add a memory-budget gate around GPS stripping while the scrubbers are buffer-based. Prefer range/container-aware or streaming scrubbers for JPEG/TIFF/ISOBMFF/WebP where feasible. For Lightroom, evaluate a streaming multipart parser. If whole-buffer scrub remains necessary, run it behind a process-wide semaphore and consider a lower max original size for GPS-strip-enabled uploads.

## Likely Issues

### PERF-C14-05 - Image queue can pin most of the shared DB pool through Sharp work

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/db/index.ts:23-33` configures one shared MySQL pool with `POOL_CONNECTION_LIMIT = 10` and `queueLimit = 20`.
- `apps/web/src/lib/image-queue.ts:87-90` allows `QUEUE_CONCURRENCY` up to 8.
- `apps/web/src/lib/image-queue.ts:446-462` acquires a MySQL advisory lock by checking out a pool connection.
- `apps/web/src/lib/image-queue.ts:519-540` keeps the checked-out lock connection once the job starts.
- `apps/web/src/lib/image-queue.ts:622-637` runs Sharp derivative generation while the lock connection remains held.
- `apps/web/src/lib/image-queue.ts:653-657` then performs the processed-row update before `apps/web/src/lib/image-queue.ts:812-815` releases the advisory lock.

Concrete failure scenario:
The default concurrency is one, but an operator can raise `QUEUE_CONCURRENCY` to 8. Eight image jobs can then hold eight of ten shared DB connections during CPU/disk-heavy Sharp work. Live public/admin requests and the jobs' own DB updates compete for the remaining two connections, so an upload burst can become request latency or pool queue failures.

Concrete fix:
Do not hold shared-pool connections across Sharp work. Use a row-claim/lease that releases the connection immediately, a tiny dedicated advisory-lock pool, or an effective queue-concurrency clamp that reserves enough shared-pool capacity for live traffic. Mirror the backfill pool-budget arithmetic in `admin-backfill-runner.ts`.

### PERF-C14-06 - Dynamic first listing pages perform count-window work on hot requests

Severity: Medium
Confidence: Medium

Evidence:
- `apps/web/src/lib/data.ts:878-907` builds the first-page listing query with `COUNT(*) OVER()`, `LEFT JOIN imageTags`, `LEFT JOIN tags`, `GROUP BY images.id`, gallery ordering, and `LIMIT pageSize + 1`.
- `apps/web/src/lib/data.ts:1438-1453` does the same `COUNT(*) OVER()` shape for first-page smart collections.
- Hot public entry points are dynamic: home sets `revalidate = 0` at `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, topic pages at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`, and smart collection pages at `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:14`.
- Those pages call the counting helpers during render at `apps/web/src/app/[locale]/(public)/page.tsx:164-167`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:174-176`, and `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.

Concrete failure scenario:
For large galleries, broad topics, broad smart collections, or crawler bursts, the initial page can require MySQL to evaluate/group/count the whole matching set before returning the visible 31 rows. Because these pages deliberately bypass ISR for freshness, repeated anonymous requests repeat the count work.

Concrete fix:
Avoid exact `totalCount` in the hot SSR query. Return `hasMore` from `LIMIT + 1` and load exact counts asynchronously, cache counts with short TTL/tag invalidation, or precompute per-topic/tag/collection counts. Validate candidate rewrites with `EXPLAIN ANALYZE` on production-like data before changing semantics.

### PERF-C14-07 - Feed ordering is publication-time based but lacks a matching index

Severity: Medium
Confidence: Medium

Evidence:
- Root feed requests call `getImagesForFeed(FEED_LIMIT)` at `apps/web/src/app/feed.xml/route.ts:29-40`.
- Topic feed requests call `getImagesForFeed(FEED_LIMIT, topicData.slug)` at `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:49-63`.
- `apps/web/src/lib/data.ts:828-853` filters `processed = true`, optionally filters topic, groups tags, and orders by `updated_at DESC, created_at DESC, id DESC`.
- `apps/web/src/db/schema.ts:94-100` defines `created_at` and `updated_at`, but `apps/web/src/db/schema.ts:114-120` only indexes processed/capture-date, processed/created-at, topic/processed/capture-date, filename, and uploader.

Concrete failure scenario:
RSS readers and crawlers poll `/feed.xml` and topic feeds. On a large gallery, MySQL cannot satisfy `WHERE processed = true ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 50` from the existing processed/created-at index, so feed hits can scan/sort many processed rows even though only 50 entries are returned. Topic feeds have the same mismatch because the topic index is capture-date oriented.

Concrete fix:
Add feed-shaped indexes such as `(processed, updated_at, created_at, id)` and, if topic feeds matter, `(topic, processed, updated_at, created_at, id)`. Re-check whether the `GROUP BY images.id` plus tag aggregation changes the chosen plan; if it does, split feed row selection into an indexed ID subquery followed by tag aggregation for those 50 IDs.

### PERF-C14-08 - Pipeline-version backfill candidate scans do not have a supporting index

Severity: Medium
Confidence: Medium

Evidence:
- `apps/web/src/lib/admin-backfill-runner.ts:370-379` counts candidates with `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < IMAGE_PIPELINE_VERSION)`.
- `apps/web/src/lib/admin-backfill-runner.ts:400-408` fetches each keyset batch with the same pipeline-version predicate plus `id > cursor`.
- `apps/web/scripts/backfill-color-pipeline.ts:337-348` uses the same stale-pipeline predicate, or `processed = TRUE` for `--force-reencode`.
- `apps/web/src/db/schema.ts:76-77` defines `pipeline_version`, but `apps/web/src/db/schema.ts:114-120` has no `(processed, pipeline_version, id)` index.

Concrete failure scenario:
After most images are current and only a small tail is stale, every in-app backfill run still evaluates the stale-pipeline predicate across the processed set to count and fetch batches. On larger galleries or repeated admin checks this can turn a maintenance operation into repeated table scans before any encoding work starts.

Concrete fix:
Add and validate a composite index for candidate discovery, likely `(processed, pipeline_version, id)`, and compare plans for the `IS NULL OR < version` predicate. If MySQL does not use it well, consider normalizing NULL to `0`, a generated stale key, or splitting NULL and `< version` branches with `UNION ALL`.

## Risks Needing Manual Validation

### PERF-C14-09 - Semantic/similar search is bounded brute force and CLIP waiters are unbounded

Severity: Medium
Confidence: Medium

Evidence:
- `apps/web/src/lib/clip-embeddings.ts:36-44` defaults `SEMANTIC_SCAN_LIMIT` to 2000 and allows an environment cap up to 25000.
- `apps/web/src/app/api/search/semantic/route.ts:261-305` loads the most recent embeddings, decodes every vector, scores all scanned rows, and then calls `topK`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170` uses the same recent-embedding brute-force shape for image similarity.
- `apps/web/src/lib/clip-embeddings.ts:164-168` filters and sorts the full scored list to compute top K.
- `apps/web/src/lib/clip-model.ts:53-70` caps active inference but stores pending callers in an unbounded `inferenceWaiters` array with no timeout or abort propagation.
- `apps/web/src/db/schema.ts:291-295` does provide the model/version updated-at index for the scan, so the main remaining risk is per-request row decoding/scoring and queued inference state.

Concrete failure scenario:
At current personal-gallery scale this may be acceptable, but enabling production CLIP on a larger library shifts work to per-request DB payload plus CPU vector scoring. Distributed clients can also queue text/image inference behind the same global CLIP slot, retaining request state after users navigate away.

Concrete fix:
Load-test semantic and similar routes with the production `SEMANTIC_SCAN_LIMIT`, CLIP mode, and expected concurrent clients. Add bounded admission/backpressure for CLIP inference, timeout or abort support before entering the waiter queue, and monitoring for scan latency/rows decoded. Plan a vector index, heap-based top-K, or candidate cache before raising the scan cap.

### PERF-C14-10 - Infinite masonry retains every loaded card and image element

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/components/home-client.tsx:124-130` stores all loaded pages in one `allImages` array and appends each new page.
- `apps/web/src/components/load-more.tsx:41-96` keeps fetching pages as the sentinel is reached.
- `apps/web/src/components/home-client.tsx:286-360` maps every accumulated image into a masonry card with picture sources and image elements.

Concrete failure scenario:
Long sessions through a large topic/archive/smart collection keep all prior cards mounted. Lazy loading helps network use, but DOM nodes, layout state, event targets, image decode state, and React memory still grow linearly. Mobile Safari and lower-memory devices are the most likely to show jank.

Concrete fix:
Add virtualization/windowing after a threshold, preserving masonry height with measured placeholders. If full masonry virtualization is too invasive, cap mounted pages behind/ahead of the viewport while retaining scroll restoration metadata.

### PERF-C14-11 - Non-sargable timeline/search/smart predicates are bounded but scale-sensitive

Severity: Low-Medium
Confidence: High

Evidence:
- `apps/web/src/lib/data-timeline.ts:97-116` filters On This Day with `MONTH(capture_date)` and `DAY(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:129-141` computes timeline years with `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:186-207` filters timeline pages with `YEAR(capture_date)` and optional `MONTH(capture_date)`.
- `apps/web/src/lib/data.ts:1537-1613` public text search uses contains-style predicates and falls through to tag/alias joins when the main branch does not fill the limit.
- `apps/web/src/lib/smart-collections.ts:218-235` supports `contains` and bounded `IN`, and `apps/web/src/lib/smart-collections.ts:247-264` compiles tag predicates to subqueries, including `containsLike(tags.name, ...)`.

Concrete failure scenario:
The code comments intentionally accept these paths at personal-gallery scale, and limits prevent unbounded result materialization. As photo/tag counts grow, however, public dynamic routes and crawler traffic can repeatedly force per-row function evaluation or `%LIKE%` scans before ordering/limiting.

Concrete fix:
Use sargable date ranges or generated/indexed year, month, and month-day columns for timeline features. For smart collections and search, prefer exact indexed predicates for public collections, add EXPLAIN-backed guardrails for broad `contains` predicates, and consider a small search index if `%LIKE%` becomes hot.

### PERF-C14-12 - Service worker image freshness probe can add one HEAD RTT per warm cached image

Severity: Low
Confidence: High

Evidence:
- `apps/web/public/sw.template.js:31-38` and generated `apps/web/public/sw.js:31-38` bound image cache size to 50 MB and cap the synchronous HEAD probe at 300 ms.
- `apps/web/public/sw.template.js:227-260` and generated `apps/web/public/sw.js:227-260` perform a HEAD request with `If-None-Match` before serving a cached image when an ETag exists.
- `apps/web/src/lib/serve-upload.ts:20-80` and `apps/web/src/lib/serve-upload.ts:211-215` intentionally compute a color-settings-aware ETag behind a short module cache, so the freshness behavior is deliberate.

Concrete failure scenario:
This is a deliberate freshness tradeoff for color-impacting admin changes, not an unbounded-cache bug. Still, a warm masonry view with many cached tiles can produce many HEAD requests on the display path, and slow networks can add up to the 300 ms timeout per tile before stale bytes are served.

Concrete fix:
Measure real mobile/warm-cache waterfalls before changing it. If it becomes visible, batch or coalesce freshness checks per derivative/version, reduce synchronous checks to above-the-fold images, or use versioned derivative URLs/cache keys so freshness does not require per-tile HEAD probes.

## Final Missed-Issues Sweep

Sweep coverage:
- Re-ran repository-wide searches for high-risk performance patterns: full-file reads, `PQueue` enqueue loops, advisory locks, `COUNT(*) OVER()`, offset/listing paths, non-sargable date functions, dynamic route caching, scan limits, unbounded wording, and concurrency env knobs.
- Re-checked cross-file interactions between schema indexes and hot query ordering, upload/form parsing and GPS stripping, queue locks and pool limits, sidecar versus in-app backfill behavior, service worker freshness and upload ETags, and client rendering shapes.
- Verified known positive controls: public load-more uses keyset cursors after initial pages; shared-group/detail tag loading is batched; view-count buffers and retry maps have caps; image serving avoids per-derivative DB settings reads via a short cache; histogram computation uses a sized image contract, transfers pixel buffers to a worker, and terminates the worker.

Files skipped:
- No relevant runtime/config/script files from the inventory were intentionally skipped.
- I did not run tests because this was a review-only artifact and no production code was changed.

