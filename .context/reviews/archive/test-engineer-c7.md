# Test Coverage & Correctness Review — Cycle 7

## Summary

Test coverage is strong for security-critical paths (auth, rate limiting, input validation, lint gates). Some functional areas have thinner coverage, particularly around edge cases in image processing and sharing.

---

## C7-TEST-01: No test for OG photo route rate-limit bypass — High

**File:** `apps/web/src/app/api/og/photo/[id]/route.tsx`

**Finding:** The per-photo OG route is NOT covered by the rate-limit lint gate (`check-public-route-rate-limit.ts` only scans POST/PUT/PATCH/DELETE). There is also no Playwright or Vitest test verifying that rapid requests to `/api/og/photo/[id]` are rate limited. The main `/api/og/route.tsx` has rate limiting (added in plan-233) but the photo-specific sub-route does not.

**Fix:** Add a Vitest integration test that mocks `preIncrementOgAttempt` to verify the route returns 429 when rate limited. Add the rate-limit helpers to the route first (see C7-SEC-01).

**Confidence:** High

---

## C7-TEST-02: Missing test for `deleteAdminUser` concurrent-lock timeout — Medium

**File:** `apps/web/src/app/actions/admin-users.ts`
**Lines:** 207-215

**Finding:** The advisory lock timeout in `deleteAdminUser` returns `DELETE_LOCK_TIMEOUT` after 5 seconds. There is no test verifying this timeout path, nor is there a test verifying that concurrent deletion of DIFFERENT users should succeed (the global lock name bug from C7-HIGH-01).

**Fix:** Add a Vitest test with a mocked MySQL connection that simulates `GET_LOCK` returning 0 (timeout) and verifies the error response. Also add a test verifying scoped lock names allow concurrent deletion.

**Confidence:** Medium

---

## C7-TEST-03: `image-queue.ts` permanent failure eviction not tested — Medium

**File:** `apps/web/src/lib/image-queue.ts`
**Lines:** 341-345

**Finding:** When `MAX_PERMANENTLY_FAILED_IDS` is exceeded, the oldest ID is evicted from the Set. There is no test verifying that the evicted ID can be re-enqueued and re-processed, or that `claimRetryCounts` for the evicted ID is cleaned up (see C7-MED-05).

**Fix:** Add a test that fills `permanentlyFailedIds` to capacity, triggers eviction, and verifies the evicted ID is removed from all tracking Maps.

**Confidence:** Medium

---

## C7-TEST-04: `process-image.ts` 10-bit AVIF probe failure path not tested — Low

**File:** `apps/web/src/lib/process-image.ts`
**Lines:** 49-66

**Finding:** The `_highBitdepthAvifProbed` flag downgrades the entire process to 8-bit AVIF after a single probe failure. There is no test verifying this behavior because it requires a libheif environment that rejects 10-bit encoding.

**Fix:** Mock `sharp` to simulate a 10-bit rejection and verify the flag is set and subsequent calls return false. This may require refactoring the probe logic to accept an injectable sharp instance.

**Confidence:** Low

---

## C7-TEST-05: ` bounded-map.ts` `prune()` deletion-during-iteration not covered by explicit test — Low

**File:** `apps/web/src/lib/bounded-map.ts`
**Lines:** 101-105

**Finding:** While the `BoundedMap` class has tests, there may not be an explicit test verifying that prune works correctly when the map is at capacity and many entries are expired. The ES6-safe deletion pattern is implicitly tested but not explicitly asserted.

**Fix:** Add a targeted test: fill map to capacity, wait for entries to expire, call prune, and verify the remaining entries are the expected ones.

**Confidence:** Low

---

## Commendations

- The lint gates (`check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`) have comprehensive fixture tests that would catch regressions.
- The touch-target audit test enforces WCAG AAA compliance automatically.
- The blur-data-url wiring tests (`process-image-blur-wiring.test.ts`, `images-action-blur-wiring.test.ts`) validate producer-consumer contracts.
- The data tag-names SQL fixture test locks the GROUP_CONCAT contract.
