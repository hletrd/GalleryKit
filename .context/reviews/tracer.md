# Tracer Review - Cycle 6 Prompt 1

Scope: causal tracing of scheduled jobs, restore/maintenance, auth, rate limits, migrations, media ingestion, ML/search queues, and deployment/runtime side effects. Source code was not edited; only this review artifact was written.

## Inventory

Primary files and docs inspected:
- Repo contract: `AGENTS.md`, `CLAUDE.md`, prior tracer artifact `.context/reviews/tracer.md`, recent run brief `.context/reviews/run9-cycle7/_brief.md`.
- Scheduled/background jobs: `apps/web/src/instrumentation.ts:1-108`, `apps/web/src/lib/maintenance-scheduler.ts:1-45`, `apps/web/src/lib/background-db-writes.ts:1-84`, `apps/web/src/lib/audit.ts:112-146`, `apps/web/src/lib/view-retention.ts:64-90`, `apps/web/src/lib/rate-limit.ts:567-583`.
- Restore/maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts:403-933`, `apps/web/src/lib/restore-maintenance.ts:21-59`, `apps/web/src/lib/restore-maintenance-durable.ts:57-115`, `apps/web/src/lib/admin-mutation-barrier.ts:1-135`, `apps/web/src/lib/upload-processing-contract-lock.ts:9-74`, `apps/web/src/lib/db-restore.ts:21-63`, `apps/web/src/lib/sql-restore-scan.ts:1-260`.
- Auth/rate limits: `apps/web/src/app/actions/auth.ts:77-265`, `apps/web/src/app/actions/auth.ts:290-380`, `apps/web/src/lib/auth-rate-limit.ts:1-146`, `apps/web/src/lib/api-auth.ts:58-144`, `apps/web/src/lib/rate-limit.ts:135-583`.
- Media ingestion and processing: `apps/web/src/app/actions/images.ts:129-653`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-611`, `apps/web/src/lib/image-queue.ts:270-1311`, `apps/web/src/lib/upload-tracker.ts:19-33`.
- ML/search queues: `apps/web/src/app/api/search/semantic/route.ts:107-320`, `apps/web/src/app/api/search/similar/[id]/route.ts:68-285`, `apps/web/src/app/actions/embeddings.ts:58-211`, `apps/web/scripts/backfill-clip-embeddings.ts:106-264`, `apps/web/scripts/backfill-color-pipeline.ts:367-613`, `apps/web/src/lib/admin-backfill-runner.ts:390-860`.
- Migrations/deploy/runtime: `apps/web/scripts/migrate.js:180-958`, `apps/web/drizzle/meta/_journal.json:1-216`, `scripts/deploy-remote.sh:1-92`, `apps/web/deploy.sh:1-108`, `apps/web/docker-compose.yml:1-32`, `apps/web/nginx/default.conf:1-280`, `apps/web/src/app/api/health/route.ts:1-81`, `apps/web/src/app/api/live/route.ts:1-10`.

## Confirmed Defect

### TRC6-01 - Site-wide maintenance sweeps can mutate the database inside a restore window

Severity: Medium. Confidence: High.

Causal trace:
1. App startup synchronizes a durable restore marker, then starts the maintenance scheduler before bootstrapping the image queue: `apps/web/src/instrumentation.ts:3-10`.
2. `startMaintenanceScheduler()` immediately runs a startup sweep and arms an hourly interval: `apps/web/src/lib/maintenance-scheduler.ts:28-36`.
3. `runMaintenanceSweep()` fires four DB-mutating jobs without checking `isRestoreMaintenanceActive()` and without tracking their in-flight promises: `apps/web/src/lib/maintenance-scheduler.ts:21-25`.
4. Those jobs delete from `sessions`, `rate_limit_buckets`, `audit_log`, and analytics view tables: `apps/web/src/lib/maintenance-scheduler.ts:13-25`, `apps/web/src/lib/rate-limit.ts:567-583`, `apps/web/src/lib/audit.ts:112-146`, `apps/web/src/lib/view-retention.ts:64-90`.
5. Restore sets durable maintenance, quiesces the image queue, drains background DB writes, and drains foreground admin mutations before importing SQL: `apps/web/src/app/[locale]/admin/db-actions.ts:495-562`. That drain covers tracked background writes (`apps/web/src/lib/background-db-writes.ts:77-84`) and admin mutation slots (`apps/web/src/lib/admin-mutation-barrier.ts:102-135`), but the scheduler jobs are neither tracked there nor stopped.

Failure scenario:
- An admin starts a large DB restore near the top of the hour, or a process boots while a stale durable restore marker is present. The scheduler can start or continue retention deletes while `mysql --one-database` is dropping/recreating/loading app tables and while post-restore migrations run. Best case: the sweep logs noisy failures or holds locks during import. Worse case: it deletes restored sessions/audit/view/rate-limit rows after the dump has loaded those tables but before restore success, so "restore this dump" is not causally exact. This also violates the restore contract that the database is not authoritative during the maintenance window, a contract other flows honor.

Competing hypotheses checked:
- Foreground admin mutations are fenced by `acquireAdminMutationSlot()` and drained before import; that does not include scheduler jobs because they never acquire a slot (`apps/web/src/lib/admin-mutation-barrier.ts:76-130`, `apps/web/src/lib/maintenance-scheduler.ts:21-25`).
- Queue and ML side effects are quiesced or restore-guarded (`apps/web/src/lib/image-queue.ts:490-509`, `apps/web/src/lib/image-queue.ts:1252-1299`); scheduler deletes are outside that path.
- Sidecar scripts fail closed on the durable restore marker (`apps/web/src/lib/restore-maintenance-durable.ts:57-63`, `apps/web/scripts/backfill-color-pipeline.ts:367-370`, `apps/web/scripts/backfill-clip-embeddings.ts:109-128`); the in-process scheduler does not call the durable guard.

Concrete fix:
- Make maintenance sweeps restore-aware and drainable. Minimal shape: import `isRestoreMaintenanceActive()` in `maintenance-scheduler.ts`; skip starting a sweep when active; wrap each purge task in the same tracked background-write mechanism or maintain a local `maintenancePromises` set; expose `drainMaintenanceSweepsForRestore()` and call it after `beginDurableRestoreMaintenance()` and before `runRestore()`.
- Add tests that fail on the current shape: a source/behavior test proving `runMaintenanceSweep()` is a no-op during restore maintenance, plus a restore-source test proving `restoreDatabase()` drains any already-started maintenance sweep before the import child is spawned.

## Clean Traces

### Restore and maintenance barriers

Restore now takes the DB-restore advisory lock, upload-processing contract lock, color backfill lock, and semantic backfill lock before entering durable maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts:428-493`. It then starts durable maintenance, drains queued image processing and background DB writes, drains foreground admin mutations, runs import, runs post-restore migrations, and clears/resumes only on safe branches: `apps/web/src/app/[locale]/admin/db-actions.ts:495-605`, `apps/web/src/app/[locale]/admin/db-actions.ts:760-933`. SQL restore validation has header/trailer checks and dangerous-SQL scanning: `apps/web/src/app/[locale]/admin/db-actions.ts:661-740`, `apps/web/src/lib/db-restore.ts:21-63`, `apps/web/src/lib/sql-restore-scan.ts:61-260`. No new restore-lock release defect found.

### Media ingestion

Browser upload checks restore maintenance at entry, holds the admin mutation slot, acquires the upload-processing contract lock, preclaims upload quota synchronously, rechecks maintenance after original write/GPS stripping, inserts the row, and enqueues a snapshot carrying all processing settings: `apps/web/src/app/actions/images.ts:129-269`, `apps/web/src/app/actions/images.ts:425-558`, `apps/web/src/app/actions/images.ts:650-652`. Lightroom upload mirrors the same late restore check and six-setting queue snapshot: `apps/web/src/app/api/admin/lr/upload/route.ts:252-314`, `apps/web/src/app/api/admin/lr/upload/route.ts:427-565`, `apps/web/src/app/api/admin/lr/upload/route.ts:605-609`. No new browser/LR divergence found.

### Queues, ML, and search

The processing queue rejects new jobs during restore, uses per-image advisory claims, verifies rows still exist before and after encode, drains caption/embedding side effects on restore/shutdown, and resets bootstrap state after restore: `apps/web/src/lib/image-queue.ts:691-715`, `apps/web/src/lib/image-queue.ts:773-890`, `apps/web/src/lib/image-queue.ts:895-961`, `apps/web/src/lib/image-queue.ts:1252-1311`. Semantic/similar routes gate origin, restore maintenance, request size, mode, rate limiting, model version, scan cap, and public enrichment: `apps/web/src/app/api/search/semantic/route.ts:107-320`, `apps/web/src/app/api/search/similar/[id]/route.ts:68-285`. Known semantic scan/storage design issues remain carry-forward/deferred; no new tracer-only ML/search defect was confirmed.

### Auth and rate limits

Login checks restore maintenance and same-origin before pre-incrementing IP and account buckets, rolls back only pre-auth over-limit rejections, and intentionally does not refund infrastructure errors after auth work starts: `apps/web/src/app/actions/auth.ts:77-169`, `apps/web/src/app/actions/auth.ts:171-265`. Password change uses same-origin, current-user, maintenance, validation-before-preincrement, and DB/in-memory rate checks: `apps/web/src/app/actions/auth.ts:290-380`. PAT admin API auth applies pre-auth token rate limiting and no-store/nosniff headers: `apps/web/src/lib/api-auth.ts:72-144`. No new auth/rate-limit bypass found.

### Migrations and deployment/runtime side effects

Migration reconciliation mirrors current schema, guards DML baselining, distinguishes pending migrations from legacy drift, and asserts every journal hash after Drizzle runs: `apps/web/scripts/migrate.js:348-751`, `apps/web/scripts/migrate.js:784-958`; the journal currently includes entries through `0029_feed_updated_indexes`: `apps/web/drizzle/meta/_journal.json:208-214`. Deploy side effects are explicit and bounded: remote env loading refuses group/world-readable deploy secrets, remote deploy verifies runtime env/site config, waits for health, then prunes only unused Docker artifacts after the live container is healthy: `scripts/deploy-remote.sh:55-92`, `apps/web/deploy.sh:15-55`, `apps/web/deploy.sh:57-104`. Docker persistence is bind-mounted, host-networked, single-container: `apps/web/docker-compose.yml:12-32`. No new deploy/prune data-loss path found.

## Final Sweep

Re-file filters applied:
- Did not re-file the old foreground-admin-mutation restore race; the current barrier and restore drain address that class (`apps/web/src/lib/admin-mutation-barrier.ts:1-135`, `apps/web/src/app/[locale]/admin/db-actions.ts:544-572`).
- Did not re-file semantic scan/model-version storage carry-forward issues without new evidence; the current sidecar/action/route paths are consistent with the known deferred architecture tradeoffs.
- Did not re-file sidecar color-backfill materialization; current sidecar uses keyset paging and page-at-a-time processing (`apps/web/scripts/backfill-color-pipeline.ts:409-427`, `apps/web/scripts/backfill-color-pipeline.ts:573-583`).

Final verdict: 1 new confirmed defect, `TRC6-01`. The rest of the traced surfaces were either clean in current source or already represented in carry-forward/deferred review history.
