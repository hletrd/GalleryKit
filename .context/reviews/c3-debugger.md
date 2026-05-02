# Debugger — Cycle 3 Review

## Files Reviewed

All source files under `apps/web/src/lib/`, `apps/web/src/app/actions/`, `apps/web/src/components/`, `apps/web/src/db/`.

## Findings

### C3-DB-01 [HIGH]. `load-more.tsx` — server action error not caught, button stuck in failed state

- **File+line**: `apps/web/src/components/load-more.tsx`
- **Issue**: When the `loadMoreImages` server action throws (e.g., DB timeout, connection refused), the `startTransition` callback has no error handler. The button's `loading` state is set to `true` before the call but never reset to `false` on error. The user sees a permanently loading or unresponsive "Load More" button with no error feedback and no way to retry without refreshing the page.
- **Impact**: User is stuck — cannot load more images after a single transient error.
- **Confidence**: High
- **Fix**: Wrap the server action call in try/catch, reset `loading` to `false`, show error toast, and allow retry.

### C3-DB-02 [MEDIUM]. `image-queue.ts` — `permanentlyFailedIds` eviction is FIFO, not LRU — can evict recently-failed IDs

- **File+line**: `apps/web/src/lib/image-queue.ts:341-345`
- **Issue**: When `permanentlyFailedIds` exceeds `MAX_PERMANENTLY_FAILED_IDS` (1000), the oldest entry is evicted (FIFO). If a recently-failed image has a low ID (e.g., ID 5), it could be evicted before older high-ID entries. After eviction, the image would be re-enqueued on the next bootstrap, fail 3 more times, and be re-added. This creates a potential cycle of evict-retry-fail for low-ID images when the set is at capacity. However, the code comment explicitly acknowledges FIFO is acceptable for a single-writer topology and the set rarely approaches capacity.
- **Impact**: At personal-gallery scale with < 50 permanently-failed images, this is not a practical concern.
- **Confidence**: Low
- **Fix**: Acknowledged as acceptable per code comments. No change needed.

### C3-DB-03 [MEDIUM]. `session.ts` — `verifySessionToken` cache dedup may mask concurrent token reuse

- **File+line**: `apps/web/src/lib/session.ts:94`
- **Issue**: `verifySessionToken` is wrapped with `cache()`, which deduplicates calls within a single React server context. If the same token is verified twice in one request (e.g., `isAdmin()` and `getCurrentUser()`), only one DB query runs. This is correct and beneficial for performance. However, the cache is per-request, so concurrent requests with the same token each hit the DB. There is no issue here — the per-request cache is the correct scope.
- **Impact**: None — correct behavior.
- **Confidence**: High (dismissed)

### C3-DB-04 [MEDIUM]. `data.ts` — `flushGroupViewCounts` swap-then-drain may lose increments on process crash

- **File+line**: `apps/web/src/lib/data.ts:62-161`
- **Issue**: The swap-then-drain pattern (C2-F01) is designed to prevent losing increments. After the swap, new increments go to the fresh buffer. If the process crashes during the drain, the old `batch` Map is lost. However, this is documented as acceptable in the code comments: "best-effort approximate analytics" per CLAUDE.md. The `viewCountRetryCount` cap (C30-03) ensures that repeated failures eventually drop the increment rather than re-buffering indefinitely.
- **Impact**: Acceptable — view counts are best-effort per CLAUDE.md.
- **Confidence**: High (acknowledged as correct)

### C3-DB-05 [LOW]. `auth.ts` — `login` transaction deletes all sessions before inserting new one

- **File+line**: `apps/web/src/app/actions/auth.ts:208-219`
- **Issue**: The login transaction first inserts the new session, then deletes all other sessions for the user. This is correct — the INSERT happens before the DELETE, so if the transaction fails, neither operation commits. The ordering prevents a window where the user has no valid sessions. This is well-designed.
- **Impact**: None — correct behavior.
- **Confidence**: High (acknowledged as correct)

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| HIGH | 1 | Error handling |
| MEDIUM | 2 | Acknowledged limitations |
| LOW | 1 | Acknowledged correct |

**Verdict: FIX AND SHIP** — The `load-more.tsx` error handling is the one actionable item. Everything else is either correct by design or acknowledged as an acceptable trade-off.
