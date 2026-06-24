# Cycle 2 Deep Review — Test Engineer

Date: 2026-06-24
HEAD: 95de4d11

## Summary

225 test files pass, 2064 tests pass, 4 skipped. All lint gate tests pass. No new test gaps identified in cycle 2.

## New Findings (Cycle 2)

### TE2-01 — `check-action-origin.test.ts` missing coverage for `export * from` re-exports

- Severity: Low
- Confidence: Medium
- Type: Test coverage gap

Evidence: The scanner now rejects star re-exports (AGG-02 fix), but the test file `apps/web/src/__tests__/check-action-origin.test.ts` doesn't have a fixture verifying the rejection.

Failure scenario: A future change to the scanner could accidentally allow star re-exports without test failure.

Suggested fix: Add a negative fixture that exports star from a mutating module and assert the scanner flags it.

### TE2-02 — `semantic-search-route.test.ts` comment drift after AGG-12

- Severity: Low
- Confidence: High
- Type: Test documentation drift

Evidence: The test file's comments describe the old rate-limit rollback behavior. After commit 4264d1d4, the actual code no longer rolls back after expensive work.

Failure scenario: Test comments mislead future maintainers about expected behavior.

Suggested fix: Update test comments to match the new no-rollback contract.

## Verified Fixed (from Cycle 1)

- AGG-01/02/03: Scanner fixtures updated — verified
- AGG-12: Semantic search rate-limit test updated — verified
- AGG-28: Nginx config test updated — verified
- AGG-33/34: Touch-target tests updated — verified

## Remaining Open (from Cycle 1)

- AGG-04: CI omits public-route-rate-limit lint — still not in CI
- AGG-05: Admin photo detail test gap — no test for admin-only fields in public projection
- AGG-09: Permanent failure durability — no test for restart recovery
- AGG-14: Embedding model isolation — no test for stub/production overwrite
- AGG-19: Similar photos stale results — no test for state reset on id change
- AGG-35: Touch-target audit — static audit can't catch rendered-size issues
- AGG-37: Modal inert — no e2e test for background accessibility
- AGG-38: Theme hydration — no test for hydration mismatch
