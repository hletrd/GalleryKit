# perf-reviewer — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

## New findings

### C9R-RPL-P01 — `pruneShareRateLimit` runs on every share create (no cadence throttle) [LOW / MEDIUM]
- `apps/web/src/app/actions/sharing.ts:36-67`.
- `search` in `rate-limit.ts:121-150` throttles prune to once per second via `lastSearchRateLimitPruneAt`. `share_photo` / `share_group` do not — every share call does an O(n) walk up to 500 entries.
- At the current 20/window ceiling this is negligible; flagging because the pattern is inconsistent.
- Fix: add a 1-second cadence similar to pruneSearchRateLimit.

### C9R-RPL-P02 — `deleteImages` cleanup waits synchronously for all variants before returning [LOW / LOW]
- `apps/web/src/app/actions/images.ts:527-543`.
- `Promise.all(imageRecords.map(...))` blocks the action until every filesystem unlink finishes. For a 100-image batch delete, each image's cleanup spawns 4 unlink paths, so 400 filesystem operations serially blocked on the HTTP round-trip. The user sees a slower-than-needed response.
- Mitigation: the cleanup is already parallelized per image; the actual wait dominates when the disk is slow. Could move cleanup to a fire-and-forget with an audit-log reconciliation step. Defer until measured.

### C9R-RPL-P03 — `flushGroupViewCounts` chunk size 20 and connection pool 10 are inconsistent [LOW / MEDIUM]
- `apps/web/src/lib/data.ts:46`.
- FLUSH_CHUNK_SIZE=20 but the mysql pool has 10 connections (CLAUDE.md "Connection pool: 10 connections"). Chunk size 20 queues 10 promises beyond immediate serving capacity. Not a correctness issue (queue limit 20 absorbs them), but the chunk size should not exceed pool capacity for predictable back-pressure.
- Fix: track as a tuning micro-optimization; benchmark-gated.

### C9R-RPL-P04 — `getImagesLitePage` uses window function `COUNT(*) OVER()` but also does LIMIT+1 [LOW / MEDIUM]
- `apps/web/src/lib/data.ts:359-392`.
- Two signals are computed: the exact total via window function and the "are there more?" hint via LIMIT+1. The window function already gives exact total, making the +1 row redundant; we're paying for 31 rows of data just to compute `hasMore = rows.length > 30`.
- `normalizePaginatedRows` uses both signals, so a quick win is to drop the +1 and derive `hasMore` from `totalCount > offset + pageSize`.
- Low impact (1 row/page) but cleanup-worthy.

## Carry-forward confirmations

- `getImage` runs tags + prev + next in parallel (data.ts:465-535). Confirmed.
- `searchImages` short-circuits tag + alias lookups once main results fill `limit` (data.ts:762-831). Confirmed.
- `getImagesLite` uses scalar subquery for tag_names instead of GROUP_CONCAT on full JOIN. Confirmed.
- `cleanOrphanedTmpFiles` parallelized across 3 dirs (image-queue.ts:29). Confirmed.
- Sharp concurrency cap at cpuCount-1 (process-image.ts:17-23). Confirmed.
- `adminSelectFields` omits `blur_data_url` from listing queries to avoid buffer pool bloat. Confirmed.
- `bufferGroupViewCount` debounces shared-group view count increments with exponential backoff on DB outage. Confirmed.

## Not issues

- Sharp `clone()` on a single base instance avoids triple buffer decode. Confirmed.
- `deleteImageVariants` skips readdir when configured sizes are known. Confirmed.
- `revalidateAllAppData` uses `revalidatePath('/', 'layout')` instead of per-path iteration for large batches. Confirmed.
- Pool connection `'connection'` handler (AGG5R-13) for session `group_concat_max_len` — bootstrap window is tiny, observational only.
