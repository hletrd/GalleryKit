# Architecture Review - Cycle 17/100

Review role: architect subagent
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-08
Scope: boundaries, layering, coupling, state ownership, migration/deploy architecture, reliability, data model evolution, background workers, and operational topology.

No fixes were implemented.

## Architecture Inventory

Docs and project context inspected:
- `AGENTS.md` - workspace rules, deploy policy, migration/privacy conventions, required quality gates.
- `CLAUDE.md` - full architecture, security model, single-writer assumptions, restore/runbook, CLIP/semantic activation, disk/deploy topology, image pipeline notes.
- `.context/plans/` and `.context/reviews/` - prior plan/review context and aggregate/deferred architecture notes, with attention to cycle and photographer/restore/color/semantic themes.
- `README.md`, root `package.json`, `package-lock.json`.

Deployment, runtime, and topology surfaces inspected:
- `scripts/deploy-remote.sh`
- `scripts/check-proxy-topology.mjs`
- `apps/web/deploy.sh`
- `apps/web/docker-compose.yml`
- `apps/web/Dockerfile`
- `apps/web/next.config.ts`
- `apps/web/package.json`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/lib/single-writer-guard.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config-server.ts`
- `apps/web/src/lib/settings-hash.ts`

Data, migrations, restore, and storage surfaces inspected:
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/advisory-locks.ts`
- `apps/web/src/lib/admin-mutation-barrier.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/restore-maintenance-durable.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/drizzle/0000_*.sql` through `apps/web/drizzle/0029_*.sql`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/check-migration-journal.mjs`
- `apps/web/scripts/check-schema-migration-parity.mjs`
- `apps/web/scripts/check-schema-migration-consistency.mjs`
- `apps/web/scripts/check-privacy-guards.mjs`

Server Actions and API boundary surfaces inspected:
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- API routes under `apps/web/src/app/api/**/route.ts`, including admin DB download, Lightroom upload, health/live, Open Graph, semantic search, similar search, public upload serving, and feeds.
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`

Background worker, image, color, and semantic-search surfaces inspected:
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/lib/image-processing.ts`
- `apps/web/src/lib/image-processing-config.ts`
- `apps/web/src/lib/image-processing-inline.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/clip-stub.ts`
- `apps/web/src/lib/clip-preprocess.ts`
- `apps/web/src/lib/semantic-search.ts`
- `apps/web/src/lib/semantic-query-cache.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`
- `apps/web/scripts/preflight-clip-production.mjs`
- `apps/web/scripts/seed-clip-weights.sh`
- `apps/web/scripts/semantic-search-smoke.mjs`
- `apps/web/scripts/semantic-search-health.mjs`

Security lint and quality-gate architecture inspected:
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/check-touch-targets.mjs`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/action-origin*.test.ts`
- `apps/web/src/__tests__/public-route-rate-limit*.test.ts`
- Representative unit tests and e2e specs covering restore, rate limits, semantic search, image queue, admin flows, and route behavior.

## Findings

### A1. Single-writer topology is correctness-critical but only warning-enforced

Classification: Confirmed issue
Severity: High
Confidence: High

Evidence:
- `apps/web/src/lib/single-writer-guard.ts:6-16` states that multiple live web processes sharing the same DB break process-local restore fencing, upload quotas, image queue state, and in-memory rate-limit fast paths.
- `apps/web/src/lib/single-writer-guard.ts:17-21` states the guard is warning-only and must never block startup.
- `apps/web/src/instrumentation.ts:22-31` starts the guard fire-and-forget and logs failures without preventing boot.
- `apps/web/src/lib/single-writer-guard.ts:218-235` logs that another instance was detected, but explicitly continues startup.
- `apps/web/docker-compose.yml:12-17` defines a single named container, but Docker/runtime configuration is the convention rather than the enforcement boundary.

Why this is a problem:
The repository correctly documents a single-writer architecture, but the most important invariant is enforced operationally instead of structurally. Several safety systems are process-local: restore maintenance state, admin mutation draining, upload tracking, queue membership, and some rate-limit fast paths. If a second process appears, both instances can independently believe they own safe execution windows.

Concrete failure scenario:
A manual `next start`, an accidental second container, a blue-green overlap, or a restart race keeps two web processes alive against the same MySQL DB and bind mounts. Instance A starts a restore and drains only its local writers. Instance B accepts a Lightroom upload or admin mutation because its local restore flag and mutation slots are clear. The restore imports an older SQL dump while Instance B writes new rows/files, leaving DB/file state inconsistent after revalidation.

Suggested fix:
Make the singleton guard fail-closed in production unless an explicit unsafe override such as `ALLOW_MULTI_INSTANCE_UNSAFE=true` is set. If multi-instance operation is desired, move restore state, mutation fencing, upload quotas, queue state, and rate-limit ownership into shared durable storage with DB-scoped locks and transactional claims. Also add a deploy/runtime check that fails health when another writer is detected.

### A2. Background DB connection budgeting is independent and can oversubscribe the live pool

Classification: Confirmed issue
Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/db/index.ts:31-42` sets `POOL_CONNECTION_LIMIT` to 10 and `queueLimit` to 20 for the shared app pool.
- `apps/web/src/lib/image-queue.ts:121-134` reserves half the pool for live requests and derives image queue concurrency from the same pool.
- `apps/web/src/lib/admin-backfill-runner.ts:106-143` independently reserves half the pool and derives admin backfill concurrency from the same pool.
- `apps/web/src/lib/image-queue.ts:486-524` performs embedding DB writes inside image processing work.
- `apps/web/src/lib/admin-backfill-runner.ts:145-220` keeps process-local backfill state and runs the backfill fire-and-forget once triggered.

Why this is a problem:
The image queue and admin color backfill each make reasonable local assumptions, but there is no shared background-work budget. With the default 10-connection pool, each subsystem can reserve for live traffic as if the other subsystem were idle. When both run, they can collectively consume almost the entire pool.

Concrete failure scenario:
An operator triggers color re-encode while uploads are still producing image jobs and semantic writes. The backfill uses one global lock connection plus worker connections; image queue jobs use additional DB reads/writes; live page/API requests now compete for the remaining one or two connections. Once the pool queue reaches `queueLimit: 20`, user-visible requests fail or time out even though each subsystem individually respected its own cap.

Suggested fix:
Introduce one shared background DB budget/semaphore for image processing, admin color backfill, semantic embedding writes, and maintenance sweeps. Each subsystem should acquire from the same budget before DB-heavy work. Alternatively, split background workers into a separate process/pool with an explicit MySQL capacity budget and make live request reserve limits account for that external pool.

### A3. Advisory lock names are partly DB-scoped and partly MySQL-server-global

Classification: Confirmed issue
Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/lib/advisory-locks.ts:10-18` notes that MySQL advisory locks are server-scoped, not database-scoped, and that separate GalleryKit instances on one MySQL server will block each other unless lock names are prefixed.
- `apps/web/src/lib/advisory-locks.ts:20-49` defines static global names for restore, upload processing, topic route segments, admin delete, color backfill, semantic backfill, and per-image processing locks.
- `apps/web/src/lib/advisory-locks.ts:51-71` makes the single-writer lock DB-scoped via a database hash, explicitly supporting separate DB co-location for that one guard.

Why this is a problem:
The locking model has two different ownership boundaries. The singleton guard treats separate DBs on the same MySQL server as separate GalleryKit instances, but operational locks still collide across all DBs on that server. That creates false coupling between otherwise separate galleries and can hide production stalls as unrelated lock contention.

Concrete failure scenario:
Two GalleryKit deployments use different databases on the same MySQL server. Gallery A starts a restore and holds `gallerykit:db-restore`; Gallery B cannot perform a restore or upload-processing critical section even though its DB is unrelated. If both galleries process image ID `42`, `gallerykit:image-processing:42` can also serialize unrelated jobs or cause retries in the wrong deployment.

Suggested fix:
Prefix every advisory lock with a stable instance key, preferably derived from DB name plus configured instance ID, and keep all locks under one naming helper. If co-location is not supported, fail startup when the DB server appears shared and document the one-GalleryKit-per-MySQL-server requirement as a hard invariant.

### A4. Restore quiescence relies on a manual registry of process-local writers

Classification: Likely issue
Severity: Medium
Confidence: Medium

Evidence:
- `apps/web/src/app/[locale]/admin/db-actions.ts:497-536` says every process-local DB writer must be added to the restore drain checklist.
- `apps/web/src/lib/admin-mutation-barrier.ts:1-33` implements a process-local restore-window fence for admin mutations.
- `apps/web/src/lib/background-db-writes.ts:11-31` tracks background promises only when callers explicitly wrap them.
- `apps/web/src/lib/background-db-writes.ts:77-112` drains only the tracked background writes and analytics queue.
- `apps/web/src/lib/restore-maintenance.ts:1-27` stores the active restore state in process-local `globalThis`.

Why this is a problem:
The current restore path is carefully built, but the ownership model is social: future process-local writers must remember to participate in the checklist and tracking helpers. The architecture has multiple ways to start asynchronous DB work, and the restore system cannot automatically see unregistered timers, detached promises, or new background queues.

Concrete failure scenario:
A future feature adds a periodic metadata refresh or fire-and-forget aggregation that writes through Drizzle without `trackBackgroundDbWrite()` and without an admin mutation slot. Restore starts, drains the known writers, imports SQL, and runs migrations. The unregistered writer completes after the import and writes rows derived from the pre-restore state, polluting the restored database.

Suggested fix:
Make background DB writes go through a small registered scheduler or DB-write wrapper that is visible to restore draining. Add a source-contract lint test for detached DB writes, `setInterval`/timer DB work, and untracked `void` DB promises outside approved modules. Replace the manual checklist with a declarative registry exported by each background subsystem.

### A5. DB backup/restore does not own filesystem consistency

Classification: Confirmed issue
Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/app/[locale]/admin/db-actions.ts:192-199` creates backups with `mysqldump`, so the backup artifact is SQL only.
- `apps/web/src/app/[locale]/admin/db-actions.ts:759-765` restores by piping SQL into `mysql`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:803-829` performs post-restore migration and cache revalidation, but there is no file manifest reconciliation in the restore transaction.
- `apps/web/docker-compose.yml:24-32` bind-mounts mutable `./data`, `./public/uploads`, and `./public/resources` outside the image.

Why this is a problem:
The restore boundary is the database, but gallery correctness also depends on original uploads, generated derivatives, resources, and possibly metadata side files. DB rows and filesystem objects can move out of sync across backups, deletes, failed uploads, or host-level restores.

Concrete failure scenario:
An operator restores a SQL dump from Monday while the filesystem remains at Wednesday. The restored DB references images that were deleted from disk after Monday, or omits images whose files still exist. Public pages can render broken images, derivative regeneration can fail on missing originals, and orphaned files continue consuming disk without DB ownership.

Suggested fix:
Either make the admin backup a full consistency bundle containing SQL plus a file manifest/snapshot, or add a required post-restore reconciliation pass that validates DB rows against original and derivative files, marks missing originals unprocessed, schedules derivative rebuilds, and reports orphaned files for operator action. The UI/runbook should label SQL restore as DB-only.

### A6. Image/CSP base URL ownership is split between build time and runtime

Classification: Confirmed issue
Severity: Medium
Confidence: High

Evidence:
- `apps/web/next.config.ts:32-38` parses `IMAGE_BASE_URL` while loading Next config.
- `apps/web/next.config.ts:121-125` builds `images.remotePatterns` from that config-time value.
- `apps/web/src/lib/content-security-policy.ts:139-143` builds runtime CSP image sources from `process.env.IMAGE_BASE_URL`.
- `apps/web/docker-compose.yml:7-9` passes build args for `NEXT_PUBLIC_APP_URL` and `IMAGE_BASE_URL`, while `apps/web/docker-compose.yml:18-23` also passes runtime env vars.

Why this is a problem:
One setting controls several concerns, but not all of them are evaluated at the same time. A runtime env-only change can update CSP and generated URLs while leaving Next image remote patterns baked from the previous build.

Concrete failure scenario:
An operator changes `IMAGE_BASE_URL` in the deploy env and restarts without rebuilding, or the build arg and runtime env diverge. The app emits or allows the new CDN host in CSP, but Next image optimization still rejects it because `remotePatterns` was baked with the old host. Thumbnails or Open Graph images fail only after deployment.

Suggested fix:
Add a startup assertion that compares the runtime `IMAGE_BASE_URL` with a build-time baked value and fails or loudly marks health unhealthy when they differ. Alternatively, remove runtime variability from this setting and require rebuilds for changes, or route image serving through a stable local origin that does not require runtime remote-pattern changes.

### A7. Semantic embedding work is not globally coordinated with in-app scan and sidecar backfill

Classification: Risk needing manual validation
Severity: Low
Confidence: Medium

Evidence:
- `apps/web/src/lib/image-queue.ts:527-622` starts an in-app scan for missing active embeddings and processes up to `SEMANTIC_SCAN_LIMIT` with bounded local concurrency.
- `apps/web/scripts/backfill-clip-embeddings.ts:120-130` acquires `LOCK_SEMANTIC_EMBEDDING_BACKFILL` for the sidecar/script backfill.
- `apps/web/src/lib/clip-model.ts:53-64` defines process-local CLIP inference queue limits.
- `apps/web/src/lib/clip-model.ts:65-173` enforces inference slots only inside the current Node process.

Why this is a problem:
The sidecar has a database advisory lock, but the in-app bootstrap scan and request-time semantic work are controlled by process-local queues. The app can therefore perform embedding work while a sidecar is also embedding, and CLIP inference limits do not form a host-wide CPU/RSS budget.

Concrete failure scenario:
Production CLIP is enabled, an operator starts `backfill-clip-embeddings.ts`, and the web process also boots or receives uploads that trigger missing-embedding bootstrap. Both processes load CLIP weights and run inference. The DB upsert converges eventually, but CPU, memory, and request latency can spike; semantic endpoints may return 503 or time out during the overlap.

Suggested fix:
Have in-app semantic bootstrap respect the same semantic backfill advisory lock, or disable the bootstrap while the sidecar lock is held. For production, consider moving CLIP inference to a dedicated worker process with one host-wide queue and an explicit concurrency/RSS budget.

### A8. Sidecar color backfill can bypass the app's pool-aware concurrency limits

Classification: Risk needing manual validation
Severity: Low
Confidence: Medium

Evidence:
- `apps/web/scripts/backfill-color-pipeline.ts:383-387` allows `BACKFILL_CONCURRENCY` from 1 to 8 in the sidecar script.
- `apps/web/src/lib/admin-backfill-runner.ts:130-143` clamps in-app backfill concurrency from the shared pool limit and reserved live-connection budget.
- `apps/web/src/db/index.ts:31-42` configures each Node process with its own MySQL pool.

Why this is a problem:
The sidecar is operator controlled and separate from the web process, so it does not share the in-app runner's pool-aware budgeting. A high sidecar concurrency can add another pool of DB work and Sharp/libvips CPU pressure while live traffic and image queue work continue.

Concrete failure scenario:
An operator runs the sidecar with `BACKFILL_CONCURRENCY=8` during traffic. The sidecar opens its own pool and performs CPU-heavy derivative work while the web process handles uploads, semantic writes, and requests. MySQL and CPU become saturated even though the web process's internal caps remain valid.

Suggested fix:
Reuse the same concurrency derivation for sidecar backfill or add an explicit sidecar capacity model that accounts for live web pool size and host CPU. Require an `--unsafe-concurrency` or env flag for values above the safe default, and document that the script should run during a maintenance window unless this budget is configured.

## Non-Finding Notes

- The Server Action and API security lint architecture is strong. `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`, and `apps/web/scripts/check-public-route-rate-limit.ts` make origin/auth/rate-limit requirements explicit and fail closed for unsupported export shapes.
- The migration architecture has unusually good post-condition checks. `apps/web/scripts/migrate.js` reconciles legacy schema, Drizzle journal state, and committed migration hashes; the AGENTS.md migration rules correctly call out the journal `when` ordering hazard.
- Privacy-sensitive admin-only fields are guarded in both runtime omit lists and test/type fixtures; this review did not find a new privacy-boundary ownership issue.

## Final Missed-Issues Sweep

I rechecked the main cross-file seams after drafting findings:
- Server Actions/API routes vs data layer and auth/origin/rate-limit lint gates.
- Restore maintenance vs background writers, image queue, admin mutations, and durable marker startup sync.
- Image processing queues vs admin backfill, semantic embedding writes, and MySQL pool limits.
- Deployment scripts, Docker topology, health checks, and post-deploy prune behavior.
- Migration journal, schema reconciliation, and privacy guard conventions.
- Runtime config, CSP, image base URL, and cache/revalidation surfaces.

Relevant files skipped or not line-read completely:
- Binary/static assets, screenshots, fonts, and visual fixture images.
- Generated coverage/gate logs and historical review artifacts not directly relevant after inventory.
- I did not line-read every UI component or every one of the 3000+ tests; I focused on architecture-relevant source, tests, scripts, docs, migrations, config, deployment surfaces, and the cross-file contracts listed in the inventory.
