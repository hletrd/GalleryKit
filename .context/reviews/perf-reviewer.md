# Cycle 13 Performance Review

Role: perf-reviewer subagent
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-06-29

This is a read-only repository review from the performance, concurrency, CPU/memory, database/query, image pipeline, cache, and UI responsiveness angle. I read `AGENTS.md` and `CLAUDE.md` first, then built an inventory of performance-relevant files excluding `node_modules`, `.git`, build output, and runtime upload/data directories. I did not modify production code.

## Inventory Reviewed

Server render/actions/routes:
- Public pages under `apps/web/src/app/[locale]/(public)/**`, including home, topic, photo, shared group, map, timeline, smart collection, search, feed, sitemap/robots, and OG metadata paths.
- Admin pages under `apps/web/src/app/[locale]/admin/(protected)/**`, especially dashboard, settings, analytics, bulk operations, backup/restore, semantic tools, and login/session surfaces.
- Server actions in `apps/web/src/app/actions/**`.
- API routes under `apps/web/src/app/api/**`, including uploads, Lightroom upload, semantic/similar search, OG routes, analytics, health, service worker, and admin APIs.

Data/query/concurrency layer:
- `apps/web/src/lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `smart-collections.ts`, `gallery-config.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `bounded-map.ts`, `view-count-buffer.ts` behavior inside `data.ts`, `clip-embeddings.ts`, and related helpers.
- `apps/web/src/db/index.ts`, `schema.ts`, migrations, and Drizzle journal/schema contracts.

Image, upload, queue, and CLIP pipeline:
- `apps/web/src/lib/process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, `clip-model.ts`, `clip-jobs.ts`, `clip-paths.ts`, `serve-upload.ts`, upload limits/trackers, and Lightroom upload handling.

Client/UI/cache surfaces:
- `apps/web/src/components/**`, with focus on masonry/gallery, load-more, lightbox, map, timeline, search, similar photos, admin dashboard/settings, upload controls, and image rendering wrappers.
- `apps/web/public/sw.template.js` and generated `apps/web/public/sw.js`.

Scripts/config/deploy:
- `apps/web/scripts/**`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, package scripts, lint/test guards, Playwright/Vitest performance-sensitive coverage, and `.context/reviews` history.

## Confirmed Issues

### PERF-C13-01 - Public map still serializes and renders up to 10k markers plus 10k links

Severity: High
Confidence: High

Evidence:
- `apps/web/src/lib/data.ts:1649-1676` caps `getMapImages()` at `MAP_MAX_MARKERS = 10000`, then returns the most recent GPS-visible rows.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-35` fetches the full marker set on every dynamic map request (`revalidate = 0` at `apps/web/src/app/[locale]/(public)/map/page.tsx:9-10`).
- `apps/web/src/app/[locale]/(public)/map/page.tsx:39-50` maps every returned row into a client marker payload.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:59-66` passes the entire marker array through the RSC/client boundary, and `apps/web/src/app/[locale]/(public)/map/page.tsx:67-79` server-renders a link list for every marker.
- `apps/web/src/components/map/map-loader.tsx:9-12` disables SSR only for `MapClient`; the full marker prop still has to be serialized to the client.
- `apps/web/src/components/map/map-client.tsx:76-93` computes bounds from all markers, and `apps/web/src/components/map/map-client.tsx:119-143` renders one Leaflet `<Marker>` and `<Popup>` per marker.

Concrete failure scenario:
If an opted-in map-visible topic reaches thousands of GPS-tagged photos, `/map` ships a large RSC payload, server-renders thousands of accessible links, and then asks React/Leaflet to instantiate thousands of markers/popups on the browser main thread. At the documented 10k cap this can create long tasks, high memory use, slow navigation, and an unusable map on mobile.

Suggested fix:
Keep the privacy guard, but stop treating 10k as a renderable UI cap. Use viewport/bounds-based server fetching, marker clustering (`supercluster` or equivalent), and a paginated or virtualized accessible list. If the first iteration must stay simple, cap initially rendered markers to a much lower number and show an explicit "zoom/filter to see more" state.

### PERF-C13-02 - Admin dashboard loads and renders every permanently failed image

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/lib/data.ts:1000-1013` defines `getFailedImages()` with `processed = false`, `processing_error IS NOT NULL`, `ORDER BY failed_at DESC`, and no limit.
- `apps/web/src/db/schema.ts:101-119` has indexes for processed/capture-date, processed/created-at, topic, filename, and uploader, but no failed-list index shaped for `(processed, failed_at)` or failure status.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27` fetches `getFailedImages()` in the main dashboard `Promise.all`.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:73-120` synchronously renders every failed row into the initial dashboard DOM.

Concrete failure scenario:
A corrupt import, unsupported format batch, or missing originals can create thousands of permanently failed rows. Opening `/admin/dashboard` then scans/sorts all failed rows, serializes them into the RSC payload, hydrates them into client state, and renders all retry controls at once. The dashboard becomes slow exactly when the admin needs it for queue recovery.

Suggested fix:
Add pagination or a small default limit for failed images, expose a separate failed count, and lazy-load additional failures. Add an index such as `(processed, failed_at)` or a more explicit processing-status index after checking MySQL `EXPLAIN`.

## Likely Issues

### PERF-C13-03 - First public listing pages perform count-window work on dynamic requests

Severity: Medium
Confidence: Medium

Evidence:
- `apps/web/src/lib/data.ts:878-907` builds the first-page listing query with `COUNT(*) OVER()`, `LEFT JOIN imageTags`, `LEFT JOIN tags`, `GROUP BY images.id`, gallery ordering, and `LIMIT pageSize + 1`.
- The hot public entry points are dynamic: home sets `revalidate = 0` at `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, topic pages at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`, and smart collection pages at `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:14`.
- Those pages call the counting listing helpers during render at `apps/web/src/app/[locale]/(public)/page.tsx:164-167`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:174-176`, and `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`.

Concrete failure scenario:
For large galleries, broad topics, or crawler bursts, the initial page can require MySQL to evaluate/group/count the whole matching set before returning 31 visible rows. Because the pages deliberately bypass ISR for freshness, repeated anonymous requests repeat that work.

Suggested fix:
Avoid exact `totalCount` in the hot SSR query. Return `hasMore` from `LIMIT + 1` and load exact counts asynchronously, cache counts with short TTL/tag invalidation, or precompute per-topic/tag/collection counts. Validate candidate rewrites with `EXPLAIN ANALYZE` on production-like data before changing semantics.

### PERF-C13-04 - Image processing jobs can pin shared DB pool connections through Sharp work

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/db/index.ts:23-33` configures one shared MySQL pool with `connectionLimit = 10` and `queueLimit = 20`.
- `apps/web/src/lib/image-queue.ts:87-90` allows `QUEUE_CONCURRENCY` up to 8.
- `apps/web/src/lib/image-queue.ts:446-462` acquires a MySQL advisory lock by checking out a pool connection.
- `apps/web/src/lib/image-queue.ts:519-637` keeps that lock connection while resolving the original, loading fallback config, and running Sharp derivative generation.
- `apps/web/src/lib/image-queue.ts:653-657` updates the processed row before `apps/web/src/lib/image-queue.ts:812-815` finally releases the lock.

Concrete failure scenario:
The default concurrency is conservative, but an operator can raise `QUEUE_CONCURRENCY` to 8. Eight image jobs can then hold eight of ten shared DB connections during CPU/disk-heavy Sharp work, leaving live public/admin requests competing for two connections and a queue of 20. Upload bursts or bootstrap retries can therefore translate into request latency or pool queue failures.

Suggested fix:
Do not hold shared-pool connections across Sharp work. Use a tiny dedicated advisory-lock pool, move to a row-claim/lease that releases the connection immediately, or clamp effective queue concurrency by reserved live-traffic pool capacity. Document that queue concurrency consumes DB capacity if advisory locks remain connection-bound.

### PERF-C13-05 - GPS stripping materializes whole originals after the streaming save path

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/lib/process-image.ts:887-910` streams accepted uploads to disk to avoid buffering large files during save.
- `apps/web/src/lib/process-image.ts:1738-1764` immediately re-reads the entire original with `fs.readFile(filePath)` and may allocate a full scrubbed output buffer.
- `apps/web/src/lib/process-image.ts:1773-1786` can keep the original `input` buffer while Sharp re-encodes fallback formats.
- Browser uploads call this when `stripGpsOnUpload` is enabled at `apps/web/src/app/actions/images.ts:381-388`.
- Lightroom uploads first materialize multipart data with `request.formData()` at `apps/web/src/app/api/admin/lr/upload/route.ts:150-153`, then call the same stripper at `apps/web/src/app/api/admin/lr/upload/route.ts:365-377`.

Concrete failure scenario:
With GPS stripping enabled, a 200 MB original can exist as multipart/form state, an on-disk file, a full `fs.readFile` buffer, and a scrubbed or re-encode output buffer. A Lightroom publish burst or several large browser uploads can create GC churn or process OOM despite the initial upload writer being streaming.

Suggested fix:
Keep the streaming save, but add a memory-budget gate around GPS stripping while the scrubbers are buffer-based. Prefer range/container-aware or streaming scrubbers for JPEG/TIFF/ISOBMFF/WebP where feasible. For Lightroom, evaluate a streaming multipart parser so large files are not materialized before the same GPS strip work.

## Risks Needing Manual Validation

### PERF-C13-06 - Semantic search remains bounded brute force with an unbounded CLIP waiter queue

Severity: Medium
Confidence: Medium-High

Evidence:
- `apps/web/src/lib/clip-embeddings.ts:36-44` defaults `SEMANTIC_SCAN_LIMIT` to 2000 and allows an environment cap up to 25000.
- `apps/web/src/app/api/search/semantic/route.ts:261-305` loads the most recent embeddings for the active model, decodes each vector, and scores all scanned rows per request.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170` uses the same recent-embedding brute-force shape for image similarity.
- `apps/web/src/lib/clip-model.ts:53-70` caps active inference but stores pending callers in an unbounded `inferenceWaiters` array with no timeout or abort propagation.

Concrete failure scenario:
At current personal-gallery scale this may be acceptable, but enabling production CLIP on a larger library shifts work to per-request DB payload plus CPU vector scoring. Distributed clients can also queue text/image inference behind the same global CLIP slot, retaining request state after users navigate away.

Suggested fix:
Load-test semantic and similar routes with the production `SEMANTIC_SCAN_LIMIT`, CLIP mode, and expected concurrent clients. Add bounded global admission/backpressure for CLIP inference, timeout or abort support before entering the waiter queue, and monitoring for scan latency/rows decoded. Plan a vector index or shard/candidate cache before raising the scan cap.

### PERF-C13-07 - Infinite masonry retains every loaded card and image element

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/components/home-client.tsx:124-130` stores all loaded pages in one `allImages` array and appends each new page.
- `apps/web/src/components/load-more.tsx:41-96` keeps fetching pages as the sentinel is reached.
- `apps/web/src/components/home-client.tsx:286-360` maps every accumulated image into a masonry card with picture sources and image elements.

Concrete failure scenario:
Long sessions through a large topic/archive/smart collection keep all prior cards mounted. Lazy image loading helps network use, but DOM nodes, layout state, event targets, image decode state, and React memory still grow linearly. Mobile Safari and lower-memory devices are the most likely to show jank.

Suggested fix:
Add virtualization/windowing after a threshold, preserving masonry height with measured placeholders. If full masonry virtualization is too invasive, cap mounted pages behind/ahead of the viewport while retaining scroll restoration metadata.

### PERF-C13-08 - Non-sargable timeline/search/smart predicates are bounded but scale-sensitive

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

Suggested fix:
Use sargable date ranges or generated/indexed year, month, and month-day columns for timeline features. For smart collections and search, prefer exact indexed predicates for public collections, add EXPLAIN-backed guardrails for broad `contains` predicates, and consider a small search index if `%LIKE%` becomes hot.

### PERF-C13-09 - Service worker image freshness probe can add one HEAD RTT per warm cached tile

Severity: Low
Confidence: High

Evidence:
- `apps/web/public/sw.template.js:31-38` and generated `apps/web/public/sw.js:31-38` bound image cache size to 50 MB and cap the synchronous HEAD probe at 300 ms.
- `apps/web/public/sw.template.js:226-270` and generated `apps/web/public/sw.js:226-270` perform a HEAD request with `If-None-Match` before serving a cached image when an ETag exists.

Concrete failure scenario:
This is a deliberate freshness tradeoff for color-impacting admin changes, not an unbounded-cache bug. Still, a warm masonry view with many cached tiles can produce many HEAD requests on the display path, and slow networks can add up to the 300 ms timeout per tile before stale bytes are served.

Suggested fix:
Measure real mobile/warm-cache waterfalls before changing it. If it becomes visible, batch or coalesce freshness checks per derivative/version, reduce the synchronous check to above-the-fold images, or use a versioned derivative URL/cache key so freshness does not require per-tile HEAD probes.

## Final Sweep Notes

- I did not find new N+1 tag-loading regressions in the public listing/photo/shared-group paths. Listing helpers aggregate tags in SQL, `getImage()` batches the detail-page side queries with `Promise.all`, and shared-group tag loading uses a single `IN` query after a capped group-image fetch.
- Public load-more paths use keyset cursors and bounded page sizes; unsafe offset fallback is capped by the server action.
- View-count buffering is bounded and chunked; retry buffers have explicit caps and backoff.
- Image derivative generation uses path-based Sharp inputs, disables Sharp cache, caps Sharp concurrency, and has input-pixel limits. The main remaining memory concern is the GPS-strip buffer path above.
- Rate-limit and in-memory tracking maps reviewed had explicit caps/eviction via `bounded-map.ts` patterns.
- No tests were run because this was a read-only review artifact, not a code change.
