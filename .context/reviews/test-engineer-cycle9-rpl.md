# test-engineer — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

Coverage snapshot from `apps/web/src/__tests__/`:

- 48 vitest test files, 281 passing tests.
- 7 Playwright e2e test files (admin, public, origin-guard, nav-visual-check, test-fixes, helpers), 19 passing e2e tests.

## New coverage-gap findings

### C9R-RPL-T01 — `updatePassword` rate-limit rollback behavior is untested [MEDIUM / HIGH]
- Path: `auth.ts:297-326`.
- No test in `apps/web/src/__tests__/auth-*.test.ts` or elsewhere asserts that validation errors (empty field / mismatch / too short / too long) DO NOT decrement or DO NOT pre-increment the rate-limit counter.
- This gap is what allowed C9R-RPL-01 to regress silently — if a test asserted the expected pre-validation-before-increment ordering, the regression would fail the suite.
- Action: add `apps/web/src/__tests__/auth-rate-limit.test.ts` assertion that validation-error returns in `updatePassword` do not consume a rate-limit attempt.

### C9R-RPL-T02 — `pruneShareRateLimit` cadence (or lack thereof) is untested [LOW / MEDIUM]
- Path: `sharing.ts:36-50`.
- Tests in `rate-limit.test.ts` cover `search` cadence via `pruneSearchRateLimit`. No similar assertion for `pruneShareRateLimit`. If a cadence is added (per C9R-RPL-P01 proposal) we need a test guard.
- Action: add a test for `pruneShareRateLimit` that exercises both the legacy-unthrottled behavior and the future throttled behavior (if implemented).

### C9R-RPL-T03 — `flushGroupViewCounts` partial-failure backoff behavior is untested [LOW / MEDIUM]
- Path: `data.ts:48-96`.
- Tests for `flushBufferedSharedGroupViewCounts` don't cover partial failure — the "consecutiveFlushFailures" counter behavior (C9R-RPL-05 above) is not asserted in any test. A partial-failure path where N of M writes fail cannot be observed in the current test suite.
- Action: add vitest fixture that injects a partial-failure mock and asserts backoff behavior.

### C9R-RPL-T04 — No playwright test for "admin locked out of password change via typos" negative path [LOW / MEDIUM]
- `e2e/admin.spec.ts` covers happy-path admin flows but does not assert the rate-limit behavior around password change typos. Given the C9R-RPL-01 finding, this is a gap for a real user scenario.
- Action: add e2e that posts 5 invalid password-change attempts and asserts no rate-limit lockout.

### C9R-RPL-T05 — `restoreDatabase` advisory-lock release-failure logging is untested [LOW / HIGH]
- Path: `db-actions.ts:284-285, 308-310`.
- The C8R-RPL-09 fix moved the release catch from silent-swallow to `console.debug`. Unit tests don't assert that `console.debug` is invoked when release fails. If a future change reverts to `catch {}`, the regression is invisible.
- Action: add unit test that mocks a `RELEASE_LOCK` failure and asserts the debug log is called.

## Not issues / positive coverage

- `sql-restore-scan.test.ts` provides comprehensive pattern coverage including 0x hex literal, b'...' binary, SET @@global, DELIMITER, PREPARE/EXECUTE, and the new CALL / REVOKE / RENAME USER cases added in C5R-RPL-01.
- `check-action-origin.test.ts` and `check-api-auth.test.ts` are fixture-based and cover arrow-function / function-expression / type-asserted / .mjs / .cjs variants.
- `privacy-fields.test.ts` enforces the `adminSelectFieldKeys \ publicSelectFieldKeys` invariant — ensures new admin-only fields cannot leak into public queries without failing the test.
- `upload-tracker.test.ts` exercises the pre-register-before-await race closure (C8R-RPL-02).
- `csv-escape.test.ts` covers C0/C1 stripping, bidi/zero-width, CRLF collapse, leading whitespace formula guard, and double-quote doubling.
- Test count 281 is higher than cycle 8 (prior aggregate noted 277) — growth indicates active test maintenance.

## Suggested priorities

1. C9R-RPL-T01 (ships alongside C9R-RPL-01 fix as a regression test)
2. C9R-RPL-T04 (negative e2e to document contract)
3. C9R-RPL-T03 (partial failure simulation)
