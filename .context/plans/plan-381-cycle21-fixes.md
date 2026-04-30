# Plan 381 — Cycle 21 Fixes

**Created:** 2026-04-29 (Cycle 21)
**Status:** In Progress

## C21-AGG-01: `searchImages` uses `query.length > 200` while caller uses `countCodePoints()` — inconsistent for supplementary Unicode, and `slice(0, 200)` can split surrogate pairs

- **Source**: `apps/web/src/lib/data.ts:1082`, `apps/web/src/app/actions/public.ts:158,205`
- **Severity**: Medium / Confidence: High
- **Fix**:
  1. In `data.ts` `searchImages()`: replace `query.length > 200` with `countCodePoints(query) > 200`. Add `import { countCodePoints } from './utils'` if not already imported (check current imports).
  2. In `public.ts` `searchImagesAction()`: remove the redundant `sanitizedQuery.slice(0, 200)` at line 205 since the caller already validates length with `countCodePoints(sanitizedQuery) > 200`. The data layer guard in data.ts provides a secondary defense.
- **Progress**: [ ] data.ts fix, [ ] public.ts fix, [ ] test verification

## C21-AGG-02: `isValidTopicAlias` uses `alias.length <= 255` for a field that explicitly allows CJK/emoji

- **Source**: `apps/web/src/lib/validation.ts:85`
- **Severity**: Low / Confidence: Medium
- **Fix**: Replace `alias.length <= 255` with `countCodePoints(alias) <= 255`. Import `countCodePoints` from `@/lib/utils`.
- **Progress**: [ ] validation.ts fix, [ ] test verification

## C21-AGG-03: `isValidTagName` uses `trimmed.length <= 100` for a field that allows CJK/emoji

- **Source**: `apps/web/src/lib/validation.ts:96`
- **Severity**: Low / Confidence: Medium
- **Fix**: Replace `trimmed.length <= 100` with `countCodePoints(trimmed) <= 100`. Import `countCodePoints` from `@/lib/utils`.
- **Progress**: [ ] validation.ts fix, [ ] test verification

## Pre-existing test fix

- The `data-tag-names-sql.test.ts` test for `searchGroupByColumns` was asserting the old manually-maintained array literal pattern `const searchGroupByColumns = [` but the code was changed in a prior cycle to `const searchGroupByColumns = Object.values(searchFields)`. Updated the test to match the new derivation pattern.
- **Progress**: [x] Test fix applied, [x] Verified all 7 tests pass
