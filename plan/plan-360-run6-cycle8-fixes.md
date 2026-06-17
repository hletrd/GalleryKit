# Plan 360 — Run 6 / Cycle 8 (orchestrator cycle 8/100) — Fixes

**Created:** 2026-06-17
**HEAD at planning:** `1a325fa6` (working tree clean, in sync with origin/master)
**Source:** `.context/reviews/_aggregate.md` (cycle-8 fan-out, 11/11 agents) + per-agent reviews.
**Status:** SCHEDULED FOR IMPLEMENTATION this cycle (PROMPT 3 / ralph).

## Context

Cycle-7 converged at 0 findings at `a7758ef0` — **before** the three CLIP activation commits (`e0da12ee`, `b1d6331c`, `1a325fa6`) that turned semantic search **LIVE in production**. Cycle-8 re-reviewed those commits + the now-live serving paths and surfaced 13 deduped findings (3 HIGH incl. one UX, 5 MEDIUM, 5 LOW, 0 CRITICAL). Several of these are the **re-opening** of items that plan-349/plan-351 deferred under the explicit rule basis "CLIP is deployed DARK / production activation is deferred by user choice" — a basis that the cycle-8 run context **invalidates** (production is now live by explicit user decision). The deferred items' own exit criterion ("RE-OPEN the moment production activation is scheduled") has therefore **fired**.

This plan schedules the **cheap, additive, low-risk** fixes that do NOT require a concurrency-architecture redesign and do NOT risk the live feature. The two architecture-dependent HIGH/MEDIUM items (event-loop offload AGG-C8-01, runtime pre-parse checksum AGG-C8-08) and one LOW (CSP/reload-storm AGG-C8-13) are recorded in **plan-361** (deferred register) with the now-LIVE re-open status preserved at original severity.

**HARD GUARDS (must hold through every task):** do NOT re-add `import 'server-only'` to `clip-model.ts` or `@/db`; keep the `semantic_search_mode: 'disabled'` code default in `gallery-config-shared.ts` (correct for fresh installs; the prod DB row overrides at runtime); do NOT weaken `SEMANTIC_SEARCH_ALLOW_PRODUCTION` / the revision pin / `allowRemoteModels=false` / model_version isolation. After deploy, the live-feature verification curl MUST return HTTP 200 (queries ≥3 codepoints).

**Commit policy:** GPG-signed (`-S`), conventional-commit + gitmoji, no `--no-verify`, `git pull --rebase` before push, fine-grained one-commit-per-fix. Run `npm run typecheck --workspace=apps/web` before committing test changes. Run all GATES before deploy.

---

## TASK-1 [HIGH] — AGG-C8-02: downloader idempotency fast-path must verify the FULL manifest

**File:** `apps/web/scripts/download-clip-models.ts:63-76` (the ONNX-only early-return).
**Problem:** the idempotency fast-path verifies only `onnx/model_quantized.onnx`'s SHA-256, then prints "already up to date" and exits 0. `tokenizer.json` / `tokenizer_config.json` / `config.json` are not re-checked, yet offline `from_pretrained` (`allowRemoteModels=false`) treats them as fatal. A partial seed missing a config file is reported up-to-date across re-runs; the first live query then throws, `loadPromise` nulls, and every subsequent semantic/similar request returns 503 indefinitely.
**Fix:** before the early return, run the existing `verifyAndCleanArtifacts(modelCacheDir, MANIFEST, /*deleteOnMismatch*/ false)` over the FULL manifest. Only short-circuit to "already up to date" when ALL manifest entries verify; otherwise fall through to the (re)download path. Do not change the download path itself or the post-download delete-on-mismatch gate.
**Verification:** new test (TASK-7) + a manual reasoning pass that a dir with valid ONNX + absent tokenizer no longer early-returns.
**Commit:** `fix(search): 🐛 verify full CLIP manifest in downloader idempotency fast-path`

## TASK-2 [MEDIUM] — AGG-C8-03: add `image_embeddings(model_version, updated_at)` index

**Files:** new migration `apps/web/drizzle/00NN_image_embeddings_model_version_idx.sql`; `apps/web/drizzle/meta/_journal.json` (new entry, `when` strictly > current max — use `Date.now()`); `apps/web/scripts/migrate.js` `reconcileLegacySchema` (idempotent `CREATE INDEX IF NOT EXISTS` / guarded `ALTER`); `apps/web/src/db/schema.ts` (add the composite index to the `imageEmbeddings` table definition).
**Problem:** every public semantic/similar query runs `WHERE model_version=? ORDER BY updated_at DESC LIMIT 5000` against a PK-only (`image_id`) table → full scan + filesort. Live and uncacheable; grows unbounded with the library.
**Fix:** add `KEY (model_version, updated_at)`. Follow the CLAUDE.md migration runbook exactly: new SQL file, monotonic `when` in `_journal.json`, `reconcileLegacySchema` mirror, schema.ts update. The migrate.js post-condition asserts every journal hash is applied, so a mis-journaled entry fails the next deploy loud — confirm the new entry passes locally.
**Verification:** `npm run typecheck`; confirm the migrator post-condition logic still passes (the existing migrate test pins journal monotonicity + silent-skip post-condition — keep it green).
**Commit:** `perf(search): ⚡️ add image_embeddings(model_version, updated_at) composite index`

## TASK-3 [HIGH/UX] — AGG-C8-04 + AGG-C8-06: client-side semantic short-query guard + correct i18n minimum

**Files:** `apps/web/src/components/search.tsx` (the semantic branch in `performSearch`, ~line 152-168); `apps/web/messages/en.json` + `apps/web/messages/ko.json` (the `search.*` block, ~line 411).
**Problem (AGG-C8-04):** a 1-2 char query with the semantic toggle on is sent to the API, returns 400, and `search.tsx` maps `!resp.ok → setSearchStatus('error')` → "Search failed. Please try again." — a server-error message for a user-input problem. The keyword path correctly uses `status: 'invalid'`.
**Problem (AGG-C8-06):** the existing `search.invalid` string says "at least 2 characters" but the semantic minimum is 3 codepoints.
**Fix:**
1. In `search.tsx`, before the semantic fetch, add a guard: if `countCodePoints(searchQuery) < 3` (use the same code-point counter the route uses, or `[...searchQuery].length`), `setSearchStatus('invalid'); setResults([]); return;` — mirroring the keyword path. (Confirm the exact min constant from `api/search/semantic/route.ts` and reuse it if exported.)
2. Add a dedicated i18n key `search.invalidSemantic` = "Type at least 3 characters to search." (en) / the ko equivalent ("검색하려면 세 글자 이상 입력하세요.") and route the semantic invalid case to it; leave the keyword `search.invalid` ("2 characters") unchanged so the keyword path stays correct. Keep en/ko key parity.
**Verification:** `npm run typecheck`; reason through that a 2-char semantic query now shows the helpful "3 characters" message, not "Search failed", and a ≥3-char query still fetches.
**Commit:** `fix(search): 🐛 guard short semantic queries client-side with correct min-length message`

## TASK-4 [MEDIUM] — AGG-C8-05: `backfillClipEmbeddings` selection must be model_version-aware

**File:** `apps/web/src/app/actions/embeddings.ts:86-99` (the `notExists` candidate query); `modelVersion` const currently assigned at ~line 103 (after the query).
**Problem:** the `notExists` subquery filters only `imageEmbeddings.imageId`, so an image with a stub-version row is excluded even in production mode — the action can never upgrade stub→production rows. The canonical sidecar `scripts/backfill-clip-embeddings.ts:125-131` correctly adds the `modelVersion` condition. The action is **unwired** today (no UI binds it) → no live impact, but it is a latent correctness gap and a future-wiring trap.
**Fix:** hoist the `const modelVersion = semanticMode === 'production' ? PRODUCTION_MODEL_VERSION : STUB_MODEL_VERSION;` above the candidate query, and add `eq(imageEmbeddings.modelVersion, modelVersion)` to the inner `notExists` WHERE so it matches the sidecar's two-condition selection. Do not change the action's wiring status (leave it unwired).
**Verification:** `npm run typecheck`; new test (TASK-7) asserting an image with a stub row IS selected in production mode.
**Commit:** `fix(search): 🐛 make backfillClipEmbeddings selection model_version-aware`

## TASK-5 [LOW] — AGG-C8-09 + AGG-C8-10: use dotProduct fast-path (production-gated) + add lens/date to similar enrichment

**Files:** `apps/web/src/app/api/search/semantic/route.ts` (~line 269, the scan-loop similarity call); `apps/web/src/app/api/search/similar/[id]/route.ts` (~line 158 scan call, ~line 185-201 enrichment SELECT).
**Problem (AGG-C8-09):** both routes call `cosineSimilarity` (recomputes both L2 norms + 2 sqrts/row) though production vectors are provably unit-length; `clip-embeddings.ts:49-56` ships a tested `dotProduct` fast-path used by neither route. Per plan-349 DEF-6, the swap must be **gated on production mode** because STUB embeddings are NOT L2-normalized — swapping unconditionally would corrupt stub-mode ranking.
**Problem (AGG-C8-10):** the similar route's enrichment SELECT omits `lens_model` + `capture_date` that the semantic route includes (AGG-C10-11a), so similar-result cards rendered with the same component show blank lens/date.
**Fix:**
1. In both scan loops, select `dotProduct` when the active mode is `production` (all stored vectors unit-length) and keep `cosineSimilarity` for `stub`. Add a short comment citing DEF-6 (stub vectors are not normalized). Scores are identical for unit vectors, so production ranking is unchanged.
2. Add `lens_model` and `capture_date` to the similar route's enrichment SELECT to match the semantic route.
**Verification:** `npm run typecheck`; reason that production scores are unchanged (dot product == cosine for unit vectors) and stub still uses cosine.
**Commit:** `perf(search): ⚡️ production-gated dotProduct scan + parity lens/date on similar route` (or split into two commits if cleaner).

## TASK-6 [LOW] — AGG-C8-11 + AGG-C8-12: similar-photos a11y aria-controls + clip-paths model-id guard

**Files:** `apps/web/src/components/similar-photos.tsx` (~line 104-115 button, ~line 117-148 result container); `apps/web/src/lib/clip-paths.ts:77-80` (`clipModelArtifactDir`).
**Problem (AGG-C8-11):** the "Similar photos" disclosure button has `aria-expanded` but no `aria-controls`, and the result container has no `id` — AT users can't navigate from the toggle to the region.
**Problem (AGG-C8-12):** `clipModelArtifactDir` does `JINA_CLIP_MODEL_ID.split('/')` with no segment-count guard; a future bare-name/3-segment model id, or a `JINA_CLIP_REVISION='main'` (transformers uses a FLAT path for `main`), would silently mis-path with no error.
**Fix:**
1. Add `aria-controls="similar-photos-results"` to the disclosure button and `id="similar-photos-results"` to the result `<div>`.
2. In `clipModelArtifactDir` (or the existing `clip-paths.test.ts`), assert the model id splits into exactly 2 non-empty segments and the revision is a 40-hex non-`main` string — throwing/failing loud on violation so a future model upgrade can't silently break the seed→offline-load contract.
**Verification:** `npm run typecheck`; touch-target audit unaffected; `clip-paths.test.ts` green.
**Commit:** `fix(a11y): 🐛 add aria-controls to similar-photos disclosure` + `fix(search): 🐛 assert 2-segment model id + non-main revision in clipModelArtifactDir` (two commits).

## TASK-7 [tests for the above] — lock the new behavior

**Files:** `apps/web/src/__tests__/` (extend `clip-paths.test.ts` and/or add a small test file).
**Add:**
- TE-C8-01: a test that a seed dir with a valid ONNX checksum but an absent `tokenizer.json` is NOT reported "up to date" by the verify helper the downloader uses (`verifyAndCleanArtifacts(dir, MANIFEST, false)`) — locks TASK-1.
- TE-C8-02: a test asserting `backfillClipEmbeddings` (production mode) selects an image that has only a stub-version embedding row — locks TASK-4. (Use the existing DB-test harness pattern; if the action is hard to unit-test in isolation, pin the selection-query shape instead, matching the existing `data-tag-names-sql.test.ts` fixture style.)
- AGG-C8-12: extend `clip-paths.test.ts` to assert the new model-id/revision guard rejects a 1-segment id and a `main` revision — locks TASK-6.2.
**Verification:** `npm test --workspace=apps/web` green; run `npm run typecheck` first (it includes `src/__tests__/`).
**Commit:** `test(search): ✅ pin manifest-full idempotency, model_version backfill selection, model-id guard`

## TASK-8 [MEDIUM/docs] — AGG-C8-07: refresh "deployed DARK" docs + admin i18n to reflect live activation

**Files:** `CLAUDE.md:121`; `apps/web/messages/en.json:727` (`settings.semanticSearchDesc`) + the parallel `ko.json` key.
**Problem:** both still say CLIP is "deployed DARK", which is stale now that the feature is LIVE in production. The code default `disabled` and the operator-only gating clause remain accurate — only the present-tense "dark" framing is wrong.
**Fix:**
- CLAUDE.md line 121: reword to state the encoder is **activated in production** (operator-gated via `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env + the DB `semantic_search_mode=production` row; 445 real `jina-clip-v2-d512-q8` embeddings serving), while keeping the accurate note that the code default remains `disabled` for fresh installs and stub mode uses non-meaningful deterministic vectors. Add a one-line note that the prod `.env.local` must carry `CLIP_MODELS_ROOT` (the absolute bind-mount path) so the seed→offline-load contract holds.
- en.json/ko.json `semanticSearchDesc`: reword from "deployed dark" to describe the gating mechanism ("production semantic search requires the server-side `SEMANTIC_SEARCH_ALLOW_PRODUCTION` opt-in"). Keep en/ko key parity.
**Verification:** i18n key-parity check (part of the test suite) green; no code behavior change.
**Commit:** `docs(search): 📝 reflect live CLIP production activation in CLAUDE.md + admin i18n`

---

## Sequencing for ralph
1. TASK-1 (downloader fast-path) — operator-side, isolated.
2. TASK-4 (backfill model_version) — one-line query fix.
3. TASK-3 (client short-query guard + i18n) — client + i18n.
4. TASK-5 (dotProduct gate + similar enrichment) — route scan loops.
5. TASK-6 (a11y + model-id guard).
6. TASK-2 (index migration) — most care (journal monotonicity + reconcileLegacySchema).
7. TASK-7 (tests) — lock TASK-1/4/6.
8. TASK-8 (docs) — last.

Run the full GATES suite after the code tasks and before deploy. Each task is its own GPG-signed commit; push fine-grained.

## Progress
- [x] TASK-1 — downloader full-manifest idempotency verify (commit 17f6e37c)
- [x] TASK-2 — image_embeddings(model_version, updated_at) index migration 0022 (commit bbd311c5)
- [x] TASK-3 — client semantic short-query guard + search.invalidSemantic i18n (commit 30030866)
- [x] TASK-4 — backfillClipEmbeddings model_version-aware selection (commit e9895589)
- [x] TASK-5 — production-gated dotProduct scan + similar-route lens/date parity (commit f29cbda7)
- [x] TASK-6 — similar-photos aria-controls + clipModelArtifactDir model-id/revision guard (commit 062fadbe)
- [x] TASK-7 — tests: full-manifest idempotency wiring + backfill model_version selection + model-id guard (commits 0655ed7b, 062fadbe)
- [x] TASK-8 — docs: CLAUDE.md + admin i18n reflect live CLIP activation (commit e5fe98f3)

**ALL TASKS COMPLETE.** 8 fine-grained GPG-signed commits. Gates run inline next; deploy after green. This plan moves to plan/done/ after the deploy step.
