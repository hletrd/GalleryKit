# Performance Review — perf-reviewer (Cycle 16)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high performance findings.
- No new actionable performance findings.

## Verified fixes from prior cycles

1. C1F-DB-01 (viewCountBuffer cap after re-buffering): CONFIRMED — data.ts:119-126.
2. All prior redundant-IS-NULL fixes still in place.
3. Image cleanup concurrency (C2-AGG-02 / plan-257): Confirmed with `IMAGE_CLEANUP_CONCURRENCY` env var.
4. Orphaned .tmp file cleanup parallelized across directories (C7R-RPL-09): confirmed.
5. `getImage` uses `Promise.all` for 3 parallel queries: confirmed.
6. View count flush uses chunked processing (FLUSH_CHUNK_SIZE = 20): confirmed.
7. `tagNamesAgg` centralizes GROUP_CONCAT expression: confirmed no drift.

## Deep review: image-queue bootstrap and view-count flush

### Bootstrap cursor continuation
- Bootstrap uses cursor-based continuation (BOOTSTRAP_BATCH_SIZE = 500): confirmed.
- Continuation scheduled on queue idle: confirmed.
- Permanently-failed IDs excluded from bootstrap query: confirmed.

### View count flush
- Buffer swap pattern prevents loss during flush: confirmed.
- Retry cap (VIEW_COUNT_MAX_RETRIES = 3) prevents indefinite re-buffering: confirmed.
- Post-flush cap enforcement: confirmed.
- Backoff on sustained DB outages: confirmed.

### Connection pool
- 10 connections, queue limit 20, keepalive: confirmed.
- Advisory locks use dedicated connections with proper release: confirmed.

## New Findings

None.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-08: `lib/data.ts` approaching 1200 lines — extraction could improve maintainability.
- AGG6R-15: `getImage` 2-round-trip query pattern is already optimal — no action needed.
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory.
