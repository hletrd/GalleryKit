# Test Engineer — Cycle 3 Review

## Files Reviewed

All test files under `apps/web/src/__tests__/`, `apps/web/e2e/`, and corresponding source files.

## Findings

### C3-TE-01 [HIGH]. No test for `load-more.tsx` error handling

- **File+line**: `apps/web/src/components/load-more.tsx` (no corresponding test)
- **Issue**: The `load-more.tsx` component has no dedicated test file. Given that it calls a server action (`loadMoreImages`) that can throw errors, the lack of error handling in the component means there is also no test covering the error path. When the error handling is added (C3-CR-01), a test should be added to verify: (1) error toast appears on server action failure, (2) button is re-enabled for retry after error, (3) loading state is correctly reset.
- **Impact**: Regression risk — future changes to the load-more component could break error handling without detection.
- **Confidence**: High
- **Fix**: Add a test file `__tests__/load-more.test.tsx` or `__tests__/load-more-error.test.ts` that verifies error handling behavior.

### C3-TE-02 [MEDIUM]. `searchImages` alias-query over-fetch has no test coverage

- **File+line**: `apps/web/src/lib/data.ts:1059-1126` (no corresponding test for the alias-query limit calculation)
- **Issue**: The alias-query limit calculation (`aliasRemainingLimit = effectiveLimit - mainIds.length`) does not account for `tagResults.length`, leading to over-fetching. There is no test that verifies the total number of DB rows fetched stays within reasonable bounds relative to `effectiveLimit`.
- **Impact**: No regression test for the over-fetch behavior.
- **Confidence**: Medium
- **Fix**: Add a test that verifies the search function does not fetch more than `2 * effectiveLimit` total rows across all three queries (main + tag + alias).

### C3-TE-03 [MEDIUM]. `getImage` prev/next navigation edge cases not tested

- **File+line**: `apps/web/src/lib/data.ts:741-831` (no corresponding test for NULL capture_date prev/next)
- **Issue**: The prev/next navigation has complex logic for both dated and undated images. The `data-adjacency-source.test.ts` tests some cases, but there is no explicit test for the boundary condition where multiple images have the same `capture_date` and `created_at` but different IDs (tiebreaking by ID).
- **Impact**: Regression risk for the ID tiebreaker logic.
- **Confidence**: Medium
- **Fix**: Add a test case for the ID-tiebreaker path in `data-adjacency-source.test.ts`.

### C3-TE-04 [LOW]. View-count flush retry cap test coverage is adequate

- **File+line**: `apps/web/src/__tests__/data-view-count-flush.test.ts`
- **Issue**: The view-count flush retry cap (VIEW_COUNT_MAX_RETRIES) is tested. The FIFO eviction cap is tested. The buffer-capacity enforcement is tested. The test coverage for the view-count buffer is adequate.
- **Impact**: None — already tested.
- **Confidence**: High (verified)

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| HIGH | 1 | Missing test for error handling |
| MEDIUM | 2 | Missing edge case tests |
| LOW | 1 | Verified adequate coverage |

**Verdict: FIX AND SHIP** — The `load-more.tsx` error handling test is the most actionable item (overlaps with C3-CR-01). The search over-fetch and prev/next edge case tests are medium priority.
