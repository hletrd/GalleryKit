# Plan 132 — Cycle 26 Fixes (C26-02, C26-05)

**Created:** 2026-04-19 (Cycle 26)
**Status:** DONE
**Severity:** 2 LOW

---

## Problem

Two LOW-severity issues identified in the cycle 26 comprehensive review:

1. **C26-02**: `prunePasswordChangeRateLimit()` in `auth-rate-limit.ts` uses `LOGIN_RATE_LIMIT_MAX_KEYS` (5000) as the hard cap for the password change rate limit Map. This creates an implicit coupling — if the login cap is changed, the password change cap changes inadvertently. The function should use its own named constant.

2. **C26-05**: In `searchImagesAction` (`public.ts`), `incrementRateLimit` runs AFTER the DB-backed rate limit check, and even executes when the check returns "limited". This causes the DB counter to overcount rejected requests, making the rate limit slightly more conservative than intended. Other actions (`sharing.ts`, `admin-users.ts`) correctly run `incrementRateLimit` BEFORE the DB check. The pattern should be consistent.

---

## Implementation Steps

### Step 1: C26-02 — Add dedicated PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS constant

**File:** `apps/web/src/lib/auth-rate-limit.ts`

1. Add a new constant: `const PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS = 5000;`
2. Replace `LOGIN_RATE_LIMIT_MAX_KEYS` with `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS` in `prunePasswordChangeRateLimit()` (line 66)

### Step 2: C26-05 — Move incrementRateLimit before DB check in searchImagesAction

**File:** `apps/web/src/app/actions/public.ts`

Current flow (lines 62-87):
1. In-memory pre-increment
2. DB check → rollback in-memory if limited
3. `incrementRateLimit` (runs even if DB said limited)

Target flow (matching `sharing.ts` pattern):
1. In-memory pre-increment
2. `incrementRateLimit` (before DB check)
3. DB check → rollback both in-memory AND skip if limited

Specifically:
- Move the `incrementRateLimit` try/catch block (lines 81-87) to before the DB check block (lines 62-79)
- The DB check block remains as-is (it already rolls back the in-memory counter)

### Step 3: Verify build

Run quality gates: eslint, tsc --noEmit, vitest, next build.

---

## Files Modified

- `apps/web/src/lib/auth-rate-limit.ts` — add `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS` constant
- `apps/web/src/app/actions/public.ts` — move `incrementRateLimit` before DB check

## Risk Assessment

- **Risk:** LOW — Both changes are small, targeted, and improve consistency with existing patterns. No behavioral regression expected.
