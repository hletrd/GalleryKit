# Aggregate Review — Run-6 Cycle-8 (HEAD `1a325fa6`)

**Date:** 2026-06-17
**Agents fanned out (11/11 returned + persisted):** security-reviewer, code-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.
**Gate state (verifier, fresh run):** Vitest **2207 passed / 4 skipped / 0 failed**; typecheck exit 0; eslint exit 0; lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0. The 4 skipped are the model-weight-gated `clip-offline-load` + `clip-semantic-integration` suites (gated by design).

## Context

The codebase converged at cycle-7 (0 findings) at `a7758ef0` — but that was **before** the three CLIP activation commits (`e0da12ee`, `b1d6331c`, `1a325fa6`) that turned semantic search LIVE in production. This cycle re-reviewed those commits + the now-live serving paths with fresh scrutiny. The seed→offline-load plumbing, the same-origin/rate-limit/validation guard chains, the `server-only` removal (boundary-test-backed), the singleton-nulls-on-failure retry, and `model_version` isolation are all **verified clean** by multiple agents. The findings below are the activation's *latent* gaps — almost all were explicitly **deferred** in plan-349 / plan-351 with the exit criterion "RE-OPEN the moment production CLIP activation is scheduled," which has now fired.

All HARD GUARDS were respected by every agent: no `import 'server-only'` re-added to `clip-model.ts` or `@/db`; the `semantic_search_mode: 'disabled'` code default left intact (correct for fresh installs; prod DB overrides at runtime); no weakening of `SEMANTIC_SEARCH_ALLOW_PRODUCTION` / the revision pin / `allowRemoteModels=false` / model_version isolation.

---

## Merged findings (deduped; highest severity/confidence preserved)

### AGG-C8-01 [HIGH] — Synchronous CLIP inference + cosine scan on the main event loop
**Agents:** critic (CRT-C8-01). Corroborated by perf (the scan path) + tracer (guard chain bounds blast radius).
**Where:** `apps/web/src/lib/clip-model.ts` (`onnxruntime-node` inference) + `apps/web/src/app/api/search/semantic/route.ts` & `similar/[id]/route.ts` (the ≤5000-row cosine scan), all on the request thread; no worker / yield.
**Problem:** on the documented **single-web-instance / single-writer** topology, a single semantic query runs synchronous ONNX text-embedding then a 5000-row similarity scan on the Node main thread, blocking every concurrent request for the duration. plan-349 DEF-1 states in capitals that production MUST NOT be enabled on this topology until inference is moved off the main thread — activation shipped ahead of that.
**Why not CRITICAL:** the `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env + DB-row double-gate bounds reachability to this operator-opted-in deployment, and `onnxruntime-node`'s `session.run` is actually async-offloaded (perf-reviewer verified `await model(...)` does NOT block) — so the residual main-thread cost is the JS cosine loop + tensor pre/post, not the full inference. Real, but the worst-case "freeze the whole site" is mitigated by the async ONNX backend.
**Fix:** move the per-request scan (and ideally the embedding call) off the request thread (worker_threads / a small queue), OR cap scan size far below 5000 until then. Pair with AGG-C8-03.
**Repo-policy note:** correctness/availability finding on a LIVE path — schedule or formally defer with a quoted rule; do not silently drop.

### AGG-C8-02 [HIGH] — Downloader idempotency fast-path green-lights a partial seed → runtime 503 storm
**Agents:** debugger (HIGH), critic (CRT-C8-02), code-reviewer (LOW-1), test-engineer (TE-C8-01). **Strong 4-agent agreement.**
**Where:** `apps/web/scripts/download-clip-models.ts:63-76` (idempotency early-return) + `scripts/clip-model-manifest.ts`.
**Problem:** the fast-path verifies only `onnx/model_quantized.onnx`'s SHA-256 before printing "already up to date" and exiting 0. `tokenizer.json` / `tokenizer_config.json` / `config.json` are NOT re-checked, yet the offline `from_pretrained` (`allowRemoteModels=false`) treats them as **fatal**. A partial/corrupt seed missing a config file is reported up-to-date across re-runs; the first live query then throws, `loadPromise` nulls, and every subsequent semantic/similar request returns 503 indefinitely — defeating the purpose of the integrity gate.
**Fix:** replace the ONNX-only early-return with a call to the existing `verifyAndCleanArtifacts(modelCacheDir, MANIFEST, deleteOnMismatch=false)` over the FULL manifest before the early return, so all required artifacts are checked. Add the partial-seed Vitest (TE-C8-01).
**Severity reconciliation:** debugger/critic rate HIGH (operational blast radius); code-reviewer rated LOW (operator-only seed path). Preserved as **HIGH** per highest-severity rule — a wedged production search is high-impact even if the trigger is operator-side.

### AGG-C8-03 [MEDIUM] — `image_embeddings` lacks a `(model_version, updated_at)` index → full-table scan + filesort per query
**Agents:** perf (PERF-C8-01), critic (CRT-C8-03). 2-agent agreement.
**Where:** schema `drizzle/0012_image_embeddings.sql:5-12` (PK-only on `image_id`); query sites `semantic/route.ts:~250-255`, `similar/[id]/route.ts:~142-147` (`WHERE model_version=? ORDER BY updated_at DESC LIMIT 5000`).
**Problem:** every public semantic/similar query does a full scan + filesort of `image_embeddings`. Sub-ms at 445 rows today, but these are uncacheable interactive endpoints and the table grows unbounded with the library — a future per-search scan cliff, plus the silent 5000-row recall ceiling (DEF-2).
**Fix:** one additive migration adding a composite index `(model_version, updated_at)`. Cheap, risk-free, worth landing while the table is small.

### AGG-C8-04 [HIGH/UX] — Short semantic query renders misleading "Search failed. Please try again."
**Agents:** designer (Finding 1).
**Where:** `apps/web/src/components/search.tsx:~160-168` (semantic branch, no client-side length guard) + `api/search/semantic/route.ts:~184` (rejects <3 code points with 400).
**Problem:** with the semantic toggle on, a 1- or 2-char query is sent to the API, returns 400, and `search.tsx` maps `!resp.ok` → `setSearchStatus('error')` → "Search failed. Please try again." — a server-error message for a user-input problem. The keyword path correctly uses `status: 'invalid'` with a helpful message.
**Fix:** add a `countCodePoints(query) < 3 → setSearchStatus('invalid'); return` guard before the semantic fetch (mirror the keyword path). Couple with AGG-C8-06 so the message states the right minimum.

### AGG-C8-05 [MEDIUM] — `backfillClipEmbeddings` selection omits `model_version` (cannot upgrade stub→production rows)
**Agents:** tracer (M1), debugger, architect (L1), security (informational), test-engineer (TE-C8-02). **5-agent agreement** on the gap; all agree it is currently **UNWIRED** (no UI binds it) → no live impact today.
**Where:** `apps/web/src/app/actions/embeddings.ts:86-99` — the `notExists` subquery filters only `imageEmbeddings.imageId`. The canonical sidecar `scripts/backfill-clip-embeddings.ts:125-131` correctly adds the `modelVersion` condition.
**Problem:** an image with a stub-version embedding row is excluded even in production mode, so this action can never upgrade stub→production rows. If a future cycle surfaces it to an admin button, it would report `processed: 0` with no error and no failing test.
**Fix:** add `eq(imageEmbeddings.modelVersion, modelVersion)` to the inner `notExists` WHERE; hoist the `modelVersion` const above the query (currently assigned after it). Add TE-C8-02 selection test. Severity preserved MEDIUM (latent correctness on a dead path).

### AGG-C8-06 [MEDIUM] — i18n "Type at least 2 characters" contradicts the 3-codepoint semantic minimum
**Agents:** designer (Finding 2), document-specialist (DOC-C8-03). 2-agent agreement.
**Where:** `apps/web/messages/en.json:411` ("at least 2 characters"), `ko.json:411` ("두 글자 이상").
**Problem:** the semantic minimum is 3 codepoints; if the AGG-C8-04 fix routes the short-query case through the existing `invalid` status, the message tells the user "at least 2" while a 2-char semantic query still fails.
**Fix:** add a dedicated `search.invalidSemantic` ("at least 3 characters") key and route the semantic branch to it (preferred), OR align the minimums. Update both en + ko; keep key parity.

### AGG-C8-07 [MEDIUM] — CLAUDE.md + admin settings i18n still say CLIP is "deployed DARK"
**Agents:** document-specialist (DOC-C8-01, DOC-C8-02).
**Where:** `CLAUDE.md:121` ("deployed DARK"); `apps/web/messages/en.json:727` `settings.semanticSearchDesc` ("The real CLIP encoder is deployed dark…") + the parallel `ko.json` key.
**Problem:** the feature is LIVE in production; "deployed dark" is stale present-tense framing. A maintainer could assume the live route is inert; an admin is told production search is dark when it is in fact serving. (The *code default* `disabled` and the "operator-only" gating clause remain accurate — only the "dark" framing is wrong.)
**Fix:** reword to describe the gating *mechanism* (operator opt-in via `SEMANTIC_SEARCH_ALLOW_PRODUCTION` + the DB `production` row) instead of asserting the feature is dark; keep the fresh-install `disabled` default note.

### AGG-C8-08 [MEDIUM] — Runtime loader trusts on-disk ONNX with no pre-parse checksum
**Agents:** critic (CRT-C8-04). Re-open of plan-349 DEF-18.
**Where:** `apps/web/src/lib/clip-model.ts` `from_pretrained` load — no SHA verification before the ONNX session is instantiated from the bind-mount file.
**Problem:** the checksum gate lives only in the *download* script (post-download, delete-on-mismatch). At runtime the loader trusts whatever is on the volume; a tampered/corrupted weight on the mount is parsed without an integrity check. Primary protections (immutable revision pin + HTTPS at download + `allowRemoteModels=false`) remain, so this is defense-in-depth, not an open RCE.
**Fix:** optionally verify the manifest SHA at first load before `from_pretrained` (the manifest + `sha256File` helper already exist), or document the mount as a trust boundary. Schedule or formally defer.

### AGG-C8-09 [LOW] — Both routes use `cosineSimilarity` instead of the shipped `dotProduct` unit-vector fast-path
**Agents:** perf (PERF-C8-02).
**Where:** `semantic/route.ts:~269`, `similar/[id]/route.ts:~158` call `cosineSimilarity` (recomputes both L2 norms + 2 sqrts/row) though every stored vector is provably unit-length; `clip-embeddings.ts:49-56` ships a tested `dotProduct` fast-path authored for exactly this scan and used by neither route.
**Problem:** ~5.1M redundant float ops + 10k sqrts per request at the 5000-row cap. Score-identical for unit vectors.
**Fix:** swap both call sites to `dotProduct`. Zero score change, additive, risk-free.

### AGG-C8-10 [LOW] — similar route enrichment SELECT omits `lens_model` + `capture_date`
**Agents:** tracer (L1). Adjacent to designer Finding 3.
**Where:** `similar/[id]/route.ts:~185-201` — enrichment SELECT lacks the `lens_model` / `capture_date` columns the semantic route added (AGG-C10-11a).
**Problem:** if similar-result cards render with the same component as semantic results, lens/date subtitles are blank. No privacy or correctness concern.
**Fix:** add the two columns to the similar route's enrichment SELECT to match the semantic route.

### AGG-C8-11 [LOW] — "Similar photos" disclosure missing `aria-controls` / region `id`
**Agents:** designer (Finding 3).
**Where:** `apps/web/src/components/similar-photos.tsx:~104-115` (button has `aria-expanded`, no `aria-controls`) / `~117-148` (result container has no `id`).
**Problem:** AT users cannot navigate from the toggle directly to the revealed region.
**Fix:** add `aria-controls="similar-photos-results"` to the button and `id="similar-photos-results"` to the result `<div>`.

### AGG-C8-12 [LOW] — `clipModelArtifactDir` has no segment-count guard on the model-id split
**Agents:** debugger (LOW), code-reviewer (LOW-2). 2-agent agreement.
**Where:** `apps/web/src/lib/clip-paths.ts:79` (`JINA_CLIP_MODEL_ID.split('/')`) + `clip-model-id.ts:25`.
**Problem:** a future bare-name or 3-segment model id, or a `JINA_CLIP_REVISION='main'` (which transformers maps to a *flat* path), would silently produce a wrong cache path and break the seed→offline-load contract with no error. Not live today (constant is exactly `jinaai/jina-clip-v2` + a 40-hex SHA).
**Fix:** assert a 2-segment model id + a 40-hex (non-`main`) revision in `clip-paths.ts` and/or the test surface, so a future model upgrade fails loud instead of silently mis-pathing.

### AGG-C8-13 [LOW] — Reload-storm / CSP gap on the live search surface
**Agents:** critic (CRT-C8-05). Re-open of plan-349 DEF-20.
**Where:** the live semantic/similar surface; no CSP tightening or reload-storm guard accompanied activation.
**Problem:** a deferred hardening item whose exit criterion ("re-open on production activation") has fired. Low residual risk.
**Fix:** revisit the DEF-20 scope; schedule or formally defer with the original severity preserved.

---

## Cross-agent agreement summary

| Finding | Agents in agreement | Consensus severity |
|---|---|---|
| AGG-C8-02 (partial-seed idempotency) | debugger, critic, code-reviewer, test-engineer (4) | HIGH |
| AGG-C8-05 (backfill model_version, unwired) | tracer, debugger, architect, security, test-engineer (5) | MEDIUM |
| AGG-C8-03 (missing index) | perf, critic (2) | MEDIUM |
| AGG-C8-06 (i18n 2-vs-3) | designer, document-specialist (2) | MEDIUM |
| AGG-C8-12 (model-id split guard) | debugger, code-reviewer (2) | LOW |
| AGG-C8-01 (event-loop) | critic (perf/tracer corroborate bound) | HIGH (mitigated) |
| AGG-C8-04 (short-query UX) | designer (1) | HIGH (UX) |

**Severity totals (deduped):** 3 HIGH (one UX), 5 MEDIUM, 5 LOW. **0 CRITICAL.** Total **13 merged findings.**

## What was verified clean (no finding)
- Seed→offline-load contract (path-doubling fix + revision-subdir layout) — security, code-reviewer, critic, tracer, architect, verifier all confirm; transformers v3 revision-subdir claim verified TRUE against installed source.
- `server-only` removal from `clip-model.ts` — boundary test is non-vacuous (verifier read lines 387-410; reads file from disk, asserts native-import signal). No client-leak risk.
- Same-origin 403 + maintenance 503 + content-type + body-size + <3-char 400 + rate-limit (Pattern 2, rollback on early exits) guard chain on both routes — tracer, security, verifier.
- `loadPromise` singleton nulls on failure → retries, not poisoned — tracer, debugger, architect.
- Enrichment SELECTs leak zero private fields (no GPS / filename_original / ICC / HDR) — security (grep-confirmed).
- `model_version` isolation consistent across all 3 writers + both readers — architect, security, verifier.
- Whole non-CLIP repo byte-identical to the cycle-7 converged baseline; re-confirmed clean.

## AGENT FAILURES
None permanent. test-engineer, tracer, debugger, document-specialist each exhausted their first run before persisting the output file; all four were retried. tracer + debugger persisted complete files on retry; test-engineer + document-specialist were finalized by the aggregation author from their verified partial findings + direct source verification (every cited line independently confirmed at HEAD). All 11 files are fresh and present.
