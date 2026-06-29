# Cycle 12 Performance Review

Role: perf-reviewer
Scope: whole repository review for performance, concurrency, CPU/memory, database query shape, image processing, cache/service-worker behavior, queue/backfill concurrency, rate-limit map growth, browser rendering, and deployment/runtime constraints.

I first built an inventory of review-relevant files, then examined the relevant files directly without sampling. This review is read-only; no fixes were implemented.

## Inventory Reviewed

Runtime and render paths:
- `apps/web/src/app/**/page.tsx`, public routes, admin routes, API routes, route handlers, server actions.
- `apps/web/src/components/**/*.tsx`, especially gallery masonry, search, similar photos, upload/admin controls, map/timeline/lightbox surfaces.

Data and database:
- `apps/web/src/lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `smart-collections.ts`, `gallery-config.ts`, `clip-embeddings.ts`.
- `apps/web/src/db/index.ts`, `schema.ts`, migrations/journal as schema contract references.

Image, queue, CLIP, and upload:
- `apps/web/src/lib/process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, `clip-model.ts`, `clip-jobs.ts`, upload server actions and Lightroom API upload route.

Cache, service worker, and delivery:
- `apps/web/public/sw.js`, `apps/web/src/lib/serve-upload.ts`, OG image routes, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, nginx config/tests.

Rate limits and runtime guards:
- `apps/web/src/lib/rate-limit.ts`, `auth-rate-limit.ts`, `bounded-map.ts`, upload trackers, public route lint tests.

Final sweep included prior perf reviews/plans, current cycle diffs, tests that lock performance-sensitive contracts, and deploy/runtime documentation in `CLAUDE.md`.

## Findings

### PERF-C12-01 - Confirmed - Admin dashboard loads every permanently failed image in one query/render

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/lib/data.ts:999-1013` defines `getFailedImages()` with `processed = false AND processing_error IS NOT NULL`, `ORDER BY failed_at DESC`, and no `LIMIT`.
- `apps/web/src/db/schema.ts:101-119` has image indexes for processed/capture-date, topic, filename, and uploaded-by, but no index shaped for failed-image listing by `processed`, `processing_error`, or `failed_at`.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27` fetches `getFailedImages()` on every dashboard load in the main `Promise.all`.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:73-120` renders every failed row synchronously in the initial dashboard DOM.

Failure scenario:
If a bad import, corrupt batch, unsupported camera format, or missing original files produce thousands of permanent failures, opening `/admin/dashboard` scans/sorts all failed rows, materializes all rows in Node, serializes them into the RSC payload, hydrates them into client state, and maps them into DOM nodes. Because the schema lacks a failed-list index, MySQL can also fall back to a broad scan plus filesort over the unprocessed slice. This can make the dashboard slow or unavailable exactly when the admin needs it to retry/diagnose a failed queue.

Suggested fix:
Add a bounded failed-image page size, expose failed count separately, and paginate or lazy-load the panel. Add an index such as `(processed, failed_at)` or a more selective generated/status column/index if MySQL cannot use `processing_error IS NOT NULL` well. Keep the retry UX operating on the visible page and update counts after successful retry.

### PERF-C12-02 - Confirmed - Per-photo OG generation has no conditional validation before Satori/Sharp work

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/app/api/og/photo/[id]/route.tsx:62-67` fetches image, SEO, and config on every valid request.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:122-134` internally fetches a derivative and base64-embeds the JPEG.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:138-228` renders Satori output, buffers the PNG, then re-encodes it through Sharp.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:229-234` returns only `Content-Type` and `Cache-Control`; there is no ETag, `Last-Modified`, or `If-None-Match` short-circuit.
- `apps/web/src/lib/og-photo-fetch.ts:30-54` bounds each photo fetch to 1 MB and the fallback chain to 10 s, so this is bounded but still CPU-heavy when repeated.

Failure scenario:
Social crawlers, link preview bots, or browsers that revalidate after `max-age=3600` cannot get a cheap 304. Every origin revalidation for a stable photo repeats DB reads, internal derivative fetch, base64 allocation, Satori rasterization, PNG buffering, and Sharp JPEG encoding. The OG rate limit caps abuse per IP, but normal distributed crawler traffic can still burn CPU on identical output.

Suggested fix:
Compute a stable ETag from the image id plus fields that affect the card, such as image updated time, filename/derivative state, title/display title, site title, and relevant image pipeline/config version. Check `If-None-Match` after the cheap DB/config load and return 304 before `pickFirstAvailablePhotoBuffer`, `ImageResponse`, and `postProcessOgImage`. Consider adding `Last-Modified` from the latest relevant timestamp as a secondary validator.

### PERF-C12-03 - Likely - Image queue can starve the shared MySQL pool while Sharp work holds advisory-lock connections

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/db/index.ts:23-34` sets one shared MySQL pool with `connectionLimit = 10` and `queueLimit = 20`.
- `apps/web/src/lib/image-queue.ts:87-90` allows `QUEUE_CONCURRENCY` up to 8.
- `apps/web/src/lib/image-queue.ts:446-462` acquires a MySQL advisory lock by checking out a pool connection and returns that connection as the claim handle.
- `apps/web/src/lib/image-queue.ts:519-637` holds that claim connection while the job verifies DB state, loads config, resolves the original, and runs `processImageFormats(...)`.
- `apps/web/src/lib/image-queue.ts:653-657` performs the processed-row update while the lock connection is still held, then `apps/web/src/lib/image-queue.ts:812-815` finally releases it.

Failure scenario:
With `QUEUE_CONCURRENCY=8`, eight Sharp jobs can pin eight of the ten shared DB connections for the full native image-processing duration, even though most of that time is CPU/disk work rather than DB work. Live requests such as photo pages, gallery pagination, search, admin dashboard, and OG routes then compete for the two remaining connections and the pool queue of 20. A burst of uploads or bootstrap retries can therefore turn a background workload into public/admin request latency and `queueLimit` failures.

Suggested fix:
Do not hold a shared-pool connection across Sharp work. Options: use a tiny dedicated lock pool, replace connection-bound advisory locks with a DB row claim/lease that releases the connection immediately, or clamp effective queue concurrency based on the shared pool budget the way admin backfill does. If advisory locks stay, enforce a conservative default and document that increasing `QUEUE_CONCURRENCY` consumes live DB capacity.

### PERF-C12-04 - Likely - GPS stripping still materializes whole originals in memory after upload streaming

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/lib/process-image.ts:887-910` streams accepted upload files to disk, avoiding a large heap buffer at the save step.
- `apps/web/src/lib/process-image.ts:1738-1764` then calls `fs.readFile(filePath)` inside `stripGpsFromOriginal()` and writes a full scrubbed buffer.
- `apps/web/src/lib/process-image.ts:1773-1786` can also fall back to Sharp re-encode after retaining the original `input` buffer for WebP lossless detection.
- Browser uploads call this path at `apps/web/src/app/actions/images.ts:381-388`.
- Lightroom multipart upload already uses `request.formData()` at `apps/web/src/app/api/admin/lr/upload/route.ts:139-152`, then calls the same GPS strip path at `apps/web/src/app/api/admin/lr/upload/route.ts:346-360`.

Failure scenario:
With `stripGpsOnUpload` enabled, a single 200 MB original can occupy the multipart parser buffer, the on-disk saved file, the `fs.readFile` buffer, and potentially a scrubbed/re-encode output buffer. Multiple uploads or Lightroom publish bursts multiply that memory pressure and can force GC churn or OOM despite the initial save path being streaming.

Suggested fix:
Keep the streaming save but replace whole-file GPS scrubbing with streaming or range/container-aware parsing for JPEG/TIFF/ISOBMFF/WebP where feasible. Add a memory-budget gate for large originals while the current buffer-based scrubber remains. For Lightroom, avoid `request.formData()` for large files if a streaming multipart parser can be introduced without regressing auth/limit checks.

### PERF-C12-05 - Risk - CLIP inference admits an unbounded waiter queue with no timeout or abort propagation

Severity: Medium
Confidence: Medium-High

Evidence:
- `apps/web/src/lib/clip-model.ts:53-58` caps active CLIP inference at 1-4 but stores pending callers in a plain `inferenceWaiters` array.
- `apps/web/src/lib/clip-model.ts:60-70` pushes a waiter Promise whenever the slot is saturated and has no maximum backlog, timeout, or cancellation path.
- `apps/web/src/lib/clip-model.ts:138-146` routes text embedding through the slot.
- `apps/web/src/lib/clip-model.ts:171-222` routes image preprocessing and model inference through the same slot.
- `apps/web/src/app/api/search/semantic/route.ts:244-250` checks abort before `embedTextReal(query)`, but once inside the waiter/model path there is no request signal.
- `apps/web/src/app/api/search/similar/[id]/route.ts:115-170` does its DB scan and scoring without request abort checks, and `apps/web/src/components/similar-photos.tsx:70-94` fetches without an `AbortController`.

Failure scenario:
When production semantic search is enabled, text search, similar photos, auto-alt/image embedding, bootstrap retry, and backfill can all queue behind the same in-process CLIP slot. A burst of semantic requests while image embeddings are running can accumulate arbitrary pending Promises and retained request state. Client navigation or abandoned similar-photo fetches do not remove work from the queue, so the server can keep spending CPU on stale requests.

Suggested fix:
Add a bounded CLIP work queue with a maximum pending count and an explicit 503/429 response when saturated. Accept an `AbortSignal` in `embedTextReal`/`embedImageReal` or wrap at the route layer with a timeout before enqueue. Add server-side abort checks to the similar route before target lookup, before/after the scan, and before enrichment; use `AbortController` in the client component cleanup.

### PERF-C12-06 - Risk - Infinite gallery accumulates every loaded card and image element

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/components/home-client.tsx:124-130` stores all loaded pages in one `allImages` array and appends new pages with `setAllImages(prev => [...prev, ...newImages])`.
- `apps/web/src/components/load-more.tsx:41-96` continues to fetch additional pages as the sentinel is reached.
- `apps/web/src/components/home-client.tsx:286-360` maps every accumulated image into a masonry card with responsive picture/image sources.

Failure scenario:
A visitor scrolling through a large topic/archive/smart collection keeps every prior card mounted. Lazy image loading reduces network work, but layout, style, event targets, image state, and DOM nodes still grow linearly. On mobile Safari or lower-memory devices, long sessions can become janky, and returning from photo detail must restore scroll into a very large DOM.

Suggested fix:
Introduce virtualization or windowing after a threshold, preserving masonry column height with measured placeholders. If full virtualization is too invasive, cap mounted pages behind and ahead of the viewport and keep scroll restoration metadata. Keep the current simple path for small collections.

### PERF-C12-07 - Risk - Semantic/similar search remains a bounded brute-force scan over the most recent embeddings

Severity: Low-Medium
Confidence: High

Evidence:
- `apps/web/src/lib/clip-embeddings.ts:36-44` caps `SEMANTIC_SCAN_LIMIT` at default 2000 and hard max 25000.
- `apps/web/src/app/api/search/semantic/route.ts:257-269` selects embeddings by `model_version`, orders by `updated_at DESC`, and limits to that cap.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170` uses the same most-recent capped scan before scoring.
- `apps/web/src/db/schema.ts:280-295` provides an index for `model_version, updated_at`, not vector search or full-corpus similarity.

Failure scenario:
This is a deliberate CPU/DB cap, but once the gallery has more embeddings than `SEMANTIC_SCAN_LIMIT`, older relevant photos are not considered at all. Raising the cap increases DB payload and CPU scoring per request; leaving it at the default makes recall dependent on recency, not relevance. The issue affects both text semantic search and image-to-image similar photos.

Suggested fix:
Adopt a real vector index/store or a two-stage candidate strategy. If staying in MySQL, consider partitioned/paginated scoring under a wall-clock budget with cached candidate shards, and expose/monitor recall caps so operators know when the gallery has outgrown brute-force recent scans.

### PERF-C12-08 - Risk - Timeline and smart/search predicates retain non-sargable scan paths

Severity: Low-Medium
Confidence: High

Evidence:
- `apps/web/src/lib/data-timeline.ts:97-116` uses `MONTH(capture_date)` and `DAY(capture_date)` for the On This Day widget.
- `apps/web/src/lib/data-timeline.ts:129-141` uses `YEAR(capture_date)` for the year index.
- `apps/web/src/lib/data-timeline.ts:186-207` uses `YEAR(capture_date)` and optional `MONTH(capture_date)` for timeline pages, capped by `TIMELINE_PAGE_LIMIT + 1`.
- `apps/web/src/lib/data.ts:619-632` implements multi-tag filtering with an `IN (SELECT ... GROUP BY ... HAVING COUNT(DISTINCT ...))` subquery.
- `apps/web/src/lib/smart-collections.ts:218-235` allows `contains` and bounded `IN` predicates; `apps/web/src/lib/smart-collections.ts:247-264` compiles tag predicates as subqueries, including `containsLike(tags.name, ...)`.
- `apps/web/src/lib/data.ts:1537-1613` public text search uses `%LIKE%` style `containsLike` queries and only short-circuits tag/alias branches after the main query fills the limit.

Failure scenario:
The current comments and limits make these acceptable for a personal gallery, but the scan work grows with processed photo/tag counts. Public timeline/archive/smart pages are dynamic, and crawlers can exercise these paths repeatedly. Smart collections with `contains`, multi-tag filters, or broad date predicates can bypass the most useful parts of existing indexes and force per-row evaluation before ordering/limiting.

Suggested fix:
Convert timeline year/month filters to sargable ranges or generated `capture_year`, `capture_month`, `capture_month_day` columns with indexes. For smart collections/search, prefer indexed exact predicates where possible, add generated/search columns or a small search index for `%contains%`, and add EXPLAIN-backed guardrails for public smart collections before promoting broad predicates.

## Final Sweep Notes

- Rate-limit map growth: checked `rate-limit.ts`, `auth-rate-limit.ts`, and `bounded-map.ts`. Public search/share/OG and admin-token maps are hard-capped (`apps/web/src/lib/rate-limit.ts:67-84`, `apps/web/src/lib/rate-limit.ts:119-249`, `apps/web/src/lib/bounded-map.ts:91-115`, `apps/web/src/lib/bounded-map.ts:156-187`). I did not find an unbounded rate-limit map.
- Service worker cache growth: `apps/web/public/sw.js:31-38` caps image and HTML cache budgets, `apps/web/public/sw.js:99-130` evicts image LRU metadata, and `apps/web/public/sw.js:132-149` caps HTML entries. No new unbounded-cache finding.
- Upload derivative delivery: `apps/web/next.config.ts:56-73` sets a consistent one-hour upload derivative cache policy; the SW still has a 300 ms HEAD freshness probe for cached images at `apps/web/public/sw.js:211-267`, which is a deliberate bounded tradeoff rather than a new finding.
- Deployment/runtime: `apps/web/Dockerfile:85-108` pins production runtime behavior and CLIP model mount assumptions; `apps/web/Dockerfile:132-150` keeps healthcheck and graceful shutdown intent explicit. `apps/web/deploy.sh:31-58` rebuilds then prunes Docker artifacts after `up -d`, preserving bind-mounted data per the documented constraints.
- Previously identified cycle 11 risks still present: queue/pool starvation, GPS strip memory, CLIP queue backlog, infinite masonry, and non-sargable archive/smart paths remain live in the code and are re-cited above with current cycle 12 line numbers.
