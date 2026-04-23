# Test Engineer Review — leader fallback after test-engineer agent retry failure (current checkout only)

## Scope and inventory covered
Reviewed the current test surface against current code risk:
- topic validation/actions: `apps/web/src/lib/validation.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/__tests__/validation.test.ts`, `apps/web/src/__tests__/topics-actions.test.ts`
- histogram/photo viewer: `apps/web/src/components/histogram.tsx`, `apps/web/src/components/photo-viewer.tsx`
- restore maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 1

## Confirmed Issues

### TE3-01 — No regression test covers locale-reserved topic slugs/aliases
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/__tests__/validation.test.ts:98-107`, `apps/web/src/__tests__/topics-actions.test.ts:138-148`, `apps/web/src/app/actions/topics.ts:51-65`, `apps/web/src/app/actions/topics.ts:328-336`
- **Why it is a problem:** Current tests cover hardcoded reserved segments and alias-route conflicts, but they do not lock the router-reserved locale codes (`en`, `ko`). That lets the current validation gap regress silently.
- **Concrete failure scenario:** Locale codes remain accepted for topic slugs and aliases because no test asserts they must be rejected.
- **Suggested fix:** Add unit coverage for `isReservedTopicRouteSegment('en'/'ko')` and action-level coverage that `createTopic()` / `createTopicAlias()` reject locale-coded routes.

### TE3-02 — No regression test covers overlapping histogram worker requests
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/histogram.tsx`, `apps/web/src/__tests__/` (no histogram coverage present)
- **Why it is a problem:** The shared-worker request-correlation bug is easy to reintroduce because nothing in the test suite simulates fast image switching with two worker responses arriving out of order.
- **Concrete failure scenario:** A future refactor preserves the broken shared-worker behavior and the suite stays green because no test asserts the histogram remains tied to the active image URL.
- **Suggested fix:** Add a focused component/unit test that mocks `Worker` and verifies only the matching request ID updates histogram state.

## Risks Requiring Manual Validation

### TE3-03 — Restore-under-traffic behavior is not covered by automated staging-like tests
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Status:** Risk requiring manual validation
- **Files:** `apps/web/src/app/[locale]/admin/db-actions.ts`, public routes/actions, current e2e suite under `apps/web/e2e/**`
- **Why it is a problem:** The existing unit/e2e suite does not simulate a restore running while public traffic continues.
- **Concrete failure scenario:** Restore appears safe in unit tests, but production users still see partial pages or 500s during a real restore window.
- **Suggested fix:** Add a staging runbook/manual validation step; full deterministic automation likely needs integration infrastructure beyond the current unit surface.

## Final sweep
- Current suite already covers many prior cycle issues; this report only carries current test gaps.
