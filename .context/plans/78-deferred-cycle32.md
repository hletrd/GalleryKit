# Plan 78-Deferred — Deferred Items (Cycle 32)

**Created:** 2026-04-19 (Cycle 32)
**Status:** Deferred

## Deferred Findings

### C32-03: `pruneShareRateLimit` uses insertion-order eviction, not LRU
- **File:** `apps/web/src/app/actions/sharing.ts:26-38`
- **Severity:** LOW, Low Confidence
- **Reason for deferral:** All Maps have hard caps (SHARE_RATE_LIMIT_MAX_KEYS=500) and expiry-based pruning. True LRU eviction adds complexity for marginal benefit. In practice, the cap is large enough that insertion-order eviction does not cause problems.
- **Exit criterion:** If a burst traffic scenario causes legitimate rate-limit entries to be evicted before expired ones, re-evaluate.

### C32-04: Health endpoint exposes DB connectivity status to unauthenticated callers
- **File:** `apps/web/src/app/api/health/route.ts:15-18`
- **Severity:** LOW, High Confidence
- **Original severity from C30-08:** LOW
- **Reason for deferral:** Carry-forward from C30-08. The health endpoint is intended for load balancer probes. Adding authentication would break unauthenticated health checks. Removing the `db` field would reduce diagnostic utility. The 503 status code already conveys health to load balancers without the body detail.
- **Exit criterion:** If the endpoint is abused for infrastructure reconnaissance, consider removing the `db` boolean from the response body while keeping the status code semantics.

## Carry-Forward from Previous Cycles

All previously deferred items from cycles 5-29 remain deferred with no change in status:

- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04: `createGroupShareLink` insertId validation inside transaction
- C30-06: Tag slug regex inconsistency
- C30-08: Health endpoint DB disclosure (now also C32-04)
