# Run-10 Cycle 27 Causal Trace Review

Role: tracer
Date: 2026-07-08 KST
HEAD reviewed: `cff8d59f0301df8f64e030adc0fb2d65e825903a`
Scope: restore-window causal flows, competing failure hypotheses, queue/backfill/admin DB interactions, and race-condition review.

## Current Findings

### C27-TRC-01 - Restore-maintenance ordering is still incomplete outside protected layouts

Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/app/[locale]/admin/page.tsx:11-24`
- `apps/web/src/app/actions/auth.ts:331-345`
- `apps/web/src/app/actions/admin-backfill.ts:34-43`
- `apps/web/src/app/actions/admin-backfill.ts:113-121`

Causal trace:

1. `restoreDatabase()` sets durable restore maintenance and drains background queues before import.
2. Cycle 26 fixed the parent/protected layouts so they no longer query current-user/admin state before rendering maintenance.
3. `/[locale]/admin` still calls `isAdmin()` directly in the page body before any maintenance check.
4. `updatePassword()` rejects hostile origins first, then calls `getCurrentUser()` before `getRestoreMaintenanceMessage()`.
5. `triggerBackfill()` and `getBackfillStatus()` can be invoked by stale settings clients; they authenticate and, for status, compute candidate count before any maintenance response.
6. During an active restore, those paths can therefore read session/admin/settings/image state that the restore path is trying to make temporarily unavailable.

Competing hypotheses:

- "Protected layout fixed this": only true for protected admin route rendering. The login page is outside the protected layout, and server actions remain callable from stale clients.
- "These are read-only before the gate": not enough for restore safety. The issue is not post-restore data mutation; it is DB work against tables during import/migration and extra pool pressure while the restore flow is draining.
- "The actions eventually return maintenance": true for some paths, but only after auth/session or candidate-count work has already happened.

Failure scenario:

While restore maintenance is active, an old settings tab polls backfill status or an admin submits a password-change form. The request reaches session/admin queries or candidate counting before seeing the maintenance flag. If tables are being dropped/recreated or post-restore migrations are running, the user sees transient errors and the restore path competes with avoidable foreground DB work.

Fix:

Make restore-maintenance the first app-state gate after same-origin checks on stale-client-callable admin actions, and the first gate on `/admin` page rendering. Keep `restoreDatabase()` itself special because corrective restores need to be reachable under an existing maintenance marker. Add tests mirroring Cycle 26's protected-layout test: when maintenance is active, these paths return a maintenance result without invoking `isAdmin()`, `getCurrentUser()`, or candidate-count helpers.

## Non-Findings / Trace Notes

- The Cycle 26 durable marker change is causally sound: `endDurableRestoreMaintenance()` clears the marker before ending process-local maintenance, and the restore finalizer skips queue resume plus cleanup drains when marker clear fails.
- A failed import/migration path that returns `keepMaintenance: true` continues to preserve the maintenance marker and process-local flag; a drain failure without `keepMaintenance` exits maintenance without importing, which is consistent with the existing abort semantics.
- The shared queue/backfill pool-budget issue remains current but already deferred; I did not duplicate it as a new trace finding.

## Verification

Read-only review only. I traced restore setup, durable marker begin/end, finalizer branches, admin mutation barrier, image queue quiesce/resume, background analytics drain, admin entry/page auth flow, password-change action, and backfill trigger/status actions. No source or plan files were modified.
