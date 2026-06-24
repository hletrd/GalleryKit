# Performance / Concurrency Review - perf-reviewer

Scope: whole-repository performance, concurrency, CPU, memory, and UI responsiveness review for review-plan-fix cycle 1 / prompt 1.

Constraints followed: read-only source review. I did not modify source code, run deploys, commit, or push. This file is the review artifact requested by the prompt.

## Inventory

Primary documentation examined:

- `AGENTS.md`
- `CLAUDE.md`
- Existing review history under `.context/reviews/`, especially prior perf/security/archive notes for already-known deferred issues and resolved regressions.

Performance-sensitive source examined:

- Data and schema: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/view-retention.ts`, `apps/web/src/app/actions/public.ts`
- Semantic search and CLIP: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`
- Image processing and queues: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`
- UI responsiveness: `apps/web/src/components/search.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/histogram.tsx`, `apps/web/public/histogram-worker.js`
- Runtime/deploy/caching: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/sw-cache.ts`

## Findings

### PERF-01: View-retention purges cannot use the existing view-time indexes

- Severity: Medium
- Confidence: High
- Type: Confirmed issue
- Region: `apps/web/src/lib/view-retention.ts:49-82`, `apps/web/src/db/schema.ts:221-254`, `apps/web/src/lib/image-queue.ts:712-738`

`purgeOldViewEvents()` deletes old analytics rows with `WHERE viewed_at < cutoff` in bounded batches:

- `apps/web/src/lib/view-retention.ts:63-74` loops over `imageViews`, `topicViews`, and `sharedGroupViews`, then deletes by `lt(col, cutoff)`.
- The hourly startup/interval GC calls this from `apps/web/src/lib/image-queue.ts:712-738`.
- The schema has only composite indexes whose leading columns are not `viewed_at`: `image_id, viewed_at` plus `bot, viewed_at, ...` for `image_views` at `schema.ts:229-231`, `topic, viewed_at` for `topic_views` at `schema.ts:242`, and `group_id, viewed_at` for `shared_group_views` at `schema.ts:253`.

Why this is a problem:

The comment in `view-retention.ts:49-52` says the delete uses the `(..., viewed_at)` composite indexes. For the actual predicate, MySQL cannot use a suffix-only range on `viewed_at` unless the leading indexed column is constrained. As the anonymous view-event tables grow, each hourly retention sweep can degrade into large table/index scans before deleting each 5000-row chunk.

Concrete failure scenario:

A scraper or popular shared link grows `topic_views` and `shared_group_views` to millions of rows. On startup and every hour, the process runs up to 200 delete batches per table. Because the cutoff predicate is not supported by a `viewed_at`-leading index, the cleanup job competes with live public page requests for MySQL CPU and I/O, causing slow page loads exactly when the system is trying to reduce table growth.

Suggested fix:

Add `viewed_at`-leading indexes for the retention path, for example:

- `idx_image_views_viewed_at` on `image_views(viewed_at)`
- `idx_topic_views_viewed_at` on `topic_views(viewed_at)`
- `idx_shared_group_views_viewed_at` on `shared_group_views(viewed_at)`

If delete lock pressure remains, select primary keys by `viewed_at` in chunks and delete by ID. Add the migration, journal entry, and `reconcileLegacySchema` mirror per repo schema rules.

### PERF-02: Rate-limit bucket purge has the same suffix-index problem

- Severity: Medium
- Confidence: High
- Type: Confirmed issue
- Region: `apps/web/src/lib/rate-limit.ts:442-448`, `apps/web/src/db/schema.ts:208-215`, `apps/web/src/lib/image-queue.ts:712-738`

`purgeOldBuckets()` deletes expired DB-backed rate-limit buckets with:

- `apps/web/src/lib/rate-limit.ts:446-448`: `DELETE FROM rate_limit_buckets WHERE bucket_start < cutoffSec`
- `apps/web/src/db/schema.ts:208-215`: primary key is `(ip, bucket_type, bucket_start)` and there is no secondary index on `bucket_start`.
- `apps/web/src/lib/image-queue.ts:715-716` and `733-735`: this purge runs at startup and hourly.

Why this is a problem:

The primary key is optimized for exact bucket updates and checks by `(ip, bucketType, bucketStart)`, not for expiration by `bucket_start` alone. The purge therefore risks scanning the full rate-limit table as rows accumulate from public search/load-more traffic and other DB-backed limiters.

Concrete failure scenario:

A botnet or search crawler hits public load-more/search endpoints from many IPs for several hours. The rate-limit table grows with many expired minute buckets. The hourly purge scans the table and contends with live `incrementRateLimit()` / `checkRateLimit()` calls, increasing latency on request paths that are supposed to remain cheap.

Suggested fix:

Add a secondary index on `bucket_start`, or on `(bucket_type, bucket_start)` if operators need type-scoped purges later. Consider chunking `purgeOldBuckets()` with a `LIMIT` like the view-retention sweep so a large backlog cannot run as one long delete.

### PERF-03: Semantic search has per-IP limiting but no global CPU/concurrency guard

- Severity: Medium
- Confidence: Medium
- Type: Likely issue, production-load validation recommended
- Region: `apps/web/src/app/api/search/semantic/route.ts:207-281`, `apps/web/src/app/api/search/similar/[id]/route.ts:79-168`, `apps/web/src/lib/clip-model.ts:76-139`, `apps/web/src/lib/clip-embeddings.ts:18,49-55,137-141`, `apps/web/src/components/search.tsx:145-249`, `apps/web/nginx/default.conf:191-205`

The semantic routes are bounded per request but not globally:

- `semantic/route.ts:207-215` and `similar/[id]/route.ts:79-89` use the semantic per-IP limiter.
- Production semantic search calls CPU CLIP text inference at `semantic/route.ts:238-245`; the model is CPU-backed and lazily shared in `clip-model.ts:76-139`.
- Both semantic routes fetch up to `SEMANTIC_SCAN_LIMIT` rows, which is 5000 at `clip-embeddings.ts:18`, then decode and score every row in Node (`semantic/route.ts:247-281`, `similar/[id]/route.ts:138-168`).
- `topK()` sorts the full filtered set at `clip-embeddings.ts:137-141`.
- Nginx sends public requests through generic `location /` at `nginx/default.conf:191-205`; there is no route-level proxy limiter for semantic GET/POST traffic there.
- The React search client ignores stale semantic responses with `requestIdRef`, but it does not abort the prior `fetch('/api/search/semantic')` when the query changes (`search.tsx:145-249`).

Why this is a problem:

The current request-level caps are useful, and the 5000-row index-backed scan is intentionally bounded. The missing piece is admission control across concurrent requests. Per-IP rate limiting does not protect CPU when traffic comes from many IPs, shared NATs, or a few users typing rapidly. Stale client searches are prevented from updating UI state, but their server-side CLIP inference and vector scan still continue.

Concrete failure scenario:

Semantic mode is production. Twenty visitors type in the search modal at once, or one rotating-IP client sends many valid semantic queries. Each accepted request can run CPU inference, pull and decode up to 5000 embeddings, perform 2.56 million float operations, and sort matches. These requests can run alongside upload processing and background CLIP/image work in the same Node process, causing event-loop delay, slower page responses, and visible search latency.

Suggested fix:

Add a small process-global semaphore/queue around the production semantic critical section, covering `embedTextReal()` plus the 5000-vector ranking. A concurrency of 1-2 with a short queue timeout or fast `429`/`503` would protect the single web instance. Add client-side `AbortController` in `search.tsx` and pass the request signal to `fetch()` so stale semantic queries are canceled as soon as a newer query is scheduled. For larger galleries, consider an ANN/vector index or a worker-thread ranking path rather than doing all similarity work on the request path.

### PERF-04: The sidecar color backfill is O(gallery) in memory and has uncapped operator concurrency

- Severity: Medium
- Confidence: High
- Type: Confirmed issue
- Region: `apps/web/scripts/backfill-color-pipeline.ts:334-360,463-500`, `apps/web/src/lib/admin-backfill-runner.ts:623-670,684-764`, `apps/web/src/lib/process-image.ts:36-53,1263-1269`, `apps/web/docker-compose.yml:1-26`

The in-app admin backfill is carefully bounded:

- `admin-backfill-runner.ts:623-625` documents O(batch) memory.
- `admin-backfill-runner.ts:659-670` clamps concurrency against the shared DB pool.
- `admin-backfill-runner.ts:684-764` fetches one batch, enqueues it, drains it, then advances the cursor.

The sidecar script does not share those runtime limits:

- `backfill-color-pipeline.ts:334-340` selects every candidate image in one query.
- `backfill-color-pipeline.ts:347-351` materializes all rows and reports `rows.length`.
- `backfill-color-pipeline.ts:359-360` accepts `BACKFILL_CONCURRENCY` with no upper cap.
- `backfill-color-pipeline.ts:463-500` adds every row to one `PQueue` before waiting for idle.
- Each image reprocess internally fans out to WebP, AVIF, and JPEG in parallel at `process-image.ts:1263-1269`; Sharp thread caps are per process at `process-image.ts:36-53`.
- The production compose service has bind mounts and host networking at `docker-compose.yml:1-26`, but no CPU or memory limits.

Why this is a problem:

The sidecar has a separate DB pool by design, but it still shares the same host CPU, memory, disk, and image directories as the live web service and MySQL. Its memory footprint is proportional to gallery size because it loads and queues all rows. Its CPU footprint is operator-controlled and can multiply through Sharp's per-image format fan-out.

Concrete failure scenario:

An operator runs the documented sidecar with `--force-reencode` on a large gallery and sets `BACKFILL_CONCURRENCY=8` to finish faster. The script loads tens of thousands of rows, enqueues tens of thousands of closures, and runs many concurrent image re-encodes. Because each re-encode can run three format pipelines, the host can saturate CPU and memory, slowing or OOM-killing the live service despite the in-app runner having safer limits.

Suggested fix:

Bring the sidecar closer to the in-app runner's shape: keyset paginate candidates, drain one batch before fetching the next, and cap effective `BACKFILL_CONCURRENCY` against available CPU/memory or an explicit documented maximum. If the sidecar remains intentionally more powerful, add a live-host warning and optionally support `nice`/`ionice` or container CPU/memory limits for backfill runs.

### PERF-05: The web container has no runtime CPU/memory guard for combined Sharp + CLIP + request load

- Severity: Low
- Confidence: Medium
- Type: Risk needing manual validation
- Region: `apps/web/docker-compose.yml:1-26`, `apps/web/Dockerfile:80-124`, `apps/web/src/lib/process-image.ts:36-53`, `apps/web/src/lib/clip-model.ts:76-100`, `apps/web/deploy.sh:30-56`

The runtime starts one Node process with the Next standalone server:

- `Dockerfile:80-124` sets production env, CLIP model root, healthcheck, and command, but no `NODE_OPTIONS` heap ceiling.
- `docker-compose.yml:1-26` declares the web service, host networking, env file, and bind mounts, but no CPU or memory limits/reservations.
- Sharp is tuned to divide libvips thread concurrency by format fan-out at `process-image.ts:36-53`.
- The CLIP model is lazily loaded and retained as a singleton promise at `clip-model.ts:76-100`.
- Deploy disk cleanup is well covered at `deploy.sh:30-56`, but that is disk hygiene, not CPU/RSS isolation.

Why this is a problem:

The application has several per-subsystem safeguards, but the container itself has no final RSS/CPU envelope. A bad combination of live uploads, production semantic search, CLIP model load, and sidecar or admin backfill can grow memory and CPU demand until the host, not the app, performs the limiting.

Concrete failure scenario:

During a backfill or upload burst, a few semantic searches arrive while the CLIP model is loaded and Sharp is encoding multiple derivatives. Without a heap cap, cgroup limit, or process-level CPU admission control, the Node process can consume enough resources to make the host swap or kill the process. The healthcheck is liveness-only, so it may not restart a degraded but still responding service.

Suggested fix:

Define an operational envelope for the single-host deployment: `NODE_OPTIONS=--max-old-space-size=...`, compose-level memory/CPU limits if supported in this deployment path, and explicit concurrency budgets tying `QUEUE_CONCURRENCY`, `SHARP_CONCURRENCY`, semantic-search concurrency, and backfill concurrency together. Keep the current disk-prune guarantees unchanged.

## Non-findings and checked interactions

- Semantic search DB access is not an N+1 query pattern. The embedding scan is capped at 5000 and supported by `idx_image_embeddings_model_version_updated` (`schema.ts:271-285`); enrichment runs as a single bounded `IN` query after top-K selection.
- Core listing/load-more paths cap limits and support cursor pagination. `public.ts:78-153` caps `limit` to 100 and rejects deep legacy offsets above 10000.
- The shared-group view-count buffer is bounded and has retry/backoff guards (`data.ts:12-63` and surrounding flush logic).
- The in-app admin color backfill has the batching/concurrency protections the sidecar lacks.
- The photo viewer and load-more components avoid the obvious render-storm patterns: stable refs, in-flight guards, bounded observer behavior, and single-format neighbor preload.
- Histogram work is offloaded through `apps/web/public/histogram-worker.js`; no main-thread large-pixel-loop issue was found in that path.
- Image derivative serving is offloaded to nginx for normal `/uploads/...` paths and uses a consistent `max-age=3600, must-revalidate` policy.
- Public pages intentionally use fresh dynamic rendering per `CLAUDE.md`; I did not flag this as a route-caching bug because it is a documented freshness tradeoff.

## Final missed-issues sweep

I performed a final repository sweep for performance/concurrency keywords including cache, revalidate, purge, retention, rate-limit, concurrency, PQueue, Sharp, scan, AbortController, and fetch across `apps/web/src`, `apps/web/scripts`, runtime config, and `.context` review history.

Relevant files examined in the final pass:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/perf-reviewer.md`
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/view-retention.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/sw-cache.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/public/histogram-worker.js`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `apps/web/nginx/default.conf`
- `apps/web/next.config.ts`

Residual risks:

- I did not run `EXPLAIN` against production MySQL, so the index findings are based on schema/query-shape analysis. They should be validated with `EXPLAIN DELETE` or equivalent select probes before migration rollout.
- I did not run load tests for semantic search or backfill. The concurrency findings are based on code-path composition and should be validated with representative gallery size, CPU count, model mode, and host memory.
- I did not run the full quality gate because this was a review-only prompt with no source changes.
