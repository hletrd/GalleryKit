# Plan 323 — Cycle 5: viewCountRetryCount size cap (C5-AGG-02)

## Origin

C5-AGG-02 (Low/Low) — `viewCountRetryCount` in `data.ts` has no independent size cap. Flagged by 3 of 5 review agents.

## Problem

`apps/web/src/lib/data.ts:20` — The `viewCountRetryCount` Map tracks retry counts for failed view-count flushes. It is pruned only when `viewCountBuffer.size === 0` (line 126-128). During a sustained DB outage where the buffer never empties, it can grow without bound. In practice, it is bounded by the number of shared groups (admin-controlled, typically < 100) which is safe for personal-gallery scale.

## Implementation steps

1. **Add a constant** `MAX_VIEW_COUNT_RETRY_SIZE = 500` near line 22 (matching the pattern of other Map caps in the codebase).

2. **Add size check in `flushGroupViewCounts`** after the re-buffer step (around line 101). When `viewCountRetryCount.size >= MAX_VIEW_COUNT_RETRY_SIZE`, prune the oldest entries using FIFO eviction (same pattern as `BoundedMap.prune`):
   ```ts
   if (viewCountRetryCount.size > MAX_VIEW_COUNT_RETRY_SIZE) {
       const excess = viewCountRetryCount.size - MAX_VIEW_COUNT_RETRY_SIZE;
       let evicted = 0;
       for (const key of viewCountRetryCount.keys()) {
           if (evicted >= excess) break;
           viewCountRetryCount.delete(key);
           evicted++;
       }
   }
   ```

3. **Add code comment** documenting the invariant: entries are bounded by the number of shared groups (admin-controlled) and the `MAX_VIEW_COUNT_RETRY_SIZE` cap.

## Exit criteria

- `viewCountRetryCount` has an explicit size cap
- Comment documents the bounded-by-shared-group-count invariant
- All gates pass: lint, tsc, build, vitest, lint:api-auth, lint:action-origin

## Deferred findings

None from this finding.
