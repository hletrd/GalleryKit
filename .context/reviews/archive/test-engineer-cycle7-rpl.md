# Test Engineer Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** test-engineer (test coverage gaps, flaky tests, TDD
opportunities)

## Test inventory

**Vitest unit tests (apps/web/src/__tests__/):**
- `check-action-origin.test.ts` — lint-gate scanner.
- `csv-escape.test.ts` — CSV field escaping (added cycle 6).
- `privacy-fields.test.ts` — adminSelectFieldKeys / publicSelectFieldKeys
  set relationship.
- `public-actions.test.ts` — unauthenticated action surface.
- `rate-limit.test.ts` — pruning, eviction, prune interval.
- (other tests for session, backup filename, etc., carried forward)

**Playwright e2e (apps/web/e2e/):**
- `origin-guard.spec.ts` — mutating actions reject spoofed Origin.
- (other e2e tests for login, upload, etc.)

## Findings

### T7-01 — No unit test for `requireSameOriginAdmin()` as an isolated
helper

**File:** `apps/web/src/lib/action-guards.ts`

The function is tested transitively via e2e `origin-guard.spec.ts`.
Direct unit tests with `vi.mock('next/headers')` and
`vi.mock('next-intl/server')` would give precise failure localization
when the helper's behavior regresses.

**Severity:** LOW (coverage gap)
**Confidence:** HIGH
**Recommendation:** add `action-guards.test.ts` with:
1. `hasTrustedSameOrigin` returns true → helper returns null.
2. `hasTrustedSameOrigin` returns false → helper returns localized
   `unauthorized`.
3. `getTranslations` throws → helper propagates (doesn't swallow).

### T7-02 — `rollbackShareRateLimit` and `rollbackShareRateLimitFull`
lack direct unit tests

**File:** `apps/web/src/app/actions/sharing.ts:69-90`

Currently exercised only via integration tests that go through the
entire `createPhotoShareLink`/`createGroupShareLink` path. Direct
unit tests on the rollback helpers would catch the `count === 1`
delete-vs-decrement edge case deterministically.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** extract helpers to an exportable module
position (or write private-module test via dynamic import) and
assert both the in-memory Map transitions and the DB mock invocation
order.

### T7-03 — No test for `pruneShareRateLimit` eviction — only for
search/login rate-limit pruners

**File:** `apps/web/src/app/actions/sharing.ts:36-50`

The pattern is mirrored from search, so the bug risk is low, but
test coverage is asymmetric. Adding a pruner test (via direct
module import) would rule out regressions.

**Severity:** LOW
**Confidence:** HIGH

### T7-04 — `e2e/origin-guard.spec.ts` (added cycle 6) tests mutating
actions; does NOT explicitly cover `exportImagesCsv` (which is
technically an export, not a mutation)

**File:** `apps/web/e2e/origin-guard.spec.ts`

`exportImagesCsv` calls `requireSameOriginAdmin()` at db-actions.ts:38.
An e2e assertion that spoofed-origin export requests are rejected
would close this coverage gap.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** add e2e spec for `exportImagesCsv` rejection.

### T7-05 — No test for `cleanOrphanedTmpFiles` logging behavior

**File:** `apps/web/src/lib/image-queue.ts:23-48`

The cycle-6-rpl change (AGG6R-03) moved logging from "before unlink"
to "after unlink". No test asserts this ordering. A test that mocks
`fs.unlink` to reject and captures `console.warn` would lock in the
behavior.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** add unit test for the counts-reflect-success
invariant.

### T7-06 — `check-action-origin.test.ts` covers `checkActionSource`
but does NOT assert that `discoverActionFiles` recursion walks
subdirectories

**File:** `apps/web/src/__tests__/check-action-origin.test.ts`

A fixture test with a temp directory containing nested `.ts` files
would verify the recursion invariant directly. Without it, a future
refactor that reverts to single-level readdir could ship undetected.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** add recursion fixture test.

### T7-07 — No test for restore scanner's file-size-less-than-header
edge case

**File:** `apps/web/src/__tests__/sql-restore-scan.test.ts` (inferred)

`restoreDatabase` uses `fd.read(headerBuf, 0, 256, 0)` without
checking bytesRead. A test that submits a 100-byte file and asserts
behavior (either accept-with-valid-prefix or reject-as-too-short)
would pin down the semantics.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** write test after the bytesRead fix lands.

### T7-08 — Playwright e2e does not explicitly cover
`restoreDatabase` advisory-lock contention (two concurrent restore
requests)

**File:** e2e directory

The lock is tested transitively (a single restore locks correctly),
but a two-browser test that initiates two restores would catch
regressions in `GET_LOCK` session scoping.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** deferred — complex to author, low probability
of regression.

### T7-09 — `privacy-fields.test.ts` asserts the set-difference between
admin and public keys. A mutation-test that adds a "leaked" key to the
private-looking omit-list and verifies CI fails would validate the
guard's effectiveness.

**File:** `apps/web/src/__tests__/privacy-fields.test.ts`

**Severity:** LOW (meta-testing)
**Confidence:** HIGH
**Recommendation:** optional.

## Summary

9 findings, all LOW. The cycle-6-rpl test additions are solid. The
cheapest, highest-value additions for cycle 7 are T7-01
(`requireSameOriginAdmin` unit test), T7-05 (`cleanOrphanedTmpFiles`
ordering), and T7-06 (`discoverActionFiles` recursion fixture).
