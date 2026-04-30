# Plan 133 — Cycle 40 Fixes

**Created:** 2026-04-19 (Cycle 40)
**Status:** Done

## Progress

- [x] C40-01: Fixed — changed `LOGIN_RATE_LIMIT_MAX_KEYS` to `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS` in `auth-rate-limit.ts`, removed unused import. Commit: 000000011
- [x] C40-04: Fixed — extracted `formatShutterSpeed` to `image-types.ts`, updated both `photo-viewer.tsx` and `info-bottom-sheet.tsx`. Commit: 000000037
- [x] C40-05: Fixed — added `aria.deleteUser` key to en.json and ko.json, updated `admin-user-manager.tsx`. Commit: 000000059

## Issues to Fix

### C40-01: `prunePasswordChangeRateLimit` uses wrong constant for hard-cap eviction [MEDIUM]
- **File:** `apps/web/src/lib/auth-rate-limit.ts` lines 68-69
- **Problem:** The excess calculation on line 68 uses `LOGIN_RATE_LIMIT_MAX_KEYS` (imported from rate-limit.ts) instead of the local `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS`. Both are currently 5000, but this is a latent bug — if the login limit key cap changes independently, the password change Map eviction will silently use the wrong threshold.
- **Fix:** Change `LOGIN_RATE_LIMIT_MAX_KEYS` to `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS` on line 68.
- **Confidence:** HIGH — clear copy-paste error.

### C40-04: Shutter speed formatting duplicated between photo-viewer and info-bottom-sheet [LOW]
- **File:** `apps/web/src/components/photo-viewer.tsx` lines 382-395, `apps/web/src/components/info-bottom-sheet.tsx` lines 124-135
- **Problem:** The shutter-speed formatting logic (converting decimal to 1/N fraction) is duplicated. If the formatting logic changes, it must be updated in two places.
- **Fix:** Extract a shared `formatShutterSpeed` function to `apps/web/src/lib/image-types.ts` (already shared between both components). Update both components to use it.
- **Confidence:** LOW — maintainability concern, not a bug.

### C40-05: Admin user delete button has generic aria-label [LOW]
- **File:** `apps/web/src/components/admin-user-manager.tsx` line 147
- **Problem:** The delete button uses `t('aria.deleteItem')` instead of a username-specific label. Screen readers cannot distinguish which user is being deleted.
- **Fix:** Add `aria.deleteUser` key to en.json and ko.json translation files. Update the delete button's aria-label to include the username.
- **Confidence:** MEDIUM — accessibility improvement.

## Deferred Items

### C40-02: `exportImagesCsv` loads up to 50K rows into memory [LOW]
- **File+Line:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 37-52
- **Severity/Confidence:** LOW / MEDIUM
- **Reason for deferral:** Previously deferred as PERF-38-02. Streaming refactor is a significant change for a LOW-severity item. The current code already caps at 50K and releases the results array before building the CSV. This is adequate for the expected gallery size.
- **Exit criterion:** Gallery grows beyond 50K images or memory pressure becomes measurable.

### C40-03: Withdrawn — not a real bug
- **Note:** Initially flagged as stale state reference in `handleDelete`, but closer inspection shows the code is correct.
