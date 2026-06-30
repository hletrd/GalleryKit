# Cycle 25 Performance Reviewer Report

Review target: `/Users/hletrd/flash-shared/gallery`
Review role: `cycle-25 perf-reviewer`
Mode: review-only. No commits or pushes.
Output file: `.context/reviews/perf-reviewer.md`

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried the repo before inspecting current source. I did not rely on stale pre-cycle findings; prior reports were used only as a checklist to re-validate against current files.

Inventory evidence:

- Reviewable files outside generated/runtime upload data: 702 files under `apps`, `scripts`, `docs`, and `.github`.
- App source inventory: 507 TS/TSX/JS/JSX files under `apps/web/src`, about 79,910 lines.
- Focused source/test/script inventory: `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, and `apps/web/scripts` total about 46,306 lines.
- Excluded from line-by-line review: `.git`, `node_modules`, `.next`, uploaded image/data directories, binary image/font fixtures, historical screenshots, and runtime logs.

Review areas inspected:

- Public rendering/data paths: home, topic, smart collection, photo, share, map, timeline/year, feed/sitemap, `lib/data.ts`, `lib/data-timeline.ts`, `lib/smart-collections.ts`, and schema/indexes.
- Client responsiveness: masonry/list loading, map, lightbox, photo viewer, search, histogram, service worker image caching.
- CPU/memory/I/O: upload actions, Lightroom upload route, image processing, GPS stripping, CLIP inference/search, OG image generation.
- Concurrency/queues: image queue, admin backfill runner, sidecar scripts, restore/shutdown handling, advisory locks, rate-limit maps, upload tracker, DB pool usage.
- Runtime/deploy/cache: Dockerfile, compose, deploy scripts, nginx config, Next config, service worker, `serve-upload`, settings hash, revalidation helpers.

## Confirmed Issues

### PERF-C25-01 - Public first-page gallery queries still compute exact grouped totals

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/data.ts:878-907` builds `getImagesLitePage()` with `LEFT JOIN imageTags`, `LEFT JOIN tags`, `GROUP BY images.id`, `COUNT(*) OVER()`, sort, limit, and offset.
- `apps/web/src/lib/data.ts:1446-1461` repeats the same counted grouped shape for initial smart-collection pages.
- `apps/web/src/app/[locale]/(public)/page.tsx:149-168` dynamically renders the home page and calls `getImagesLitePage(..., PAGE_SIZE, 0)`.
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:166-178` calls the counted first-page query for topic pages.
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-109` calls the counted smart-collection query before rendering the first 30 cards.
- `apps/web/src/components/home-client.tsx:267-269` renders `totalCount`, making the exact count part of the user-visible contract.

Problem: these public pages return about 30 cards, but MySQL still has to aggregate tags, group by image, sort, and compute an exact total for the whole matching set. The routes are `revalidate = 0`, so crawler or visitor traffic repeats this work on the hottest unauthenticated paths.

Failure scenario: a gallery reaches tens of thousands of processed photos with multiple tags. Repeated home/topic/tag/smart-collection first-page hits force temp-table/grouped count work before sending one page, raising DB CPU and TTFB.

Suggested fix: split first paint from exact totals. Use a keyset/listing query with `limit + 1` for `hasMore`, fetch tags only for returned IDs, and replace exact public totals with cached/async counts, approximate counts, or copy that does not require an exact total. For smart collections, keep the cursor path for first page unless exact totals are explicitly requested.

### PERF-C25-02 - Image queue concurrency cap ignores each worker's transient DB connection need

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/image-queue.ts:87-107` resolves `QUEUE_CONCURRENCY` as `poolLimit - reserved`, yielding 5 at the default 10-connection pool.
- `apps/web/src/__tests__/image-queue-concurrency-cap.test.ts:39-64` locks that default cap at 5 and asserts only `limit - cap >= reserved`.
- `apps/web/src/lib/image-queue.ts:463-479` acquires a MySQL advisory lock on a pooled connection and keeps it.
- `apps/web/src/lib/image-queue.ts:571-574` performs a normal `db.select()` while the lock connection is still held.
- `apps/web/src/lib/image-queue.ts:639-654` runs Sharp encoding while the lock connection remains held.
- `apps/web/src/lib/image-queue.ts:672-674` performs the success `db.update()` while the lock connection is still held.
- `apps/web/src/db/index.ts:23-33` sets the shared pool to 10 connections with queue limit 20.

Problem: the cap reserves only the long-held claim connections. Each in-flight worker can also need a second pooled connection for DB reads/updates while still holding its claim. At default settings, 5 queue workers can pin 5 claim connections and simultaneously consume up to 5 more transient DB connections, temporarily exhausting the whole pool.

Failure scenario: an operator raises `QUEUE_CONCURRENCY` to 5 on a busy host. Five image encodes run, each holding an advisory-lock connection; when they all hit row checks, success updates, failed updates, or side effects, the pool can hit 10/10 and public/admin requests queue behind CPU-bound processing. With `queueLimit: 20`, bursts can become request failures rather than just latency.

Suggested fix: use the same budget shape as `admin-backfill-runner`: cap live queue workers around `floor((POOL_CONNECTION_LIMIT - RESERVED) / 2)` for one long claim plus one transient DB connection per worker. At the default pool/reserve, that means 2 workers, not 5. Update `image-queue-concurrency-cap.test.ts` to assert the two-connection invariant.

### PERF-C25-03 - GPS stripping buffers full originals after the upload was streamed

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/process-image.ts:905-910` correctly streams the uploaded original to disk.
- `apps/web/src/lib/process-image.ts:1737-1764` then `fs.readFile(filePath)` loads the full original into heap for GPS stripping and writes the scrubbed buffer.
- `apps/web/src/lib/gps-exif-strip.ts:224`, `apps/web/src/lib/gps-exif-strip.ts:364`, `apps/web/src/lib/gps-exif-strip.ts:380`, and `apps/web/src/lib/gps-exif-strip.ts:590` copy buffers in scrubber paths.
- `apps/web/src/app/actions/images.ts:388-401` runs this in the browser upload path when `stripGpsOnUpload` is enabled.
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-385` runs the same path for Lightroom uploads.

Problem: the upload path avoids a 200 MB request-body heap allocation, but GPS stripping reintroduces full-file buffering and may allocate at least one additional copy. For large JPEG/HEIC/WebP/TIFF originals, peak per-upload heap/native pressure can approach multiple times the original size.

Failure scenario: an admin enables `strip_gps_on_upload` and uploads one or more 150-200 MB originals. The server action serializes files, but each GPS-strip step can still allocate hundreds of MB during the action, increasing GC pressure or risking OOM on the disk-constrained production host while image processing/backfill/CLIP are active.

Suggested fix: add a streaming or bounded-segment scrub path for JPEG APP1/XMP and ISOBMFF metadata where possible, or set a lower GPS-strip in-memory threshold with a sidecar/quarantine path for oversized originals. If whole-file buffering remains necessary, document and enforce a separate `GPS_STRIP_MAX_BUFFER_BYTES` below the global 200 MB upload cap and surface a clear admin error.

### PERF-C25-04 - Upload-processing contract lock spans slow I/O and CPU work

Severity: Low-Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/upload-processing-contract-lock.ts:9-56` acquires a MySQL advisory lock on a pooled connection until release.
- `apps/web/src/app/actions/images.ts:175-190` acquires the lock before config snapshot and quota tracking.
- `apps/web/src/app/actions/images.ts:346-404` still holds it while saving originals, reading metadata, extracting EXIF, and optionally stripping GPS.
- `apps/web/src/app/actions/images.ts:628-630` releases it only after the whole browser upload action finishes.
- `apps/web/src/app/api/admin/lr/upload/route.ts:252-275` acquires the same lock for Lightroom uploads.
- `apps/web/src/app/api/admin/lr/upload/route.ts:307-461` holds it through save, metadata, GPS stripping, restore checks, and DB insert.
- `apps/web/src/app/api/admin/lr/upload/route.ts:548-552` releases it at the end of the route.

Problem: the lock protects important upload-setting consistency, but the critical section includes large file I/O, metadata decode, GPS scrub, and other work that does not all need serialization. It also pins one shared DB pool connection for the full wall-clock upload window.

Failure scenario: a large browser batch or Lightroom upload over slow storage holds the contract lock for seconds to minutes. Concurrent uploads and settings changes wait up to the lock timeout and fail with retry errors, while one pooled connection is unavailable to unrelated requests.

Suggested fix: shrink the lock to the true contract boundary: settings snapshot, quota reservation, lock-once setting checks, and DB row insert/first-write state. Move file streaming, metadata extraction, and GPS stripping outside the lock using the immutable settings snapshot. If the full-span lock remains intentional, move it to a dedicated non-pooled connection and document expected contention.

### PERF-C25-05 - Infinite masonry keeps every loaded photo mounted

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/components/home-client.tsx:124-130` stores all loaded images and appends pages with `setAllImages(prev => [...prev, ...newImages])`.
- `apps/web/src/components/home-client.tsx:195-197` derives item count from the full accumulated list.
- `apps/web/src/components/home-client.tsx:286-411` maps every accumulated image into live card/link/picture DOM.
- `apps/web/src/components/load-more.tsx:41-61` appends every loaded page.
- `apps/web/src/components/load-more.tsx:116-132` auto-loads via an `IntersectionObserver` sentinel.

Problem: there is no virtualization, page cap, or DOM recycling. State, DOM nodes, image elements, layout work, and React reconciliation grow linearly with scroll depth.

Failure scenario: a visitor scrolls through thousands of photos on mobile. Memory and CSS column layout work keep growing until scrolling and taps become janky or the tab is evicted.

Suggested fix: virtualize/window the masonry grid, or cap automatic loading after a fixed number of pages and switch to explicit pagination. Preserve cursor anchors and scroll restoration while recycling offscreen cards.

### PERF-C25-06 - Public map can still serialize and mount up to 10,000 markers plus list rows

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/data.ts:1649-1685` caps `/map` at `MAP_MAX_MARKERS = 10000`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-50` turns every DB row into a marker payload.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:68-75` passes all markers to the client.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:77-89` renders an HTML list item for every marker.
- `apps/web/src/components/map/map-client.tsx:86-90` allocates latitude/longitude arrays and spreads them into `Math.min`/`Math.max`.
- `apps/web/src/components/map/map-client.tsx:119-140` renders one React-Leaflet `<Marker>` and `<Popup>` per marker.

Problem: the result is bounded, but the bound is too high for one route payload and initial client render. Ten thousand React-Leaflet markers plus ten thousand list entries can freeze the main thread.

Failure scenario: a travel archive has thousands of map-visible GPS photos. `/map` becomes slow to stream, hydrate, fit bounds, and interact with, especially on mobile.

Suggested fix: replace the one-shot payload with viewport-bounded marker fetches and clustering/canvas rendering. Virtualize or paginate the accessible list. Compute bounds in one loop rather than allocating arrays and spreading 10k values.

### PERF-C25-07 - CSV export buffers rows, lines, response string, and browser Blob

Severity: Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:79-84` documents the in-memory CSV export profile.
- `apps/web/src/app/[locale]/admin/db-actions.ts:102-117` loads up to 50,000 grouped rows at once.
- `apps/web/src/app/[locale]/admin/db-actions.ts:124-152` builds a `csvLines` array and then joins it into one string.
- `apps/web/src/app/[locale]/admin/db-actions.ts:156-159` returns the full CSV through a server action.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:103-124` receives the string and creates a browser `Blob`.

Problem: the export creates multiple large live objects: DB result rows, CSV line array, joined CSV string, server-action transport payload, and browser Blob. The row cap prevents unbounded growth, but 50,000 image rows with long titles/tags is still a large memory spike.

Failure scenario: an admin exports a large gallery while image processing or public traffic is active. Node and the browser both allocate large CSV copies, causing GC pauses or action failure.

Suggested fix: move CSV export to an authenticated streaming route or background export file. Stream rows from MySQL in batches and write CSV chunks with backpressure instead of returning a server-action string.

### PERF-C25-08 - Timeline/archive routes use non-sargable date predicates on dynamic pages

Severity: Low-Medium
Confidence: High
Status: Confirmed

Files/regions:

- `apps/web/src/lib/data-timeline.ts:97-116` filters On This Day with `MONTH(capture_date)` and `DAY(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:129-142` derives years with `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:186-207` filters timeline/year pages with `YEAR(capture_date)` and optional `MONTH(capture_date)`.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:16` sets `revalidate = 0`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84` loads years and photos on each render.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:17` sets `revalidate = 0`; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:80-89` loads the year review.
- `apps/web/src/db/schema.ts:116-120` has capture-date indexes but no generated year/month/day columns.

Problem: wrapping `capture_date` in functions prevents normal range use of the capture-date index. The comments acknowledge this, but these are public dynamic routes.

Failure scenario: crawler traffic over `/timeline` and `/year/2024` repeatedly scans the processed image slice and evaluates date functions row-by-row before grouping tags.

Suggested fix: rewrite year/month filters to range predicates (`capture_date >= start AND capture_date < end`). For On This Day and distinct years, add generated date-part columns/indexes or maintain a small archive rollup. Consider short TTL caching if immediate freshness is not required.

### PERF-C25-09 - Shared public topic helper computes sitemap-only timestamps on nav paths

Severity: Low
Confidence: Medium
Status: Confirmed cost, production impact needs EXPLAIN

Files/regions:

- `apps/web/src/lib/data.ts:509-529` selects every topic and computes `last_image_updated_at` with a correlated `MAX(images.updated_at)` subquery per topic.
- `apps/web/src/components/nav.tsx:8-20` calls `getTopicsCached()` for public navigation.
- `apps/web/src/app/[locale]/(public)/layout.tsx:4-17` renders `Nav` around public pages.
- `apps/web/src/app/sitemap.ts:40-72` is the caller that actually uses `last_image_updated_at`.
- `apps/web/src/db/schema.ts:116-120` has `(topic, processed, capture_date, created_at)` but not `(topic, processed, updated_at)`.

Problem: most public page renders need topic slug/label/order/map visibility for nav, not per-topic latest image update timestamps. The current shared helper makes the nav pay for sitemap metadata.

Failure scenario: many topics and a large image table make each public render execute correlated `MAX(updated_at)` lookups that are only relevant to the hourly sitemap.

Suggested fix: split `getTopicsForNav()` from `getTopicsForSitemap()`. Keep nav lean, and either add `(topic, processed, updated_at)` or denormalize per-topic latest timestamps if sitemap freshness needs to stay query-driven.

### PERF-C25-10 - Cached images wait on a synchronous HEAD probe per tile

Severity: Low-Medium
Confidence: Medium
Status: Confirmed code path; UX impact needs trace validation

Files/regions:

- `apps/web/public/sw.template.js:34-38` sets a 300 ms HEAD revalidation timeout.
- `apps/web/public/sw.template.js:184-191` handles image derivatives through the service-worker cache.
- `apps/web/public/sw.template.js:250-280` awaits a `HEAD` request with `If-None-Match` before serving a cached image.
- `apps/web/public/sw.template.js:281-286` serves stale only after that probe fails or completes without a decisive mismatch.
- `apps/web/public/sw.js:250-280` contains the shipped generated copy.

Problem: the freshness intent is clear, but the display path can wait on one HEAD round-trip per cached image. A warm masonry page with 30 cached tiles can issue 30 concurrent HEADs and delay cached image paint by up to the probe timeout on slow networks.

Failure scenario: a returning mobile visitor opens the gallery on a high-latency connection. Instead of painting cached thumbnails immediately, each cached image request blocks on a HEAD probe, adding visible blank/placeholder time and origin request load.

Suggested fix: make stale-serve immediate and move HEAD/GET revalidation fully into the background for normal image loads. If immediate post-backfill freshness is required, gate synchronous validation behind a manifest/version endpoint, a single per-page freshness token, or a short global cooldown so one page paint does not pay N HEAD probes.

## Likely Issues / Manual Validation Targets

### PERF-C25-11 - Analytics page fans out aggregate scans on the shared pool

Severity: Low-Medium
Confidence: Medium
Status: Likely; validate with production `EXPLAIN ANALYZE`

Files/regions:

- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36` dispatches five analytics queries concurrently with `Promise.all`.
- `apps/web/src/lib/analytics-data.ts:28-46`, `62-79`, `112-127`, `161-180`, and `192-207` run grouped/count queries for photos, topics, countries, referrers, and shared groups.
- `apps/web/src/lib/analytics-data.ts:93-111` and `188-191` document temp-table style aggregation for `window=all`.
- `apps/web/src/db/index.ts:23-33` shows these share the 10-connection pool.

Failure scenario: an admin opens analytics with `window=all` during upload/backfill/public traffic. Five grouped scans consume DB CPU and pool slots together, amplifying tail latency for unrelated requests.

Suggested fix: add short TTL caching keyed by window, materialized daily/hourly rollups, or a small concurrency limiter for analytics queries. Validate first with production-like cardinalities.

## Final Missed-Issue Sweep

- N+1 query sweep: shared groups batch tag lookup in `apps/web/src/lib/data.ts:1293-1317`; semantic/similar search enrich result IDs in one query; upload tag creation is per unique tag but upload-scope bounded. No additional high-confidence N+1 was found.
- Queue/drain sweep: `queue-shutdown`/image queue use `onIdle()` and tests cover paused queue deadlock; backfill scripts also use `onIdle()`. No current queue-drain deadlock finding beyond the queue pool-budget issue above.
- Unbounded memory/map sweep: rate-limit maps use `BoundedMap`; upload tracker has expiry and hard cap; queue retry/permanent-failure maps are capped. No new unbounded Map finding.
- CLIP/semantic sweep: inference concurrency and pending depth are bounded in `clip-model.ts`; semantic scans are capped by `SEMANTIC_SCAN_LIMIT`; routes check aborts around expensive stages. Remaining CLIP concerns are operational sizing, not unbounded code paths.
- Image pipeline sweep: Sharp cache is disabled and upload originals stream to disk. The confirmed memory issue is specifically the post-save GPS stripping full-file buffer path.
- Cache invalidation sweep: derivative cache policy is consistently non-immutable across Next/nginx/serve-upload; settings-hash invalidation is present on route-handler serving. The remaining cache responsiveness concern is the service worker's per-tile synchronous HEAD probe.
- Deploy/runtime sweep: Docker shutdown signal handling, bind mounts, health checks, and deploy prune ordering are documented and source-backed. No additional deploy bottleneck was confirmed without runtime profiling.

## Suggested Validation

- Run `EXPLAIN ANALYZE` for `getImagesLitePage`, first-page smart collections, `getTopics`, timeline/year queries, and analytics `window=all` on a production-sized DB copy.
- Capture browser performance traces for deep masonry scrolling, `/map` near marker cap, and a service-worker-warm gallery load on high latency.
- Load-test `QUEUE_CONCURRENCY` values above 2 while public pages render, watching MySQL pool queueing, Node event-loop delay, and request failure rate.
- Measure heap/RSS during `strip_gps_on_upload` with 100-200 MB JPEG/HEIC originals before deciding streaming vs threshold behavior.
