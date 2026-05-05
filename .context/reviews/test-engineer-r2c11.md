# Test Engineer — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: Test coverage gaps, flaky tests, TDD opportunities, contract tests
**Scope**: All `__tests__/*.test.ts`, server actions, API routes, components

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-TE-01: Semantic search parameter bounds are untested
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 114-115)
**Severity**: Low | **Confidence**: High

The `topK` parameter is clamped between 1 and `SEMANTIC_TOP_K_MAX` (50), with a default of `SEMANTIC_TOP_K_DEFAULT` (10). The existing `semantic-search-rate-limit.test.ts` only covers rate-limit behavior. There is no test verifying:
- Negative `topK` is clamped to 1
- Zero `topK` is clamped to 1
- Float `topK` is floor'd
- `topK` > max is clamped to max
- Missing `topK` uses default

**Suggested fix**: Create `__tests__/semantic-search-params.test.ts` with boundary-value tests.

### C11-TE-02: Semantic search rollback-on-validation-failure is untested
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 76-122)
**Severity**: Low | **Confidence**: High

If the rate-limit increment is moved after validation (fixing C11-MED-01), or if a rollback helper is added, there is no test verifying that rejected requests do not consume the rate-limit budget.

**Suggested fix**: Add tests that send invalid JSON / disabled-search requests and assert the rate-limit counter does not increment.

### C11-TE-03: `ImageZoom` touch-action interaction is untested
**File**: `apps/web/src/components/image-zoom.tsx`
**Severity**: Low | **Confidence**: Medium

There are unit tests for zoom math (`image-zoom-math.test.ts`) and keyboard contracts (`image-zoom-source-contracts.test.ts`), but no test verifies the CSS `touch-action` property or mobile gesture behavior. The component handles custom pinch and pan but lacks integration-level gesture testing.

**Suggested fix**: Add a component-level test that asserts `touch-action: none` is present when zoomed, or document the gap with an explanatory comment if Playwright gesture simulation is unavailable.

### C11-TE-04: Lightbox focus-restoration safety is untested
**File**: `apps/web/src/components/lightbox.tsx` (lines 364-374)
**Severity**: Low | **Confidence**: Medium

No test verifies that the lightbox's cleanup effect safely handles focus restoration when the previously focused element has been removed from the DOM.

**Suggested fix**: Add a unit test that mocks `document.activeElement`, removes it from the DOM, then unmounts the lightbox and asserts no error is thrown.

### C11-TE-05: `data.ts` viewCountRetryCount redundant prune path is untested
**File**: `apps/web/src/lib/data.ts` (lines 146-167)
**Severity**: Low | **Confidence**: Medium

No test verifies the interaction between the "clear all when buffer empty" path and the "FIFO eviction when over cap" path.

**Suggested fix**: Add a unit test that simulates a flush with an empty buffer and a retry count Map exceeding the cap, asserting the Map ends up empty (not negative size).

## Coverage Summary
- Total test files: 122
- Lines under test coverage: strong for data layer, auth, image processing, and rate limiting
- Gaps identified: semantic search params, touch-action CSS, lightbox focus safety, view-count retry pruning

## Final Sweep
No additional test gaps found after reviewing all `__tests__/` files.
