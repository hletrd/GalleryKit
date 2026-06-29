# Perf Reviewer Report - Cycle 18

Review lane: `perf-reviewer`
Scope: current `HEAD` only (`88706b96d90e7cd3bab9006fc6797e88ef737200`)
Mode: review-only; no implementation changes.

## Inventory

I read `AGENTS.md`, `CLAUDE.md`, and the code-review skill instructions first. I inventoried 255 source/script files under `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, and `apps/web/scripts`, plus the runtime/config surfaces (`Dockerfile`, `docker-compose.yml`, `next.config.ts`, `nginx/default.conf`, service worker template/generated worker, migrations/schema, and prior `.context/reviews` perf history).

Relevant code/docs inspected:

- Data/DB/query paths: `data.ts`, `data-timeline.ts`, `analytics-data.ts`, `smart-collections.ts`, Drizzle schema/indexes, public pages, admin dashboard/analytics pages, semantic/similar search routes.
- CPU/memory/image paths: `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, CLIP model/embedding helpers, upload actions, Lightroom upload route, GPS stripping helpers, OG image helpers.
- Cache/runtime paths: `serve-upload.ts`, `sw.template.js`, `sw.js`, `next.config.ts`, nginx cache headers, instrumentation/shutdown helpers.
- UI responsiveness paths: masonry home grid/load-more, map route/client, timeline/year/share grids, upload dropzone, photo viewer/lightbox/search/histogram surfaces.
- Prior findings were checked against current source before inclusion. The prior deleted-photo offline SW issue is fixed by `isRevocableShareHtmlRoute`; the prior per-card `GridPicture` hydration issue is fixed by static `GridPicture` plus one delegated `GridPictureFallbackBoundary`; the prior CLIP image-preprocess-outside-slot issue is fixed because image preprocessing is now inside `withInferenceSlot`.

## Findings

### 1. CLIP inference admission still has an unbounded, abort-insensitive waiter queue

Severity: High
Confidence: High

Files/regions:
- `apps/web/src/lib/clip-model.ts:53-71`
- `apps/web/src/app/api/search/semantic/route.ts:248-255`
- `apps/web/src/lib/image-queue.ts:272-332`
- `apps/web/src/lib/image-queue.ts:697-746`

Problem: `withInferenceSlot()` limits active CLIP work, but pending callers are stored in an unbounded `inferenceWaiters` array with no max depth, timeout, priority, or abort removal. The semantic route checks abort before `embedTextReal()`, but once a caller is queued inside `withInferenceSlot()`, disconnects do not remove it. Image-queue embedding side effects are also tracked in an unbounded `sideEffects` set while waiting/draining.

Failure scenario: production semantic mode runs at default CLIP concurrency 1. A burst of public semantic searches plus post-upload embedding side effects queues many waiters. Disconnected requests remain queued and later consume ONNX/Sharp CPU anyway; the side-effect set can grow while shutdown/restore has to drain abandoned work.

Fix: replace the manual waiter array with a bounded semaphore/queue that accepts `AbortSignal`, max pending count, and max wait time. Return 429/503 on saturation, remove aborted waiters, expose queue depth, and separate interactive search admission from background image-embedding admission.

### 2. Initial listing pages combine tag aggregation with `COUNT(*) OVER()` on the hot path

Severity: Medium-High
Confidence: High

Files/regions:
- `apps/web/src/lib/data.ts:878-907`
- `apps/web/src/lib/data.ts:1409-1453`
- `apps/web/src/db/schema.ts:114-120`
- `apps/web/src/app/[locale]/(public)/page.tsx:151-176`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:141-176`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-103`

Problem: initial home/topic and smart-collection pages select image fields, left-join tags, `GROUP_CONCAT`, `GROUP BY images.id`, order by gallery chronology, and compute `COUNT(*) OVER()` before `LIMIT`. The listing indexes cover the filter/sort prefix, but the join/group/window shape prevents a cheap early-stop page fetch.

Failure scenario: a gallery grows to tens of thousands of photos with several tags per image. Every dynamic first-page request can join/group/count the full match set to return about 30 cards. Bot/crawler traffic against `revalidate = 0` pages amplifies DB CPU and pool occupancy.

Fix: split the query: first select page IDs with a keyset-compatible indexed query and `LIMIT pageSize + 1`, then fetch tags for those IDs. Remove exact total count from the hot path or cache/compute it separately. Add `EXPLAIN ANALYZE`-driven tie-breaker indexes such as `(processed, capture_date, created_at, id)` where they prove useful.

### 3. Public keyword search can run multiple leading-wildcard scans per admitted query

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/src/app/actions/public.ts:236-318`
- `apps/web/src/lib/sql-like.ts:10`
- `apps/web/src/lib/data.ts:1482-1624`

Problem: after validation and rate limiting, `searchImages()` uses `%term%` predicates across image text, camera/lens, topic slug/label, then may run tag-name and topic-alias searches in parallel. These are bounded by result limits, but leading wildcards cannot use normal B-tree indexes selectively.

Failure scenario: many users or crawlers submit short valid terms. Each admitted request can scan a large portion of `images`, then also scan/join tags and aliases. Per-IP and DB-backed rate limits help, but a distributed burst can still pin the single MySQL writer.

Fix: move keyword search to a dedicated indexed surface: MySQL FULLTEXT/ngram, a materialized normalized search table, or an external search index. Add stricter language-aware short-query handling and skip tag/alias branches below a selectivity threshold.

### 4. Batch image deletion repeats full derivative-directory scans per image and format

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/src/app/actions/images.ts:818-842`
- `apps/web/src/lib/process-image.ts:575-664`

Problem: `deleteImages()` chunks cleanup, but each image still calls `deleteImageVariantsStrict(..., [])` for WebP, AVIF, and JPEG. Passing `[]` intentionally scans the entire derivative directory to catch historical size variants, so deleting 100 images can still cause 300 full directory scans.

Failure scenario: an admin deletes a large batch on NAS-backed storage or a directory with many derivatives. DB deletion commits first, then file cleanup spends significant time walking the same directories, causing slow server actions and heavy disk I/O.

Fix: add a batch cleanup helper that scans each derivative directory once, matches all selected basenames/prefixes, and unlinks matches with bounded concurrency. Keep strict failure aggregation. Alternatively delete current deterministic sizes inline and move historical orphan sweeps to maintenance.

### 5. GPS stripping materializes large retained originals in memory

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/src/lib/process-image.ts:887-923`
- `apps/web/src/lib/process-image.ts:1737-1818`
- `apps/web/src/app/actions/images.ts:382-395`
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`

Problem: upload save streams the original to disk, but `stripGpsFromOriginal()` then does `fs.readFile(filePath)` before container-aware stripping and may also produce a scrubbed/re-encoded buffer/temp file. Allowed uploads are large enough that this defeats the streaming memory profile when GPS stripping is enabled.

Failure scenario: an admin uploads multiple 150-200 MB JPEG/HEIF/WebP originals with `strip_gps_on_upload` enabled. The process can hold original buffers, scrubbed buffers, and Sharp fallback work at once, causing RSS spikes and GC pauses on the documented small single-host deployment.

Fix: implement streaming/segment GPS stripping where possible. If buffer-based stripping remains, add a process-wide GPS-strip semaphore and a stricter max-original-size guard for in-process stripping, with clear reject/quarantine messaging.

### 6. Lightroom uploads parse the full multipart body before streaming to disk

Severity: Medium
Confidence: Medium-High

Files/regions:
- `apps/web/src/app/api/admin/lr/upload/route.ts:85-155`
- `apps/web/src/app/api/admin/lr/upload/route.ts:161-170`
- `apps/web/src/lib/process-image.ts:887-910`
- `apps/web/src/lib/upload-limits.ts:1-6`

Problem: the route checks `Content-Length` and preclaims upload quota, then calls `await request.formData()`. Only after framework multipart parsing does it validate the `File` and pass it to the streaming save path.

Failure scenario: several authenticated Lightroom clients retry near-200 MB uploads concurrently. The route can hold parsed multipart `File` bodies in process memory before disk streaming starts. Per-actor quotas do not provide a global active-body memory ceiling.

Fix: use a streaming multipart parser that writes directly to a temp file behind a process-wide active-byte semaphore. Keep per-actor quotas, but add global admission before body materialization.

### 7. Service-worker cached image hits wait on synchronous `HEAD` revalidation

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/public/sw.template.js:31-38`
- `apps/web/public/sw.template.js:224-286`
- `apps/web/public/sw.js:31-38`
- `apps/web/public/sw.js:224-286`

Problem: for cached image derivatives with an ETag, the service worker awaits a network `HEAD` before returning cached bytes. The timeout is capped at 300 ms, but every cached tile can still pay an RTT on the display path.

Failure scenario: a warm-cache masonry page opens on mobile/high-latency network with dozens of cached tiles. The service worker issues many HEAD requests and can delay LCP/near-fold tiles even though bytes are already in Cache Storage; those requests also compete with actual image/page work.

Fix: serve cached images immediately and revalidate in the background with a short metadata TTL or pipeline/settings version marker. If synchronous freshness is retained, coalesce per-URL HEADs and skip recently validated entries.

### 8. Gallery load-more keeps every loaded image in React state and DOM

Severity: Medium
Confidence: High

Files/regions:
- `apps/web/src/components/home-client.tsx:124-130`
- `apps/web/src/components/home-client.tsx:286-421`
- `apps/web/src/components/load-more.tsx:41-96`
- `apps/web/src/components/load-more.tsx:116-133`

Problem: `HomeClient` appends every loaded page into `allImages` and maps the full array into masonry cards. `LoadMore` auto-triggers via an IntersectionObserver sentinel, and there is no virtualization, DOM cap, or page segmentation threshold.

Failure scenario: a visitor scrolls through thousands of photos. All cards, links, picture/img nodes, badges, overlays, and React data remain live, increasing memory, style/layout cost, and reconciliation work. Mid-range phones are likely to see INP and scroll jank.

Fix: use windowed/virtualized masonry, or stop auto-loading after a bounded number of pages and switch to explicit pagination. Preserve scroll restoration for the retained window.

### 9. Public map can serialize and hydrate 10,000 markers plus 10,000 fallback links

Severity: Medium
Confidence: Medium-High

Files/regions:
- `apps/web/src/lib/data.ts:1641-1677`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`
- `apps/web/src/components/map/map-client.tsx:76-143`
- `apps/web/src/db/schema.ts:114-120`

Problem: `getMapImages()` caps the public map at 10,000 rows, but the route serializes all markers, renders an accessible fallback link for every marker, computes bounds from arrays of all lat/lngs, and mounts one Leaflet `<Marker>` per row. The schema has no GPS/map-specific index or denormalized map-visibility key.

Failure scenario: a large GPS-visible gallery loads `/map`. The DB scans/filter rows, the server ships a large payload, React hydrates a large fallback list, and Leaflet instantiates thousands of marker layers. Mobile browsers may stall before interaction.

Fix: move map data to a bbox/paged API with marker clustering and a virtualized/collapsed fallback list. Add a generated `has_gps` or denormalized map-visible column plus an index matching the public map filter/order if all-marker mode remains.

### 10. Timeline/archive predicates use non-sargable date functions

Severity: Low-Medium
Confidence: High

Files/regions:
- `apps/web/src/lib/data-timeline.ts:88-116`
- `apps/web/src/lib/data-timeline.ts:125-145`
- `apps/web/src/lib/data-timeline.ts:172-207`
- `apps/web/src/db/schema.ts:114-116`

Problem: timeline queries use `MONTH(capture_date)`, `DAY(capture_date)`, and `YEAR(capture_date)` predicates/order expressions. Comments correctly document that only the `processed` prefix of `idx_images_processed_capture_date` narrows the scan in these cases.

Failure scenario: as the gallery grows or crawlers hit archive pages, MySQL evaluates date functions per processed row, then joins/group tags for up to 501 photos. It is bounded, but it is a predictable archive hotspot.

Fix: rewrite year/month filters as range predicates. For on-this-day, add generated month/day columns and an index, or precompute a small archive/date table.

### 11. Admin dashboard and analytics parallel fanout can exhaust the small shared pool

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

Problem: the MySQL pool has 10 connections and queue limit 20. Dashboard starts seven operations in one `Promise.all`; analytics starts five aggregate queries in parallel. These share the same pool with public requests, uploads, image queue claims, view flushes, and semantic search.

Failure scenario: two admin tabs load dashboard/analytics while background processing or public traffic is active. Parallel aggregates occupy most pool slots, downstream requests queue, and the app can surface intermittent DB timeout/queue failures.

Fix: sequence cheap settings reads after primary data, combine dashboard counts where possible, and cap admin aggregate concurrency. Longer term, use separate pools/budgets for analytics/background work.

### 12. Semantic and similar search decode and score every scanned embedding in process

Severity: Low-Medium
Confidence: Medium

Files/regions:
- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/lib/clip-embeddings.ts:164-168`
- `apps/web/src/app/api/search/semantic/route.ts:261-305`
- `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`

Problem: both routes scan up to `SEMANTIC_SCAN_LIMIT` rows, decode every 512-d vector, score every row, and pass the full scored array into `topK()`, which filters, sorts the whole list, and slices. The hard cap is 25,000, so this is bounded but scales linearly with the operator-tuned scan limit.

Failure scenario: an operator raises `SEMANTIC_SCAN_LIMIT` for recall. A few concurrent requests decode and score tens of thousands of vectors in Node, then full-sort results, competing with image processing and request handling.

Fix: keep the default low unless production profiling supports raising it. Replace full sort with a size-K heap/selection algorithm and add metrics for scanned rows, decode time, scoring time, and queue wait. Consider vector search/ANN before raising the cap materially.

### 13. Upload dropzone renders object URLs and full preview cards for every selected file

Severity: Low-Medium
Confidence: Medium

Files/regions:
- `apps/web/src/components/upload-dropzone.tsx:100-130`
- `apps/web/src/components/upload-dropzone.tsx:143-145`
- `apps/web/src/components/upload-dropzone.tsx:459-543`
- `apps/web/src/lib/upload-limits.ts:1-6`

Problem: the client creates object URLs for every selected file and renders every preview card, tag input, image, and remove button in one grid. The server-side/default upload window allows up to 100 files, and no visible-window cap or virtualization exists in the dropzone.

Failure scenario: an admin selects a large batch from a camera card. The browser holds object URLs and decodes/layouts up to 100 preview cards, each with nested controls and per-file tag state. On laptop/mobile admin sessions this can make the upload page sluggish before the upload even begins.

Fix: virtualize or paginate the preview grid after a small visible count, defer preview image loading outside the visible window, and keep object URLs only for visible/near-visible previews. Maintain aggregate batch validation separately from preview rendering.

## Positive Controls Observed

- Sharp/libvips concurrency and cache are explicitly bounded; input pixel limits are enforced.
- CLIP image preprocessing is now inside the inference slot, closing the earlier unbounded-preprocess issue.
- `GridPicture` is static markup and fallback handling is delegated to one client boundary per grid, closing the earlier per-card hydration issue.
- Revocable photo/share/map HTML routes bypass service-worker offline caching, closing the stale-deleted-photo offline issue.
- Rate-limit maps, upload tracker state, view-count retry state, and image-queue retry/permanent-failure maps are bounded or pruned.
- Upload serving streams file responses and has settings-hash TTL/inflight dedupe.

## Coverage Gaps

- I did not run benchmarks, Lighthouse, Playwright traces, production SQL `EXPLAIN ANALYZE`, load tests, or inspect production slow-query logs/cardinalities.
- Severity for DB findings is based on current query shape, schema/indexes, and documented single-host topology. Validate index/migration choices against production-like data before implementing.
- I inspected both `sw.template.js` and generated `sw.js`; future fixes should update the template and regenerate the worker.

## Final Missed-Issues Sweep

I re-swept current source for unbounded collections, `Promise.all` fanout, `request.formData()`, large buffers/`arrayBuffer()`, sync service-worker work, `COUNT(*) OVER()`, non-sargable date functions, leading-wildcard search, dynamic public routes, image-processing fanout, map/list payload caps, and public/admin DB fanout. The 13 findings above are the actionable performance/concurrency/UI-responsiveness issues that survived current-source verification and deduplication. I did not find a new deploy-script runtime performance defect beyond documented Docker/disk hygiene tradeoffs.
