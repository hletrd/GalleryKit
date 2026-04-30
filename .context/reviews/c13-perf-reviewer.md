# Performance Review — Cycle 13 (perf-reviewer)

## Review Scope
CPU/memory performance, concurrency, I/O patterns, caching, query efficiency.

## Findings

### C13-PR-01: `searchImages` runs tag + alias queries in parallel only when main query is insufficient
- **File+line**: `apps/web/src/lib/data.ts:1103-1183`
- **Severity**: Low | **Confidence**: Low
- **Issue**: When the main LIKE query returns enough results, the tag and alias queries are skipped (short-circuit). When it doesn't, both run in parallel. This is an optimization that saves 2 DB round-trips for popular search terms. The design is sound.
- **Fix**: No fix needed.

### C13-PR-02: `getSharedGroup` fetches tags with a single batched query instead of N+1
- **File+line**: `apps/web/src/lib/data.ts:958-983`
- **Severity**: N/A | **Confidence**: High
- **Issue**: Verified that the batched tag query pattern is correct. `inArray(imageTags.imageId, imageIds)` fetches all tags in one query, then distributes them via a Map. No N+1 issue.

### C13-PR-03: `getImage` runs 3 parallel queries (tags, prev, next) — could be reduced to 2
- **File+line**: `apps/web/src/lib/data.ts:819-851`
- **Severity**: Low | **Confidence**: Low
- **Issue**: Already deferred as D1-MED / plan-336 (UNION query optimization). The tag query could be folded into the main SELECT, and prev/next could use a single UNION. The current 3-query parallel approach is correct but makes 3 DB round-trips.
- **Fix**: Already deferred.

### C13-PR-04: `flushGroupViewCounts` processes entries in chunks of 20 — adequate for personal-gallery scale
- **File+line**: `apps/web/src/lib/data.ts:79-109`
- **Severity**: Low | **Confidence**: Low
- **Issue**: The chunk size of 20 limits concurrent DB promises. With a 10-connection pool, this is within bounds. The swap-then-drain pattern (C2-F01) prevents data loss on crash. The retry cap (VIEW_COUNT_MAX_RETRIES = 3) prevents indefinite re-buffering. All correct.
- **Fix**: No fix needed.

### C13-PR-05: `image-queue.ts` bootstrap scans all pending images in batches of 500
- **File+line**: `apps/web/src/lib/image-queue.ts:463-475`
- **Severity**: Low | **Confidence**: Low
- **Issue**: The BOOTSTRAP_BATCH_SIZE of 500 is reasonable for personal-gallery scale. The cursor-based continuation (bootstrapCursorId) ensures large backlogs don't monopolize a single bootstrap pass. The `notInArray` on permanentlyFailedIds could generate a large IN clause if the set approaches MAX_PERMANENTLY_FAILED_IDS (1000). At personal-gallery scale, this is unlikely but worth noting.
- **Fix**: No fix needed at current scale.

## Summary
- Total findings: 5 (1 carried forward, 2 verified-as-correct, 2 observations)
- No new HIGH/MEDIUM performance issues found
- All prior performance optimizations remain intact
