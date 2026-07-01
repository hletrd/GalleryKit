# Cycle 96 Performance Review — `/tmp/gallery-recovery-check`

Review target: `2f22620c361304ba0408053f546f45e3c74ddfdb` (`master`).
Mode: review-only static inspection; no source edits, no live profiling, no build/test execution.

## Review-relevant inventory

I reviewed repo rules/context first (`AGENTS.md`, `CLAUDE.md`) and current review state in `.context/plans/README.md`, `.context/reviews/_aggregate.md`, `.context/plans/cycle-95-2026-07-01-deferred.md`, and `.context/reviews/cycle-95-2026-07-01/perf-architect.md`. Cycle 95 records no new source perf defects and preserves carry-forward perf/concurrency/schema findings (`.context/plans/cycle-95-2026-07-01-deferred.md:12-16`, `:55-74`; `.context/reviews/cycle-95-2026-07-01/perf-architect.md:9-17`).

Performance-sensitive source inventory covered:

- DB/query/data paths: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/sql-like.ts`, public page routes and search actions.
- Image processing/backfill/queue: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, CLIP backfill/search files.
- Concurrency/runtime: restore maintenance, advisory locks, queue shutdown, instrumentation, rate limits.
- UI responsiveness: gallery home/load-more, map, timeline, search, service worker/cache.
- Upload/deployment/runtime: upload serving, LR upload, nginx, Docker, deploy script.

## Confirmed findings

### C96-PERF-01 — Sidecar color backfill materializes and queues the full candidate set

- Severity: Medium
- Confidence: High
- Classification: Confirmed
- Evidence:
  - The sidecar selects every candidate row into memory with no batching/keyset limit: `apps/web/scripts/backfill-color-pipeline.ts:383-400`.
  - It creates a bounded `PQueue`, but only bounds execution concurrency: `apps/web/scripts/backfill-color-pipeline.ts:408-412`.
  - It still pushes every `queue.add(...)` promise into `queuedTasks` before awaiting all of them: `apps/web/scripts/backfill-color-pipeline.ts:525-562`.
  - The in-app admin runner has the intended O(batch) pattern for comparison: `apps/web/src/lib/admin-backfill-runner.ts:672-680`, `apps/web/src/lib/admin-backfill-runner.ts:731-811`.
- Problem: `BACKFILL_CONCURRENCY` limits active work, not memory residency. Large galleries or `--force-reencode` runs retain the full row list plus one queued closure/promise per image.
- Concrete failure scenario: An operator runs the sidecar on a 50k+ photo library after a pipeline bump. Node holds all candidate rows and pending promises while Sharp/libvips workers run, increasing RSS/GC pressure and risking host memory pressure during a maintenance operation.
- Suggested fix: Rework `backfill-color-pipeline.ts` to keyset-fetch bounded batches, enqueue one batch, `await queue.onIdle()`, flush, then advance the cursor. Mirror `admin-backfill-runner.ts`’s O(batch) loop.

### C96-PERF-02 — First public listing page still runs exact window counts through grouped tag joins

- Severity: Medium
- Confidence: High
- Classification: Confirmed carry-forward
- Evidence:
  - `getImagesLitePage` includes `COUNT(*) OVER()` while joining tags and grouping by image id: `apps/web/src/lib/data.ts:898-927`.
  - Smart collection initial/offset path does the same; only cursor load-more skips the count: `apps/web/src/lib/data.ts:1466-1517`.
  - Public entry points call these count-bearing first-page queries: home `apps/web/src/app/[locale]/(public)/page.tsx:175-177`, topic `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:185-187`, smart collection `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:110-111`.
  - The UI displays the count: `apps/web/src/components/home-client.tsx:267-269`.
  - A source test currently locks this query shape: `apps/web/src/__tests__/data-tag-names-sql.test.ts:107-117`.
- Problem: First page only needs visible rows plus `hasMore`, but the query asks MySQL for an exact total across grouped joins. That forces extra work on every dynamic first-page render.
- Concrete failure scenario: A topic/tag or smart collection with many matching photos requires MySQL to evaluate the grouped join and window count before returning 31 rows, delaying TTFB and consuming DB CPU under crawler or reload bursts.
- Suggested fix: Drop `COUNT(*) OVER()` from grouped listing hot paths and use limit+1 for `hasMore`. If exact counts remain a product requirement, use a separate lean count query or cached/rolled-up count that avoids tag-name aggregation and listing payload joins. Update the source-contract test accordingly.

### C96-PERF-03 — `image_embeddings` cannot stage multiple model versions per image

- Severity: Medium
- Confidence: High
- Classification: Confirmed carry-forward
- Evidence:
  - Drizzle schema uses `imageId` as the sole primary key: `apps/web/src/db/schema.ts:284-299`.
  - Physical migration creates `PRIMARY KEY (image_id)`: `apps/web/drizzle/0012_image_embeddings.sql:5-12`.
  - The model-version index helps scans but does not allow multiple versions: `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1-9`.
  - Writer upserts by that single PK and overwrites `embedding`/`modelVersion`: `apps/web/src/lib/image-queue.ts:352-390`.
  - Search routes filter by active/production model version: `apps/web/src/app/api/search/semantic/route.ts:270-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:135-144`.
- Problem: Upgrading or toggling CLIP model versions replaces the only row per image, so old and new vectors cannot coexist.
- Concrete failure scenario: A production model rollout partially backfills a new model. Because old rows are overwritten per image, rollback or A/B comparison requires a full re-backfill rather than switching the active model version.
- Suggested fix: Migrate to one row per `(image_id, model_version)` with composite primary/unique key, keep `(model_version, updated_at)` for scans, update queue/backfill upserts to write by pair, and keep routes filtering the active model.

### C96-PERF-04 — Restore maintenance still does not fence already-in-flight non-upload admin mutations

- Severity: High
- Confidence: High
- Classification: Confirmed carry-forward concurrency/runtime issue
- Evidence:
  - Restore begins durable maintenance after locks are acquired: `apps/web/src/app/[locale]/admin/db-actions.ts:449-452`.
  - Process-local and durable restore markers are entry-state checks, not transaction-scoped write barriers: `apps/web/src/lib/restore-maintenance.ts:21-31`, `apps/web/src/lib/restore-maintenance.ts:48-60`, `apps/web/src/lib/restore-maintenance-durable.ts:96-114`.
  - Representative non-upload actions check maintenance at entry, then perform later DB writes: settings `apps/web/src/app/actions/settings.ts:41-48`, `apps/web/src/app/actions/settings.ts:163-175`; tags `apps/web/src/app/actions/tags.ts:42-49`, `apps/web/src/app/actions/tags.ts:83-98`; topics `apps/web/src/app/actions/topics.ts:85-92`, `apps/web/src/app/actions/topics.ts:128-160`; sharing `apps/web/src/app/actions/sharing.ts:91-98`, `apps/web/src/app/actions/sharing.ts:139-147`.
- Problem: An action that passes the initial maintenance check can keep running while restore starts, then mutate application tables during or after restore import.
- Concrete failure scenario: An admin settings or tag update passes the precheck, restore begins, then the in-flight action commits against the restored database, producing mixed snapshot state and cache invalidations inconsistent with the backup.
- Suggested fix: Add a shared foreground admin-write barrier/advisory lock around all app-table mutations, or recheck durable restore maintenance immediately before transaction/write commit. Add tests for an action crossing the maintenance boundary.

## Likely issues

### C96-PERF-05 — Semantic/similar vector scans can monopolize CPU and memory when scan limits are raised

- Severity: Medium
- Confidence: Medium-High
- Classification: Likely
- Evidence:
  - `SEMANTIC_SCAN_LIMIT` can be configured up to 25,000 rows: `apps/web/src/lib/clip-embeddings.ts:36-44`.
  - `topK` filters and sorts the whole scored array: `apps/web/src/lib/clip-embeddings.ts:164-168`.
  - Semantic search loads, decodes, scores, and ranks every scanned vector: `apps/web/src/app/api/search/semantic/route.ts:263-312`.
  - Similar search does the same production-vector scan: `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`.
  - CLIP inference has a bounded queue, but that queue protects model inference, not DB vector scans/scoring: `apps/web/src/lib/clip-model.ts:53-64`, `apps/web/src/lib/clip-model.ts:117-172`.
- Problem: Request cost scales linearly with scan limit and concurrently allocates decoded vectors/scored arrays; full sort adds avoidable CPU.
- Concrete failure scenario: Operator raises `SEMANTIC_SCAN_LIMIT` near 25k. Multiple visitors trigger semantic/similar searches; MySQL returns thousands of MEDIUMBLOBs per request and Node performs decode + scoring + sort on the request thread, increasing GC and latency for unrelated traffic.
- Suggested fix: Add a separate global semaphore for vector-scan/scoring work, use a min-heap/partial selection instead of full sort, chunk/yield long CPU loops, and keep the production cap conservative until a vector index/sidecar search service exists.

### C96-PERF-06 — Public search uses leading-wildcard `LIKE` queries on hot text fields

- Severity: Medium
- Confidence: Medium
- Classification: Likely
- Evidence:
  - `containsLike` emits `%term%` patterns: `apps/web/src/lib/sql-like.ts:5-10`.
  - Public search rate-limits then calls `searchImages`: `apps/web/src/app/actions/public.ts:237-306`.
  - Main search applies leading-wildcard LIKE across title, description, camera, lens, topic, and topic label: `apps/web/src/lib/data.ts:1539-1612`.
  - Tag and alias fallback branches also use leading-wildcard LIKE with joins/grouping: `apps/web/src/lib/data.ts:1639-1669`.
- Problem: B-tree indexes cannot efficiently serve `%term%`; rate limiting bounds request count but not per-request DB scan cost.
- Concrete failure scenario: A bot or user issues broad two-character searches within the per-IP budget. MySQL scans/filter/sorts many processed rows and tag/alias joins to produce 20 results, competing with gallery listing queries.
- Suggested fix: Move public search to FULLTEXT/ngram/search-document indexing, raise minimum query length for broad locales if acceptable, or add an expensive-search queue/backpressure mechanism.

## Manual-validation risks

### C96-PERF-07 — Map page may become main-thread heavy at high marker counts

- Severity: Medium
- Confidence: Medium
- Classification: Manual-validation risk
- Evidence:
  - DB cap allows up to 10,000 markers: `apps/web/src/lib/data.ts:1698-1734`.
  - Server maps every marker and renders an accessible list entry for each: `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/app/[locale]/(public)/map/page.tsx:93-105`.
  - Client computes bounds by allocating lat/lng arrays and renders one Leaflet marker per item: `apps/web/src/components/map/map-client.tsx:77-94`, `apps/web/src/components/map/map-client.tsx:98-140`.
- Risk scenario: A gallery with thousands of GPS-visible images sends a large hydration payload and mounts thousands of Leaflet markers/list nodes, causing mobile jank.
- Suggested fix: Validate with mobile browser profiling at 1k/5k/10k markers; if slow, add clustering/canvas rendering, viewport-bbox loading, and virtualized/paged accessible list.

### C96-PERF-08 — Timeline/date archive predicates are intentionally non-sargable

- Severity: Low-Medium
- Confidence: Medium
- Classification: Manual-validation risk
- Evidence:
  - On-this-day uses `MONTH()` and `DAY()` on `capture_date`: `apps/web/src/lib/data-timeline.ts:88-116`.
  - Timeline year list uses `YEAR(capture_date)`: `apps/web/src/lib/data-timeline.ts:129-142`.
  - Timeline images use `YEAR()` and optional `MONTH()` filters: `apps/web/src/lib/data-timeline.ts:178-207`.
  - Dynamic pages call these paths with `revalidate = 0`: timeline `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94`; year page `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:20`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:90-99`.
- Risk scenario: At larger library sizes, dynamic timeline hits scan the processed/capture-date prefix and evaluate date functions per row.
- Suggested fix: Use range predicates for year pages and generated/indexed month/day columns for on-this-day if EXPLAIN on production-like data shows scans becoming material.

### C96-PERF-09 — Shutdown drain budget may be shorter than worst-case image/embedding work

- Severity: Low-Medium
- Confidence: Medium
- Classification: Manual-validation risk
- Evidence:
  - Docker gives 30s stop grace: `apps/web/docker-compose.yml:12-15`.
  - App graceful shutdown races queue/view/background drains against a 15s timeout and exits nonzero on timeout: `apps/web/src/instrumentation.ts:20-69`.
  - Queue shutdown waits active jobs and tracked side effects: `apps/web/src/lib/queue-shutdown.ts:16-49`.
  - Image jobs can be inside Sharp encode, DB update, caption, and embedding side effects: `apps/web/src/lib/image-queue.ts:640-755`.
- Risk scenario: A deploy SIGTERM lands during a large AVIF encode or CLIP side effect; the app exits after 15s before all side effects drain. Retry/idempotency likely recovers, but deploy logs would show truncated queue work.
- Suggested fix: Measure worst-case encode/embedding duration on the deployment host, align the app timeout with `stop_grace_period`, or make long jobs checkpoint/resume more explicitly.

## Missed-issue sweep and coverage notes

- DB pool and query connection lifecycle are bounded: `apps/web/src/db/index.ts:23-38`, `apps/web/src/db/index.ts:70-134`.
- Sharp/libvips concurrency and cache are controlled: `apps/web/src/lib/process-image.ts:36-57`; image queue concurrency reserves live DB capacity: `apps/web/src/lib/image-queue.ts:87-109`.
- Service-worker image metadata mutations are serialized; I did not re-raise the old LRU race: `apps/web/public/sw.template.js:98-140`, `apps/web/public/sw.template.js:171-195`.
- Upload file-handle lifecycle covers 304, HEAD, stream handoff, and abort cleanup; I did not find a current FD leak: `apps/web/src/lib/serve-upload.ts:167-174`, `apps/web/src/lib/serve-upload.ts:239-248`, `apps/web/src/lib/serve-upload.ts:271-310`.
- Deployment disk hygiene prunes after successful health and preserves bind-mounted data: `apps/web/deploy.sh:79-104`; nginx body/cache limits are explicit for upload/admin/static derivative paths: `apps/web/nginx/default.conf:58-185`.

Final sweep result: confirmed findings are the four current-source items above, including carry-forward issues already tracked in Cycle 95. I found no additional newly introduced deployed-request-path performance regression in the docs-only HEAD delta. Live-browser CWV traces, production `EXPLAIN ANALYZE`, load tests, and heap profiles were not run, so the manual-validation risks remain unproven.