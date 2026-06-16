# Document-Specialist Review — Doc/Code Accuracy (CLIP-focused + general sweep)

**Scope:** CLAUDE.md, AGENTS.md, README(s), `.context/**`, `plan/**`, and the CLIP semantic-search spec/plan added this session. Each load-bearing doc claim checked against actual code (file+line). Repo: `/Users/hletrd/flash-shared/gallery`, branch `master`.

**Fresh-scrutiny target:** CLIP semantic-search docs (US-P51 → production) landed this session across ~20 commits (`15ecc1a2` spec → `158541b6` smoke). The feature is intentionally **DARK** (`semantic_search_mode` default `'disabled'`). I treated "not live / dark / stub" wording as CORRECT and only flagged docs that **misstate** the feature state or give **non-functional** operational commands. I did **not** propose activating anything.

---

## HARD-GUARD COMPLIANCE
CLIP is intentionally dark. Verified `gallery-config-shared.ts:108 semantic_search_mode: 'disabled'` is the default, and the route fails closed to 503 (`route.ts:227-234`). No finding below proposes enabling the feature. The honesty gate (production serves only rows matching `PRODUCTION_MODEL_VERSION`; stub rows never served as production) is correctly implemented and correctly described in the route docstring and spec §7.

---

## FINDINGS

### DOC-DS-01 — CLAUDE.md CLIP seed runbook calls a script that does not exist (operator-breaking)
- **Severity:** HIGH · **Confidence:** High
- **Doc location:** `CLAUDE.md:479` (and the bold heading just above it, line 467 "After seeding, run a `--production` backfill")
  ```
  sh -c "npx --yes tsx@4.21.0 scripts/backfill-embeddings.ts --production"
  ```
- **Contradicting code:** No `scripts/backfill-embeddings.ts` exists. The real script is `apps/web/scripts/backfill-clip-embeddings.ts` (verified: `ls scripts/` lists `backfill-clip-embeddings.ts`; `find` for `backfill-embeddings.ts` returns nothing). That script's own header (`backfill-clip-embeddings.ts:21`) shows the canonical command: `... scripts/backfill-clip-embeddings.ts --production`.
- **What's wrong:** An operator who copy-pastes the CLAUDE.md seed procedure to enable semantic search in production hits `Error: Cannot find module '.../scripts/backfill-embeddings.ts'`. The `--production` flag IS real (`backfill-clip-embeddings.ts:73 PRODUCTION_FLAG = process.argv.includes('--production')`), so only the filename is wrong.
- **Corrected text:** Replace `scripts/backfill-embeddings.ts --production` with `scripts/backfill-clip-embeddings.ts --production` at `CLAUDE.md:479`.

### DOC-DS-02 — Schema table doc still labels CLIP "stub" though the production encoder shipped this session
- **Severity:** MEDIUM · **Confidence:** High
- **Doc location:** `CLAUDE.md:121`
  ```
  - `image_embeddings` - CLIP embeddings (US-P51, stub)
  ```
- **Contradicting code:** Production encoder now exists and is wired:
  - `apps/web/src/lib/clip-model.ts` — lazy-singleton real encoder (`embedTextReal` / `embedImageReal`) on `@huggingface/transformers` v3, model `jinaai/jina-clip-v2`, Matryoshka-512.
  - `apps/web/src/lib/clip-embeddings.ts:85 PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8'`, `:103 PRODUCTION_COSINE_THRESHOLD = 0.22`.
  - `apps/web/src/lib/gallery-config-shared.ts:170` validator now accepts `'production'`.
  - `apps/web/src/app/api/search/semantic/route.ts:234-248` serves real CLIP results filtered to `PRODUCTION_MODEL_VERSION`.
- **What's wrong:** "stub" alone now **understates** the feature — production code is present and storable. (It is still DARK by default, which is correct and must be preserved in the wording — do NOT imply it is live.)
- **Corrected text:** e.g. `- `image_embeddings` - CLIP embeddings (US-P51). Real multilingual encoder (jinaai/jina-clip-v2, Matryoshka-512, model_version 'jina-clip-v2-d512-q8') shipped; feature is **dark by default** (`semantic_search_mode='disabled'`). 'stub' mode (deterministic SHA-256 vectors, model_version 'stub-sha256-v1') remains for demos. See "CLIP semantic search" runbook.` Note: the table at `schema.ts:262` comment ("stub: 'stub-sha256-v1'") is fine as a *historical/stub-mode* note, but pairing CLAUDE.md's one-liner with a pointer to the runbook removes the understatement.

### DOC-DS-03 — `clip-inference.ts` header docstring describes all-deferred state; all three TODO preconditions are now DONE
- **Severity:** LOW · **Confidence:** High
- **Doc location:** `apps/web/src/lib/clip-inference.ts:4-13` (file header)
  ```
   * STUB IMPLEMENTATION: Real ONNX inference is deferred because:
   * TODO(US-P51): Replace stubs with real ONNX inference once:
   *   - `onnxruntime-node` is added as a dependency
   *   - CLIP ViT-B/32 ONNX weights are downloaded to data/models/clip/
   *   - scripts/download-clip-models.ts downloads the model files
  ```
- **Contradicting code:** All three preconditions are satisfied this session:
  - `onnxruntime-node` ships transitively via `@huggingface/transformers ^3.8.1` (`package.json:29`); CLAUDE.md:482 documents exactly why no explicit dep line is needed.
  - `scripts/download-clip-models.ts` exists and downloads weights.
  - Real inference lives in `clip-model.ts` (not "ViT-B/32" — the shipped model is `jina-clip-v2`).
- **What's wrong:** The stub *functions* legitimately remain for `stub` mode, so the file is not dead — but its header narrates a pre-production world that no longer exists, and names the wrong model family (ViT-B/32 vs jina-clip-v2). Misleads the next reader about feature state.
- **Corrected text:** Reword the header to: "Stub encoder for `semantic_search_mode='stub'` (deterministic SHA-256 vectors for demos/tests). The real production encoder is `clip-model.ts` (jina-clip-v2, Matryoshka-512); these stubs are retained only for stub mode." Drop the "deferred / TODO" block and the "ViT-B/32" reference.

### DOC-DS-04 — Stale in-function comment in the semantic route contradicts the live production gate
- **Severity:** LOW · **Confidence:** High
- **Doc location:** `apps/web/src/app/api/search/semantic/route.ts:189-192`
  ```
  // CRT-R5C1-01: Capability gate — only 'stub' mode is the current encoder.
  // Any non-'stub' value (incl. a legacy 'production' string that healed to
  // 'disabled' in getGalleryConfig, or any stale DB value) yields a 503
  ```
- **Contradicting code:** 35 lines below, the gate accepts BOTH modes: `route.ts:227 if (semanticMode !== 'stub' && semanticMode !== 'production')` and `:234 const isProd = semanticMode === 'production'`. The file's own top-of-file docstring (`:22-24`) and the in-flow comment (`:217-219`) already describe the correct dual-mode behavior.
- **What's wrong:** This single block is a fossil from the pre-production capability gate and now directly contradicts the security-relevant gate it sits on top of. Conflicting comments on an auth/capability gate are a real hazard for the next editor.
- **Corrected text:** Replace lines 189-192 with: "Capability gate (CRT-R5C1-01, widened in Task 5/6): `stub` and `production` serve; `disabled` and any other/stale value yield 503. `production` additionally filters the scan to `PRODUCTION_MODEL_VERSION` so stub rows are never served as production."

---

## VERIFIED-ACCURATE (checked, NOT defects)

CLIP-specific:
- **Dockerfile → CLAUDE.md cross-ref is valid.** `Dockerfile:89` ("See 'CLIP semantic search' ops note in CLAUDE.md") resolves to the real section at `CLAUDE.md:444`. ✓
- **`CLAUDE.md:464` `download-clip-models.ts`** matches the real file. ✓
- **Model id / revision / dim / quant:** `clip-model-id.ts` (`jinaai/jina-clip-v2`, pinned rev `e10d47f5…`), `clip-embeddings.ts:7 EMBEDDING_DIM = 512` (Matryoshka truncation of native 1024), `clip-model.ts` `dtype:'q8'` — all consistent with spec §2 and the Task-1 spike result. ✓
- **onnxruntime-node transitivity claim (`CLAUDE.md:482`)** is accurate: it is NOT a direct dependency (`package.json` has no `onnxruntime` line), it arrives via `@huggingface/transformers`. The doc correctly explains the CPU `.node` binding ships in the tarball. ✓ (Note: spec §8 / commit `2c26e075` phrase "add onnxruntime-node to the web image" is loosely worded vs the as-built "transitive, no Dockerfile change," but the authoritative CLAUDE.md gets it right.)
- **Honesty gate / 503 / model_version filter** (spec §7) matches `route.ts:227-248`. ✓
- **Config states** `disabled|stub|production` (`gallery-config.ts:68`, `gallery-config-shared.ts:170`) match docs. ✓
- **Weights-on-volume, not in image** (`Dockerfile:86-90,105-107` create only the mount point `/app/data/models/clip`; `clip-model.ts` reads `CLIP_MODELS_ROOT`; compose `./data:/app/data` bind mount) — matches spec §2/§8. ✓

General load-bearing claims:
- `IMAGE_PIPELINE_VERSION = 7` — `gallery-config-shared.ts:21`. ✓ (CLAUDE.md re-exports via `process-image.ts:303`.)
- **`COLOR_IMPACTING_KEYS` count = 9, NOT 5.** CLAUDE.md:263 already says "all **9**" and explicitly notes "AGG-R7-08 corrected the count from a stale '5'." `settings-hash.ts:37-49` has exactly 9 keys. The task prompt's "count=5" hint was the stale value; the doc is **correct**. ✓
- **Advisory-lock names** — every name in CLAUDE.md (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`) is present in `src/`. ✓
- **`avif_effort` default = 6** — `gallery-config-shared.ts:128`. ✓
- **QUEUE_CONCURRENCY default 1** — `image-queue.ts:167`. ✓
- **SCAN_ROOTS** = `components/` + `app/[locale]/admin/` (+ public route group per AGG-C8-02) — `touch-target-audit.test.ts:43-54`. ✓
- **Entitlements warning** (CLAUDE.md: `async_payment_succeeded` not yet handled; plan-316 CRT-R5C1-04) — accurate: `stripe/webhook/route.ts:88` handles `checkout.session.completed` only; `:99` flags `async_payment_succeeded` as a TODO; `plan/plan-316-run5-cycle1-low-docs.md` exists. ✓
- **Migration runbook** — untouched by CLIP work (zero schema migration per spec §2: `image_embeddings` already existed via migration 0012). No new journal entry required; runbook remains valid. ✓

## PRIOR FINDINGS — re-confirmed, NOT double-counted
- **`.context/plans/` gitignore (prior DOC8-01) + AGENTS.md:40:** `.gitignore:19-21` = `.context/*` then re-include `!.context/reviews/`. So `.context/plans/` IS gitignored and `.context/reviews/` IS committed. AGENTS.md:40 ("`.context/plans/` is gitignored — local plan-management artifacts only; `.context/reviews/` … committed") is **accurate**. Re-confirmed per prior cycles; recorded, not a new defect.

---

## AGGREGATOR SUMMARY (severity · confidence)
- **DOC-DS-01 [HIGH · High]** CLAUDE.md:479 seed runbook calls non-existent `backfill-embeddings.ts`; real file is `backfill-clip-embeddings.ts` → operator copy-paste fails with module-not-found.
- **DOC-DS-02 [MEDIUM · High]** CLAUDE.md:121 schema line "CLIP embeddings (US-P51, stub)" understates the now-shipped production encoder (keep "dark by default" wording; do not imply live).
- **DOC-DS-03 [LOW · High]** `clip-inference.ts:4-13` header still says real inference is deferred / names ViT-B/32; all TODO preconditions are done and the shipped model is jina-clip-v2 (real encoder is `clip-model.ts`).
- **DOC-DS-04 [LOW · High]** `semantic/route.ts:189-192` stale comment ("only 'stub' is the current encoder … yields 503") contradicts the live dual-mode gate 35 lines below.
- **Verified accurate (no action):** Dockerfile↔CLAUDE.md cross-ref, model id/dim/quant/revision, onnxruntime transitivity, honesty gate, COLOR_IMPACTING_KEYS=9 (prompt's "5" was stale), IMAGE_PIPELINE_VERSION=7, advisory locks, avif_effort=6, QUEUE_CONCURRENCY=1, SCAN_ROOTS, entitlements warning, migration runbook.
- **Prior, re-confirmed (no double-count):** `.context/plans` gitignore nuance + AGENTS.md plans/reviews claim — accurate.
- **Hard guard:** honored — CLIP is correctly dark; no finding proposes activation.
