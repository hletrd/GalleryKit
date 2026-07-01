# Cycle 76 Test Review

Start HEAD: `a295ae4432f071c374cb68278a706f5a516ae593`.

## Inventory

- Cycle 75 regression tests around OG/feed/upload validators
- Backfill race tests under `apps/web/src/__tests__/admin-backfill-runner-*` and `apps/web/src/__tests__/backfill-color-pipeline-*`
- Source-contract tests for modal dropdown containment and pending-photo state
- Privacy and custom lint scanner tests

## Findings

### C76-02 - Per-photo OG validators can miss derivative-byte changes

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/api/og/photo/[id]/route.tsx:54`, `apps/web/src/app/api/og/photo/[id]/route.tsx:142`
- Problem: the route-level 304 test proves the short-circuit, but there is no test proving derivative byte-impact settings or pipeline version participate in the validator.
- Failure scenario: a future change keeps the route's early 304 path but omits the freshness inputs that should invalidate stale crawler cards after a re-encode.
- Suggested fix: add route/source coverage for settings hash and pipeline version in `createPhotoOgEtag`.

### C76-04 - Bottom-sheet dropdown portal coverage is source-shaped only

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:15`
- Problem: the Cycle 75 focus-containment test checks strings rather than rendering the sheet, opening the dropdown, and asserting containment under the dialog subtree.
- Failure scenario: a refactor can preserve the strings while Radix still portals to `document.body`.
- Suggested fix: add a jsdom/Testing Library behavior test when the repo has DOM component test infrastructure.

### C76-05 - `getImageProcessingState` test would miss a processed-predicate drift

- Severity: Low
- Confidence: Medium
- Citations: `apps/web/src/__tests__/image-processing-state-data.test.ts:42`, `apps/web/src/__tests__/og-photo-fallback.test.ts:98`, `apps/web/src/lib/data.ts:1204`
- Problem: the behavior test mocks the Drizzle chain and does not verify the generated predicate excludes any `images.processed` filter.
- Failure scenario: a future helper refactor could accidentally filter on processed state and still pass the mock-shaped tests.
- Suggested fix: source-lock the helper against any `images.processed` predicate or replace the mock with a real query integration fixture.

## Evidence

Targeted scanner/privacy/Cycle 75 tests passed in the review lane: 10 files, 237 tests.
