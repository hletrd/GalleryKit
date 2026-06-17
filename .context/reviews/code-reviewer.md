# Code Reviewer — Run-6 Cycle-9 Deep Code-Quality + Correctness Review

**Date:** 2026-06-17
**HEAD reviewed:** `af9ae6c5` (working tree clean)
**Reviewer:** code-reviewer (oh-my-claudecode)
**Scope:** Entire repo, with deep focus on the CLIP/semantic-search activation surface (the only code that changed since the cycle-7 0-finding baseline `a7758ef0`).

---

## Verdict

**REQUEST CHANGES** — **1 new real finding** (CR-C9-01, HIGH).

The cycle-8 activation closed 13 findings cleanly. This pass re-verified each against current HEAD (none re-opened) and swept the whole system for fresh correctness issues. I found **one genuine, HEAD-verified residual gap** in the AGG-C8-02 fix: the downloader idempotency fast-path now verifies "the full manifest," but the manifest itself omits two files (`config.json`, `tokenizer_config.json`) that are **fatal-for-offline-load** in `@huggingface/transformers` v3.8.1 — so the exact partial-seed → 503-storm failure mode AGG-C8-02 set out to eliminate is only partially closed.

No CRITICAL. No HIGH/CRITICAL at HIGH confidence other than CR-C9-01 (rated HIGH severity / MEDIUM confidence — see below). All HARD GUARDS respected; nothing here proposes weakening the live feature.

### By severity
- CRITICAL: 0
- HIGH: 1 (CR-C9-01)
- MEDIUM: 0
- LOW: 0 (1 informational observation, CR-C9-OBS-1, non-actionable)

---

## Findings

### CR-C9-01 [HIGH] — CLIP manifest omits `config.json` + `tokenizer_config.json`; partial-seed idempotency fast-path still green-lights a runtime 503 storm

- **Where:**
  - `apps/web/scripts/clip-model-manifest.ts:25-30` — `CLIP_MODEL_MANIFEST` has only **two** entries: `onnx/model_quantized.onnx` and `tokenizer.json`.
  - `apps/web/scripts/download-clip-models.ts:72-84` — idempotency fast-path: `if (existsSync(onnxPath))` → `verifyAndCleanArtifacts(modelCacheDir, MANIFEST, false)` → if `preCheck.ok`, prints "already up to date" and `return`s (exit 0).
  - `apps/web/src/lib/clip-model.ts:90-98` — offline load: `AutoModel.from_pretrained` (→ `AutoConfig` → `config.json`) and `AutoTokenizer.from_pretrained` (→ `tokenizer.json` + `tokenizer_config.json`), all with `env.allowRemoteModels=false`.

- **Why it's a problem:** The AGG-C8-02 fix (cycle-8, scheduled in plan-360 TASK-1, NOT deferred) replaced the ONNX-only early-return with a *full-manifest* `verifyAndCleanArtifacts` call so that "a partial/corrupt seed missing a config file is [no longer] reported up-to-date." The original finding text explicitly named the fatal files: "`tokenizer.json` / `tokenizer_config.json` / `config.json` … the offline `from_pretrained` (`allowRemoteModels=false`) treats them as **fatal**." But the manifest the fast-path checks contains **neither `config.json` nor `tokenizer_config.json`**. I verified fatality against the pinned runtime version:
  - `@huggingface/transformers` v3.8.1 `src/configs.js:54` — `loadConfig` → `getModelJSON(..., 'config.json', true, ...)` (3rd arg `true` = **fatal**).
  - v3.8.1 `src/tokenizers.js:67-71` — `loadTokenizer` → `getModelJSON(..., 'tokenizer.json', true, ...)` **and** `getModelJSON(..., 'tokenizer_config.json', true, ...)` (both **fatal**); line 2742 documents "Throws … if the tokenizer.json or tokenizer_config.json files are not found."

  So a seed where `config.json` or `tokenizer_config.json` is missing/truncated/corrupt — but `onnx/model_quantized.onnx` and `tokenizer.json` are intact — passes `verifyAndCleanArtifacts` (it only inspects the 2 manifest entries), the downloader reports "All checksums OK — already up to date" and exits 0, and the operator believes the seed is healthy. The first live semantic/similar query then calls `from_pretrained`, which throws on the missing/corrupt config → `getModelBundle()`'s `.catch` nulls `loadPromise` (clip-model.ts:101-105) → every subsequent request retries the load, throws again, and returns 503 **indefinitely**. This is precisely the failure class AGG-C8-02 was created to prevent; the fix narrowed but did not eliminate it.

  The test `apps/web/src/__tests__/download-clip-models.test.ts` ("idempotency fast-path verifies the full manifest (not ONNX-only)") asserts the script calls `verifyAndCleanArtifacts(...MANIFEST...false)` — it pins that the *manifest* is checked, but cannot catch that the *manifest* is itself incomplete, so it gives false confidence the gap is closed.

- **Failure scenario:** Operator runs the canonical `docker run --rm ... download-clip-models.ts` seed. The download is interrupted after ONNX + tokenizer.json finish but while `config.json` is half-written (network blip, disk-full mid-write, container OOM-kill, or a manual partial copy of the bind-mount). Operator re-runs the seed to "make sure"; the fast-path verifies the 2 manifest entries (both intact), prints "already up to date," exits 0. Operator flips `semantic_search_mode='production'` + `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. First visitor query → `from_pretrained` throws on the truncated `config.json` → 503 → every search and every "similar photos" expansion 503s indefinitely with no operator-visible cause (the seed reported success).

- **Fix (small, additive, low-risk):** Add `config.json` and `tokenizer_config.json` to `CLIP_MODEL_MANIFEST` with their pinned-revision SHA-256 hashes (compute once from a verified good seed at revision `e10d47f5…b74cb436`). They are small JSON files, so the hashing cost is trivial and the integrity guarantee becomes complete. `verifyAndCleanArtifacts` and both call sites then cover every fatal-for-offline-load artifact with no further code change. Strengthen the test to assert the manifest *contains* `config.json` and `tokenizer_config.json` (not merely that "the manifest" is checked), so the completeness invariant is pinned. (Lower-quality alternative: add explicit `existsSync` + non-empty checks for the two files in the fast-path without hashes — catches "missing" but not "corrupt/truncated"; the manifest-SHA route is strictly better and reuses existing machinery.)

- **Confidence:** **HIGH** on the mechanism (config.json + tokenizer_config.json are provably fatal in the pinned v3.8.1; manifest provably omits them; fast-path provably short-circuits on the incomplete manifest). **MEDIUM** on real-world trigger probability (requires partial corruption of exactly those JSON files while onnx + tokenizer.json stay valid — a plausible interrupted/disk-full seed, the same event class AGG-C8-02 itself targeted). Severity preserved **HIGH** to match AGG-C8-02's consensus rating: a wedged production search with no operator-visible cause is high operational impact even though the trigger is operator-side.

- **Repo-policy note:** Correctness/availability residual on a LIVE path. Per the review-plan-fix deferred-fix rules, schedule it or formally defer with a quoted basis and preserved severity — do not silently drop. Cheap to land this cycle.

---

## Informational (not a finding to action)

### CR-C9-OBS-1 — similar route enrichment returns `lens_model` + `capture_date` that `SimilarPhotos` discards
- **Where:** `apps/web/src/app/api/search/similar/[id]/route.ts:205-206, 227-228` add `lens_model` + `capture_date` to the enrichment SELECT (the AGG-C8-10 cycle-8 fix), but `apps/web/src/components/similar-photos.tsx` `SimilarResult` (lines 14-25) does not declare those fields and `SimilarThumb` renders only `title`/`description`.
- **Assessment:** Harmless. The two extra columns are public, non-PII, and already returned by keyword + semantic search; the only effect is a few unused bytes per result in the JSON. AGG-C8-10's stated rationale ("parity with the semantic route's enrichment … without these, similar-result cards rendered with the shared component show blank lens/date") anticipates a *future* shared result-card component; the current `SimilarThumb` is a distinct minimal component. Not worth a code change — flagged only so a future reviewer doesn't re-discover the SELECT/component asymmetry and mistake it for a bug. **Confidence: HIGH** (verified both files at HEAD).

---

## Cycle-8 findings re-verified at HEAD (all CLOSED — none re-opened)

| Finding | Status at `af9ae6c5` | Evidence |
|---|---|---|
| AGG-C8-02 (partial-seed idempotency) | **PARTIAL** — fast-path verifies the manifest, but manifest is incomplete → **CR-C9-01** | manifest.ts:25-30; download.ts:72-84 |
| AGG-C8-03 (missing index) | CLOSED | migration `0022_…`; schema.ts:287; migrate.js `reconcileLegacySchema` ensureIndex mirror; journal `when` monotonic (0022 = max) |
| AGG-C8-04 (short-query UX) | CLOSED | search.tsx:165-170 guard → `invalidSemantic` before fetch |
| AGG-C8-05 (backfill model_version) | CLOSED | embeddings.ts:92 hoists `modelVersion`; notExists subquery filters `eq(modelVersion)` (109); matches sidecar:125-131 |
| AGG-C8-06 (i18n 2-vs-3) | CLOSED | en.json/ko.json `search.invalidSemantic` present + correct ("3 characters" / "세 글자"); `search.invalid` correctly retains "2" for keyword path; key parity holds |
| AGG-C8-07 (deployed-dark docs) | CLOSED | zero "deployed dark" remnants in CLAUDE.md / en.json / ko.json; `settings.semanticSearchDesc` now describes the operator-gating mechanism |
| AGG-C8-09 (dotProduct fast-path) | CLOSED | semantic route gates `isProd ? dotProduct : cosineSimilarity` (route.ts:271 — correct: stub vectors are NOT unit-length so MUST keep cosine); similar route uses dotProduct unconditionally (production-only, route.ts:163) |
| AGG-C8-10 (lens/date parity) | CLOSED (payload); see CR-C9-OBS-1 | similar route SELECT:205-206 |
| AGG-C8-11 (aria-controls) | CLOSED | similar-photos.tsx:110 `aria-controls` + :121 region `id` |
| AGG-C8-12 (model-id split guard) | CLOSED | clip-paths.ts:84-96 asserts 2-segment id + 40-hex non-main revision; live constants verified 40-hex (`e10d47f5…`) so guard passes |
| AGG-C8-01 / -08 / -13 | DEFERRED (plan-361, architect-led design) | not re-opened here — all three correctly recorded with preserved severity + fired re-open criteria |

---

## What was verified clean (no finding)

- **Both search routes** (`semantic/route.ts`, `similar/[id]/route.ts`): same-origin 403 → maintenance 503 → content-type/JSON-subtype reject → chunked reject → Content-Length + raw-body size cap (413) → JSON shape → ≥3-codepoint → rate-limit pre-increment (Pattern 2, rolled back on **every** subsequent early return) → authoritative config re-read failing closed → mode-correct model_version + threshold + similarity fn → bounded ≤5000 scan → null-safe `decodeEmbeddingColumn` skip → `topK` → enrichment with `processed=true` + score re-sort + empty-array fallback. `clampSemanticTopK` correctly rejects non-number `raw` (booleans/arrays). No leaked private fields (no GPS / filename_original / ICC / HDR) in either enrichment SELECT.
- **clip-model.ts** singleton: lazy native import inside `getModelBundle`; `loadPromise` nulls on failure → retries (not poisoned); `embedText/ImageReal` validate output key presence + `data.length >= EMBEDDING_DIM` before `truncateAndNormalize`; image preprocessing forces `srgb` + `removeAlpha` + asserts `channels === 3` (defends CHW indexing). `server-only` correctly absent (boundary-test backed).
- **clip-embeddings.ts**: `cosineSimilarity` / `dotProduct` dim-mismatch throws + zero-denom guard; `decodeEmbeddingColumn` covers raw-Buffer / legacy-base64-in-Buffer / base64-string, length-checked, malformed → null; `embeddingToBuffer`/`bufferToEmbedding` dim/byte guards; `truncateAndNormalize` `subarray(0,512)` safe (native dim 1024) + re-normalize; `normalizeEmbedding` zero-vector → no NaN.
- **clip-paths.ts**: absolute-verbatim / relative-vs-cwd resolution (no path doubling); revision-subdir layout + 2-segment/40-hex guards. **clip-model-id.ts**: 40-hex non-main pin verified.
- **embeddings.ts** action: isAdmin + same-origin + per-hour rate-limit; mode-aware (disabled no-op / stub / production); `!filenameOriginal` skip before `resolveOriginalUploadPath`; bounded concurrency; localized generic error + server-log detail. (Single-PK + `onDuplicateKeyUpdate` overwrite is internally consistent with the global single-mode invariant — see note below.)
- **image-queue.ts** embedding IIFE (line 434): self-contained try/catch fire-and-forget (must not fail upload); `originalPath` defined+`fs.access`-validated at 293-296 before the IIFE; mode-aware writer.
- **download-clip-models.ts**: absolute-aware resolver shared with loader; verifies revision-subdir; post-download delete-on-mismatch + abort. **migrate.js**: 0022 mirrored idempotently via `ensureIndex` after the table create; journal monotonic.
- **rate-limit.ts** semantic helpers: pre-increment/rollback correct; bounded map (2000 keys); single-threaded Node → no decrement race.
- **Non-CLIP high-risk routes** (stripe webhook, checkout, download, serve-upload, download-tokens, stripe, sw-cache): swept via Explore — all clean, confirming the cycle-7 baseline. Entire non-CLIP `src` tree is byte-identical to `a7758ef0` (git diff confirmed: only CLIP/search/schema/migrate + similar-photos.tsx changed).

### Data-model note (verified consistent, NOT a finding)
`image_embeddings` has a single-column `PRIMARY KEY (image_id)` (migration 0012), so only one row per image exists — yet all selection logic filters by `model_version`. I traced this end-to-end and it is **internally consistent**, not a bug: `semantic_search_mode` is one global setting, so a deployment is in exactly one mode at a time; stub and production rows never need to coexist for the same image. The `notExists(… AND model_version = TARGET)` selection correctly matches a stale-version row, and `onDuplicateKeyUpdate` overwrites that single row in place (embedding + model_version) — so the documented "upgrade stub→production" path works via overwrite. The image-queue.ts:431-433 comment ("no schema migration is needed for that future encoder to tell stub vectors apart") is accurate for the single-mode model. No action.

---

## Method / coverage statement
Read in full: both search routes, clip-model.ts, clip-embeddings.ts, clip-inference.ts, clip-model-id.ts, clip-paths.ts, clip-model-manifest.ts, download-clip-models.ts, embeddings.ts action, gallery-config.ts, search.tsx, similar-photos.tsx, image-queue.ts embedding block, rate-limit.ts semantic helpers, schema.ts embeddings table, migrations 0012/0022, migrate.js diff, all CLIP test files. Verified the entire non-CLIP source surface unchanged vs the cycle-7 baseline and swept 7 high-risk untouched files via a read-only Explore agent. Cross-checked transformers v3.8.1 fatality claims against the upstream tagged source. Re-verified every cycle-8 finding against HEAD. Final pattern grep for floating promises / missing awaits / swallowed errors across the changed surface.
