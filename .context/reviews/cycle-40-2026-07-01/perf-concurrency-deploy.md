# Cycle 40 Performance / Concurrency / Deploy Review

Scope: performance, concurrency, caching, background queues, resource limits, database query/index hot paths, and deployment/runtime drift.

HEAD reviewed: `490b93c5`

## Inventory Built

- Queue/runtime: `apps/web/src/lib/image-queue.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/background-db-writes.ts`.
- Shared buffers/rate limits: `apps/web/src/lib/data.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/public.ts`.
- DB/query/index surface: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/view-retention.ts`.
- Cache/static delivery: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/next.config.ts`, upload route handlers.
- Semantic/CLIP heavy paths: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- Backfill/deploy: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, nginx config references.
- Prior context: `CLAUDE.md`, `AGENTS.md`, `.context/reviews/cycle-39-2026-06-30/perf-concurrency.md`, `.context/reviews/cycle-39-2026-06-30/_aggregate.md`, `.context/plans/cycle-39-2026-06-30-deferred.md`, and run-10 carry-forward registers.

## Findings

No actionable new findings in this lane.

## Evidence

- Cycle-39 service-worker fixes are present and source-locked. Metadata mutations are serialized through `metaMutationQueue` in the shipped template (`apps/web/public/sw.template.js:98-140`, `:171-195`) and reference module (`apps/web/src/lib/sw-cache.ts:47-155`), with a concurrent write regression test (`apps/web/src/__tests__/sw-cache.test.ts:250-262`). Image sizing now prefers `Content-Length` before the blob fallback in the template (`apps/web/public/sw.template.js:198-207`) and is contract-pinned (`apps/web/src/__tests__/sw-template-contract.test.ts:183-190`).
- SW cache behavior remains bounded: image LRU cap is 50 MB (`apps/web/public/sw.template.js:31`), HEAD revalidation is bounded to 300 ms (`apps/web/public/sw.template.js:34-38`, `:275-280`), HTML offline cache is capped at 50 entries/24 h (`apps/web/public/sw.template.js:32-33`, `:143-159`, `:345-354`).
- Upload derivative serving avoids per-image DB storms on the route-handler fallback. `serve-upload.ts` has module-level settings-hash TTL/inflight dedupe (`apps/web/src/lib/serve-upload.ts:45-82`), conditional 304 handling before body streaming (`:228-249`), and HEAD early return before stream creation (`:252-260`). Static derivative cache headers are configured in `apps/web/next.config.ts:56-73`.
- Queue concurrency is capped against the shared DB pool. `QUEUE_CONCURRENCY` is parsed with max 8 and reduced by `resolveImageQueueConcurrency` (`apps/web/src/lib/image-queue.ts:91-108`); the queue uses a single global state and bounded retry/permanent-failure maps (`:269-344`, `:793-848`). Shutdown drains the processing queue plus shared-group view flush under a 15 s stop bound (`apps/web/src/instrumentation.ts:20-68`).
- Queue side effects are tracked rather than fully detached. Caption and embedding writes are registered in `sideEffects` (`apps/web/src/lib/image-queue.ts:346-456`, `:702-770`), and restore maintenance is checked before embedding generation/write (`:358-377`). Remaining lifecycle tradeoffs are already captured in carry-forward registers.
- Public read/action rate limiting is pre-incremented before expensive work and maps are bounded. Load-more and search paths pre-increment before DB work and roll back documented server-error branches (`apps/web/src/app/actions/public.ts:47-119`, `:121-168`, `:236-318`). View-record actions check rate limits before validating target existence/inserting analytics rows (`:330-395`, `:417-510`).
- Rate-limit storage has a DB purge index now present in schema: `idx_rate_limit_buckets_bucket_start` (`apps/web/src/db/schema.ts:214-222`). Analytics retention tables have leading `(viewed_at, id)` indexes (`apps/web/src/db/schema.ts:236-266`) and chunked retention deletes (`apps/web/src/lib/view-retention.ts:31-89`).
- Semantic search/similar routes remain bounded but still match known deferred scale work. Text semantic search gates body size, rate-limits before config/body/embedding scan work, scans at most `SEMANTIC_SCAN_LIMIT`, and enriches only top results (`apps/web/src/app/api/search/semantic/route.ts:94-184`, `:247-365`). Similar search uses the same semantic budget and bounded scan (`apps/web/src/app/api/search/similar/[id]/route.ts:98-177`, `:186-270`).
- In-app color backfill is pool-capped and batched. The runner clamps `ADMIN_BACKFILL_CONCURRENCY` against a live-traffic reserve (`apps/web/src/lib/admin-backfill-runner.ts:96-142`), fetches batches by keyset (`:383-424`), and uses the shared per-image advisory lock (`:348-381`, `:455-620`).
- Deploy/runtime posture matches documented single-instance assumptions. Compose runs one host-networked web service with `TRUST_PROXY=true` (`apps/web/docker-compose.yml:12-23`) and bind-mounted mutable data (`:24-28`). Deploy waits for health/live success before best-effort Docker prune (`apps/web/deploy.sh:32-54`, `:56-81`).

## Not Re-raised

- `PERF-C39-03` feed/sitemap updated-time indexes and `PERF-C39-04` pipeline-version indexes remain migration-shaped work requiring EXPLAIN and `reconcileLegacySchema`; no new evidence changed severity.
- `AGG-C38-08` / run-10 sidecar keyset/memory work remains deferred. The sidecar still loads all candidate rows (`apps/web/scripts/backfill-color-pipeline.ts:343-360`), but this is already recorded as broader throughput/memory refactor work.
- Semantic vector scan / global CPU guard / model-version overwrite items remain deferred in run-10 registers. The routes and scripts are bounded by current caps, and no new production-scale evidence was found.
- Static-path derivative invalidation, process-local rate-limit maps, deploy `/api/live` readiness, and Compose resource-limit guidance are already documented/deferred operational tradeoffs; no new runtime drift was found.

## Disposition

New findings: 0.

Recommendation: no performance/concurrency/deploy fix is scheduled from this lane for cycle 40.
