# Test Engineer Review — Cycle 17

## Inventory of test files

- `apps/web/src/__tests__/auth-no-rollback-on-infrastructure-error.test.ts`
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`
- `apps/web/src/__tests__/auth-rethrow.test.ts`
- `apps/web/src/__tests__/image-queue.test.ts`
- `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
- `apps/web/src/__tests__/data-view-count-flush.test.ts`
- `apps/web/src/__tests__/sanitize.test.ts`
- `apps/web/src/__tests__/sanitize-admin-string.test.ts`
- `apps/web/src/__tests__/data-tag-names-sql.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `apps/web/src/__tests__/check-api-auth.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/content-security-policy.test.ts`
- `apps/web/src/__tests__/process-image-blur-wiring.test.ts`
- `apps/web/src/__tests__/images-action-blur-wiring.test.ts`

## Findings

### C17-TE-01: No test for `TRUST_PROXY` unset causing shared rate-limit bucket
- **Confidence**: High
- **Severity**: Medium
- **Location**: Missing test for `apps/web/src/lib/rate-limit.ts:117`
- **Issue**: When `TRUST_PROXY` is not set and proxy headers are present, `getClientIp` returns "unknown", causing all IPs to share one rate-limit bucket. There is no test verifying this behavior or warning the developer.
- **Fix**: Add a test that verifies `getClientIp` returns "unknown" when `TRUST_PROXY !== 'true'` and X-Forwarded-For is present, and verify that the warning is logged.

### C17-TE-02: No test for `permanentlyFailedIds` cap (MAX_PERMANENTLY_FAILED_IDS = 1000)
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/lib/image-queue.ts:73,341-345`
- **Issue**: The FIFO eviction on `permanentlyFailedIds` when it exceeds 1000 entries has no unit test. While the set rarely approaches this size, the eviction logic should be verified.
- **Fix**: Add a test that adds more than 1000 IDs to `permanentlyFailedIds` and verifies FIFO eviction.

### C17-TE-03: No test for `sanitizeStderr` with `sensitiveValues` parameter
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/__tests__/sanitize-stderr.test.ts`
- **Issue**: The `sanitizeStderr` function accepts an optional `sensitiveValues` array (added in C1F-SR-08) for redacting DB host/user/name from stderr. The existing test may not cover the `sensitiveValues` parameter.
- **Fix**: Add test cases for `sensitiveValues` redaction, including edge cases (empty array, special regex chars in values).

### C17-TE-04: No integration test for lightbox keyboard navigation + auto-hide interaction
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/__tests__/lightbox.test.ts`
- **Issue**: The lightbox has complex interaction between keyboard events, auto-hide timer, and focus management. The existing test file exists but may not cover the edge case where a keydown event resets the auto-hide timer while the dialog has focus.
- **Fix**: Add a test verifying that `showControls(true)` is called on keydown and the timer is properly reset.

### C17-TE-05: UNICODE_FORMAT_CHARS regex synchronization lacks a test
- **Confidence**: High
- **Severity**: Low
- **Location**: `apps/web/src/__tests__/sanitize.test.ts` / `apps/web/src/__tests__/validation.test.ts`
- **Issue**: Two separate regex literals (`UNICODE_FORMAT_CHARS` in validation.ts, `UNICODE_FORMAT_CHARS_RE` in sanitize.ts) must match the same character set. There is no test verifying they stay in sync.
- **Fix**: Add a test that generates all Unicode code points in the expected ranges and verifies both regexes match exactly the same set. This acts as a synchronization guard.
