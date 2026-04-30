# Plan 324 — Cycle 5: Deferred findings carry-forward

## Origin

Cycle 5 review findings that are explicitly deferred per the plan directory rules.

## C5-AGG-03 (Low / Medium). No integration test for NULL capture_date prev/next navigation

- **File+line**: `apps/web/src/lib/data.ts:660-730`
- **Original severity/confidence**: Low / Medium
- **Reason for deferral**: The `getImage` prev/next SQL with NULL `capture_date` handling appears correct based on code review. The logic is complex (4 OR branches per direction) but follows MySQL's NULL ordering semantics (NULL sorts last in DESC). Writing a meaningful integration test requires a running MySQL instance with test data, which the current Vitest unit test setup does not support. The existing fixture-style tests in `__tests__/data-adjacency-source.test.ts` validate the SQL shape but not the NULL boundary behavior end-to-end.
- **Exit criterion**: When integration test infrastructure is available (e.g., testcontainers MySQL or a dedicated E2E test), add a test with mixed NULL/non-NULL capture_date images that exercises prev/next at every boundary. Alternatively, add a more thorough SQL-shape fixture test that covers the NULL branches.
