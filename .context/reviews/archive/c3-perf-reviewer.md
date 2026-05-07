# Performance Reviewer — Cycle 3 Review

## Files Reviewed

All source files under `apps/web/src/lib/`, `apps/web/src/app/actions/`, `apps/web/src/components/`, `apps/web/src/db/`.

## Findings

### C3-PR-01 [MEDIUM]. `searchImages` — alias query limit calculation over-fetches

- **File+line**: `apps/web/src/lib/data.ts:1071`
- **Issue**: `aliasRemainingLimit = effectiveLimit - mainIds.length` does not account for `tagResults.length`. When both tag and alias queries run in parallel, the alias query fetches up to `effectiveLimit - mainIds.length` rows, but the tag query also fetches up to `remainingLimit` rows. The combined result set before dedup may be up to `effectiveLimit + tagResults.length` rows. The final `.slice(0, effectiveLimit)` ensures the returned result is correct, but the DB work is wasted.
- **Impact**: On searches matching both tags and aliases, up to `2x effectiveLimit` rows may be fetched from the DB. At `effectiveLimit = 100`, this means up to 200 rows for a search that returns 100.
- **Confidence**: High
- **Fix**: Run the tag query first, then calculate `aliasRemainingLimit = effectiveLimit - mainIds.length - tagResults.length`. This serializes the two queries but eliminates over-fetch. Alternatively, accept the over-fetch as a trade-off for parallel execution at personal-gallery scale.

### C3-PR-02 [MEDIUM]. `getImage` — three parallel DB queries for single-image view

- **File+line**: `apps/web/src/lib/data.ts:788-820`
- **Issue**: Each photo page view runs: (1) main image query, (2) tags query, (3) prev query, (4) next query. Queries 2-4 are parallelized with `Promise.all`, consuming 3 DB connections simultaneously. With a 10-connection pool, this limits concurrent photo views to ~3 before queueing. This is a re-confirmation of the deferred item D3-MED from plan-346.
- **Impact**: Connection pool exhaustion risk under moderate concurrent load. Already deferred.
- **Confidence**: High
- **Fix**: Deferred — combine prev/next into a UNION query (plan-336).

### C3-PR-03 [MEDIUM]. `getImagesLitePage` — window function `COUNT(*) OVER()` on every row

- **File+line**: `apps/web/src/lib/data.ts:644`
- **Issue**: The `getImagesLitePage` query uses `COUNT(*) OVER()` as a window function to get the total count. This requires MySQL to compute the count for every row in the result set (not just the page). For a personal gallery with a few thousand images, this is fast. For larger galleries, the optimizer must scan all matching rows to compute the window function, even though only `pageSize + 1` rows are returned.
- **Impact**: For galleries with >10K images, the window function adds overhead to every paginated query.
- **Confidence**: Medium
- **Fix**: Consider a separate `SELECT COUNT(*)` query instead of the window function when `totalCount` is needed. The window function is more convenient but not more efficient than a separate count query.

### C3-PR-04 [LOW]. `data.ts` — `viewCountBuffer` swap-then-drain pattern may delay flush timer restart

- **File+line**: `apps/web/src/lib/data.ts:62-161`
- **Issue**: After swapping the buffer and draining it, the `finally` block checks if the new buffer has entries and schedules a new timer. If the flush takes a long time (e.g., DB outage with many retries), new increments accumulate in the fresh buffer during the drain. When the drain finally completes, the timer is scheduled with the backoff interval. This is correct behavior — the backoff prevents hammering the DB during outages.
- **Impact**: None — correct behavior.
- **Confidence**: High (acknowledged as correct)

### C3-PR-05 [LOW]. `image-queue.ts` — bootstrap continuation uses `queue.onIdle()` which may fire prematurely

- **File+line**: `apps/web/src/lib/image-queue.ts:402-416`
- **Issue**: `scheduleBootstrapContinuation` uses `queue.onIdle()` to schedule the next bootstrap batch. The `onIdle()` promise resolves when the queue's pending count reaches zero. However, if new jobs are added between the resolution and the bootstrap call, the bootstrap may find no pending images and mark itself as `bootstrapped = true` prematurely. The `bootstrapped` flag is only set when `pending.length < BOOTSTRAP_BATCH_SIZE`, so this would only happen if fewer than 500 images are pending total. In that case, the bootstrap correctly processes all of them and the flag is set appropriately.
- **Impact**: None — the bootstrap logic is correct.
- **Confidence**: High (acknowledged as correct)

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| MEDIUM | 3 | Query efficiency, connection pool |
| LOW | 2 | Acknowledged correct behavior |

**Verdict: FIX AND SHIP** — The `searchImages` over-fetch is the most actionable item. The `getImage` UNION optimization is already deferred. The `COUNT(*) OVER()` is a minor concern at personal-gallery scale.
