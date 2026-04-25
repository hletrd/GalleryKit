# Test Engineer — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Lens

Test coverage, missing assertions, flakiness, contract drift.

## Inventory

- 59 test files in `apps/web/src/__tests__/`
- E2E in `apps/web/e2e/`
- `containsUnicodeFormatting` has explicit unit coverage in `validation.test.ts:204-234`
- `images-actions.test.ts` mocks `settleUploadTrackerClaim` (good — isolates tracker logic).

## Findings

### C7L-TE-01 — No test for `images.ts:141-149` tag count-mismatch path
- File: `apps/web/src/app/actions/images.ts:141-149` and `__tests__/images-actions.test.ts`
- Severity: LOW
- Confidence: Medium
- Issue: The branch `tagsString && tagNames.length !== tagsString.split(',').filter(...)` (count-mismatch check) does not appear to have a dedicated test. A regression that loosens `isValidTagName` would silently widen the accepted set without breaking any test.
- Suggested fix: Add a test where one tag in the batch fails `isValidTagName` and assert `error: 'invalidTagNames'`.

### C7L-TE-02 — Confirm `settleUploadTrackerClaim` not double-called in success path
- File: `apps/web/src/__tests__/images-actions.test.ts`
- Severity: INFO
- Confidence: High
- Issue: Existing test mocks the function; an assertion that `settleUploadTrackerClaimMock` is called exactly once per `uploadImages` invocation would lock in the AGG7R-21 deferred concern (now confirmed not a bug).
- Suggested fix: Add `expect(settleUploadTrackerClaimMock).toHaveBeenCalledTimes(1)`.

### C7L-TE-03 — Bootstrap continuation reentrancy
- File: `apps/web/src/lib/image-queue.ts:366-380` and `__tests__/image-queue.test.ts`
- Severity: INFO
- Confidence: Medium
- Issue: The cursor-paginated bootstrap with `scheduleBootstrapContinuation` has subtle reentrancy guarantees. A test that simulates ≥2 batches (more than `BOOTSTRAP_BATCH_SIZE=500` rows) would lock in the pagination contract.
- Suggested fix: Defer; nontrivial mock setup.
