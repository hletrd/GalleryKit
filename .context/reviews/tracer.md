# Tracer Report — Run-6 Cycle-9

**HEAD verified:** `af9ae6c5`
**Date:** 2026-06-17
**Agent:** oh-my-claudecode:tracer

---

## Scope

Four execution paths traced through the live CLIP semantic-search subsystem, per task specification:

1. Public semantic query: `search.tsx` → `POST /api/search/semantic` → guard chain → rate limit → validation → clip-model embedding → cosine scan → result mapping → render.
2. Similar-photos: `similar-photos.tsx` → `GET /api/search/similar/[id]` → guard chain → embedding lookup → dotProduct scan → lens/date parity → render.
3. Seed → serve: `download-clip-models.ts` idempotency → `clip-model.ts` offline `from_pretrained` (`allowRemoteModels=false`) → singleton `loadPromise` nulls-on-failure retry.
4. Admin backfill: UI button → `admin-backfill-runner.ts` vs sidecar `backfill-clip-embeddings.ts` — column-set parity, advisory-lock serialization, `model_version`-aware selection.

Previously open findings from cycles 1–8 that were verified fixed at HEAD are enumerated below and explicitly not re-raised. Three architecture-dependent items remain in plan-361 as formally deferred (DEF-C8-1/2/3); they are not re-reported here as new findings.

---

## Trace 1 — Public semantic query

### Observation

POST `/api/search/semantic` traverses: same-origin guard → restore-maintenance guard → Content-Type prefix check → sub-type rejection → chunked-transfer rejection → Content-Length cap → body read + size cap → JSON parse → query trim → `countCodePoints(query) < 3` check → `preIncrementSemanticAttempt` → `getGalleryConfig()` (semanticMode gate) → `embedTextReal` or `embedTextStub` → DB scan with `WHERE model_version = activeModelVersion ORDER BY updated_at DESC LIMIT 5000` → `dotProduct` (production) or `cosineSimilarity` (stub) per row → `topK` → enrichment SELECT → JSON response.

### Guard chain ordering — verified correct

The rate-limit pre-increment (Pattern 2) fires AFTER the cheap validation gates (same-origin, maintenance, Content-Type, body size, JSON parse, query length) and BEFORE the expensive `getGalleryConfig()` + embedding calls. `rollbackSemanticAttempt` is called on every early-return after the pre-increment fires but before an expensive operation completes. The two `await`-separated request-id guards in `search.tsx` (`requestIdRef` check before committing semantic results) prevent stale response clobber. All paths confirmed.

### model_version isolation — verified airtight

`activeModelVersion` is derived from `semanticMode` immediately after the config read (line 235, `semantic/route.ts`). The DB scan at line 254 uses `eq(imageEmbeddings.modelVersion, activeModelVersion)`. Stub rows (`stub-sha256-v1`) and production rows (`jina-clip-v2-d512-q8`) are partitioned by the `WHERE` clause; neither can appear in the other's results. The `dotProduct` / `cosineSimilarity` gate (line 271, `isProd` guard) ensures stub vectors, which are NOT unit-normalized, continue using the norm-recomputing path. Production unit vectors use the cheaper `dotProduct` fast-path (AGG-C8-09 fix, confirmed present).

### Client-side short-query guard — verified present

`search.tsx` line 165: `countCodePoints(searchQuery.trim()) < SEMANTIC_MIN_QUERY_CODEPOINTS` (= 3) → `setSearchStatus('invalidSemantic')`. The `invalidSemantic` status key is declared in the `useState` type at line 129. The route rejects `countCodePoints(query) < 3` with 400 independently. Both guards agree at 3 code points (AGG-C8-04 fix confirmed). The `search.semanticExperimentalHint` i18n key and the `invalidSemantic` path are consistent with each other.

### 503/400/wrong-result failure modes — no new defects found

- Config unavailable → fail-closed at `disabled` → `rollbackSemanticAttempt` + 503. Correct.
- `embedTextReal` throws → `rollbackSemanticAttempt` + 503. Correct.
- DB scan throws → `rollbackSemanticAttempt` + 500. Correct.
- Enrichment query throws → `enrichedResults = []` (fallback to empty, no rollback needed — the expensive work already completed). This is the correct posture: the rate-limit token is consumed, the scan ran, the client receives an empty result rather than a false 503.
- Result mapping: `r.imageId` from the API response is mapped to `id` in the `SearchResult` type via the `semanticResults` construction (line 194–206, `search.tsx`). Field mapping is exhaustive with null-coalesce defaults.

**Trace 1 verdict: clean. No new defects.**

---

## Trace 2 — Similar-photos

### Observation

GET `/api/search/similar/[id]` traverses: same-origin guard → restore-maintenance guard → `parseInt(idStr, 10)` positive-integer check → `preIncrementSemanticAttempt` → `getGalleryConfig()` (production-only gate) → target embedding lookup `WHERE (imageId, modelVersion) = (id, PRODUCTION_MODEL_VERSION)` → `decodeEmbeddingColumn` → full scan `WHERE model_version = PRODUCTION_MODEL_VERSION ORDER BY updated_at DESC LIMIT 5000` → filter self → `dotProduct` per row → `topK(PRODUCTION_COSINE_THRESHOLD)` → enrichment SELECT → JSON response.

### Guard chain ordering — verified correct

Rate-limit pre-increment fires after the cheap id validation and before config read / DB work. All six early-return paths after the pre-increment call `rollbackSemanticAttempt` before returning. The success path (lines 153–241) does NOT call rollback, which is correct — the token is consumed for a completed legitimate scan.

### model_version isolation — verified airtight

The target embedding lookup explicitly filters `eq(imageEmbeddings.modelVersion, PRODUCTION_MODEL_VERSION)` (line 117). The full scan also filters `eq(imageEmbeddings.modelVersion, PRODUCTION_MODEL_VERSION)` (line 145). Gate 5 (line 101) prevents stub mode from reaching the scan entirely. No stub rows can appear in similar results.

### lens/date parity — verified fixed

AGG-C8-10 (route-level fix) is confirmed present at HEAD: `similar/[id]/route.ts` lines 205–206 include `lens_model: images.lens_model` and `capture_date: images.capture_date` in the enrichment SELECT; lines 183–184 declare them in the TypeScript type annotation; lines 227–228 include them in the mapping.

### Component SimilarResult interface vs route response — latent gap, not a new defect

The client-side `SimilarResult` interface in `similar-photos.tsx` (lines 14–25) declares `camera_model` but omits `lens_model` and `capture_date`. The route returns all three. However, `SimilarThumb` only renders `title` (passed as `item.title ?? item.description ?? null`) — there is no subtitle line in the similar-photos grid, unlike `SearchResultItem` in `search.tsx` which renders `[topic_label, camera_model, lens_model, formatStoredExifDate(capture_date)]`. Because the component never accesses `lens_model` or `capture_date`, their absence from the interface is consistent with the rendered output: the extra fields are silently available in the JSON payload but unused. This is a cosmetic consistency gap (the interface does not fully reflect the wire shape), not a defect: no data loss, no wrong result, no type error at runtime. It was not introduced in cycle 9 — it predates this HEAD. It is noted here for completeness but is not raised as a new finding because the original AGG-C8-10 only scoped the route-level fix, and the component's thumbnail grid layout intentionally omits subtitle text.

**Trace 2 verdict: clean. No new defects.**

---

## Trace 3 — Seed → serve

### Observation

`download-clip-models.ts` pre-warms the model cache. `clip-model.ts` loads offline via `from_pretrained(allowRemoteModels=false)`. The singleton `loadPromise` is nulled on catch.

### Idempotency fast-path — verified fixed (AGG-C8-02)

`download-clip-models.ts` lines 72–84: the `existsSync(onnxPath)` branch now calls `verifyAndCleanArtifacts(modelCacheDir, MANIFEST, false)` over the FULL manifest before short-circuiting. A partial seed missing `tokenizer.json` sets `preCheck.ok = false` and falls through to the download section. The old ONNX-only fast-path is gone. Fix confirmed at HEAD.

### Manifest scope — two entries covers the checksum surface

`CLIP_MODEL_MANIFEST` covers `onnx/model_quantized.onnx` and `tokenizer.json`. The comment in `clip-model-manifest.ts` (lines 21–24) explicitly states: "Only the large binary artifacts that are expensive to re-download are verified; config/tokenizer JSON files are small and self-describing." `tokenizer.json` IS in the manifest (the large tokenizer vocabulary). `tokenizer_config.json`, `config.json`, and `special_tokens_map.json` are small metadata files whose integrity is implicitly covered by the revision pin (immutable HF commit SHA). This is the intended scope — the manifest is not exhaustive by design, and the primary protection is the `allowRemoteModels=false` + immutable revision pin.

### loadPromise nulls-on-failure retry — verified correct

`clip-model.ts` lines 101–105: the `.catch` handler sets `loadPromise = null` before re-throwing. A failed load therefore retries on the next call rather than caching a rejected promise. There is no partial-state wedge: either the load succeeds (model is usable) or fails (next call retries). Confirmed.

### clipModelArtifactDir segment guard — verified present (AGG-C8-12)

`clip-paths.ts` lines 85–96: asserts `idSegments.length === 2`, non-empty segments, and `JINA_CLIP_REVISION` matches `/^[0-9a-f]{40}$/`. A future bare/3-segment model id or a `main` revision throws with a descriptive message instead of silently mis-pathing.

### env.cacheDir assignment ordering — verified correct

`clip-model.ts` line 86: `env.cacheDir = CLIP_MODELS_ROOT` is set before either `AutoModel.from_pretrained` or `AutoTokenizer.from_pretrained`. `env.allowRemoteModels = false` is also set before both calls. No race between env mutation and model load.

**Trace 3 verdict: clean. No new defects.**

---

## Trace 4 — Admin backfill (UI button + sidecar)

### Observation

Two backfill entry points: `admin-backfill-runner.ts` (in-app, triggered by admin UI) and `scripts/backfill-clip-embeddings.ts` (sidecar). `actions/embeddings.ts` (`backfillClipEmbeddings`) is a third path (server action, currently unwired from UI).

### Column-set parity — verified

The in-app color-pipeline backfill runner (`admin-backfill-runner.ts`) persists: `pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit` (lines 557–570). This matches the set documented in CLAUDE.md. The detection-failure branch persists `was_downscaled` + `avif_10bit` only, without bumping `pipeline_version` (AGG-01 fix confirmed).

The CLIP embedding backfill sidecar (`backfill-clip-embeddings.ts`) persists: `embedding`, `modelVersion` per-row via upsert. The in-app `backfillClipEmbeddings` action does the same. Both paths are consistent on the CLIP column set.

### Advisory lock serialization — verified

The color-pipeline runner acquires `gallerykit_color_pipeline_backfill` (non-blocking, 0-second timeout) on a dedicated `lockConn` before any re-encode work. The sidecar uses the same lock name (CLAUDE.md confirms). The CLIP sidecar does NOT acquire the color-pipeline lock (they operate on different tables/paths) — this is correct; they are independent operations. The color-pipeline runner's `runBackfill` wraps all state mutation and encode work in a single `try/finally` that releases the lock on completion or failure. No leak path found.

### model_version-aware selection — verified fixed (AGG-C8-05)

`actions/embeddings.ts` lines 84–113: `modelVersion` is hoisted above the candidate query (line 92); the `notExists` inner SELECT now filters on BOTH `eq(imageEmbeddings.imageId, images.id)` AND `eq(imageEmbeddings.modelVersion, modelVersion)` (lines 108–109). This matches the sidecar's two-condition form (lines 128–131 of `backfill-clip-embeddings.ts`). A stub-version row no longer blocks production-version re-embedding. Fix confirmed at HEAD.

### Per-image advisory lock (CLIP path) — note

The CLIP backfill paths (sidecar and server action) do NOT acquire the `gallerykit:image-processing:{id}` per-image claim that the color-pipeline runner uses. This is intentional: the CLIP paths only write to `image_embeddings` (a separate table), not to the image derivative files or `images` row columns that the image-processing lock protects. The upsert into `image_embeddings` is idempotent (ON DUPLICATE KEY UPDATE), so a concurrent CLIP embed from two paths produces the correct final state (last writer wins, same data). No locking gap here.

**Trace 4 verdict: clean. No new defects.**

---

## Summary

All four traces are clean at HEAD `af9ae6c5`. Every finding from cycles 1–8 that was scheduled in plan-360 has been verified fixed:

- AGG-C8-02: downloader idempotency fast-path now verifies the full manifest — confirmed.
- AGG-C8-04: client-side short-query guard with correct `invalidSemantic` status — confirmed.
- AGG-C8-05: `backfillClipEmbeddings` `notExists` subquery is `model_version`-aware — confirmed.
- AGG-C8-08 / AGG-C8-09: `dotProduct` fast-path gated on `isProd`; `cosineSimilarity` preserved for stub — confirmed.
- AGG-C8-10: `similar/[id]/route.ts` enrichment SELECT includes `lens_model` + `capture_date` — confirmed.
- AGG-C8-11: `aria-controls="similar-photos-results"` on the button, matching `id` on the result div — confirmed.
- AGG-C8-12: `clipModelArtifactDir` segment + 40-hex SHA guard — confirmed.
- AGG-C8-03: `(model_version, updated_at)` index migration present — confirmed (commit `bbd311c5`).

Three items remain formally deferred in plan-361 (DEF-C8-1 HIGH / DEF-C8-2 MEDIUM / DEF-C8-3 LOW). They are architecture-dependent and explicitly out of scope for a same-cycle fix. They are not re-raised as new findings.

**New findings this cycle: 0.**

---

## Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| — | All four traces clean at HEAD | High | Strong — direct file reads, line-level verification of each guard, fix annotation, and git log | Every scheduled cycle-8 fix is present; no new execution-path defect found |

### Evidence For

- Semantic route guard chain: same-origin → maintenance → Content-Type → body cap → parse → length → rate-limit → config → embed → scan → enrich. Each step confirmed at exact line in `semantic/route.ts`.
- Similar route guard chain: same-origin → maintenance → id validation → rate-limit → production gate → target embed lookup → scan. All rollback paths confirmed at `similar/[id]/route.ts` lines 102, 122, 129, 134, 149.
- Seed idempotency: `download-clip-models.ts` lines 72–84 call `verifyAndCleanArtifacts` over the full manifest before early-return. The old ONNX-only path is absent.
- `loadPromise = null` on catch: `clip-model.ts` lines 101–105.
- modelVersion in `backfillClipEmbeddings`: `embeddings.ts` lines 92 and 108–109.
- All AGG-C8 scheduled fixes annotated in source with their finding IDs.

### Evidence Against / Gaps

- The `SimilarResult` interface in `similar-photos.tsx` omits `lens_model` and `capture_date` even though the route returns them and the route-side type declares them. The component does not render a subtitle, so the fields are unused. This is a cosmetic wire-shape inconsistency, not a defect, and was not introduced this cycle.
- The three deferred items (DEF-C8-1/2/3) remain open architectural concerns, not new defects.

### Rebuttal Round

The strongest challenge to the "all clean" conclusion would be: "the `SimilarResult` interface mismatch is a silent API contract violation that could cause TypeScript to miss a future rendering bug." The rebuttal: TypeScript does not enforce interface completeness on `res.json() as { results?: SimilarResult[] }` casts — the cast is a type assertion, not a structural check. The runtime JSON contains the extra fields; the component simply ignores them. No crash, no wrong data rendered. The interface could be enriched for documentation fidelity, but it is not a defect at the current rendering scope.

### Convergence / Separation Notes

All four traces converge on "clean at HEAD." The three deferred items remain genuinely distinct architectural concerns (main-thread inference, mount-time integrity, reload-storm hardening) — they are not masked by this trace, and their re-open criteria are preserved per plan-361.

### Current Best Explanation

HEAD `af9ae6c5` is clean across all four traced flows. The cycle-8 plan-360 fixes are all present and individually verified. No new execution-path defect was found in cycle 9.

### Critical Unknown

None that blocks operation of the current live surface. The one substantive open question is whether the 5000-row JS cosine scan + ONNX tensor marshalling causes measurable latency degradation under concurrent load at scale — this is DEF-C8-1, formally tracked in plan-361 with an architect-led design exit criterion.

### Discriminating Probe

If production search latency metrics are available (server-side response time for `POST /api/search/semantic` under concurrent load), comparing p95 latency at 1 concurrent request vs. 3–5 concurrent requests would discriminate between "acceptable JS-loop overhead" and "main-thread saturation" and would determine whether DEF-C8-1 needs to be escalated above its current deferred-HIGH status.

### Uncertainty Notes

- The CLIP manifest covers only 2 of the ~6–8 files `from_pretrained` reads. The uncovered files (`tokenizer_config.json`, `config.json`, `special_tokens_map.json`) are protected by the immutable revision pin rather than content hash. This is the documented intended scope, not a gap — but it is a trust assumption worth naming.
- The `SimilarResult` interface / route response field asymmetry is noted but assessed as non-defect given current render scope.
