# Cycle 18 — Performance Reviewer Findings

Date: 2026-05-06
Scope: Full repository, post-cycle-17 fixes
Focus: CPU/memory, concurrency, UI responsiveness, database query efficiency

## Verified Prior Fixes

- C17-PERF-01 (missing iccProfileName): FIXED in 38077b9 — P3/10-bit path now correctly triggered.
- C17-PERF-02 (COUNT(*) OVER()): Still present, deferred.
- C17-PERF-03 (searchImages over-fetch): Still present, acceptable at current scale.

---

## New Findings

### MEDIUM SEVERITY

**C18-PERF-01: Service Worker LRU eviction may not actually delete cache entries**
- **File:** `apps/web/public/sw.template.js:94` / `apps/web/public/sw.js:94`
- **Confidence:** MEDIUM
- **Cross-reference:** C18-MED-01 (code-reviewer)
- **Problem:** `imageCache.delete(entry.url)` uses a string URL, but entries were stored with `imageCache.put(request, ...)`. The Cache API may not match string URLs against Request-keyed entries. This means the LRU eviction logic updates its metadata but fails to free actual cache storage. On a gallery with many images, the browser cache grows beyond the 50 MB budget, consuming device storage and potentially triggering quota eviction that removes entries unpredictably.
- **Fix:** Use consistent key types. Store the URL string as the cache key throughout, or store the Request object in metadata and use it for deletion.

---

### LOW SEVERITY

**C18-PERF-02: Semantic search scans up to 5000 embeddings with full cosine computation**
- **File:** `apps/web/src/app/api/search/semantic/route.ts:145-169`
- **Confidence:** LOW
- **Problem:** For every semantic search query, the endpoint fetches up to 5000 embeddings from the DB and computes cosine similarity in JavaScript. At 5000 rows * 512-dim float32 vectors, this is ~10 MB of base64-decoded data and ~25 million floating-point operations per request. With 30 requests/minute, this is ~750M ops/min. While within Node.js capability on modern hardware, it is the most CPU-intensive public endpoint.
- **Mitigation:** The rate limit (30/min/IP) and same-origin check provide adequate throttling. No immediate action needed, but this surface should be monitored if semantic search is enabled at scale.
