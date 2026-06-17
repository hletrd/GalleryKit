# Aggregate Review — Run-6 Cycle-9 (HEAD `af9ae6c5`)

**Date:** 2026-06-17
**Agents fanned out (11/11 returned + persisted):** security-reviewer, code-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer.
**Gate state (verifier, fresh foreground run):** ESLint exit 0; typecheck exit 0; Vitest **2214 passed / 4 skipped / 0 failed** (237 files); lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0. The 4 skips are the model-weight-gated `clip-offline-load` + `clip-semantic-integration` suites (gated by design).

## Context

The pre-activation code converged at cycle-7 (0 findings). Cycle-8 turned CLIP semantic search LIVE in production and found+fixed 13 activation-surface findings (plan-360, archived). This cycle independently re-verified those 13 fixes AND swept the whole system. The verdict is **near-total convergence**: the non-CLIP repo is byte-identical to the cycle-7 baseline and re-swept clean by every agent; the only NEW HIGH finding is **one incomplete cycle-8 fix** flagged by 4 agents independently (the downloader-idempotency manifest does not cover the full offline-loader fatal-required file set). All HARD GUARDS were respected by every agent — no `server-only` re-added to `clip-model.ts`/`@/db`; the `semantic_search_mode: 'disabled'` code default left intact; no weakening of `SEMANTIC_SEARCH_ALLOW_PRODUCTION` / the revision pin / `allowRemoteModels=false` / model_version isolation. The security reviewer explicitly rejected the `server-only` temptation and cited the guard.

**Findings trend across run-6:** cycle-1 ~30 → … → cycle-7 **0** → cycle-8 **13** (activation surface) → cycle-9 **1 HIGH + 1 MED + 3 LOW**.

---

## Merged findings (deduped; highest severity/confidence preserved; cross-agent agreement noted)

### AGG-C9-01 [HIGH] — Downloader-idempotency manifest omits 2 of the 4 offline-loader fatal-required files → the AGG-C8-02 503-storm class is only partially closed
**Agents (5-agent agreement):** code-reviewer (CR-C9-01, HIGH/conf-M), architect (ARCH-C9-01, MED/conf-H), critic (CRT-C9-01, MED/conf-H), corroborated by debugger (robustness analysis of the same path) and tracer (Trace 3). Severity preserved at **HIGH** per the highest-severity rule (code-reviewer); the operational blast radius — an indefinitely wedged LIVE production search — is high-impact even though the trigger is operator-side and the fix is trivial.

**Where:**
- `apps/web/scripts/clip-model-manifest.ts:25-30` — `CLIP_MODEL_MANIFEST` contains only `onnx/model_quantized.onnx` + `tokenizer.json`.
- `apps/web/scripts/download-clip-models.ts:72-84` — the idempotency fast-path calls `verifyAndCleanArtifacts(modelCacheDir, MANIFEST, false)` and early-returns "already up to date" when `preCheck.ok`. The comment at line 69 asserts it verifies "the same set the runtime reads back" — **this premise is false** for the two omitted files.
- `apps/web/src/lib/clip-model.ts` — the offline `from_pretrained` (`allowRemoteModels=false`) loads all four files.

**Evidence (verified against the installed `@huggingface/transformers` v3.8.1 source):**
- `node_modules/@huggingface/transformers/src/configs.js:54` — `getModelJSON(pretrained_model_name_or_path, 'config.json', true, options)` (the `true` arg = `fatal`).
- `node_modules/@huggingface/transformers/src/tokenizers.js:70-71` — `getModelJSON(..., 'tokenizer.json', true, ...)` AND `getModelJSON(..., 'tokenizer_config.json', true, ...)`.
- So the offline loader's fatal-required set is **{ onnx/model_quantized.onnx, tokenizer.json, config.json, tokenizer_config.json }**, but the verified manifest covers only the first two.

**Failure scenario:** a partial / corrupt / truncated seed where `onnx/model_quantized.onnx` + `tokenizer.json` are intact but `config.json` or `tokenizer_config.json` is missing/corrupt passes `verifyAndCleanArtifacts`, the script prints "already up to date" and exits 0 across every re-run. The first live semantic/similar query then throws inside `from_pretrained`, `loadPromise` is nulled by the catch, and every subsequent request returns 503 indefinitely — the exact failure class AGG-C8-02 set out to eliminate, narrowed to the two config JSONs the manifest never covered. No compensating runtime probe exists.

**Why the cycle-8 test missed it:** `apps/web/src/__tests__/clip-model-manifest.test.ts:38-41` asserts only that the manifest *contains* `onnx/model_quantized.onnx` + `tokenizer.json` with 64-hex SHAs — it does NOT require manifest ⊇ loader-fatal-set parity. `download-clip-models.test.ts:29-32` only asserts the call shape (`verifyAndCleanArtifacts(... MANIFEST ... false)`), not the manifest contents. Both pass with the incomplete manifest.

**Fix (additive, low-risk):** add `config.json` and `tokenizer_config.json` to `CLIP_MODEL_MANIFEST` with their pinned-revision SHA-256 digests (compute from a known-good seeded cache at the pinned revision). Then strengthen the test to assert the manifest is a SUPERSET of the loader's fatal-required set (so a future loader/file drift re-surfaces here). This is the natural companion to the deferred DEF-C8-2 (runtime first-load checksum).
**Repo-policy note:** correctness/availability finding on a LIVE path — must be scheduled, not deferred.
**Caveat for the fix step:** the pinned-revision SHA-256 digests for `config.json` / `tokenizer_config.json` must be computed from a real known-good seeded cache; they cannot be invented. If a seeded cache is not reachable in this environment, the manifest-superset TEST and the call-site widening can still land (asserting the keys are present), with the SHA values filled from the seed-time spike — record that dependency in the plan rather than fabricating a digest.

### AGG-C9-02 [MEDIUM] — The AGG-C8-04 short-semantic-query client guard has ZERO source-contract test coverage
**Agents:** test-engineer (TE-C9-01, MEDIUM). Confirmed at HEAD.
**Where:** `apps/web/src/components/search.tsx:21,27,165-168` — `SEMANTIC_MIN_QUERY_CODEPOINTS = 3`, the `countCodePoints(searchQuery.trim()) < SEMANTIC_MIN_QUERY_CODEPOINTS` check, and the `setSearchStatus('invalidSemantic'); return` branch are all unprotected. `grep -rln invalidSemantic apps/web/src/__tests__/` returns **nothing** — no test references the key or the guard.
**Problem:** a refactor that silently regresses any of the three contract points (the constant value, the `countCodePoints` call, or routing to `invalidSemantic` instead of `error`) passes the full suite. The fix would silently revert to the misleading "Search failed. Please try again." UX that AGG-C8-04 closed, with no failing test.
**Fix:** add a source-contract test that reads `search.tsx` from disk and asserts the three contract points (same pattern as the existing `search-stale-response.test.ts`). Also pin the `search.invalidSemantic` key parity in `en.json` / `ko.json`.
**Severity:** MEDIUM (a fixed UX defect with no regression guard on a LIVE surface).

### AGG-C9-03 [LOW] — `similar-route.test.ts` missing three failure-mode cases its sibling test covers (maintenance-503, 429, corrupt-embedding-404)
**Agents:** test-engineer (TE-C9-02/03/04, LOW each).
**Where:** `apps/web/src/__tests__/similar-route.test.ts` — the restore-maintenance mock is wired but never flipped to `true` (no 503 case); `preIncrementSemanticAttempt` mock always returns `false` (no 429 case); no corrupt-embedding case where `decodeEmbeddingColumn` returns null on a non-empty row (the 404 path).
**Problem:** the `/api/search/similar/[id]` route's maintenance-window, rate-limit, and corrupt-embedding rejection paths are untested, even though `semantic-search-route.test.ts` covers the equivalent cases for the sibling route. A regression in any of these three guards on the similar route would not be caught.
**Fix:** add the three symmetry cases, mirroring `semantic-search-route.test.ts`.
**Severity:** LOW (defense-in-depth coverage symmetry; the guards themselves are present and correct per tracer Trace 2).

### AGG-C9-04 [LOW] — `SimilarResult` interface drifts from the `/api/search/similar/[id]` response shape
**Agents:** debugger (DBG-C9-01, LOW), corroborated by code-reviewer (CR-C9-OBS-1) and tracer (Trace 2) as informational.
**Where:** `apps/web/src/components/similar-photos.tsx:14-25` — the `SimilarResult` interface omits `lens_model: string | null` and `capture_date: string | null`, which the route added in cycle-8 (AGG-C8-10) and now returns (`route.ts:205-206,227-228`).
**Problem:** no runtime impact — the component never reads those fields and TypeScript silently ignores extra JSON keys — but the client type contract diverges from the API response shape. A maintenance hazard if a shared result-card component is later introduced and assumes the interface is complete.
**Fix:** add the two optional fields to `SimilarResult` (the lens/date parity was an intentional AGG-C8-10 fix, so completing the interface is the conservative choice).
**Severity:** LOW (type-contract drift, no behavioral defect).

### AGG-C9-05 [LOW] — Stale "deployed DARK" developer comment in `gallery-config.ts` after production activation
**Agents:** document-specialist (DOC-C9-01, LOW).
**Where:** `apps/web/src/lib/gallery-config.ts:134` — `// AGG-C10-02 (run-6 cycle-1): the CLIP feature is deployed DARK by …`. (The document-specialist also cited `settings-client.tsx:665`, but at current HEAD only the `gallery-config.ts` comment still contains the "deployed DARK" phrasing — `grep` confirms the settings-client one no longer matches; the agent read a marginally stale tree. One comment remains.)
**Problem:** the comment annotates a CORRECT invariant (production mode is intentionally absent from the admin dropdown — admin can only set disabled/stub), but the "deployed DARK" framing is stale present-tense now that the feature is LIVE via the operator gate. Developer-only, not user-visible, does not mislead about code behavior.
**Fix:** reword from "deployed DARK" to "operator-gated (production not activatable via the admin UI; requires SEMANTIC_SEARCH_ALLOW_PRODUCTION + the DB row)".
**Severity:** LOW (comment-only wording).

---

## Verified CLEAN (recomputed at each agent's angle, not inherited)

- **All 13 cycle-8 fixes re-verified CLOSED at HEAD** by verifier (10 directly-verifiable, file+line evidence each), code-reviewer, critic, tracer, architect, perf-reviewer. AGG-C9-01 is the lone partial (the manifest-coverage gap inside the otherwise-correct AGG-C8-02 fast-path); the early-return mechanics, `deleteOnMismatch=false` inspection semantics, and re-download fallback are all correct.
- **Security:** 0 CRITICAL/HIGH/MED/LOW. Live semantic + similar routes — same-origin fail-closed, mode gate fail-closed (`production` only with the env true), Pattern-2 rate limit with rollback on early exits, full input hardening, query embedded to a vector BEFORE any SQL (no injection), enrichment SELECTs public-only (grep for `latitude|longitude|filename_original|user_filename` in `api/search` = empty). Auth/sessions, DB backup/restore (`MYSQL_PWD` env, dangerous-SQL scan, advisory lock, header validation, 0o600), paid-download (token-shape gate, constant-time verify, atomic single-use claim, symlink/realpath containment), PAT auth, Stripe mandatory signature verify, CSV/bidi/XSS sanitizers, `_PrivacySensitiveKeys` guard — all intact. `npm audit --omit=dev --audit-level=high`: 0 HIGH/CRITICAL.
- **Performance:** migration 0022 `(model_version, updated_at)` index confirmed effective (journal `when` 1781687094232 is the strict global max → drizzle applies it, not skips; three-way consistent across migration/migrate.js reconcile/schema.ts). Production-gated `dotProduct` correct (stub vectors aren't unit-normalized → cosine mandatory; production unit-vectors → dotProduct valid). No new sync-fs on hot paths, no fetch/loop/sort regressions. AGG-C8-01 (main-thread inference + 5000-row scan) re-examined for a NEW angle — none; subsumed by the existing DEF-C8-1 deferral.
- **Tracer:** all 4 LIVE flows clean — guard-chain ordering correct (rate-limit after cheap validation, before embedding), model_version isolation airtight across all 4 writers/readers, both backfill entry points persist the same column set + serialize on the advisory lock, singleton nulls-on-failure retry confirmed.
- **Architect:** privacy-guard union architecture auto-extends both compile-time guards; `image_embeddings` adds zero PII surface; production-heal double-gate intact; process-local state consistent with single-instance topology (queue quiesces before the embedding hook can run during restore).
- **Designer:** 0 findings. UI rendered surface byte-identical to the cycle-5 clean baseline except the now-fixed HDR-badge contrast (DES-C6-M1, `text-amber-950`, worst stop 6.62:1 vs 4.5:1 floor, test-locked). Touch-target audit 15/15, hdr-badge-contrast 12/12. Full contrast/token/focus/keyboard/ARIA/reduced-motion/forced-colors surface re-passes AA in all three themes. Semantic toggle + similar-photos ARIA (aria-controls/id pairing, IME guards) clean.
- **Document-specialist:** all major CLAUDE.md load-bearing claims verified accurate (`IMAGE_PIPELINE_VERSION=7`, COLOR_IMPACTING_KEYS count, 6 advisory-lock names, `cache()` count=10, NCLX matrix map, SCAN_ROOTS, backfill concurrency formula, full i18n key parity, the CLIP gating description). Cycle-8 doc fixes (DOC-C8-01/02/03) confirmed closed.

---

## Deferred items still open (NOT re-raised as new findings — tracked in plan-361 with preserved severity + fired exit criteria)

- **DEF-C8-1 [HIGH]** — main-thread synchronous CLIP inference + ≤5000-row JS cosine scan on the request thread. Architecture-dependent (worker_threads / queue / scan cap). AGG-C9-01's manifest widening is the natural companion to DEF-C8-2.
- **DEF-C8-2 [MEDIUM]** — no runtime ONNX/config checksum at load time (the seed-time manifest is the only integrity gate). AGG-C9-01 tightens the seed-time half of this.
- **DEF-C8-3 [LOW]** — CSP / reload-storm hardening on repeated 503s.

All three remain architecturally correct deferrals; their reasoning holds at HEAD.

---

## AGENT FAILURES

None. All 11 agents returned and persisted their review files. (The designer's final chat message was truncated mid-investigation, but its written `designer.md` file is complete and concludes with zero findings — confirmed by reading the file.)

---

## Cross-agent agreement summary

| Finding | Agents in agreement | Consensus severity |
|---|---|---|
| AGG-C9-01 (manifest gap) | code-reviewer, architect, critic, debugger, tracer (5) | HIGH (preserved from code-reviewer) |
| AGG-C9-02 (short-query test gap) | test-engineer (1) | MEDIUM |
| AGG-C9-03 (similar-route test symmetry) | test-engineer (1) | LOW |
| AGG-C9-04 (SimilarResult interface drift) | debugger, code-reviewer, tracer (3) | LOW |
| AGG-C9-05 (stale comment) | document-specialist (1) | LOW |

**5 distinct findings: 1 HIGH, 1 MEDIUM, 3 LOW. Zero CRITICAL. Strong convergence; the HIGH is a contained incomplete-fix, the rest are test/contract/doc hardening.**
