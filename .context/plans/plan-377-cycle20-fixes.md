# Plan 377 — Cycle 20 Fixes

**Created:** 2026-04-29 (Cycle 20)
**Status:** Done

## Findings to Fix

### C20-AGG-01: Use `countCodePoints()` for password length validation in auth.ts and admin-users.ts

- **File:** `apps/web/src/app/actions/auth.ts:319,323` and `apps/web/src/app/actions/admin-users.ts:105,106`
- **Severity/Confidence:** MEDIUM / HIGH
- **Cross-agent agreement:** Code quality + Security perspectives
- **Plan:** Replace `newPassword.length` with `countCodePoints(newPassword)` for both the `< 12` and `> 1024` checks, consistent with the pattern used everywhere else in the codebase.
- **Status:** DONE — Fixed in both files.

### C20-AGG-02: `getTopicBySlug` in data.ts uses inline regex instead of `isValidSlug()`

- **File:** `apps/web/src/lib/data.ts:1026`
- **Severity/Confidence:** MEDIUM / HIGH
- **Plan:** Replace the inline `/^[a-z0-9_-]+$/.test(slug)` with `isValidSlug(slug)`, matching the C19-AGG-02 fix pattern.
- **Status:** DONE — Fixed.

### C20-AGG-03: `updateImageMetadata` explicitly sets `updated_at: sql\`CURRENT_TIMESTAMP\`` despite schema `.onUpdateNow()`

- **File:** `apps/web/src/app/actions/images.ts:754`
- **Severity/Confidence:** LOW / MEDIUM
- **Plan:** Remove the explicit `updated_at` from the `.set()` call. Add a comment noting `onUpdateNow()` handles it. Remove unused `sql` import.
- **Status:** DONE — Fixed.

### C20-AGG-04: `updateTag` catch block logs error without the error object

- **File:** `apps/web/src/app/actions/tags.ts:94`
- **Severity/Confidence:** LOW / HIGH
- **Plan:** Change to `catch (e) { console.error("Failed to update tag", e); }` matching the pattern in other catch blocks.
- **Status:** DONE — Fixed.

### C20-AGG-05: `deleteTag` catch block also logs error without the error object

- **File:** `apps/web/src/app/actions/tags.ts:133`
- **Severity/Confidence:** LOW / HIGH
- **Plan:** Change to `catch (e) { console.error("Failed to delete tag", e); }`.
- **Status:** DONE — Fixed.

## Deferred Items

*(No new deferred items from cycle 20. All findings were actionable and have been fixed.)*
