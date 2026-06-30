# Perf Reviewer Review - Cycle 37 (2026-06-30)

Reviewed HEAD: `d6c3a8f69911c84a63985a59827d4597def922d4`

## Inventory

- Project guidance and prior-review filter: inspected `AGENTS.md`, `CLAUDE.md`, `.context/reviews/cycle-36-2026-06-30/perf-reviewer.md`, `.context/reviews/cycle-36-2026-06-30/_aggregate.md`, and `.context/plans/cycle-36-2026-06-30-deferred.md`. Did not re-raise cycle-36 deferred `PERF-C36-01` orphan-temp cleanup repetition, `PERF-C36-02` per-photo OG 304 support, or `PERF-C36-03` CLIP input-pixel cap.
- Current HEAD delta from cycle 36: inspected `git diff bdfb38a1..d6c3a8f6`, especially `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/auth.ts`, and the two upload fallback route files. The production-code change to PAT verification uses an indexed `admin_tokens.token_hash` lookup plus `admin_users` PK join.
- DB/schema and migration support: inspected `apps/web/src/db/schema.ts`, `apps/web/drizzle/0006_admin_tokens.sql`, and `apps/web/scripts/migrate.js` for token indexes/FKs and image/embedding indexes.
- Queue/background work: inspected `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, and `apps/web/scripts/backfill-clip-embeddings.ts` for queue continuation, side-effect draining, semantic embedding retry, advisory locks, and live-process CPU/DB budgets.
- Semantic search/runtime CLIP: inspected `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-model.ts`, and `apps/web/src/lib/clip-embeddings.ts` for request caps, inference queueing, scan limits, and vector scoring.
- Public cache/OG/feed surfaces: inspected `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/next.config.ts`, and `apps/web/src/lib/serve-upload.ts`.
- Data/query hot paths: inspected `apps/web/src/lib/data.ts`, including listing pagination, feed helpers, topic/tag helpers, shared-group view-count buffering, React `cache()` exports, and known index tradeoffs. Existing feed/sitemap `(processed, updated_at)` index work remains previously deferred, not fresh.
- Client/UI responsiveness surfaces: inspected `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/register-service-worker.tsx`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, and `apps/web/src/lib/sw-cache.ts`.

## Findings

### PERF-C37-01 - Live queue bootstrap can launch unbounded duplicate CLIP embedding sweeps

- Severity: Medium
- Confidence: High
- Evidence: `bootstrapImageProcessingQueue()` starts `bootstrapMissingActiveEmbeddings(state)` on every bootstrap pass as a fire-and-forget side effect (`apps/web/src/lib/image-queue.ts:978`, `apps/web/src/lib/image-queue.ts:981`). That helper reloads config, exits only when semantic mode is disabled (`apps/web/src/lib/image-queue.ts:395`, `apps/web/src/lib/image-queue.ts:403`), then resets a local cursor to `0` and loops until no more processed rows are missing the active model embedding (`apps/web/src/lib/image-queue.ts:408`, `apps/web/src/lib/image-queue.ts:409`, `apps/web/src/lib/image-queue.ts:410`, `apps/web/src/lib/image-queue.ts:425`, `apps/web/src/lib/image-queue.ts:445`, `apps/web/src/lib/image-queue.ts:449`). Each batch runs embedding work at concurrency 2 (`apps/web/src/lib/image-queue.ts:81`, `apps/web/src/lib/image-queue.ts:82`, `apps/web/src/lib/image-queue.ts:427`, `apps/web/src/lib/image-queue.ts:442`) and upserts the row after generating the vector (`apps/web/src/lib/image-queue.ts:363`, `apps/web/src/lib/image-queue.ts:366`, `apps/web/src/lib/image-queue.ts:380`, `apps/web/src/lib/image-queue.ts:391`). The normal bootstrap path can schedule continuation passes after every full 500 pending-image batch (`apps/web/src/lib/image-queue.ts:80`, `apps/web/src/lib/image-queue.ts:925`, `apps/web/src/lib/image-queue.ts:946`, `apps/web/src/lib/image-queue.ts:1007`, `apps/web/src/lib/image-queue.ts:1010`), but there is no in-flight guard around the embedding sweep. By contrast, the operator sidecar takes the semantic backfill advisory lock and honors `SEMANTIC_SCAN_LIMIT` (`apps/web/scripts/backfill-clip-embeddings.ts:111`, `apps/web/scripts/backfill-clip-embeddings.ts:119`, `apps/web/scripts/backfill-clip-embeddings.ts:144`, `apps/web/scripts/backfill-clip-embeddings.ts:147`).
- Failure scenario: production semantic search is enabled, the process restarts after a model-version change or interrupted pre-enable backfill, and thousands of processed rows lack `PRODUCTION_MODEL_VERSION`. The live web process begins CLIP image embedding from `id > 0` and keeps going until the missing set is empty. If there is also a large unprocessed-image backlog, each 500-row queue continuation starts another full missing-embedding sweep before the previous side effect is considered by `queue.onIdle()`. Multiple sweeps can select the same rows before the first one upserts them, causing duplicate Sharp decode/resize, ONNX inference, DB reads/writes, and native-memory pressure in the latency-sensitive web container. `CLIP_INFERENCE_CONCURRENCY` limits simultaneous model calls, but queued duplicate sweeps still consume CPU, RSS, DB pool time, and shutdown drain time.
- Suggested fix: make missing-embedding retry a single-owned background task. Add an `embeddingBootstrapPromise`/`embeddingBootstrapInProgress` field to `ProcessingQueueState`, skip starting a new sweep while it is set, and clear it in `finally`. Limit live-process work to a small bounded pass, or reuse `SEMANTIC_SCAN_LIMIT` as a hard cap with a clear log that the sidecar backfill must finish bulk gaps. Consider acquiring the same `LOCK_SEMANTIC_EMBEDDING_BACKFILL` advisory lock, or at least skipping when that lock is held, so operator backfills and the live queue do not duplicate each other. Regression coverage should assert that two bootstrap continuations schedule only one `bootstrapMissingActiveEmbeddings` task and that shutdown still drains the tracked side effect.

## Checked Safeguards / Non-Findings

- PAT verification hot path: `verifyToken()` now joins `admin_users`, but it still filters by the indexed `admin_tokens.token_hash` and joins `admin_users.id`; `schema.ts` and migration `0006_admin_tokens.sql` both define the token-hash and user indexes. I do not see a material runtime regression from the cycle-36 fix.
- Changed lint gates: `npm run lint:action-origin --workspace=apps/web` and `npm run lint:public-route-rate-limit --workspace=apps/web` both pass at this HEAD. The new fixed-point scanner logic is CI-only and small enough for the current repo shape.
- Public feeds: the missing `(processed, updated_at)` index for feed/sitemap freshness remains previously deferred in cycle plans; no new severity evidence in this HEAD.
- Service worker/cache paths: image-cache byte/count caps, HTML offline caps, admin/API bypasses, and timeout-bounded HEAD revalidation are still present in the template and generated worker.
- OG routes: topic OG has a pre-render ETag path and rate limiting. Per-photo OG lacks a 304 path, but that is exactly cycle-36 deferred `PERF-C36-02`, so I did not re-raise it.

## Validation

- `git rev-parse HEAD` -> `d6c3a8f69911c84a63985a59827d4597def922d4`
- `npm run lint:action-origin --workspace=apps/web` -> pass
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> pass
- `git diff --check` -> pass

## Final Sweep Note

Common misses checked this pass: unbounded public request body parsing, DB pool starvation from background queues/backfills, query pagination without caps, expensive public GETs without cache/rate-limit posture, static derivative cache invalidation, service-worker storage growth, live-process CLIP/Sharp CPU fan-out, startup/shutdown queue drains, and deploy-host disk/runtime hazards. The only fresh actionable performance issue I found is the live queue's missing-embedding sweep ownership/budget gap above.
