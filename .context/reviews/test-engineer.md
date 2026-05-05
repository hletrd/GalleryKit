# Cycle 18 — Test Engineer Review

Date: 2026-05-06
Scope: Full repository, post-cycle-17 fixes
Focus: Test coverage gaps, fixture contracts, flaky tests, TDD opportunities

## Verified Prior Fixes

- C17-TEST-01 / C17-TEST-02 (EXIF/ICC propagation tests): Addressed by 38077b9 and 4d1f323. New fixture tests should be added to lock the behavior.
- C17-TEST-03 (SW NaN age): Addressed by 0d243db. Unit test should verify NaN eviction.
- C17-TEST-04 (checkout idempotency): See C18-HIGH-01 — new test needed for deterministic key.

---

## New Findings

### MEDIUM SEVERITY

**C18-TEST-01: No test verifies checkout idempotency key is deterministic per user**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:150-151`
- **Confidence:** HIGH
- **Problem:** The fix for C17-SEC-01 (adding randomUUID) introduced C18-HIGH-01 (non-deterministic key). There is no test asserting that two requests from the same user within the same minute generate the SAME idempotency key. Without such a test, future "fixes" for collision could re-introduce randomness.
- **Fix:** Add a unit test that mocks `getClientIp` to return a fixed IP, calls the POST handler twice within the same minute, and asserts the idempotency keys are identical (or differ only in a controlled session-derived component).

**C18-TEST-02: No test for Service Worker cache key consistency**
- **File:** `apps/web/public/sw.template.js`
- **Confidence:** MEDIUM
- **Problem:** The mismatch between `cache.put(request)` and `cache.delete(url)` (C18-MED-01) has no test coverage. The SW tests (`sw-cache.test.ts`) verify cache hit/miss but not LRU eviction mechanics.
- **Fix:** Add a test that simulates exceeding the 50 MB budget and asserts that `caches.open(IMAGE_CACHE).keys()` length decreases after eviction.

**C18-TEST-03: Semantic search min-length gate lacks codepoint-aware test**
- **File:** `apps/web/src/app/api/search/semantic/route.ts:111`
- **Confidence:** MEDIUM
- **Problem:** The `query.length < 3` check is not tested with emoji or surrogate-pair inputs. A test with "🚀🌙" (2 code points, 4 UTF-16 units) would document the current behavior and catch regressions if the gate is tightened.
- **Fix:** Add a test case in `semantic-search-route.test.ts` with emoji input.

---

### LOW SEVERITY

**C18-TEST-04: No test for caption/embedding hook race with deletion**
- **File:** `apps/web/src/lib/image-queue.ts:351-400`
- **Confidence:** LOW
- **Problem:** The fire-and-forget hooks after `processed=true` commit are not tested for the deletion-race scenario.
- **Fix:** Optional: add a test that mocks DB update failure (row not found) and asserts graceful logging.
