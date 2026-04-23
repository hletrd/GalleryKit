# Test Engineer Review — Cycle 7 (R2)

**Date:** 2026-04-19
**Reviewer:** test-engineer
**Scope:** Test coverage, test quality, TDD opportunities

## Findings

### TE-7R2-01: No unit tests for `data.ts` view count buffering logic [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/lib/data.ts` lines 25-72
- **Description:** The `bufferGroupViewCount`, `flushGroupViewCounts`, and `getNextFlushInterval` functions implement non-trivial stateful logic (buffer cap, exponential backoff, re-buffering on failure) with no unit tests. The re-buffering loop behavior (dropping increments when buffer is at capacity) is particularly important to test because it affects data integrity during DB outages.
- **Fix:** Add unit tests for: (1) buffer cap enforcement, (2) flush success resets backoff, (3) flush failure increments backoff, (4) re-buffering on failure, (5) buffer overflow during re-buffering.

### TE-7R2-02: No unit tests for `settings.ts` or `seo.ts` server actions [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`
- **Description:** The gallery settings and SEO settings server actions have validation logic (key whitelisting, value constraints, URL format validation) but no unit tests. The `updateGallerySettings` function's storage backend switch behavior is particularly important to test.
- **Fix:** Add unit tests for key validation, value validation, and the storage backend switch rollback behavior.

### TE-7R2-03: No unit tests for `image-types.ts` utility functions [LOW] [HIGH confidence]
- **File:** `apps/web/src/lib/image-types.ts` lines 50-60
- **Description:** The `hasExifData` and `nu` utility functions are used throughout the UI but have no direct unit tests. While simple, `hasExifData` has edge cases: empty strings (should return false), `0` as a number (should return true for ISO 0? currently returns false since `Number.isFinite(0)` is true — actually it returns true), `NaN` (should return false).
- **Fix:** Add quick unit tests for `hasExifData` edge cases.

## Previously Deferred Items Confirmed (No Change)

TE-38-01 through TE-38-04 remain deferred.
