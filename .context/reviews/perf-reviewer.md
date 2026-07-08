# Cycle 24 Performance Review

Role: perf-reviewer lane  
Scope: entire repository review for performance, concurrency, CPU/memory, DB query shape, cache behavior, UI responsiveness, and operational scalability.  
Constraint: review-only; no source code edits.

## Inventory

I first built the review inventory from repo file lists and performance-sensitive patterns, then examined the relevant files rather than sampling within each category.

Examined guidance and plan context: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, Cycle 23 deferred/perf artifacts.

Examined runtime, deployment, and ingress: `package.json`, workspace package files, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, instrumentation and startup/shutdown files.

Examined DB and query surface: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, migrations, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, analytics/view retention helpers, rate-limit stores, admin actions, public actions, route handlers.

Examined upload, restore, image processing, and queue interactions: browser upload server action, Lightroom upload route, DB restore action/helpers, `process-image`, image queue, backfill runner, CLIP model/embedding helpers, background DB write queues, maintenance scheduler, single-writer/restore gates.

Examined search and discovery paths: keyword search action/data queries, semantic search route, similar-image route, CLIP embedding storage and bootstrap.

Examined UI responsiveness/cache behavior: public map page/client, timeline/list loading actions, service worker template, service-worker cache helper, Next image/cache configuration, public upload asset cache headers.

Examined operational safeguards and tests relevant to this review: lint gates, public route rate-limit scanner expectations, touch-target and privacy tests, e2e structure, and deploy/maintenance runbooks. I did not run benchmarks or mutate code because this lane is review-only.

## Confirmed Issues

### PERF-C24-01 - Large browser upload and DB restore Server Actions materialize multipart bodies before app backpressure

Severity: High  
Confidence: High  
Status: Confirmed source issue; live RSS impact should still be validated under load.

Evidence:
- `apps/web/next.config.ts:111-119` configures large Server Action/proxy body ceilings through `serverActions.bodySizeLimit` and `experimental.proxyClientMaxBodySize`.
- `apps/web/src/app/actions/images.ts:87-106` enters `uploadImages(formData: FormData)` and calls `formData.getAll("files")`; by this point the framework has already accepted/materialized the multipart body.
- The upload contract/advisory lock is later, at `apps/web/src/app/actions/images.ts:154-159`, and total-size/quota checks are later still at `apps/web/src/app/actions/images.ts:197-221`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:745-767` gets the restore `file` from already-materialized `FormData`, checks size, then streams that already-accepted file to a temp path.
- The Lightroom route shows the safer pattern: `apps/web/src/app/api/admin/lr/upload/route.ts:101-187` validates `Content-Length`, checks quota/lock state, acquires a parse slot, and only then calls `request.formData()`.

Why this is a problem: the highest-memory paths still use Server Action `FormData`, so app-level locks, maintenance checks, and quota checks happen after the expensive body admission. The process can spend memory and parser CPU on requests that will later be rejected.

Failure scenario: two admin browser tabs submit near-limit image batches while a DB restore upload is also posted. Each request can be accepted up to the configured action/proxy ceiling before the code reaches the upload/restore gates. On the disk-constrained single web container, this can create transient RSS spikes, GC churn, or OOM before the lock logic can refuse work.

Suggested fix: move large browser upload and DB restore upload to Node route handlers with the Lightroom route's shape: require and bound `Content-Length`, acquire a process-wide parse/body semaphore, preclaim upload/restore capacity, then stream multipart parts to disk. Keep Server Actions for small metadata mutations only.

### PERF-C24-02 - Background DB/CPU admission is split across queues, so combined load can overrun foreground capacity

Severity: High  
Confidence: High  
Status: Confirmed architectural issue; exact production threshold needs load testing.

Evidence:
- The MySQL pool is small and bounded: `apps/web/src/db/index.ts:31-41` sets `POOL_CONNECTION_LIMIT = 10` and `queueLimit: 20`.
- Image queue concurrency is derived locally from the pool at `apps/web/src/lib/image-queue.ts:121-153` and initialized at `apps/web/src/lib/image-queue.ts:447-456`.
- Admin backfill separately derives its own pool-aware concurrency at `apps/web/src/lib/admin-backfill-runner.ts:97-143` and uses the chosen value in `apps/web/src/lib/admin-backfill-runner.ts:716-727`.
- Background analytics writes use another queue with concurrency 2 and pending cap 1000 at `apps/web/src/lib/background-db-writes.ts:3-10` and `apps/web/src/lib/background-db-writes.ts:42-64`.
- CLIP inference has an independent concurrency/wait queue at `apps/web/src/lib/clip-model.ts:53-72` and `apps/web/src/lib/clip-model.ts:156-173`.
- Image processing also consumes CPU/libvips globally through `apps/web/src/lib/process-image.ts:36-57`, while image-queue and backfill each launch processing work independently.

Why this is a problem: each subsystem reserves capacity as if it were the only background actor. There is no process-wide background DB token pool or CPU work budget shared by image queue, backfill, analytics, CLIP embedding, semantic scan enrichment, and maintenance tasks.

Failure scenario: after a large upload, the image queue processes derivatives while an admin starts a backfill and public traffic records analytics/search requests. The image queue, backfill runner, analytics queue, and CLIP side effects can simultaneously hold most pool slots and CPU threads. Foreground routes then wait behind pool queue limits or hit transient DB errors even though each subsystem is individually "within limit."

Suggested fix: add a shared background resource governor with explicit foreground reserves: DB tokens, CPU/image tokens, and optional inference tokens. Route image queue, backfill, analytics flushes, semantic embedding backfills, and maintenance through that governor. Export queue depth, wait time, and rejected-work metrics so limits can be tuned.

### PERF-C24-03 - Public keyword search uses leading-wildcard text scans across image metadata and tags

Severity: Medium  
Confidence: High  
Status: Confirmed query-shape issue; impact depends on corpus size and live query volume.

Evidence:
- Public search is rate-limited at the action layer in `apps/web/src/app/actions/public.ts:247-329`, but the underlying query remains scan-shaped.
- `apps/web/src/lib/data.ts:1574-1583` accepts the public query and derives bounded result limits.
- The main search query uses `containsLike` across title, description, camera, lens, and topic label fields at `apps/web/src/lib/data.ts:1637-1655`.
- Tag fallback uses `EXISTS` plus label/alias matching at `apps/web/src/lib/data.ts:1693-1701`, and fallback queries run in parallel at `apps/web/src/lib/data.ts:1716-1738`.
- `apps/web/src/db/schema.ts:123-132` shows image indexes for date/id, processed/pipeline, GPS, and timestamps, but no full-text/search-document index for these fields.

Why this is a problem: leading-wildcard `LIKE` predicates are generally not sargable on standard B-tree indexes. The query is bounded in returned rows, not in rows inspected.

Failure scenario: once the gallery grows to tens or hundreds of thousands of images/tags, short public searches can scan large parts of `images`, `topics`, and tag relations before producing 24-48 rows. A burst of valid, rate-limited public searches can still consume DB CPU and degrade browsing.

Suggested fix: introduce a real search index path: MySQL full-text where acceptable, a denormalized `search_document` table, or an external/local search engine. Keep the public action's existing rate limit, but make the DB work proportional to indexed matches rather than corpus size.

### PERF-C24-04 - On-this-day query is non-sargable on `capture_date`

Severity: Low-Medium  
Confidence: High  
Status: Confirmed query-shape issue; likely acceptable at current size but will age poorly.

Evidence:
- The code explicitly documents the limitation at `apps/web/src/lib/data-timeline.ts:103-110`.
- The query filters with `MONTH(images.capture_date)` and `DAY(images.capture_date)` at `apps/web/src/lib/data-timeline.ts:121-131`.
- Existing image date indexes are on full date/timestamp shapes in `apps/web/src/db/schema.ts:123-132`, so they cannot directly satisfy month/day extraction predicates.

Why this is a problem: applying functions to the column prevents efficient use of normal `capture_date` indexes for this predicate.

Failure scenario: a daily homepage/timeline path calls this helper on a larger catalog. MySQL scans and evaluates many captured images to find a small anniversary set, adding avoidable DB work to public page rendering.

Suggested fix: add generated/stored `capture_month` and `capture_day` columns, or a compact derived table keyed by `(month, day, capture_date, id)`, and update the query to use that indexed shape.

## Likely Issues

### PERF-C24-05 - Public map can SSR, serialize, hydrate, and mount up to 10,000 markers plus a duplicate list

Severity: Medium  
Confidence: High  
Status: Likely user-visible issue; needs browser trace on a large GPS-heavy production dataset.

Evidence:
- `apps/web/src/lib/data.ts:1775-1816` fetches up to `MAP_MAX_MARKERS = 10000` plus one extra row.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66` fetches map images and maps every row into marker props during server render.
- The same page renders a list entry for every marker at `apps/web/src/app/[locale]/(public)/map/page.tsx:98-110`.
- The client map computes bounds arrays for all markers at `apps/web/src/components/map/map-client.tsx:77-94` and renders one Leaflet `Marker`/`Popup` per marker at `apps/web/src/components/map/map-client.tsx:120-141`.

Why this is a problem: the limit caps data volume but still allows a very heavy first paint and hydration path. React/Leaflet marker creation and popup binding are main-thread heavy, and the duplicate list doubles the DOM pressure.

Failure scenario: a photographer with 8,000-10,000 geotagged images opens `/map` on mobile. The page transfers a large RSC payload, hydrates thousands of entries, computes bounds over all markers, and mounts thousands of Leaflet markers. The result is long input delay, scroll jank, or browser tab termination.

Suggested fix: serve map points by viewport/bounds, use clustering or tile-style aggregation, lower the initial SSR limit, and virtualize or paginate the side/list view. Consider rendering only cluster centroids until zoomed in.

### PERF-C24-06 - Semantic and similar search are bounded brute-force BLOB scans

Severity: Medium  
Confidence: High  
Status: Likely scalability issue; production severity depends on semantic-search activation and traffic.

Evidence:
- Semantic scan limits are bounded but still large: `apps/web/src/lib/clip-embeddings.ts:36-48` allows a default 2000 and hard max 25000 embeddings.
- Semantic search loads embedding BLOBs ordered by model/update time at `apps/web/src/app/api/search/semantic/route.ts:263-284`, decodes and scores every returned row at `apps/web/src/app/api/search/semantic/route.ts:292-311`, then enriches winners.
- Similar-image search has the same scan/score shape at `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`.
- The embedding schema indexes `modelVersion` and `updatedAt` at `apps/web/src/db/schema.ts:314-326`, which bounds recency/model reads but does not provide nearest-neighbor lookup.

Why this is a problem: request cost is proportional to `SEMANTIC_SCAN_LIMIT`, not to the requested `topK`. It also biases recall toward the most recently updated embeddings when the corpus exceeds the scan limit.

Failure scenario: semantic search is enabled with a 25k scan cap and several users issue searches or similar-image requests. Each request transfers thousands of BLOBs, decodes vectors, and computes dot products in the Node process, competing with uploads/image processing for CPU and memory bandwidth. Older but relevant images can be invisible because they fall outside the recency-limited scan.

Suggested fix: move to an ANN/vector index or a resident normalized embedding matrix maintained by a background worker with explicit memory caps. At minimum, cache decoded embeddings per model version, add latency/scan metrics, and expose scan-limit misses so recall loss is visible.

### PERF-C24-07 - Service worker HTML cache eviction does O(n) response reads and sort on over-cap writes

Severity: Low  
Confidence: High  
Status: Likely small today; grows with cached HTML count and low-end devices.

Evidence:
- HTML cache size is capped at 50 entries in `apps/web/public/sw.template.js:31-39`.
- On eviction, `enforceHtmlCacheLimit` calls `htmlCache.keys()` and then `htmlCache.match(request)` for each key at `apps/web/public/sw.template.js:147-157`.
- It sorts all entries and deletes overflow at `apps/web/public/sw.template.js:159-164`.
- Image cache metadata uses a separate LRU-style helper, but HTML eviction does not use that metadata path.

Why this is a problem: each HTML cache write beyond the cap can scan and read metadata from every cached HTML response, then sort the full set. This happens on the client main/service-worker execution path, where low-end devices have the least CPU budget.

Failure scenario: a mobile visitor browses many public pages while offline-first caching is active. Once the HTML cache exceeds the cap, every new HTML cache put performs repeated Cache API reads and sorting, delaying fetch handling and making navigation feel sticky.

Suggested fix: track HTML recency metadata separately, as the image cache does, and evict incrementally without reading every cached response body/header on each write.

## Risks Needing Manual Validation

### PERF-C24-08 - Host nginx public/Next-image rate limits are config-only unless the operator has applied them

Severity: Medium  
Confidence: Medium  
Status: Manual validation risk; repo contains the intended config, but deploy does not prove live host state.

Evidence:
- `apps/web/nginx/default.conf:1-29` defines public and Next image rate-limit zones and documents the real-IP dependency.
- Public catch-all rate limiting is configured at `apps/web/nginx/default.conf:274-311`, including comments that the block must be copied to the host nginx config.
- `/_next/image` rate limiting is configured at `apps/web/nginx/default.conf:246-272`.
- The per-iteration deploy path in `apps/web/deploy.sh:51-58` runs compose on the app host and health-checks the container, but it does not apply or verify host nginx configuration.

Why this is a problem: several expensive public paths are protected by app-level gates, but broad public page rendering and Next image optimization depend on ingress behavior. A config file in the repo is not proof that the production reverse proxy is enforcing it.

Failure scenario: production host nginx is still on an older config or missing `real_ip` setup. Public dynamic pages and `/_next/image` can be hit at high rate from one client or proxy bucket, consuming Node render/image CPU despite the intended limiter existing in the repo.

Suggested fix: make ingress limiter verification part of deployment or an explicit ops check. For example, add a non-destructive deploy validation that greps the active host nginx config and performs a controlled rate-limit smoke test, or move more coarse public throttling into the app where deployment can verify it.

### PERF-C24-09 - Admin CSV export intentionally materializes up to 50k rows and the full CSV string in memory

Severity: Low-Medium  
Confidence: High  
Status: Bounded admin-only risk; validate with production row/tag sizes.

Evidence:
- `apps/web/src/app/[locale]/admin/db-actions.ts:71-76` documents that export is an in-memory admin snapshot and expects roughly 15-25 MB at 50k rows.
- The query limit is 50,000 rows at `apps/web/src/app/[locale]/admin/db-actions.ts:109`.
- Rows are transformed into an array and then joined into one CSV string at `apps/web/src/app/[locale]/admin/db-actions.ts:116-144`.

Why this is a problem: the cap prevents unbounded export, but the operation still concentrates DB result memory, row transformation memory, and the final CSV string in the same Node process that serves uploads and public traffic.

Failure scenario: an admin exports near the 50k cap while upload processing or semantic search is active. Long tag/title fields push heap use above the documented estimate, causing GC pauses or transient memory pressure.

Suggested fix: convert CSV export to a streaming admin route with cursor pagination and backpressure. Keep the 50k cap if product requirements need it, but avoid constructing the full export in memory.

## Confirmed Non-Findings / Fixed Prior Risks

- The prior backfill `pipeline_version` scan risk is materially improved: `apps/web/src/db/schema.ts:127` now includes `idxImagesProcessedPipelineVersion`, and backfill queries at `apps/web/src/lib/admin-backfill-runner.ts:393-434` match the processed/pipeline shape.
- Timeline image pagination uses date ranges and cursor-style bounds at `apps/web/src/lib/data-timeline.ts:196-216`; the non-sargable finding is limited to the on-this-day helper.
- Public load-more actions enforce rate limits and offset caps before data access at `apps/web/src/app/actions/public.ts:132-245`.
- Image processing uses file paths and disables Sharp cache globally at `apps/web/src/lib/process-image.ts:36-57`; the main remaining issue is shared admission across independent producers, not unbounded Sharp cache.
- Service-worker image cache eviction uses explicit metadata in `apps/web/src/lib/sw-cache.ts`; the cache finding is limited to HTML eviction in `sw.template.js`.
- Maintenance/view-retention work is chunked: `apps/web/src/lib/view-retention.ts:31-87` limits purge batches and loop count.

## Final Sweep

Relevant categories examined: uploads, restore, image processing, image queue, backfill, CLIP/semantic search, DB schema/indexes, data access helpers, public/admin route handlers, server actions, map UI, timeline/list UI, service worker/cache code, ingress nginx config, Next config, deploy script, startup/shutdown drains, and performance-relevant tests/lint gates.

Common missed issues checked:
- Unbounded upload request size: bounded at ingress/config, but Server Action pre-materialization remains open as PERF-C24-01.
- Missing image pipeline DB index: checked and not currently a finding.
- Unbounded queue retries: checked; retry/permanent failure caps exist in image queue.
- Service worker unbounded image cache: checked; image LRU metadata exists.
- Public mutating route rate limits: checked at scanner/action level; no new rate-limit bypass found in this pass.
- Cursor pagination vs offset-only loading: checked; primary public load-more paths use cursor/capped offsets.
- Large public map hydration: still open as PERF-C24-05.
- Full-text/semantic search scalability: keyword and semantic paths still need indexed/vector-backed query shapes as PERF-C24-03 and PERF-C24-06.

