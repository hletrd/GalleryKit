# Performance Reviewer — Cycle 3 (review-plan-fix loop, 2026-04-25)

Reviewed: data.ts call sites, image-queue.ts, process-image.ts (via shared imports), serve-upload.ts, rate-limit.ts. Performance optimizations from prior cycles remain in place.

## C3L-PERF-01: `topicRouteSegmentExists` sequential SELECTs (duplicate of CR-02) [INFO]

Could be parallelized with `Promise.all` to reduce advisory-lock hold time. Defer.

## C3L-PERF-02: `decrementRateLimit` performs UPDATE+DELETE round-trips [INFO]

**File:** `apps/web/src/lib/rate-limit.ts:255-283`

Two round-trips even when count never drops to zero. Correctness fine. Defer.

## Summary

No new HIGH/MEDIUM perf findings.
