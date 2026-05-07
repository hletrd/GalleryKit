# Debugger — Cycle 2/100 (2026-04-28)

## Files Reviewed

All source files under `apps/web/src/`.

## Findings

### No Latent Bug Findings

Examined all failure modes and edge cases:

1. **Race conditions**: Delete-while-processing is handled via conditional UPDATE + cleanup. Concurrent tag creation uses `INSERT IGNORE` + slug collision detection. Topic slug rename uses advisory lock + transaction. Concurrent DB restore uses MySQL advisory lock. Upload processing contract changes use advisory lock. Per-image-processing claim uses advisory lock. All well-guarded.

2. **Error handling**: All server actions catch and return user-friendly errors. `unstable_rethrow` is used in auth actions for Next.js internal signals. File cleanup uses retry with `collectImageCleanupFailures`. Restore uses `settled` flag to prevent double-resolve.

3. **Null/undefined guards**: All data access functions validate inputs (integer IDs, slug formats, base56 keys). `getCurrentUser` returns null when unauthenticated. Privacy-sensitive fields omitted from public selects.

4. **Edge cases**: `getImage` prev/next navigation handles NULL `capture_date` correctly with `sql\`FALSE\`` for the "no older undated images" branch. Empty tag arrays handled. Zero-byte uploads rejected. Empty search queries rejected.

5. **Memory leaks**: View count buffer capped at 1000 entries. Rate limit maps pruned on every access. Retry maps pruned when over 10000 entries. GC interval runs hourly. Orphaned .tmp files cleaned at bootstrap.

6. **Process lifecycle**: `queue-shutdown.ts` drains the queue gracefully. Advisory locks released on connection close. Restore maintenance ends in finally block.

### INFO

No latent bugs found. The codebase has been hardened through many prior cycles.

## Convergence Note

Fourth consecutive cycle with zero new bug findings.
