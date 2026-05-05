# Performance Review — Cycle 22

## Method
Reviewed image queue, service worker caching, semantic search pipeline, and bootstrap behavior for CPU/memory/IO bottlenecks.

## Findings

### MEDIUM

#### C22-PERF-01: Bootstrap cleanup runs redundant DB operations
- **Source**: `apps/web/src/lib/image-queue.ts:583-585`
- **Issue**: `purgeExpiredSessions`, `purgeOldBuckets`, and `purgeOldAuditLog` run synchronously on every bootstrap. These are DELETE queries that may scan large tables. During active upload periods, bootstrap runs frequently (after each 500-image batch + continuation), causing repeated full-table scan DELETEs.
- **Impact**: Unnecessary DB IO. The hourly gcInterval already handles periodic cleanup.
- **Fix**: Run cleanup only once on first bootstrap, or rely solely on the hourly interval.
- **Confidence**: Medium

#### C22-PERF-02: SW HTML cache grows without eviction pressure
- **Source**: `apps/web/public/sw.js:143-178`
- **Cross-reference**: C22-HIGH-02 (code-reviewer)
- **Issue**: HTML_CACHE has no size or entry limit. Each unique HTML route is cached for 24h. On a gallery with many topics/photos, a user could accumulate hundreds of entries.
- **Impact**: Increased memory/storage in the browser. No direct server impact.
- **Fix**: Add entry count cap with LRU eviction.
- **Confidence**: Medium

#### C22-PERF-03: Semantic search scans up to 5000 embeddings unconditionally
- **Source**: `apps/web/src/app/api/search/semantic/route.ts:178-184`
- **Issue**: The endpoint always scans `SEMANTIC_SCAN_LIMIT` (5000) most-recent embeddings, even when the total embedding count is much smaller. While the DB LIMIT is efficient, the full scan + base64 decode + cosine similarity computation for 5000 embeddings is CPU-intensive.
- **Impact**: ~200-400ms of CPU per request for large galleries. With 30 req/min rate limit, this is manageable but not optimal.
- **Fix**: Add an early-exit when total embeddings < topK, or add a smaller default scan limit.
- **Confidence**: Low

## Final Sweep
No new memory leaks. No new N+1 queries. Image queue concurrency remains bounded. Caption and embedding hooks remain correctly fire-and-forget.
