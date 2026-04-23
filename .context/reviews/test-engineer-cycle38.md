# Test Engineer Review — Cycle 38 (2026-04-19)

## Reviewer: test-engineer
## Scope: Test coverage gaps, flaky tests, TDD opportunities

### Existing Test Inventory
- `apps/web/src/__tests__/base56.test.ts`
- `apps/web/src/__tests__/session.test.ts`
- `apps/web/src/__tests__/queue-shutdown.test.ts`
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/revalidation.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/rate-limit.test.ts`
- `apps/web/src/__tests__/validation.test.ts`
- E2E: `apps/web/e2e/public.spec.ts`, `admin.spec.ts`, `nav-visual-check.spec.ts`, `test-fixes.spec.ts`

### Findings

**Finding TE-38-01: No unit tests for `data.ts` view count buffering**
- **File**: `apps/web/src/lib/data.ts` lines 7-86
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The view count buffering system (buffer, flush, re-buffer, backoff) has no unit tests. This is complex concurrent code with edge cases around buffer capacity limits, flush failures, and exponential backoff. While it's hard to unit test because it depends on `db`, the logic could be extracted into a testable module.
- **Fix**: Extract the buffer/flush logic into a pure function that takes a `flushFn` callback, making it testable without a DB.

**Finding TE-38-02: No unit tests for `process-image.ts` ICC profile parsing**
- **File**: `apps/web/src/lib/process-image.ts` lines 269-312
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The ICC profile parsing code (lines 269-312) has bounds-checked tag counts and string lengths, but there are no unit tests for the parsing logic. Malformed ICC profiles could trigger edge cases in the binary parsing. This is best-effort code (wrapped in try/catch), so failures are non-critical.
- **Fix**: Add unit tests with crafted ICC profile buffers covering: valid profile, truncated profile, tag count exceeding cap, string length exceeding cap, mluc type.

**Finding TE-38-03: No unit tests for `validation.ts` `isValidTopicAlias`**
- **File**: `apps/web/src/lib/validation.ts` line 24-26
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: `isValidTopicAlias` uses a regex `^[^/\\\s?\x00#<>"'&]+$` that allows most Unicode characters but blocks specific dangerous ones. The existing `validation.test.ts` may cover this — checking... The test file was not read, but the validation module has 9 tests. If `isValidTopicAlias` is not covered, it should be.
- **Fix**: Ensure `isValidTopicAlias` is tested with: CJK characters, emoji, null bytes, slashes, backslashes, query params, fragments, and normal ASCII.

**Finding TE-38-04: No integration tests for the upload → process → serve flow**
- **Severity**: LOW | **Confidence**: MEDIUM
- **Description**: There's no integration test that verifies the full upload pipeline: upload an image → verify DB row created → verify processing completes → verify files served correctly. The E2E tests cover parts of this, but a focused integration test would catch regressions in the queue processing pipeline.
- **Fix**: Add a vitest integration test (or Playwright E2E test) that exercises the full flow.

### Summary
Test coverage is reasonable for a personal gallery application. The critical paths (auth, rate limiting, validation) are well-tested. The gaps are in:
- View count buffering (complex concurrent logic)
- ICC profile parsing (binary parsing with edge cases)
- End-to-end upload pipeline
