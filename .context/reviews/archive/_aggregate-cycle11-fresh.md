# Aggregate Review -- Cycle 11 Fresh (2026-04-23)

## Summary

Cycle 11 fresh deep review of the full repository, focused on rate-limit consistency and error-handling. Found **1 new actionable LOW-severity finding**; no CRITICAL, HIGH, or MEDIUM findings.

Gates all green at start of cycle: eslint, vitest (297/297), next build (+ tsc), lint:api-auth, lint:action-origin, Playwright (19/19 in chromium).

HEAD at review start: `a308d8c`

## Files Reviewed

Full review scope mirrors cycle 10 rpl (see `_aggregate-cycle10-rpl.md` for the exhaustive list). Key hot-paths revisited for consistency in this cycle:

- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/data.ts`

## Findings

### C11R-FRESH-01 — `createAdminUser` does not roll back rate-limit on `ER_DUP_ENTRY`
- **Severity:** LOW (usability with admin-only impact, minor security-consistency dimension)
- **Confidence:** High
- **File:** `apps/web/src/app/actions/admin-users.ts`
- **Lines:** 159-173 (catch branch)
- **Agents agreed:** code-reviewer + security-reviewer both flagged this (high-signal).
- **Problem:** When `db.insert(adminUsers)` throws `ER_DUP_ENTRY` (duplicate username), the catch branch returns `{ error: t('usernameExists') }` WITHOUT rolling back either the in-memory `userCreateRateLimit` Map entry or the DB-backed `rate_limit_buckets` counter. The generic-error branch at lines 163-171 correctly rolls back both. A legitimate admin typing a duplicate username will consume a rate-limit slot.
- **Failure scenario:** An admin attempts to create 10 new users within a 1-hour window, each time typing a username that happens to match an existing admin (common in environments with standardized naming). On the 11th attempt — regardless of whether it's a fresh, legitimate username — the rate-limit locks them out for the rest of the hour. The admin has done nothing abusive.
- **Inconsistency with codebase patterns:** The established pattern across `login` (AGG9R-RPL-01), `updatePassword` (AGG9R-RPL-01), and `createAdminUser`'s own form-field validation ordering (AGG10R-RPL-01) is: legitimate client-side user errors must NOT consume rate-limit slots. Duplicate-username is the same class of user-error and deserves the same rollback treatment.
- **Fix:** Add rollback in the catch branch before the `usernameExists` return. Pattern should match lines 166-171 from the generic-error path:
  ```typescript
  if (hasMySQLErrorCode(e, 'ER_DUP_ENTRY')) {
      try {
          await resetRateLimit(ip, 'user_create', USER_CREATE_WINDOW_MS);
      } catch {
          // DB unavailable
      }
      resetUserCreateRateLimit(ip);
      return { error: t('usernameExists') };
  }
  ```
- **Regression test:** Add to `admin-user-create-ordering.test.ts` — verify that a duplicate-username failure rolls back both the in-memory `userCreateRateLimit` Map entry and calls `resetRateLimit` for the DB bucket.
- **Deferrable?** No — this is an actionable, in-scope consistency fix matching established patterns.

## Previously-addressed findings confirmed fixed
- **AGG10R-RPL-01** (`createAdminUser` form-field validation ordering): lines 89-104.
- **AGG9R-RPL-01** (`updatePassword` form-field validation ordering): lines 288-306.
- **C46-01** (`tagsString` sanitize-before-validate): `images.ts` line 103.
- **C46-02** (`searchImagesAction` query sanitize-before-validate): `public.ts` line 29.
- **C7R2-01 / C7R2-02** (control-char rejection in topics/aliases): all branches intact.
- **C2R-01** (`unstable_rethrow` in `updatePassword`): line 399.

## Areas of strength (unchanged)
1. Rate-limit rollback on infrastructure errors is universal across login, password change, share creation, and user creation's generic-error path (one gap remaining at duplicate-username).
2. Privacy guards are compile-time enforced.
3. Same-origin checks on all mutating actions are lint-enforced.
4. Path traversal defense is layered and complete.
5. `unstable_rethrow` consistently applied before generic-failure returns.

## Previously deferred items
No change. See `plan-226-cycle10-rpl-deferred.md` and earlier deferred plans.

## Agent failures
None — parallel specialist reviews (code-reviewer, security-reviewer) all returned successfully.

## Totals
- **0 CRITICAL** findings
- **0 HIGH** findings
- **0 MEDIUM** findings
- **1 LOW** finding (C11R-FRESH-01) — schedule for implementation this cycle
