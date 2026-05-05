# Code Review — Cycle 21

## Review Scope
Full repository review focused on code quality, logic correctness, edge cases, and maintainability. Examined recent changes (last 20 commits) and critical paths.

## Findings

### C21-HIGH-01: Semantic Search Returns Deterministic but Meaningless Results
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 141-147)
**Confidence**: High

The semantic search endpoint is fully wired and production-ready from an API perspective, but the underlying `embedTextStub` and `embedImageStub` functions in `clip-inference.ts` produce deterministic SHA-256-based embeddings that carry NO semantic meaning. The cosine similarity between a query and image embedding is essentially random.

**Problem**: The `semantic_search_enabled` admin toggle exists, and the endpoint responds with structured results that LOOK correct (image IDs, scores, metadata enrichment). An admin who enables this feature will see "results" but they are random. The only hint is a code comment and the stub implementation docs.

**Failure scenario**: Admin enables semantic search. Users see "semantic search" UI, submit queries, and get back photos that have nothing to do with their query. The scores appear legitimate (0.18-0.95 range). Users lose trust in the search feature.

**Fix**: Add a prominent warning in the admin settings UI that the feature requires running the backfill script AND replacing the stub with real ONNX inference. Consider returning a 503 with "Semantic search not fully configured" until a real encoder is available, OR add a config flag `semantic_search_stub_mode` that must be explicitly enabled.

---

### C21-MED-01: Chunked Transfer Encoding Bypasses Semantic Search Body Size Guard
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 74-90)
**Confidence**: High

The body size guard checks `Content-Length` header:
```typescript
const contentLength = request.headers.get('content-length');
if (contentLength) {
    const contentLengthNum = Number(contentLength);
    ...
    if (contentLengthNum > MAX_SEMANTIC_BODY_BYTES) {
        return ... 413 ...
    }
}
```

If the client uses `Transfer-Encoding: chunked` (which omits `Content-Length`), this guard is completely bypassed. The subsequent `await request.json()` will attempt to parse an unbounded stream.

**Failure scenario**: An attacker sends a chunked POST with a multi-megabyte JSON payload. The server buffers it into memory before JSON parsing fails.

**Fix**: Add a guard that rejects requests with `Transfer-Encoding: chunked` OR read the body with a size-limited approach: `const text = await request.text(); if (text.length > MAX_SEMANTIC_BODY_BYTES) return 413;` before JSON parsing.

---

### C21-MED-02: `quiesceImageProcessingQueueForRestore` Does Not Wait for Active Jobs
**File**: `apps/web/src/lib/image-queue.ts` (lines 604-625)
**Confidence**: High

The `quiesceImageProcessingQueueForRestore` function pauses the queue and waits for `onPendingZero()`, but `onPendingZero()` in p-queue only waits for the pending count (queued but not started) to reach zero. It does NOT wait for currently active/running jobs to complete.

**Failure scenario**: An image is actively being processed (Sharp encoding) when admin initiates a DB restore. `quiesceImageProcessingQueueForRestore` returns immediately because no jobs are "pending" (the active one is running). The restore proceeds while files are being written to disk and DB rows being updated, causing data corruption or partial files.

**Fix**: Use `await queue.onIdle()` (if p-queue version supports it) or implement a custom waiter that tracks active job count and waits for completion.

---

### C21-MED-03: Race Condition in `decrementRateLimit` UPDATE+DELETE Sequence
**File**: `apps/web/src/lib/rate-limit.ts` (lines 427-454)
**Confidence**: Medium

Between the UPDATE and DELETE in `decrementRateLimit`, another concurrent request could execute `incrementRateLimit` (INSERT ... ON DUPLICATE KEY UPDATE). The sequence:
1. Request A: UPDATE sets count=0
2. Request B: INSERT ... ON DUPLICATE KEY UPDATE sets count=1
3. Request A: DELETE removes row with count=1

The increment from Request B is silently lost. This is in the rollback path, but means rate-limit counters can undercount in high-concurrency scenarios.

**Fix**: Wrap both operations in a transaction with `START TRANSACTION; UPDATE ...; DELETE ...; COMMIT;` or use a single atomic `DELETE ... WHERE count <= 1` preceded by a conditional UPDATE.

---

### C21-LOW-01: Service Worker HTML Cache Has No Size Limit or Eviction
**File**: `apps/web/src/public/sw.js` (lines 18, 143-178)
**Confidence**: High

The `HTML_CACHE` stores every HTML page the user visits. Unlike `IMAGE_CACHE` which has a 50MB LRU eviction policy, the HTML cache has NO size limit and NO eviction.

**Failure scenario**: A user browsing a large gallery could accumulate hundreds of HTML responses in cache storage, potentially hitting browser storage limits.

**Fix**: Add an LRU eviction policy to HTML_CACHE similar to IMAGE_CACHE, with a conservative cap (e.g., 5MB or 50 entries).

---

### C21-LOW-03: `backfillClipEmbeddings` Has No Rate Limiting
**File**: `apps/web/src/app/actions/embeddings.ts`
**Confidence**: Medium

The `backfillClipEmbeddings` server action processes up to 5000 images with no rate limiting. A compromised admin account could trigger it repeatedly, causing CPU and DB write pressure.

**Fix**: Add a per-admin rate limit (e.g., once per hour) or a global semaphore.

---

### C21-LOW-04: Semantic Search Accepts Any Content-Type
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 64-109)
**Confidence**: Low

The endpoint does not validate `Content-Type: application/json`. Accepting any Content-Type and attempting JSON.parse is poor API hygiene.

**Fix**: Add `if (!request.headers.get('content-type')?.includes('application/json')) return 400` before body parsing.

---

### C21-LOW-05: Bootstrap Cleanup Tasks Run Repeatedly
**File**: `apps/web/src/lib/image-queue.ts` (lines 576-592)
**Confidence**: Low

Bootstrap runs expensive cleanup (`purgeExpiredSessions`, `purgeOldAuditLog`) on every call. Bootstrap is triggered on startup, after failed jobs, and after queue drains.

**Fix**: Track whether cleanup has run in the current process and skip redundant invocations.

---

### C21-LOW-06: OG Photo Route Buffer Size Guard Bypassable via Chunked Encoding
**File**: `apps/web/src/app/api/og/photo/[id]/route.tsx` (lines 91-100)
**Confidence**: Medium

The route checks `Content-Length` to guard against oversized photo responses. But with chunked encoding (no Content-Length), the guard is bypassed and `await photoRes.arrayBuffer()` buffers the entire response.

**Fix**: Add a fallback size check on the buffer after `arrayBuffer()`.

---

## Summary
| Severity | Count |
|----------|-------|
| High     | 1     |
| Medium   | 3     |
| Low      | 5     |
