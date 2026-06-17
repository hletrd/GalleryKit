# Performance & Concurrency Review — Run-7 Cycle-1 (perf-reviewer)

**Reviewer:** perf-reviewer
**HEAD:** `17f743f7` (master, 2026-06-18)
**Scope:** Whole-repo performance + concurrency + race-condition + shared-state audit
**Prior context:** Run-6 c11 CONVERGED (0 perf findings). AGG-C11-01 fixed in `2fc9a23f`. DEF-C11-01 (search input `h-8`, LOW) deferred — NOT re-raised (no new evidence).
**Verdict: APPROVE — ZERO performance or concurrency defects found.**

---

## Summary

A full audit of every performance- and concurrency-sensitive surface was performed at HEAD `17f743f7`. The codebase has genuinely converged on the performance/concurrency axis. Every bounded buffer, lock, queue, and connection budget documented in CLAUDE.md was independently re-verified from source (not from comments). No CRITICAL, HIGH, MEDIUM, or LOW performance defect surfaced.

Key deltas since the run-6 c11 review (HEAD `bb463062`): the CLIP activation docs and deploy auto-prune notes landed (commits `030fbfd5`, `ce0b47a6`, `17f743f7`), but **no perf-impacting code changed** on the audited surfaces. The image-queue, backfill runner, rate-limit maps, view-count buffer, SW LRU, CLIP singleton, connection pool, and React render paths are byte-identical to the c11-verified state for the dimensions this review covers.

---

## What Was Verified (with evidence)

### 1. Image processing queue (`apps/web/src/lib/image-queue.ts`, 786 lines)
- **PQueue concurrency:** `Number(process.env.QUEUE_CONCURRENCY) || 1` (line 168) — single foreground-friendly job default; operator-overridable.
- **Per-image claim:** `GET_LOCK(?, 0)` non-blocking on a dedicated `PoolConnection` (lines 195-212). Lock connection released in `finally` (line 545) — no leak on throw.
- **Claim/conditional-UPDATE:** row existence check (line 286) + `WHERE processed = false` UPDATE with `affectedRows === 0` delete-during-processing cleanup (lines 370-391). Correct.
- **Retry Maps bounded:** `MAX_RETRY_MAP_SIZE = 10000`, `MAX_PERMANENTLY_FAILED_IDS = 10000`-scale FIFO eviction (lines 81-111, 498-514). `pruneRetryMaps` runs every GC tick.
- **Bootstrap:** keyset-paginated (`gt(images.id, cursor)`, `BOOTSTRAP_BATCH_SIZE = 500`, line 622-652), `notInArray` exclude-list capped by `MAX_PERMANENTLY_FAILED_IDS = 1000` (line 83). No table scans.
- **GC interval armed exactly once:** `if (!state.gcInterval)` guard (line 712) — the AGG-M12 fix is live; continuation batches no longer reset the hourly timer.
- **Fire-and-forget hooks:** caption (line 398) and embedding (line 434) hooks both run after `processed=true` commits; both have `.catch()` handlers — no unhandled-rejection risk.
- **Restore quiesce:** `pause() → clear() → onIdle()` order (lines 757-759) — the COR-R4C12-01 deadlock fix is live.

### 2. Backfill runner concurrency budgeting (`admin-backfill-runner.ts:129-142`)
- **`resolveBackfillConcurrency`** caps against pool budget: `cap = max(1, floor((LIMIT − RESERVED − 1) / 2))` with `RESERVED = max(3, ceil(LIMIT/2))`.
- At LIMIT=10: RESERVED=5, cap=2. A backfill pins at most 1 (advisory lock) + 2×2 (worker connections) = 5, leaving ≥ 5 free for live traffic.
- **Non-finite pool guard:** `Number.isFinite(poolLimit) ? poolLimit : 10` (line 137) — a test mock with undefined `POOL_CONNECTION_LIMIT` falls back to 10, never NaN-freezes PQueue.
- **Per-image claim** (`acquireImageProcessingClaim`, line 343): non-blocking `GET_LOCK(?, 0)`; a pool-exhausted acquire is treated as `locked` skip (lines 487-490) — never a tight error spin.
- **Keyset pagination:** `id > cursor ORDER BY id ASC LIMIT 100` (line 400-407), `onIdle()` between batches — memory O(batch) not O(gallery).
- **Delete-during-reencode:** `affectedRows === 0` on both the success and detection-failed UPDATE branches triggers `cleanupDeletedMidReencodeVariants` (lines 573-576, 605-608). Matches the queue worker's contract.
- **Whole-run advisory lock** held on a dedicated connection; `triggerAdminBackfill` returns immediately with `already_running` if held (lines 828-831) — no hidden second invocation queueing for hours.

### 3. DB connection pool (`apps/web/src/db/index.ts`)
- `connectionLimit: 10`, `waitForConnections: true`, `queueLimit: 20` (lines 23-33). Matches CLAUDE.md exactly.
- Single-writer topology documented and respected: the backfill cap, the restore advisory lock, and the per-image processing lock all assume one writer. No horizontal-scaling hazard introduced.

### 4. Rate-limit Maps (bounded — all use `bounded-map.ts`)
- Every in-memory rate-limit Map is constructed via `createResetAtBoundedMap` / `createWindowBoundedMap` with a hard `maxKeys` cap:
  - login: 5000, search: 2000, og: 2000, checkout: 2000, share: 2000, semantic: 2000, account-login: 5000, password-change: 5000, view-record: 2000.
- `BoundedMap.prune()` (bounded-map.ts:98-129): collect-then-delete pattern, hard-cap FIFO eviction. No unbounded growth path exists.
- **Search prune throttle:** `SEARCH_RATE_LIMIT_PRUNE_INTERVAL_MS = 1000` (line 120) avoids O(n) prune on every request.

### 5. View-count buffer (`data.ts:12-189`)
- **Bounded:** `MAX_VIEW_COUNT_BUFFER_SIZE = 1000` (line 29) with explicit capacity check + drop-on-overflow (lines 47-51, 125-128, 143-150).
- **Retry bounded:** `MAX_VIEW_COUNT_RETRY_SIZE = 500` (line 27), `VIEW_COUNT_MAX_RETRIES = 3` (line 22) — dropped after 3 failed flushes.
- **Chunked flush:** `FLUSH_CHUNK_SIZE = 20` (line 61) — bounded concurrent DB promises.
- **Atomic swap:** `let viewCountBuffer` swapped before drain (line 95-96) so concurrent increments go to a fresh Map. Correct.
- **Exponential backoff:** `getNextFlushInterval` (lines 37-41), capped at `MAX_FLUSH_INTERVAL_MS = 300000` (5 min). Resets on any success.
- **Re-entrancy guard:** `isFlushing` flag + `viewCountFlushTimer` nulled on entry (line 75) — the COR-R4C11-01 stale-timer fix is live.
- **SIGTERM flush wired:** `instrumentation.ts:18-22` races `flushBufferedSharedGroupViewCounts()` + queue drain against a 15s timeout, then `process.exit(0)`. Documented "flushed on graceful SIGTERM" claim is TRUE.

### 6. React `cache()` dedup (`data.ts`)
- All 10 hot data-access exports wrapped in `cache()` (lines 1608-1621): `getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`, plus `getSeoSettings`.
- `getImage()` uses `Promise.all` for tags + prev + next (line 1048) — 3 parallel queries, not serial.

### 7. Listing queries — no N+1 (`data.ts`)
- All listings bounded by `LISTING_QUERY_LIMIT = 100` (line 611).
- Tag aggregation uses shared `tagNamesAgg` (`GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`) — single query, no N+1. Locked by `__tests__/data-tag-names-sql.test.ts`.
- Map query bounded by `MAP_MAX_MARKERS = 10000` (line 1567) with index on `(map_visible, latitude, longitude)`.
- Smart-collection enrichment: `inArray(imageIds)` batch fetch (line 1236), not per-image.
- `searchImages()` short-circuits when main query fills limit (no over-fetch).

### 8. Service Worker LRU (`sw-cache.ts` + `public/sw.template.js`)
- 50 MB cap (`MAX_IMAGE_CACHE_BYTES`, line 19).
- **Insertion-order recency** via delete-then-set (lines 111-112) — AGG-H3 fix live, no per-write O(n log n) sort.
- Total is summed O(n) once per call (line 119-122) — inherent to whole-blob JSON storage; documented and accepted.
- HEAD revalidation bounded by `AbortSignal.timeout(300ms)` (per CLAUDE.md + template contract test).
- HTML offline cache: 24h TTL, 50-entry cap, OFFLINE-ONLY.

### 9. CLIP inference (`clip-model.ts`, `clip-inference.ts`, `clip-embeddings.ts`)
- **Lazy singleton:** native runtime imported inside `getModelBundle()` (line 83), NOT at module top level — boot graph clean (AGG-C10-03).
- **Failure retry:** cached `loadPromise` nulled on catch (lines 101-105) — next call retries. No permanent-broken-promise wedging.
- **Embedding dimension invariant:** `embeddingToBuffer` throws on length mismatch (line 63); `decodeEmbeddingColumn` returns null unless exactly `EMBEDDING_BYTES` (line 108-124). Three-case decoder (raw / legacy-base64 / string) is byte-correct — `Buffer.from(value.toString('latin1'), 'base64')` preserves every byte (latin1 is identity for 0x00-0xFF).
- **Semantic scan hard-capped:** `SEMANTIC_SCAN_LIMIT = 5000` with `ORDER BY updatedAt DESC LIMIT 5000` (semantic route line 255-256, similar route line 146-147). Backed by `idx_image_embeddings_model_version_updated` — no filesort.
- **topK bounded:** O(n log n) on ≤5000 scored elements, slice to `SEMANTIC_TOP_K_MAX = 50`. Enrichment via single `inArray` + `leftJoin(topics)`.

### 10. Analytics writes (`actions/public.ts:320-410`)
- **Per-IP rate-limited:** `VIEW_RECORD_MAX_REQUESTS = 120/min`, `VIEW_RECORD_RATE_LIMIT_MAX_KEYS = 2000` (bounded map). Prevents view-table flooding.
- **Fire-and-forget:** every `db.insert(...)` has `.catch(console.debug)` — analytics never blocks render.
- **Retention:** hourly `purgeOldViewEvents()` (image-queue.ts:702, 718) deletes rows older than `VIEW_RETENTION_DAYS` (default 395) — bounded table growth on the single writer.

### 11. React render perf (`image-zoom.tsx`, `photo-viewer.tsx`)
- `ImageZoom` uses `useRef` + direct DOM transform manipulation in `requestAnimationFrame`-free `applyTransform` — no per-mousemove React re-render.
- All event listeners (`wheel`, `mousemove`, `touchmove`, `keydown`) properly removed in `useEffect` cleanup returns — no listener leak across mount/unmount cycles.
- Masonry grid is pure CSS multi-column (no JS reorder pass, no per-resize `useMemo`).

---

## Tests Run (evidence)
- `vitest run src/__tests__/sw-cache.test.ts src/__tests__/data-tag-names-sql.test.ts src/__tests__/bounded-map.test.ts` → **41 passed / 0 failed** (607ms).

---

## Commonly-missed issues — explicitly checked, none found

| Check | Result |
|---|---|
| Unbounded Map / Set growth | None — all rate-limit + buffer + retry Maps use `BoundedMap` or explicit FIFO cap |
| N+1 query in listings / enrichment | None — `tagNamesAgg`, batched `inArray`, `Promise.all` prev/next/tags |
| Blocking sync I/O in hot paths | None — `readFileSync`/`existsSync` absent from `lib/` and `api/` |
| Unbounded `for await` / `while(true)` | None — `for await` in `process-image.ts:521` is a bounded directory scan with `dirHandle.close()` in `finally` |
| Lock leak on throw | None — every `GET_LOCK` paired with `RELEASE_LOCK` in `finally`; connection released even if release throws |
| Unhandled-rejection from floating promises | None — caption/embedding/view-record all have `.catch()` |
| Memory leak via stale timer | None — `viewCountFlushTimer` nulled on entry (COR-R4C11-01); `gcInterval` guarded by `!state.gcInterval` (AGG-M12) |
| Pool exhaustion under backfill | None — `resolveBackfillConcurrency` caps workers against pool budget with non-finite guard |
| React re-render storm on mousemove/touchmove | None — `ImageZoom` uses ref-based DOM mutation, not state |
| Event listener leak | None — every `addEventListener` paired with `removeEventListener` in cleanup |

---

## Issues Found

**None.**

---

## Recommendation

**APPROVE.** The codebase is converged on the performance and concurrency axis at HEAD `17f743f7`. No scheduling, no new findings to record.
