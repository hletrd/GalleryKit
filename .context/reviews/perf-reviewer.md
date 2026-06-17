# Performance & Concurrency Review — GalleryKit

**HEAD:** `1a325fa6` (branch master) · **Agent:** perf-reviewer · **Date:** 2026-06-17
**Run/Cycle:** Run 6 / Cycle 8 (review-plan-fix loop)
**Prior perf baseline:** `a7758ef0` (cycle-7 perf, honest 0-findings convergence)
**Scope this cycle:** FRESH HARD scrutiny of the now-LIVE CLIP semantic-search path (the only shipping delta since cycle-7), plus a full-repo re-sweep for N+1, missing indexes, unbounded scans, blocking request-path I/O, missing memoization, Sharp pipeline cost, and pagination caps.

---

## Verdict

**2 findings — 0 CRIT / 0 HIGH / 1 MEDIUM / 1 LOW.** Both are in the freshly-activated CLIP scan path and were **invisible to every prior cycle** because the routes were dark (503) until these three commits flipped them live. Neither is catastrophic at the current ~445-row embedding count, but both are real, cheap to fix, and the MEDIUM one degrades monotonically as the gallery grows.

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | PERF-C8-01 |
| LOW | 1 | PERF-C8-02 |

The catastrophic scenarios the brief asked me to rule out are **ruled out** (see "CLIP hot-path: what is CORRECT" below): the ONNX model is a true cross-request singleton (not per-request), ONNX `session.run` is async-offloaded (does not block the event loop), the scan is hard-capped at 5000, and result enrichment is a single bounded `inArray` round-trip. The two findings are the residual efficiency gaps, not correctness or memory hazards.

---

## Mechanical delta verification (HEAD-verified, not trusted)

**Shipping delta `a7758ef0..1a325fa6`** = exactly the three briefed activation commits:
- `e0da12ee` / `1a325fa6` — `lib/clip-model.ts` (+22): dropped `import 'server-only'`, switched `CLIP_MODELS_ROOT` to the shared `resolveClipModelsRoot()`; new `lib/clip-paths.ts` (+80); `scripts/download-clip-models.ts` (+30) path math.
- `b1d6331c` — test-only (clip-paths / offline-load / boundary tests). Non-shipping.

**The activation commits themselves changed ZERO lines of the per-request scan or scoring code.** They are path-resolution + module-boundary plumbing. So the two findings below are **pre-existing latent gaps in `semantic/route.ts` + `similar/[id]/route.ts` that BECAME live the moment `semantic_search_mode='production'` is reachable** — exactly the class of "dark code that just turned on" the brief flagged for hard scrutiny. Prior cycles correctly did not report perf on these routes (they 503'd), so these are NOT re-reports.

**`git status` snapshot in the prompt was stale** — the listed dirty files (`admin-backfill-runner.ts`, `page.tsx`, `sw.js`, etc.) are all committed at HEAD; `git diff -- apps/web/**` over the working tree is empty for shipping source. No uncommitted shipping change to review.

---

## PERF-C8-01 — [MEDIUM] No index on `image_embeddings(model_version, updated_at)`; every live semantic/similar query is a full table scan + filesort

**Files:**
- `apps/web/src/app/api/search/semantic/route.ts:250-255`
- `apps/web/src/app/api/search/similar/[id]/route.ts:142-147`
- Schema: `apps/web/src/db/schema.ts:273-283` (table def) + `apps/web/drizzle/0012_image_embeddings.sql:5-12` (only `PRIMARY KEY (image_id)` + FK; **no secondary index**)

**Confidence:** HIGH (that the index is absent and the query shape cannot use one). MEDIUM (on present-day magnitude — small at 445 rows; the severity is forward-looking).

**Issue.** Both now-live public endpoints run the identical scan query:

```sql
SELECT image_id, embedding FROM image_embeddings
WHERE model_version = ?            -- e.g. 'jina-clip-v2-d512-q8'
ORDER BY updated_at DESC
LIMIT 5000;
```

`image_embeddings` has exactly one index: the clustered `PRIMARY KEY (image_id)`. There is no index on `model_version` and none on `updated_at`. MySQL therefore:
1. **Full-scans** the clustered PK (every row, reading the 2048-byte MEDIUMBLOB inline for each since it's `SELECT embedding`), filtering `model_version` with no index assist;
2. **Filesorts** the survivors by `updated_at DESC` (no ordered index to walk) before applying `LIMIT 5000`.

This runs on **every** `/api/search/semantic` (production mode) and **every** `/api/search/similar/[id]` call. Both are public, same-origin, `no-store` (uncacheable), interactive search endpoints — there is no HTTP cache or ISR layer to absorb repeat queries, unlike the Atom-feed filesort the prior cycle classified awareness-only (low-frequency, cacheable).

**Slow/expensive scenario.** At the briefed 445 rows the scan + filesort is sub-millisecond and pulling ~890 KB of inline BLOB is trivial — invisible today. But this is a public photo gallery whose embedding table grows 1:1 with uploaded photos and is unbounded by design (`SEMANTIC_SCAN_LIMIT=5000` only caps the *returned* rows, not the rows *scanned* before the LIMIT — the filesort processes the entire matching set first). At a realistic large personal/pro gallery of 20k–50k photos:
- The filesort must order tens of thousands of rows on a non-indexed timestamp per request;
- The PK scan reads every row's inline 2048-byte BLOB (~40–100 MB of buffer-pool churn per query) just to filter and sort, even though only ≤50 survive top-K;
- Two such requests/sec (one bored visitor clicking "similar photos" through a gallery) sustains a continuous full-table-scan + multi-MB filesort load on the single-writer instance, contending with the upload/serve path for buffer pool and CPU.

A composite **`(model_version, updated_at)`** index converts this into an index range seek that walks rows already ordered by `updated_at` within the `model_version` partition — the `LIMIT`/scan-cap can short-circuit after the first 5000 index entries without a filesort, and `model_version` filtering is index-resolved. (`updated_at`-DESC ordering uses a backward index scan, which MySQL 8 does natively.)

**Fix.** Add a new migration (per the CLAUDE.md runbook — monotonic `when`, mirror in `reconcileLegacySchema`):

```sql
-- drizzle/00NN_image_embeddings_scan_index.sql
ALTER TABLE `image_embeddings`
  ADD INDEX `idx_image_embeddings_model_updated` (`model_version`, `updated_at`);
```

and the matching `index()` in `schema.ts`'s `imageEmbeddings` table builder. Write cost is one extra small secondary index on a table written only at upload/backfill time (not on the request hot path) — negligible against the per-search-request scan it removes. The BLOB stays out of the index (only the two scalar columns are indexed), so index size is tiny.

**Note (not part of this finding, flagged for the correctness reviewer):** `apps/web/src/app/actions/embeddings.ts:92-96` selects images whose embedding is missing via `notExists(... WHERE imageId = images.id)` **without** the `modelVersion` filter that the canonical writers (`backfill-clip-embeddings.ts:125-131`, queue hook) use. That action is currently unwired (no UI), so it's not a live perf issue, but if surfaced it would skip re-embedding stub→production rows. Out of perf scope; noting for cross-agent visibility only.

---

## PERF-C8-02 — [LOW] Live scan uses `cosineSimilarity` (recomputes both L2 norms + 2× sqrt per row) when the codebase already ships a `dotProduct` fast-path for these guaranteed-unit vectors

**Files:**
- `apps/web/src/app/api/search/semantic/route.ts:269` — `cosineSimilarity(queryEmbedding, imgEmbedding)`
- `apps/web/src/app/api/search/similar/[id]/route.ts:158` — `cosineSimilarity(targetEmbedding, imgEmbedding)`
- The unused fast-path: `apps/web/src/lib/clip-embeddings.ts:49-56` (`dotProduct`), with its contract doc at `:41-48` stating it equals cosine for unit vectors and "skips the two per-call norm recomputations + sqrt."

**Confidence:** HIGH. Every vector on both sides is provably unit-length: query vectors come from `embedTextReal`→`truncateAndNormalize` (`clip-model.ts:139`) and `embedTextStub`→`deterministicEmbedding` is fed through normalization; stored vectors are written by `embeddingToBuffer(embedding)` where `embedding` is the `truncateAndNormalize` output (`clip-model.ts:199`, `image-queue.ts:447`, backfill `:155`). The unit-length invariant `dotProduct` requires holds on both operands.

**Issue.** `cosineSimilarity` (`clip-embeddings.ts:24-39`) computes, per row, `dot`, `normA`, `normB` (three multiply-accumulate loops fused into one), then `Math.sqrt(normA) * Math.sqrt(normB)` and a divide. For unit vectors `normA == normB == 1`, so the two sqrts, the divide, and the `normA`/`normB` accumulations are pure waste — `dotProduct` returns the identical score with one MAC loop and no sqrt/divide. The repo authored `dotProduct` *specifically* for this scan (the doc comment names "the brute-force scan where both the query and every stored vector are unit length") but neither live route calls it.

**Expensive scenario.** Per row the waste is 2 extra MAC accumulations over 512 dims (~1024 mul-add) + 2 `Math.sqrt` + 1 divide. Over the full `SEMANTIC_SCAN_LIMIT=5000`-row scan that is ~5.1M redundant float ops + 10k sqrts **per request**, on the main thread (the scoring `.map` at `:265-272` / `:153-161` is synchronous JS, unlike the async ONNX inference). At 445 rows it's ~0.45M ops — sub-millisecond, invisible. At a 20k–50k-photo gallery hitting the 5000 cap it's a measurable main-thread CPU slice per search request that the existing fast-path eliminates for free. It also compounds with PERF-C8-01: the same requests already pay the scan/filesort cost.

**Fix.** Swap both call sites to the existing `dotProduct` and update the import lists:

```ts
// semantic/route.ts:269
const score = dotProduct(queryEmbedding, imgEmbedding);
// similar/[id]/route.ts:158
const score = dotProduct(targetEmbedding, imgEmbedding);
```

(Import `dotProduct` instead of / alongside `cosineSimilarity` from `@/lib/clip-embeddings`.) The `decodeEmbeddingColumn` read path does not re-normalize, so the stored bytes are exactly the unit vector that was written — the invariant is preserved end-to-end. Zero score change for well-formed rows; just less work. If a defensive guard is wanted, assert `|‖v‖−1| < ε` once on the query vector (not per row).

---

## CLIP hot-path: what is CORRECT (catastrophe checklist — all PASS)

The brief asked me to specifically rule out several catastrophic patterns. I verified each at HEAD source:

1. **Model load is a true cross-request singleton, NOT per-request.** `getModelBundle()` (`clip-model.ts:78-108`) caches `loadPromise` at module scope and returns it on every subsequent call; `AutoModel.from_pretrained` runs once per process. The catch handler nulls `loadPromise` only on *failure* so a failed load retries — a successful load stays resident for the process lifetime. A per-request 500 MB+ ONNX reload is **not** happening. Confidence HIGH.

2. **ONNX inference does NOT block the event loop.** `onnxruntime-node`'s `session.run` is exposed as an async N-API method backed by a libuv worker thread; `await model(...)` (`clip-model.ts:123`, `:184`) yields the event loop during compute. The text-query request path (`embedTextReal`) does **no** synchronous heavy loop — only tokenize + async model call + a 512-element `truncateAndNormalize`. The request thread is not pegged during inference. Confidence HIGH (runtime behavior of onnxruntime-node async work; node_modules not present in this checkout to byte-verify, hence not absolute, but this is the documented and long-standing N-API contract).

3. **The synchronous HWC→CHW preprocessing loop (`clip-model.ts:176-182`, ~786K iterations) is OFF the request hot path.** It runs only in `embedImageReal` (image embedding), which is called exclusively from the upload queue hook (`image-queue.ts:447`), the backfill script (`:155`), and the unwired admin action — all background/operator paths already isolated from request serving. The public text-search request path never executes it. Not a finding.

4. **Native runtime is lazily imported.** `@huggingface/transformers` is `await import()`-ed *inside* `getModelBundle()` (`clip-model.ts:83`), not at module top level, and is listed in `next.config.ts:50 serverExternalPackages`. The boot/upload graph does not drag onnxruntime-node into every request; it resolves only on first real encode. Memory footprint stays zero until the feature is actually invoked. Confidence HIGH.

5. **Scan is hard-capped and enrichment is bounded.** `.limit(SEMANTIC_SCAN_LIMIT)` (5000) caps rows returned; `topK` (`clip-embeddings.ts:137-142`) filters+sorts+slices to ≤`SEMANTIC_TOP_K_MAX=50`; the enrichment `inArray(images.id, resultIds)` (`semantic/route.ts:303`, `similar/:199`) is therefore a single round-trip over ≤50 ids with a `(processed)` filter — no N+1, no unbounded enrichment. The `topK` sort is O(n log n) over n≤5000 — trivial, not a finding.

6. **Memory: no leak across requests.** The only resident state is the singleton model bundle (intentional). No per-request buffer is retained; the `Float32Array` scratch in `embedImageReal` (`pv`, `clip-model.ts:175`) is request-local and GC'd. The scored array and decoded embeddings are request-local. No growth.

7. **Backfill concurrency + memory bounded.** `backfill-clip-embeddings.ts`: `BATCH_CONCURRENCY=2` (`:71`) via chunked `Promise.all` (`:148-150`), keyset pagination (`cursor`, `:109/:139` — the COR-R4C19-04 fix, not OFFSET), `BATCH_SIZE=50`, total capped at `SEMANTIC_SCAN_LIMIT`. At most 2 concurrent `embedImageReal` (each one Sharp decode + one ONNX run) in flight — bounded peak memory, no fan-all. The admin action (`embeddings.ts`) mirrors this (`BACKFILL_CONCURRENCY=2`). Correct.

8. **Newly-live search UI is well-behaved.** `search.tsx` debounces the semantic POST (`debounceRef` setTimeout, `:217-229`); `similar-photos.tsx` fetches once-on-first-expand (`fetchedRef`, `:62/:68`) and is fully gated out (`return null`) unless `semanticSearchMode === 'production'` — no dead 503-ing control, no CLS, no per-keystroke fetch flood. Minor: neither uses an `AbortController` to cancel a superseded in-flight request, but the debounce prevents pile-up and this matches the pre-existing keyword-search shape (not a new regression) — below the LOW bar.

---

## Full-repo re-sweep (non-CLIP) — re-derived at HEAD, no regressions

The non-CLIP hot paths are byte-identical to the cycle-7 baseline (`git diff a7758ef0..HEAD` empty for `lib/data.ts`, `lib/process-image.ts`, `lib/image-queue.ts` scan/serve sections, `lib/serve-upload.ts`, `lib/sw-cache.ts`, `lib/bounded-map.ts`, `db/schema.ts` images-table indexes, `components/home-client.tsx`, `histogram.tsx`, `use-display-capability.ts`). I re-confirmed the prior cycle's conclusions hold and did not re-derive them line-by-line here (they are documented in the cycle-7 perf review and unchanged):

- **No N+1** in any listing/detail/feed query — tags aggregate via the shared `tagNamesAgg` GROUP_CONCAT JOIN (one round-trip); full-tag path uses one combined GROUP_CONCAT.
- **images-table query shapes all covered** by composite indexes (`idx_images_processed_capture_date`, `_processed_created_at`, `_topic`, `_uploaded_by`, tag-JOIN indexes, analytics breakdown indexes). The `getImagesForFeed` `updated_at` filesort remains the only uncovered shape — **still awareness-only** (bounded, low-frequency, cacheable Atom feed; an index would add upload-time write cost for no observable gain). NOT re-reported.
- **No sync fs** on any request/render path (repo grep for `*Sync` over `src/app`+`src/lib` excluding tests: zero hits).
- **Sharp pipeline** unchanged: 3-format parallel `Promise.all`, `.clone()` decode reuse, `rgb16` only on wide-gamut branch, `WIDE_GAMUT_MAX_SOURCE_PIXELS` OOM guard, `limitInputPixels`/`sequentialRead`. Correct.
- **Queue** unchanged: `PQueue concurrency 1`, per-job advisory lock + conditional UPDATE. The CLIP embedding hook (`image-queue.ts:434-478`) is correctly **fire-and-forget** (`void (async()=>{})()`) so it never blocks the queue job — and gated `disabled→return` so it's a no-op by default.
- **SW LRU** O(k) head-walk eviction, 50 MB cap — unchanged.
- **All rate-limit maps** are `BoundedMap` with hard caps + periodic O(n≤cap) prune; the semantic/similar routes share the `preIncrementSemanticAttempt` bucket (cap 2000) — bounded. Unchanged.

---

## Hard guards respected
1. Did **not** propose `import 'server-only'` on `@/db` or `clip-model.ts` (the boundary that breaks tsx backfill).
2. Did **not** propose activating or de-activating CLIP/semantic search — both findings are pure efficiency fixes that apply only when an operator has *already* enabled production mode; they change neither the gate nor the dark-by-default posture.
3. Did **not** re-report any cycle 1–7 closed item (React cache(), Promise.all, composite images-table indexes, masonry useMemo, view-count buffer, SW LRU, bounded maps). The `getImagesForFeed` filesort stays awareness-only. The two findings are on routes that were 503-dark in every prior cycle and are now live.

## Recommendation
Both findings are cheap, additive, and risk-free (one new index migration; one symbol swap to an existing tested helper). Worth fixing now while the table is small — PERF-C8-01 specifically prevents a future full-table-scan-per-search cliff as the gallery grows, and is far cheaper to land before the table is large. Neither blocks; both are real and HEAD-verified.
