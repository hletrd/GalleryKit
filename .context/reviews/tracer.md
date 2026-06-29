# Cycle 18 Tracer Review

Scope: causal tracing across auth/session, upload processing, image queue/backfill, sharing, semantic search, DB restore/backup, route rate limits, service worker/cache, and deployment scripts.

Review posture: read-only. No implementation changes. Current HEAD: `4ad6a394453fac80cc29aacc6f93eab3ed8c12ca`.

## Inventory

Relevant instructions/docs read first: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/tracer.md`, `.context/reviews/prompts/common_review_scope.md`.

Relevant flow files examined:

- Auth/session/admin API: `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`.
- Upload processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/serve-upload.ts`, upload route handlers under `apps/web/src/app/**/uploads/[...path]/route.ts`.
- Image queue/backfill: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/download-clip-models.ts`.
- Sharing/public analytics: `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/lib/data.ts`.
- Semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-paths.ts`.
- DB backup/restore/migrations: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/scripts/migrate.js`.
- Public routes/rate limits/cache: all route handlers under `apps/web/src/app/api`, feed routes, upload routes, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/components/register-service-worker.tsx`, `apps/web/next.config.ts`.
- Deployment: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `.dockerignore`, `apps/web/.dockerignore`.
- Relevant tests/contracts checked: auth/session/rate-limit/upload/queue/backfill/sharing/semantic/restore/SW/deploy tests under `apps/web/src/__tests__/`, especially `db-restore.test.ts`, `restore-upload-lock.test.ts`, `backup-download-route.test.ts`, `check-public-route-rate-limit.test.ts`, `shared-route-rate-limit-source.test.ts`, `semantic-search-route.test.ts`, `sw-template-contract.test.ts`, and `deploy-script-contract.test.ts`.

Validation run:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

## Findings

### T18-01: DB backup creation is not serialized with restore

Severity: Medium

Confidence: Medium-high

Files/regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:119-124` checks same-origin/admin and current restore-maintenance state before backup.
- `apps/web/src/app/[locale]/admin/db-actions.ts:157-170` starts `mysqldump` directly.
- `apps/web/src/app/[locale]/admin/db-actions.ts:286-351` documents restore's advisory-lock model, acquires `LOCK_DB_RESTORE`, upload-processing, and backfill locks, then starts restore maintenance.
- `apps/web/src/app/[locale]/admin/db-actions.ts:379-390` quiesces queue/view-count side effects only inside restore, not backup.
- `apps/web/src/__tests__/db-restore.test.ts:52-64` locks backup header/delete behavior, but not backup-vs-restore serialization.
- `apps/web/src/__tests__/restore-upload-lock.test.ts:7-32` locks restore/upload/backfill ordering, but not backup participation in the restore lock.

Causality chain:

1. `dumpDatabase()` rejects if restore maintenance is already active, but it does not acquire `LOCK_DB_RESTORE` or any backup/restore mutex.
2. `restoreDatabase()` acquires `LOCK_DB_RESTORE` before `beginRestoreMaintenance()`, creating a window where a backup can pass the maintenance check while restore setup is already underway.
3. Once `mysqldump` and restore overlap, MySQL metadata locks and DDL/import work can block each other; the code treats backup and restore as independent operations even though both operate on the same schema.
4. Tests cover dump validity and restore/upload coordination, but no contract currently prevents backup creation during restore setup/import.

Concrete failure scenario:

An admin starts a backup. Before or just after `mysqldump` begins, another admin starts a restore. The restore obtains `LOCK_DB_RESTORE`, enters maintenance, then the import/drop/recreate sequence competes with the dump's table reads and metadata locks. Depending on timing, the backup can fail after a long wait, restore can be delayed behind a dump, or the admin can receive a valid but stale pre-restore backup while the UI has moved into restore maintenance.

Suggested fix:

Make backup and restore share the same DB-level serialization contract. The narrowest change is for `dumpDatabase()` to use a dedicated connection and non-blocking `GET_LOCK(LOCK_DB_RESTORE, 0)` for the whole dump, releasing it in `finally`; return a translated "restore/backup already running" error when unavailable. Add a source or behavior test that `dumpDatabase()` participates in `LOCK_DB_RESTORE`.

### T18-02: Correctness depends on the documented single web-instance topology

Severity: Medium if accidentally scaled horizontally; Low under the current documented Docker Compose topology

Confidence: High

Files/regions:

- `CLAUDE.md:227-230` explicitly documents single web-instance/single-writer topology and names process-local restore, upload quota, queue, backfill status, rate-limit, and view-count state.
- `apps/web/docker-compose.yml:1-27` ships one `web` service/container.
- `apps/web/src/lib/restore-maintenance.ts:1-56` stores restore maintenance in a process-global symbol.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` and `apps/web/src/lib/upload-tracker-state.ts:70-78` store upload quota state in a process-global `Map`.
- `apps/web/src/lib/image-queue.ts:275-324` stores queue state in a process-global symbol.
- `apps/web/src/lib/rate-limit.ts:112-121` keeps rate-limit fast-path maps in process memory.
- `apps/web/src/lib/data.ts:13-63` buffers shared-group view counts in process memory before DB flush.
- `apps/web/src/lib/upload-processing-contract-lock.ts:9-74` provides a DB advisory lock for upload/restore/backfill writer coordination, but the surrounding maintenance and quota states are still local.

Causality chain:

1. The shipped deployment is single-instance and the docs correctly warn not to scale it without moving coordination state.
2. Several flows under this trace rely on process-local state for admission, visibility, retry, or accounting.
3. DB advisory locks fence some shared writers, but they do not make all guards global: restore-maintenance rejection, upload quotas, public rate-limit fast paths, admin-backfill status, and shared-group view buffering remain per process.
4. A second web process would therefore observe different coordination state even while sharing the same database and filesystem.

Concrete failure scenario:

An operator runs a second `gallerykit-web` process or changes Compose/orchestration to two replicas. Restore starts on process A and sets process-local maintenance. Process B does not see that flag, so public actions and some uploads can continue until they hit a DB/filesystem/advisory-lock boundary. Public rate limits split across processes, so an abusive client gets roughly N times the intended budget. Shared-group view increments buffered in process B can be lost independently on crash or deploy, and admin-backfill status can disagree between replicas.

Suggested fix:

Either harden the deployment boundary or globalize the coordination. Boundary hardening: add an explicit deploy/boot assertion that rejects multi-replica operation unless a `GALLERYKIT_ALLOW_MULTIPLE_WEB_INSTANCES` style flag is set, and keep docs/tests around the single-instance contract. Globalization: move restore maintenance, upload quota, rate-limit buckets, backfill status, and shared view-count buffering to DB/Redis/shared advisory-lock-backed state.

## Confirmed Negative Traces

- Auth/session: production session secret is env-only and session verification checks HMAC, timing-safe equality, max age, and DB expiry (`apps/web/src/lib/session.ts:16-35`, `apps/web/src/lib/session.ts:94-150`). Admin API routes are wrapped by `withAdminAuth`, and the lint gate passed.
- Upload processing: browser and Lightroom uploads check restore maintenance, same-origin/admin or token auth, size limits, upload quota claims, upload-processing advisory lock, disk precheck, and cleanup/settle paths. The upload-path delete helper intentionally does not throw in best-effort cleanup.
- Image queue/backfill: queue jobs use per-image advisory claims, restore quiesce/resume, output verification, deleted-mid-processing cleanup, side-effect draining on shutdown, and dedicated color-backfill locks.
- Sharing: share creation charges rate limits before protected DB mutation; public share pages validate Base56 keys before DB/rate-limit work and rate-limit only in page bodies, not metadata.
- Semantic search: text search is same-origin, restore-guarded, content-type/content-length capped, rate-limited before body parsing, mode-gated, and uses compile-guarded enrichment fields. Similar search is same-origin, restore-guarded, rate-limited, production-only, and uses the same compile-guarded enrichment fields.
- Route rate limits: the mutating public-route scanner passed. GET routes were manually swept because the scanner intentionally ignores GET; expensive OG and similar-search GET routes have manual rate limits/same-origin gates, and feed/upload/health/live routes are bounded or cacheable.
- Service worker/cache: `sw.template.js` bypasses admin, revocable share/smart/photo/map HTML, and sensitive responses; upload derivative caching uses ETag/HEAD revalidation and LRU cleanup. Next upload headers use public max-age plus revalidation.
- Deploy scripts: local deploy builds before pruning, prunes after `up -d`, keeps `docker volume prune` without `-a`, and bind-mounts only mutable data directories. Remote deploy target is config-driven.

## Missed-Issues Sweep

Rechecked the competing hypotheses after the first pass:

- No public PII leakage found in semantic enrichment; `searchEnrichmentSelectFields` carries a compile-time guard.
- No obvious service-worker caching of admin or revocable share HTML found; admin-render HTML is also marked via `x-gk-admin-render`.
- No unmetered CPU-heavy public GET found after manual sweep of OG/photo/similar/feed/upload routes.
- No upload/restore writer race found in the main upload paths; restore holds the upload-processing contract lock before maintenance/import.
- No deploy-prune data-loss issue found in the current script/compose/Dockerfile contract.

Finding count: 2.
