# Test Engineer — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: test-engineer (coverage, flakiness, TDD
opportunities).

## Test surface

- Vitest: 47 files / 256 tests pass in 2.7s.
- Playwright: 5 e2e spec files (admin, public, nav-visual-check,
  test-fixes, plus fixtures/helpers.ts).
- Scripts: `check-action-origin.ts` and `check-api-auth.ts` now have
  fixture-based unit tests (cycle-5-rpl added them).

## Confirmed good coverage

- `action-guards.test.ts` — same-origin policy validated.
- `auth-rate-limit.test.ts` — rate-limit bucket semantics.
- `auth-rethrow.test.ts` — every outer catch in `auth.ts` rethrows via
  `unstable_rethrow`.
- `check-action-origin.test.ts`, `check-api-auth.test.ts` — fixture-based
  scanner tests lock in behavior.
- `privacy-fields.test.ts` — asserts `publicSelectFields` doesn't leak PII.
- `sql-restore-scan.test.ts` — dangerous SQL patterns covered.
- `db-pool-connection-handler.test.ts` — pool connection 'connection' event
  handler (C4R-RPL2 work).
- `session.test.ts`, `backup-download-route.test.ts`,
  `health-route.test.ts`, `live-route.test.ts` — auth/route-surface.
- Component tests: `histogram.test.ts`, `image-url.test.ts`,
  `lightbox.test.ts`, `tag-input.test.ts`, `shared-page-title.test.ts`,
  `error-shell.test.ts`.

## Gaps / new findings

### T6-01 — No e2e test asserts mutating actions reject cross-origin Origin header
- Severity: LOW. Confidence: HIGH.
- `request-origin.test.ts` covers the primitive; `action-guards.test.ts`
  covers the helper. No end-to-end assertion that a POST to a server action
  with spoofed `Origin: https://attacker.example` returns an `unauthorized`
  error.
- Fix: add `e2e/origin-guard.spec.ts` that uses Playwright's request context
  to POST to `/en/admin/dashboard` with the Next-Action header and a wrong
  Origin, asserting the response contains a localized unauthorized error.
  Covered in S6-01.

### T6-02 — No coverage for `viewCountBuffer` backoff behavior
- File: `apps/web/src/lib/data.ts:18-96`.
- Severity: LOW. Confidence: HIGH.
- The `consecutiveFlushFailures` counter + backoff logic has no unit test.
  If the logic regresses (e.g., `reset on any success` breaks), dropped
  increments during a DB outage would not trigger the longer backoff.
- Fix: add a test in `apps/web/src/__tests__/data-view-counts.test.ts` that
  mocks `db.update` to reject and asserts `getNextFlushInterval()` grows
  after 3+ consecutive failures.

### T6-03 — No coverage for `cleanOrphanedTmpFiles` on different dirs
- File: `apps/web/src/lib/image-queue.ts:23-37`.
- Severity: LOW. Confidence: MEDIUM.
- Function reads 3 upload dirs, filters .tmp entries, unlinks. No test
  ensures it handles an empty dir, a missing dir, or a dir with mixed
  .tmp / non-.tmp files.
- Fix: add `image-queue-cleanup.test.ts` with a tmp-dir fixture.

### T6-04 — `sharing.ts` no test for retry-exhausted collision path
- File: `apps/web/src/app/actions/sharing.ts:121-165`.
- Severity: LOW. Confidence: MEDIUM.
- If `generateBase56` keeps colliding (astronomically unlikely), the retry
  loop exhausts to `failedToGenerateKey`. No test verifies the loop exits
  after 5 retries.
- Fix: test with mocked `generateBase56` that always returns the same
  value.

### T6-05 — `escapeCsvField` lacks tests for control-char stripping
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:27-41`.
- Severity: LOW. Confidence: HIGH.
- The function is unit-testable but not unit-tested directly. CSV rows are
  tested only via integration. A unit test would lock in control-char
  stripping and CRLF collapse behavior.
- Fix: add `csv-escape.test.ts` with fixtures for control chars, formula
  prefixes, embedded quotes, CRLF, nulls. Trivial.

### T6-06 — E2E tests don't assert WCAG contrast / ARIA / keyboard nav
- Severity: LOW. Confidence: MEDIUM.
- Current e2e coverage focuses on functional flows. No assertions on
  keyboard-only navigation, focus traps, or contrast ratios. Prior UI/UX
  reviews flagged footer Admin-link AA/AAA failures.
- Fix: integrate `axe-core/playwright` for automated a11y checks in
  existing specs. Covered in prior cycles' deferred.

### T6-07 — `image-queue.ts::bootstrapImageProcessingQueue` has no test
- File: `apps/web/src/lib/image-queue.ts:292-345`.
- Severity: LOW. Confidence: HIGH.
- The ECONNREFUSED suppression logic (line 337-343) has no regression
  guard. A change that tightens the error detection could either swallow
  legit errors or leak ECONNREFUSED warnings.
- Fix: add a unit test mocking `db.select` to throw various error shapes.

### T6-08 — Playwright fixtures path hardcoded
- File: `apps/web/e2e/fixtures/`.
- Severity: LOW. Confidence: LOW.
- Fixture images are in `e2e/fixtures/` but the `admin.spec.ts` upload tests
  reference them by relative path. If tests run from a different working
  directory, they'd fail. Currently works because Playwright cwd is
  `apps/web/`.
- Fix: use `path.join(__dirname, 'fixtures', ...)`. Minor.

### T6-09 — `check-action-origin.test.ts` doesn't cover recursion into subdirectories
- File: `apps/web/src/__tests__/check-action-origin.test.ts`.
- Severity: LOW. Confidence: HIGH.
- Related to S6-06: the scanner doesn't recurse. Test suite doesn't assert
  this gap — if someone adds recursion, no test locks in either behavior.
- Fix: add a test fixture with a subdirectory that SHOULD be scanned,
  assert it IS scanned (or explicitly, that it is NOT — document the
  decision).

### T6-10 — `check-api-auth.test.ts` doesn't cover all HTTP methods (PUT, PATCH, DELETE, HEAD, OPTIONS)
- File: `apps/web/src/__tests__/check-api-auth.test.ts`.
- Severity: LOW. Confidence: MEDIUM.
- Current test covers `GET` and `POST`. The scanner accepts 7 HTTP method
  exports but only 2 are exercised by tests.
- Fix: add fixtures for each method. Minor — scanner logic is a simple
  Set.has() lookup, unlikely to regress per-method.

## Summary

- **10 LOW** findings, all test-coverage gaps. Most actionable:
  **T6-02** (viewCount backoff behavior) and **T6-01** (e2e origin-guard).
- Current test surface is strong: 47 files, 256 passing tests in <3s.
- No flaky tests observed; no skip/xfail markers.
