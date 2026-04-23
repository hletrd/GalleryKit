# Debugger Review — Cycle 38 (2026-04-19)

## Reviewer: debugger
## Scope: Latent bug surface, failure modes, regressions

### Findings

**Finding DBG-38-01: `batchUpdateImageTags` transaction may leave orphaned tags**
- **File**: `apps/web/src/app/actions/tags.ts` lines 260-326
- **Severity**: LOW | **Confidence**: MEDIUM
- **Description**: In the `batchUpdateImageTags` transaction, new tags are inserted with `INSERT IGNORE` and then immediately queried by slug to get the ID. If the tag was created by another concurrent request between the INSERT and SELECT, the INSERT IGNORE would succeed (no-op) and the SELECT would return the correct tag. However, if the tag slug produces a collision with an existing tag of a different name (e.g., "SEO" vs "S-E-O"), the INSERT IGNORE silently skips the insert, and the SELECT returns the existing tag — which has a different name. The warning is correctly logged, but the image would be associated with the wrong tag. This is the same root cause as CR-38-03.
- **Fix**: Use `INSERT ... ON DUPLICATE KEY UPDATE` with a `name` update, or look up by name first before falling back to slug.

**Finding DBG-38-02: `uploadImages` pre-increment adjustment could underflow**
- **File**: `apps/web/src/app/actions/images.ts` lines 251-256
- **Severity**: LOW | **Confidence**: LOW
- **Description**: After the upload loop, the tracker adjustment does `currentTracker.count += (successCount - files.length)` and `currentTracker.bytes += (uploadedBytes - totalSize)`. If `successCount` is 0 (all uploads failed), the count adjustment is `0 - files.length`, which is negative. If the current count was already lower than `files.length` (due to concurrent pruning), the count could go negative. In practice, this is extremely unlikely because the pre-increment ensures the count is at least `files.length`. But if `pruneUploadTracker()` evicts the entry between the pre-increment and the adjustment (which it can't because the entry was just set), the `currentTracker` would be undefined and the adjustment is skipped (the `if (currentTracker)` guard). So the negative underflow can only happen if another concurrent request's adjustments bring the count below `files.length`, which would require an exact interleaving that's theoretically possible but practically impossible.
- **Fix**: Add `Math.max(0, ...)` guards to the adjustment calculations for safety.

**Finding DBG-38-03: `photo-viewer.tsx` `navigate` callback captures stale `currentIndex`**
- **File**: `apps/web/src/components/photo-viewer.tsx` line 85-102
- **Severity**: LOW | **Confidence**: LOW
- **Description**: The `navigate` callback depends on `currentIndex`, `images`, `prevId`, `nextId`, and `router`. When the user rapidly navigates between photos, the `currentIndex` used in the callback could be stale if the state update hasn't re-rendered yet. However, React batches state updates and the `useCallback` dependencies include `currentIndex`, so the callback will be recreated with the latest index on each render. The keyboard event listener (line 138-152) depends on `navigate`, which is updated when dependencies change. The effect properly removes and re-adds the listener. This is correct — no stale closure issue.

**Finding DBG-38-04: `deleteImage` audit log fires before the transaction, but after image existence check**
- **File**: `apps/web/src/app/actions/images.ts` lines 312-325
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The audit event is logged before the transaction (line 315), and the comment explains this is intentional — even if concurrent deletion causes the transaction to delete 0 rows, the audit is recorded. This is a correct design choice. The audit log is fire-and-forget (`.catch(console.debug)`) so it won't block the transaction. No issue.

### Summary
No critical bugs found. The codebase has robust error handling and defensive patterns. The most notable finding is the tag slug collision issue (shared root cause with CR-38-03), which could cause incorrect tag associations in edge cases.
