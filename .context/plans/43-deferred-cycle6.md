# Plan 43: Deferred Items — Cycle 6

**Priority:** P3 (no-fix-needed or documentation-only)
**Sources:** C6-10 (documentation)
**Status:** DEFERRED

---

## Deferred Findings

### C6-10: Bootstrap fetches all pending images without limit (LOW, MEDIUM confidence)

**File:** `apps/web/src/lib/image-queue.ts` lines 245-292
**Reason for deferral:** This is by-design behavior. The queue correctly processes unprocessed images on restart with the configured concurrency (default: 2). The SELECT only fetches needed columns (not blob data). Large numbers of pending images will simply take longer to process. The alternative (limiting the bootstrap fetch) would leave images permanently unprocessed. The PQueue handles the backpressure correctly.
**Exit criterion:** If the bootstrap SELECT causes startup issues (e.g., >10K unprocessed images), consider paginated bootstrap with a configurable limit.

---

## Carry-Forward Deferred Items (unchanged)

1. U-15 connection limit docs mismatch (very low priority)
2. U-18 enumerative revalidatePath (low priority, current approach works)
3. /api/og throttle architecture (edge runtime, delegated to reverse proxy)
4. Font subsetting (Python brotli dependency issue)
5. Docker node_modules removal (native module dependency)
6. C5-04 searchRateLimit in-memory race (safe by Node.js single-thread guarantee)
7. C5-05 original_file_size from client value (acceptable for display metadata)
8. C5-07 prunePasswordChangeRateLimit infrequent pruning (hard cap sufficient)
9. C5-08 dumpDatabase partial file cleanup race (negligible risk)
