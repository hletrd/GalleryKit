# Performance Review — Cycle 22
**Date:** 2026-06-29
**HEAD:** 6ef2495d (post-cycle-21 fixes, R21C21 complete)
**Findings:** 0 new; 0 regressions; cycle-21 T3/T4 fixes verified; all prior deferrals re-confirmed

---

## Cycle-21 Fix Verification

### T4 — SEMANTIC_SCAN_LIMIT / TOP_K_MAX env-wired — CONFIRMED

`apps/web/src/lib/clip-embeddings.ts:26–31`:

```ts
function envPositiveInt(raw: string | undefined, fallback: number): number {
    const n = Number(raw ?? '');
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
export const SEMANTIC_TOP_K_MAX = envPositiveInt(process.env.SEMANTIC_TOP_K_MAX, 50);
export const SEMANTIC_SCAN_LIMIT = envPositiveInt(process.env.SEMANTIC_SCAN_LIMIT, 2000);
```

`envPositiveInt` uses `Number()` (not `parseInt`) per the cycle-20 env-parse sweep. `NaN`, `Infinity`,
and `≤0` all fall back to the documented defaults. The CLAUDE.md "Runtime limits" section documents
both constants as env-tunable. Commit `fbd94da2`.

### T3 — View-buffer retry-counter eviction — CONFIRMED

Commit `9c3cd64d` dropped the stale retry counter when an entry is evicted from the view-count
buffer cap. The `VIEW_COUNT_MAX_RETRIES` cap, exponential backoff, and `FLUSH_CHUNK_SIZE=5`
batched flush are unchanged and correct. No Map leak on cap overflow.

### instrumentation.ts — geoip-lite startup pre-warm — CONFIRMED

`apps/web/src/instrumentation.ts:8–16`:

```ts
// AGG-R11C11-L13: Pre-warm geoip-lite at startup so the first analytics
// lookup does not pay the 50-100 ms module-load penalty on the hot path.
try {
    await import('geoip-lite');
} catch { /* data files absent — graceful fallback in analytics.ts */ }
```

A 50–100 ms module-load penalty on the first real analytics request is shifted to the background
startup path. Runs inside `register()` under the `NEXT_RUNTIME === 'nodejs'` guard (server-only,
no client-bundle impact). Non-fatal when geoip-lite data files are absent.

### instrumentation.ts — SIGTERM/SIGINT graceful drain — CONFIRMED

`apps/web/src/instrumentation.ts:18–88`: `Promise.all([shutdownImageProcessingQueue(), flushBufferedSharedGroupViewCounts()])` races a 15 s deadline. Both signal handlers carry a re-entrancy guard (`shutdownInProgress`) so repeated signals during drain do not double-exit. `shutdownTimer.unref?.()` prevents the sentinel from keeping the event loop alive after a clean drain. Explicit `process.exit(exitCode)` on completion — prevents the MySQL connection-pool sockets from holding the process open after drain finishes. No regression.

---

## Prior Deferred Items — Re-evaluation

All nine prior deferred items re-confirmed. No exit criteria triggered.

| ID | Item | Status |
|----|------|--------|
| PERF-C19-01 | `getImagesForSmartCollection` COUNT(*) OVER() per cursor page | Deferred — architect decision, admin-only |
| PERF-C19-02 | Bootstrap `NOT IN (≤1000 failed IDs)` per 30 s | Deferred — bounded, PK index |
| PERF-C19-03 | Serial smart-collection UPDATEs in held advisory lock | Deferred — admin-only, infrequent |
| PERF-C19-04 | Histogram 768-elem temp array per redraw | Deferred — single canvas worker, micro-cost |
| PERF-C19-05 | `useDisplayCapability` 5 listeners × N consumers | Deferred — bounded, idempotent |
| PERF-C20-02 | `getTopics()` N correlated subqueries per call | Deferred — < 50 topics, idx_images_topic hit |
| PERF-C20-03 | Semantic search 2000×512-dim scoring synchronous on event loop | Deferred — hard caps + rate limit; 445 prod embeddings ≈ 228 K ops |
| PERF-C21-01 | `similar/[id]` shares PERF-C20-03 class + 1 extra DB round-trip | Deferred — same mitigations, same exit criterion as C20-03 |
| PERF-C21-02 | `setAllImages(prev => [...prev, ...new])` O(N) spread | Informational / no action |

**PERF-C19-01 detail:** `apps/web/src/lib/data.ts:1411–1414` confirmed: `COUNT(*) OVER()` still present on both offset and cursor pages. The inline comment at 1399–1403 documents the explicit architect decision to keep the unified select shape (forking was rejected at run4-cycle5). Exit criterion unmet.

**PERF-C20-03 / C21-01 detail:** `clip-embeddings.ts` confirmed — `dotProduct` fast path (unit vectors, skip sqrt, AGG-C10-11c) in place at lines 63–70. Production corpus 445 embeddings at SEMANTIC_SCAN_LIMIT=2000: ≈ 228 K float ops per request. `idx_image_embeddings_model_version_updated` composite index covers the scan plan. Both the semantic text-search route and `similar/[id]` share the same 30/min/IP rate-limit bucket (`preIncrementSemanticAttempt`). Exit criterion unmet.

---

## Files Reviewed This Cycle — No New Findings

### `apps/web/src/lib/data.ts` (tail: lines 1190–1729)

- **`getSharedGroup` (lines 1237–1328):** batched tag fetch via `inArray(imageTags.imageId, imageIds)` after collecting the group's image IDs — avoids N+1 on the shared-group page. The two mandatory sequential queries (group lookup → image fetch) are unavoidable. The third query (tags) is correctly parallelized in a single `inArray`. No concern.
- **`getImagesForSmartCollection`:** COUNT(*) OVER() re-confirmed (PERF-C19-01 still deferred).
- **`searchImages` (lines 1458–1608):** three-query pattern (`Promise.all([tagQuery, aliasQuery])`) parallelized. `remainingLimit` bounds over-fetch. Short-circuit at line 1577 (`remainingLimit <= 0`) skips both parallel queries when the main result fills the limit. No N+1. No concern.
- **`getMapImages`:** MAP_MAX_MARKERS=10000 hard cap; INNER JOIN on `topics.map_visible=true` (selective for personal-gallery scale); `idx_images_topic` covers the join. Runtime assertion confirms the cap. No concern.
- **`_getSeoSettings`:** single `inArray(adminSettings.key, [...SEO_SETTING_KEYS])` query. React `cache()` wrapper (`getSeoSettings`) deduplicates within the request. No concern.
- **All ten React `cache()` exports confirmed intact:** `getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`, `getSeoSettings`. No new uncached entrypoints.

### `apps/web/src/lib/clip-embeddings.ts` (complete)

- `dotProduct` fast path (unit vectors, skip sqrt) confirmed at lines 63–70. `cosineSimilarity` used only for non-unit-vector comparisons.
- `topK` at lines 151–156: filter → sort → slice. O(N log N) at N ≤ 2000 — negligible.
- `truncateAndNormalize` uses `subarray` (zero-copy typed-array view) before re-normalizing — efficient.
- `decodeEmbeddingColumn` (AGG-C10-01): Buffer raw 2048-byte path + legacy base64 fallback. Defensive, no perf concern.
- No new perf concerns.

### `apps/web/src/lib/image-queue.ts` (complete)

- **GC timer:** armed once, guarded by `!state.gcInterval` at line 826 (AGG-M12 fix). `purgeExpiredSessions`, `purgeOldBuckets`, `purgeOldAuditLog`, `purgeOldViewEvents` all fire hourly. No multi-arm regression.
- **PERF-17-04 fix confirmed:** fire-and-forget embedding IIFE at lines 512–567 uses `resolvedSemanticMode ?? job.semanticSearchMode ?? 'disabled'` — no per-image SELECT for semantic mode on regular upload jobs or bootstrap jobs.
- **Memory bounds:** `MAX_RETRY_MAP_SIZE=10000` with FIFO eviction; `MAX_PERMANENTLY_FAILED_IDS=1000` with FIFO eviction. `pruneRetryMaps` called in every job's `finally` block — prevents unbounded Map growth between hourly GC ticks.
- **Bootstrap:** cursor-based `BOOTSTRAP_BATCH_SIZE=500` continuation via `gt(images.id, bootstrapCursorId)`. No full-table scan per batch.
- **Fire-and-forget IIFEs** (caption at line 474, embedding at line 512): correctly non-blocking — neither awaited in the main job path.

### `apps/web/src/lib/process-image.ts` (tail: lines 1092–1371)

- **Parallel fan-out:** `await Promise.all([generateForFormat('webp'…), generateForFormat('avif'…), generateForFormat('jpeg'…)])` at line 1316. Three formats encode concurrently within the queue slot.
- **Per-format-fresh Sharp instances (WI-14):** each `generateForFormat` constructs a new `sharp(processingInputPath, …)` per size iteration. No shared state between formats.
- **Same-size dedup:** `fs.link(lastRendered.filePath, outputPath)` hard link (zero-copy on same FS) at line 1140, with `copyFile` fallback. Correct `lastRendered.resizeWidth === resizeWidth` guard.
- **Base-filename atomic rename:** hard link + rename chain at lines 1283–1308, `safeUnlink(tmpPath)` in finally. Three-level fallback with warning on final fallback. No regression.
- **Post-encode audit probes** (`_verifyAvifNclx`, `_verifyWebpIccChunk`): read only the file header (minimal I/O); non-blocking warnings. No perf concern.
- **WI-15 intermediate cleanup:** `finally { if (processingInputPath !== inputPath) await safeUnlink(processingInputPath); }` at line 1364. Correct, no leak.
- **Partial-write cleanup:** catch at line 1346 uses `Promise.all(Array.from(writtenSizedPaths.webp/avif/jpeg).map(safeUnlink))` — parallel unlinks. Correct.

### `apps/web/src/instrumentation.ts` (complete — see Fix Verification above)

No new perf concerns beyond what is documented in the Fix Verification section.

---

## Overall Assessment

Cycle 22 is a clean cycle with **zero new findings** and **no regressions**.

Cycle-21 targeted fixes verified at HEAD (`6ef2495d`):
- **T4** (`fbd94da2`): `SEMANTIC_SCAN_LIMIT`/`SEMANTIC_TOP_K_MAX` env-tunable via `envPositiveInt` — CLAUDE.md documentation now matches code.
- **T3** (`9c3cd64d`): view-buffer cap eviction no longer orphans the retry counter.
- **AGG-R11C11-L13** (earlier cycle): geoip-lite pre-warmed at startup — first-analytics-request latency eliminated.

Foundational performance investments confirmed intact and unregressed:
- React `cache()` SSR deduplication across 10 data-access functions
- Cursor-based gallery pagination with no public `COUNT(*) OVER()`
- Sharp concurrency formula tuned for 3-format fan-out (`Math.max(1, floor((cpu-1)/3))`); `sharp.cache(false)` RSS control
- Per-format-fresh Sharp instances (WI-14); same-size zero-copy hard-link dedup
- Semantic scan hard-capped at 2000 rows; `dotProduct` fast path (skip sqrt for unit vectors); 445-embedding corpus ≈ 228 K ops per request
- Hourly GC armed once (not per bootstrap batch); `pruneRetryMaps` in every job `finally`
- Fire-and-forget embedding/caption IIFEs; `resolvedSemanticMode` snapshot avoids per-image SELECT
- `searchImages` three-query parallel pattern with short-circuit
- `getSharedGroup` batched tag fetch (no N+1)
- OG fetch chain bounded per-attempt at 3.5 s (PERF-C20-01, verified cycle 21)
- geoip-lite startup pre-warm; SIGTERM/SIGINT graceful drain with 15 s deadline
