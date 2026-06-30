# Cycle 23 Performance Reviewer Report

Review target: full-repository performance, concurrency, CPU, memory, and UI responsiveness review for `/Users/hletrd/flash-shared/gallery`.

Review basis: AGENTS.md and CLAUDE.md were read first. Source inventory covered 505 TS/TSX/JS/JSX files under `apps/web/src` (79,514 LOC) plus review-relevant config, scripts, migrations, tests, docs, and prior cycle reports. Current review is static/source-based; no production profiling or EXPLAIN plans were run.

Changed files: this report only.

## Findings

### PERF-C23-01 - Dynamic public gallery first pages still run grouped exact-count queries

Severity: Medium  
Confidence: High  
Status: Confirmed

Evidence:
- `apps/web/src/lib/data.ts:878-907` builds the normal public page query with `tag_names: tagNamesAgg`, joins `image_tags` and `tags`, groups by `images.id`, orders by capture/created/id, paginates with `limit`/`offset`, and projects `COUNT(*) OVER()` as `total_count`.
- `apps/web/src/lib/data.ts:1446-1461` keeps the smart-collection initial page on the offset/count path by calling `getImagesLitePage(..., 0)` before cursor pagination takes over.
- `apps/web/src/app/[locale]/(public)/page.tsx:14-16` sets the homepage to `revalidate = 0`, and `apps/web/src/app/[locale]/(public)/page.tsx:164-166` calls `getImagesLitePage`.
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17` sets topic pages to `revalidate = 0`, and `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:174-176` calls `getImagesLitePage`.
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:14` sets collection pages to `revalidate = 0`, and `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101` calls `getImagesForSmartCollection(..., 0)`.
- `apps/web/src/components/home-client.tsx:267-269` uses the exact `totalCount` for UI copy, so the expensive count is user-visible behavior rather than dead data.

Failure scenario:
A large gallery plus crawler/visitor traffic repeatedly hits dynamic public pages. Every first page forces MySQL to evaluate a grouped/tag-aggregated result set and exact window count before returning only the first page. That burns DB CPU, temp memory, and shared pool time on the hottest unauthenticated routes.

Concrete fix:
Split the first-page path into a keyset ID page query plus a second tag lookup for only returned IDs. Remove exact public totals from the hot path, replace them with "has more" or cached approximate counts, and only compute exact counts asynchronously or from a rollup table. For smart collections, avoid the offset/count path even for page 1 when the rule can be expressed as cursor-safe predicates.

### PERF-C23-02 - Infinite masonry keeps every loaded card mounted

Severity: Medium  
Confidence: High  
Status: Confirmed

Evidence:
- `apps/web/src/components/home-client.tsx:127-130` stores the full accumulated image list in state and appends pages by copying prior images plus new images.
- `apps/web/src/components/home-client.tsx:195-197` derives `itemCount` directly from the full accumulated array.
- `apps/web/src/components/home-client.tsx:286-411` maps every `orderedImages` entry into live card/link/image DOM.
- `apps/web/src/components/load-more.tsx:41-64` fetches another page and appends it into the parent state.
- `apps/web/src/components/load-more.tsx:116-132` auto-loads through an `IntersectionObserver` sentinel, with no mounted-item cap.

Failure scenario:
On a long browsing session, especially mobile Safari/Chrome, deep scrolling grows React state, DOM nodes, image elements, masonry layout work, and reconciliation cost linearly. The result is scroll jank, high memory use, slower tap response, and potential tab reloads before the gallery itself is exhausted.

Concrete fix:
Introduce windowing/virtualization for the masonry grid, or cap automatic page accumulation and switch to explicit paginated navigation after a bounded number of pages. Preserve cursor anchors and scroll restoration, but recycle offscreen cards instead of keeping the entire history mounted.

### PERF-C23-03 - CSV image export buffers the full export in server and browser memory

Severity: Medium  
Confidence: High  
Status: Confirmed

Evidence:
- `apps/web/src/app/[locale]/admin/db-actions.ts:79-84` documents the server action returning a CSV string for up to 50,000 image rows.
- `apps/web/src/app/[locale]/admin/db-actions.ts:102-117` loads the export rows in one grouped `GROUP_CONCAT` query.
- `apps/web/src/app/[locale]/admin/db-actions.ts:124-140` builds a full `csvLines` array.
- `apps/web/src/app/[locale]/admin/db-actions.ts:143-152` explicitly clears query results and then joins the full CSV into one string.
- `apps/web/src/app/[locale]/admin/db-actions.ts:156-159` returns that string through the server-action response.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:103-117` calls the server action and creates a browser `Blob` from the returned string.
- `apps/web/src/app/api/admin/db/download/route.ts:75-90` shows the repository already has a streaming response pattern for backups, but the image CSV path does not use it.

Failure scenario:
An admin exports a large gallery with long descriptions/tags while the worker queue or public traffic is active. The server allocates the DB result array, CSV line array, joined CSV string, and server-action response payload; the browser then duplicates it again into a Blob. This can cause GC pauses or request failures on memory-constrained hosts.

Concrete fix:
Move CSV export to an authenticated streaming route or a background export file with backpressure. Stream rows from MySQL in batches, write each CSV row directly to the response/body stream, and keep only a small rolling buffer in memory.

### PERF-C23-04 - Live image queue can pin pooled DB connections for encode-duration locks

Severity: Medium  
Confidence: High  
Status: Likely operational risk, confirmed code path

Evidence:
- `apps/web/src/db/index.ts:23-33` configures the shared MySQL pool with `connectionLimit: 10` and `queueLimit: 20`.
- `apps/web/src/lib/image-queue.ts:87-90` allows `QUEUE_CONCURRENCY` up to 8.
- `apps/web/src/lib/image-queue.ts:446-463` acquires a MySQL advisory lock on a pooled connection and returns that connection while the lock remains held.
- `apps/web/src/lib/image-queue.ts:519-556` acquires the claim before checking the pending row.
- `apps/web/src/lib/image-queue.ts:622-637` runs `processImageFormats(...)` while the claim connection is still held.
- `apps/web/src/lib/image-queue.ts:655-657` performs the success DB update after encoding, and `apps/web/src/lib/image-queue.ts:812-815` releases the lock in `finally`.
- `apps/web/src/lib/admin-backfill-runner.ts:23-40` documents the same connection-pinning problem for backfill and clamps backfill concurrency against pool budget; the live queue does not have an equivalent pool-budget clamp.

Failure scenario:
The default queue concurrency of 1 is conservative, but an operator can set `QUEUE_CONCURRENCY=8`. Eight concurrent encodes can each pin one shared pool connection for the full Sharp encode window, leaving only two pool slots for public requests, admin requests, semantic search, and queue follow-up queries. With the pool queue capped at 20, bursts can turn into request failures rather than just latency.

Concrete fix:
Apply the same pool-budget arithmetic used by `admin-backfill-runner` to the live queue at startup, clamping `QUEUE_CONCURRENCY` based on `POOL_CONNECTION_LIMIT` and reserved live-request capacity. Longer term, move encode-duration advisory locks to dedicated non-pooled connections or a tiny worker-only pool, or replace the encode lock with a short DB lease that releases the shared connection before CPU-heavy work starts.

### PERF-C23-05 - Admin analytics fans out aggregate scans on the shared DB pool

Severity: Low-Medium  
Confidence: Medium  
Status: Likely risk; needs production EXPLAIN/runtime validation

Evidence:
- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36` dispatches five analytics queries concurrently with `Promise.all`.
- `apps/web/src/lib/analytics-data.ts:28-46` aggregates views by day.
- `apps/web/src/lib/analytics-data.ts:62-79` aggregates top images.
- `apps/web/src/lib/analytics-data.ts:112-127` aggregates referrers.
- `apps/web/src/lib/analytics-data.ts:161-180` aggregates country/device/browser counts.
- `apps/web/src/lib/analytics-data.ts:192-207` aggregates device and browser dimensions.
- `apps/web/src/lib/analytics-data.ts:93-111` and `apps/web/src/lib/analytics-data.ts:188-191` explicitly note that `window=all` can require derived-table/temp-table style aggregation.
- `apps/web/src/db/index.ts:23-33` shows these queries share a 10-connection pool with public traffic and workers.

Failure scenario:
An admin opens analytics with `window=all` during normal public traffic or image processing. The page uses several concurrent grouped scans, occupying pool slots and DB CPU together. This can amplify latency across unrelated routes even though analytics is an admin-only view.

Concrete fix:
Add a short TTL cache keyed by analytics window and locale, or materialize daily/hourly rollups for the expensive dimensions. If rollups are not added immediately, run the analytics queries through a small concurrency limiter and make `window=all` an explicit slower path with cached results.

### PERF-C23-06 - Timeline/archive routes use non-sargable date predicates on dynamic pages

Severity: Low  
Confidence: High  
Status: Confirmed

Evidence:
- `apps/web/src/lib/data-timeline.ts:88-116` implements On This Day with `MONTH(images.capture_date)` and `DAYOFMONTH(images.capture_date)`.
- `apps/web/src/lib/data-timeline.ts:129-142` computes available years with `YEAR(images.capture_date)`.
- `apps/web/src/lib/data-timeline.ts:172-207` filters year and optional month pages with `YEAR(...)` and `MONTH(...)`.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:16` sets the timeline page to `revalidate = 0`, and `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84` loads years plus the selected period on each render.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:17` sets year pages to `revalidate = 0`, and `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:80-89` loads the year review images.
- `apps/web/src/db/schema.ts:115-119` has indexes on processed/capture/topic paths but no generated year/month/day columns to support these function predicates directly.

Failure scenario:
Crawler or user traffic over `/timeline` and `/year/...` forces MySQL to evaluate date functions over processed image rows and then join/aggregate tags. As the gallery grows, these archive routes become scan-heavy despite having capture-date indexes.

Concrete fix:
Rewrite year/month filters to range predicates where possible (`capture_date >= start AND capture_date < end`). For On This Day and distinct years, add generated date-part columns with composite indexes, or maintain a small archive rollup table. If immediate freshness is not required, use ISR/short TTL caching for archive pages.

### PERF-C23-07 - Topic navigation helper computes per-topic latest-image timestamps on common public paths

Severity: Low  
Confidence: Medium  
Status: Likely risk; needs production EXPLAIN validation

Evidence:
- `apps/web/src/lib/data.ts:509-529` selects all topics and computes `last_image_updated_at` with a correlated `MAX(images.updated_at)` subquery per topic.
- `apps/web/src/db/schema.ts:115-119` has `(topic, processed, capture_date, created_at)` but not a matching `(topic, processed, updated_at)` index for this max lookup.
- `apps/web/src/components/nav.tsx:8-16` calls `getTopicsCached()` in the public nav, parallel with SEO/config.
- `apps/web/src/app/[locale]/(public)/layout.tsx:1-8` places `Nav` around public routes.
- `apps/web/src/app/[locale]/(public)/page.tsx:151-157`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:166-170`, and `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:103-108` also call `getTopicsCached()` for page body context.
- `apps/web/src/app/sitemap.ts:40-43` calls uncached `getTopics()`, and `apps/web/src/app/sitemap.ts:64-72` uses `topic.last_image_updated_at` for localized topic sitemap entries.

Failure scenario:
On dynamic public renders, the nav needs only slug/label/order/map visibility, but it pays for a per-topic latest-image timestamp. With many topics and large image tables, the correlated max can become a repeated hidden DB cost on otherwise simple navigation renders.

Concrete fix:
Split the helper into a lean nav/topic-list query and a sitemap/metadata query that includes latest timestamps. Add `(topic, processed, updated_at)` if timestamp freshness remains query-driven, or denormalize per-topic latest image timestamp into the `topics` table during image writes.

### PERF-C23-08 - Public map path can still render up to 10k Leaflet markers plus 10k list items

Severity: Low-Medium  
Confidence: High  
Status: Confirmed bounded UI risk

Evidence:
- `apps/web/src/lib/data.ts:1649-1658` documents and defines `MAP_MAX_MARKERS = 10000`.
- `apps/web/src/lib/data.ts:1667-1685` returns up to 10k map-visible GPS rows, ordered by recency.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:9-10` sets the map page to `revalidate = 0`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-50` loads all returned map images and serializes them into `markers`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:77-89` renders a normal HTML list item for every marker.
- `apps/web/src/components/map/map-client.tsx:86-90` maps all markers into arrays and spreads them into `Math.min`/`Math.max`.
- `apps/web/src/components/map/map-client.tsx:119-140` renders one React-Leaflet `<Marker>` and popup subtree for every marker.

Failure scenario:
The cap prevents an infinite payload, but 10k markers plus 10k accessible list items is still a heavy first-render and hydration workload. A map-visible travel archive near the cap can freeze the main thread, make the map unresponsive, and inflate the route payload on mobile devices.

Concrete fix:
Keep the server cap, but reduce the initial client payload to viewport-bounded markers or clustered tiles. Use marker clustering/canvas rendering for the map layer and virtualize or paginate the accessible fallback list. Avoid spreading 10k-value arrays into `Math.min`/`Math.max`; compute bounds in one loop.

### PERF-C23-09 - Upload processing contract lock spans full browser/LR upload work

Severity: Low  
Confidence: High  
Status: Confirmed code path; manual validation needed for real contention frequency

Evidence:
- `apps/web/src/lib/upload-processing-contract-lock.ts:9-56` holds a MySQL advisory lock on a pooled connection until the caller releases it.
- `apps/web/src/app/actions/images.ts:175-180` acquires the upload-processing contract lock before reading upload settings and quota state.
- `apps/web/src/app/actions/images.ts:340-392` still holds that lock while each file is saved, metadata is read, EXIF is extracted, and GPS may be stripped from the retained original.
- `apps/web/src/app/actions/images.ts:622-624` releases the lock only after the full browser upload action finishes.
- `apps/web/src/app/api/admin/lr/upload/route.ts:252-259` acquires the same lock for Lightroom upload.
- `apps/web/src/app/api/admin/lr/upload/route.ts:261-552` holds it through directory creation, settings read, metadata extraction, GPS stripping, insert, enqueue, audit, and revalidation.
- `apps/web/src/lib/process-image.ts:905-910` streams originals to disk, avoiding heap buffering, but that I/O still happens while the lock is held by the upload callers.

Failure scenario:
A large batch upload or slow storage path holds the contract lock and one pooled DB connection for the entire ingest window. Concurrent Lightroom uploads or upload-setting changes wait up to the lock timeout and return retry errors. This protects configuration consistency, but the critical section is broader than the actual settings/quota snapshot and first-write contract.

Concrete fix:
Shrink the lock scope to the minimum section that must be serialized: settings snapshot, cumulative quota reservation, and DB insert/first-write checks. Move file streaming, metadata probing, GPS stripping, and other CPU/I/O work outside the contract lock, using an immutable upload settings snapshot for later steps. If the full-span lock is intentionally required, move it to a dedicated lock connection outside the shared request pool and document the expected contention behavior.

## Manual Validation Targets

- Run production-like `EXPLAIN ANALYZE` for `getImagesLitePage`, `getImagesForSmartCollection(..., 0)`, `getTopics`, timeline year/month queries, and analytics `window=all` queries on a database copy with realistic tag and image cardinality.
- Capture browser performance traces for deep home-page scrolling and `/map` near the 10k-marker cap on a mid-range mobile viewport.
- Load-test worker concurrency with `QUEUE_CONCURRENCY` above the default while public pages are requested, watching MySQL pool queueing and Node event-loop delay.
- Measure CSV export memory with 50k rows and long descriptions/tags before choosing streaming route batch sizes.

## Final Missed-Issues Sweep

- Image pipeline: `apps/web/src/lib/process-image.ts:36-57` caps global Sharp concurrency and disables the libvips cache; `apps/web/src/lib/process-image.ts:905-922` streams uploads to disk and uses `sequentialRead`; `apps/web/src/lib/process-image.ts:1182-1218` writes derivatives through temp/rename/rollback. No additional confirmed image-pipeline memory leak was found beyond lock/pool contention reported above.
- CLIP/semantic search: `apps/web/src/app/api/search/semantic/route.ts:96-97` caps body/query size; `apps/web/src/app/api/search/semantic/route.ts:263-307` hard-caps embedding scans and uses normalized dot product in production; `apps/web/src/lib/clip-model.ts:53-64` caps inference concurrency, pending depth, and queue wait. Remaining risk is operational sizing, not an unbounded code path.
- Rate-limit maps and transient in-memory guards were checked for explicit pruning/bounds; no new unbounded map finding was confirmed.
- Migrations/schema were checked for query-shaping indexes relevant to this review. The main gaps are captured in date-part, topic timestamp, and map/query findings.
- Tests were inspected for privacy/performance contracts around map, queue/backfill, search, touch targets, and sensitive field omissions. This was a review-only pass; no test suite was run.

Skipped files:
- No source, migration, script, or test area relevant to performance/concurrency was intentionally skipped.
- Binary/generated/runtime artifacts were not reviewed line-by-line: `.next`, `node_modules`, `.git`, image/font binaries, upload/data directories, cache directories, and historical screenshots. Historical review/plan files were used only as context, not as executable source.
