# Performance Review — Cycle 20
**Date:** 2026-06-27
**HEAD:** (post-cycle-19 fixes)
**Findings:** 3 new (all LOW); 0 regressions; CQ19-01 verified; PERF-C19-01..05 re-confirmed deferred

---

## CQ19-01 Verification — CONFIRMED IMPLEMENTED

`lib/og-photo-fetch.ts` lines 34 and 47:

```ts
const OG_PHOTO_FETCH_TIMEOUT_MS = 10000;   // line 34 — per-attempt abort
const OG_PHOTO_TOTAL_BUDGET_MS = 10000;    // line 47 — overall chain deadline
```

`pickFirstAvailablePhotoBuffer` (line 95) sets `deadline = Date.now() + OG_PHOTO_TOTAL_BUDGET_MS` before the loop and checks `if (Date.now() >= deadline) break;` (line 106) before each attempt. The 10 s total budget cap is in place and correct. The worst-case OG latency on a hung/cold/broken path is now bounded to approximately one per-attempt timeout (10 s), not 6 × 10 s = 60 s as before.

---

## PERF-C19-01..05 Re-evaluation — All Still Correctly Deferred

| ID | Item | Status |
|----|------|--------|
| PERF-C19-01 | `getImagesForSmartCollection` COUNT(*) OVER() per cursor page | Deferred (scale-gated: negligible < 2k rows/collection; exit criterion not met) |
| PERF-C19-02 | Bootstrap `NOT IN (≤1000 failed IDs)` per 30 s | Deferred (bounded list, indexed PK scan; no measured impact) |
| PERF-C19-03 | Serial smart-collection UPDATEs in held advisory lock | Deferred (admin-only, infrequent, non-blocking user path) |
| PERF-C19-04 | Histogram 768-elem temp array per redraw (`[...r,...g,...b]`) | Deferred (single canvas worker; micro-cost; no user impact) |
| PERF-C19-05 | `useDisplayCapability` 5 listeners × N consumers | Deferred (bounded, idempotent; listener count is tiny) |

No exit criteria have been triggered for any of the five.

---

## New Findings

### PERF-C20-01 — OG per-attempt timeout equals total budget (LOW)

**File:** `apps/web/src/lib/og-photo-fetch.ts:34,47`

`OG_PHOTO_FETCH_TIMEOUT_MS` and `OG_PHOTO_TOTAL_BUDGET_MS` are both `10000`. In the `pickFirstAvailablePhotoBuffer` loop, the deadline check runs BEFORE each attempt. When the first attempt hangs to its `AbortSignal.timeout` (10 s), the deadline expires at the same moment and subsequent sizes are never tried.

Consequence: the ascending multi-size fallback chain only provides meaningful retry for fast-404 responses (missing derivatives during the backfill window). For a hung connection (broken `IMAGE_BASE_URL`, CDN timeout), the chain degenerates to a single 10 s attempt then falls back to the site-default OG card. This is not a bug — the 10 s cap correctly prevents the prior 60 s worst-case — but the fallback chain's multi-size resilience is only exercised for fast-failure scenarios, not hung ones.

**Fix if desired:** reduce `OG_PHOTO_FETCH_TIMEOUT_MS` to 3 000–4 000 ms. With a 10 s total budget and 3 s per-attempt, up to 3 sizes can be attempted within the budget on a hung path. The warm path (first size resolves in < 1 s) is unaffected.

**Severity:** LOW — broken IMAGE_BASE_URL is an operator misconfiguration, not steady-state; the existing cap already prevents the 60 s regression CQ19-01 targeted.

---

### PERF-C20-02 — `getTopics()` emits N correlated subqueries per call (LOW)

**File:** `apps/web/src/lib/data.ts:511–517`

`getTopics()` selects `last_image_updated_at` via a correlated subquery per topic row:

```sql
SELECT MAX(updated_at) FROM images WHERE topic = ? AND processed = true
```

With N topics this issues N indexed range scans per call. The code comment (lines 498–503) already acknowledges the cost and notes it is "cheap at gallery scale" because the sitemap consumer carries `revalidate = 3600`. At < 50 topics with the `idx_images_topic` composite index the cost is negligible. The `getTopicsCached()` React `cache()` wrapper deduplicates within a single SSR render tree, but admin pages that call the function directly re-issue the N subqueries on each request.

**Fix if needed:** replace the correlated subquery with a single aggregation: `LEFT JOIN (SELECT topic, MAX(updated_at) AS last FROM images WHERE processed = true GROUP BY topic) AS img_last ON topics.slug = img_last.topic`. One DB round-trip instead of N.

**Severity:** LOW — acknowledged in code, mitigated at current scale; escalate if topic count exceeds ~50 or admin-page latency is profiled as a bottleneck.

---

### PERF-C20-03 — Semantic search vector scan synchronous on main V8 event loop (LOW)

**File:** `apps/web/src/app/api/search/semantic/route.ts:~264–284`

After fetching up to `SEMANTIC_SCAN_LIMIT` (default 2 000) embedding rows from MySQL, the similarity scoring loop runs synchronously on the Next.js request handler thread. `decodeEmbeddingColumn` deserializes a 2 048-byte MEDIUMBLOB (512 × float32) per row; the dot product runs 512 multiply-add operations. Total: 2 000 × 512 ≈ 1 M float operations per query, holding the event loop for roughly 5–20 ms under JIT.

Hard mitigations already in place:
- Rate limit: 30 requests / min / IP (`preIncrementSemanticRateLimit`)
- Hard scan cap: `SEMANTIC_SCAN_LIMIT = 2 000` (env-configurable, not user-controllable)
- Top-K cap: `SEMANTIC_TOP_K_MAX = 50`

At current gallery scale (445 real embeddings in production) the effective cost is 445 × 512 ≈ 228 K ops per query — well within V8's float throughput. The concern only materialises if the embedding count approaches `SEMANTIC_SCAN_LIMIT`.

**Fix if scale demands it:** offload the scoring loop to a Node.js `worker_threads` Worker, or adopt a vector index (pgvector, Qdrant). Neither is warranted at current corpus size.

**Severity:** LOW — rate-limited, hard-capped, within JIT-optimized V8 throughput at current corpus.

---

## Items Investigated and Confirmed Not New

- **`getImagesLitePage` COUNT(*) OVER()** (`data.ts:882`): This is the "already-deferred COUNT(*) OVER() listing-count item" referenced explicitly in PERF-C19-01's defer note. Tracked and deferred before cycle 19. Admin dashboard offset-pagination only; scale-gated.
- **`BoundedMap.enforceHardCap()` eviction loop** (`bounded-map.ts:92–103`): `excess = this.map.size - this.maxKeys` is 1 in the normal case, so the loop breaks after collecting one key (the oldest insertion-order entry). O(1) amortized. Not an O(N) concern.
- **`getGalleryConfig()` on semantic route**: Wrapped in `React.cache()` (`lib/gallery-config.ts:217`). Deduped within the request tree. No performance concern.
- **Sharp concurrency / per-format-fresh instances**: `sharp.concurrency = Math.max(1, floor((cpuCount-1) / 3))` correctly accounts for AVIF + WebP + JPEG parallel fan-out. `sharp.cache(false)` prevents libvips operation-cache RSS growth. Correct and well-tuned.
- **Bootstrap NOT IN spread** (`image-queue.ts:717`): PERF-C19-02, already deferred. No change in exit criteria.

---

## Overall Assessment

After 20 cycles the performance surface is mature and well-covered. All three new findings are LOW severity and operationally bounded. The major performance investments from prior cycles are correctly in place: bounded-map rate limiting, OG total budget cap (CQ19-01), react-cache() SSR deduplication, cursor-based gallery pagination (no COUNT(*) on public listings), Sharp concurrency formula, per-format-fresh decode instances (WI-14), histogram worker offload, rAF-debounced masonry resize, semantic scan hard cap and rate limit, and minimal OG accessor (`getLatestImageForOgCached`). No regressions from cycle-19 fixes observed.
