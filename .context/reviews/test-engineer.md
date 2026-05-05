# Test Engineer Review — Cycle 21

## Method
Reviewed test coverage for newly introduced code, verified existing fixture contracts, and identified gaps in edge-case testing.

## Findings

### C21-TEST-01 (MEDIUM): No test for chunked encoding body size bypass in semantic search
**File**: `apps/web/src/app/api/search/semantic/route.ts`
**Confidence**: HIGH

The body size guard only checks `Content-Length`. There is no test verifying behavior when `Transfer-Encoding: chunked` is present. A test with a chunked request body exceeding `MAX_SEMANTIC_BODY_BYTES` would reveal the bypass.

**Fix**: Add a unit test that mocks a Request with `Transfer-Encoding: chunked` and a large body, verifying it is rejected.

---

### C21-TEST-02 (MEDIUM): No test for queue quiescence with active jobs
**File**: `apps/web/src/lib/image-queue.ts`
**Confidence**: HIGH

`quiesceImageProcessingQueueForRestore` is not tested for the scenario where a job is actively running. The existing tests likely mock `queue.onPendingZero()` to resolve immediately, masking the race condition.

**Fix**: Add a test that enqueues a slow job, calls quiescence, and verifies it waits for the job to complete.

---

### C21-TEST-03 (LOW): No test for `decrementRateLimit` race condition
**File**: `apps/web/src/lib/rate-limit.ts`
**Confidence**: MEDIUM

The UPDATE+DELETE sequence in `decrementRateLimit` is not tested for concurrent access. A test with two concurrent operations (decrement + increment) could demonstrate the lost-update behavior.

**Fix**: Add an integration test that simulates concurrent decrement and increment on the same rate-limit bucket.

---

### C21-TEST-04 (LOW): No test for HTML cache growth in service worker
**File**: `apps/web/src/public/sw.js`
**Confidence**: LOW

The HTML cache has no eviction policy. There is no test verifying cache size limits or eviction behavior under repeated page visits.

**Fix**: Add a service worker test that visits many pages and verifies the HTML cache does not exceed a reasonable size.

---

### C21-TEST-05 (LOW): No test for semantic search stub mode warning
**File**: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/lib/clip-inference.ts`
**Confidence**: MEDIUM

There is no test verifying that the semantic search endpoint behaves differently when in stub mode vs. real mode. The current tests likely pass because the stub produces deterministic output, but they don't verify semantic correctness.

**Fix**: Add a test that verifies the response includes a warning header or log when stub mode is active.

---

## Test coverage confirmed adequate
- `check-public-route-rate-limit.test.ts`: Comprehensive coverage maintained.
- `data-tag-names-sql.test.ts`: GROUP_CONCAT shape locked.
- `touch-target-audit.test.ts`: 44px minimum enforced.
- `process-image-blur-wiring.test.ts`: Producer-side blur validation locked.
- `action-origin.test.ts`: Server action origin scanning enforced.
- `api-auth.test.ts`: Admin API route auth wrapping verified.
