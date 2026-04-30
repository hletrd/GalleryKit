# Test Engineer Review — test-engineer (Cycle 8)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high findings.
- Two medium test-gap findings.

## Verified fixes from prior cycles

1. C7-TE-01 / AGG7R-01: Redundant `IS NULL` test — acknowledged as addressed.
2. C7-TE-02 / AGG7R-08: Upload tracker hard-cap test — carry-forward.

## New Findings

### C8-TE-01 (Medium / Medium). No unit test for `sanitizeAdminString` — the stateful regex bug (C8-CR-01 / C8-SEC-01) was not caught by any existing test

- Location: `apps/web/src/lib/sanitize.ts` — no test file exists
- The `sanitizeAdminString` function was added in cycle 7 but no unit tests were written for it. The stateful `/g` regex bug that allows bidi overrides through on alternate calls would have been caught by a simple test calling `sanitizeAdminString` twice on the same input.
- Concrete scenario: A test that calls `sanitizeAdminString('hello‪world')` twice in succession. The first call returns `{ rejected: true }`, the second returns `{ rejected: false }` due to `lastIndex` state. This is a testable, reproducible bug.
- Suggested fix: Add `__tests__/sanitize-admin-string.test.ts` with test cases covering: (1) normal string, (2) string with bidi override, (3) same input called twice, (4) null input, (5) string with C0 controls only.

### C8-TE-02 (Low / Low). `countCodePoints` test file does not test the actual action file usage patterns

- Location: `apps/web/src/__tests__/code-point-length.test.ts`
- The test file verifies `countCodePoints()` works correctly in isolation, but does not test the actual action file validation logic that should use it (topics.ts, seo.ts). Since these files still use `.length`, there is no regression test to catch when a new action file uses `.length` instead of `countCodePoints()`.
- Suggested fix: Add integration-style tests that submit emoji-heavy topic labels and SEO titles, verifying they are accepted (not falsely rejected).

## Carry-forward (unchanged — existing deferred backlog)

- C7-TE-02 / AGG7R-08: Upload tracker hard-cap eviction path untested.
- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
