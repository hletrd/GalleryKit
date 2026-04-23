# Plan 227 — Cycle 11 Fresh Fixes

**Status:** In Progress
**Source review:** `.context/reviews/_aggregate-cycle11-fresh.md`
**Created:** 2026-04-23

## Scope

Address the single LOW-severity consistency finding from the cycle 11 fresh review:
`createAdminUser` fails to roll back the rate-limit counters when a username already exists (`ER_DUP_ENTRY`). The fix mirrors the generic-error rollback pattern already present in the same function.

## Tasks

### Task 1: Roll back rate limit on `ER_DUP_ENTRY` in `createAdminUser`
- **File:** `apps/web/src/app/actions/admin-users.ts`
- **Action:** In the catch branch, after the `hasMySQLErrorCode(e, 'ER_DUP_ENTRY')` check, roll back both the in-memory `userCreateRateLimit` Map entry and call `resetRateLimit(ip, 'user_create', USER_CREATE_WINDOW_MS)` for the DB counter before returning.
- **Reason:** Legitimate admin typos of existing usernames must not consume rate-limit slots, matching the login / updatePassword / createAdminUser-validation-ordering precedents.
- **Status:** Pending

### Task 2: Regression test
- **File:** `apps/web/src/__tests__/admin-user-create-ordering.test.ts`
- **Action:** Add a test that verifies, on a duplicate-username failure, the in-memory `userCreateRateLimit` Map is cleared and `resetRateLimit` is invoked with the correct arguments.
- **Status:** Pending

### Task 3: Run all gates + deploy
- **Gates:** eslint, vitest, next build (includes tsc), lint:api-auth, lint:action-origin, Playwright e2e
- **Deploy:** `npm run deploy` (per-cycle mode)
- **Status:** Pending

## Non-goals

- No refactors beyond the targeted rollback consistency fix.
- No new features.
- No changes to the `deleteAdminUser` path (not implicated).

## Deferred items

No findings are being deferred this cycle — the single actionable finding is being implemented directly.
