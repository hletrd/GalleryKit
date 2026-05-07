# Test Engineer — Cycle 2 Deep Review

## C2-TE-01 (High/High): No test for `permanentlyFailedIds` cleanup on image deletion

- **File**: `apps/web/src/app/actions/images.ts:482-483`, `584-588`
- **Issue**: Cycle 1 added `permanentlyFailedIds` to track permanently failed images (C1F-DB-02), but there's no test verifying that deleting an image also removes its ID from `permanentlyFailedIds`. Without this test, the stale-ID bootstrap exclusion bug (C2-DB-01) could regress silently.
- **Fix**: Add a test that: (1) adds an ID to permanentlyFailedIds, (2) calls deleteImage(), (3) verifies the ID is removed from permanentlyFailedIds. Also test the batch deleteImages() path.
- **Confidence**: High

## C2-TE-02 (Medium/High): No test for `normalizeStringRecord` Unicode formatting character handling

- **File**: `apps/web/src/lib/sanitize.ts:35-55`
- **Issue**: `normalizeStringRecord` strips Unicode formatting characters via `stripControlChars` but does not reject them (unlike `sanitizeAdminString`). There's no test verifying this behavior. A regression in `stripControlChars` could silently allow bidi/zero-width characters into admin settings.
- **Fix**: Add a test that calls `normalizeStringRecord` with input containing Unicode bidi overrides and zero-width characters, verifying they are stripped but no `rejected` flag is returned.
- **Confidence**: High

## C2-TE-03 (Medium/Medium): No test for admin user creation password length after control-char stripping

- **File**: `apps/web/src/app/actions/admin-users.ts`
- **Issue**: If the password length check happens before `stripControlChars`, a password with control characters could pass the >= 12 check but result in a shorter effective password after stripping. There's no test for this edge case.
- **Fix**: Add a test that attempts to create an admin user with a password that is >= 12 characters but includes control characters that would reduce the effective length below 12 after stripping.
- **Confidence**: Medium

## C2-TE-04 (Low/Medium): Missing edge-case tests for `normalizeImageListCursor` with Infinity and NaN

- **File**: `apps/web/src/lib/data.ts:461-486`
- **Issue**: This was identified in cycle 1 (plan-337 Task 2) and deferred. The `normalizeImageListCursor` function validates `id` as a positive integer, but there are no explicit tests for `id: Infinity`, `id: -Infinity`, `id: NaN`, or `created_at: "Invalid Date"`. The current implementation handles these via `Number.isInteger(id)` which rejects Infinity and NaN, but explicit test coverage would prevent regressions.
- **Fix**: Add the deferred edge-case tests from plan-337 Task 2.
- **Confidence**: Medium

## C2-TE-05 (Medium/Medium): No test for view count buffer cap enforcement after re-buffering

- **File**: `apps/web/src/lib/data.ts:119-126`
- **Issue**: The post-rebuffer cap enforcement (added in cycle 1 for C1F-DB-01) has a test in `data-view-count-flush.test.ts`, but it only verifies the basic case. There's no test for the interaction between the FIFO eviction and the retry counter. A regression in the eviction logic could cause the buffer to grow unbounded during sustained DB outages.
- **Fix**: Add a test that: (1) fills the buffer to capacity, (2) triggers a flush failure, (3) verifies re-buffered entries are capped, (4) verifies the retry counter and FIFO eviction work correctly together.
- **Confidence**: Medium

## C2-TE-06 (Low/Low): `image-queue-bootstrap.test.ts` does not test the `permanentlyFailedIds` exclusion in bootstrap

- **File**: `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
- **Issue**: The bootstrap test file tests the basic bootstrap flow but does not verify that `permanentlyFailedIds` are excluded from the bootstrap query. The `image-queue.test.ts` tests the permanent failure tracking, but not the bootstrap exclusion.
- **Fix**: Add a test that: (1) adds an ID to permanentlyFailedIds, (2) runs bootstrap, (3) verifies the permanently-failed ID is NOT enqueued.
- **Confidence**: Medium

## Summary

- Total findings: 6
- High: 1
- Medium: 3
- Low: 2
