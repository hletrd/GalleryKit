# Cycle 35 Architect Review

Role: cycle-35 architect subagent
Date: 2026-07-08 KST
Mode: review-only; no product-code edits.

## Inventory And Scope Reviewed

Read the required repo instructions first: `AGENTS.md` and `CLAUDE.md`.

Architecture-relevant inventory inspected:

- Runtime/deploy topology: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/proxy.ts`.
- Data/schema/migrations: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`.
- Background coordination: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`.
- Restore and mutation barriers: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/advisory-lock-release.ts`.
- Public/admin boundaries: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/api/**/route.*`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`.
- Storage/serving boundaries: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/{index,local,types}.ts`, public upload routes.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.

Full build, full unit suite, e2e, live MySQL state checks, and live host Nginx checks were not run for this review-only lane.

## Findings

### ARCH-C35-01 - Semantic embedding work has multiple active owners

Severity: Medium
Confidence: High
Classification: confirmed design risk

Evidence:

- Live queue bootstrap scans processed images missing the active embedding version and calls `storeImageEmbeddingForMode()` without checking `LOCK_SEMANTIC_EMBEDDING_BACKFILL`: `apps/web/src/lib/image-queue.ts:542-637`.
- The live writer upserts directly into `image_embeddings`: `apps/web/src/lib/image-queue.ts:501-539`.
- The sidecar semantic backfill acquires `LOCK_SEMANTIC_EMBEDDING_BACKFILL`: `apps/web/scripts/backfill-clip-embeddings.ts:114-130`.
- The admin semantic action also acquires that lock: `apps/web/src/app/actions/embeddings.ts:113-131`.
- Real CLIP inference is bounded only by an in-process queue: `apps/web/src/lib/clip-model.ts:53-72`, `apps/web/src/lib/clip-model.ts:117-173`.

Concrete failure scenario:

Production semantic search is enabled and an operator starts `backfill-clip-embeddings.ts --production --force` for a large backlog. The live web process can simultaneously run `bootstrapMissingActiveEmbeddings()` over the same missing rows. The DB upsert converges, so this is not a corruption bug, but both paths can spend CLIP inference CPU, DB reads, and inference queue slots on duplicate work. Public semantic/similar search requests can then wait behind maintenance work or hit queue-full/timeout behavior even though one owner would have been enough.

Suggested fix:

Make live bootstrap observe semantic-backfill ownership. A low-risk version is a non-blocking probe of `LOCK_SEMANTIC_EMBEDDING_BACKFILL`; if held, skip that bootstrap pass and log `skipped: semantic backfill active`. A stronger version is a durable embedding work queue/lease shared by queue bootstrap, admin action, and CLI sidecar.

### ARCH-C35-02 - Background capacity budgeting is still fragmented across subsystems

Severity: Medium
Confidence: High
Classification: confirmed/documented architecture risk

Evidence:

- The app pool is fixed at 10 connections with `queueLimit: 20`: `apps/web/src/db/index.ts:31-42`.
- Image processing independently reserves foreground headroom and clamps queue concurrency: `apps/web/src/lib/image-queue.ts:121-153`.
- In-app color backfill independently reserves foreground headroom and clamps its own concurrency: `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `apps/web/src/lib/admin-backfill-runner.ts:722-733`.
- The color sidecar has separate `BACKFILL_CONCURRENCY` parsing with max 8 and its own process/pool: `apps/web/scripts/backfill-color-pipeline.ts:416-420`.
- Semantic bootstrap uses a separate fixed batch concurrency: `apps/web/src/lib/image-queue.ts:108-110`, `apps/web/src/lib/image-queue.ts:609-625`.
- Admin semantic backfill uses another fixed concurrency: `apps/web/src/app/actions/embeddings.ts:30`, `apps/web/src/app/actions/embeddings.ts:173-210`.
- Analytics/background DB writes maintain another independent queue: `apps/web/src/lib/background-db-writes.ts:8-10`, `apps/web/src/lib/background-db-writes.ts:42-75`.

Concrete failure scenario:

An admin starts in-app color backfill while uploads are processing, semantic mode is filling missing embeddings, and analytics writes are queued. Each subsystem obeys its local cap, but there is no shared lease that proves aggregate background DB work stays below the foreground reserve. On the default pool, foreground page queries and admin actions can queue behind background work; under a burst, mysql2 can reject requests after the pool queue reaches 20.

Suggested fix:

Introduce one shared background-resource coordinator for DB-bearing work in the web process: image processing, in-app color backfill, semantic bootstrap/action, maintenance sweeps, and analytics drains should lease from the same budget. For sidecars, add a server-wide maintenance budget through MySQL advisory locks or a small lease table, or document and enforce a "sidecar pauses live background workers" maintenance mode. Add a small-pool regression test proving combined background leases cannot exceed the configured cap.

Note:

The queue/backfill overlap is already documented in `CLAUDE.md` as a near-saturation window, so this is not a newly discovered hidden defect. It remains an unresolved architecture risk because the mitigation is documentation rather than an enforced invariant.

### ARCH-C35-03 - Public SSR edge throttling is outside the deploy unit

Severity: High if production drifted; Medium as repository risk
Confidence: Medium
Classification: manual-validation risk

Evidence:

- Public and image-optimizer limiter zones are defined only in the Nginx template: `apps/web/nginx/default.conf:1-29`.
- The public SSR limiter is applied in the catch-all Nginx location: `apps/web/nginx/default.conf:274-295`.
- The same template states deploys do not apply this config and an operator must reload Nginx manually: `apps/web/nginx/default.conf:290-293`.
- The app deploy script rebuilds and health-checks Docker only; it does not copy, test, reload, or verify host Nginx: `apps/web/deploy.sh:51-55`, `apps/web/deploy.sh:79-104`.

Concrete failure scenario:

`npm run deploy` succeeds on a host whose live Nginx config predates `zone=public`, `zone=nextimage`, or the real-client-IP topology notes. Public dynamic pages remain unthrottled at the edge, or an LB-fronted deployment collapses all visitors into one `$binary_remote_addr` bucket and returns false 429s. The app health check and lint gates still pass because the control lives outside the deployed container.

Suggested fix:

Add a non-mutating operational verification step after deploy: capture `nginx -T` or a checksum of the active server block, verify required zones/locations are present, and run a bounded burst check against `/` and `/_next/image` from the deploy host or an operator-controlled probe. If host policy keeps Nginx reload manual, the deploy can still fail or warn loudly when the live config is stale. If that cannot be made reliable, add an app-layer fallback limiter for public dynamic pages.

### ARCH-C35-04 - Color sidecar batching weakens the per-image lock ownership invariant

Severity: Low
Confidence: Medium
Classification: likely risk

Evidence:

- The sidecar now acquires a per-image processing claim before `reprocessRow()`: `apps/web/scripts/backfill-color-pipeline.ts:557-575`.
- Each task pushes its result into shared `updateBatch` / `derivativeBatch` arrays, then calls shared `flushBatch()`: `apps/web/scripts/backfill-color-pipeline.ts:471-487`, `apps/web/scripts/backfill-color-pipeline.ts:575-593`.
- `flushBatch()` splices and persists all currently pending rows, not just the caller's row: `apps/web/scripts/backfill-color-pipeline.ts:487-527`.
- The task releases its own per-image claim in `finally`: `apps/web/scripts/backfill-color-pipeline.ts:601-603`.

Concrete failure scenario:

With sidecar concurrency greater than 1, task B can push row B into the shared batch, task A can splice row B into A's `flushBatch()`, and task B can then call its own now-empty `flushBatch()` and release row B's per-image claim before A's transaction has finished row B's update. Today the global color-backfill lock and `processed = TRUE` candidate filter make this unlikely to corrupt current live processing, but it contradicts the intended "claim held through persistence" invariant and makes the sidecar fragile if another processed-row writer is added later.

Suggested fix:

Make the claim owner also own persistence for that row. Options: remove shared cross-task batching, maintain per-task update execution under the same claim, or add a batch coordinator that tracks claims for every row in the batch and releases each claim only after that row's update/cleanup result is known.

## Accepted Or Documented Constraints, Not Defects

- Single web-instance / single-writer topology is documented and partially guarded by the warn-only DB singleton lock. Process-local upload trackers, rate-limit fast paths, admin-backfill status, and shared-group view-count buffers are accepted under that topology.
- Shared-group `view_count` is best-effort analytics, not audit/billing state; losses on crash or SIGKILL are documented.
- `site-config.json` and `IMAGE_BASE_URL` remote patterns have build-time-inlined behavior; runtime edits requiring rebuilds are documented.
- The storage abstraction is intentionally local-only and not the live upload/process/serve pipeline. I found no current `getStorage()` use in product runtime paths outside the abstraction itself.
- Multiple root admins with no role/capability split is an explicit product constraint.
- Public page rate limiting being an edge/Nginx concern is documented; the finding above is about missing automatic live-config verification, not about the design being undocumented.

## Confirmed Guardrails / Non-Findings

- Prior cycle's color-sidecar/live-processing race is materially fixed in current source: the sidecar imports `getImageProcessingLockName`, acquires a per-image claim, runs `reprocessRow()`, and releases after the flush path: `apps/web/scripts/backfill-color-pipeline.ts:54`, `apps/web/scripts/backfill-color-pipeline.ts:319-347`, `apps/web/scripts/backfill-color-pipeline.ts:557-603`.
- Admin API auth gate passed: every current admin API route export is wrapped by `withAdminAuth(...)`.
- Mutating server-action origin and restore-barrier gate passed: current mutating admin actions either enforce `requireSameOriginAdmin()` plus `acquireAdminMutationSlot()` or carry explicit scanner-approved exemptions.
- Public route rate-limit gate passed: expensive public route handlers either use approved pre-increment helpers or carry explicit documented exemptions.
- Restore coordination path is layered: durable marker, restore/upload/backfill advisory locks, queue quiesce, background writer drains, maintenance sweep drain, and foreground mutation drain were all present in the inspected restore path.
- Migration bootstrap has explicit journal-hash postconditions and legacy reconcile guards. I did not confirm a current migration-ordering defect.
- Upload/original storage boundaries are explicit: originals resolve through private roots with symlink/path containment checks, and public derivative serving is restricted to `jpeg`, `webp`, and `avif`.

## Final Sweep / Skipped Files

Final sweep covered common miss areas: route/API guard scanners, restore-window drains, advisory-lock naming, color and semantic sidecars, queue bootstrap side effects, schema/reconcile interactions, storage abstraction exposure, derivative serving, Docker deploy, Nginx topology, and process-local state assumptions.

Skipped intentionally: `node_modules/`, `.next/`, uploaded media, `test-results/`, live MySQL contents, live production environment variables, and active host Nginx state. Those require live-environment inspection rather than repository review.
