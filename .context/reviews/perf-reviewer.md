# Performance Review - review-plan-fix cycle 1/100, prompt 1

Date: 2026-06-29

Role: perf-reviewer subagent

Scope: repository-wide performance review of the Next.js gallery app from DB query efficiency, concurrency, CPU/memory, image processing, background jobs, cache behavior, and UI responsiveness angles. This is a report-only pass; no source files were changed.

## Inventory

Relevant runtime surfaces inventoried before findings:

- App data/query layer: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/drizzle/*.sql`.
- Public routes and server actions: `apps/web/src/app/[locale]/(public)/**/page.tsx`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/**/route.ts`.
- Image pipeline and queues: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, selected backfill scripts.
- Upload/search/map UI: `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/on-this-day-widget.tsx`, `apps/web/src/components/map/**`.
- Project docs and constraints: `AGENTS.md`, `CLAUDE.md`.

Areas intentionally treated as irrelevant to this performance prompt after inventory: tests, locale strings, pure CSS/theme files, auth-only lint rules, and docs without runtime behavior.

## Findings

### PERF-01 - Timeline and on-this-day queries are non-sargable on dynamic public pages

Severity: Medium

Confidence: High

Status: Confirmed code path; likely production impact as the archive grows.

Locations:

- `apps/web/src/lib/data-timeline.ts:95-114` filters on `MONTH(images.capture_date)` and `DAY(images.capture_date)` for the home-page on-this-day widget.
- `apps/web/src/lib/data-timeline.ts:127-143` computes and orders distinct `YEAR(images.capture_date)` for timeline years.
- `apps/web/src/lib/data-timeline.ts:176-205` explicitly notes `YEAR(capture_date)` is not sargable, then uses `YEAR(...)` and optional `MONTH(...)` in the timeline image query.
- `apps/web/src/components/on-this-day-widget.tsx:14-23` runs `getOnThisDayImages()` during the home SSR pass.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:14` disables route revalidation; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:40-60` runs `getTimelineYears()` and `getTimelineImages()`.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:15` disables route revalidation; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:56-65` runs year-in-review data loading.

Failure scenario:

On every dynamic render of the home, timeline, or year page, MySQL must evaluate date functions against candidate rows instead of using a tight range on `capture_date`. The existing `idx_images_processed_capture_date_created_at` index still helps with `processed`, but the date-function predicates force much broader scanning, grouping, and tag aggregation than necessary. Crawlers or repeated public traffic against `/`, `/timeline`, and `/year/:year` can turn archive size directly into DB CPU and response-time cost.

Concrete fix:

- Rewrite year/month timeline queries to sargable date ranges:
  - year: `capture_date >= '${year}-01-01' AND capture_date < '${year + 1}-01-01'`
  - month: range between the first day of the month and first day of the next month.
- For on-this-day, either add stored/generated columns such as `capture_month` and `capture_day` with a composite index like `(processed, capture_month, capture_day, capture_date, created_at, id)`, or maintain a small materialized/cache table for daily anniversaries.
- Update the stale comment at `apps/web/src/lib/data-timeline.ts:92-93`, which currently suggests `MONTH()+DAY()` stays efficient.

### PERF-02 - The map page loads up to 10,000 unclustered markers without a map/GPS index

Severity: Medium

Confidence: High

Status: Confirmed code path; likely user-visible stalls for GPS-heavy archives.

Locations:

- `apps/web/src/lib/data.ts:1624-1661` sets `MAP_MAX_MARKERS = 10000` and selects all processed rows with non-null latitude/longitude in map-visible topics.
- `apps/web/src/db/schema.ts:111-117` defines image indexes, but none cover latitude, longitude, or the map query shape.
- `apps/web/src/db/schema.ts:11` defines `topics.map_visible`; `apps/web/drizzle/0005_topics_map_visible.sql:6` adds it without an index.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:9` disables revalidation; `apps/web/src/app/[locale]/(public)/map/page.tsx:30-63` loads and serializes all markers for the page.
- `apps/web/src/components/map/map-client.tsx:86-90` builds bounds arrays from every marker.
- `apps/web/src/components/map/map-client.tsx:119-143` renders one React Leaflet `<Marker>` per marker.

Failure scenario:

A gallery with many geotagged images makes each `/map` request scan a broad portion of `images`, join `topics`, sort by capture date, serialize up to 10,000 markers, hydrate them in the browser, compute bounds arrays, and mount thousands of Leaflet markers. On mobile this can freeze the UI; on the server it adds DB and JSON serialization cost to a fully dynamic page.

Concrete fix:

- Add an index that supports the server filter/order, for example `images(processed, latitude, longitude, capture_date, created_at, id)` or a better plan after `EXPLAIN`; if `map_visible` remains in `topics`, also index `topics(map_visible, slug)` or denormalize the public map visibility onto `images`.
- Replace the initial all-marker payload with viewport/bounds loading or server-side clustering.
- Use marker clustering or a canvas/WebGL marker layer for large result sets.
- Lower the initial cap until clustering or viewport paging exists.

### PERF-03 - Production CLIP image embeddings bypass image-queue backpressure

Severity: Medium

Confidence: High

Status: Confirmed concurrency risk.

Locations:

- `apps/web/src/lib/image-queue.ts:212` creates the main `PQueue` with default concurrency `1`.
- `apps/web/src/lib/image-queue.ts:414-449` awaits Sharp derivative generation and processed-state DB updates inside that queue.
- `apps/web/src/lib/image-queue.ts:512-567` starts production CLIP image embedding in a detached async IIFE after processing succeeds.
- `apps/web/src/lib/image-queue.ts:569` returns from the queued job while the detached embedding can still be running.
- `apps/web/src/lib/clip-model.ts:151-186` decodes/resizes the original image with Sharp, allocates a `Float32Array(3 * 512 * 512)`, and runs model inference.
- `apps/web/src/app/actions/images.ts:466-502` enqueues processing for uploaded images; `apps/web/src/components/upload-dropzone.tsx:263-271` uploads files sequentially on the client but still allows many images in a batch.

Failure scenario:

`QUEUE_CONCURRENCY=1` limits Sharp derivative generation, but it does not limit the detached production embedding work. A batch upload can finish each queued image-processing task, then leave multiple CLIP embedding jobs running concurrently in the background. Those jobs perform image decode/resize, allocate per-image tensors, and run model inference while the queue continues to process later images. Under production semantic mode this can create CPU and memory spikes that contend with Sharp, MySQL, and live search requests.

Concrete fix:

- Put image embeddings behind their own bounded queue, for example `embeddingQueue = new PQueue({ concurrency: Number(process.env.EMBEDDING_CONCURRENCY) || 1 })`.
- Alternatively, await production embedding inside the existing processing queue when semantic search must be ready immediately.
- Add basic metrics/logging for pending embedding count and embedding duration.
- Apply the same backpressure design to future caption generation if it becomes CPU-heavy.

### PERF-04 - Smart-collection cursor pages still pay a full window count

Severity: Low

Confidence: Medium

Status: Confirmed query shape; impact depends on collection complexity and archive size.

Locations:

- `apps/web/src/lib/data.ts:1388-1430` builds `getImagesForSmartCollection()` with `total_count: sql<number>\`COUNT(*) OVER()\`` in the select list for every call.
- `apps/web/src/lib/data.ts:1400-1402` documents that cursor pages kept the count to avoid a separate select shape.
- `apps/web/src/app/actions/public.ts:161-213` calls `getImagesForSmartCollection()` from the load-more server action for cursor pagination.
- `apps/web/src/components/load-more.tsx:48-50` sends a cursor after the first page.

Failure scenario:

The initial smart-collection page needs a total count for UI metadata, but cursor-based load-more pages only need rows plus a lookahead. Because `COUNT(*) OVER()` remains in the cursor query, every load-more request can force MySQL to count the entire matching smart collection while also doing the tag join/grouping and dynamic collection predicate work. Large collections with text/tag predicates will feel slower as the user scrolls.

Concrete fix:

- Split the query shape:
  - first page: include `COUNT(*) OVER()` or a separate count if the UI needs total rows.
  - cursor pages: remove `COUNT(*) OVER()` and use only `LIMIT + 1` lookahead for `hasMore`.
- Keep the same `mapImageWithCursor()` output by returning `totalCount: null` or the previous known count for cursor pages.

### PERF-05 - Admin backfill candidate discovery scans `pipeline_version` without an index

Severity: Low

Confidence: Medium

Status: Likely maintenance-path inefficiency.

Locations:

- `apps/web/src/lib/admin-backfill-runner.ts:370-379` counts stale processed images with `(pipeline_version IS NULL OR pipeline_version < current)`.
- `apps/web/src/lib/admin-backfill-runner.ts:381-410` batches candidates with the same stale-version predicate plus `id > cursor`.
- `apps/web/src/db/schema.ts:111-117` has no `pipeline_version` index.

Failure scenario:

Admin-triggered color-pipeline backfills are intentionally bounded by DB pool and worker concurrency, but candidate discovery can still scan the image table each time the admin UI starts or advances a run. With many current rows and few stale rows, the count and batch discovery cost is mostly wasted DB work.

Concrete fix:

- Add a supporting index such as `(processed, pipeline_version, id)` if backfill status checks are expected in production.
- If schema churn is not worth it, remove the eager full count and report progress from keyset batches only.

## Final sweep

Checked issue classes with no new blocking finding:

- Sharp derivative pipeline: `apps/web/src/lib/process-image.ts` already caps Sharp concurrency, disables Sharp cache, streams original uploads to disk, and cleans partial derivatives on failure.
- Main image queue: derivative generation remains bounded by `QUEUE_CONCURRENCY`; the unbounded work identified above is specifically the detached CLIP path.
- Semantic text/similar search APIs: both scan `SEMANTIC_SCAN_LIMIT` embeddings and enrich only the top results. The default limit is bounded, though an overly high environment value could still make requests CPU-heavy.
- Upload UI: client upload is sequential, preventing browser-side upload fan-out.
- Search UI: debouncing and stale-request guards are present.
- Infinite scroll: cursor pagination and intersection guards are present for normal galleries.
- DB pool: MySQL pool has a fixed connection limit and queue limit; backfill concurrency is clamped against that budget.
- Cache behavior: public pages intentionally use dynamic freshness (`revalidate = 0`), so the main remaining risks are query shape and payload size rather than stale-cache correctness.

Skipped as irrelevant after inventory:

- Unit tests, lint rules, translation files, static docs, and CSS-only styling files.
- Deployment scripts except where docs described production image-processing/backfill behavior.

Validation evidence: line-numbered source inspection and cross-file tracing only; no tests were run because this prompt requested a read-only review artifact.
