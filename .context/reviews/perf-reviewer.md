# Performance Review — Cycle 15 (2026-05-06)

**Reviewer angle**: Performance, concurrency, CPU/memory/UI responsiveness
**Scope**: Image processing pipeline, database queries, caching strategies, rate-limiting data structures, service worker efficiency
**Gates**: All green (vitest 1049 tests)

---

## Executive Summary

Performance characteristics remain optimal. No new performance regressions or bottlenecks identified in cycle 15.

## Findings

No new findings in cycle 15.

## Verified Performance Patterns

1. **Image queue** (`lib/image-queue.ts`): PQueue concurrency is configurable via `QUEUE_CONCURRENCY`. Single Sharp instance with `clone()` avoids triple buffer decode. Parallel AVIF/WebP/JPEG processing via `Promise.all`. Per-image libvips concurrency capped at `floor((cores - 1) / 3)` to prevent thread pool starvation.

2. **BoundedMap** (`lib/bounded-map.ts`): Pruning is O(n) over the Map size, but the hard caps (2000-5000 entries) keep this trivial. No LRU overhead — FIFO eviction is sufficient for the single-writer topology.

3. **Data layer** (`lib/data.ts`): React `cache()` deduplicates SSR queries. `Promise.all` parallelizes independent queries (tags + prev + next). View count flush uses atomic Map swap and chunking (20 entries per chunk) to limit concurrent DB promises.

4. **Semantic search** (`app/api/search/semantic/route.ts`): Embeddings scanned with `LIMIT SEMANTIC_SCAN_LIMIT` (5000) hard cap. Cosine similarity computed in-memory after DB filter. Query embedding via stub encoder is synchronous (no async overhead).

## Areas Examined With No Issues Found

- `lib/process-image.ts` — parallel format conversion, ICC profile caching, atomic rename fallback chain
- `lib/rate-limit.ts` — in-memory fast path with DB backup
- `components/image-zoom.tsx` — ref-based DOM manipulation, no React re-renders on mousemove
- `components/histogram.tsx` — Canvas capped at 256x256

## Conclusion

No performance concerns in cycle 15.
