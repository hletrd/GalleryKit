# Code Review Report — code-reviewer (Cycle 8)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.
Verification: All gates passing. 528+ tests. `lint:api-auth` OK. `lint:action-origin` OK.

## Inventory reviewed

All primary source files in `apps/web/src/` (235 files): lib/ (38 files), components/ (30 files), app/ actions and routes (40+ files), db/ (3 files), __tests__/ (79+ files), config files. Focused review on cycle 7 fix surface: `sanitize.ts`, `utils.ts`, `data.ts`, `images.ts`, `seo.ts`, `topics.ts`.

## Summary

- Critical: 0
- High: 0
- Medium: 1
- Low: 2

## Verified fixes from prior cycles

All Cycle 7 findings confirmed FIXED or properly documented:

1. C7-CR-01 / AGG7R-01 (`getImage` redundant `IS NULL`): FIXED — standalone `IS NULL` conditions removed from undated prev/next branches (data.ts:710-718).
2. C7-CR-02 / AGG7R-02 (`updateImageMetadata` `.length` vs code points): FIXED — `countCodePoints()` helper added and used for title/description length checks.
3. C7-CR-03 / AGG7R-03 (`sanitizeAdminString` helper): FIXED — combined `stripControlChars + containsUnicodeFormatting` into one call site.

## New Findings (not in prior cycle aggregates)

### C8-CR-01 (Medium / High). `sanitizeAdminString` uses `UNICODE_FORMAT_CHARS_RE` (which has `/g` flag) with `.test()` — stateful regex alternates true/false on repeated calls

- Location: `apps/web/src/lib/sanitize.ts:136`
- The module-level `UNICODE_FORMAT_CHARS_RE` regex has the `/g` flag so it can be used with `.replace()`. However, `sanitizeAdminString` line 136 calls `UNICODE_FORMAT_CHARS_RE.test(input)` on the same regex instance. JavaScript `/g` regexes are stateful — `.test()` advances `lastIndex`, causing the second call on the same string to return `false` even when the match is still there.
- Concrete scenario: Two concurrent `sanitizeAdminString('hello‪world')` calls. The first returns `{ rejected: true }` (correct). The second returns `{ rejected: false }` because `lastIndex` was left past the match from the call in `stripControlChars` line 18. The bidi override passes through to the database.
- This is a security regression from the cycle 7 fix: before `sanitizeAdminString`, each call site used `containsUnicodeFormatting()` from `validation.ts`, which uses a separate non-`/g` regex `UNICODE_FORMAT_CHARS`.
- Suggested fix: Use a separate non-`/g` regex for the `.test()` check in `sanitizeAdminString`, or call `UNICODE_FORMAT_CHARS_RE.lastIndex = 0` before `.test()`, or use the existing `UNICODE_FORMAT_CHARS` from `validation.ts` (which is already non-`/g`).

### C8-CR-02 (Low / Medium). `topics.ts` label length validation still uses `.length` (UTF-16 code units) — same class as AGG7R-02, partially fixed

- Location: `apps/web/src/app/actions/topics.ts:103,202`
- `label.length > 100` uses JS `.length` which counts UTF-16 code units, not code points. Same issue as C7-CR-02 / AGG7R-02 which was fixed for `updateImageMetadata` using `countCodePoints()`. The topic label fix was not applied.
- Concrete scenario: A topic label containing 50 emoji characters. JS `.length` reports 100 (2 code units per emoji = 100), exactly at the limit and accepted. But 51 emoji = 102 code units = rejected even though only 51 code points (well within varchar(100)). The severity is lower here because the varchar limit (100) is short enough that emoji-heavy inputs are less common for topic labels, but it is inconsistent with the `images.ts` fix.
- Suggested fix: Replace `label.length > 100` with `countCodePoints(label) > 100`.

### C8-CR-03 (Low / Low). `seo.ts` length validations still use `.length` — inconsistent with `images.ts` fix

- Location: `apps/web/src/app/actions/seo.ts:94-112`
- All SEO field length validations use `.length > MAX_*_LENGTH` instead of `countCodePoints()`. Same class as AGG7R-02.
- Concrete scenario: An SEO title with 100 emoji characters. JS `.length` reports 200, exceeding `MAX_TITLE_LENGTH` (200) exactly — accepted. But 101 emoji = 202 code units = rejected when only 101 code points. At these shorter limits, the false-rejection window is narrow.
- Suggested fix: Use `countCodePoints()` for consistency with the `images.ts` fix, or document that `.length` is intentionally stricter for SEO fields.
