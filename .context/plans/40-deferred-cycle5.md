# Plan 40: Deferred Items — Cycle 5

**Priority:** P3 (no-fix-needed)
**Sources:** C5-04, C5-05, C5-07, C5-08
**Status:** DEFERRED

---

## Deferred Findings

### C5-04: `searchRateLimit` in-memory increment race (LOW, LOW confidence)

**File:** `apps/web/src/app/actions/public.ts` lines 47-59
**Reason for deferral:** Node.js is single-threaded for JavaScript execution. The check and increment are synchronous with no intervening `await`, so the race cannot occur in practice.
**Exit criterion:** If the search rate limiter is ever moved to a Worker thread or the increment becomes async, this should be re-evaluated.

### C5-05: `original_file_size` from client-reported value (LOW, LOW confidence)

**File:** `apps/web/src/app/actions/images.ts` line 151
**Reason for deferral:** The `File.size` property is set by the browser and is accurate in standard usage. Verifying after write would add I/O overhead for marginal benefit. The stored value is only used for display metadata.
**Exit criterion:** If `original_file_size` is ever used for billing or quota enforcement, it must be verified server-side.

### C5-07: `prunePasswordChangeRateLimit` only called from `updatePassword` (LOW, LOW confidence)

**File:** `apps/web/src/lib/auth-rate-limit.ts`
**Reason for deferral:** The Map has a hard cap of 5000 entries, preventing unbounded growth. Expired entries are pruned on the next password change attempt. The GC interval in `image-queue.ts` doesn't need to prune this Map since the hard cap is sufficient.
**Exit criterion:** If the hard cap is removed or if password change rate limiting becomes a hot path with many IPs, add periodic pruning.

### C5-08: `dumpDatabase` partial file cleanup race (LOW, LOW confidence)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 108-136
**Reason for deferral:** The cleanup logic is reasonable and the risk is negligible. Partial backup files in `data/backups/` would be overwritten on the next backup and the directory is not publicly accessible.
**Exit criterion:** If backup file management becomes a concern (e.g., disk space monitoring), add a cleanup step for orphaned partial files.

---

## Carry-Forward Deferred Items (unchanged)

1. U-15 connection limit docs mismatch (very low priority)
2. U-18 enumerative revalidatePath (low priority, current approach works)
3. /api/og throttle architecture (edge runtime, delegated to reverse proxy)
4. Font subsetting (Python brotli dependency issue)
5. Docker node_modules removal (native module dependency)
