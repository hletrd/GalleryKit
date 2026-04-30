# Performance Review — perf-reviewer (Cycle 14)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high performance findings.
- No new actionable performance findings.

## Verified fixes from prior cycles

1. C9-PERF-01 (search query cascade): Acknowledged as deferred — at personal-gallery scale the current parallel execution is optimal.
2. All prior redundant-IS-NULL fixes still in place.
3. Image cleanup concurrency (C2-AGG-02 / plan-257): Confirmed functioning with `IMAGE_CLEANUP_CONCURRENCY` env var.

## Deep review: query and memory analysis

### Query Patterns
- `getImage` uses `Promise.all` for 3 parallel queries (tags + prev + next): confirmed optimal.
- `getSharedGroup` uses batched tag query to avoid N+1: confirmed.
- `searchImages` short-circuits tag/alias queries when main query fills limit: confirmed.
- View count flush uses chunked processing (FLUSH_CHUNK_SIZE = 20): confirmed bounded.
- `tagNamesAgg` centralizes GROUP_CONCAT expression: confirmed no drift.

### Memory Management
- View count buffer capped at 1000 entries: confirmed.
- Retry count map capped at 500 entries: confirmed.
- BoundedMap used for all rate-limit surfaces: confirmed.
- Upload tracker prune on each invocation: confirmed.
- `isFlushing` prevents concurrent flush: confirmed.

### Connection Pool
- 10 connections, queue limit 20, keepalive enabled: confirmed.
- Advisory locks use dedicated connections from `connection.getConnection()`: confirmed with proper release in `finally`.

### Image Processing Queue
- PQueue with configurable concurrency (default 1): confirmed.
- Per-image advisory lock prevents duplicate processing: confirmed.
- `clone()` pattern avoids triple buffer decode in Sharp: confirmed.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-08: `lib/data.ts` approaching 1200 lines — extraction could improve maintainability.
- AGG6R-15: `getImage` 2-round-trip query pattern is already optimal — no action needed.
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory.
