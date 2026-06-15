# Design Spec — Real CLIP Semantic Search (US-P51 → production)

- **Date:** 2026-06-14
- **Status:** Approved design, pending implementation plan (writing-plans)
- **Scope owner:** GalleryKit (`apps/web`, Next.js 16 self-hosted photo gallery)

## 1. Problem & Goal

Semantic search in GalleryKit is ~95% built but its encoder is a stub: `CLIP_MODEL_VERSION = 'stub-sha256-v1'`, where `embedImageStub` / `embedTextStub` produce deterministic **SHA-256-derived** 512-dim vectors. Cosine similarity between a query and an image is therefore essentially random, the admin `semantic_search_mode` can only be `disabled` or `stub`, and the search UI carries an "experimental — results may not match" disclaimer.

**Goal:** replace the stub with a **real multilingual CLIP encoder**, open the config gate to `production`, recalibrate the relevance threshold, and ship two genuinely-working features — **natural-language search (Korean + English)** and **"similar photos"** — fully self-hosted (CPU, no per-query API cost, single Docker container).

Everything else in the pipeline already exists and is reused: the `image_embeddings` table, `/api/search/semantic`, `components/search.tsx`, `scripts/backfill-clip-embeddings.ts`, `lib/clip-embeddings.ts` (cosine / top-K / float32 ser-de), the fire-and-forget upload hook in `image-queue.ts`, and the `semantic_search_mode` admin setting.

## 2. Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Languages | Korean + English (multilingual) | Bilingual ko/en app; demo is a Korean photographer's gallery. Korean queries must work. |
| Model | jina-clip-v2 class (multilingual, explicit Korean, Matryoshka) | Multilingual-retrieval SOTA-class; lists Korean among 89–100 languages. |
| Embedding dim | **512 via Matryoshka truncation** of the native 1024 | Keeps `EMBEDDING_DIM=512` / 2048-byte BLOB and all existing ser-de **unchanged → zero schema migration**. 1024 is a reversible later upgrade (re-embed). |
| Quantization | int8 ONNX | CPU-feasible footprint. |
| Runtime | Transformers.js v3 (`@huggingface/transformers`) in-process; **fallback** raw `onnxruntime-node` | Higher-level wrapper handles image preprocessing + multilingual tokenization → less glue. Fallback if jina's custom arch isn't turnkey in Transformers.js (resolved by a planning spike). |
| Weights location | Downloaded once to the `./data/models/` **bind-mount volume**, NOT baked into the image | Keeps the Docker image lean (the deploy host is disk-constrained). |
| Scale | ~thousands of photos → **linear cosine scan**, no ANN index | Single-digit-ms scan at this size; matches existing `SEMANTIC_SCAN_LIMIT` design. |
| Features in v1 | Text→image search **and** image→image "similar photos" | "Similar photos" reuses stored vectors → near-zero added cost. |

## 3. Architecture (change surface)

**Reused unchanged:** `image_embeddings` schema, route shape, `search.tsx`, backfill structure, `clip-embeddings.ts` math, upload hook, `semantic_search_mode` config.

**New / changed (small):**
1. `lib/clip-inference.ts` — stub → real encoder (image + text), wrapping the model loader.
2. New `lib/clip-model.ts` (or similar) — lazy-singleton model loader (load on first use, reuse process-wide), reads weights from `./data/models/`.
3. New `scripts/download-clip-models.ts` — one-time weight fetch into the volume.
4. `lib/gallery-config-shared.ts` — validator allows `'production'`.
5. `lib/clip-embeddings.ts` — `CLIP_MODEL_VERSION` bumped to the real model id (e.g. `jina-clip-v2-d512-int8`); threshold recalibrated.
6. `app/api/search/semantic/route.ts` — scan filtered to the active production `model_version`; serve only when real embeddings exist.
7. New `app/api/search/similar/[id]/route.ts` (or extension) + a "Similar photos" entry in the photo viewer.
8. `components/search.tsx` — drop the experimental disclaimer when mode is `production`.
9. Docker: add `onnxruntime-node` to the web image; ensure `./data/models/` is on the data volume.

## 4. Embedding Generation (image side — always async)

- **Upload:** the existing fire-and-forget hook in `image-queue.ts` calls the real **image encoder** and writes `model_version` = the real id. It must remain non-blocking and lower priority than derivative generation so it never starves the image-processing queue.
- **Backfill:** `scripts/backfill-clip-embeddings.ts` re-embeds every row whose `model_version` ≠ the current real id — i.e. all `stub-sha256-v1` rows and any future model/dim change. Idempotent, bounded concurrency, existing batch/limit logic retained. Run via the documented `--rm` sidecar pattern (prod container has no tsx/source).
- Stub rows are **never trusted or served** — they are re-embedded. This matches the contract already documented in the code comments.

## 5. Query Path + Vector Search

- Query string → **text-tower encode** (one CPU forward pass, user-facing, sub-second target) → linear cosine scan over embeddings of the active model → top-K above the calibrated threshold. Reuses the existing route almost verbatim.
- The scan **filters to rows whose `model_version` == active production model**, so stub or stale-dim rows cannot pollute results during or after migration.
- **Threshold:** `0.18` is meaningless for real vectors. It will be recalibrated empirically against a small ko+en labeled probe set during implementation and stored as a model-specific constant.
- Any jina-specific query handling (task prefix / instruction, L2 normalization) is applied in the encoder wrapper; exact form pinned during the planning spike.

## 6. Similar Photos (image → image)

- Reuse a photo's **already-stored** embedding; cosine vs all others; exclude self; return top-K. No new inference.
- Thin `/api/search/similar/[id]` (or an extension of the semantic route) + a "비슷한 사진 / Similar photos" affordance in the photo viewer (and/or lightbox). Respects the same `model_version` filter and same public same-origin + rate-limit posture as the semantic route.

## 7. Config Gate + Honesty

- `semantic_search_mode` validator extended to accept `'production'` (currently rejected, CRT-R5C1-01). Modes:
  - `disabled` (default) → 503.
  - `stub` → experimental demo, unchanged, disclaimer retained.
  - `production` → real search. It serves results **only from rows matching the active real `model_version`**. If `production` is configured but no real-model embeddings exist yet (e.g. backfill not finished), the route returns **503** rather than serving stub or empty results under the `production` label — it never deceives.
- `search.tsx`: the "experimental — results may not match" disclaimer is shown for `stub` only, removed for `production`.

## 8. Docker / Ops

- `onnxruntime-node` native binary added to the web image (the one unavoidable image-size bump; model weights stay on the volume).
- First run downloads weights to `./data/models/` (one-time, persisted across deploys via the existing `./data` bind mount). Document an offline pre-seed path for air-gapped deploys.
- Single-writer topology → model loaded once per process; int8 footprint bounded.
- **Note:** the per-deploy Docker auto-prune just added to `deploy.sh` leaves `./data` (hence `./data/models/`) untouched — bind mounts are never pruned. No interaction risk.

## 9. Error Handling / Degradation

- Model load failure → logged; the route returns 503 and never crashes the web process. The embedding hook stays fire-and-forget and never blocks the queue.
- Images lacking an embedding are silently excluded from results (not an error).
- Embedding generation runs at low priority relative to derivative processing.

## 10. Testing (proven-RED discipline)

- **Unit:** existing cosine / ser-de / dim guards retained; add `model_version`-guard tests (route refuses to serve stub rows as `production`).
- **Contract:** `production` gate behavior; disclaimer present only in `stub`.
- **Integration smoke (anti-vacuity):** embed 2–3 fixture images, run one Korean and one English query, assert the expected image ranks first — proves the encoder is *real*, not random. This test must fail against the stub.
- **Threshold calibration:** a small labeled probe asserting the calibrated threshold separates relevant from irrelevant on the fixtures.
- All existing gates (lint, typecheck, vitest, 3 security lints, touch-target, i18n parity) stay green.

## 11. Out of Scope (YAGNI)

ANN / vector index (small scale), GPU inference, model fine-tuning, full 1024-dim (reversible later upgrade), the Florence-2 auto-alt-text stub (separate feature, US-P52), HDR delivery (separate feature, WI-09).

## 12. Open Items to Resolve During Planning

1. **Runtime spike:** confirm whether jina-clip-v2 (int8, Matryoshka-512) loads turnkey in Transformers.js v3, or whether the raw `onnxruntime-node` fallback (with jina's published ONNX + manual preprocessing) is required. Pick one; both keep the in-process + volume-weights decision.
2. **Exact model id / ONNX source** (HF repo + revision) and the int8 artifact, pinned for reproducible downloads.
3. **Threshold value** from the ko+en calibration probe.
4. **Query preprocessing** (jina task prefix / normalization) confirmed against the chosen artifact.

These are explicit planning decisions with defined options and a defined fallback — not unresolved blockers.

### Spike result (Task 1) — 2026-06-15

**Status: RESOLVED — Transformers.js v3 works.**

| Field | Value |
|---|---|
| Runtime | `@huggingface/transformers` v3.8.1 (pulls `onnxruntime-node` v1.21.0 as transitive dep) |
| Model id | `jinaai/jina-clip-v2` |
| Model file | `onnx/model_quantized.onnx` (q8 int8, ~downloaded by Transformers.js cache on first use) |
| Model class | `JinaCLIPModel` (Transformers.js auto-resolves via `model_type: jina_clip`) |
| Load API | `AutoModel.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' })` + `AutoTokenizer.from_pretrained(MODEL)` |
| Image preprocessing | Manual (AutoProcessor falls back to tokenizer for jina_clip — custom `JinaCLIPProcessor` not implemented in Transformers.js). Resize 512×512 (`fit: fill`), normalize with CLIP means `[0.48145466, 0.4578275, 0.40821073]` / stds `[0.26862954, 0.26130258, 0.27577711]`, layout CHW float32, batch dim 1. Sharp handles decode. |
| Image embed call | `model({ pixel_values: Tensor('float32', pv, [1,3,512,512]) })` → `l2norm_image_embeddings` (already unit-length) |
| Text embed call | `tokenizer(text, { padding: true, truncation: true })` → `model({ input_ids, attention_mask })` → `l2norm_text_embeddings` (already unit-length) |
| normalize | Built-in — `l2norm_*` outputs are already L2-normalized; no further normalize step needed |
| Native dim | **1024** |
| Matryoshka-512 | Take first 512 dims, re-normalize (`truncateAndNormalize` from Task 3) |
| Load time (cached) | ~1.3 s (model weights already in `.cache/`) |
| Image encode latency | ~1 700 ms (CPU, macOS, first call; cached model) |
| Text encode latency | ~11 ms per query |

**Cosine similarity proof** (cat photo vs. matching / unrelated captions):

| Pair | native-1024 | Matryoshka-512 |
|---|---|---|
| `cos(image, "a photo of a cat")` [EN matching] | **0.3342** | **0.3534** |
| `cos(image, "고양이 사진")` [KO matching] | **0.3004** | **0.3167** |
| `cos(image, "a city street at night")` [unrelated] | 0.1345 | 0.1439 |

Matching clearly beats unrelated in both English and Korean. Matryoshka-512 preserves the gap (and is marginally stronger — higher matching, same unrelated). **This resolves open items 1, 2, and 4.** Open item 3 (threshold value) is deferred to Task 14.

**Operational notes:**
- `onnxruntime` emits benign shape-mismatch warnings on text-only inference because `JinaCLIPModel.forward` creates a zero-size dummy `pixel_values` tensor internally — these are harmless and do not affect output correctness.
- On macOS the process exits with code 134 (mutex teardown crash in onnxruntime) after inference completes; inference itself is correct. This is a macOS-specific onnxruntime teardown issue and does not occur on Linux (Docker/production).
- Model weights are cached by Transformers.js to `node_modules/@huggingface/transformers/.cache/` by default; in production set `env.cacheDir` to the `./data/models/clip` bind-mount volume so weights persist across deploys (Task 4 wires this).
