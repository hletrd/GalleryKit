# Cycle 38 Performance Review

Role: `cycle-38 perf-reviewer`  
Repository: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-07-08 KST  
Revision reviewed: `54083a2c`  
Output file: `.context/reviews/perf-reviewer.md`

## Provenance

- Read first: `AGENTS.md`, then `CLAUDE.md`.
- Loaded review workflow instructions: `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- Built an inventory before reviewing with `git ls-files` and targeted `rg` searches over app source, scripts, migrations, tests, config, and review history.
- Consulted prior review/provenance artifacts for regression context, then re-verified current findings against source:
  - `.context/reviews/run10-cycle28/perf-reviewer.md`
  - `.context/reviews/cycle-10b-2026-07-08/perf-reviewer.md`
  - `.context/plans/cycle-10b-2026-07-08-deferred.md`
  - previous `.context/reviews/perf-reviewer.md`
- Validation type: static deep review only. No build, test, lint, or production profiling was run because this task requested a review artifact and source edits were limited to this file.

## Review Inventory

Tracked inventory at review start:

- Total tracked files: 3641
- App source files under `apps/web/src`: 625
- Scripts and e2e files under `apps/web/scripts` and `apps/web/e2e`: 41
- SQL migrations under `apps/web/drizzle`: 34
- Key config/public runtime files inspected: 8

Review-relevant implementation and config areas inspected:

- Server actions and routes:
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/app/actions/embeddings.ts`
  - `apps/web/src/app/api/search/semantic/route.ts`
  - `apps/web/src/app/api/search/similar/[id]/route.ts`
  - public page routes under `apps/web/src/app/[locale]/(public)/`
- Data and DB paths:
  - `apps/web/src/db/index.ts`
  - `apps/web/src/db/schema.ts`
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/lib/data-timeline.ts`
  - `apps/web/src/lib/background-db-writes.ts`
  - `apps/web/src/lib/view-retention.ts`
  - `apps/web/src/lib/maintenance-scheduler.ts`
- Background work, queues, and image processing:
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/lib/admin-backfill-runner.ts`
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/clip-model.ts`
  - `apps/web/src/lib/clip-embeddings.ts`
  - `apps/web/scripts/backfill-clip-embeddings.ts`
- UI responsiveness and media:
  - `apps/web/src/components/*`
  - `apps/web/src/components/map/*`
  - `apps/web/src/components/gallery/*`
  - `apps/web/public/sw.template.js`
  - `apps/web/public/histogram-worker.js`
- Runtime/config/deployment:
  - `apps/web/next.config.ts`
  - `apps/web/Dockerfile`
  - `apps/web/docker-compose.yml`
  - `apps/web/nginx/default.conf`
  - `apps/web/drizzle/*.sql`
  - `apps/web/drizzle/meta/_journal.json`
- Relevant tests and docs were inspected by targeted search around the reviewed surfaces, including performance-sensitive privacy/touch/route guard tests and `.context` review/plan history.

Cross-file interactions traced:

- MySQL pool sizing in `db/index.ts` against independent queues in `image-queue.ts`, `admin-backfill-runner.ts`, `background-db-writes.ts`, maintenance jobs, and semantic embedding paths.
- Image delete actions against pending file deletion recovery and local file cleanup.
- Sharp/libheif concurrency in `process-image.ts` against queue and admin backfill admission controls.
- Semantic search/similar APIs against CLIP inference slots, embedding scan limits, and background embedding backfill.
- Public map route data loading against DB indexes, server-rendered fallback markup, and Leaflet marker hydration.
- Service worker caching, histogram worker, responsive image fallback paths, and gallery load-more behavior against UI responsiveness requirements.

## Findings

### PERF-C38-01: Batch image deletion still performs per-image DB mutations inside one transaction

Severity: Medium  
Confidence: High  
Classification: Confirmed issue

Code regions:

- `apps/web/src/app/actions/images.ts:731-756` defines `deleteImages` and allows up to 100 image IDs per batch.
- `apps/web/src/app/actions/images.ts:765-774` preloads all matching image rows in one query.
- `apps/web/src/app/actions/images.ts:809-845` opens one transaction and loops over every image. Each iteration performs:
  - one `pendingFileDeletions` insert at `apps/web/src/app/actions/images.ts:816-823`
  - one `imageTags` delete at `apps/web/src/app/actions/images.ts:832`
  - one `images` delete at `apps/web/src/app/actions/images.ts:833`
  - optional stale pending-row cleanup at `apps/web/src/app/actions/images.ts:843`
- `apps/web/src/app/actions/images.ts:861-893` performs bounded post-transaction file cleanup; that section is not the problem.

Failure scenario:

An admin deleting the maximum batch of 100 images holds a transaction open while issuing roughly 300 sequential mutation statements, plus optional cleanup statements. Under concurrent admin work, background image processing, semantic tasks, or view-write flushing, this extends lock hold time and monopolizes one of the 10 pooled DB connections. The code already does the expensive file cleanup after commit, but the transaction itself still scales linearly with the batch size.

Concrete fix:

Batch the transaction work:

1. Build all pending-file-deletion rows in memory and use one multi-row `insert(...).values(rows)`.
2. Delete tags with one `delete(imageTags).where(inArray(imageTags.imageId, foundIds))`.
3. Delete images with one `delete(images).where(inArray(images.id, foundIds))`.
4. Recover inserted pending IDs from the multi-row insert result in a deterministic way, or extend the pending-deletion rows with a unique deletion batch token so cleanup can target only rows created by this transaction.
5. If the affected deleted-image count is lower than expected, remove only the pending rows created by the transaction and return the stale-ID failure.

Do not read pending rows back by `image_id` alone unless the schema first guarantees uniqueness for active pending deletions; historical deferred notes already call out that pending deletion rows can be ambiguous by image ID.

### PERF-C38-02: Independent background budgets can over-admit DB and CPU work beyond the shared process capacity

Severity: High  
Confidence: High  
Classification: Confirmed issue

Code regions:

- `apps/web/src/db/index.ts:31-41` configures a MySQL pool with `connectionLimit: 10` and `queueLimit: 20`.
- `apps/web/src/db/index.ts:127-143` shows query/execute calls acquire real pooled connections, so all queues share the same finite pool.
- `apps/web/src/lib/image-queue.ts:121-141` derives image queue concurrency from the DB pool and caps local queue work.
- `apps/web/src/lib/image-queue.ts:456` creates the image-processing `PQueue`.
- `apps/web/src/lib/image-queue.ts:683-700` takes a pooled advisory-lock connection per image-processing claim.
- `apps/web/src/lib/image-queue.ts:761-818` claims and reads each pending image row.
- `apps/web/src/lib/image-queue.ts:883-918` keeps claim state through image format generation and DB status updates.
- `apps/web/src/lib/image-queue.ts:981-1008` can trigger embedding storage after image processing.
- `apps/web/src/lib/admin-backfill-runner.ts:1-52` documents that the in-app admin backfill runner is invisible to the main `PQueue` and shares Sharp/libheif capacity.
- `apps/web/src/lib/admin-backfill-runner.ts:97-143` defines a separate local DB/CPU budget and cap.
- `apps/web/src/lib/admin-backfill-runner.ts:330-358` takes a global backfill advisory lock.
- `apps/web/src/lib/admin-backfill-runner.ts:369-397` takes per-image advisory locks.
- `apps/web/src/lib/admin-backfill-runner.ts:526-677` performs re-encode, detect, and DB update work while the image is claimed.
- `apps/web/src/lib/admin-backfill-runner.ts:720-733` creates another `PQueue`.
- `apps/web/src/lib/admin-backfill-runner.ts:922-940` starts the backfill as fire-and-forget work from the admin request.
- `apps/web/src/lib/process-image.ts:36-57` globally configures Sharp concurrency/cache behavior.
- `apps/web/src/lib/process-image.ts:1411-1418` generates WebP, AVIF, and JPEG derivatives concurrently for each image.
- `apps/web/src/lib/background-db-writes.ts:3-9` and `apps/web/src/lib/background-db-writes.ts:42-75` add an independent analytics-write queue with concurrency 2 and up to 1000 pending writes.
- `apps/web/src/lib/maintenance-scheduler.ts:35-50` schedules hourly background retention/cleanup work.
- `apps/web/src/lib/view-retention.ts:76-87` can issue repeated 5000-row delete batches during retention cleanup.

Failure scenario:

The main image queue, the in-app admin backfill runner, CLIP embedding side effects, analytics write flushing, and scheduled retention work each have local limits, but there is no single process-wide admission controller. On the single-container/single-writer deployment described in `CLAUDE.md`, a production burst can combine:

- image queue workers holding advisory locks and doing Sharp work,
- admin backfill workers doing their own Sharp/libheif work,
- semantic embedding work after processed images,
- analytics write flushes,
- retention cleanup deletes,
- normal user/admin requests.

Those lanes compete for the same 10 MySQL connections and the same Node/Sharp/libheif CPU and memory envelope. Local caps make each component individually bounded, but the aggregate can still fill the pool queue, elongate request latency, and increase memory pressure during derivative generation.

Concrete fix:

Introduce one shared background resource coordinator for the process. It should expose leases for at least:

- long DB/advisory-lock slots,
- short DB mutation slots,
- Sharp/libheif CPU slots,
- CLIP inference/scoring slots.

Then make `image-queue.ts`, `admin-backfill-runner.ts`, embedding backfill, maintenance cleanup, and analytics flushing acquire from that shared budget. Admin backfill should either pause/downshift the main image queue or consume from the same global Sharp/DB lease pool. Add a small-pool regression test that starts mock queue, backfill, analytics, and retention tasks together and asserts the aggregate active DB/CPU leases never exceed the configured process budget.

### PERF-C38-03: The public map route can hydrate up to 10,000 Leaflet markers and render a 10,000-item fallback list on an uncached page

Severity: Medium  
Confidence: High  
Classification: Likely issue; manual profiling recommended

Code regions:

- `apps/web/src/lib/data.ts:1766-1775` sets `MAP_MAX_MARKERS = 10000`.
- `apps/web/src/lib/data.ts:1784-1802` queries all map-visible processed images with GPS coordinates, joins `topics`, orders them, and limits to `MAP_MAX_MARKERS + 1`.
- `apps/web/src/lib/data.ts:1813-1816` returns up to 10,000 images plus a `truncated` flag.
- `apps/web/src/db/schema.ts:124-131` defines several image indexes, but no GPS/map-specific composite index is present in the visible image index set.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14` sets `dynamic = "force-dynamic"` and `revalidate = 0`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-47` loads `getMapImages()` for every request.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:51-67` maps every returned image into a marker object.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:90-97` passes the full marker array to the client map.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:99-111` server-renders one fallback `<li>` per marker.
- `apps/web/src/components/map/map-client.tsx:78-95` computes bounds by allocating latitude and longitude arrays over every marker.
- `apps/web/src/components/map/map-client.tsx:121-142` renders one `Marker` and `Popup` per marker.

Failure scenario:

A large gallery with thousands of mapped images makes every `/map` request perform a dynamic DB query and ship a large marker payload to the browser. On the server, the route renders a large fallback list. On the client, hydration creates thousands of React/Leaflet marker and popup objects, and `FitBounds` performs full-array passes before fitting the map. The failure mode is first-load jank, high JS parse/hydration cost, and slow map interaction on midrange mobile devices. DB behavior may also degrade because the query filters by `map_visible`, `processed`, and non-null GPS fields but does not appear to have a dedicated map index.

Concrete fix:

Move the map to viewport-driven loading:

1. Add a map data endpoint keyed by bounding box and zoom.
2. Return clusters or capped points per tile/viewport instead of all points.
3. Use marker clustering or canvas/WebGL markers for dense regions.
4. Replace the 10,000-item fallback list with a capped accessible summary plus paginated/location-filtered details.
5. Add a composite map index aligned with the query shape, for example covering `processed`, `map_visible`, GPS presence/order fields, and `capture_date`/`id` as needed after checking `EXPLAIN`.
6. Add an e2e or browser-performance guard for a synthetic large marker payload, focused on hydration time and interaction latency.

### PERF-C38-04: Semantic and similar-image APIs do request-path brute-force embedding scans and JS scoring

Severity: Medium  
Confidence: High  
Classification: Manual-validation risk; likely scale issue

Code regions:

- `apps/web/src/app/api/search/semantic/route.ts:1-10` documents the request flow as text embedding plus a cosine-similarity scan.
- `apps/web/src/app/api/search/semantic/route.ts:247-254` creates the CLIP text embedding in the request path.
- `apps/web/src/app/api/search/semantic/route.ts:263-280` reads up to `SEMANTIC_SCAN_LIMIT` embedding blobs joined to image rows.
- `apps/web/src/app/api/search/semantic/route.ts:292-311` decodes every scanned blob and scores it in JavaScript before sorting.
- `apps/web/src/app/api/search/similar/[id]/route.ts:1-21` documents that similar-image lookup scans candidate embeddings.
- `apps/web/src/app/api/search/similar/[id]/route.ts:177-190` reads candidate embeddings up to `SEMANTIC_SCAN_LIMIT`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:204-214` decodes and dot-products candidates in request-path JavaScript.
- `apps/web/src/lib/clip-embeddings.ts:36-48` defines the default and hard scan limits.
- `apps/web/src/lib/clip-model.ts:53-64` defines process-local CLIP inference concurrency and queue caps.
- `apps/web/src/lib/clip-model.ts:156-173` serializes inference slots inside the process.
- `apps/web/src/app/actions/embeddings.ts:30-31` and `apps/web/src/app/actions/embeddings.ts:141-213` run admin embedding backfill with its own batch/concurrency behavior.
- `apps/web/scripts/backfill-clip-embeddings.ts:83-85` and `apps/web/scripts/backfill-clip-embeddings.ts:156-228` define the sidecar backfill batch and concurrency loop.

Failure scenario:

At the documented default scan limit, each semantic or similar request pulls and decodes thousands of embedding blobs and performs CPU scoring in the web process. The hard cap allows much larger scans. A few concurrent users can combine CLIP text inference, DB blob reads, JS decode/scoring, and normal page requests in the same Node process. For collections above the scan limit, results are also approximate by recency-filtered candidate set rather than true nearest neighbors, which can encourage operators to raise the scan limit and worsen CPU/memory pressure.

Concrete fix:

Move similarity lookup out of request-path brute force:

1. Use an ANN/vector index if available in the chosen DB stack, or maintain a sidecar vector index.
2. For similar-image pages, precompute nearest neighbors during embedding backfill and refresh them when embeddings change.
3. Keep text-query embedding inference behind the existing inference slot, but send vector lookup to the index instead of scanning blobs in JS.
4. Add telemetry for scanned candidates, decode/scoring time, embedding bytes read, queue wait time, and timeout/error rates.
5. Until an index exists, lower and document the scan cap, add request-level timeouts, and acquire a shared CPU/semantic lease from the coordinator proposed in PERF-C38-02.

## Manual-Validation Risks And Reviewed Non-Findings

- `apps/web/src/lib/data-timeline.ts:106-134` uses `MONTH(capture_date)` and `DAY(capture_date)` for the on-this-day widget, and `apps/web/src/lib/data-timeline.ts:147-160` computes distinct years with `YEAR(capture_date)`. These are known non-sargable patterns, but the on-this-day widget is capped to 6 images and was already documented in project history. I am not re-filing it as a confirmed issue without production `EXPLAIN`/row-count evidence, but it remains worth checking on very large libraries.
- JPEG fallback handling appears addressed in the current source. Reviewed regions include `apps/web/src/components/gallery/grid-picture.tsx:33-43`, `apps/web/src/components/gallery/masonry-card.tsx:106-113`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:269-276`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:228-235`, and `apps/web/src/app/[locale]/g/[key]/page.tsx:232-239`.
- Client-side gallery responsiveness has reasonable guards: `apps/web/src/components/gallery/home-client.tsx:20-79` buckets width calculations and uses animation-frame scheduling; `apps/web/src/components/gallery/load-more.tsx:43-111` guards concurrent pagination; `apps/web/src/components/gallery/load-more.tsx:137-147` uses an intersection observer root margin.
- Histogram work is off-main-thread through `apps/web/public/histogram-worker.js:4-36`, with the component guarded around worker/image loading in `apps/web/src/components/histogram.tsx:559-618`.
- Service-worker image caching is bounded and uses stale-while-revalidate behavior in `apps/web/public/sw.template.js:33-41`, `apps/web/public/sw.template.js:314-445`, and `apps/web/public/sw.template.js:535-565`. I did not find a new unbounded cache growth issue in the template.
- Nginx limits and cache headers in `apps/web/nginx/default.conf` and `apps/web/next.config.ts` are repository-configured, but live behavior still depends on the deployed config being current. That is an operator validation item rather than a source finding.

## Final Sweep

Commonly missed issue classes checked:

- Unbounded server-side pagination/query limits in public routes.
- Per-item DB mutations inside batch actions and transactions.
- Independent queue concurrency budgets that bypass a shared DB/CPU limiter.
- Sharp/libheif memory and CPU fan-out.
- Request-path vector/blob scans and CPU-heavy scoring.
- Service-worker cache growth and stale-while-revalidate behavior.
- Main-thread image analysis and layout-measurement loops.
- Fallback image paths that could trigger excessive 404s or full-size downloads.
- Migration/config interactions affecting query plans and deployment runtime limits.

No additional confirmed findings were found in the final sweep.

Skipped files:

- No review-relevant implementation/config/doc category was intentionally skipped.
- I did not line-read every historical `.context` artifact or every unit/e2e test file; those were searched and opened where they intersected the reviewed performance surfaces.
- Generated, binary, and live-data artifacts were intentionally skipped, including `.next`, `.omc`, uploaded media/resources, and production database contents.

