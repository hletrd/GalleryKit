# Debugger Review — Latent-Bug & Failure-Mode Hunt

**Date:** 2026-06-16
**Scope:** CLIP semantic-search surface (fresh-scrutiny target, added this session) + broad latent-bug sweep (async/floating-promise, error-swallowing, null/undefined, off-by-one, resource leaks, crash-vs-degrade).
**Method:** Read every priority CLIP file end-to-end; validated math (zero-vector, float mapping, chunk loop) by execution; verified schema/migration, config resolution, thread-safety of the ONNX session, and the queue race-protection invariants. Confirmed `@huggingface/transformers` is declared (`^3.8.1`) but NOT installed in `node_modules` and `semantic_search_mode` defaults to `disabled` — CLIP is dark, as intended. I did NOT activate it.

**Headline:** The CLIP surface is well-engineered. **Zero confirmed crash/correctness bugs.** The much-feared failure modes (rejected-init-promise cached forever, zero-vector NaN, concurrent-session corruption, embedding-hook breaking the queue race protections) are all handled correctly. Findings below are doc-drift (trivial) and genuine but dark-gated operational latent risks.

---

## CONFIRMED BUGS

**None.** No reproducible crash, data-corruption, or logic defect found on the CLIP surface or in the recently-touched non-CLIP files (`admin-backfill-runner.ts`, `error.tsx`, `page.tsx`, `sw.js`).

---

## Race-protection invariants — VERIFIED INTACT

The task flagged that the US-P51 embedding hook must not break the queue's race protections. Traced `image-queue.ts` line by line:

- The embedding hook (`void (async () => {...})()`, lines 433-470) fires **after** `processed=true` is committed (lines 369-371) and **after** the delete-during-processing cleanup branch (lines 373-390). An embedding failure (line 467-468 `catch`) only `console.warn`s — it never throws into the queue task, never marks the image unprocessed, never blocks the `PQueue`, never leaves orphaned files.
- The per-image advisory lock (`gallerykit:image-processing:{jobId}`) is released in the queue task's `finally` (line 537) — the detached embedding IIFE runs **outside** that lock window but only touches the `image_embeddings` table (its own PK = image_id), never the derivative files or the `processed` flag, so there is no double-encode / interleaved-write hazard.
- The conditional `UPDATE … WHERE processed = false` and orphaned-file cleanup are untouched by the hook. ✔

This is the correct design. The hook is genuinely fire-and-forget and cannot wedge the pipeline.

---

## Lazy-singleton model loader — VERIFIED CORRECT

`clip-model.ts` `getModelBundle()` (lines 54-81):

- **Concurrent first-call de-dup:** `loadPromise` is assigned **synchronously** (line 57) before the first `await`, so N concurrent first-callers all return the same in-flight promise — the ~874 MB weights load **once**, not N times. ✔
- **Rejected-promise NOT cached forever:** the `.catch()` (lines 74-78) sets `loadPromise = null` then re-throws, so a transient load failure does **not** permanently poison the feature — the next call retries. ✔ (This is the exact failure mode the task asked about; it is handled.)
- **Disposal:** the runtime loader deliberately keeps the session alive (it is a process-lifetime singleton); the downloader script calls `model.dispose()` (download-clip-models.ts:109) because it only needs the download side-effect. Correct asymmetry.
- **Concurrent `session.run()`:** the shared singleton is hit concurrently by the fire-and-forget hook, backfill (`BATCH_CONCURRENCY=2`), and the semantic route. onnxruntime's `InferenceSession.run()` is documented thread-safe (weights shared, concurrent run safe), and transformers.js allocates fresh input tensors per call (we pass our own `Tensor`), so there is no shared-mutable-input hazard. **Not a bug.**

**Side note (latent, see LR-3):** the retry-on-rejection is correct for transient faults, but if the model volume is permanently absent in `production` mode, every processed image's fire-and-forget hook re-attempts the full `from_pretrained` load and fails again — an unbounded reload storm. Dark today; flagged below.

---

## Embedding math — VERIFIED ROBUST (no NaN/Inf)

`clip-embeddings.ts`, validated by execution:

- `normalizeEmbedding` zero-vector guard (line 110 `if (norm === 0) return v`) returns the zero vector unchanged — **no divide-by-zero**. ✔
- `cosineSimilarity` denominator guard (line 33 `if (denom === 0) return 0`) returns 0 for a zero/degenerate vector — **no NaN**. A degenerate embedding scores 0 and is filtered below the 0.22 threshold. ✔
- `truncateAndNormalize` Matryoshka head (line 118) + re-normalize is correct for the 1024→512 reduction.
- `clip-inference.ts` `deterministicEmbedding`: the `(uint32 >>> 0) / 2147483648 - 1` mapping yields `[-1, 0.99999999]` (verified) — bounded, no Inf. The chunk loop runs exactly 64 iterations (512/8), `offset` 0→504, no off-by-one, `remaining` lands on 0 cleanly. ✔

---

## Route error handling — VERIFIED (no stack-trace leak)

Both routes (`semantic/route.ts`, `similar/[id]/route.ts`):

- Model-missing in `production` mode: `embedTextReal` throws → caught (semantic:242-245) → returns **503** `{error:'Server error'}` (generic, no stack trace) and rolls back the rate-limit counter. ✔
- `similar/[id]`: id parsed with `parseInt` + `Number.isFinite(id) || id <= 0` guard (line 76); missing embedding → **404**; corrupt embedding (`buf.length !== EMBEDDING_BYTES`) → **404**; empty result → `{results:[]}`. All early-return paths roll back the rate-limit (Pattern 2). ✔
- Self-exclusion in similar (`row.imageId !== id`, line 154) is correct. ✔
- The rate-limit-before-config-read ordering (semantic:207-233) prevents free config-probing; the `'unknown'`-IP shared-bucket fail-closed posture is the intended security behavior.
- Body-size / content-type / chunked-encoding gates in semantic route are thorough; `clampSemanticTopK` correctly rejects non-number `raw` (booleans/arrays) before coercion.

---

## Components — VERIFIED (stale-request & error states handled)

- `search.tsx`: `requestIdRef` monotonic-id guard re-checked after **both** awaits (the `await fetch` at 159 AND the `await resp.json()` at 175) — a slow stale response cannot clobber a fresher one. The 300 ms debounce is cleared on unmount (line 228-230). Status mapping (429→rateLimited, 503→maintenance, else→error) is complete. ✔
- `similar-photos.tsx`: `fetchedRef` guards against double-fetch on toggle; any non-200 (503/404/429) or network error sets `results='error'` and the component returns `null` (line 84) — non-production deployments show no broken UI. ✔
  - **Minor note (LR-4):** neither component aborts the in-flight `fetch` on unmount (no `AbortController`). The `requestIdRef` guard in `search.tsx` prevents stale-state commits but the request still completes in the background. `similar-photos.tsx` has no unmount guard at all — a `setResults`/`setLoading` after unmount would log a benign React warning (no crash, harmless in React 19). Low value; documented for completeness.

---

## LATENT RISKS (real, but dark-gated — not live bugs today)

### LR-1 — Loader has NO checksum verification (downloader does) · Medium confidence
**File:** `clip-model.ts:63-71` vs `download-clip-models.ts:73-130`
**Failure mode:** `download-clip-models.ts` verifies `onnx/model_quantized.onnx` + `tokenizer.json` against a SHA-256 manifest, and its idempotency path (line 73-85) correctly RE-downloads when an existing file's hash mismatches — so an *interrupted download* is caught on the next script run. **But the runtime loader `getModelBundle()` performs no checksum at all.** If a partial/truncated ONNX survives on the volume (download script never re-run after an interrupted first run, or a disk-full event truncates the file after a clean download), the loader loads whatever bytes are present. Best case: opaque ONNX parse error → caught → infinite retry → feature stays dark. Worst case: a structurally-valid-but-wrong file loads and silently produces garbage embeddings that pollute `image_embeddings` at `PRODUCTION_MODEL_VERSION`.
**Trigger:** seed the volume, `kill -9` the download mid-write, then start the app in `production` mode without re-running the verified downloader.
**Expected vs observed:** expected = loader refuses an unverified/corrupt model; observed = loader trusts on-disk bytes unconditionally.
**Fix (when CLIP goes live):** have `getModelBundle()` verify the ONNX SHA-256 against the shared `JINA_CLIP_REVISION` manifest before `from_pretrained`, or gate startup on a `download-clip-models.ts --verify-only` pass. Today the gap is inert because the feature is `disabled`.

### LR-2 — Unbounded detached embedding tasks under production batch upload · Medium confidence
**File:** `image-queue.ts:433-470`
**Failure mode:** the embedding hook is fire-and-forget and runs OUTSIDE `PQueue` concurrency control. In `production` mode each completed Sharp job spawns a detached `embedImageReal` (CPU-heavy ONNX inference, hundreds of ms). A 100-photo batch at `QUEUE_CONCURRENCY=1` processes Sharp jobs serially, but the detached embedding tasks accumulate and run concurrently with each other AND the next Sharp job. onnxruntime's session is thread-safe (verified — no corruption), so this is a **CPU-oversubscription / latency** risk, not a data-corruption one. Each hook also issues a redundant `getGalleryConfig()` DB read (line 436) per image.
**Trigger:** flip `semantic_search_mode='production'`, upload 100+ photos in one batch on a CPU-constrained host.
**Expected vs observed:** expected = embedding work bounded by a concurrency cap or threaded through the queue; observed = N detached tasks contend for libvips/CPU with live encoding.
**Fix (when live):** route embedding through a small bounded `PQueue` (concurrency 1-2), or await it inside the queue task with its own timeout, and read `semanticSearchMode` once from the already-fetched config rather than re-querying. Dark today.

### LR-3 — Model-reload storm when production volume is absent · Low confidence
**File:** `clip-model.ts:74-78` + `image-queue.ts:445-446`
**Failure mode:** the (correct) reject-and-null retry behavior means that if the model volume is permanently missing in `production` mode, every processed image's detached hook re-attempts the full `from_pretrained` load, each failing after the I/O/parse attempt. Combined with LR-2's unbounded fan-out, a batch upload becomes a repeated failed-load storm (log spam + wasted I/O). Bounded only by the number of images processed; no backoff.
**Fix (when live):** add a short negative-cache TTL (e.g. cache the rejection for 30-60 s) so repeated callers fast-fail without re-attempting the load, while still eventually retrying. Dark today.

### LR-4 — Components don't abort in-flight fetches on unmount · Low confidence
**Files:** `search.tsx:138-214`, `similar-photos.tsx:55-81`
**Failure mode:** no `AbortController`. `search.tsx` is protected against stale-state commits by `requestIdRef`, so the only cost is a wasted in-flight request after close. `similar-photos.tsx` has no unmount guard at all — a `setResults` after unmount yields a benign React dev warning (harmless under React 19, no crash). Low value.
**Fix (optional):** thread an `AbortController` and `signal` into the fetch; abort in the effect cleanup / before re-fetch.

---

## DOC-DRIFT (cosmetic — no runtime impact)

### DD-1 — Stale threshold values in route docstrings
- `semantic/route.ts:10` says "above COSINE_THRESHOLD (0.18)" and line 25 says "PRODUCTION_COSINE_THRESHOLD (0.25)".
- `similar/[id]/route.ts:18` references the 0.18-style threshold.
- **Actual constants** (clip-embeddings.ts): `COSINE_THRESHOLD = 0.18` (stub) is right, but `PRODUCTION_COSINE_THRESHOLD = 0.22` (line 103), NOT 0.25. The docstring `(0.25)` is wrong.
- Impact: none at runtime (code reads the constants); misleads a future reader. Fix: update the comment to `0.22`.

### DD-2 — Stale schema comment ("MEDIUMBLOB / 2048 bytes")
- `schema.ts:259` and `:266` describe the `embedding` column as raw "MEDIUMBLOB (2048 bytes = 512 × 4-byte little-endian float32)" and say "the lib layer wraps Buffer reads/writes."
- **Actual behavior:** the column IS `mediumblob` (migration 0012, verified), but the application stores **base64 TEXT** (`buf.toString('base64')` in image-queue.ts:453 / backfill:160) and decodes via `Buffer.from(row.embedding, 'base64')` (routes). The on-disk content is ~2732 ASCII chars, not 2048 raw bytes, and the lib does base64 ↔ Float32Array, not raw Buffer ↔ Float32Array. The comment describes a binary-blob design the code does not use.
- Impact: none at runtime (base64 fits comfortably in a 16 MB MEDIUMBLOB; round-trips correctly). Misleading for maintainers and for column sizing. Fix: correct the comment to "base64-encoded TEXT stored in a MEDIUMBLOB column."

---

## Other surfaces checked — clean
- `admin-backfill-runner.ts`: heavily hardened across prior cycles. Lock acquire/release symmetric, `finally`-based release, pool-budget concurrency clamp guards NaN (line 137), deleted-mid-reencode cleanup, fire-and-forget runner wrapped in try/finally with belt-and-braces `.catch`. No new issue. The `state.running` vs advisory-lock TOCTOU in `triggerAdminBackfill` is intentional belt-and-braces (the lock is the real serializer).
- Empty-catch sweep across `src` (excluding tests): **zero** silent `catch {}` in production code (only a comment match in image-queue.ts). Catch blocks consistently log.
- `error.tsx` (admin): correct, accessible, 44 px touch targets.

---

## Re-confirmed prior known-harmless items (NOT re-reported as new)
- `gain-map-detection.ts:87` unreachable guard — already recorded harmless dead code.
- `isLosslessWebpByChunk` ANMF branch — already recorded.

---

## Aggregator summary (severity · confidence)

- **[INFO · High]** CLIP surface: 0 confirmed bugs. Queue race-protection invariants intact; lazy-singleton de-dups concurrent loads and does NOT cache rejection forever; concurrent ONNX `session.run()` is thread-safe; zero-vector cosine returns 0 (no NaN); routes leak no stack traces; components guard stale responses.
- **[LOW (latent) · Medium]** LR-1: runtime loader `clip-model.ts:63` performs NO model checksum (downloader does) — a corrupt/partial on-disk ONNX would load unverified → opaque error or silent garbage embeddings. Dark-gated.
- **[LOW (latent) · Medium]** LR-2: production embedding hook (`image-queue.ts:433`) is unbounded fire-and-forget — CPU oversubscription on large batch uploads + redundant per-image config DB read. Dark-gated.
- **[LOW (latent) · Low]** LR-3: model-reload storm (`clip-model.ts:74`) when production volume is permanently absent — no negative-cache backoff. Dark-gated.
- **[LOW (latent) · Low]** LR-4: `search.tsx` / `similar-photos.tsx` don't `AbortController`-cancel in-flight fetches on unmount — benign (stale-commit already guarded in search.tsx; React-19-harmless warning in similar-photos.tsx).
- **[TRIVIAL · High]** DD-1: route docstrings state `PRODUCTION_COSINE_THRESHOLD (0.25)`; actual is `0.22`. Comment-only.
- **[TRIVIAL · High]** DD-2: `schema.ts:259/266` comment claims raw binary "2048 bytes" storage; code stores base64 TEXT in the mediumblob. Comment-only.
