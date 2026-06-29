# Debugger Review - Cycle 13

Scope: latent runtime bugs, race regressions, edge cases, stale state, flaky browser behavior, failed deployments, queue failures, data corruption, and recovery paths in `/Users/hletrd/flash-shared/gallery`.

Constraints honored:
- Read `AGENTS.md` and `CLAUDE.md` before reviewing code.
- Loaded the local `code-review` skill before finalizing this artifact because the task is a comprehensive review.
- Review-only lane: no production code edits, no deletes, and no reverts.
- Excluded `node_modules`, `.git`, build output, runtime upload/data directories, generated traces/screenshots, and historical worktree copies from behavioral claims.
- Existing modified review artifacts in `.context/reviews/` were left untouched.

## Inventory

Bug-prone flow inventory built and inspected:
- Restore/deploy/schema: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/entrypoint.sh`, `apps/web/deploy.sh`, Drizzle migrations/journal.
- Upload/processing/queue: browser upload action, Lightroom upload API, upload tracker/contract lock, original/derivative path helpers, image processor, foreground image queue, queue shutdown, admin backfill runner.
- Public APIs/data state: text search/load more, semantic/similar search APIs, public share pages/actions, analytics view writes, shared-group view buffering, data-layer selectors/privacy omissions.
- Runtime/browser surfaces: service worker template, upload serving route and shared file server, client search/load-more/home state machines, startup instrumentation and graceful shutdown.
- Operational config: root/web package manifests, Docker/compose/nginx config, Next config, scripts used by deploy/test/migration.

Review method:
- Source-first review with line-numbered citations from current files.
- Cross-file validation of locks, maintenance state, queue quiescing/resume, body-size guards, cleanup/finally paths, cache/state lifetimes, and deployment failure behavior.
- Final sweep focused on commonly missed paths: nonzero child-process exits, partially completed imports, direct-to-Node bypasses of nginx assumptions, process-local state, client aborts, symlink/path traversal, migration postconditions, and shutdown drains.

## Confirmed Issues

### DBG13-01 - Failed mysql restore can clear maintenance after a partial database import

Severity: High  
Confidence: High  
Status: Confirmed issue

Code regions:
- `apps/web/src/app/[locale]/admin/db-actions.ts:367-380` flushes shared view counts, quiesces the image queue, runs `runRestore(...)`, then records `restoreLifecycleVerified` and `keepRestoreMaintenance` only from the returned result.
- `apps/web/src/app/[locale]/admin/db-actions.ts:381-389` ends restore maintenance and resumes the image queue whenever the restore succeeded OR `keepRestoreMaintenance` is false.
- `apps/web/src/app/[locale]/admin/db-actions.ts:526-539` starts the `mysql` CLI and streams the validated dump into it.
- `apps/web/src/app/[locale]/admin/db-actions.ts:544-552` handles read/stdin/spawn failures after the import process has been created by resolving `{ success: false, error }` without `keepMaintenance: true`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:572-600` treats `mysql` exit code `0` specially and keeps maintenance only when post-restore migrations fail; a nonzero mysql exit resolves `{ success: false, error: ... }` without `keepMaintenance: true`.

Concrete failure scenario:
1. An admin uploads a plausible SQL dump that passes header and dangerous-SQL scanning.
2. The dump starts importing through `mysql`; early statements may already drop, recreate, truncate, or insert rows in application tables.
3. The mysql process exits nonzero because the dump is truncated, has a late incompatible statement, hits disk/connection failure, or otherwise fails after partial execution.
4. `runRestore` returns failure without `keepMaintenance: true`.
5. The outer `finally` sees `!keepRestoreMaintenance`, calls `endRestoreMaintenance()`, and because the queue was quiesced, calls `resumeImageProcessingQueueAfterRestore()`.

User-visible impact:
The application can resume live traffic and background image work against a partially restored database. That can expose missing rows/settings, stale queue snapshots, broken shared links, inconsistent image/file references, or follow-on processing that writes into a damaged schema/data state. The post-restore migration failure path is already treated as unsafe enough to keep maintenance; the nonzero import-exit path has the same or worse data-integrity risk.

Suggested fix:
After the mysql import process has started, fail closed. Return `keepMaintenance: true` for any nonzero mysql exit, restore stream read error, non-ignorable stdin error, or spawn/process error after the dump has been handed to mysql. Only clear maintenance after a verified full import plus successful post-restore migrations/schema health checks. Longer term, restore into a temporary database and swap only after validation, or take a verified pre-restore backup/recovery checkpoint before mutating the live database.

Suggested regression test:
Add a restore action/unit test around `runRestore` or the outer `restoreDatabase` flow that simulates a validated dump, a quiesced queue, and a mysql child `close` event with nonzero code. Assert the returned result has `keepMaintenance: true` and that the outer cleanup does not call `endRestoreMaintenance()` or resume the queue.

## Likely Issues

No additional likely issue was promoted in this cycle. The other reviewed surfaces had explicit guards or documented tradeoffs that matched the current single-instance deployment contract.

## Risks Needing Manual Validation

### RISK13-01 - Restore partial-import behavior should be rehearsed on a disposable database

Severity: High if reproduced  
Confidence: Medium  
Status: Needs manual validation

Relevant code regions:
- Same restore regions as `DBG13-01`.
- `apps/web/scripts/migrate.js:787-807` has a strong postcondition for skipped Drizzle migrations, but that only runs after a mysql exit code `0`; it does not protect a failed import that already changed data.

Validation scenario:
On a disposable database, run the admin restore flow with a dump that begins with valid app-table mutations and then contains a late syntax error or truncated INSERT. Confirm whether mysql leaves partial changes visible, whether the app exits maintenance, and whether queue processing resumes. This validates the operational blast radius, not the code defect itself.

## Coverage Evidence

Findings intentionally not reported:
- Deploy script disk cleanup was inspected and still runs prune after `up -d`, with bind-mounted data and `docker volume prune` without `-a`.
- Migration bootstrap/postcondition logic was inspected; current code fails deploy when committed journal hashes are missing after Drizzle migration.
- Upload serving route validates allowed directories/extensions/segments, rejects symlink escapes with `lstat` + `realpath`, short-circuits `HEAD`, and destroys streams on client abort.
- Image queue and backfill paths were inspected for per-image advisory locks, deleted-mid-processing cleanup, permanent failure state, retry counters, restore quiesce/resume, and bootstrap recovery. No additional concrete queue corruption issue was confirmed.
- Browser search/load-more/home state machines were checked for stale response guards, abort cleanup, mounted checks, and query-version isolation. No additional concrete flaky-browser issue was confirmed.

Verification performed:
- Static/code review only; no production code was modified and no test suite was run.
- Fresh line-numbered source inspection was collected for restore, migration, deploy, startup, DB pool, upload serving, service worker, queue/backfill, upload, search, and public data paths.
