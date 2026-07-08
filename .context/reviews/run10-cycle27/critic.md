# Run-10 Cycle 27 Critic Review

Date: 2026-07-08 KST
Reviewed HEAD: `cff8d59f0301df8f64e030adc0fb2d65e825903a`
Role: critic

I reviewed the current HEAD against the Cycle 26 plan/deferred register and the project restore-maintenance contract in `CLAUDE.md`. The Cycle 26 fixes closed the cited protected-layout and marker-clear bugs, but they leave a boundary inconsistency: "admin UI during restore" is protected only for nested protected routes, not for every admin entry point.

## Findings

### CRIT-C27-01 - Restore maintenance UX is inconsistent: `/admin` shows/probes login instead of the maintenance shell

Severity: Medium
Confidence: High

Code region:

- `apps/web/src/app/[locale]/admin/page.tsx:11-24`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:16-23`
- `apps/web/src/app/[locale]/admin/layout.tsx:15-22`

Problem:

The current patch makes protected admin routes render `PublicRestoreMaintenance` before auth, and makes the parent admin layout skip `getCurrentUser()` during maintenance. The root admin page is now the odd one out: it still probes `isAdmin()` and then renders `<LoginForm />`.

This violates the user-facing invariant implied by the Cycle 26 fix: during restore, admin surfaces should not depend on session-table truth and should present the restore-maintenance state. A visitor to `/admin/dashboard` sees maintenance; a visitor to `/admin` gets a login form after a best-effort auth probe. That is both technically risky and operationally confusing.

Failure scenario:

The operator starts a restore, then opens `/admin` to monitor/recover. Instead of the same maintenance shell used by protected routes, the page attempts auth resolution against restore-owned tables and can render a login form. The login action itself will reject with restore-in-progress, but only after the page has already presented an action the system cannot complete.

Fix:

Treat `/admin` as part of the restore-maintenance shell contract:

- check `isRestoreMaintenanceActive()` before the redirect-to-dashboard auth probe
- render `PublicRestoreMaintenance` with common restore messages
- test that maintenance-active `/admin` does not call `isAdmin()` and does not render `LoginForm`

### CRIT-C27-02 - Restore action ordering still assumes auth tables are stable after another restore already owns maintenance

Severity: Medium
Confidence: Medium-High

Code region:

- `apps/web/src/app/[locale]/admin/db-actions.ts:421-428`
- `apps/web/src/app/[locale]/admin/db-actions.ts:545-552`
- `apps/web/src/lib/session.ts:136-147`

Problem:

The restore action has two phases with different invariants:

1. Before it starts the restore, it must authenticate the admin.
2. After another request has already started restore maintenance, it should fail fast without touching restore-owned tables.

The current code only implements phase 1. A concurrent restore request checks `isAdmin()` before observing the active maintenance marker. The DB restore lock later serializes restore ownership, but the auth read has already happened.

Failure scenario:

A restore request starts and enters durable maintenance. A second restore submission arrives while the first import is dropping/recreating `sessions` or `admin_users`. The second request does not need to prove admin state at that point; it should return restore-in-progress. Instead it reads auth tables first and can produce transient DB errors or misleading unauthorized results.

Fix:

Insert a maintenance fast-path immediately after `requireSameOriginAdmin()` and before `isAdmin()` in `restoreDatabase()`. This preserves initial restore auth while making already-active restore windows fail closed without touching auth/session tables. Add a regression test/source contract specifically for `restoreDatabase()` ordering, separate from the protected-layout test.

## Critical Assessment

Cycle 26 fixed the cited lines, but the implementation is local rather than contract-wide. The real contract is not "protected layout before auth"; it is "no admin/session-table reads while restore maintenance is active, except the request that is about to establish the restore window." The current code still has two visible admin entry points outside that contract.
