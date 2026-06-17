# Plan 362 — Run-6 Cycle-9 Fixes

**Source:** `.context/reviews/_aggregate.md` (Run-6 Cycle-9, HEAD `af9ae6c5`).
**Created:** 2026-06-17
**Status:** DONE — all 5 tasks implemented, gates green, deployed. Commits: 26609da8 (TASK-1), d7c711e4 (TASK-2), 2b7ca75e (TASK-3), 2fb8e4e7 (TASK-4), 82c264dc + e8d25c53 (TASK-5). TASK-1 layer-4 (SHA-pin the two config JSONs) remains a deploy-host dependency (no seeded cache reachable in CI to compute digests) — the wedge itself is fully closed by the existence/JSON-parse check.

This cycle's deep review reached near-total convergence. 5 findings: **1 HIGH, 1 MEDIUM, 3 LOW** — all on the CLIP semantic-search surface (the only code changed since the cycle-7 0-finding baseline). None are deferrable under repo rules (the HIGH is a correctness/availability finding on a LIVE path; the rest are cheap, additive, worth-fixing hardening). All are scheduled below.

The 3 architecture-dependent deferrals from cycle-8 (DEF-C8-1 main-thread inference, DEF-C8-2 runtime checksum, DEF-C8-3 CSP/reload-storm) remain open in plan-361 with preserved severity; they are NOT re-opened here (no new angle this cycle).

---

## TASK-1 [HIGH] — AGG-C9-01: Make the downloader-idempotency check cover the full offline-loader fatal-required file set

**Finding:** `CLIP_MODEL_MANIFEST` (`apps/web/scripts/clip-model-manifest.ts:25-30`) lists only `onnx/model_quantized.onnx` + `tokenizer.json`. The offline `from_pretrained` (`allowRemoteModels=false`) loads four files with `fatal=true` — verified against the installed `@huggingface/transformers` v3.8.1:
- `node_modules/@huggingface/transformers/src/configs.js:54` → `getModelJSON(..., 'config.json', true, ...)`
- `node_modules/@huggingface/transformers/src/tokenizers.js:70-71` → `getModelJSON(..., 'tokenizer.json', true, ...)` AND `getModelJSON(..., 'tokenizer_config.json', true, ...)`

So a partial/corrupt seed missing `config.json` or `tokenizer_config.json` (but with a valid ONNX + tokenizer.json) passes `verifyAndCleanArtifacts`, the downloader prints "already up to date" / exits 0, and the first live query throws inside `from_pretrained` → `loadPromise` nulls → indefinite 503 storm. This is the exact failure class AGG-C8-02 set out to eliminate, narrowed to the two config JSONs the manifest never covered.

**Why the cycle-8 test missed it:** `clip-model-manifest.test.ts:38-41` asserts only that the manifest *contains* the 2 entries; it does not require manifest ⊇ loader-fatal-set parity.

### Environment constraint (CRITICAL — do not fabricate digests)
There is **no seeded CLIP cache reachable in this build environment** (`apps/web/data/clip-models/` does not exist locally; the weights live only on the deploy host / model volume). The real pinned-revision SHA-256 digests of `config.json` and `tokenizer_config.json` therefore **cannot be computed here** and MUST NOT be invented (a wrong SHA would itself wedge the seed by reporting a valid file as poisoned).

### Fix strategy (two layers — both land fully at HEAD without any fabricated digest)

The integrity goal for the two config JSONs in the idempotency fast-path is **existence + parseability** (a missing or truncated/corrupt JSON is the failure mode that wedges the loader), NOT cryptographic pinning — the files are small, self-describing, and already covered by the pinned-revision download. So:

1. **Add a `LOADER_FATAL_FILES` constant** to `clip-model-manifest.ts` enumerating the four files the offline loader requires with `fatal=true`: `onnx/model_quantized.onnx`, `tokenizer.json`, `config.json`, `tokenizer_config.json`. Document the transformers-source line references in a comment so future drift is traceable.
2. **Add a `verifyLoaderFatalFiles(modelCacheDir)` helper** that, for each `LOADER_FATAL_FILES` entry: (a) if the entry has a manifest SHA, defer to the existing `verifyAndCleanArtifacts` checksum path; (b) otherwise (the two config JSONs), assert the file exists AND `JSON.parse(readFileSync(...))` succeeds (catches missing + truncated/corrupt). Return a `{ ok, failures, log }` shape mirroring `ManifestVerifyResult`.
3. **Widen the downloader idempotency fast-path** (`download-clip-models.ts:72-84`): after the existing `verifyAndCleanArtifacts(... MANIFEST ... false)` SHA check passes, ALSO require `verifyLoaderFatalFiles(modelCacheDir).ok` before the early-return "already up to date". If either fails, fall through to re-download (the existing path). Keep `deleteOnMismatch=false` semantics for the inspection.
4. **(Optional, deferred-with-dependency)** Once a known-good seeded cache is available on the deploy host, compute the real SHA-256 of `config.json` + `tokenizer_config.json` at the pinned revision and promote them into `CLIP_MODEL_MANIFEST` so they get full checksum verification. **This SHA-promotion step is the ONLY part that cannot land in this environment** — record it as a dependency, not a blocker for the existence-check fix which fully closes the wedge.

### Test (`clip-model-manifest.test.ts`)
- Add a test asserting `LOADER_FATAL_FILES` is a SUPERSET of the manifest keys AND contains all four loader-fatal files (so future loader/file drift re-surfaces).
- Add a behavioral test for `verifyLoaderFatalFiles`: a temp dir with valid ONNX + tokenizer.json + a valid `config.json`/`tokenizer_config.json` returns `ok:true`; deleting `config.json` returns `ok:false` with the right failure; a truncated/non-JSON `tokenizer_config.json` returns `ok:false`.
- Add a `download-clip-models.test.ts` source-contract assertion that the early-return path calls `verifyLoaderFatalFiles` (or otherwise gates on the fatal-file set) in addition to `verifyAndCleanArtifacts`.

### Acceptance
- A partial seed missing/corrupt in `config.json` or `tokenizer_config.json` no longer reports "already up to date" — it falls through to re-download.
- Tests lock manifest ⊇ loader-fatal parity and the existence/parse behavior.
- No fabricated SHA digests. The SHA-promotion (layer 4) is recorded as a deploy-host dependency in this plan, not landed.
- All gates green; typecheck before committing test changes.

**Status:** DONE

---

## TASK-2 [MEDIUM] — AGG-C9-02: Add source-contract test for the short-semantic-query client guard

**Finding:** `search.tsx:21,27,165-168` (`SEMANTIC_MIN_QUERY_CODEPOINTS = 3`, `countCodePoints(...) < SEMANTIC_MIN_QUERY_CODEPOINTS`, `setSearchStatus('invalidSemantic')`) has zero test coverage — `grep invalidSemantic apps/web/src/__tests__/` is empty. A refactor silently regressing any of the three points reverts to the misleading "Search failed" UX that AGG-C8-04 closed, with no failing test.

### Fix
- Add `apps/web/src/__tests__/search-short-query-guard.test.ts` following the `search-stale-response.test.ts` pattern (read `search.tsx` from disk, assert string contracts): (1) `SEMANTIC_MIN_QUERY_CODEPOINTS` is defined as `3`; (2) the semantic branch calls `countCodePoints(...)` and compares against the constant; (3) the short-query branch routes to `setSearchStatus('invalidSemantic')` and returns BEFORE the semantic `fetch`; (4) assert the guard sits before the fetch call (position check).
- Add a parity assertion (in this test or an i18n parity test) that `search.invalidSemantic` exists in both `en.json` and `ko.json` with non-empty values.

### Acceptance
- The three contract points are pinned; a silent regression fails the suite.
- Key parity for `invalidSemantic` is locked.
- Gates green; typecheck before commit.

**Status:** DONE

---

## TASK-3 [LOW] — AGG-C9-03: Add the three missing failure-mode cases to `similar-route.test.ts`

**Finding:** `similar-route.test.ts` omits the maintenance-503, 429-rate-limit, and corrupt-embedding-404 cases that `semantic-search-route.test.ts` covers for the sibling route. The guards exist and are correct (tracer Trace 2) but are untested on the similar route.

### Fix
- Add three cases mirroring `semantic-search-route.test.ts`:
  - **maintenance 503**: flip the restore-maintenance mock to `true`, expect 503.
  - **429**: make `preIncrementSemanticAttempt` return `true` (limited), expect 429.
  - **corrupt-embedding 404**: make `decodeEmbeddingColumn` return `null` for a non-empty row, expect the 404 path.

### Acceptance
- The similar route's three guard paths are covered with the same assertions as the semantic route.
- Gates green; typecheck before commit.

**Status:** DONE

---

## TASK-4 [LOW] — AGG-C9-04: Complete the `SimilarResult` interface to match the API response shape

**Finding:** `similar-photos.tsx:14-25` `SimilarResult` omits `lens_model: string | null` and `capture_date: string | null`, which `/api/search/similar/[id]` returns (`route.ts:205-206,227-228`, intentional AGG-C8-10 parity fix). Type-contract drift, no runtime impact.

### Fix
- Add `lens_model: string | null;` and `capture_date: string | null;` to the `SimilarResult` interface so the client type matches the wire shape. Do NOT remove the fields from the route SELECT (the parity was a deliberate cycle-8 fix).

### Acceptance
- `SimilarResult` matches the route's per-row response object.
- Typecheck exit 0; gates green.

**Status:** DONE

---

## TASK-5 [LOW] — AGG-C9-05: Reword the stale "deployed DARK" comment in `gallery-config.ts`

**Finding:** `gallery-config.ts:134` comment says the CLIP feature "is deployed DARK" — stale present-tense after production activation. Developer-only comment annotating a correct invariant (production absent from the admin dropdown). Not user-visible.

### Fix
- Reword the comment from "deployed DARK by …" to describe the actual mechanism: production mode is operator-gated (requires `SEMANTIC_SEARCH_ALLOW_PRODUCTION` + the DB `production` row) and is intentionally NOT activatable via the admin UI dropdown (which offers only `disabled`/`stub`). Keep the invariant the comment protects intact.

### Acceptance
- No remaining "deployed DARK" framing in source comments (grep clean).
- The invariant explanation is accurate to the live state.
- Gates green.

**Status:** DONE

---

## Deferred findings (this cycle)

None new. Every cycle-9 finding is scheduled above. The pre-existing cycle-8 deferrals (DEF-C8-1/2/3) remain in plan-361 with preserved severity; TASK-1 layer-4 (SHA promotion of the config JSONs) is recorded as a **deploy-host dependency**, not a deferral of the finding — the wedge itself is fully closed by the existence/parse check in layers 1-3.

## Repo-policy compliance
- TASK-1 is a correctness/availability finding on a LIVE path → scheduled, not deferred (per CLAUDE.md / the loop's deferred-fix rules; security/correctness/availability are not deferrable).
- All tasks obey: GPG-sign (`-S`), no Co-Authored-By, conventional + gitmoji, fine-grained commits, `git pull --rebase` before push, `npm run typecheck --workspace=apps/web` before committing test changes.
- HARD GUARDS respected: no `server-only` re-added; `semantic_search_mode` code default stays `disabled`; no weakening of the production gate / revision pin / `allowRemoteModels=false` / model_version isolation.
