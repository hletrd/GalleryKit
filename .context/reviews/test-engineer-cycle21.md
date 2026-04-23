# Test Engineer Review — Cycle 21

**Reviewer:** test-engineer
**Date:** 2026-04-19

## Review Scope

Test coverage gaps, flaky tests, TDD opportunities.

## Findings

### TE-21-01: No test for upload tracker clamping behavior (C20-01 fix) [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/__tests__/` — no test file for `images.ts` action
- **Description:** The upload tracker clamping fix (Math.max(0, ...)) from cycle 20 has no corresponding unit test. The behavior — that the tracker count and bytes don't go negative after all-failed uploads — should be tested to prevent regression. This is especially important because the tracker is a shared mutable Map that's easy to break with future changes.
- **Concrete failure scenario:** A future refactor changes the tracker adjustment logic and accidentally removes the `Math.max(0, ...)`. Without a test, the regression goes undetected until a production incident.
- **Fix:** Add a unit test in `apps/web/src/__tests__/upload-tracker.test.ts` that:
  1. Sets up a tracker with pre-incremented values
  2. Simulates all-failed uploads (successCount=0)
  3. Verifies `count >= 0` and `bytes >= 0` after adjustment
  4. Simulates partial failure and verifies correct adjustment

### TE-21-02: No test for `deleteAdminUser` concurrent-deletion guard (C20-02 fix) [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/__tests__/` — no test file for `admin-users.ts` action
- **Description:** The `USER_NOT_FOUND` guard added in cycle 20 has no test. This is a correctness-critical path that should be tested.
- **Fix:** Add a test that calls `deleteAdminUser` with a non-existent ID and verifies it returns an error (not success).

### TE-21-03: No test for `revokePhotoShareLink` conditional WHERE (C19-01 fix) [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/__tests__/` — no test file for `sharing.ts` action
- **Description:** The conditional WHERE clause added in cycle 19 to prevent race conditions has no test. The race condition scenario is difficult to test deterministically, but the basic behavior (revoking when share_key matches, error when it doesn't) should be tested.
- **Fix:** Add a basic test for the share link lifecycle (create, verify, revoke, verify revoked).

### TE-21-04: Existing test suite is solid for lib modules [INFO]
- **Description:** The existing tests for `base56`, `session`, `queue-shutdown`, `auth-rate-limit`, `revalidation`, `locale-path`, `sql-restore-scan`, `rate-limit`, and `validation` provide good coverage for utility modules. The gap is in server action tests, which are harder to unit test due to DB dependencies.

## Summary
- 0 CRITICAL findings
- 2 MEDIUM findings (missing tests for C20-01 and C20-02 fixes)
- 1 LOW finding (missing test for C19-01 fix)
- 1 INFO finding
