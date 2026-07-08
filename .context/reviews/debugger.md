# Cycle 23 Debugger Review

Role lane: debugger
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `7054f94f2f2c7b3c339e8fd08fe4990f876e4833`
Status: review-only; no fixes implemented.

## Failure-Mode Inventory

Bug-prone files and paths inspected:

- Restore lifecycle: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/maintenance-scheduler.ts`.
- Session/logout recovery: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/pending-session-revocations.ts`, `apps/web/src/__tests__/pending-session-revocations.test.ts`.
- Pending filesystem cleanup: `apps/web/src/lib/pending-file-deletions.ts`, deletion actions, scheduler, migration/reconcile files, SQL restore scanner, pending deletion tests.
- Admin page read paths: admin root/protected layouts, dashboard/settings/analytics/users/tokens/categories/tags/seo/password/db pages, `apps/web/src/proxy.ts`, `apps/web/src/lib/api-auth.ts`.
- Public route and background behavior during restore: public page/action restore guards, view-count buffering, queue/backfill/background write modules.
- Schema/runtime contracts: Drizzle schema, migration journal, reconcile mirror, deploy scripts, docker/nginx topology, planning/deferred registers.

Validation run during review:

- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- pending-file-deletions pending-session-revocations check-action-origin migration-journal migrate-reconcile-coverage` passed: 7 files, 225 tests.
- `npm run typecheck --workspace=apps/web` passed.

## Findings

### DBG-C23-01 - A restored admin session can be valid after restore maintenance has reopened

- Severity: High
- Confidence: High
- Status: Confirmed source-ordering bug; manual race reproduction not run.
- File/region: `apps/web/src/app/[locale]/admin/db-actions.ts:650-679`; `apps/web/src/lib/pending-session-revocations.ts:62-86`; `apps/web/src/app/actions/auth.ts:286-315`; `apps/web/src/lib/session.ts:136-150`; `apps/web/src/__tests__/pending-session-revocations.test.ts:101-110`.

Failure scenario:

1. Admin logout happens during restore, so `logout()` cannot delete the session row and queues `hashSessionToken(token)`.
2. Restore imports a backup containing that same session row.
3. Restore `finally` clears the durable/process maintenance marker at `db-actions.ts:657`.
4. Only after the app is reopened does it call `flushPendingSessionRevocations()` at `db-actions.ts:671`.
5. Any request with the stale token in that gap, or after a failed flush that returns `0`, passes `verifySessionToken()` because `session.ts:136-150` sees the restored row.

Suggested fix:

Flush pending session revocations after the import succeeds but before `endDurableRestoreMaintenance()`. In the restore path, make a failed non-empty flush observable and fail closed by keeping maintenance active or returning a recovery state. Update `pending-session-revocations.test.ts:101-110` so it guards the safer ordering instead of the current one.

### DBG-C23-02 - Admin protected pages can throw or render non-authoritative state during restore

- Severity: Medium
- Confidence: High for source gap; Likely failure mode; manual browser validation not run.
- Status: Confirmed missing guard.
- File/region: `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:12-17`; `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`; `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:13-17`; `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-35`; `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx:11-13`; public contrast at `apps/web/src/app/[locale]/(public)/page.tsx:155-160`; scheduler contrast at `apps/web/src/lib/maintenance-scheduler.ts:26-46`.

Failure scenario:

An authenticated admin opens a protected SSR page while restore maintenance is active. The protected layout checks only `isAdmin()` and then renders children. Dashboard/settings/analytics/users pages execute normal DB reads while restore import may be replacing rows, rebuilding tables, or reconciling schema. Expected symptoms are intermittent 500s, stale/mixed admin state, or extra DB work in the recovery window. This is especially risky around restore completion because DBG-C23-01 temporarily reopens auth before queued revocations are proven.

Suggested fix:

Gate protected admin SSR pages on `isRestoreMaintenanceActive()` before rendering children. Return a small maintenance view that does not touch application tables, with any DB restore progress page handled as an explicit exception. Add a regression test that activates restore maintenance and proves protected admin children/data accessors are not invoked.

## Confirmed Non-Findings / Regression Checks

- The previous pending-file-deletion retry gap is fixed at the source level: `drainPendingFileDeletions()` exists and is used by both maintenance and post-restore cleanup.
- The final admin-auth sweep found the protected layout at `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:12-17`; protected pages are not relying only on `proxy.ts` cookie-shape checks.
- The action-origin, public route rate-limit, API-auth, migration journal, reconcile coverage, pending deletion, and pending revocation targeted checks all passed in this review.
- Known deferred items from Cycle 22 were not duplicated unless a new Cycle 23 failure mode was confirmed.

## Final Missed-Issues Sweep

After drafting findings, I rechecked restore marker ownership, queued cleanup ownership, admin route layering, migration mirrors, deploy topology, scanner coverage, and current deferred registers. I did not find additional confirmed debugger findings beyond the two restore/admin recovery defects listed above.
