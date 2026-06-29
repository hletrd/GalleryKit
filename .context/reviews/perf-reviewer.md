# Performance Review - review-plan-fix cycle 2

Date: 2026-06-29

Role: perf-reviewer

Scope: repository-wide performance, concurrency, CPU/memory, data-access, queueing, and UI responsiveness review at HEAD `3d138704`. Report-only pass; no application source was edited.

## Inventory Coverage

Built inventory before reviewing:

- Current HEAD/worktree/package metadata: `git status`, `git log -20`, root `package.json`, `apps/web/package.json`, `next.config.ts`, TypeScript/Vitest/Playwright/ESLint config.
- Runtime source tree: 539 review-relevant files under `apps/web/src/app` (74), `apps/web/src/components` (55), `apps/web/src/lib` (93), `apps/web/src/db` (3), `apps/web/src/__tests__` (251), `apps/web/scripts`, `apps/web/e2e`, and `apps/web/drizzle`.
- Database/migrations: all 25 committed Drizzle SQL migrations, `schema.ts`, `migrate.js`, journal metadata, index coverage.
- Current review/plan context: top-level `.context/reviews/*`, latest run/cycle review docs, `.context/plans/README.md`, and current scheduled/deferred plan context.
- High-risk read paths: listing/timeline/map/share/search/photo pages, public actions, semantic/similar routes, admin dashboard/backfill actions, image queue, Sharp pipeline, CLIP inference, backfill scripts, rate-limit maps, upload tracker, and service/deploy config.

## Findings

### PERF-01 - Timeline and on-this-day queries are non-sargable on dynamic public pages

Severity: Medium
Confidence: High
Status: Confirmed issue

Locations:

- `apps/web/src/lib/data-timeline.ts:95-114` filters on `MONTH(capture_date)` and `DAY(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:127-143` computes and orders `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:176-205` documents the non-sargable `YEAR()`/`MONTH()` path, then uses it.
- `apps/web/src/components/on-this-day-widget.tsx:14-23` runs the anniversary query in the home SSR pass.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:14,40-60` and `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:15,56-65` force dynamic rendering and run these queries.

Failure scenario: as the archive grows, public home/timeline/year requests make MySQL evaluate date functions across the processed-image candidate set instead of doing tight range seeks on `idx_images_processed_capture_date`. Repeated crawler or visitor hits turn archive size into DB CPU and response latency.

Suggested fix: rewrite year/month queries to range predicates such as `capture_date >= 'YYYY-01-01' AND capture_date < 'YYYY+1-01-01'`; for on-this-day, add generated `capture_month`/`capture_day` columns with an index like `(processed, capture_month, capture_day, capture_date, created_at, id)` or maintain a small anniversary cache/materialized table.

### PERF-02 - Map loads up to 10,000 unclustered markers without map/GPS index support

Severity: Medium
Confidence: High
Status: Confirmed issue

Locations:

- `apps/web/src/lib/data.ts:1624-1661` caps `/map` at 10,000 rows but still selects all processed map-visible GPS rows.
- `apps/web/src/db/schema.ts:111-117` has image indexes, but none cover latitude/longitude or this map query shape; `topics.map_visible` at `schema.ts:11` is also unindexed.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:9,30-63` is dynamic and serializes all markers into the page.
- `apps/web/src/components/map/map-client.tsx:86-90,119-143` maps all markers to bounds arrays and one React Leaflet `<Marker>` each.

Failure scenario: a GPS-heavy gallery makes each `/map` request scan/sort many image rows, serialize thousands of markers, hydrate them, compute bounds over all points, and mount thousands of Leaflet markers. Mobile browsers can freeze; the server also pays avoidable DB and JSON cost.

Suggested fix: add an index validated with `EXPLAIN` for the server query, e.g. `(processed, latitude, longitude, capture_date, created_at, id)` or denormalize/index map visibility. Move to viewport/bounds loading or server-side clustering, and use marker clustering/canvas/WebGL rendering before allowing a 10k initial payload.

### PERF-03 - Production CLIP image embeddings bypass image-queue backpressure

Severity: Medium
Confidence: High
Status: Confirmed concurrency risk

Locations:

- `apps/web/src/lib/image-queue.ts:212` bounds the main processing `PQueue`.
- `apps/web/src/lib/image-queue.ts:414-449` awaits Sharp derivative generation inside that queue.
- `apps/web/src/lib/image-queue.ts:512-567` starts CLIP embedding in a detached async IIFE after the job commits.
- `apps/web/src/lib/image-queue.ts:569` logs completion while embedding work can still be running.
- `apps/web/src/lib/clip-model.ts:151-186` decodes/resizes an original image, allocates a 3x512x512 float tensor, and runs the model.

Failure scenario: `QUEUE_CONCURRENCY=1` prevents multiple Sharp jobs, but each completed job can leave a production embedding task running while the next queued image starts. A batch upload under production semantic mode can stack CPU-heavy inference and Sharp work, increasing RSS and slowing live requests/search on the single Node process.

Suggested fix: route embeddings through a separate bounded queue such as `EMBEDDING_CONCURRENCY=1`, or await production embedding inside the existing queue if immediate search availability matters. Add queue depth/duration logging so operators can see backlog and tune it.

### PERF-04 - Semantic search scans and ranks embeddings synchronously on the Node request path

Severity: Medium
Confidence: Medium
Status: Risk; bounded by defaults, relevant because production semantic search is documented as live

Locations:

- `apps/web/src/app/api/search/semantic/route.ts:240-281` reads up to `SEMANTIC_SCAN_LIMIT` embeddings and synchronously decodes/scores them in JS.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170` does the same for image-to-image search.
- `apps/web/src/lib/clip-embeddings.ts:39-40` lets env raise `SEMANTIC_SCAN_LIMIT`; `clip-embeddings.ts:32-37` clamps only at `1_000_000`.
- `apps/web/src/lib/clip-embeddings.ts:160-164` filters and sorts the full scored list before slicing top-K.

Failure scenario: defaults keep the scan to 2,000 rows, but the code permits much higher operator overrides. Each public semantic/similar request can then run a large synchronous vector loop and full sort on the event loop after a DB blob read. Under concurrent traffic this can delay unrelated HTTP handling, queue timers, and admin interactions.

Suggested fix: keep a stricter production ceiling, use a fixed-size min-heap/selection algorithm instead of sorting every match, and move scan/scoring to a worker thread or vector index before increasing the scan window. Add latency metrics around DB scan, decode/score, and top-K.

### PERF-05 - Smart-collection cursor pages still pay a full window count

Severity: Low
Confidence: Medium
Status: Confirmed issue

Locations:

- `apps/web/src/lib/data.ts:1388-1430` includes `COUNT(*) OVER()` for every `getImagesForSmartCollection()` call.
- `apps/web/src/lib/data.ts:1399-1402` notes cursor pages keep the count even though callers discard it.
- `apps/web/src/app/actions/public.ts:161-213` invokes that helper for load-more cursor pagination.
- `apps/web/src/components/load-more.tsx:48-64` sends a cursor after the first page.

Failure scenario: first-page smart collections may need total count metadata, but cursor load-more pages only need rows plus lookahead. Keeping `COUNT(*) OVER()` forces MySQL to count the full matching collection on each scroll page, adding cost to dynamic predicates and tag joins.

Suggested fix: split first-page and cursor-page query shapes. Keep count on the initial page; remove `COUNT(*) OVER()` for cursor pages and rely on `LIMIT + 1` lookahead for `hasMore`.

### PERF-06 - Backfill candidate discovery scans `pipeline_version` without an index

Severity: Low
Confidence: Medium
Status: Likely maintenance-path inefficiency

Locations:

- `apps/web/src/lib/admin-backfill-runner.ts:370-379` counts stale processed images with `(pipeline_version IS NULL OR pipeline_version < current)`.
- `apps/web/src/lib/admin-backfill-runner.ts:387-410` batches with the same stale-version predicate.
- `apps/web/src/db/schema.ts:111-117` does not index `pipeline_version`.

Failure scenario: color-pipeline backfills are bounded once processing starts, but candidate count/batch discovery can scan the image table when most rows are current and only a few are stale. This is admin-only, but it competes with live traffic on the shared MySQL pool.

Suggested fix: add `(processed, pipeline_version, id)` if backfill checks are expected in production, or remove the eager count and report progress from keyset batches.

## Missed-Issues Sweep

Checked and did not file new findings for:

- Sharp derivative pipeline: global Sharp concurrency is capped, cache is disabled, inputs use path-based decode, partial variants are cleaned, and fan-out is explicit.
- Queue bootstrap/retry maps: retry/permanent-failure sets are bounded and pruned; MySQL advisory locks fence duplicate processing.
- Public semantic routes: rate limiting, same-origin checks, body-size guards, model-version partitioning, and scan-limit source tests are present. The residual concern is synchronous CPU work and high env ceiling, not absence of a cap.
- Upload UI/actions: browser uploads are sequential client-side; upload tracker is bounded and claim rollback is present on known early-return/throw paths.
- Search UI/load-more: debouncing, stale-response guards, cursor pagination, and per-IP rate limits are present.
- DB pool/backfill: pool and queue limits exist; in-app color backfill clamps concurrency against pool budget.
- Sync filesystem I/O: sync I/O is confined to scripts/build tooling, not request-path app code found under `src`.

Validation evidence: static, line-numbered source and current review/plan inspection only. I did not run lint/typecheck/tests because this was a review artifact task and no application code changed.
