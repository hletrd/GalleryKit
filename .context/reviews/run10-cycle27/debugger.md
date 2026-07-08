# Run-10 Cycle 27 Debugger Review

Date: 2026-07-08 KST
Reviewed HEAD: `cff8d59f0301df8f64e030adc0fb2d65e825903a`
Role: debugger

Scope read: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `cycle-26-2026-07-08-plan.md`, `cycle-26-2026-07-08-deferred.md`, Cycle 26 aggregate, and the current Cycle 26 change surface at HEAD. I avoided repeating the Cycle 26 fixed findings and the explicitly deferred carry-forward DB-budget/test-strength items.

## Findings

### DBG-C27-01 - `/admin` login page still queries auth/session tables during restore maintenance

Severity: Medium
Confidence: High

Code region:

- `apps/web/src/app/[locale]/admin/page.tsx:11-24`
- `apps/web/src/app/actions/auth.ts:41-64`
- `apps/web/src/lib/session.ts:136-147`

Problem:

Cycle 26 moved the parent admin layout and protected admin layout to check restore maintenance before session/auth lookups, but the unprotected admin login page still calls `isAdmin()` before any restore-maintenance check:

```ts
let alreadyAdmin = false;
try {
    alreadyAdmin = await isAdmin();
} catch (err) {
    console.error('Admin login: failed to check current admin session', err);
}
```

`isAdmin()` goes through `getCurrentUser()` and `verifySessionToken()`, which reads `sessions`, reads `admin_users`, and can delete an expired `sessions` row. During a DB restore those tables are not authoritative and may be mid-drop/import.

Failure scenario:

An admin visits `/en/admin` or `/ko/admin` while a restore import/migration is in progress. The protected routes render the maintenance shell without querying auth, but the login route still probes the session DB path first. Depending on restore timing, the request can log DB errors, read partially restored auth state, or attempt an expired-session delete against a table being replaced. The page then falls through to the login form, which is also misleading during a restore window.

Fix:

Add a restore-maintenance branch at the top of `AdminPage`, before `isAdmin()`, mirroring the protected layout:

- import `isRestoreMaintenanceActive`
- import/render `PublicRestoreMaintenance`
- load `getTranslations('common')` only for the maintenance shell
- return the shell before `isAdmin()`
- add a focused test that mocks maintenance active and asserts `isAdmin()` is not called for `app/[locale]/admin/page.tsx`

### DBG-C27-02 - Concurrent restore submissions still authenticate against unstable restore tables

Severity: Medium
Confidence: High

Code region:

- `apps/web/src/app/[locale]/admin/db-actions.ts:421-428`
- `apps/web/src/lib/restore-maintenance.ts:29-30`
- `apps/web/src/app/actions/auth.ts:63-64`
- `apps/web/src/lib/session.ts:136-147`

Problem:

`restoreDatabase()` is the action that opens the durable restore window, so it correctly cannot reject on maintenance before the first restore starts. However, once one restore has begun and `beginDurableRestoreMaintenance({ allowExisting: true })` has set the process marker, a second same-origin restore submission still executes:

```ts
const originError = await requireSameOriginAdmin();
if (originError) return { success: false, error: originError };
if (!(await isAdmin())) {
    return { success: false, error: t('unauthorized') };
}
```

That means duplicate clicks, stale tabs, or retries during the active restore window query the same `sessions`/`admin_users` tables the current cycle just protected layout rendering from touching.

Failure scenario:

An admin double-submits a restore or opens a second DB restore tab while the first import is running. The second request passes same-origin, then `isAdmin()` reads `sessions` and `admin_users` while the first request is replacing those tables. It may produce transient 500/log noise, make an expired-session delete against restore-owned state, or return misleading unauthorized/failed auth instead of the intended restore-in-progress result.

Fix:

After the same-origin guard and before `isAdmin()`, check the process restore marker:

```ts
const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
if (maintenanceError) return { success: false as const, error: maintenanceError };
```

This does not block the initial restore because the marker is inactive before that request starts. It only short-circuits concurrent/retry submissions after the restore window is active. Add a source or behavior test that places the maintenance check before `isAdmin()` in `restoreDatabase()`.

## Debug Notes

- Cycle 26's durable marker-clear fix is directionally correct: `endDurableRestoreMaintenance()` now clears the durable marker before ending process-local maintenance, and the finalizer resumes queues/cleanup only after the marker clear is proven.
- The remaining bug class is narrower: entry points outside the protected layout still reach auth before the active restore marker. The login page and concurrent restore action are the two concrete paths found in this pass.
