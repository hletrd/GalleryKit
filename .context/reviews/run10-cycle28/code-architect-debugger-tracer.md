# Run-10 Cycle 28 Code / Architecture / Debug / Trace Review

Date: 2026-07-08 KST
Review HEAD: `8753b939a780984b2c988fb6b75ed23ebad98ec9`
Role lane: code-reviewer + architect + debugger + tracer

## Scope

Read-only review of current HEAD only. I focused on the Cycle 27 restore-maintenance ordering patch and adjacent causal flows, then swept nearby architecture boundaries for current, non-duplicative defects. I did not edit application code.

## Relevant Files Examined

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/run10-cycle27/_aggregate.md`
- `.context/reviews/run10-cycle27/code-reviewer.md`
- `.context/reviews/run10-cycle27/architect.md`
- `.context/reviews/run10-cycle27/debugger.md`
- `.context/reviews/run10-cycle27/tracer.md`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/restore-maintenance-durable.ts`
- `apps/web/src/lib/admin-mutation-barrier.ts`
- `apps/web/src/components/public-restore-maintenance.tsx`
- `apps/web/src/__tests__/admin-page-restore-maintenance.test.tsx`
- `apps/web/src/__tests__/admin-backfill-status-shape.test.ts`
- `apps/web/src/__tests__/auth-actions-behavior.test.ts`
- `apps/web/src/__tests__/protected-admin-restore-maintenance-layout.test.tsx`
- `apps/web/src/__tests__/restore-maintenance.test.ts`
- `apps/web/src/__tests__/cycle-22-source-contracts.test.ts`
- `apps/web/src/__tests__/cycle-28-source-contracts.test.ts`

I also grep-swept restore-maintenance usage across `apps/web/src/app`, `apps/web/src/lib`, `apps/web/scripts`, and `apps/web/src/__tests__`.

## Findings

No new non-duplicative current findings.

The Cycle 27 fix at current HEAD closes the scheduled stale-client restore-maintenance ordering issue without introducing a confirmed new code-quality, correctness, architecture-boundary, race, or causal-flow defect:

- `/[locale]/admin` now checks `isRestoreMaintenanceActive()` before `isAdmin()` and returns `PublicRestoreMaintenance`, so the login entry path no longer probes session/admin tables during restore maintenance (`apps/web/src/app/[locale]/admin/page.tsx:14-24`).
- Parent admin chrome now skips `getCurrentUser()` while restore maintenance is active, preserving the protected-shell fast path (`apps/web/src/app/[locale]/admin/layout.tsx:15-22`).
- Protected admin layout still gates before `isAdmin()` and redirect (`apps/web/src/app/[locale]/admin/(protected)/layout.tsx:15-23`).
- `triggerBackfill()` now runs same-origin first, then restore-maintenance before admin auth and mutation-slot acquisition (`apps/web/src/app/actions/admin-backfill.ts:34-48`).
- `getBackfillStatus()` now returns the restore-maintenance shape before `isAdmin()` or candidate counting (`apps/web/src/app/actions/admin-backfill.ts:113-124`).
- `updatePassword()` keeps hostile-origin rejection first, then restore-maintenance before current-user/password DB work (`apps/web/src/app/actions/auth.ts:331-350`).
- The durable marker default remains production-persistent under `/app/data`, and the process flag is synchronized from that marker at boot (`apps/web/src/lib/restore-maintenance-durable.ts:18-35`, `apps/web/src/lib/restore-maintenance-durable.ts:90-124`).
- The restore action still preserves the documented corrective-restore exception by acquiring restore locks before beginning durable maintenance, and the existing concurrent-restore auth-before-lock concern remains the explicitly deferred Cycle 27 item rather than a fresh finding (`apps/web/src/app/[locale]/admin/db-actions.ts:421-480`, `apps/web/src/app/[locale]/admin/db-actions.ts:545-580`).

## Not Re-Reported

I did not duplicate already-tracked/deferred items from Cycle 27:

- `AGG-C27-02`: concurrent restore submissions authenticate before observing an active restore window. Still current, but explicitly deferred because a safe fix must distinguish corrective stale-marker restores from true concurrent restore attempts without adding an unauthenticated lock-hold DoS path.
- `AGG-C27-04`: restore finalizer durable-clear failure needs stronger action-behavior tests. Still a test-strength item, not a newly confirmed behavior bug in this pass.
- `AGG-C27-05`: public UI source-contract assertions need render-level strengthening. Still a coverage-strength item.

## Verification

Targeted tests passed:

```text
npm run test --workspace=apps/web -- src/__tests__/admin-page-restore-maintenance.test.tsx src/__tests__/admin-backfill-status-shape.test.ts src/__tests__/auth-actions-behavior.test.ts src/__tests__/protected-admin-restore-maintenance-layout.test.tsx src/__tests__/restore-maintenance.test.ts

Test Files  5 passed (5)
Tests       31 passed (31)
```

I did not run the full lint/typecheck/build/test suite because this was a read-only review lane and no source code was changed.

## Final Sweep Note

Missed-edge checks I specifically considered before stopping: stale admin login entry, parent/protected layout ordering, stale Settings backfill polling, password-change stale form submission, durable marker path persistence, restore finalizer marker-clear ordering, sidecar durable-marker guard usage, and the known concurrent-restore exception. No additional current issue was confirmed at this HEAD.
