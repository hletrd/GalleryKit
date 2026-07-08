# Run-10 Cycle 27 Performance Review

Role: perf-reviewer
Date: 2026-07-08 KST
HEAD reviewed: `cff8d59f0301df8f64e030adc0fb2d65e825903a`
Scope: performance, DB connection pressure, queue/backfill/restore interactions, CPU/memory ceilings, UI responsiveness, and current carry-forward separation.

## Current Findings

### C27-PERF-01 - Some admin entry and status paths still spend DB work before restore-maintenance gating

Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/app/[locale]/admin/page.tsx:11-24`
- `apps/web/src/app/actions/auth.ts:331-345`
- `apps/web/src/app/actions/admin-backfill.ts:34-43`
- `apps/web/src/app/actions/admin-backfill.ts:113-121`

Problem:

Cycle 26 moved the admin layout and protected layout maintenance checks ahead of their auth/session reads, but several reachable admin paths still do the inverse. The login page calls `isAdmin()` before any restore-maintenance check, `updatePassword()` calls `getCurrentUser()` before checking `getRestoreMaintenanceMessage()`, `triggerBackfill()` authenticates before checking maintenance, and `getBackfillStatus()` performs auth plus candidate-count DB work without a maintenance gate.

Those paths all eventually fail closed or are normally hidden by the protected layout, but stale clients, direct server-action posts, status polling, or `/admin` requests during a restore can still consume pool connections and query unstable `sessions`, `admin_users`, `admin_settings`, or `images` state while the restore path is explicitly trying to quiesce DB writers/readers.

Failure scenario:

An operator starts a DB restore. A browser tab already on the settings page keeps polling backfill status, another stale tab submits a password-change form, or an authenticated user opens `/admin`. These requests run auth/session or backfill-count queries while restore maintenance is active. During import/migration this can produce noisy 500s, pool pressure, or reads from transiently replaced tables instead of immediately returning the maintenance shell/message.

Fix:

Add a restore-maintenance check before session/admin DB work on admin entry/status paths that do not need to initiate a corrective restore. For example, `/admin` should render `PublicRestoreMaintenance` before `isAdmin()`, `updatePassword()` should keep same-origin first but check maintenance before `getCurrentUser()`, and backfill trigger/status should return the existing unavailable/maintenance response before `isAdmin()` or candidate counting. Add source/behavior tests that assert these paths do not call `isAdmin()` / `getCurrentUser()` / candidate-count helpers while maintenance is active.

## Reviewed But Not Refiled

- `AGG-C26-06` / shared background DB budget remains current in `apps/web/src/lib/image-queue.ts` and `apps/web/src/lib/admin-backfill-runner.ts`, but it is already preserved in `.context/plans/cycle-26-2026-07-08-deferred.md` and `.context/plans/deferred-carry-forward.md`; no sharper new failure mode was found at this HEAD.
- The semantic brute-force scan and 10k-marker map ceilings remain known carry-forward scale limits with existing exit criteria; no new regression was introduced by the Cycle 26 changes.

## Verification

Read-only review only. I inspected the Cycle 26 plan/deferred files, current HEAD diff, restore finalizer, durable marker helper, image queue quiesce/resume, admin mutation barrier, background DB writes, semantic/similar routes, map rendering, load-more flow, and admin analytics/status paths. No source or plan files were modified.
