# Plan 348 — Run-6 Cycle-1 (orchestrator cycle 1/100) — Scheduled Fixes

**Date:** 2026-06-16
**Source:** `.context/reviews/_aggregate.md` (cycle-1 deep review, 11/11 agents) + per-agent files.
**HEAD at planning:** `158541b6`.
**Theme:** "perfect the system" — fresh scrutiny on the newly-shipped CLIP semantic-search surface.

**HARD GUARD (non-negotiable):** The CLIP feature is intentionally DARK (`semantic_search_mode` default `'disabled'`). No task here flips the mode to `'production'`, runs `backfill --production`, downloads model weights to any host, or otherwise activates the live feature. Every fix is a code/test/doc correction that leaves the feature dark. `npm run deploy` ships code only and does not activate.

**Repo policy reminders (apply to every commit here):** GPG-sign (`-S`), NO `Co-Authored-By`, conventional-commit + gitmoji, `git pull --rebase` before push, fine-grained one-commit-per-fix, push after each commit, run `npm run typecheck --workspace=apps/web` before committing test changes, no suppressions unless repo rules authorize (quote rule in body).

---

## SCHEDULED THIS CYCLE

### TASK-1 — [CRITICAL/latent] Fix the MEDIUMBLOB embedding read so it does not drop every row (AGG-C10-01)
**Severity:** CRITICAL when enabled · latent today (feature dark). **Confidence:** High (orchestrator-proven against `mysql2@3.22.0` source + empirical Node repro).

**Root cause (verified):** `image_embeddings.embedding` is physically `MEDIUMBLOB` (`drizzle/0012`, `schema.ts:268` is typed `text()` for the ORM but the column is binary). `mysql2@3.22.0/lib/parsers/text_parser.js:72-73` returns a **Buffer** for binary-charset (63) columns. The read sites do `Buffer.from(row.embedding as string, 'base64')` — for **Buffer** input the `'base64'` encoding is **ignored** (verbatim copy), so a 2048-byte float32 vector stored as a 2732-char base64 string comes back as a 2732-byte Buffer, the `buf.length !== EMBEDDING_BYTES (2048)` guard rejects it, and **every row is silently filtered out** → semantic search `[]`, similar-photos 404 in all cases once enabled.

**Read sites:** `apps/web/src/app/api/search/semantic/route.ts:267`; `apps/web/src/app/api/search/similar/[id]/route.ts:127,157`.
**Write sites:** `apps/web/src/lib/image-queue.ts:452-462`; `apps/web/scripts/backfill-clip-embeddings.ts:159-172`.

**Chosen fix (raw-bytes, eliminates the base64 round-trip entirely — preferred by code-reviewer + perf-reviewer + architect):**
1. WRITE: store the raw `Buffer` (drop `.toString('base64')`). mysql2 inserts a Buffer into a blob verbatim. Update `image-queue.ts` and `backfill-clip-embeddings.ts` to insert `embeddingToBuffer(embedding)` directly (no base64).
2. READ: `row.embedding` is a Buffer of exactly 2048 bytes. Replace `Buffer.from(row.embedding as string, 'base64')` with a Buffer-aware path: `const buf = Buffer.isBuffer(row.embedding) ? row.embedding : Buffer.from(row.embedding as string, 'base64')` (the fallback keeps any legacy base64 rows readable), then the existing `buf.length === EMBEDDING_BYTES` guard + `bufferToEmbedding`.
3. Fix the Drizzle column type drift: keep `text()` only if mysql2 returns Buffer regardless (it does for blob) — but add a code comment at `schema.ts:268` documenting that the physical column is `mediumblob` and the value is a **Buffer at runtime**, not a string, so the `as string` casts are removed/replaced by the Buffer-aware read.
4. Decide legacy-row handling: since the feature is dark and no real production rows exist, the only rows in any DB are stub rows. Document in the commit body that the raw-bytes switch is a clean cutover (stub backfill re-writes rows at `--force`); the Buffer-aware read fallback covers any base64 stragglers without a migration.

**Verification (TASK-6 covers the test):** add a real round-trip unit/integration test that writes via the production write path and reads via the production read path through an actual decode (mocked mysql2 row returning a Buffer), asserting a non-empty, length-2048, unit-norm vector survives. This is the test that would have caught the bug.

**Acceptance:** typecheck + lint + vitest green; new round-trip test RED before the fix, GREEN after; feature remains dark.

---

### TASK-2 — [HIGH] Re-darken the config layer so `'production'` truly heals to `'disabled'`, and make the UI/i18n/comments honest (AGG-C10-02)
**Severity:** HIGH (correctness/honesty + admin misinformation). **Confidence:** High.

**Decision (honors the dark-by-design + deferred-by-user-choice guard):** Option (a) — re-darken at the config layer. The orchestrator chose this over "finish the production UI" because the user has explicitly DEFERRED activation; making production one-click-selectable in the admin UI would contradict that. Re-darkening makes the documented invariant (`settings-client.tsx` comments + i18n) TRUE again and keeps the only activation path the operator sidecar / direct DB edit.

1. `apps/web/src/lib/gallery-config.ts:128-135` resolver: heal `'production' → 'disabled'`. Concretely, treat `'production'` as not-a-UI-selectable value: when the stored raw is `'production'`, resolve to `'disabled'` (so the runtime serves nothing) UNLESS an explicit operator escape hatch is set. To keep the operator sidecar path working (backfill `--production` + the documented DB activation), gate the pass-through behind an env opt-in `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (default off). When the env is unset (normal deploy), `'production'` heals to `'disabled'` — matching the UI's claim. When an operator deliberately sets the env AND the DB row, production serves. This makes the dark default honest at the config layer while preserving a deliberate, non-UI activation path.
   - NOTE: if the team prefers the simpler "always heal production→disabled, operator must change code/DB to activate", that is also acceptable and even safer; document whichever is chosen in the commit body. Default recommendation: the env-gated pass-through, because it keeps the existing `semantic-route-production.test.ts` / `gallery-config-semantic-production.test.ts` meaningful (run them with the env set).
2. `apps/web/src/lib/gallery-config-shared.ts:170` validator: keep `'production'` a *type-valid* stored value (so a legacy/operator row doesn't get nuked), but the resolver (step 1) is the gate. Update the comment at `:167` to describe the env-gated reality, not "now storable" implying UI-selectable.
3. Update stale i18n in BOTH `messages/en.json` AND `messages/ko.json` (key parity required): `semanticSearchDesc` (:726), `semanticSearchEnabledHint` (:728), `semanticSearchProductionWarning` (:732) — describe the true state: stub is the UI-selectable real-but-not-meaningful encoder; production is an operator-only mode requiring the env flag + backfill; drop "real ONNX inference is a future feature" (it shipped). Keep ko as a single fixed form per the documented i18n plural convention (no ICU `plural` block).
4. Fix `settings-client.tsx:655,664-668` comments to match the resolved reality (production heals to disabled unless the operator env flag is set; no UI item by design).
5. Update the existing production-mode tests to set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (or equivalent) so they still exercise the served path; add a test that WITHOUT the env, a stored `'production'` resolves to `'disabled'` and both routes 503.

**Acceptance:** with no env flag, `semantic_search_mode='production'` resolves to `'disabled'` and routes 503; UI/i18n no longer contradict the config; key parity en↔ko holds; typecheck/lint/vitest green; feature dark by default.

---

### TASK-3 — [HIGH] Externalize `@huggingface/transformers` + lazy-import the encoder so the native runtime is off the boot/upload graph (AGG-C10-03)
**Severity:** HIGH (standalone-build correctness; bites the NEXT clean build/deploy). **Confidence:** High.

1. `apps/web/next.config.ts:45`: add `'@huggingface/transformers'` (and `'onnxruntime-node'`) to `serverExternalPackages` alongside `'drizzle-orm'`, `'sharp'`. Native-addon packages must not be webpack-traced into the standalone server bundle.
2. `apps/web/src/lib/clip-model.ts:19`: convert the top-level `import { env, AutoModel, AutoTokenizer, Tensor } from '@huggingface/transformers'` to a lazy `await import('@huggingface/transformers')` inside `getModelBundle()` (the lazy-singleton loader), so `instrumentation.ts → image-queue → clip-model` no longer drags onnxruntime into every request path; the native runtime resolves only when the dark feature is actually switched on.
3. Verify `image-queue.ts:23`'s `import { embedImageReal } from '@/lib/clip-model'` no longer transitively pulls transformers at module-eval time (it won't, once the transformers import is inside the function). Keep `embedImageReal`/`embedTextReal` exported; only the heavy import moves inside the function body.
4. Confirm `npm run build` still produces the standalone output cleanly and `npm run typecheck` passes (dynamic import returns a typed module).

**Acceptance:** typecheck/lint/build green; `serverExternalPackages` includes transformers + onnxruntime-node; clip-model's transformers import is lazy; feature dark.

---

### TASK-4 — [MEDIUM] Gate the SimilarPhotos toggle on production mode + fix its loading a11y/CLS (AGG-C10-07)
**Severity:** MEDIUM (dead control + CLS + WCAG 4.1.3). **Confidence:** High (designer live-measured).

1. `apps/web/src/components/similar-photos.tsx`: accept a `semanticSearchMode` prop (plumbed down from `photo-viewer.tsx`, the same way `search.tsx` already receives the mode). Render the "Similar photos" toggle ONLY when `semanticSearchMode === 'production'`; otherwise render nothing (no dead 503-ing control, no layout shift). After TASK-2 the default is `'disabled'`, so the toggle is correctly absent in all normal deploys — matching the dark feature.
2. Give the loading state `role="status"` + `aria-live="polite"` + an accessible name (reuse the existing `common.loading` key), mirroring `search.tsx`'s live-region pattern, so screen-reader users are informed and reduced-motion users see a static-but-labelled state.
3. Ensure no CLS: if the panel can appear/disappear, reserve space or animate height; verify the EXIF section below does not jump (designer measured a 60 px shift on the 503 removal — gating the control out removes the trigger entirely).

**Acceptance:** with mode `disabled`/`stub` the toggle is absent (no 503, no CLS); loading state has a live region + accessible name; typecheck/lint/vitest green; touch targets ≥44 px preserved.

---

### TASK-5 — [LOW] Verify-before-load in the model downloader (AGG-C10-10)
**Severity:** LOW (CWE-494/367; operator-only one-time script). **Confidence:** High.

`apps/web/scripts/download-clip-models.ts:97-130`: on the fresh-download path, verify the on-disk artifact SHA-256 against the manifest BEFORE instantiating the ONNX session; on mismatch, delete the poisoned file and `exit(1)`. The idempotent path already verifies-before-load; make the fresh path match. Add a note to the script header that it should be run from a trusted network.

**Acceptance:** the fresh-download path verifies before any `from_pretrained`/session instantiation; mismatch deletes + aborts; covered by TASK-6 hash-mismatch test.

---

### TASK-6 — [MEDIUM] Close the highest-value CLIP test gaps (AGG-C10-06)
**Severity:** MEDIUM (the gap that let CRITICAL AGG-C10-01 ship). **Confidence:** High.
All tests are stub-mode / mocked — NONE flip the dark flag or require real weights.

1. **Embedding DB round-trip test (closes AGG-C10-01 regression):** write via the production write path (`embeddingToBuffer` → insert), simulate mysql2 returning a **Buffer** for the blob, read via the production read path, assert a length-2048 unit-norm vector survives and cosine(self,self)≈1. Must be RED against the pre-TASK-1 base64 read, GREEN after.
2. **download-clip-models SHA-256 mismatch test:** prove the mismatch path deletes + `exit(1)` (not just `toContain('createHash')`).
3. **(stage if time) embed-hook write-side `model_version` test:** execute the stub-mode hook and assert the row's `model_version` equals the stub constant (currently only source-grepped).
4. **(stage if time) backfill idempotency / skip-at-target-version test** executed, not source-grepped.

**Acceptance:** new tests added under `apps/web/src/__tests__/`; round-trip + hash-mismatch tests are non-vacuous (RED-on-regression demonstrated); `npm run typecheck` run before committing; vitest green.

---

### TASK-7 — [LOW–MEDIUM] Doc/comment drift cleanup (AGG-C10-08 + AGG-C10-09)
**Severity:** LOW–MEDIUM (operator runbook hard-fails; future-implementer confusion). **Confidence:** High. Doc/comment-only.

1. `CLAUDE.md:479`: correct the seed runbook script path `scripts/backfill-embeddings.ts` → `apps/web/scripts/backfill-clip-embeddings.ts` (AGG-C10-08).
2. `CLAUDE.md:121`: update the `image_embeddings` table label from "(US-P51, stub)" to reflect the real-encoder-shipped-but-dark state (keep the honest "disabled by default" framing).
3. `apps/web/src/app/api/search/semantic/route.ts:9,25,189-192`: fix `PRODUCTION_COSINE_THRESHOLD (0.25)` → `(0.22)` and remove the "only 'stub' is the current encoder / yields 503" claim (serves both modes per resolved gating).
4. `apps/web/src/lib/clip-inference.ts:4-17` + `apps/web/src/lib/caption-generator.ts:1-19`: refresh the "ViT-B/32 / once onnxruntime-node is added" narration to the shipped jina-clip-v2 reality (onnxruntime already transitive).
5. `apps/web/src/lib/clip-embeddings.ts:10`: rename `CLIP_MODEL_VERSION` → `STUB_MODEL_VERSION` (update all importers: `image-queue.ts`, `backfill-clip-embeddings.ts`, tests) for honesty; keep `PRODUCTION_MODEL_VERSION` as-is.
6. Fix the `gallery-config.test.ts:10-12` docstring that asserts the inverse of the test below it.
7. Add a short, accurate CLIP section to `CLAUDE.md` documenting the dark feature's topology (model on disk, env-gated production, model_version partition, backfill path) — so the doc stops omitting a now-large surface.

**Acceptance:** runbook command resolves to a real file; thresholds/comments match constants; rename applied repo-wide with no broken imports; typecheck/lint/vitest green.

---

### TASK-8 — [LOW] Cheap CLIP polish (AGG-C10-11 a/b/c)
**Severity:** LOW. **Confidence:** High/Med.

1. (a) `semantic/route.ts:288-298` enrich SELECT: add `lens_model` and `capture_date` so semantic result cards match keyword-search subtitles (`search.tsx:186-187`). Confirm both are public columns (not in `_PrivacySensitiveKeys`).
2. (b) `similar-photos.tsx:42`: fix the comment (renders 96 px / fetches 640 px derivative, not 48×48).
3. (c) `clip-embeddings.ts` `cosineSimilarity`: add a unit-vector dot-product fast path (vectors are pre-normalized by `truncateAndNormalize`), keeping the general path for safety. Add a unit test asserting the fast path equals the general path on unit vectors.

**Acceptance:** typecheck/lint/vitest green; semantic cards render the richer subtitle; cosine fast-path test passes.

---

## GATE WORK (per QUALITY-GATE FIX REQUIREMENT)
Run the full configured gate set against the WHOLE repo before commit+push of each task and once at the end:
`npm run lint`, `npm run typecheck --workspace=apps/web`, `npx vitest run --no-file-parallelism` (avoids the documented cold-encoder real-encode flake), `npm run lint:api-auth`, `npm run lint:action-origin`, `npm run lint:public-route-rate-limit`. Errors are blocking; fix root cause, no suppressions. Track count in `GATE_FIXES`.

## DEPLOY
DEPLOY_MODE=per-cycle. After all tasks committed+pushed AND every gate green, run `npm run deploy` once (ships code only; does NOT activate CLIP). Record `DEPLOY: per-cycle-success` / `per-cycle-failed:<reason>`.

## NOT SCHEDULED HERE → see plan-349 (deferred)
- AGG-C10-04 (event-loop-blocking inference) — production-only, behind dark flag.
- AGG-C10-05 (embedding index + recall cliff) — production-only.
- AGG-C10-11(d) (request-scoped config in detached hooks) — record-only.
- AGG-C10-R1..R5 (postcss transitive, route dedup, model-reload backoff, prior carried items, test-isolation flake).

## Progress (all DONE — run-6 cycle-1)
- [x] TASK-1 embedding read raw-bytes + decodeEmbeddingColumn + round-trip lock — DONE (`ec50158b`)
- [x] TASK-2 re-darken config (env-gated heal) + honest UI/i18n + config tests — DONE (`8c329b35`)
- [x] TASK-3 externalize @huggingface/transformers + lazy import — DONE (`67f02b8a`)
- [x] TASK-4 gate SimilarPhotos on production + loading live region (a11y/CLS) — DONE (`ac592e93`)
- [x] TASK-5 delete-poisoned-on-mismatch downloader hardening — DONE (`20a18536`)
- [x] TASK-6 round-trip test (`ec50158b`) + hash-mismatch test (`20a18536`) + raw-write wiring assertion (`7bad8477`). Write-side model_version executed-test staged → still source-grep (recorded under DEF / test-engineer F2 in plan-349).
- [x] TASK-7 doc/comment drift (`46c5864e`) + STUB_MODEL_VERSION rename + 3rd raw-bytes write site (`7bad8477`)
- [x] TASK-8 enrich cols + similar-photos comment (`46c5864e`/`ac592e93`); dotProduct fast-path PRIMITIVE landed + unit-tested (`ec50158b`), but the SCAN-LOOP swap was NOT applied — stub embeddings are not L2-normalized, so dotProduct≠cosine for stub rows; swapping would break stub ranking. Scan-loop optimization recorded as production-only deferred (plan-349 DEF-2 area).

**Gates:** ESLint, typecheck (app+scripts), lint:api-auth, lint:action-origin,
lint:public-route-rate-limit all green; full vitest `--no-file-parallelism` =
230 passed / 1 skipped files, 2145 passed / 2 skipped tests, 0 failures.
**Note:** TASK-1 fix extended to a 3rd write site (admin embed action, `actions/embeddings.ts`)
found during TASK-7 — it had the same base64 bug.
