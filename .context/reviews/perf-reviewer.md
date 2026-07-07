# Review-Plan-Fix Cycle 16 Performance / Concurrency Review

Role: perf-reviewer
Date: 2026-07-08
Repository: `/Users/hletrd/flash-shared/gallery`
Output file: `.context/reviews/perf-reviewer.md`

## Scope And Method

I performed a repository-wide performance and concurrency review for GalleryKit. I first built an inventory of performance-relevant files, then read the selected files and their cross-file interactions directly. I focused on CPU and memory hotspots, Sharp/image processing, queue/backfill concurrency, DB query shape and indexes, large payloads and N+1 patterns, cache invalidation and revalidation, React rendering and hydration, UI responsiveness, public-route expensive work, rate limiter memory growth, streaming versus buffering, deployment/build performance, race conditions, shared process state, and single-writer assumptions.

Mutation boundary: this review modifies only this report file. I did not edit application code, deploy, or run destructive commands.

## Inventory

Primary files and regions reviewed:

- Project guidance and operational constraints: `AGENTS.md`, `CLAUDE.md`, especially runtime topology, image queue/backfill, color pipeline, uploads, CLIP semantic search, deploy helper, and disk hygiene.
- App routes, pages, server actions, API routes: `apps/web/src/app/**`, including public home/topic/photo/map/timeline/year/share/feed/sitemap/OG routes, admin actions, public actions, upload routes, semantic/similar APIs, health/live endpoints, and upload serving routes.
- Client and server UI: `apps/web/src/components/**`, especially `home-client.tsx`, load-more/search components, `grid-picture*`, lightbox, map components, and timeline/year renderers.
- Data and DB: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `smart-collections.ts`, `clip-embeddings.ts`, `clip-model.ts`, `gallery-config.ts`, `rate-limit.ts`, `bounded-map.ts`, `background-db-writes.ts`, `single-writer-guard.ts`, `maintenance-scheduler.ts`, `apps/web/src/db/index.ts`, and `apps/web/src/db/schema.ts`.
- Image and upload pipeline: `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, `upload-limits.ts`, `upload-tracker-state.ts`, `serve-upload.ts`, `og-photo-fetch.ts`, browser upload action, Lightroom upload API, DB restore/export actions, and `scripts/backfill-color-pipeline.ts`.
- Runtime/deploy/build/cache: `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, service worker files, migration script, drizzle migrations and journal, package scripts.
- Tests were inventoried for coverage context, but findings below are based on source review rather than assuming tests prove production behavior.

Skipped: `node_modules`, `.next`, build outputs, local env/secrets, binary screenshots/assets without runtime code, and unrelated historical review artifacts. I did not intentionally skip any file selected into this lane's performance/concurrency surface.

## Summary

Confirmed issues: 6
Likely issues: 4
Manual-validation risks: 3

Highest-risk theme: individual subsystems are bounded, but several bounds are independent. Image queue, in-app backfill, sidecar backfill, semantic search, map rendering, and Server Action multipart parsing can still combine into DB pool pressure, CPU saturation, browser main-thread stalls, or Node RSS spikes.

## Confirmed Issues

### PERF-C16-01: Image queue and in-app backfill reserve DB pool headroom independently

Severity: High
Confidence: High

Code region:

- `apps/web/src/db/index.ts:31-41` fixes the MySQL pool at `connectionLimit: 10` and `queueLimit: 20`.
- `apps/web/src/lib/image-queue.ts:121-141` clamps queue concurrency against the pool in isolation.
- `apps/web/src/lib/image-queue.ts:441` creates a queue with that independent concurrency.
- `apps/web/src/lib/image-queue.ts:868-883` runs the Sharp derivative pipeline inside queue jobs.
- `apps/web/src/lib/admin-backfill-runner.ts:97-143` separately clamps in-app backfill concurrency.
- `apps/web/src/lib/admin-backfill-runner.ts:393-431` scans stale candidates; `apps/web/src/lib/admin-backfill-runner.ts:550-565` runs the same derivative pipeline.
- `apps/web/src/lib/process-image.ts:1433-1440` fans out WebP, AVIF, and JPEG generation in parallel per image.

Why this is a problem:

The queue and backfill each reserve roughly half the pool for live traffic only when considered alone. They do not share a semaphore or token budget. At the default pool size, queue concurrency can be 2 and backfill concurrency can also be 2; each worker can hold an advisory-lock connection while doing transient DB work, and backfill also pins a whole-run lock. This can consume most of the 10 pool slots before normal SSR, analytics, or admin work enter the pool.

Concrete failure scenario:

An admin starts a color-pipeline backfill while uploads are still processing. Two queue jobs and two backfill jobs run Sharp encodes and DB updates; the backfill run lock is also held. Public photo pages then execute multi-query data loads, but the pool has little headroom. Requests queue behind long-running background work and can hit the mysql2 `queueLimit: 20`, producing failures or long tail latency.

Suggested fix:

Create one shared in-process background DB budget for image work. Queue jobs, in-app backfill jobs, and any future long-running image maintenance should acquire from the same semaphore before taking DB-pinning advisory locks. In the current single-process topology a local semaphore is sufficient; if horizontal support is added, move the budget to a DB-backed lease/advisory-token design. As a minimal mitigation, pause or reduce upload queue concurrency while in-app backfill is active.

### PERF-C16-02: Browser upload and DB restore stream after framework multipart buffering

Severity: High
Confidence: High

Code region:

- `apps/web/src/lib/upload-limits.ts:1-5` allows 200 MiB upload files, 250 MiB restore files, 100 files per window, and 2 GiB rolling upload budget.
- `apps/web/src/lib/upload-limits.ts:19-35` sets the Server Action body limit from the largest action surface plus overhead.
- `apps/web/next.config.ts:112-119` applies that Server Action body limit.
- `apps/web/src/app/actions/images.ts:129-148` receives a `FormData` Server Action and reads all `files` entries.
- `apps/web/src/app/actions/images.ts:184-249` validates file count and byte totals only after `FormData` exists.
- `apps/web/src/lib/process-image.ts:905-910` streams the already-created `File` to disk.
- `apps/web/src/app/[locale]/admin/db-actions.ts:369-405` receives restore as a Server Action; `apps/web/src/app/[locale]/admin/db-actions.ts:610-631` streams the already-created restore `File` to disk.
- Lightroom upload improves this with `LR_MULTIPART_PARSE_MAX_IN_FLIGHT = 1` at `apps/web/src/app/api/admin/lr/upload/route.ts:60-73`, but still calls `request.formData()` at `apps/web/src/app/api/admin/lr/upload/route.ts:178-185`.

Why this is a problem:

The code comments correctly stream `File.stream()` to disk, but in Server Actions and `request.formData()` route handlers the multipart payload has already been parsed into `File` objects before that stream begins. The disk stream limits a second heap copy; it does not prevent request-body buffering/RSS pressure at the framework parser boundary.

Concrete failure scenario:

An admin uploads several 200 MiB images through the dashboard, or restores a 250 MiB SQL dump. Before app-level size checks run, Next has to parse the multipart body into `FormData`. Concurrent uploads or a restore during traffic can spike Node memory, causing GC stalls or OOM even though the subsequent application code streams to disk.

Suggested fix:

Move large browser upload and restore ingestion to route handlers that use a streaming multipart parser with backpressure and a hard byte counter before materialization. Keep dashboard Server Actions for metadata/control fields only. Add a process-wide ingress semaphore for large multipart parsing, similar to the Lightroom route's parse slot, and lower default Server Action body limits where possible.

### PERF-C16-03: Public semantic and similar search perform per-request brute-force BLOB scans and vector math

Severity: Medium
Confidence: High

Code region:

- `apps/web/src/lib/clip-embeddings.ts:36-48` permits `SEMANTIC_SCAN_LIMIT` default 2000 and hard max 25000.
- `apps/web/src/app/api/search/semantic/route.ts:173-184` rate-limits per IP at 30/minute.
- `apps/web/src/app/api/search/semantic/route.ts:250-311` embeds text, selects up to `SEMANTIC_SCAN_LIMIT` embedding BLOBs, decodes every row, scores every vector, and top-k filters.
- `apps/web/src/app/api/search/similar/[id]/route.ts:98-115` uses the same per-IP limiter.
- `apps/web/src/app/api/search/similar/[id]/route.ts:137-150` loads the target embedding.
- `apps/web/src/app/api/search/similar/[id]/route.ts:177-214` scans, decodes, scores, and ranks up to `SEMANTIC_SCAN_LIMIT` rows.
- `apps/web/src/db/schema.ts:292-304` indexes `(modelVersion, updatedAt)` but stores the vectors as `MEDIUMBLOB`; there is no ANN/vector index.

Why this is a problem:

Each successful request reads many BLOB rows from MySQL and does CPU vector math in Node. The route has useful per-IP limits, body caps, and abort checks, but many IPs or a single trusted same-origin client can still multiply DB read bandwidth and CPU. Increasing `SEMANTIC_SCAN_LIMIT` toward the hard max makes the public endpoint linearly more expensive.

Concrete failure scenario:

Several crawlers or abusive clients issue semantic/similar searches concurrently. With the default limit, each request reads and decodes roughly 2000 embeddings; with an operator-raised limit, it can read 25000. MySQL bandwidth, Node CPU, and CLIP inference slots compete with normal public pages and upload queue work.

Suggested fix:

Add a global semantic-search concurrency limiter and expose rejection/backoff when saturated. Consider a process-local embedding matrix cache with explicit invalidation on embedding updates, or a real ANN/vector index outside MySQL BLOB scans. Keep `SEMANTIC_SCAN_LIMIT` low by default, log the effective limit at boot, and document that the hard max is for offline/admin use unless a vector index exists.

### PERF-C16-04: Color-pipeline backfill candidate scans lack a dedicated `pipeline_version` index

Severity: Medium
Confidence: High

Code region:

- `apps/web/src/db/schema.ts:123-131` defines image indexes, none including `pipeline_version`.
- `apps/web/src/lib/admin-backfill-runner.ts:393-431` counts and pages candidates with `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < CURRENT) AND id > cursor`.
- `apps/web/scripts/backfill-color-pipeline.ts:409-417` uses a similar candidate page query in the sidecar.

Why this is a problem:

Backfill candidate discovery repeatedly has to find stale rows among all processed rows. Without an index involving `processed`, `pipeline_version`, and the keyset cursor, "mostly current" galleries can still require broad scans to prove there is little or nothing to do. The `OR` predicate on `pipeline_version` further hurts index use unless the query is split or indexed deliberately.

Concrete failure scenario:

A large gallery has already been backfilled, then an admin opens the backfill status or reruns it after a partial failure. The count and batch queries inspect broad processed ranges even when only a few rows are stale, adding DB latency during a maintenance window.

Suggested fix:

Add a migration and `reconcileLegacySchema` support for a dedicated candidate index. Validate candidate shapes with `EXPLAIN ANALYZE` before settling on order; likely options are `(processed, pipeline_version, id)` with split NULL/range queries, or a generated `needs_reencode`/`pipeline_bucket` column indexed with `(needs_reencode, id)`.

### PERF-C16-05: The public map page can serialize and render 10,000 markers plus 10,000 list items

Severity: Medium
Confidence: High

Code region:

- `apps/web/src/lib/data.ts:1766-1817` caps map rows at `MAP_MAX_MARKERS = 10000`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66` fetches all map rows on each dynamic render and maps them into client props.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:89-110` passes every marker to `MapLoader` and also renders one fallback/accessibility list item per marker.
- `apps/web/src/components/map/map-client.tsx:77-94` computes bounds over all markers by allocating latitude/longitude arrays and spreading them into `Math.min`/`Math.max`.
- `apps/web/src/components/map/map-client.tsx:120-139` renders one Leaflet `Marker` per marker.

Why this is a problem:

The DB result is capped, but the cap is too high for first-paint browser work. A GPS-heavy gallery can produce a large RSC payload, a large HTML fallback list, and thousands of Leaflet marker React elements. The bounds calculation also makes full-size arrays and spread calls.

Concrete failure scenario:

A travel archive has 8,000 GPS-enabled public photos. Opening `/map` on a mobile device downloads a large payload, hydrates the map client, creates thousands of markers and popups, renders thousands of links, and stalls the main thread. The user sees slow input, delayed map interaction, or browser tab termination.

Suggested fix:

Lower the initial cap substantially and add marker clustering or viewport/bounds-based fetching. Virtualize or paginate the accessible list. Compute fit bounds in a single pass without allocating arrays. Consider a leaner map-specific SQL projection if `publicMapSelectFields` grows.

### PERF-C16-06: Batch image deletion repeats full derivative-directory scans per image

Severity: Medium
Confidence: High

Code region:

- `apps/web/src/app/actions/images.ts:860-884` deletes selected image records in chunks, then calls `deleteImageVariantsStrict(..., [])` for WebP, AVIF, and JPEG for each image.
- `apps/web/src/lib/process-image.ts:575-629` treats an empty sizes array as "scan the whole directory to find historical variants".
- `apps/web/src/lib/process-image.ts:651-663` uses that scan in strict deletion.

Why this is a problem:

The scan is intentional for one image because it catches variants from older size configs. In batch deletion, the same three derivative directories are scanned once per image per format. The cost becomes `images * formats * directory_size`, which is expensive on large galleries or NAS-backed storage.

Concrete failure scenario:

An admin deletes 100 bad imports from a gallery with tens of thousands of derivative files. The server performs up to 300 full directory iterations before unlinking files, adding I/O pressure and slowing admin response while image serving and queue writes share the same storage.

Suggested fix:

Add a batch cleanup helper that scans each derivative directory once per batch, groups entries by base filename prefix, and deletes matching variants with strict error aggregation. Keep the current single-image helper for isolated deletes.

## Likely Issues

### PERF-C16-07: The home page always runs a non-sargable On This Day query

Severity: Medium
Confidence: Medium

Code region:

- `apps/web/src/app/[locale]/(public)/page.tsx:155-177` renders the dynamic public home page and loads the first image page.
- `apps/web/src/app/[locale]/(public)/page.tsx:232-234` always renders `OnThisDayWidget`.
- `apps/web/src/components/on-this-day-widget.tsx:15-22` runs `getOnThisDayImages(month, day)` during the home SSR pass.
- `apps/web/src/lib/data-timeline.ts:102-130` filters with `MONTH(capture_date)` and `DAY(capture_date)` and then joins/group tags.
- `apps/web/src/db/schema.ts:123-130` has processed/date indexes but no generated month/day index.

Why this is a problem:

The function predicates are not sargable on `capture_date`, so the DB cannot use the date key parts to directly seek today's month/day. Because the home page is dynamic, every home request pays this query even though the result changes only once per day.

Concrete failure scenario:

On a large archive, crawler or visitor traffic to `/` repeatedly scans the processed dated image set to return at most six photos. That scan competes with the main listing query and background DB work.

Suggested fix:

Add generated `capture_month`/`capture_day` or `capture_month_day` columns with an index including `processed`, or maintain a small daily cache/materialized table keyed by month/day. Fetch tags in a second phase over the six selected IDs.

### PERF-C16-08: Smart collections can expose expensive dynamic predicates on public pages

Severity: Medium
Confidence: Medium

Code region:

- `apps/web/src/lib/smart-collections.ts:142-147` caps depth, AST nodes, group children, and `IN` values.
- `apps/web/src/lib/smart-collections.ts:221-238` compiles `contains`, `between`, and `in` predicates directly against selected columns.
- `apps/web/src/lib/smart-collections.ts:250-268` compiles tag predicates as `images.id IN (SELECT ... JOIN tags ...)`, including `contains`.
- `apps/web/src/lib/data.ts:1488-1548` runs compiled conditions on public image listing queries and, for offset mode, a separate `COUNT(*)`.

Why this is a problem:

The AST has structural caps, but the cost of an admin-created public collection still depends on predicate shape. `contains`/LIKE predicates over text-ish columns and tag contains subqueries can defeat useful indexes. Public collection pages are dynamic, so crawlers can repeatedly trigger expensive predicates and counts.

Concrete failure scenario:

An admin publishes a collection with several OR branches using `contains` on camera/text fields and tag names. Each public visit runs grouped image queries plus a count over the dynamic condition, causing full or broad scans even though the page returns only 30 images.

Suggested fix:

Restrict public smart-collection predicates to indexed fields or precompute public collection membership into a join table. For flexible text predicates, use a deliberate full-text index/search surface. Add an estimated-cost guard and skip `COUNT(*)` for expensive dynamic predicates.

### PERF-C16-09: Timeline and year pages render up to 500 photo cards in one response

Severity: Low
Confidence: Medium

Code region:

- `apps/web/src/lib/data-timeline.ts:166-222` sets `TIMELINE_PAGE_LIMIT = 500` and returns up to 500 grouped image rows.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94` fetches timeline images during SSR.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:226-265` maps month photos to full `GridPicture` cards.
- `apps/web/src/lib/data-timeline.ts:243-267` groups year-in-review data from the same timeline result.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:92-131` fetches and flattens year photos; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:189-226` renders the cards.

Why this is a problem:

The limit is bounded and visible, but 500 cards is still a large SSR/RSC/HTML response and a large image-candidate surface. The pages are not client-hydrating every card like a full client grid, but the browser still parses and lays out many `<picture>` elements.

Concrete failure scenario:

A year with 500 public photos is opened on mobile. The server returns a large response, the browser lays out hundreds of masonry items, and scrolling or first input is delayed.

Suggested fix:

Introduce month-level or page-level pagination/lazy loading for archive pages. Keep the first SSR response to a smaller above-the-fold set and load older months through a cursor action.

### PERF-C16-10: Admin CSV export materializes up to 50,000 rows and the final CSV string in memory

Severity: Low
Confidence: High

Code region:

- `apps/web/src/app/[locale]/admin/db-actions.ts:45-50` documents the 15-25 MB peak heap concern.
- `apps/web/src/app/[locale]/admin/db-actions.ts:68-83` selects up to 50,000 grouped image rows.
- `apps/web/src/app/[locale]/admin/db-actions.ts:90-118` builds an array of CSV lines and then joins it into one string.

Why this is a problem:

This is admin-only and bounded, but it is still a large Server Action response and heap allocation. The code clears the DB result array before joining, which helps, but the line array and final string still coexist.

Concrete failure scenario:

An admin exports a near-50k image catalog while background image work is active. The process allocates tens of MB for the export and stalls GC, causing slow admin UI and possibly affecting public requests in the same Node process.

Suggested fix:

Move CSV export to a streaming admin route using a cursor/batched query and `ReadableStream`. Keep the current Server Action as a small-gallery convenience or remove it once the streaming route exists.

## Manual-Validation Risks

### PERF-C16-11: Sidecar backfill can exceed host budgets outside the web process

Severity: Medium
Confidence: Medium

Code region:

- `apps/web/scripts/backfill-color-pipeline.ts:383-387` accepts `BACKFILL_CONCURRENCY` with fallback 2 and max 8.
- `apps/web/scripts/backfill-color-pipeline.ts:409-417` pages DB candidates.
- `apps/web/scripts/backfill-color-pipeline.ts:523-560` queues concurrent `reprocessRow` tasks and flushes batches when pending updates reach the batch size.
- `apps/web/src/lib/process-image.ts:1227-1440` performs per-row derivative generation with parallel format fan-out.

Why this is a risk:

The sidecar runs in a separate Node process with its own DB pool and libvips usage. The web process cannot see or throttle it. Whether this is safe depends on operational practice: running it during a maintenance window at concurrency 1 is different from `BACKFILL_CONCURRENCY=8` during public traffic.

Concrete failure scenario:

An operator runs the sidecar at high concurrency while the web queue is active. DB connections, CPU, and derivative-directory writes exceed the single-host budget assumed by the in-app queue/backfill arithmetic.

Suggested fix:

Document and enforce a production-safe default of 1 unless a maintenance flag is supplied. Consider acquiring a DB-backed "heavy maintenance" lock that makes the web queue pause or reject new heavy work while the sidecar runs. Validate with production-like load and disk I/O metrics.

### PERF-C16-12: Single-writer and process-local state are warning-only, not enforcement

Severity: Medium
Confidence: High

Code region:

- `apps/web/src/lib/single-writer-guard.ts:6-16` states that multiple web processes break restore fences, upload quota tracking, and rate-limit fast paths, and that the guard cannot enforce single-instance operation.
- `apps/web/src/lib/single-writer-guard.ts:230-234` logs that startup continues even when another live instance is detected.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload tracking in `globalThis`.
- `apps/web/src/lib/background-db-writes.ts:3-10` stores analytics queue state in process memory.
- `apps/web/src/lib/rate-limit.ts:70-87` and `apps/web/src/lib/rate-limit.ts:393-415` use bounded process-local rate-limit maps for public surfaces.

Why this is a risk:

The documented topology is single web instance. If production accidentally runs two containers or a rolling deploy overlaps too long, process-local caps and queues split. The guard warns but does not fail closed, so the system can continue in a mode where rate limits, upload accounting, and shared queues are weaker than intended.

Concrete failure scenario:

A deployment leaves an old web process running while a new one starts against the same DB. Each process has separate in-memory rate-limit buckets, upload trackers, analytics queues, and image queue state. Users can exceed per-process quotas, view counts can flush from both processes, and background DB load doubles.

Suggested fix:

Keep warning-only behavior for local development, but add a production option that fails startup or enters read-only/maintenance when the singleton lock is held. Move critical counters to DB/Redis if multi-instance support becomes a goal.

### PERF-C16-13: Nginx limiter correctness depends on deployment topology

Severity: Low
Confidence: High

Code region:

- `apps/web/nginx/default.conf:1-29` defines per-IP `limit_req_zone` and documents the `$binary_remote_addr` caveat.
- `apps/web/nginx/default.conf:215-226` proxies uploaded derivatives to Next with cache policy.
- `apps/web/nginx/default.conf:246-263` gives `/_next/image` a dedicated limiter for Sharp CPU.
- `apps/web/nginx/default.conf:274-286` applies the public SSR limiter only to the catch-all location.

Why this is a risk:

The nginx config has good route-specific limits, but the key is `$binary_remote_addr`. Behind a load balancer without realip/proxy-protocol configuration, every visitor may share one limiter bucket, or the app and edge may disagree on client identity.

Concrete failure scenario:

The deployment moves behind an upstream LB that connects from one private IP. Public SSR and image optimizer limiters see the LB as the client, so normal traffic can trip shared buckets; app-level per-IP DB rate limits may see a different XFF-derived identity.

Suggested fix:

For any LB-fronted deployment, configure and test `ngx_http_realip_module` or PROXY protocol, and align `TRUSTED_PROXY_HOPS` with nginx's forwarded headers. Add an operational smoke test that makes two requests with distinct client IPs through the actual edge and verifies separate limiter buckets.

## Checked Without New Finding

- Rate limiter memory growth: `createResetAtBoundedMap` enforces hard caps on `set` and `prune` (`apps/web/src/lib/bounded-map.ts:91-105`, `apps/web/src/lib/bounded-map.ts:156-188`). Upload tracker also has expiry and hard cap (`apps/web/src/lib/upload-tracker-state.ts:23-60`). I did not find an unbounded process-local rate-limit map in the reviewed public/admin surfaces.
- Public load-more/search/view actions: limits, offset caps, DB-backed checks, and rollback behavior are present (`apps/web/src/app/actions/public.ts:132-170`, `apps/web/src/app/actions/public.ts:295-380`).
- Derivative serving: `serve-upload.ts` uses a 5s settings hash cache/inflight dedupe, 304 and HEAD short-circuits, and streamed GET bodies (`apps/web/src/lib/serve-upload.ts:69-105`, `apps/web/src/lib/serve-upload.ts:242-328`).
- Cache invalidation/revalidation: derivative cache policy is deliberately one hour plus `must-revalidate` in Next and nginx, not immutable (`apps/web/next.config.ts:60-76`, `apps/web/nginx/default.conf:215-218`). Existing static derivatives still require re-encode/mtime change for byte changes, which is documented.
- OG routes: public OG endpoints are rate-limited and use ETags; per-photo OG does buffer Satori PNG and Sharp JPEG output (`apps/web/src/app/api/og/photo/[id]/route.tsx:38-43`, `apps/web/src/app/api/og/photo/[id]/route.tsx:100-110`, `apps/web/src/app/api/og/photo/[id]/route.tsx:302-306`), but response size is fixed to 1200x630 and not a primary scale risk compared with semantic/map/upload paths.
- Build/deploy performance: Docker uses standalone output, externalizes native packages, and deploy runs health check before pruning (`apps/web/next.config.ts:49-54`, `apps/web/Dockerfile`, `apps/web/deploy.sh`). I did not find a new build/deploy performance issue beyond the documented cost of native optional dependency installation.
- Main listing N+1: public image listing and shared groups batch tags rather than loading tags per image. Remaining listing concerns are query shape and aggregation cost, not classic per-row N+1.

## Final Sweep

I rechecked the commonly missed categories after drafting findings:

- Sharp CPU/memory: global `sharp.concurrency()` and `sharp.cache(false)` are deliberate (`apps/web/src/lib/process-image.ts:36-57`); remaining risk is concurrent format fan-out multiplied by independent queues/backfills.
- Streaming vs buffering: derivative serving and DB dump download stream; large upload/restore ingestion remains framework-buffered before app streaming.
- Queue/backfill concurrency: in-app queue/backfill and sidecar paths were all reviewed. The strongest issue is lack of a shared heavy-work budget.
- DB shape/indexes: reviewed schema indexes, listing/timeline/map/smart/semantic/backfill queries, and analytics. Findings cover missing backfill index and non-sargable daily query; map/smart/semantic are payload/scan risks.
- React rendering/hydration/UI responsiveness: reviewed home load-more, timeline/year, map, and lightbox surfaces. Map is the strongest UI responsiveness issue.
- Public expensive work: reviewed public actions, semantic/similar APIs, OG, uploads serving, health/live, feed/sitemap style routes, and nginx public limiter. Semantic/similar and map are the main remaining public-cost issues.
- Shared process state and single-writer assumptions: reviewed singleton guard, process-local rate limits, upload tracker, analytics queue, shared view buffer, queue state, and maintenance scheduler. This remains a topology risk, not a bug under the documented single-instance deployment.
