# Perf-Reviewer — Cycle 12

**HEAD:** 2a9976a1  
**Date:** 2026-06-27  
**Angle:** performance, concurrency, CPU/memory/UI responsiveness, DB query efficiency, N+1 queries, connection pool pressure, event loop blocking, Sharp/libvips memory, React re-renders, bundle size, caching/ETag, semantic-search scan, image-queue concurrency, unbounded Maps/memory leaks.

---

## Status vs. Prior Cycles

**Cycle 10 baseline:** 0 CRITICAL / 0 HIGH / 22 MEDIUM / 47 LOW  
**Cycle 11 findings:** 2 HIGH / 5 MEDIUM / 7 LOW  
**Cycle 11 fixes confirmed in this HEAD:**
- AGG-9.1 (geoip lazy-load): FIXED in b3c55036 — `instrumentation.ts` pre-warms `geoip-lite` at startup via `await import('geoip-lite')`.
- R11-PERF-9.2 (no SIGTERM handler): FIXED in b3c55036 — `SIGTERM`/`SIGINT` graceful shutdown handler with 15 s race added to `instrumentation.ts`.
- R11-PERF-9.3 (navigator.connection local ConnInfo): FIXED in 92ce7a9e — local `ConnInfo` interface replaces the `Navigator` augmentation.

**Cycle 11 findings still open:** see per-finding notes below.

---

## Cycle 12 Findings

### 1. Image Processing

#### R12-PERF-1.1 (carry-over R11-PERF-2.2) — `_verifyAvifNclx` reads full file into heap before 4 KB scan
**File:** `apps/web/src/lib/process-image.ts:246–247`  
**Severity:** MEDIUM (downgraded from HIGH — scan is now bounded; main remaining cost is heap alloc)  
**Confidence:** High

```ts
const buffer = await fs.readFile(filePath);
const { ok, message } = verifyAvifNclxInBuffer(buffer.subarray(0, 4096), …);
```

`verifyAvifNclxInBuffer` now correctly limits its scan to the first 4096 bytes (the NCLX `colr` box appears in the first few hundred bytes of a valid AVIF), but `fs.readFile(filePath)` still reads the entire file into the Node heap before the slice is taken. For a 7680-wide P3 AVIF the file can reach 40–80 MB; allocating that buffer and immediately discarding all but 4 KB wastes memory, especially when the queue is processing multiple large images concurrently.

**Fix:** Use `fs.open()` + `filehandle.read(Buffer.alloc(4096), 0, 4096, 0)` to read only the first 4096 bytes, or `createReadStream({ end: 4095 })`. The `verifyAvifNclxInBuffer` function already accepts a pre-sliced Buffer, so only the call site in `_verifyAvifNclx` changes.

**Degradation scenario:** At `QUEUE_CONCURRENCY=2`, two 50 MP wide-gamut images finish encoding simultaneously and both call `_verifyAvifNclx`, allocating two ~80 MB Buffers that co-exist until GC. This doubles peak RSS momentarily and can trigger GC pauses that delay the queue tick, particularly visible on a host with constrained RSS (Docker default 512 MB containers).

---

### 2. React UI

#### R12-PERF-2.1 (carry-over R11-PERF-3.2) — `images.findIndex()` in photo-viewer not wrapped in `useMemo`
**File:** `apps/web/src/components/photo-viewer.tsx:115`  
**Severity:** LOW  
**Confidence:** High

```ts
const currentIndex = images.findIndex((img) => img.id === currentImageId);
```

This runs a linear scan on every render of `PhotoViewer`. State changes that trigger re-renders without changing `images` or `currentImageId` — e.g. blur-placeholder load completion (`setImageLoaded`), lightbox toggle, info sheet open/close — all unnecessarily re-run the scan.

**Fix:** `const currentIndex = useMemo(() => images.findIndex((img) => img.id === currentImageId), [images, currentImageId]);`

---

### 3. Data Layer / Caching

#### R12-PERF-3.1 (carry-over R11-PERF-4.2) — `getGalleryConfig()` pays a DB round-trip per image processed by background queue
**File:** `apps/web/src/lib/gallery-config.ts:217`, `apps/web/src/lib/image-queue.ts:376,494`  
**Severity:** LOW  
**Confidence:** High

`getGalleryConfig` is exported as `cache(_getGalleryConfig)` where `cache` is React's SSR request-scoped deduplication primitive. Outside of an SSR render tree (i.e., in background queue jobs), React's `cache()` creates a new scope per invocation — there is no cross-call deduplication. So every image processed by the queue reads config from the DB at lines 376 and 494.

At default `QUEUE_CONCURRENCY=1` this is two queries per image (fetch at queue entry + fetch inside the format loop), which is acceptable. At higher concurrency or during backfill, every in-flight job independently reads config on every iteration.

**Fix:** Cache the resolved config in a module-level variable with a short TTL (30–60 s) in `image-queue.ts`, or pass a pre-resolved config object into `processImageFormats` rather than re-fetching per image. The React `cache()` export remains correct for SSR; add a separate process-level TTL cache for the background-queue context.

#### R12-PERF-3.2 (carry-over R11-PERF-4.1) — `getLatestImageUpdatedAt()` has no `cache()` / `…Cached` export
**File:** `apps/web/src/lib/data.ts:488–495`  
**Severity:** LOW  
**Confidence:** Medium

`getLatestImageUpdatedAt` is a bare `async function` export with no `cache()` wrapper. Currently called once from `sitemap.ts:42` so there is no duplication in the present call graph, but the pattern is inconsistent with every other hot function in `data.ts` that ships a `…Cached` variant. Any future caller that invokes it twice in the same SSR pass will double-count the DB hit without warning.

**Fix:** Export `export const getLatestImageUpdatedAtCached = cache(getLatestImageUpdatedAt)` and use the cached variant from `sitemap.ts`.

---

### 4. DB Query Efficiency

#### R12-PERF-4.1 (carry-over AGG-M21) — N+1 await-in-loop UPDATEs in `bulkUpdateImages` alt-text copy path
**File:** `apps/web/src/app/actions/images.ts:1021–1031`  
**Severity:** LOW  
**Confidence:** High

```ts
for (const { id, caption } of toUpdate) {
    await tx.update(images)
        .set({ title: caption })
        .where(eq(images.id, id));
}
```

Per-row awaited UPDATE inside a transaction. With the batch cap of 100 images and each await serializing the Node event loop while waiting for the DB reply, the worst case is 100 sequential round-trips holding the DB connection for the entire transaction duration. In practice `toUpdate` is usually 0–5 rows, so practical impact is low.

**Fix:** Either `Promise.all(toUpdate.map(…))` to parallelize (MySQL still serializes server-side within the transaction but Node is free between round-trips), or use a `CASE WHEN id=? THEN ? … END` bulk expression to reduce to a single UPDATE statement.

#### R12-PERF-4.2 (carry-over AGG-M22) — Sequential `await ensureTagRecord()` in tag-addition loop
**File:** `apps/web/src/app/actions/images.ts:1036–1046`  
**Severity:** LOW  
**Confidence:** High

```ts
for (const name of addTagNames) {
    const resolved = await ensureTagRecord(tx, cleanName, slug);
    …
}
```

Each tag name is resolved independently with a serialized await. Tag names are independent of each other; pre-loading existing tags with `SELECT … WHERE slug IN (…)` before the loop and then batching the INSERT IGNOREs would reduce the round-trip count from O(n_tags) to O(1 + n_new_tags). The transaction context makes `Promise.all` risky here, so the batch-preload approach is safer.

---

### 5. Rate Limiting

#### R12-PERF-5.1 (NEW) — `decrementRateLimit` wraps two queries in a DB transaction per rollback
**File:** `apps/web/src/lib/rate-limit.ts:446–467`  
**Severity:** LOW  
**Confidence:** High

```ts
await db.transaction(async (tx) => {
    await tx.update(rateLimitBuckets)
        .set({ count: sql`GREATEST(${rateLimitBuckets.count} - 1, 0)` })
        .where(…);
    await tx.delete(rateLimitBuckets).where(
        and(…, sql`${rateLimitBuckets.count} <= 0`)
    );
});
```

Every successful keyword search completion (`public.ts:36,72`), share creation, and user creation calls `decrementRateLimit`, which opens a DB transaction and sends two queries: one UPDATE then one DELETE for zero-count cleanup. The DELETE is eager inline garbage collection; the hourly `purgeOldBuckets` already handles expiry of old rows, so the inline zero-cleanup adds transaction overhead without a correctness benefit.

**Degradation scenario:** On a gallery with moderate search traffic (30 searches/min rate-limit ceiling), this generates 60 DB queries in transactions where 30 would suffice, and each transaction holds a connection for two round-trips. The connection pool has 10 connections and queue limit 20; under sustained rollback load this marginally increases pool pressure alongside live render traffic.

**Fix:** Remove the `db.transaction()` wrapper and drop the inline DELETE. Extend the existing `purgeOldBuckets` cleanup to also sweep `count <= 0` rows (or let normal bucket expiry handle it). This reduces `decrementRateLimit` to a single UPDATE with no transaction overhead.

---

### 6. Event Loop / Shutdown

#### R12-PERF-6.1 (NEW) — Shutdown timeout `setTimeout` not `.unref()`'d; process waits 15 s after clean drain
**File:** `apps/web/src/instrumentation.ts:21–26`  
**Severity:** LOW  
**Confidence:** High

```ts
const shutdownTimeout = new Promise<void>((resolve) => {
    setTimeout(() => {
        console.warn('[Shutdown] Timed out after 15s, forcing exit with queued jobs remaining');
        resolve();
    }, 15_000);
    // No .unref() on the timer
});
```

When all queue work and view-count flushes complete before the 15 s deadline, `Promise.race` resolves and `process.exitCode = 0` is set. The function returns, but the 15 s `setTimeout` is still registered in the event loop. Node cannot exit until the event loop is empty, so the process waits the full remaining timeout before the timer fires (resolving the now-abandoned promise) and the loop can drain.

In the Docker Compose deployment, `StopTimeout` defaults to 10 s. If the queue drains in 2 s but the timer keeps the loop alive for 13 more seconds, Docker sends SIGKILL at the 10 s mark and the process exits with a non-zero code — indistinguishable to the orchestrator from a hung shutdown. Compare: `image-queue.ts` already uses `retryTimer.unref?.()` as the correct pattern.

**Fix:**
```ts
const shutdownTimeout = new Promise<void>((resolve) => {
    const t = setTimeout(() => {
        console.warn('[Shutdown] Timed out after 15s, forcing exit with queued jobs remaining');
        resolve();
    }, 15_000);
    t.unref();   // allow the event loop to drain if work finishes before the timeout
});
```

---

### 7. Semantic Search

#### R12-PERF-7.1 (carry-over R11-PERF-7.1) — Brute-force O(n) embedding scan (deferred)
**File:** `apps/web/src/app/api/search/semantic/route.ts:252–258`  
**Severity:** MEDIUM  
**Confidence:** High

The route reads all `image_embeddings` rows for the active model version up to `SEMANTIC_SCAN_LIMIT=2000`, decodes each 2 KB MEDIUMBLOB, and computes dot-product similarity in JavaScript. At production scale (~445 embeddings × 512 floats), each query runs ~228 K floating-point MACs and decodes ~890 KB of Buffer. The route is rate-limited (30 req/min/IP) which bounds sustained load at personal-gallery scale.

**Degradation scenario:** At 2000 embeddings (the hard scan cap), each query decodes 4 MB of MEDIUMBLOB and runs ~1 M MACs. At 30 req/min this is 30 full scans per minute; on a single-CPU container this can produce measurable CPU spikes per query cluster.

**Acknowledged deferral:** ANN index (FAISS, HNSW, or MySQL vector extension) would reduce query complexity. At personal-gallery scale (< 1000 photos) brute-force is adequate. Revisit at 1500+ embeddings.

#### R12-PERF-7.2 (carry-over R11-PERF-7.2) — `topK` performs O(n log n) full sort for small k
**File:** `apps/web/src/lib/clip-embeddings.ts:138–143`  
**Severity:** LOW  
**Confidence:** High

```ts
return matches
    .filter(m => m.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
```

After threshold filtering the surviving set is fully sorted. For n=2000 and k=20 (the default), a min-heap partial sort would be O(n log k) ≈ 5× fewer comparisons. Impact is negligible at current gallery sizes and is subsumed by the DB read cost; worth addressing only alongside R12-PERF-7.1.

---

## Summary

**Cycle 12 severity counts:** 0 CRITICAL / 0 HIGH / 2 MEDIUM / 6 LOW

| ID | Sev | New/Carry | File | One-line description |
|----|-----|-----------|------|----------------------|
| R12-PERF-1.1 | MED | carry-over | process-image.ts:246 | `_verifyAvifNclx` reads full file then slices to 4 KB — allocates up to 80 MB unnecessarily |
| R12-PERF-7.1 | MED | carry-over | api/search/semantic/route.ts:252 | Brute-force O(n=2000) embedding scan per semantic query (acknowledged deferral) |
| R12-PERF-2.1 | LOW | carry-over | photo-viewer.tsx:115 | `images.findIndex()` O(n) linear scan on every render without `useMemo` |
| R12-PERF-3.1 | LOW | carry-over | image-queue.ts:376,494 | `getGalleryConfig()` pays a full DB query per image processed (React `cache()` inactive in background) |
| R12-PERF-3.2 | LOW | carry-over | data.ts:488 | `getLatestImageUpdatedAt` missing `cache()` / `…Cached` export |
| R12-PERF-4.1 | LOW | carry-over | images.ts:1021 | N+1 await-in-loop UPDATE in `bulkUpdateImages` alt-text copy path |
| R12-PERF-4.2 | LOW | carry-over | images.ts:1042 | Sequential `await ensureTagRecord()` in tag-addition loop |
| R12-PERF-5.1 | LOW | **NEW** | rate-limit.ts:446 | `decrementRateLimit` wraps 2 queries in a DB transaction; 1 UPDATE + lazy GC suffices |
| R12-PERF-6.1 | LOW | **NEW** | instrumentation.ts:21 | Shutdown timeout `setTimeout` not `.unref()`'d; process waits full 15 s after clean drain |
| R12-PERF-7.2 | LOW | carry-over | clip-embeddings.ts:138 | `topK` does O(n log n) full sort; min-heap O(n log k) would be ~5× faster for k=20 |

**New this cycle:** R12-PERF-5.1 (`decrementRateLimit` transaction overhead), R12-PERF-6.1 (shutdown timer `.unref()`).  
**Confirmed fixed since cycle 11:** geoip pre-warm (AGG-9.1 → b3c55036), SIGTERM handler (R11-PERF-9.2 → b3c55036), navigator.connection ConnInfo interface (R11-PERF-9.3 → 92ce7a9e).
