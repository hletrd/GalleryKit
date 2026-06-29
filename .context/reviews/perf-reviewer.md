# Performance Review - Cycle 3

Date: 2026-06-29
Reviewer: perf-reviewer
Scope: current HEAD only (`3f24038b build(sw): 🔨 update cycle 2 service worker stamp`)
Mode: static review, no code changes outside this report

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Coverage:
- Runtime and test inventory under `apps/web/src`: 472 TS/TSX/JS files (`app` 75, `components` 55, `lib` 93, `db` 3, `__tests__` 246).
- Inspected app route surfaces, public actions, major data-access helpers, schema/index declarations, image processing/backfill paths, CLIP embedding/search paths, map UI, service worker cache logic, scripts, migrations, e2e/test fixtures, deploy notes, and current diff since the prior perf report.
- Reviewed `.context/reviews/` and `.context/plans/` history to avoid re-filing stale fixed claims. Known/deferred admin analytics index risks remain documented in prior cycles and are not re-filed here without new evidence.

## Findings

### PERF-01 - Timeline and On-This-Day queries remain non-sargable on every dynamic public render

Severity: Medium
Confidence: High
Risk status: Confirmed

Evidence:
- `apps/web/src/lib/data-timeline.ts:95-114` filters On This Day with `MONTH(capture_date)` and `DAY(capture_date)`, then groups and orders before `LIMIT 6`.
- `apps/web/src/lib/data-timeline.ts:127-139` computes the year scrubber with `YEAR(capture_date)` in both `SELECT DISTINCT` and `ORDER BY`.
- `apps/web/src/lib/data-timeline.ts:184-205` filters timeline photos with `YEAR(capture_date) = ?` and optional `MONTH(capture_date) = ?`; the local comment at `176-182` correctly notes this is not sargable beyond the `processed` index prefix.
- `apps/web/src/components/on-this-day-widget.tsx:14-23` calls the helper during the home-page SSR pass.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:14` is dynamic (`revalidate = 0`) and calls `getTimelineYears()` plus `getTimelineImages()` at `60-82`.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:15` is dynamic and calls `getYearInReviewImages()` at `78-87`, which delegates to `getTimelineImages()` at `apps/web/src/lib/data-timeline.ts:233-235`.

Failure scenario:
As processed image count grows, every home/timeline/year render must scan the processed portion of `images` and evaluate date functions row-by-row. The `TIMELINE_PAGE_LIMIT + 1` cap limits returned rows, not rows examined or grouped, so load rises with total archive size and can make public pages CPU/DB-bound during crawler or audience bursts.

Concrete fix:
Replace `YEAR()` timeline filtering with half-open range predicates (`capture_date >= '${year}-01-01' AND capture_date < '${year + 1}-01-01'`) so `idx_images_processed_capture_date` can seek. For On This Day and distinct years, add generated persisted columns such as `capture_month`, `capture_day`, and `capture_year` with covering indexes, or maintain a small materialized summary/cache invalidated by upload/backfill.

### PERF-02 - Public map still loads up to 10k unclustered markers without a GPS/map index

Severity: Medium
Confidence: High
Risk status: Confirmed

Evidence:
- `apps/web/src/app/[locale]/(public)/map/page.tsx:8-9` forces dynamic rendering and `26-35` runs `getMapImages()` for every request.
- `apps/web/src/lib/data.ts:1624-1660` caps results at 10,000 but still filters `processed`, `topics.map_visible`, `latitude IS NOT NULL`, and `longitude IS NOT NULL`, then orders by capture date.
- `apps/web/src/db/schema.ts:4-12` has `topics.map_visible` but no supporting index.
- `apps/web/src/db/schema.ts:43-44` defines `images.latitude` and `images.longitude`; the image indexes at `111-117` do not include GPS fields or a map-oriented covering index.
- `apps/web/src/components/map/map-client.tsx:76-93` maps all marker coordinates to compute bounds, and `119-143` renders one Leaflet `<Marker>` per marker.

Failure scenario:
A map-visible topic with thousands of GPS-tagged images forces the DB to examine/filter rows without a GPS index, serializes a large marker payload, and then asks the browser to mount thousands of Leaflet marker instances. The query is bounded, but the bound is high enough to cause slow SSR, large JS hydration payloads, and main-thread jank on mobile.

Concrete fix:
Add a map-specific access path, for example an index over `images(processed, latitude, longitude, capture_date, created_at, id)` and an index over `topics(map_visible, slug)`, or denormalize a map-visible flag if the join remains costly. On the UI path, switch to viewport/bounds-based marker loading plus clustering or server-side tile/cluster aggregation; keep the existing 10k cap as a final guard, not the primary scaling mechanism.

### PERF-03 - Production CLIP embedding work escapes queue backpressure after image processing completes

Severity: Medium
Confidence: High
Risk status: Confirmed concurrency risk

Evidence:
- `apps/web/src/lib/image-queue.ts:204-212` correctly bounds the main image-processing queue with `PQueue` concurrency.
- `apps/web/src/lib/image-queue.ts:512-567` starts embedding generation in a detached `void (async () => { ... })()` after the main job, so the queue marks the job complete at `569` before embedding CPU/model work is done.
- In production mode, the detached branch calls `embedImageReal(originalPath)` at `apps/web/src/lib/image-queue.ts:535-537`.
- `apps/web/src/lib/clip-model.ts:151-186` decodes/resizes with Sharp, builds a raw pixel buffer, fills a large `Float32Array` in JS, and invokes the model.

Failure scenario:
During bulk uploads or bootstrap recovery, the main queue may serialize image encoding, but each completed job can spawn a production embedding task that continues outside `QUEUE_CONCURRENCY`. With real CLIP enabled, CPU, memory, libvips workers, and model runtime work can pile up in parallel with subsequent image jobs. That can starve the web process, increase GC pressure, and create unpredictable tail latency even though the visible queue appears bounded.

Concrete fix:
Move embedding into a bounded queue with its own explicit concurrency, or keep it inside the existing job before completion when production mode is enabled. If detached behavior is required for upload latency, persist an embedding job record and drain it through a worker/queue with metrics for depth, active count, duration, failures, and model memory.

### PERF-04 - Semantic and similar search scan/rank embeddings synchronously on the API request path

Severity: Medium
Confidence: Medium
Risk status: Likely

Evidence:
- `apps/web/src/app/api/search/semantic/route.ts:240-249` selects up to `SEMANTIC_SCAN_LIMIT` embedding blobs for the active model on each query.
- `apps/web/src/app/api/search/semantic/route.ts:262-281` decodes and scores every scanned vector before calling `topK`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170` repeats the full scan/score path for similar-image requests.
- `apps/web/src/lib/clip-embeddings.ts:32-40` allows `SEMANTIC_SCAN_LIMIT` to be configured as high as 1,000,000, defaulting to 2,000.
- `apps/web/src/lib/clip-embeddings.ts:72-78` performs a JS dot-product loop over each 512-dimensional vector, `131-148` decodes each blob, and `160-164` filters then sorts the whole scored list.
- `apps/web/src/db/schema.ts:271-286` provides an index for the model/version recency scan, but not approximate nearest-neighbor or vector similarity search.

Failure scenario:
At the default cap, one request decodes and scores about 2,000 vectors on the Node request thread. If an operator raises `SEMANTIC_SCAN_LIMIT`, CPU and allocation scale linearly and `topK` sorts all matching scores. Concurrent public semantic/similar requests can monopolize the event loop and delay unrelated API/page work, especially while production text/image model inference is also active.

Concrete fix:
Keep a stricter production hard cap unless a real vector index/worker is in place. Replace whole-array sort with a fixed-size min-heap for top-K, and move scan/scoring to a worker thread or separate service. Longer term, use an ANN/vector index or DB-supported vector search and expose latency/scan-count metrics so operators cannot silently configure the route into event-loop saturation.

### PERF-05 - Smart-collection cursor pages still compute `COUNT(*) OVER()` even when callers discard the count

Severity: Low
Confidence: High
Risk status: Confirmed

Evidence:
- `apps/web/src/lib/data.ts:1388-1402` documents that the cursor path retains `COUNT(*) OVER()` even though callers discard `totalCount` on cursor pages.
- `apps/web/src/lib/data.ts:1411-1428` always selects `total_count: COUNT(*) OVER()` before deciding between cursor and offset pagination.
- `apps/web/src/app/actions/public.ts:161-213` passes cursor-based load-more requests into `getImagesForSmartCollection()` and only uses `images`/`hasMore`.
- `apps/web/src/components/load-more.tsx:41-50` sends the cursor after the first page.

Failure scenario:
Scrolling a public smart collection past the first page still forces MySQL to evaluate a window count over the matching collection predicate on every cursor page. For selective predicates this may be minor, but for broad public collections it wastes DB CPU and can defeat the latency benefit that keyset pagination was meant to provide.

Concrete fix:
Fork the select shape: retain `COUNT(*) OVER()` only for initial offset/page loads that display or need a total, and use a cursor-only query without the window column for load-more. Keep the existing `limit + 1` lookahead for `hasMore`.

### PERF-06 - Color-pipeline backfill discovery filters on unindexed `pipeline_version`

Severity: Low
Confidence: Medium
Risk status: Confirmed for manual/admin path

Evidence:
- `apps/web/src/lib/admin-backfill-runner.ts:370-379` counts candidates with `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < current)`.
- `apps/web/src/lib/admin-backfill-runner.ts:387-410` fetches each batch with the same predicate plus `id > cursor`.
- `apps/web/src/db/schema.ts:73-77` defines `was_downscaled` and `pipeline_version`, but the image indexes at `111-117` do not include `pipeline_version`.

Failure scenario:
On a large gallery after a pipeline version bump, the admin backfill has to discover stale rows by scanning processed images for an unindexed nullable/version predicate. The runner is batch-sized and manual, so blast radius is lower than a public route, but the initial count and every cursor batch can spend unnecessary DB time before the CPU-heavy encode work even starts.

Concrete fix:
Add a backfill-oriented index such as `(processed, pipeline_version, id)` if versioned backfills remain a recurring operation. If avoiding another index is preferred, drop the eager exact count and report progress from batches while keeping the advisory lock and batch memory bounds.

## Final Missed-Issues Sweep

- Current-HEAD diff since the prior perf report includes service-worker stamp/cache code, CLIP backfill script changes, public timeline/year rendering changes, admin metadata/page changes, Docker/README/test updates, and review/plan artifacts. No new performance finding emerged from those changes beyond the six live issues above.
- Service worker image cache logic remains byte-capped (`MAX_IMAGE_BYTES = 50 MB`) and HTML entries are capped (`MAX_HTML_ENTRIES = 50`); the synchronous cached-image HEAD probe is bounded at 300 ms.
- Sharp processing paths keep global concurrency/cache controls and per-run candidate batching; the main residual queueing problem is the detached CLIP embedding work filed as PERF-03.
- Client search/load-more paths have debounce, stale-result guards, rate limiting, and request caps; the main residual request-path CPU concern is the semantic/similar scan filed as PERF-04.
- Prior known admin analytics temp-table/index concerns are present in review/plan history as deferred admin-only work; I did not re-file them because there is no new current-HEAD regression or changed failure scenario.

## Validation Evidence

This was a static, whole-repo performance review against current HEAD with line-numbered source inspection and prior review/plan filtering. No application code was changed, and lint/typecheck/tests were not run because the deliverable is this review artifact only.
