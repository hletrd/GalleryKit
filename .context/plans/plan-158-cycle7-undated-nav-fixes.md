# Plan 158: Cycle 7 Fixes — Undated Navigation, Code-Point Length, Admin String Sanitization

Date: 2026-04-29
Status: completed

## Overview

Addresses the top-priority findings from the Cycle 7 review (AGG7R-01, AGG7R-02, AGG7R-03).

---

## Task 1: Remove redundant standalone `IS NULL` from undated prev/next navigation (AGG7R-01)

**Severity**: MEDIUM | **Confidence**: MEDIUM | **Cross-agent**: 6 agents

**Problem**: `getImage()` undated prev/next navigation (data.ts:703-713) includes a standalone `capture_date IS NULL` condition that subsumes the more selective composite conditions (`IS NULL AND created_at > X`, `IS NULL AND created_at = X AND id > Y`). Combined with `or()`, the standalone condition matches ALL undated rows, making the composite conditions dead SQL. The query is functionally correct (ORDER BY + LIMIT 1 picks the right row) but wastes MySQL optimizer time and could confuse debugging.

**File**: `apps/web/src/lib/data.ts:703-713`

**Fix**:
- Remove the standalone `sql\`${images.capture_date} IS NULL\`` condition from both `prevConditions` (line 704) and `nextConditions` (line 710) in the undated branch.
- Keep the composite conditions: `and(sql\`${images.capture_date} IS NULL\`, gt(images.created_at, ...))` and `and(sql\`${images.capture_date} IS NULL\`, eq(images.created_at, ...), gt(images.id, ...))`.

**Test**: Add a unit test in `__tests__/data-adjacency-source.test.ts` or a new test file that verifies the undated prev/next condition structure does not include a standalone `IS NULL` without a secondary condition.

---

## Task 2: Fix `.length` to code-point counting in `updateImageMetadata` and related validations (AGG7R-02)

**Severity**: LOW | **Confidence**: MEDIUM | **Cross-agent**: 6 agents

**Problem**: `updateImageMetadata` (images.ts:711,717) uses `.length` which counts UTF-16 code units. Emoji/supplementary characters count as 2 units each, causing false rejections for emoji-heavy titles that would fit in MySQL `varchar(255)`. Same issue may exist in other admin string length validations that compare against MySQL varchar limits.

**Files**: 
- `apps/web/src/app/actions/images.ts:711,717`
- Scan all admin string length validations for the same pattern

**Fix**:
- Replace `sanitizedTitle.length > 255` with `[...sanitizedTitle].length > 255` (or create a shared `countCodePoints(s)` helper in `lib/utils.ts`).
- Replace `sanitizedDescription.length > 5000` with `[...sanitizedDescription].length > 5000`.
- Scan other admin string validations: `seo.ts` (MAX_TITLE_LENGTH=200, etc.), `topics.ts` (label.length > 100), `tags.ts` (trimmedName.length, slug length). These use shorter limits where emoji-heavy inputs are less likely, but should be consistent.

**Test**: Add a test case with emoji-heavy strings where `.length` > limit but code-point count <= limit. Verify the title is accepted.

---

## Task 3: Create `sanitizeAdminString()` helper combining `stripControlChars` + `containsUnicodeFormatting` (AGG7R-03)

**Severity**: LOW | **Confidence**: MEDIUM | **Cross-agent**: 3 agents

**Problem**: `stripControlChars` (sanitize.ts) and `containsUnicodeFormatting` (validation.ts) are separate functions that must be called together at 15+ call sites. Risk of future call-site omission allowing bidi/zero-width characters through.

**Files**:
- `apps/web/src/lib/sanitize.ts` — add new helper
- All action files that call both `stripControlChars` and `containsUnicodeFormatting`

**Fix**:
- Add `sanitizeAdminString(value: string | null | undefined): { value: string | null; rejected: boolean }` to `sanitize.ts` that:
  1. Calls `stripControlChars(value)` to remove C0/C1 controls
  2. Calls `containsUnicodeFormatting(result)` to check for bidi/zero-width characters
  3. Returns `{ value: sanitized, rejected: true }` if Unicode formatting found, `{ value: sanitized, rejected: false }` otherwise
- Migrate call sites in `updateImageMetadata`, `updateSeoSettings`, `createTopic`, `updateTopic`, `updateTag`, `addTagToImage`, etc. to use `sanitizeAdminString` instead of the two-step pattern.
- Keep `stripControlChars` and `containsUnicodeFormatting` as lower-level primitives for backward compatibility and for call sites that need only one of the two checks.
- Also add the Unicode formatting characters to `stripControlChars` so stripping covers both categories (defense-in-depth: the rejection check still runs as a secondary guard).

**Test**: Add unit tests for `sanitizeAdminString` covering:
- Normal string → `{ value: string, rejected: false }`
- String with C0 controls → stripped, `{ value: clean, rejected: false }`
- String with bidi override → `{ value: null, rejected: true }`
- String with zero-width char → `{ value: null, rejected: true }`
- Null input → `{ value: null, rejected: false }`

---

## Task 4: Update CLAUDE.md documentation (AGG7R-05, AGG7R-06)

**Severity**: LOW

**Fix**:
- Add blur placeholder quality and cap details to "Image Processing Pipeline" section.
- Add `(user_filename)` index purpose to "Database Indexes" section.

---

## Deferred items (carried forward with no change)

All prior deferred items remain valid. No new items to defer from this cycle's review.
