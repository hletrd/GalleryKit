# Test Engineer Review — Cycle 13 (test-engineer)

## Review Scope
Test coverage gaps, fixture quality, flaky test risk, missing edge-case tests.

## Findings

### C13-TE-01: No test for `buildCursorCondition` boundary cases
- **File+line**: `apps/web/src/lib/data.ts:547-570`
- **Severity**: Low | **Confidence**: Medium
- **Issue**: Already deferred as C9-TE-03. `buildCursorCondition` has complex OR logic for dated/undated image navigation. The dated branch includes `isNull(capture_date)` as a successor condition, and the undated branch includes `isNotNull(capture_date)` as a predecessor condition. No dedicated unit test validates these cross-type navigation boundaries.
- **Fix**: Already deferred.

### C13-TE-02: `normalizeImageListCursor` validation could benefit from property-count tests
- **File+line**: `apps/web/src/lib/data.ts:520-545`
- **Severity**: Low | **Confidence**: Low
- **Issue**: The cursor normalization function validates `id`, `capture_date`, and `created_at`, but there are no tests verifying that extra properties on the input object are safely ignored (they would be, since the function only reads known properties). This is defense-in-depth testing.
- **Fix**: Consider adding a test for extra properties on cursor input.

### C13-TE-03: `sanitizeAdminString` return-value contract (null on rejected) has no dedicated test
- **File+line**: `apps/web/src/lib/sanitize.ts:152-174`
- **Severity**: Medium | **Confidence**: Medium
- **Issue**: The C1F-CR-08 / C1F-TE-05 change made `sanitizeAdminString` return `value: null` when `rejected: true`. This is a critical contract — callers rely on it to avoid persisting visually-identical-but-unsafe strings. The `sanitize-admin-string.test.ts` file tests `rejected` but may not assert that `value` is specifically `null` (not `undefined` or the stripped value) when rejected.
- **Fix**: Add an explicit test asserting `value === null` when `rejected === true`.

### C13-TE-04: No test for `searchImages` tag + alias query interaction
- **File+line**: `apps/web/src/lib/data.ts:1057-1195`
- **Severity**: Low | **Confidence**: Low
- **Issue**: The search function has complex deduplication logic between main, tag, and alias results. While the `data-tag-names-sql.test.ts` covers the tagNamesAgg SQL shape, there's no integration-level test for the multi-source search dedup. This is a gap but would require DB setup.
- **Fix**: Consider adding a unit test with mocked DB responses.

## Summary
- Total findings: 4 (1 carried forward, 3 new)
- MEDIUM: 1 (C13-TE-03 — sanitizeAdminString null-on-rejected contract test)
- LOW: 3
