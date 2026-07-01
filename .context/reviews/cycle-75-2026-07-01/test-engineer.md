# Cycle 75 Test-Engineer Review

Scope: Cycle 74 fixes, route/component tests, gate scripts, source-contract tests, behavior gaps around pending OG state and conditional responses.

## Findings

### C75-03 - Pending-photo OG helper remains mostly source-locked

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/__tests__/og-photo-fallback.test.ts:98`, `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:167`, `apps/web/src/lib/data.ts:1204`, `apps/web/src/app/api/og/photo/[id]/route.tsx:84`
- Problem: Cycle 74 added the correct helper and route branch, but the helper guard reads `data.ts` source while the route behavior test mocks `getImageProcessingStateCached`. The current tests do not execute `getImageProcessingState()` against pending, processed, missing, and invalid rows.
- Failure scenario: a future data-helper refactor reintroduces a processed-only predicate and returns `null` for pending rows. Route tests still pass through the mock, and `/api/og/photo/:id` can cache a generic fallback for a photo that is merely still processing.
- Suggested fix: add direct `getImageProcessingState()` behavior coverage with a mocked DB chain.

## Evidence

Focused Cycle 74 regression command passed: `npm test --workspace=apps/web -- --run src/__tests__/feed-conditional.test.ts src/__tests__/feed-sized-derivative.test.ts src/__tests__/og-photo-fallback.test.ts src/__tests__/og-route-rate-limit-behavior.test.ts src/__tests__/password-form-a11y.test.ts`.
