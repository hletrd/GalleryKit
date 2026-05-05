# Test Engineer — Cycle 12 (Run 2)

**Date**: 2026-05-05
**Scope**: Test coverage gaps in recently changed code and lint infrastructure
**Method**: Review of existing test files against implementation code

## Finding C12-TE-01: No integration tests for semantic search POST handler

- **File**: `apps/web/src/app/api/search/semantic/route.ts`
- **Existing tests**: `semantic-search-params.test.ts` (covers `clampSemanticTopK`), `semantic-search-rate-limit.test.ts` (covers `preIncrementSemanticAttempt` and `rollbackSemanticAttempt`)
- **Gap**: The actual POST handler is not exercised by any test. The handler contains significant branching logic:
  1. Same-origin check (403)
  2. Maintenance mode (503)
  3. Content-Length guard (413)
  4. JSON parsing and body shape validation (400)
  5. Query length validation (400)
  6. Semantic search enabled check (403)
  7. Rate limit (429)
  8. Embedding scan + DB failure rollback (500)
  9. Enrichment fallback (200 with degraded results)
- **Risk**: Refactors of the route (e.g., moving validation gates, changing the rollback pattern) have no automated regression protection. The R2C11-MED-01 fix (reordering rate-limit after validation) was shipped without route-level tests asserting the new behavior.
- **Fix**: Add `apps/web/src/__tests__/semantic-search-route.test.ts` that exercises the POST handler with mocked `request.json()`, mocked `getGalleryConfig()`, and stubbed `embedTextStub`.
- **Severity**: Low | **Confidence**: High

## Finding C12-TE-02: `check-public-route-rate-limit` tests do not cover commented-out helper calls

- **File**: `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- **Gap**: The fixture tests verify string-literal exemption bypass (C1-BUG-05) and import checks, but there is no test case for a commented-out rate-limit helper call. Adding such a test would have caught C12-LOW-01 at CI time.
- **Fix**: Add a test case that asserts a file containing `// preIncrementFoo(ip)` (commented out) fails the gate.
- **Severity**: Low | **Confidence**: High

## Finding C12-TE-03: No tests for high-bitdepth AVIF probe race

- **File**: `apps/web/src/lib/process-image.ts`, lines 49-66
- **Gap**: The lazy probe for 10-bit AVIF support has no test coverage. The `_highBitdepthAvifProbed` / `_highBitdepthAvifAvailable` state machine is only exercised in production.
- **Fix**: Add a unit test that simulates concurrent probe attempts and asserts deterministic final state.
- **Severity**: Low | **Confidence**: Medium

## Coverage Assessment

- Vitest: 122 files, 1033 tests, all passing. Good coverage on data layer, validation, and auth.
- Playwright E2E: not run this cycle; assuming green from R2C11 baseline.
- Lint gates: all three (api-auth, action-origin, public-route-rate-limit) pass.
