# Cycle 26 Architect / Debugger Review

Date: 2026-07-08 KST
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `101ebef57ae2a379cce4b5fa04dccd538c438b0c`
Mode: read-only specialist lane. Source code was not modified.

## Scope

Read first, per instruction:

- `AGENTS.md`
- `CLAUDE.md`
- `~/.codex/skills/review-plan-fix/SKILL.md` because this lane is part of a review-plan-fix cycle.

Focus areas: restore-maintenance state machines, admin auth/layout gating, background drains, upload/restore locks, pending cleanup queues, migration/reconcile parity, and recent Cycle 25 fixes. I treated Cycle 25's scheduled fixes as fixed at `101ebef5` unless current source contradicted them, and I did not repeat broad carry-forward items already recorded in `.context/plans/cycle-25-2026-07-08-deferred.md`.

## Findings

### C26-ARCH-01 - Durable restore-maintenance clear failure reopens the live process while the durable marker remains

Severity: High
Confidence: High
Status: Confirmed state-machine bug.

Code region:

- `apps/web/src/lib/restore-maintenance-durable.ts:121-126`
- `apps/web/src/app/[locale]/admin/db-actions.ts:674-695`
- `apps/web/src/__tests__/restore-maintenance.test.ts:104-110`

Problem:

`endDurableRestoreMaintenance()` always calls `endRestoreMaintenance()` in a `finally`, even when `clearDurableRestoreMaintenance()` throws. The restore finalizer catches that throw, logs `Failed to clear durable restore maintenance marker`, then continues the "maintenance has ended" branch: it may resume the image queue, flush pending session revocations best-effort, and drain pending file deletions.

That splits the restore-maintenance state:

- Current web process: `isRestoreMaintenanceActive()` is now `false`, so uploads, admin mutations, public writes, queue work, and maintenance sweeps can proceed.
- Durable marker on disk: still present, so sidecar scripts fail closed and any restarted web process re-enters restore maintenance via `syncRestoreMaintenanceFromDurable()`.

The regression test currently pins the unsafe behavior explicitly: `restore-maintenance.test.ts:104-110` expects process maintenance to clear even when marker removal fails.

Concrete failure scenario:

After a successful restore, `/app/data/restore-maintenance.json` cannot be unlinked because of a transient filesystem permission, bind-mount, or I/O error. The live process logs the clear failure but reopens writes and resumes background processing. Operators now have contradictory signals: the site accepts writes in the current process, sidecars refuse writes, and the next deploy/restart re-enters maintenance from the stale marker. A user may upload or mutate data in the reopened process, then an operator follows the documented recovery path for the "stale" marker without realizing writes occurred after the failed clear.

Suggested fix:

Make durable-marker clear failure fail closed. `endDurableRestoreMaintenance()` should only clear the process-local flag after the durable marker is actually removed, or it should return a structured result so callers can keep process maintenance active when marker removal fails. In `restoreDatabase()`, if clearing the marker fails, do not resume the image queue or run post-clear cleanup as if normal service resumed; return a maintenance-preserving failure that directs the operator to the recovery command. Update `restore-maintenance.test.ts` so marker-removal failure keeps `isRestoreMaintenanceActive()` true.

### C26-ARCH-02 - Protected admin layout queries session tables before checking restore maintenance

Severity: Medium
Confidence: High
Status: Confirmed ordering bug and test gap.

Code region:

- `apps/web/src/app/[locale]/admin/layout.tsx:14-18`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:15-23`
- `apps/web/src/app/actions/auth.ts:40-64`
- `apps/web/src/lib/session.ts:94-150`
- `apps/web/src/__tests__/protected-admin-restore-maintenance-layout.test.tsx:48-72`

Problem:

The protected admin layout checks authentication before checking restore maintenance:

1. The parent admin layout calls `getCurrentUser()` first and only catches/logs failures.
2. The protected child layout calls `isAdmin()` before `isRestoreMaintenanceActive()`.
3. `isAdmin()` goes through `getCurrentUser()`, `getSession()`, and `verifySessionToken()`, which reads `sessions` and may delete expired session rows.

During restore maintenance the DB is explicitly not authoritative; public topic/photo/collection layouts already skip existence lookups during the marker window. The admin protected layout does the opposite. The test named "renders a non-querying maintenance shell" only mocks `isAdmin()` as a successful promise and therefore does not prove non-querying behavior. The next test even asserts unauthenticated requests redirect before the maintenance check, which bakes in the DB-first ordering.

Concrete failure scenario:

An admin opens `/en/admin/dashboard` while a DB restore is between dump import and post-restore migration, or while `sessions` is missing/replaced. `isAdmin()` attempts to verify the cookie against `sessions` before the maintenance branch can render. Depending on timing, the request can throw, redirect to login, or attempt an expired-session delete against a table that is not stable, instead of showing the intended maintenance shell. This also adds noisy DB reads/writes during the exact window the restore drain is trying to keep quiet.

Suggested fix:

For protected admin layouts, check `isRestoreMaintenanceActive()` before any auth/session lookup and render the same generic maintenance shell used elsewhere. Do the same in the parent admin layout, or skip `getCurrentUser()` while maintenance is active so `AdminHeader` lookup cannot query a restoring DB. Adjust `protected-admin-restore-maintenance-layout.test.tsx` to assert `isAdmin` is not called when maintenance is active, and remove the assertion that unauthenticated users must be redirected before the marker check. The maintenance shell contains no sensitive admin data, so fail-closed availability is more important than proving auth against a non-authoritative DB.

## Inspected File Inventory

Guidance and cycle context:

- `AGENTS.md`
- `CLAUDE.md`
- `~/.codex/skills/review-plan-fix/SKILL.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-25-2026-07-08-plan.md`
- `.context/plans/cycle-25-2026-07-08-deferred.md`
- `.context/plans/deferred-carry-forward.md`

Restore, auth, and maintenance state:

- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/restore-maintenance-durable.ts`
- `apps/web/src/lib/admin-mutation-barrier.ts`
- `apps/web/src/lib/maintenance-scheduler.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/src/lib/pending-session-revocations.ts`
- `apps/web/src/lib/pending-file-deletions.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/lib/session.ts`

Upload, queue, backfill, API auth:

- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/src/lib/gallery-config.ts`

Schema and migration parity:

- `apps/web/src/db/schema.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/drizzle/0017_pipeline_version.sql`
- `apps/web/drizzle/0030_pending_file_deletions.sql`
- `apps/web/drizzle/meta/_journal.json`

UI/modal state touched by current source contracts:

- `apps/web/src/components/use-modal-tree-isolation.ts`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`

Tests/source contracts used as evidence:

- `apps/web/src/__tests__/restore-maintenance.test.ts`
- `apps/web/src/__tests__/restore-upload-lock.test.ts`
- `apps/web/src/__tests__/protected-admin-restore-maintenance-layout.test.tsx`
- `apps/web/src/__tests__/pending-session-revocations.test.ts`
- `apps/web/src/__tests__/maintenance-scheduler-pending-deletions.test.ts`
- `apps/web/src/__tests__/cycle-26-source-contracts.test.ts`
- `apps/web/src/__tests__/auth-actions-behavior.test.ts`
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`

## Final Missed-Issue Sweep

- Re-checked Cycle 25 aggregate/deferred items and did not re-file the known broad issues: multipart Server Action buffering, shared background budget, browser/PAT ingest duplication, warn-only singleton topology, storage abstraction quarantine, semantic scan limits, public map/search scale, migration structural parity, browser matrix, host-nginx operator validation, backup encryption, and best-effort shared-group analytics.
- Verified the Cycle 25 strict config-read fix is present in both in-app and sidecar color re-encode paths.
- Verified the Cycle 25 restore temp-file handoff fix moved ownership transfer after child handlers are registered; I did not file a duplicate.
- Checked admin API route inventory; the Lightroom upload route has restore entry/post-parse checks and the upload-processing contract lock, matching the documented equivalent fence.
- Checked migration/reconcile mentions for the new `pending_file_deletions` table and `idx_images_processed_pipeline_version`; no new mismatch was confirmed from source review.
- Did not run quality gates or browser flows in this read-only review lane. Findings are based on source inspection and existing tests only.
