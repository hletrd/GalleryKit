# Run-10 Cycle 34 Architect Review

Role: architect lane
Date: 2026-07-08 KST
Status: review-only; no source-code edits, no commit, no push, no deploy.

## Scope And Inventory

Reviewed whole-repo architecture/design/layering/coupling risks with emphasis on Next app boundaries, data layer, migrations, queues/backfills, admin actions, rate-limit/lint gates, storage abstraction, service worker behavior, and deploy/runtime topology.

Inventory inspected:

- Repo guidance and operating context: `AGENTS.md`, `CLAUDE.md`, existing `.context/reviews/architect.md`.
- Next/runtime boundaries: `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`, `apps/web/next.config.ts`, `apps/web/package.json`, root `package.json`.
- Data/migrations: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`.
- Queues/backfills/maintenance: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, restore-maintenance helpers.
- Admin actions and gates: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/api/**/route.*`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`.
- Storage/upload/service worker: `apps/web/src/lib/storage/**`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, public upload routes, service-worker/public asset files.
- Deploy/runtime topology: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`.

Validation evidence collected:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.

Full build/test/audit/e2e and live production/proxy validation were not run because this lane is review-only and the task requested a written architecture review artifact.

## Confirmed Findings

### ARCH-C34-01 - Sidecar color backfill can race the live per-image processing lock

Severity: High
Confidence: High
Status: confirmed

Evidence:

- The sidecar imports only the global color backfill lock, not the per-image processing lock helper: `apps/web/scripts/backfill-color-pipeline.ts:50-54`.
- The sidecar `reprocessRow()` writes derivatives and refreshes color metadata without acquiring `gallerykit:image-processing:{id}`: `apps/web/scripts/backfill-color-pipeline.ts:218-309`.
- The sidecar holds only the global run lock: `apps/web/scripts/backfill-color-pipeline.ts:327-348`, then queues rows directly into `reprocessRow()`: `apps/web/scripts/backfill-color-pipeline.ts:524-530`.
- The in-app admin backfill explicitly documents the same race and acquires the per-image processing claim before re-encoding: `apps/web/src/lib/admin-backfill-runner.ts:355-391`, `apps/web/src/lib/admin-backfill-runner.ts:520-544`.
- The live image queue also acquires and releases the same per-image claim around processing: `apps/web/src/lib/image-queue.ts:683-714`, `apps/web/src/lib/image-queue.ts:767-818`.
- Admin retry can re-enqueue a failed image into the live queue while an operator sidecar backfill is running: `apps/web/src/app/actions/images.ts:1242-1348`.

Concrete failure scenario:

An operator runs `backfill-color-pipeline.ts --force-reencode` while an admin retries a failed image, or while a restarted live queue rediscovers a failed/pending row. The live queue and the sidecar can both call `processImageFormats()` for the same image and derivative filenames. Two writers can interleave temp/rename/backup writes and DB updates, so final derivative bytes can come from one run while `pipeline_version`, HDR/color columns, `was_downscaled`, `avif_10bit`, or `processing_error` describe the other. The in-app runner already fixed this class of race, but the sidecar did not inherit that lock discipline.

Recommendation:

Make the sidecar use the same per-image processing claim as `admin-backfill-runner.ts` and `image-queue.ts`. Prefer extracting a shared helper for acquire/release semantics, including destroy-on-release-failure behavior. If the claim is held, skip the row without bumping `pipeline_version` so a later run can retry. Add a regression test or static contract that the sidecar imports/uses `getImageProcessingLockName()` before calling `processImageFormats()`.

### ARCH-C34-02 - Background DB connection budgets are fragmented across queue and in-app backfill

Severity: Medium
Confidence: High
Status: confirmed

Evidence:

- The shared MySQL pool is hard-limited to 10 connections with queue limit 20: `apps/web/src/db/index.ts:31-42`.
- The live image queue independently reserves half the pool and clamps `QUEUE_CONCURRENCY`: `apps/web/src/lib/image-queue.ts:121-153`.
- The in-app admin backfill independently reserves half the pool and clamps `ADMIN_BACKFILL_CONCURRENCY`: `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `apps/web/src/lib/admin-backfill-runner.ts:716-727`.
- Each subsystem's arithmetic is locally valid, but neither one subtracts the other's active reservations.

Concrete failure scenario:

On the default pool of 10, the queue can run at effective concurrency 2 while an admin backfill also runs at effective concurrency 2. The backfill pins one global lock connection plus per-image claims and transient update connections; the queue pins per-image claims and transient row/update connections. Together they can consume most of the pool, leaving foreground page queries, admin actions, rate-limit checks, and config reads queued behind long-running encode/detect work. Under a burst, mysql2's `queueLimit: 20` can reject foreground work even though both background systems stayed inside their own caps.

Recommendation:

Introduce a shared background-resource budget for DB-bearing jobs. Queue processing, in-app color backfill, semantic embedding backfill, analytics/background writes, and restore maintenance should acquire tokens from the same coordinator, with explicit foreground reserve. Add a stress/regression test using a small configured pool that runs queue + backfill together and asserts total background leases never exceed the shared cap.

### ARCH-C34-03 - Semantic embedding bootstrap and semantic sidecars do not coordinate on one work owner

Severity: Medium
Confidence: High
Status: confirmed design risk

Evidence:

- Live queue bootstrap scans processed images missing the active embedding version and calls `storeImageEmbeddingForMode()` without acquiring `LOCK_SEMANTIC_EMBEDDING_BACKFILL`: `apps/web/src/lib/image-queue.ts:542-637`.
- The CLI semantic backfill acquires `LOCK_SEMANTIC_EMBEDDING_BACKFILL`, but that only excludes another semantic backfill/restore path, not live bootstrap: `apps/web/scripts/backfill-clip-embeddings.ts:109-130`.
- The admin semantic backfill action uses the same semantic lock, again not observed by live bootstrap: `apps/web/src/app/actions/embeddings.ts:113-131`.
- CLIP inference is bounded by an in-process queue with its own pending limit and timeout: `apps/web/src/lib/clip-model.ts:53-72`, `apps/web/src/lib/clip-model.ts:117-173`.

Concrete failure scenario:

Production semantic mode is enabled and an operator starts the semantic embedding sidecar for a large backlog. At the same time, normal image queue bootstrap continues scanning for missing embeddings and running CLIP inference on the same candidates. Upsert/idempotent writes may converge, but CPU/inference slots and DB reads are duplicated. Public similar/semantic search requests can then wait behind maintenance work or hit the CLIP queue timeout even though a single semantic backfill owner would have been sufficient.

Recommendation:

Make live bootstrap observe semantic backfill ownership. A low-risk design is a non-blocking check for `LOCK_SEMANTIC_EMBEDDING_BACKFILL`: if held, skip bootstrap for that pass and let the sidecar/admin action own the backlog. A stronger design is a durable embedding work queue with a single lease mechanism shared by bootstrap, admin action, and CLI sidecar. Include metrics/logs that distinguish "skipped because a semantic backfill owner is active" from actual embedding failures.

## Likely Findings

### ARCH-C34-04 - Operator color sidecar bypasses the in-app DB pool clamp

Severity: Medium
Confidence: Medium-High
Status: likely

Evidence:

- The sidecar accepts `BACKFILL_CONCURRENCY` with fallback 2 and max 8, independent of DB pool headroom: `apps/web/scripts/backfill-color-pipeline.ts:384-388`.
- The in-app admin runner has a pool-aware cap and logs clamp-down when requested concurrency exceeds the pool budget: `apps/web/src/lib/admin-backfill-runner.ts:130-143`, `apps/web/src/lib/admin-backfill-runner.ts:716-727`.
- The sidecar imports the same app DB pool module in a separate Node process, so it has its own local pool limit rather than participating in the live app process's cap: `apps/web/src/db/index.ts:31-42`.

Concrete failure scenario:

An operator raises `BACKFILL_CONCURRENCY=8` for a maintenance run while the live app is serving traffic and processing uploads. The sidecar can run up to eight concurrent Sharp/detection/update tasks from its own process and its own pool, while the live app also has a 10-connection pool. The in-app pool clamps do not protect the MySQL server, CPU, or disk I/O from aggregate sidecar + app pressure. Foreground requests can slow or fail even when the admin UI backfill path would have clamped the same workload.

Recommendation:

Reuse the in-app backfill concurrency resolver in the sidecar or add a server-wide maintenance budget lock/table that all background processes share. At minimum, clamp sidecar concurrency from DB pool size and expose a warning matching the in-app clamp. Prefer one backfill engine used by both CLI and admin action, with transport-specific wrappers only.

## Manual-Validation Risks

### ARCH-C34-05 - Public SSR rate limiting depends on manually applied host Nginx config

Severity: High if drifted in production; Medium as a repository risk
Confidence: Medium
Status: manual-validation risk

Evidence:

- Public and image optimizer limiter zones live in the Nginx config template: `apps/web/nginx/default.conf:1-19`.
- The limiter key caveat requires real-client-IP configuration in LB-fronted topologies, otherwise all clients share the LB's bucket or the limiter sees the wrong address: `apps/web/nginx/default.conf:20-29`.
- The public SSR catch-all limiter is applied only in the Nginx location block: `apps/web/nginx/default.conf:274-295`.
- The config itself says deploys do not touch this file and an operator must apply/reload it manually: `apps/web/nginx/default.conf:290-293`.
- The app deploy script rebuilds/restarts Docker services and prunes Docker artifacts, but does not copy or reload host Nginx: `apps/web/deploy.sh:51-55`, `apps/web/deploy.sh:79-104`.

Concrete failure scenario:

`npm run deploy` succeeds on a host whose live Nginx config predates the public SSR limiter or lacks realip configuration. Dynamic public pages remain unthrottled at the edge, or all visitors collapse into one limiter bucket behind a load balancer and receive false 429s. App-level tests and deployment success would not reveal the drift because the safety control is outside the app deployment unit.

Recommendation:

Add a non-mutating post-deploy/proxy-topology verification step that records the live Nginx checksum/effective config and confirms public page burst behavior plus real-client-IP behavior. Keep reload/application manual if required by ops policy, but make stale proxy safety controls visible as a failed operational check. If production cannot reliably prove the edge limiter, add an app-layer fallback limiter for public dynamic page requests.

## Non-Findings And Guardrails Confirmed

- Admin API route auth gate passed. Current admin API route exports are wrapped by `withAdminAuth(...)` per `npm run lint:api-auth --workspace=apps/web`.
- Mutating server action origin gate passed. Current mutating server actions either call `requireSameOriginAdmin()` or carry explicit approved exemptions per `npm run lint:action-origin --workspace=apps/web`.
- Public App Router rate-limit gate passed. Current public route handlers either call approved rate-limit helpers or carry explicit exemptions per `npm run lint:public-route-rate-limit --workspace=apps/web`.
- `proxy.ts` excludes `/api/*`, but admin API protection is handled by the route-level `withAdminAuth(...)` gate; no confirmed boundary gap was found in the inspected admin API routes.
- The storage abstraction remains quarantined/future-facing rather than a misleading active backend switch in the inspected runtime paths. I found no evidence of `getStorage()` being used as the production upload/process/serve boundary.
- Migration safety has explicit journal/hash and reconcile safeguards in `migrate.js`; no current migration-ordering defect was confirmed during this pass. Live DB state was not inspected.
- Service-worker/runtime-cache risks were reviewed at the file-interaction level; no confirmed admin/private cache boundary defect was found. Browser-level service-worker behavior was not manually exercised.

## Final Sweep / Skipped Files

Final sweep covered route handlers, admin action scanners, upload/processing/backfill paths, DB pool ownership, storage imports, proxy/deploy topology, and migration journal/migrator interactions. Generated/build artifacts, dependency folders, uploaded media, live MySQL contents, and live host Nginx state were intentionally not inspected. The remaining risks above are the highest-confidence architecture/coupling issues found in this review pass.
