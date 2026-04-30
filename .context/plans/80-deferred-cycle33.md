# Plan 80-Deferred — Deferred Items (Cycle 33)

**Created:** 2026-04-19 (Cycle 33)
**Status:** Deferred

## Deferred Findings

No new deferred findings this cycle. All cycle 33 findings are scheduled for implementation in plan-79.

## Carry-Forward from Previous Cycles

All previously deferred items from cycles 5-32 remain deferred with no change in status:

- C32-03: `pruneShareRateLimit` uses insertion-order eviction, not LRU (LOW, Low)
- C32-04 / C30-08: Health endpoint exposes DB connectivity status to unauthenticated callers (LOW, High)
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap (LOW, Medium)
- C30-03: `flushGroupViewCounts` re-buffers failed increments without retry limit (LOW, Medium)
- C30-04: `createGroupShareLink` insertId validation inside transaction (LOW, Medium)
- C30-06: Tag slug regex inconsistency (LOW, Low)
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
