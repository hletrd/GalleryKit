# Test Engineer Review — Cycle 22

## Method
Reviewed test coverage for newly introduced code, verified existing fixture contracts, and identified gaps in edge-case testing.

## Findings

### MEDIUM

#### C22-TEST-01: No test for `decrementRateLimit` race condition
- **Source**: `apps/web/src/lib/rate-limit.ts:427-454`
- **Confidence**: MEDIUM

The UPDATE+DELETE sequence in `decrementRateLimit` has no test coverage for concurrent access. A test with two concurrent operations (decrement + increment) could demonstrate the lost-update behavior.

**Fix**: Add an integration test that simulates concurrent decrement and increment on the same rate-limit bucket.

---

#### C22-TEST-02: No test for HTML cache size limits in service worker
- **Source**: `apps/web/public/sw.js`
- **Confidence**: LOW

The HTML cache has no eviction policy. There is no test verifying cache size limits or eviction behavior under repeated page visits.

**Fix**: Add a service worker test that visits many pages and verifies the HTML cache does not exceed a reasonable size.

---

#### C22-TEST-03: No test for bootstrap cleanup idempotency
- **Source**: `apps/web/src/lib/image-queue.ts:583-585`
- **Confidence**: MEDIUM

There is no test verifying that `purgeExpiredSessions`, `purgeOldBuckets`, and `purgeOldAuditLog` are called only once during repeated bootstrap invocations.

**Fix**: Add a test that calls `bootstrapImageProcessingQueue` twice and verifies cleanup functions are only invoked once.

---

### LOW

#### C22-TEST-04: Semantic search client topK is not tested against server default
- **Source**: `apps/web/src/components/search.tsx:79`
- **Confidence**: LOW

The hardcoded `topK: 20` in the search component has no test that verifies it matches the server-side `SEMANTIC_TOP_K_DEFAULT`. If the two drift, no test will catch it.

**Fix**: Add a test that imports both values and asserts equality.

---

## Test coverage confirmed adequate
- `semantic-search-route.test.ts`: Comprehensive coverage for the route guards and response shapes.
- `queue-shutdown.test.ts`: Verified `onIdle` behavior for quiescence.
- `image-queue-bootstrap.test.ts`: Verified batching, continuation, and retry behavior.
- Existing fixture contracts (data-tag-names-sql, process-image-blur-wiring, touch-target-audit, action-origin, api-auth) remain intact.
