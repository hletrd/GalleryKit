# Plan 325: Cycle 8 — Fix stateful `/g` regex in `sanitizeAdminString`

Date: 2026-04-29
Status: active

## Overview

Fixes the MEDIUM-severity finding AGG8R-01 (7 agents): `sanitizeAdminString` uses `UNICODE_FORMAT_CHARS_RE` (which has the `/g` flag) with `.test()`, causing the `rejected` flag to alternate between `true` and `false` on repeated calls. This violates the C7-AGG7R-03 design intent that admins should be informed when their input contains Unicode formatting characters.

---

## Task 1: Replace `UNICODE_FORMAT_CHARS_RE.test()` with non-`/g` regex in `sanitizeAdminString` (AGG8R-01)

**Severity**: MEDIUM | **Confidence**: HIGH | **Cross-agent**: 7 agents

**Problem**: `sanitizeAdminString` (sanitize.ts:136) calls `UNICODE_FORMAT_CHARS_RE.test(input)` on a regex that has the `/g` flag. JavaScript `/g` regexes are stateful — `.test()` advances `lastIndex`, causing the second call on the same string to return `false` even when the match is still there. This makes the `rejected` flag alternate between `true` and `false` across consecutive calls.

**File**: `apps/web/src/lib/sanitize.ts:13,136`

**Fix**:
- Import `UNICODE_FORMAT_CHARS` from `@/lib/validation` (which is the same character set but WITHOUT the `/g` flag) for the `.test()` check at line 136.
- Keep `UNICODE_FORMAT_CHARS_RE` (with `/g`) for the `.replace()` call in `stripControlChars` at line 18.
- The `UNICODE_FORMAT_CHARS` regex in `validation.ts` is already the correct non-`/g` variant — no new regex definition needed.

**Code change**:
```typescript
// In sanitize.ts, add import:
import { UNICODE_FORMAT_CHARS } from '@/lib/validation';

// In sanitizeAdminString, line 136, change:
//   if (UNICODE_FORMAT_CHARS_RE.test(input)) {
// to:
//   if (UNICODE_FORMAT_CHARS.test(input)) {
```

**Test**: Add `__tests__/sanitize-admin-string.test.ts` with test cases:
1. Normal string → `{ value: string, rejected: false }`
2. String with bidi override (U+202A) → `{ value: string, rejected: true }`
3. Same bidi-override input called twice → both calls return `rejected: true`
4. Null input → `{ value: null, rejected: false }`
5. String with C0 controls only → `{ value: stripped, rejected: true }`
6. String with zero-width char (U+200B) → `{ value: string, rejected: true }`

---

## Task 2: Apply `countCodePoints()` to `topics.ts` and `seo.ts` length validations (AGG8R-02)

**Severity**: LOW | **Confidence**: MEDIUM | **Cross-agent**: 5 agents

**Problem**: `topics.ts:103,202` uses `label.length > 100` and `seo.ts:94-112` uses `.length > MAX_*_LENGTH` — all using JS `.length` (UTF-16 code units) instead of `countCodePoints()`. The C7-AGG7R-02 fix was only applied to `images.ts`; the follow-up scan called for in plan-158 was not completed.

**Files**:
- `apps/web/src/app/actions/topics.ts:103,202`
- `apps/web/src/app/actions/seo.ts:94-112`

**Fix**:
- In `topics.ts`, add `import { countCodePoints } from '@/lib/utils';` and replace:
  - `label.length > 100` → `countCodePoints(label) > 100` (line 103 and 202)
- In `seo.ts`, add `import { countCodePoints } from '@/lib/utils';` and replace all `.length > MAX_*_LENGTH` checks with `countCodePoints() > MAX_*_LENGTH`:
  - `sanitizedSettings.seo_title.length > MAX_TITLE_LENGTH` → `countCodePoints(sanitizedSettings.seo_title) > MAX_TITLE_LENGTH`
  - Same for `seo_description`, `seo_nav_title`, `seo_author`, `seo_locale`, `seo_og_image_url`

**Test**: The existing `code-point-length.test.ts` covers `countCodePoints()` in isolation. Add a test verifying that `countCodePoints` is used consistently by checking that no `.length > ` pattern remains in action files for MySQL varchar limit comparisons (optional — a grep-based fixture test).

---

## Deferred items (no new deferrals this cycle)

All prior deferred items remain valid. No new items to defer.
