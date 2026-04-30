# Deferred Findings — Cycle 44

All findings from the cycle 44 review that are NOT scheduled for implementation this cycle.

## Deferred Items

### D44-P01: Consolidate rate-limit Maps into generic class [LOW] [A44-02]
**Original finding:** A44-02 (architect)
**Reason for deferral:** Architectural refactoring with significant scope — touches 6 files and ~200 lines of code. Risk of introducing regressions in rate-limiting behavior. Low priority since the current duplicate pattern is functionally correct.
**Exit criterion:** When rate-limiting bugs are traced back to inconsistent Map implementations, or when a new rate-limited action is added that would benefit from a shared class.

### D44-P02: Add integration test for upload→process→serve pipeline [LOW] [TE44-02]
**Original finding:** TE44-02 (test-engineer)
**Reason for deferral:** Requires test infrastructure setup (mock Sharp, temp directories, DB fixtures). The individual components already have unit tests, and Playwright e2e tests cover the happy path from the UI.
**Exit criterion:** When a server-side integration test framework is established for the project.

### D44-P03: Add test for `escapeCsvField` edge cases [LOW] [TE44-03]
**Original finding:** TE44-03 (test-engineer)
**Reason for deferral:** The function already works correctly and was just fixed in cycle 43 for control characters. Adding tests would provide regression protection but is not urgent.
**Exit criterion:** Next cycle when test coverage work is prioritized.

### D44-P04: `getAdminTags` query optimization [LOW] [P44-01]
**Original finding:** P44-01 (perf-reviewer)
**Reason for deferral:** Admin-only query with acceptable performance for typical gallery sizes (<1000 tags). Would require schema change (denormalized count column) for meaningful improvement.
**Exit criterion:** When admin tags page load time becomes a user-reported issue.

## Previously Deferred Items (Carried Forward)

All previously deferred items from cycles 5-43 remain deferred with no change in status. See prior cycle deferred documents for full details.
