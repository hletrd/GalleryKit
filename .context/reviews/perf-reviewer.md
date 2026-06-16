# PERF-REVIEWER — Deep Performance / Concurrency Review (GalleryKit)

**Date:** 2026-06-16
**Scope:** Full perf/concurrency sweep with priority fresh-scrutiny on the new CLIP semantic-search surface (US-P51).
**Method:** Code-validated. Read every CLIP file end-to-end (`clip-model.ts`, `clip-embeddings.ts`, `clip-inference.ts`, `clip-model-id.ts`, both `/api/search/*` routes, `image-queue.ts` embedding hook, `backfill-clip-embeddings.ts`, `similar-photos.tsx`, `search.tsx`), plus the dependency tree (`@huggingface/transformers@3.8.1` → `onnxruntime-node@1.21.0`), the `image_embeddings` schema + migration 0012, the DB pool config, `gallery-config.ts`, and the semantic rate-limit helpers.

## HARD GUARD respected
CLIP ships **DARK**: `semantic_search_mode` default `'disabled'` (`gallery-config-shared.ts:108`); a non-`stub`/`production` value yields 503 on both routes. The embedding hook in `image-queue.ts:441` is a no-op when disabled. **Nothing was activated.** Every "production-mode" finding below is a REAL-BUT-DEFERRED risk that only materializes when an operator sets the mode to `production` (or `stub`). Each is labeled accordingly.

## Verdict
The non-CLIP surface is clean — `image-queue.ts` concurrency is mature (advisory-lock claim, conditional UPDATE, bounded retry maps with FIFO eviction, keyset bootstrap pagination, `unref()` on all timers). Consistent with the prior-cycle convergence to 0.

**The CLIP surface, when enabled in `production` mode, has one CRITICAL event-loop-blocking defect and a cluster of HIGH/MED scaling cliffs.** All are deferred by the dark flag, but the CRITICAL one is severe enough that the feature must not be flipped to `production` on the shipped single-instance topology without the fix.

---

## CRITICAL

### C1 — `production` semantic inference BLOCKS the Node event loop (synchronous native ORT run) [Confidence: High]
**Files:** `src/lib/clip-model.ts:96-99` (`embedTextReal`), `:157-159` (`embedImageReal`); consumed at `src/app/api/search/semantic/route.ts:241` and `src/lib/image-queue.ts:446`.

**Mechanism (validated through the dependency tree):**
- `@huggingface/transformers@3.8.1` (package-lock.json:534) loads `onnxruntime-node@1.21.0` on the server (`backends/onnx.js:23,64` — Node path selects `ONNX_NODE`, `device: 'cpu'`).
- `onnxruntime-node/dist/backend.js:44-56`: `async run()` wraps the native call in `setImmediate(() => resolve(inferenceSession.run(...)))`. `setImmediate` only defers the *start* one macrotask. The wrapped native `inferenceSession.run(...)` is **synchronous** — `binding.d.ts:9-22` declares `run(...): ReturnType` (a plain object, NOT a Promise) and the file header states *"Binding exports a simple synchronized inference session object wrap."*
- Therefore the C++/ORT inference runs **on the main V8 thread** and is NOT offloaded to the libuv threadpool. For the inference duration, the Node process answers **zero** other requests — no static derivative serves, no other gallery render, no health probe.

**Degradation scenario / magnitude:** jina-clip-v2 (q8) is a large multilingual CLIP encoder. A single CPU text-tower forward on a typical 2-4 vCPU deploy host is ~300 ms-2 s; the **image** tower (512×512, used by the queue hook and the backfill) is materially heavier (~1-5 s). At the 30 req/min/IP rate limit, one client can serialize ~30 text inferences/min → up to **tens of seconds of cumulative full-process stall per minute**. With `TRUST_PROXY` unset, `getClientIp` returns `'unknown'` for everyone (semantic route docstring lines 198-206), collapsing **all visitors into one shared 30/min bucket** — so 30 inferences/min is a *global* ceiling and every one of them freezes the whole site. Concurrent uploads make it worse: the queue's fire-and-forget `embedImageReal` (`image-queue.ts:446`) injects 1-5 s image-tower stalls onto the same event loop while users browse.

**Fix:** Run inference off the main thread. Options, in order of preference:
1. Move CLIP inference into a `worker_threads` pool (or a dedicated sidecar process) and pass tensors via message/`SharedArrayBuffer`; the route `await`s the worker. This is the only option that truly frees the event loop.
2. If staying in-process, gate `production` mode behind an explicit "single-tenant, low-traffic, accept stalls" operator acknowledgement AND drop the rate limit far below 30/min, because each request is an event-loop monopolizer, not a cheap DB hit.
3. At minimum, never let the queue hook (`image-queue.ts:446`) and an HTTP request run inference concurrently — serialize image-tower work behind the existing `PQueue` (concurrency 1) rather than firing it with `void (async …)` that escapes the queue's concurrency control.

**Deferred:** Only reachable when `semantic_search_mode='production'`. Dark today.

---

## HIGH

### H1 — O(n) brute-force cosine scan with NO vector index; full-scan + filesort on every query [Confidence: High]
**Files:** `src/app/api/search/semantic/route.ts:251-278`, `src/app/api/search/similar/[id]/route.ts:142-168`; schema `drizzle/0012_image_embeddings.sql`.

**Mechanism:**
- Every query runs `SELECT image_id, embedding FROM image_embeddings WHERE model_version = ? ORDER BY updated_at DESC LIMIT 5000`, then decodes + cosines **every returned row in JS**. There is **no ANN/vector index** (MySQL 8 has none natively) — that is inherent and acceptable for a small gallery, but two avoidable index gaps make it worse than O(n) needs to be:
  - **No index on `model_version`** → the `WHERE model_version = ?` is a full-table scan of `image_embeddings`.
  - **No index on `updated_at`** → `ORDER BY updated_at DESC` is a **filesort** over the entire matched set, and because the row carries the 2 KB `embedding` MEDIUMBLOB inline, MySQL reads up to `rows × 2 KB` off disk just to sort and slice.
- The JS scan then base64-decodes each row (see H2) and runs `cosineSimilarity` (see M3) over up to 5000 × 512 floats.

**Degradation scenario / magnitude:** At 5,000 embeddings the per-request cost is ~10 MB of BLOB read + filesort + 5,000 base64 decodes + ~2.6M float reads + ~7.7M MAC ops, all on the request path (and, per C1, on the blocked main thread for the inference portion). Latency climbs linearly; beyond the `SEMANTIC_SCAN_LIMIT` 5,000 cap, results also become **silently incomplete** — the newest 5,000 win, older photos are unreachable by semantic/similar search with no operator signal.

**Fix:** Add `KEY (model_version, updated_at)` to `image_embeddings` (covers both the filter and the sort, eliminating the filesort). Longer term, if the gallery is expected to exceed ~10-20k photos, move vectors to a store with real ANN (sqlite-vss / pgvector / a dedicated index) — but for personal-gallery scale the composite index + the H2/M3 fixes are sufficient. Also surface the 5,000-row truncation (log or admin warning) so operators know when recall degrades.

**Deferred:** Reachable in `stub` (text-search) and `production` modes; dark today.

### H2 — Embeddings stored as **base64 text** in a binary MEDIUMBLOB column → 33% bloat + per-row decode tax [Confidence: High]
**Files:** write path `image-queue.ts:452-453` & `backfill-clip-embeddings.ts:159-160` (`buf.toString('base64')`); read path `semantic/route.ts:267` & `similar/[id]/route.ts:157` (`Buffer.from(row.embedding, 'base64')`); schema `schema.ts:264-275` (Drizzle `text("embedding")` over a `mediumblob` column, migration 0012).

**Mechanism:** A 512-dim float32 vector is exactly 2,048 raw bytes. The code serializes it to **base64** (`embeddingToBuffer` → `.toString('base64')`), producing ~2,732 bytes of text, and stores that text in a `MEDIUMBLOB`. So every row is ~33% larger than necessary, and every read pays a base64-decode before the `readFloatLE` loop. The Drizzle schema models the column as `text` and the lib "wraps Buffer reads/writes" — but it wraps them as base64, not as raw binary, defeating the point of the binary column.

**Degradation scenario / magnitude:** At 5,000 rows: ~13.7 MB stored instead of ~10 MB, and 5,000 base64 decodes per query (each allocating a fresh Buffer) added to the H1 scan. Memory churn (transient Buffers + Float32Arrays) pressures GC on the request path.

**Fix:** Store the raw 2,048-byte buffer directly in the MEDIUMBLOB (mysql2 returns `Buffer` for blob columns). Drop the `.toString('base64')` / `Buffer.from(..., 'base64')` round-trips; read `row.embedding` as a `Buffer` and pass straight to `bufferToEmbedding`. Even better, wrap with `Float32Array(buf.buffer, buf.byteOffset, 512)` to avoid the per-element `readFloatLE` copy entirely (see M3). Update the Drizzle column type to `customType`/binary so the type matches reality.

**Deferred:** Storage/perf only; correctness is fine today. Reachable in stub + production.

---

## MEDIUM

### M1 — `getGalleryConfig()` does a fresh `admin_settings` SELECT on EVERY semantic/similar request (React `cache()` does not dedupe across Route Handler requests) [Confidence: High]
**Files:** `src/lib/gallery-config.ts:211` (`export const getGalleryConfig = cache(_getGalleryConfig)`), `:35-39` (`getSettingsMap` reads the full gallery-settings key set); called at `semantic/route.ts:222`, `similar/[id]/route.ts:97`, and `image-queue.ts:436`.

**Mechanism:** `cache()` from `react` memoizes only **within a single SSR render pass**. App Router **Route Handlers** (`route.ts`) are not React renders — each HTTP request gets a fresh cache scope. So `getGalleryConfig()` issues a real `SELECT key, value FROM admin_settings WHERE key IN (...)` on **every** semantic-search request, every similar-photos request, and every embedding-hook invocation, purely to read one enum (`semantic_search_mode`). That is an extra DB round-trip (and a pool connection checkout) per request on top of the embeddings scan.

**Degradation scenario / magnitude:** Adds one settings query + connection-pool checkout to every search request. Under the C1 stall + H1 scan this is minor, but it compounds connection-pool pressure (pool is 10, queueLimit 20) when search traffic coincides with gallery renders (each of which also fans out multiple queries).

**Fix:** Add a short-TTL process-memoized read for `semantic_search_mode` (e.g. cache the resolved mode for 5-30 s in a module-scope variable with a timestamp), or read just that one key via a tiny dedicated cached helper rather than the whole settings map. Acceptable because the mode changes rarely (admin toggle) and a few seconds of staleness on enabling search is harmless.

### M2 — Queue embedding hook escapes `PQueue` concurrency control via `void (async …)` [Confidence: Medium]
**File:** `src/lib/image-queue.ts:433-470`.

**Mechanism:** The embedding hook is fired as `void (async () => { … await embedImageReal(originalPath) … })()` **inside** the queue task but **not awaited**, so it runs detached from the `PQueue` (concurrency 1). In `production` mode this means image-tower inference (1-5 s, event-loop-blocking per C1) runs **concurrently with the next queue job's Sharp encode** and with live request traffic — the very serialization the queue exists to provide is bypassed for the heaviest CPU op in the pipeline. The same applies to the caption hook (`:394`), but that is a cheap stub today.

**Degradation scenario / magnitude:** During a bulk upload with `production` enabled, every processed image spawns a detached 1-5 s blocking inference; with photos completing back-to-back, multiple detached inferences plus the active Sharp pipeline contend for the same event loop and the libvips worker threads, degrading both upload throughput and site responsiveness.

**Fix:** Either enqueue the embedding as its own `PQueue` task (so it serializes with encodes), or — once C1 is fixed by a worker pool — route it through that pool. Do not leave heavy inference detached from any concurrency limiter.

**Deferred:** Only heavy in `production`; in `stub` the hook is a sync SHA-256 (negligible).

### M3 — `cosineSimilarity` recomputes both norms though all vectors are already unit-length [Confidence: High]
**File:** `src/lib/clip-embeddings.ts:20-35`; called per scanned row in both routes.

**Mechanism:** Both stored image embeddings and the query embedding pass through `truncateAndNormalize` → `normalizeEmbedding` (`:106-120`), so `‖a‖ = ‖b‖ = 1`. Yet `cosineSimilarity` computes `dot`, `normA`, AND `normB` every call — 3 multiply-accumulates per dimension where 1 would do, plus 2 `Math.sqrt`. Over the H1 scan (≤5,000 × 512) that is ~7.7M MACs where ~2.6M suffice.

**Fix:** Add a `dotProduct(a, b)` for the unit-vector path and use it in the scan (the vectors are guaranteed normalized at write + at query time). Keep `cosineSimilarity` for any non-normalized caller. Combined with H2's zero-copy `Float32Array` view, the per-row inner loop becomes a tight dot product over a typed-array view with no allocation.

---

## LOW

### L1 — Stale inline doc: `PRODUCTION_COSINE_THRESHOLD (0.25)` but the constant is `0.22` [Confidence: High]
**Files:** `semantic/route.ts:25` (docstring says "0.25") and `:236` uses the constant; actual value `clip-embeddings.ts:103` = `0.22`. `similar/[id]/route.ts` docstring also references the threshold. Cosmetic — the code reads the constant, so behavior is correct; only the comment misleads a future tuner. Fix the comment to `0.22` (or stop hardcoding the number in prose).

### L2 — `download-clip-models.ts` integrity check is fine but operator-only; no perf risk [Confidence: High]
**File:** `scripts/download-clip-models.ts:114`. Iterates a MANIFEST sequentially with SHA-256 verification. One-shot operator script, off the request path; memory is bounded by per-file streaming. No action needed — noted for completeness so it is not flagged elsewhere.

### L3 — `backfill-clip-embeddings.ts` `BATCH_CONCURRENCY=2` is uncapped but runs as a sidecar [Confidence: High]
**File:** `scripts/backfill-clip-embeddings.ts:71,148-181`. In `--production` it runs `embedImageReal` (event-loop-blocking) at concurrency 2 in its OWN `--rm` container with its OWN MySQL pool, so it does not starve the live web pool (consistent with CLAUDE.md's distinction between the uncapped sidecar `BACKFILL_CONCURRENCY` and the capped in-app `ADMIN_BACKFILL_CONCURRENCY`). Keyset pagination (`:109,139`) is correct and avoids the OFFSET-skip bug. Memory per batch is bounded (50 rows × 2 KB). The only caveat: concurrency 2 of blocking image inference will peg ~2 cores for the whole backfill — fine for a sidecar, but document that it should not run on the same host as the live container during peak traffic. No code change required.

### L4 — Client search/similar fetch patterns are sound [Confidence: High]
**Files:** `search.tsx`, `similar-photos.tsx`. `search.tsx` debounces 300 ms (`:225-227`), guards stale responses with a `requestIdRef` re-checked after BOTH awaits (`:159,175`), and clears refs per result set. `similar-photos.tsx` fetches lazily on first expand only (`fetchedRef`, `:53,59`) and hides on any non-200. No re-render storm, no layout thrash, no unbounded client state. No action needed.

---

## Non-CLIP surface — spot verification (prior cycles converged to 0)
`image-queue.ts` reviewed in full: advisory-lock claim per job (`:194-211`), conditional `WHERE processed=false` UPDATE with `affectedRows` check + variant cleanup on delete-race (`:369-390`), bounded retry/claim/error Maps with FIFO eviction (`:97-110`, `MAX_RETRY_MAP_SIZE`), keyset bootstrap pagination with `permanentlyFailedIds` exclusion (`:614-644`), all timers `unref()`'d, restore quiesce with the documented `clear()`-before-`onIdle()` deadlock fix (`:709-735`). No new perf/concurrency defects on this surface.

---

## Compact list for the aggregator

- **[CRITICAL][High] C1** — `production` CLIP inference blocks the Node event loop: `onnxruntime-node` `run()` is a synchronous native call wrapped in `setImmediate` (NOT threadpool-offloaded); every text/image embed freezes the whole single process for 0.3-5 s. `clip-model.ts:96,157` → `semantic/route.ts:241`, `image-queue.ts:446`. **Deferred (dark flag).** Fix: worker_threads/sidecar inference pool.
- **[HIGH][High] H1** — O(n) brute-force cosine with no `model_version`/`updated_at` index → full-table scan + filesort reading the 2 KB BLOB per row, plus silent 5,000-row truncation. `semantic/route.ts:251`, `similar/[id]/route.ts:142`, migration 0012. **Deferred.** Fix: `KEY (model_version, updated_at)`; surface truncation.
- **[HIGH][High] H2** — Embeddings stored base64-in-MEDIUMBLOB → 33% bloat + per-row base64 decode on every scanned row. `image-queue.ts:452`, `backfill:159`, reads at `semantic/route.ts:267`, `similar:157`. **Deferred.** Fix: store raw bytes; zero-copy `Float32Array` view.
- **[MED][High] M1** — `getGalleryConfig()` re-queries `admin_settings` on every search/similar request (React `cache()` doesn't dedupe across Route Handler requests). `gallery-config.ts:211`. Fix: short-TTL process memo for `semantic_search_mode`.
- **[MED][Medium] M2** — Queue embedding hook fired via detached `void (async…)`, escaping `PQueue` concurrency; in production runs blocking image inference concurrently with the next encode. `image-queue.ts:433`. **Deferred (heavy only in production).** Fix: enqueue or route through worker pool.
- **[MED][High] M3** — `cosineSimilarity` recomputes both norms though vectors are pre-normalized; ~3× wasted MACs over the scan. `clip-embeddings.ts:20`. Fix: dot-product fast path.
- **[LOW][High] L1** — Stale doc "0.25" vs actual `PRODUCTION_COSINE_THRESHOLD=0.22`. `semantic/route.ts:25`, `clip-embeddings.ts:103`. Comment-only.
- **[LOW][High] L2/L3/L4** — Downloader, sidecar backfill (concurrency 2, own pool, keyset pagination), and client fetch/debounce patterns all sound; no action.
- **Non-CLIP surface:** clean — `image-queue.ts` concurrency mature; converged-to-0 status holds.
