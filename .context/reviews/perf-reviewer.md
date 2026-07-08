# Run-10 Cycle 34 Performance Review

Role: `perf-reviewer`
Scope: entire repository, static review only, no implementation.
Perspective: performance, concurrency, CPU, memory, browser responsiveness, DB query cost, N+1 patterns, cache invalidation, background workers, image processing, service worker, rate limits, race/resource contention, deploy/runtime bottlenecks.

## Relevant-File Inventory

Primary project guidance and operating constraints:

- `AGENTS.md`
- `CLAUDE.md`
- Existing historical review baseline: `.context/reviews/perf-reviewer.md` from Cycle 24, treated only as prior-cycle context before this file was rewritten for Cycle 34.

Runtime and deployment surface:

- `apps/web/deploy.sh`
- `apps/web/docker-compose.yml`
- `apps/web/Dockerfile`
- `apps/web/nginx/default.conf`
- `apps/web/next.config.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/lib/maintenance-scheduler.ts`
- `apps/web/src/lib/single-writer-guard.ts`

Database, schema, query, rate-limit, and cache surface:

- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/src/lib/view-retention.ts`
- `apps/web/src/lib/pending-file-deletions.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`

Upload, image processing, queue, backfill, and ML surface:

- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`

Browser, service worker, UI responsiveness, and public routes:

- `apps/web/public/sw.template.js`
- `apps/web/src/lib/sw-cache.ts`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/components/map/map-client.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/masonry-card.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/search.tsx`

Relevant test and source-contract inventory considered:

- `apps/web/src/__tests__/image-queue-concurrency-cap.test.ts`
- `apps/web/src/__tests__/admin-backfill-concurrency-cap.test.ts`
- `apps/web/src/__tests__/background-db-writes.test.ts`
- `apps/web/src/__tests__/semantic-scan-limit-source.test.ts`
- `apps/web/src/__tests__/data-timeline.test.ts`
- `apps/web/src/__tests__/data-tag-names-sql.test.ts`
- `apps/web/src/__tests__/sw-cache.test.ts`
- `apps/web/src/__tests__/sw-template-contract.test.ts`
- `apps/web/src/__tests__/load-more-rate-limit.test.ts`
- `apps/web/src/__tests__/nginx-config.test.ts`
- `apps/web/src/__tests__/deploy-script-contract.test.ts`
- `apps/web/src/__tests__/map-privacy.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`

## Findings

### PERF-C34-01: Server Action upload and restore paths materialize large multipart bodies before app-level resource gates

Severity: High
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/next.config.ts:111-119` sets `experimental.serverActions.bodySizeLimit` and `proxyClientMaxBodySize` from `NEXT_SERVER_ACTION_BODY_SIZE_LIMIT`, with comments allowing restore bodies around 250 MiB plus multipart overhead.
- `apps/web/src/app/actions/images.ts:87-106` exposes `uploadImages(formData: FormData)` and reads `formData.getAll('files')`.
- `apps/web/src/app/actions/images.ts:154-159` acquires the upload contract lock only after the Server Action has already received `FormData`.
- `apps/web/src/app/actions/images.ts:197-250` computes upload bytes and checks disk headroom only after body materialization.
- `apps/web/src/app/[locale]/admin/db-actions.ts:789-810` exposes `runRestore(formData)`, gets the uploaded `File`, checks size, then streams it to disk. The restore file is still already a framework-created `File`.
- The safer contrast is the Lightroom route: `apps/web/src/app/api/admin/lr/upload/route.ts:101-187` checks `Content-Length`, tracker state, and parse-slot admission before calling `request.formData()`.

Concrete failure scenario:

Two admins submit near-limit browser uploads or a DB restore while normal image processing is active. Next/React accepts and materializes hundreds of MiB of multipart data before gallery-specific locks, disk checks, and byte quotas can reject the work. On a single web container, this can trigger GC stalls, RSS pressure, or OOM before the app's intended safeguards run.

Fix:

Move large browser upload and DB restore ingestion out of Server Actions into Node route handlers or a streaming multipart parser. Apply `Content-Length` checks, a shared parse semaphore, disk-headroom checks, and upload/restore contract locks before parsing the body. Keep Server Actions for small metadata/control operations only.

### PERF-C34-02: Background DB and CPU admission is split across independent governors

Severity: High
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/db/index.ts:31-41` configures the MySQL pool with `connectionLimit = 10` and `queueLimit = 20`.
- `apps/web/src/lib/image-queue.ts:121-153` derives image-queue concurrency from the same pool size, reserving foreground capacity locally.
- `apps/web/src/lib/image-queue.ts:447-456` creates the image processing queue with that independent concurrency.
- `apps/web/src/lib/admin-backfill-runner.ts:97-143` derives a separate admin-backfill concurrency cap from the same pool assumptions.
- `apps/web/src/lib/admin-backfill-runner.ts:716-727` creates another independent `PQueue`.
- `apps/web/src/lib/background-db-writes.ts:3-75` adds a separate analytics write queue with concurrency 2 and up to 1000 pending writes.
- `apps/web/src/lib/clip-model.ts:53-72` adds an independent CLIP inference cap and pending queue.
- `apps/web/src/lib/process-image.ts:36-57` globally tunes Sharp concurrency/cache, but both queue and backfill lanes can still feed image work at the same time.
- Sidecars are independently budgeted too: `apps/web/scripts/backfill-color-pipeline.ts:384-388` and `apps/web/scripts/backfill-clip-embeddings.ts:84-85`.

Concrete failure scenario:

An image queue run, admin backfill, analytics flush, CLIP inference, and semantic/similar requests overlap. Each subsystem believes it preserved enough DB or CPU capacity, but the reservations are not global. Foreground page loads then wait behind pool queueing, CPU-heavy Sharp/libvips work, or embedding decode/scoring work even though each individual subsystem is under its local cap.

Fix:

Introduce a shared background resource governor for the web process with explicit token classes for DB, image/CPU, and inference. Route image queue, admin backfill, analytics writes, maintenance jobs, and in-app embedding work through it. Sidecars should accept explicit operator budgets and surface current contention in logs/metrics.

### PERF-C34-03: Public keyword search uses leading-wildcard LIKE scans across image and tag text

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/app/actions/public.ts:247-329` exposes public search behind a 30/minute DB-backed rate limit.
- `apps/web/src/lib/data.ts:1574-1583` accepts the public search query and limit.
- `apps/web/src/lib/data.ts:1637-1655` applies `containsLike` across title, description, camera, lens, topic title, and topic label.
- `apps/web/src/lib/data.ts:1693-1701` adds a correlated tag-name `EXISTS` branch with `containsLike(tags.name, searchTerm)`.
- `apps/web/src/lib/data.ts:1716-1738` can run fallback searches in parallel.
- `apps/web/src/db/schema.ts:123-132` has general visibility/date/pipeline indexes, but no full-text or denormalized search-document index for this access pattern.

Concrete failure scenario:

With tens of thousands of images and tags, every valid public search can scan broad text columns and tag relationships. Rate limiting reduces request count, but it does not make each accepted request cheap. A small number of users repeatedly searching can consume DB CPU and delay unrelated reads.

Fix:

Move public keyword search to an indexed search path: MySQL `FULLTEXT`, a denormalized `image_search_document` table, ngram indexing for Korean/partial terms, or a dedicated search backend. Keep rate limits as abuse control, not as the primary cost control.

### PERF-C34-04: Timeline archive queries use non-sargable date functions

Severity: Low-Medium
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/lib/data-timeline.ts:106-114` documents that the month/day query is currently non-sargable.
- `apps/web/src/lib/data-timeline.ts:115-134` filters with `MONTH(images.capture_date)` and `DAY(images.capture_date)`.
- `apps/web/src/lib/data-timeline.ts:147-159` extracts and orders distinct years with `YEAR(images.capture_date)`.
- `apps/web/src/db/schema.ts:123-129` indexes full dates and timestamps, but no generated `capture_year`, `capture_month`, or `capture_day` columns are present.

Concrete failure scenario:

As the catalog grows, on-this-day widgets and archive-year lists scan all processed rows with capture dates. The queries are bounded by result count, but the predicate work is not index-friendly.

Fix:

Add stored generated columns for capture year/month/day, index the archive access patterns, and rewrite timeline queries to use those columns. A small derived archive table would also work if maintained transactionally with image metadata updates.

### PERF-C34-05: Public map can SSR, hydrate, and mount up to 10,000 markers plus a duplicate text list

Severity: Medium
Confidence: High
Status: Likely

Evidence:

- `apps/web/src/lib/data.ts:1766-1775` caps public map markers at 10,000 and fetches one extra row to detect truncation.
- `apps/web/src/lib/data.ts:1784-1802` filters visible geotagged images and orders them by capture date/id.
- `apps/web/src/db/schema.ts:123-132` does not show a map-specific composite index over processed/public/map-visible/GPS/date access.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-67` maps every DB row into page props.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:90-111` also renders a full HTML list for every marker.
- `apps/web/src/components/map/map-client.tsx:78-95` computes bounds from every marker on the client.
- `apps/web/src/components/map/map-client.tsx:120-141` renders one Leaflet marker and popup per item.

Concrete failure scenario:

A gallery with thousands of GPS-tagged photos serves a large RSC payload, hydrates a duplicate list, then mounts thousands of Leaflet markers on mobile. The page can become main-thread bound before the user interacts with the map.

Fix:

Serve map markers through a viewport/bounding-box API, add clustering or tile aggregation, lower the first-paint cap, virtualize or paginate the text list, and add a map-specific index for the public GPS query shape.

### PERF-C34-06: Semantic and similar search perform bounded brute-force embedding scans

Severity: Medium
Confidence: High
Status: Likely

Evidence:

- `apps/web/src/lib/clip-embeddings.ts:36-48` sets `SEMANTIC_SCAN_LIMIT` to a default of 2000 and a hard maximum of 25,000.
- `apps/web/src/app/api/search/semantic/route.ts:263-280` selects up to that many embedding BLOBs joined to processed images.
- `apps/web/src/app/api/search/semantic/route.ts:292-311` decodes and scores every candidate in process memory.
- `apps/web/src/app/api/search/similar/[id]/route.ts:177-214` follows the same scan/decode/score pattern for similar images.
- `apps/web/src/db/schema.ts:314-326` stores embeddings as `MEDIUMBLOB` with an index on model version and update time, not a vector/ANN index.
- `apps/web/src/lib/rate-limit.ts:404-427` uses an in-memory limiter for semantic endpoints, so limits are per process and do not bound DB/CPU cost globally.

Concrete failure scenario:

If the semantic scan cap is raised for quality, concurrent searches repeatedly transfer and decode large embedding BLOB sets and perform thousands of dot products in the request path. Results are also freshness-biased by `updatedAt` rather than nearest-neighbor indexed.

Fix:

Move to an ANN/vector index or maintain a resident normalized embedding matrix with explicit memory budgets, model-version invalidation, and bounded refresh. At minimum cache decoded embeddings, instrument scan/decode/score latency, and make semantic rate limiting DB-backed or gateway-backed.

### PERF-C34-07: Service worker HTML cache eviction reads and sorts cached responses on over-cap writes

Severity: Low
Confidence: High
Status: Likely

Evidence:

- `apps/web/public/sw.template.js:31-39` caps HTML cache entries at 50.
- `apps/web/public/sw.template.js:147-164` evicts HTML cache overflow by listing all keys, matching each response, reading the `sw-cached-at` header, sorting all entries, and deleting overflow.
- Image cache eviction is more metadata-driven: `apps/web/public/sw.template.js:109-144` and `apps/web/src/lib/sw-cache.ts:91-163`.

Concrete failure scenario:

On a mobile browser that has browsed enough pages to exceed the HTML cache cap, each new HTML cache write performs Cache API response lookups and an array sort inside the service worker. The cap is small, so this is not catastrophic, but it can add fetch-handler latency on low-end devices.

Fix:

Mirror the image-cache metadata approach for HTML entries. Keep recency in metadata, evict incrementally, and avoid opening every cached response just to sort by age.

### PERF-C34-08: Host nginx public and image rate limits are not deploy-verified

Severity: Medium
Confidence: Medium
Status: Manual-validation risk

Evidence:

- `apps/web/nginx/default.conf:1-29` defines rate-limit zones and notes real-IP deployment requirements.
- `apps/web/nginx/default.conf:246-272` rate-limits `/_next/image`.
- `apps/web/nginx/default.conf:274-311` rate-limits public SSR paths and explicitly says this config-only change must be applied manually to the host nginx.
- `apps/web/deploy.sh:51-58` builds and starts docker compose services, then health-checks the app; it does not verify or reload host nginx config.

Concrete failure scenario:

The repository contains the intended nginx limiter, but the production host keeps an older config. Public SSR and Next image optimizer traffic can then reach Node/Sharp without the gateway throttle assumed by the code review and tests.

Fix:

Add an operational deploy check that inspects active host nginx config, validates the expected zones/location blocks, and optionally runs a rate-limit smoke test. If host nginx remains out of deploy scope, add an app-level coarse limiter for the highest-cost public routes.

### PERF-C34-09: Admin CSV export materializes up to 50,000 grouped rows and the final CSV string in heap

Severity: Low-Medium
Confidence: High
Status: Manual-validation risk

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:71-76` documents the current 50,000-row in-memory cap and estimates roughly 15-25 MiB peak for typical metadata.
- `apps/web/src/app/[locale]/admin/db-actions.ts:94-109` selects grouped rows and concatenated tags up to the cap.
- `apps/web/src/app/[locale]/admin/db-actions.ts:111-144` maps all rows and joins the complete CSV string in memory.

Concrete failure scenario:

An admin exports a large catalog while uploads, backfills, or semantic searches are active. The bounded export still adds a large transient heap allocation and can cause GC pauses or memory pressure in the web process.

Fix:

Convert export to a route handler that streams CSV rows with cursor/keyset pagination and backpressure. Keep the cap, but avoid holding both the full row set and final CSV string at once.

## Confirmed Non-Findings / Existing Safeguards

- The Lightroom upload route performs pre-parse size/admission checks before `request.formData()` at `apps/web/src/app/api/admin/lr/upload/route.ts:101-187`.
- Browser upload submission is sequential, not parallel, at `apps/web/src/components/upload-dropzone.tsx:289-297`.
- Upload preview object URLs are revoked on removal/unmount at `apps/web/src/components/upload-dropzone.tsx:111-147`.
- Histogram pixel work is size-capped before worker calculation at `apps/web/src/components/histogram.tsx:187-245`.
- Photo viewer neighbor preload is bounded and format-aware at `apps/web/src/components/photo-viewer.tsx:272-339`.
- Load-more client code has stale-result and pending-request guards at `apps/web/src/components/load-more.tsx:43-150`.
- Maintenance sweeps run with in-flight guards and sequential steps at `apps/web/src/lib/maintenance-scheduler.ts:35-97`.
- View-retention cleanup deletes in bounded chunks at `apps/web/src/lib/view-retention.ts:31-87`.
- Pending file deletion drain is bounded and sequential at `apps/web/src/lib/pending-file-deletions.ts:105-138`.
- Shutdown drains background queues with timeout handling at `apps/web/src/instrumentation.ts:33-87`.
- The single-writer guard uses a dedicated DB connection and keepalive/reacquire behavior at `apps/web/src/lib/single-writer-guard.ts:91-216`.

## Final-Sweep Skipped-File Status

No relevant production source category was intentionally skipped. The review focused on the files listed in the inventory and source-connected tests/contracts.

Skipped as non-source or low-signal for this lane:

- Binary/media/font/color-profile assets, including uploaded fixture images and `.icc`/font files.
- Generated or vendored directories such as `node_modules`, `.next`, build outputs, and git internals.
- Historical `.context/reviews/` and `.context/plans/` archives beyond using the prior perf-reviewer file as baseline context.
- Full line-by-line review of the entire 3000+ Vitest corpus. Relevant performance/source-contract tests were inventoried and spot-checked by filename and source patterns; this review did not execute the test suite.
- Live production nginx state, DB query plans, CPU profiles, browser traces, and load tests. Findings marked manual-validation risk need runtime confirmation.

Stop condition: static review artifact written with confirmed, likely, and manual-validation risks; no implementation performed.
