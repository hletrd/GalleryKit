# test-engineer — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: test coverage gaps, flaky tests, TDD opportunities.

## Findings

### T10R-RPL-01 — `admin-users.test.ts` has no test for rate-limit ordering around validation errors [LOW / HIGH]

File: `apps/web/src/__tests__/admin-users.test.ts`.

The new finding C10R-RPL-01 (createAdminUser rate-limit ordering) doesn't have test coverage. After fixing the ordering, the fix should include a regression test analogous to `auth-rate-limit-ordering.test.ts` which was added in cycle 9 rpl for `updatePassword`.

Proposed: Add a test that:
1. Mocks `getCurrentUser` to return an admin.
2. Calls `createAdminUser` 20 times with a too-short username.
3. Asserts that the in-memory `userCreateRateLimit` map does NOT have the IP's count incrementing with each validation-error call.
4. Asserts no entry was added to the DB rate-limit bucket.

Confidence: High.

### T10R-RPL-02 — No test for `stripControlChars` affecting password-change equivalence [LOW / MEDIUM]

File: `apps/web/src/__tests__/sanitize.test.ts`, `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`.

Existing tests cover stripControlChars in isolation and the ordering fix in `updatePassword`. But there's no integration test verifying that `login`'s stripControlChars matches what was stored during `createAdminUser` — the invariant the comments call out (C8-01). Hypothetical failure: if `createAdminUser` doesn't strip a char that `login` does, the password check fails and the admin is locked out.

Proposed: Add a test that creates an admin user with a password containing U+2028 (Line Separator, a control-like but non-C0/C1 char), then attempts login with the same raw input and verifies it succeeds. Current test coverage would miss a regression where stripControlChars is changed in one function but not both.

Confidence: Medium.

### T10R-RPL-03 — `sharing.ts` retry loop test coverage is absent for key-collision exhaustion path [LOW / MEDIUM]

File: `apps/web/src/app/actions/sharing.ts:121-185, 245-306`.

Both `createPhotoShareLink` and `createGroupShareLink` have a 5-retry loop on ER_DUP_ENTRY. If all 5 retries hit collisions (astronomically unlikely but possible in tests with seeded RNG), the rollback path activates. No existing test exercises the "exhausted retries" branch.

Proposed: Mock `generateBase56` to return the same string 6 times in a row. Assert the function returns `{ error: failedToGenerateKey }` AND both rate-limit counters (in-memory + DB) are decremented.

Confidence: Medium.

### T10R-RPL-04 — `auth-rate-limit-ordering.test.ts` (cycle 9 rpl) coverage is good [VERIFIED]

File: `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`.

Confirmed present in the test suite. Gate evidence: cycle 9 rpl aggregate reports 281 tests across 48 files. Ordering test is a subset of that. No regression suspected.

Confidence: High.

### T10R-RPL-05 — CLAUDE.md documents "48 test files, 281 tests" — should be kept in sync [LOW / LOW]

The cycle 9 rpl aggregate quoted `48 files, 281 tests`. If cycle 10 adds a new test file (e.g. for C10R-RPL-01), this number will shift. Not a test concern per se but a cross-doc concern — CLAUDE.md does not hardcode these numbers, so no drift risk in the docs. OK as-is.

Confidence: High.

## Summary

- 1 HIGH-confidence gap (add test for the createAdminUser ordering fix — coupled with C10R-RPL-01 implementation).
- 2 MEDIUM-confidence gaps (integration test for stripControlChars login round-trip; retry-exhaustion test for sharing).
- No new test regressions.
