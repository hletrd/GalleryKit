# Cycle 26 Debugger Review

Review target: `/Users/hletrd/flash-shared/gallery`
Review role: `cycle-26 debugger`
HEAD reviewed: `d13d6637`
Mode: review-only. Source code was not changed.

## Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory evidence before review:

- `git ls-files`: 2,588 tracked files.
- Main runtime tree: `apps/` with 617 tracked files.
- Review/history tree: `.context/` with 1,773 tracked files; `plan/` with 180 tracked files.
- Focused runtime/script/migration source: 85,385 lines across `apps/web/src`, `apps/web/scripts`, and `apps/web/drizzle`.

Reviewed debugger surfaces:

- Restore lifecycle: DB restore action, durable maintenance marker, auth/login behavior, queue quiesce/resume, advisory locks, migration post-restore handling.
- Public analytics: fire-and-forget view recording, restore gates, rate-limit rollback, shared-group counters.
- Upload/process: browser and Lightroom upload paths, GPS stripping, original cleanup, image queue claim/update/delete races.
- Background work: image queue, admin color backfill, semantic embedding backfill, CLIP inference gates, shutdown drains.
- Deploy/runtime: deploy health gate, Docker health check, startup instrumentation.

Current HEAD already fixed several cycle-25 debugger findings: deploy now waits for health before pruning; CLIP embedding generation checks restore maintenance before expensive inference; analytics view recorders have late maintenance checks after validation. The findings below are current remaining failure modes.

## Findings

### DBG26-01 - Failed restore can persist a durable maintenance lock with no in-app recovery path

Severity: High
Confidence: High
File/region: `apps/web/src/app/[locale]/admin/db-actions.ts:492-499`, `apps/web/src/app/[locale]/admin/db-actions.ts:671-680`, `apps/web/src/app/[locale]/admin/db-actions.ts:716-731`, `apps/web/src/lib/restore-maintenance-durable.ts:37-44`, `apps/web/src/lib/restore-maintenance-durable.ts:60-78`, `apps/web/src/app/actions/auth.ts:74-78`

Failure scenario: `beginDurableRestoreMaintenance()` writes `data/restore-maintenance.json`. If mysql import times out/fails or post-restore migrations fail, `runRestore()` resolves with `keepMaintenance: true`, and the outer finally intentionally does not call `endDurableRestoreMaintenance()`. On restart, instrumentation syncs the durable marker back into process state. Login then returns `restoreInProgress`, so an operator whose session is invalidated by the partial restore cannot use the app to upload a good dump, inspect state, or clear maintenance. Recovery requires out-of-band shell access to the marker/DB, which is fragile during the exact incident this mode is meant to handle.

Concrete fix: add a narrow durable restore recovery surface. Options: a recovery-token-authenticated endpoint or CLI command that can upload another dump, re-run post-restore migrations, or explicitly clear the marker after verification. Keep normal admin mutations blocked, but allow recovery even when maintenance is active. Add tests for failed mysql import, failed post-restore migration, restart with marker present, login behavior, and the recovery-only clear path.

### DBG26-02 - Fire-and-forget analytics inserts can still cross the restore boundary

Severity: Medium
Confidence: Medium
File/region: `apps/web/src/app/actions/public.ts:416-437`, `apps/web/src/app/actions/public.ts:443-469`, `apps/web/src/app/actions/public.ts:475-505`, `apps/web/src/app/[locale]/admin/db-actions.ts:482-489`

Failure scenario: the view recorders check maintenance at entry and again immediately before starting `db.insert(...)`, which closes the large pre-validation window. But the insert promise is still fire-and-forget and untracked. Restore preparation flushes shared-group count buffers and quiesces the image queue, but it does not wait for in-flight `imageViews`, `topicViews`, or `sharedGroupViews` insert promises. A view action can pass the late gate, enqueue its insert, and then restore can begin importing a different database before that insert obtains a connection or commits. The insert may fail on FK errors, or worse, commit against restored IDs and pollute post-restore analytics with a pre-restore event.

Concrete fix: route analytics writes through a small tracked queue with pause/drain semantics and have restore wait for it, mirroring image side-effect drains. A minimal improvement is to await these inserts after the late gate so the action lifetime tracks the write, but the robust fix is `trackAnalyticsWrite()` plus `quiesceAnalyticsWritesForRestore()` before import.

## Refuted / Fixed Current-HEAD Hypotheses

- Image queue worker pool starvation from `QUEUE_CONCURRENCY=5`: refuted in current HEAD. `resolveImageQueueConcurrency()` now caps workers with `(poolLimit - reserved) / 2`.
- CLIP inference after restore begins: refuted in current HEAD. `storeImageEmbeddingForMode()` returns before `embedImageReal()` when maintenance is active.
- Deploy success without health evidence: refuted in current HEAD. `deploy.sh` waits for Docker health or `/api/live`, prints logs, and exits non-zero before prune on failure.
- Duplicate image processing after bootstrap/enqueue races: refuted by per-image advisory locks, `processed=false` row checks, and conditional updates.
- Upload/restore save/insert interleaving: mostly refuted by the upload-processing contract lock and late post-save maintenance cleanup in both browser and Lightroom upload paths. The remaining upload issue is performance/lock scope, reported by the perf role.
- Serve-upload path traversal/symlink race: refuted by path segment validation, whitelist checks, `lstat` symlink rejection, realpath containment, and fd-based stat/streaming.

## Final Sweep

Final missed-issues sweep covered restore failure states, all `isRestoreMaintenanceActive()` call sites, `GET_LOCK`/`RELEASE_LOCK` paths, fire-and-forget promises, upload cleanup, queue side effects, deployment health contracts, non-sargable/archive queries, and prior cycle reports. No source tests were run because this was a static review-only artifact change. Evidence is exact source inspection above.
