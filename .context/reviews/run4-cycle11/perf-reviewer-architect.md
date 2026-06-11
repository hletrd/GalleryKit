# Run-4 Cycle 11 — perf-reviewer / architect angle

## Inventory
- View-count flush concurrency machine (`data.ts:37-179`): backoff growth,
  chunked `Promise.all` (FLUSH_CHUNK_SIZE=20), re-buffer caps, retry-map cap.
- OG photo fetch fan-out (`og-photo-fetch.ts`): ascending size iteration,
  per-attempt 10s timeout + 1 MB cap.
- Rate-limit bounded maps (`rate-limit.ts`, `bounded-map.ts`): reset-at vs
  window maps, prune cadence.
- Analytics aggregation queries (`analytics-data.ts`): all use indexed
  `(col + viewed_at)` ranges + GROUP BY with LIMIT.

## Findings
- **COR-R4C11-01 (perf/availability facet, folds into the code-angle
  finding):** under DB slowness the view-count flush can self-strand its
  timer, after which it stops draining and the buffer grows to its 1000-entry
  cap and then silently drops every subsequent increment. The cost is bounded
  memory (cap) but unbounded *duration* (until restart). The fix (null timer
  on entry + re-arm on the isFlushing early-return) restores self-draining
  with no added DB load — the re-armed timer respects the existing
  exponential backoff (`getNextFlushInterval`).

## No other perf/arch issues
- The flush chunking, pool-size-aware concurrency, and backoff are sound.
- OG ascending fetch is the intended cost/availability trade-off; the
  per-attempt timeout bounds tail latency.
- Layering is intact: smart-collection compiler stays pure/I-O-free; the
  DB-bearing helpers are segregated below the compiler in the same module
  as documented.
