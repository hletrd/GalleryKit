# Debugger Review - Cycle 9

Date: 2026-07-07 KST
Reviewer lane: debugger
HEAD reviewed: `ff0c79d60720`
Scope: latent bug surface, root-cause/failure-mode review, async flows, DB migration edge cases, auth/session edge cases, image processing, restore/backup, semantic search, cache invalidation, UI state, and deployment scripts.
Execution constraints honored: review-only; no application code changes; no commit, push, deploy, service stop, file deletion, or database mutation. The only written file is this review artifact.

## Result Summary

- Confirmed defects: 1 High
- Likely/risk findings: 0
- Tests run: none. This was a source-review lane and the requested deliverable was the review artifact.

The confirmed issue is a migration-path break: runtime/schema/reconcile know about `images.processing_error` and `images.failed_at`, but there is no journaled migration that adds them. Worse, migration `0025_processing_settings_snapshot` places `processing_settings_json` `AFTER failed_at`, so a clean incremental DB at the 0024 cursor fails before any later migration could repair it.

## Inventory Built First

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- code-review skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Repository inventory:

- Counted 906 review-relevant files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, `apps/web/public`, and `apps/web/nginx`.
- Counted 44 app route/page/layout/action entry files under `apps/web/src/app`.
- Inventoried migrations from `apps/web/drizzle/0000_*.sql` through `0029_*.sql`, plus `apps/web/drizzle/meta/_journal.json`.
- Inventoried high-risk scripts: `apps/web/scripts/migrate.js`, restore maintenance recovery, CLIP/color/alt-text backfills, PWA build, deploy scripts, and MySQL connection helpers.
- Inventoried static/generated surfaces: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, PWA icons, resources, `next.config.ts`, and `nginx/default.conf`.
- Inventoried tests covering relevant classes: migration/reconcile, restore scanner, API/auth/action-origin lint gates, service-worker contract tests, upload route tests, image queue/backfill tests, privacy-field tests, and Playwright flows.

Detailed areas inspected:

- Auth/session and admin auth: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/auth-rate-limit.ts`.
- Restore/backup/fencing: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`.
- DB schema/migrations: `apps/web/src/db/schema.ts`, every SQL migration, `_journal.json`, `apps/web/scripts/migrate.js`.
- Image processing/upload queue: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, upload route twins, and serving fallback.
- Semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-inference.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/app/actions/embeddings.ts`.
- Cache/UI state: service worker template/output, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/components/register-service-worker.tsx`, public data/actions, load-more/search/similar-photo client state, `apps/web/src/lib/revalidation.ts`, `apps/web/src/lib/serve-upload.ts`.
- Deployment/runtime: root and app deploy helpers, Docker/NGINX config, instrumentation startup/shutdown, single-writer guard.

## Findings

### DBG-C9-01 - High - Failed-image columns are missing from journaled migrations, breaking incremental deploys

Severity: High
Confidence: High
Validation: confirmed from source
Status: confirmed

Evidence:

- The canonical Drizzle schema declares `images.processing_error` and `images.failed_at` at `apps/web/src/db/schema.ts:104-111`.
- Runtime code writes and reads those columns:
  - permanent queue failures update `processing_error` and `failed_at` at `apps/web/src/lib/image-queue.ts:1020-1031`
  - bootstrap excludes failed rows with `isNull(images.processing_error)` at `apps/web/src/lib/image-queue.ts:1118-1120`
  - bootstrap also selects `processing_settings_json` at `apps/web/src/lib/image-queue.ts:1130-1147`
  - uploads insert `processing_settings_json` at `apps/web/src/app/actions/images.ts:478-490`
  - retry failed image reads `processing_error` at `apps/web/src/app/actions/images.ts:1261-1281` and clears `processing_error`, `failed_at`, and `processing_settings_json` at `apps/web/src/app/actions/images.ts:1300-1303`
- `reconcileLegacySchema()` can add these columns for drift/baseline cases at `apps/web/scripts/migrate.js:477-483`.
- The normal pending-tail migration path explicitly does not run reconcile when all missing migrations are above the recorded cursor; it returns so Drizzle applies the SQL files directly at `apps/web/scripts/migrate.js:886-895`.
- There is no journaled SQL migration adding `processing_error` or `failed_at`. `rg` over `apps/web/drizzle` shows no `processing_error` / `failed_at` migration entry.
- `apps/web/drizzle/0025_processing_settings_snapshot.sql:1-2` adds only `processing_settings_json` and specifies `AFTER failed_at`.
- `_journal.json` records `0025_processing_settings_snapshot` at `apps/web/drizzle/meta/_journal.json:180-186`, after `0024_drop_reactions` and before later migrations.

Why this is a bug:

The repo currently has two separate schema-evolution mechanisms with different coverage. The reconcile path knows about `processing_error` and `failed_at`, but the journaled migration path does not. The migration script deliberately bypasses reconcile for a healthy DB with only newer pending migrations, which is the right general behavior for DML-preserving migrations. That means a production DB whose `__drizzle_migrations` cursor is at 0024 and whose physical schema accurately reflects migrations through 0024 will run the raw SQL in 0025. That SQL references `failed_at` in an `AFTER failed_at` clause before any journaled migration has created `failed_at`.

Concrete failure scenario:

1. A deployed gallery has `__drizzle_migrations.created_at` at `0024_drop_reactions` and no drift-reconcile path is triggered.
2. The next deploy runs `apps/web/scripts/migrate.js`.
3. `prepareLegacyDatabaseIfNeeded()` sees all missing entries are strictly above the cursor and returns at `apps/web/scripts/migrate.js:891-894`.
4. Drizzle applies `0025_processing_settings_snapshot.sql`.
5. MySQL rejects `ALTER TABLE images ADD COLUMN processing_settings_json ... AFTER failed_at` because `failed_at` does not exist.
6. Deployment fails before app startup. If a DB ever bypassed that exact failure but still lacked the columns, image queue failure persistence, failed-image dashboard queries, retry actions, and pending-row bootstrap would then fail at runtime on unknown columns.

Suggested fix:

- Repair the migration path before relying on a later migration. A later `0030_*` migration alone cannot help the clean 0024 -> 0025 path, because 0025 fails before later migrations run.
- If 0025 has not been applied in production, update `apps/web/drizzle/0025_processing_settings_snapshot.sql` so it adds `processing_error`, `failed_at`, and `processing_settings_json` together, with `processing_settings_json` placed only after the newly-created `failed_at`.
- If 0025 may already be recorded anywhere, use an explicit repair plan: preserve the hash/journal expectations for already-applied DBs, add an idempotent preflight or replacement migration path that creates `processing_error` and `failed_at` before any SQL references them, and document the operator path for DBs stuck after a failed 0025 attempt.
- Add migration-source coverage that asserts every runtime-used schema column introduced after the baseline is backed by a journaled migration, and specifically pins that `0025_processing_settings_snapshot.sql` cannot reference `failed_at` unless the same migration creates it first or an earlier journal entry does.

## Final Sweep

No additional confirmed debugger findings after the final sweep:

- Async/background flows: image queue claim/retry/permanent failure paths, bootstrap resume, upload tracker settlement, detached config cache invalidation, background analytics writes, shutdown drains, single-writer warning guard, and view-count flushing were inspected.
- DB migration edge cases: journal cursor handling, drift baselining, postcondition hash checks, schema reconcile, DML-baseline refusal, and restore post-migration flow were inspected. DBG-C9-01 is the only confirmed migration defect found.
- Auth/session: login, logout, password change, PAT/admin API wrapper, same-origin enforcement, cookie attributes, HMAC token validation, and rate-limit rollback/no-rollback paths were inspected with no new confirmed issue.
- Restore/backup: dump header/trailer validation, SQL scanner, child-process watchdogs, durable maintenance marker handling, queue/background write drains, advisory locks, and failure-retains-maintenance behavior were inspected with no new confirmed issue.
- Image processing: original save cleanup, RAW rejection, EXIF/GPS parsing and stripping, color/HDR detection, atomic derivative writes, backup/rollback cleanup, sidecar write guards, and non-empty output verification were inspected with no new confirmed issue.
- Semantic search: mode gating, same-origin checks, body-size/content-type limits, rate-limit pre-increment, embedding dimension checks, scan caps, enrichment privacy, and CLIP model queueing were inspected with no new confirmed issue.
- Cache invalidation/UI state: service-worker template/output parity, image cache HEAD revalidation, HTML offline fallback exclusions, upload ETags/settings hash, load-more stale request guards, search abort handling, and similar-photo request state were inspected with no new confirmed issue.
- Deployment scripts: root deploy helper, app deploy script, Docker/NGINX cache/body-size policies, migration-on-entrypoint behavior, and post-deploy pruning contract were inspected with no new confirmed issue.

Residual risks:

- This lane did not execute the full test suite, browser E2E, or a real migration against a MySQL fixture; it was a source-level deep review.
- The review intentionally did not mutate application code or create a fix branch; the cycle leader owns fixes, commits, pushes, and deploys.
