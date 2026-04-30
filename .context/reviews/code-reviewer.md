# Code Review Report — code-reviewer (Cycle 9)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.
Verification: All cycle 8 findings confirmed fixed. `lint:api-auth` OK. `lint:action-origin` OK.

## Inventory reviewed

All primary source files in `apps/web/src/` (237 files): lib/ (38 files), components/ (30 files), app/ actions and routes (40+ files), db/ (3 files), __tests__/ (79+ files), config files. Focused on post-cycle-8 surface: `sanitize.ts` (AGG8R-01 fix), `topics.ts` and `seo.ts` (AGG8R-02 fix), `sanitize-admin-string.test.ts` (AGG8R-03).

## Verified fixes from cycle 8

All Cycle 8 findings confirmed FIXED:

1. C8-AGG8R-01 (stateful `/g` regex): FIXED — `sanitizeAdminString` now imports and uses `UNICODE_FORMAT_CHARS` (non-`/g`) from `validation.ts` for the `.test()` check at line 141, while keeping `UNICODE_FORMAT_CHARS_RE` (with `/g`) for `.replace()` in `stripControlChars`. The comment at line 134-140 explains the rationale.

2. C8-AGG8R-02 (`countCodePoints` not applied to topics/seo): FIXED — `topics.ts:107,207` and `seo.ts:97,100,103,106,109,115` all now use `countCodePoints()` for varchar length comparisons.

3. C8-AGG8R-03 (no unit test for `sanitizeAdminString`): FIXED — `__tests__/sanitize-admin-string.test.ts` exists and covers: normal string, bidi override, same input called twice, null input, C0 controls.

## New Findings

### C9-CR-01 (Low / Medium). `tagsString.length > 1000` in `uploadImages` still uses `.length` (UTF-16 code units) — same class as AGG7R-02/AGG8R-02

- Location: `apps/web/src/app/actions/images.ts:139`
- The `tagsString` length check uses `.length > 1000` which counts UTF-16 code units. While `tagsString` is a comma-separated tag list (not a varchar column), the intent appears to be bounding input size. Supplementary characters in tag names would be double-counted, causing premature rejection.
- Severity is low because the check is a DoS-prevention bound, not a MySQL varchar boundary, and tag names with supplementary characters are uncommon.
- Suggested fix: Use `countCodePoints(tagsString) > 1000` for consistency, or add a comment documenting that `.length` is intentionally stricter here.

### C9-CR-02 (Low / Low). `createAdminUser` username length check uses `.length` instead of `countCodePoints`

- Location: `apps/web/src/app/actions/admin-users.ts:98-99`
- `username.length < 3` and `username.length > 64` use JS `.length`. However, `username` is already validated against `/^[a-zA-Z0-9_-]+$/` on line 100, which only matches ASCII characters. So `.length` and `countCodePoints()` will always agree for valid usernames.
- Suggested fix: No code change needed. Consider adding a comment noting that `.length` is safe because the regex already restricts to ASCII.

### C9-CR-03 (Low / Low). `searchImages` in `public.ts` uses `sanitizedQuery.length > 200` — inconsistent with `countCodePoints` pattern

- Location: `apps/web/src/app/actions/public.ts:116`
- `sanitizedQuery.length > 200` uses UTF-16 code units. Like C9-CR-01, this is a DoS-prevention bound rather than a varchar boundary. The search query is not stored in a varchar column, so the mismatch does not cause data integrity issues.
- Suggested fix: Use `countCodePoints(sanitizedQuery) > 200` for consistency, or document the intentional use of `.length`.

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items remain valid with no change in status. See aggregate for full list.
