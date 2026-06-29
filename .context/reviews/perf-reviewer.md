# Performance Review - Cycle 4

Reviewer: perf-reviewer  
Scope: current HEAD `0fa5beb1` (`master`)  
Mode: read-only application review; this report is the only written artifact.

## Review Inventory

Read first:
- `AGENTS.md`
- `CLAUDE.md`

Stale-duplicate check:
- `.context/reviews/perf-reviewer.md` from the previous cycle before replacement
- `.context/reviews/_aggregate.md`
- `.context/reviews/run9-cycle8/perf-reviewer.md`
- `.context/reviews/run9-cycle8/_aggregate.md`
- `.context/plans/cycle-3-plan.md`

Performance/concurrency surfaces examined:
- Server actions: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/app/actions/admin-config.ts`
- Route handlers: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/images/[id]/route.ts`, `apps/web/src/app/api/images/[id]/download/route.ts`, `apps/web/src/app/api/images/[id]/metadata/route.ts`, `apps/web/src/app/api/images/[id]/placeholder/route.ts`, `apps/web/src/app/api/images/[id]/download-original/route.ts`, `apps/web/src/app/api/images/[id]/download-original-public/route.ts`, `apps/web/src/app/api/images/[id]/record-view/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/ready/route.ts`, `apps/web/src/app/api/admin/backfill-color-pipeline/route.ts`, `apps/web/src/app/api/admin/maintenance/restore-mode/route.ts`
- DB/data access: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search.ts`, `apps/web/src/lib/tags.ts`, `apps/web/src/lib/db-health.ts`, `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, migrations and Drizzle metadata
- Image processing and queues: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/image-processing-config.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`
- CLIP/search: `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-embedding-constants.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, semantic/similar API routes, embedding tests
- Service worker: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, service-worker contract tests
- Frontend hot paths: home/gallery load-more, search, map, timeline, upload/dropzone, image manager, theme and nav components
- Build/deploy: root `package.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`
- Performance contract tests: semantic scan limit tests, timeline SQL tests, service-worker template tests, map thumbnail tests, touch-target and restore-mode tests, image-queue/backfill tests

## Findings

### PERF-C4-01 - Timeline and on-this-day queries are still non-sargable on every public render

Severity: Medium  
Confidence: High  
Status: confirmed

Code regions:
- `apps/web/src/lib/data-timeline.ts:97-116`
- `apps/web/src/lib/data-timeline.ts:129-141`
- `apps/web/src/lib/data-timeline.ts:186-207`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:8-82`
- `apps/web/src/app/[locale]/(public)/timeline/year/[year]/page.tsx:15-87`
- `apps/web/src/components/on-this-day-widget.tsx:14-23`
- `apps/web/src/db/schema.ts:111-117`
- `apps/web/src/__tests__/data-timeline.test.ts:49-102`

Problem:
`getOnThisDayImages`, `getTimelineYears`, and `getTimelineImages` filter or group with `MONTH(capture_date)`, `DAY(capture_date)`, and `YEAR(capture_date)`. Those function predicates prevent normal use of the existing `processed_capture_date_idx`, so MySQL must examine processed rows and apply date functions before grouping, ordering, or limiting. The public timeline pages are dynamic (`revalidate = 0`) and the home on-this-day widget also invokes this path during rendering, so the cost is paid on request rather than amortized by static generation.

Concrete failure scenario:
With a large photo library, a crawler or normal public traffic hitting `/timeline`, `/timeline/year/:year`, and the home page repeatedly forces table/range scans over processed images. The index on `(processed, capture_date)` cannot be used as a tight range for `YEAR()`/`MONTH()`/`DAY()` expressions, so DB CPU and buffer-pool pressure rise with library size instead of page size.

Concrete fix:
Add sargable date access paths and move the query shape to them. Options:
- Add generated columns such as `capture_year`, `capture_month`, and `capture_day` with indexes for timeline and on-this-day lookups.
- Or rewrite year/month pages to use range predicates (`capture_date >= start AND capture_date < nextStart`) and reserve generated columns for month/day anniversary lookup.
- Update `data-timeline.test.ts`, which currently locks the non-sargable SQL shape, so tests enforce the new range/generated-column contract instead of preserving the current bottleneck.

### PERF-C4-02 - Public map still loads and renders up to 10,000 markers without a map/GPS access path

Severity: Medium  
Confidence: High  
Status: confirmed

Code regions:
- `apps/web/src/lib/data.ts:1624-1660`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:8-49`
- `apps/web/src/components/map/map-client.tsx:76-93`
- `apps/web/src/components/map/map-client.tsx:119-143`
- `apps/web/src/db/schema.ts:4-12`
- `apps/web/src/db/schema.ts:43-44`
- `apps/web/src/db/schema.ts:111-117`

Problem:
`getMapImages` joins `images` to `topics`, filters for processed images with non-null latitude/longitude and `topics.map_visible = true`, orders by capture/created/id, and returns up to `MAP_MAX_MARKERS = 10000`. The schema has indexes for processed capture date, processed created date, topic, filename, and uploader, but no index that starts with the map/GPS predicates and no topic index for `map_visible`. The server then serializes every marker into the initial map page, and the client computes bounds and renders one Leaflet `<Marker>` per row.

Concrete failure scenario:
On a library with thousands of geotagged public photos, loading `/map` performs a broad DB scan/sort, sends a large marker payload during SSR, and mounts thousands of marker components on the main thread. Mid-range phones can stall while parsing the payload, fitting bounds, and creating marker DOM/Leaflet state; the DB also pays the same broad query on every dynamic request.

Concrete fix:
Add a DB access path and reduce initial client work:
- Add an index suitable for map discovery, for example a composite beginning with `processed` and GPS presence/order fields, plus a topic-side index for `map_visible`, or denormalize public map visibility onto image rows if the join remains the limiting predicate.
- Replace the all-markers initial render with viewport/bounds-based fetching or clustering, keeping a hard cap per tile/bounds request.
- Keep the already-fixed sized thumbnail payload contract; the remaining issue is query shape and marker cardinality, not thumbnail URL selection.

### PERF-C4-03 - Production CLIP embedding work escapes the image queue's backpressure

Severity: Medium  
Confidence: High  
Status: confirmed

Code regions:
- `apps/web/src/lib/image-queue.ts:204-212`
- `apps/web/src/lib/image-queue.ts:305-569`
- `apps/web/src/lib/image-queue.ts:512-567`
- `apps/web/src/lib/clip-model.ts:151-199`

Problem:
Image processing is protected by a `PQueue` whose default concurrency is one. After a job finishes derivative generation and DB updates, CLIP embedding is launched in a detached async IIFE. In production mode that detached task calls `embedImageReal`, which performs Sharp resize/raw-pixel extraction, JavaScript `Float32Array` allocation/fill, and model inference. Because the embedding task is not part of the queue, burst uploads can complete the queued image phase and then start many CPU/memory-heavy embedding tasks concurrently outside the queue's backpressure and shutdown accounting.

Concrete failure scenario:
An admin uploads a large batch of images while semantic search is enabled. The queue processes images one at a time, but every completed job starts an independent embedding task. Several 512x512 raw pixel conversions and model invocations can overlap, competing with Sharp derivative generation and Next.js request handling. On the single production web host, this can cause CPU saturation, heap pressure, slower uploads, and delayed public responses. During process shutdown, detached embedding tasks may also be abandoned after the image job has already been marked complete.

Concrete fix:
Move embedding into a bounded execution path:
- Add a dedicated embedding queue with explicit concurrency, metrics, and drain/shutdown behavior.
- Or enqueue durable embedding jobs in the DB and process them with a controlled worker/backfill path.
- If embeddings must stay inline, await them inside the existing queue after derivative generation so the configured queue concurrency remains the real upper bound.

### PERF-C4-04 - Semantic and similar search scan/rank embeddings synchronously on the API path

Severity: Medium  
Confidence: Medium  
Status: likely

Code regions:
- `apps/web/src/app/api/search/semantic/route.ts:240-281`
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`
- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/lib/clip-embeddings.ts:164-168`
- `apps/web/src/db/schema.ts:282-285`
- `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`
- `apps/web/src/__tests__/clip-semantic-limits-env.test.ts:77-84`

Problem:
The semantic and similar routes select up to `SEMANTIC_SCAN_LIMIT` embeddings for the active model, decode every vector in the request handler, score every row, then sort all positive matches before slicing to the requested top K. The default scan limit is 2,000, but the environment parser allows up to 1,000,000. The only embedding index is `(modelVersion, updatedAt)`, which helps bounded recency scans but does not solve CPU cost or nearest-neighbor search. Tests ensure the limit exists, but they do not lock a latency budget, memory budget, or top-K algorithm.

Concrete failure scenario:
If an operator raises `SEMANTIC_SCAN_LIMIT` to improve recall, each semantic request can decode and compare tens or hundreds of thousands of vectors on the Next.js API worker. Concurrent searches then consume CPU and heap on the same process serving public pages. The full positive-match sort adds avoidable `O(n log n)` work even though only a small top K is returned.

Concrete fix:
Constrain request-path work and move toward an indexed/vector search design:
- Lower the hard maximum for `SEMANTIC_SCAN_LIMIT` or require an explicit unsafe override for large values.
- Replace full sorting with a bounded min-heap top-K implementation.
- Add timing and scanned-row metrics, and reject or degrade gracefully when the scan exceeds a latency budget.
- For larger libraries, move CLIP similarity to a vector index/ANN service or precomputed candidate table rather than scanning vectors in a public API route.

### PERF-C4-05 - Cursor smart-collection pagination computes a total count that callers discard

Severity: Low  
Confidence: High  
Status: confirmed

Code regions:
- `apps/web/src/lib/data.ts:1388-1428`
- `apps/web/src/app/actions/public.ts:161-225`

Problem:
`getImagesForSmartCollection` always selects `COUNT(*) OVER()` as `total_count`. The code comment explicitly notes that cursor pagination callers discard `total`, but the shared query shape keeps the window count. `loadMoreSmartCollectionImages` uses cursor pagination and returns only `images` plus `hasMore`, so the database computes a full matching-row count for a value that is ignored on the load-more path.

Concrete failure scenario:
For a broad public smart collection, every infinite-scroll page performs extra window-count work over the matching collection. Under normal browsing this turns cheap keyset pagination into a heavier query, increasing DB CPU and response time exactly on repeated load-more requests.

Concrete fix:
Split the query shape:
- Keep `COUNT(*) OVER()` for initial pages or admin views that need a total.
- Use a cursor-only select for `loadMoreSmartCollectionImages`, fetching `limit + 1` rows to derive `hasMore` without computing `total_count`.
- Add a test that asserts the cursor path does not include `COUNT(*) OVER()`.

### PERF-C4-06 - Color-pipeline backfill discovery filters on unindexed `pipeline_version`

Severity: Low  
Confidence: Medium  
Status: confirmed

Code regions:
- `apps/web/src/lib/admin-backfill-runner.ts:370-410`
- `apps/web/scripts/backfill-color-pipeline.ts:326-332`
- `apps/web/src/db/schema.ts:73-77`
- `apps/web/src/db/schema.ts:111-117`
- `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts`

Problem:
The admin color-pipeline backfill first counts and then batches images where `processed = TRUE` and `(pipeline_version IS NULL OR pipeline_version < IMAGE_PIPELINE_VERSION)`. The schema has `pipeline_version`, but no index that includes it. The batch query can use the primary key cursor for `id > cursor`, but the count and candidate filtering still require scanning processed image rows to find stale pipeline versions.

Concrete failure scenario:
After a pipeline-version bump on a large processed library, an admin starts the backfill. Before any useful batch work starts, the progress count scans the processed image set. Each batch also evaluates an unindexed version predicate. On the single web host this competes with normal gallery traffic and can make the maintenance operation feel stuck or overload the DB.

Concrete fix:
Add a candidate index such as `(processed, pipeline_version, id)` if version backfills are expected to remain an admin workflow. If avoiding another index is preferred, remove the eager total count and drive progress from completed batches, with a documented approximate progress mode.

## Missed-Issues Sweep

I rechecked the main hot paths after drafting the findings:
- Service worker cache code has bounded metadata walks, lazy revalidation, byte caps, and contract tests; no new service-worker finding.
- Image upload streams to disk before metadata extraction and Sharp concurrency/cache are explicitly bounded; no new core image-processing finding beyond detached CLIP work.
- Public load-more and search actions cap limits, rate-limit public mutation/search paths, and use stale-request guards on the client; no new UI responsiveness finding beyond map marker cardinality.
- OG and image-serving routes have cache validators, streaming, and HEAD handling; no new route-level performance finding.
- Docker/deploy scripts use a multi-stage standalone build and post-deploy prune policy; no build/deploy performance finding.
- Recent cycle-3 fixes appear to have addressed restore-mode metadata write suppression, map thumbnail sizing, service-worker generation stamping, and semantic constants client-safety; I did not refile those resolved issues.

## Skipped Files Statement

No performance-relevant application, route, queue, image-processing, CLIP/search, service-worker, deploy, schema, migration, or performance-contract test surface identified by the inventory was intentionally skipped. I did not review unrelated committed review/plan history exhaustively beyond stale-duplicate checks, and I did not inspect binary/image assets because they do not affect executable performance behavior in current HEAD.

## Validation

This was a static deep review. I did not run lint, typecheck, tests, build, or deployment because the task requested review of current HEAD and no application-code changes. Evidence is based on direct source inspection of the files and line regions listed above.
