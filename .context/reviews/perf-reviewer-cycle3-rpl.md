# Performance Review — Cycle 3 (RPL loop)

**Date:** 2026-04-23
**Scope:** CPU, memory, UI responsiveness, concurrency, DB query patterns, image pipeline, caching.

## Summary

No new performance findings this cycle. The codebase carries forward the perf architecture established across cycles 1-46:

- **React cache() deduplication** on hot read paths (`getImage`, `getTopicBySlug`, `getTopicsWithAliases`).
- **Promise.all parallelization** for independent DB queries in `getImage` (tags + prev + next).
- **ISR caching** (photo pages 1 week, topic/home 1 hour).
- **Composite DB indexes** on `images(processed, capture_date, created_at)` and variants.
- **Connection pool** 10 + queue 20, keepalive.
- **Parallel Sharp pipeline** with single-instance `.clone()` pattern (no triple buffer decode).
- **PQueue concurrency:1** for image processing with TOCTOU-safe claim/UPDATE.
- **content-visibility: auto** on masonry cards + per-card `containIntrinsicSize`.
- **useMemo** reorder for columns; **useCallback** for handlers.
- **requestAnimationFrame**-debounced resize.
- **Ref-based DOM manipulation** on image-zoom + histogram (no re-renders on mousemove).
- **Histogram canvas capped at 256×256** for bounded compute.
- **Upload tracker Map** with hard-cap LRU eviction + expiry-based pruning.
- **Rate-limit Maps** similarly capped.
- **MySQL-backed rate limiter** with `INSERT ... ON DUPLICATE KEY UPDATE` atomic upsert.
- **Incremental object-URL management** in upload-dropzone (creates/revokes only for added/removed files, not on every render).

## Carry-forward deferrals (unchanged)

| ID | Source | Status |
|---|---|---|
| D6-01 | cursor/keyset infinite scroll for public feed | deferred |
| D6-05 / D2-03 | Streaming CSV export | deferred |
| D6-06 | Sitemap partitioning | deferred |
| D2-04 | Duplicate in-memory rate-limit maps (refactor unification) | deferred |
| D2-05 | `searchImages` sequential round-trips | deferred |
| D2-06 | `bootstrapImageProcessingQueue` unpaginated SELECT | deferred |
| PERF-UX-01 | Blur placeholder is a no-op (1×1 PNG) | deferred (not regression) |
| PERF-UX-02 | Full Pretendard variable font served (no subset) | deferred |

## Totals

- **0 new findings**
- **8 carry-forwards unchanged**
