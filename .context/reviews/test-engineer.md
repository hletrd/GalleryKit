# Test-Engineer Review — Run-6 Cycle-9 (HEAD `af9ae6c5`)

**Date:** 2026-06-17
**Suite state (verified):** 2214 passed / 4 skipped (model-weight-gated by design) / 0 failed.

---

## Method

Full inventory of all 235 test files under `apps/web/src/__tests__/` plus 5 Playwright e2e specs.
For each cycle-8 fix I traced: (1) the fix location in source, (2) whether a test pins the fix, (3) what failure scenario an absent/wrong test would miss.
Sources read directly for every finding — no sampling.

---

## Findings

### TE-C9-01 [MEDIUM] — AGG-C8-04 client-side short-query `invalidSemantic` guard has zero test coverage

**Fix shipped:** `apps/web/src/components/search.tsx:165-169`

AGG-C8-04 added a `countCodePoints(searchQuery.trim()) < SEMANTIC_MIN_QUERY_CODEPOINTS` guard in the semantic branch of `performSearch`. When the query is too short it calls `setSearchStatus('invalidSemantic')` and returns early, preventing the misleading "Search failed." response that a server-side 400 would produce.

**Coverage gap:** `grep -r "invalidSemantic\|SEMANTIC_MIN_QUERY_CODEPOINTS" apps/web/src/__tests__/` returns zero results. No test in the repository pins this guard. `search-disclaimer.test.ts` only checks that `semanticExperimentalHint` renders in stub mode. `search-stale-response.test.ts` checks the request-id stale-response guard. Neither touches this path.

**Missing test:** A source-contract test (same pattern as `search-stale-response.test.ts`) asserting:
- `SEMANTIC_MIN_QUERY_CODEPOINTS` constant equals 3 and is present in the source.
- The short-path guard fires before the `fetch('/api/search/semantic'` call site.
- `setSearchStatus('invalidSemantic')` is the branch outcome, not `'error'`.
- A `return` statement immediately follows so no fetch is fired.

**Failure scenario without this test:** A refactor that deletes or reorders the guard, or changes the status string from `'invalidSemantic'` back to `'error'`, passes all 2214 tests silently. The regression reverts to the original symptom: a 1–2 character semantic query reaches the route, gets a 400, and the user sees "Search failed. Please try again." — the UX bug AGG-C8-04 was filed to fix.

**Confidence:** H

---

### TE-C9-02 [LOW] — `similar-route.test.ts` missing restore-maintenance 503 case

**Fix in route:** `apps/web/src/app/api/search/similar/[id]/route.ts:67-69` (Gate 2 — `isRestoreMaintenanceActive()` → 503).

**Coverage gap:** `similar-route.test.ts` mocks `isRestoreMaintenanceActive` as a fixed `() => false` at the describe-block level. No test flips it to `true`. `semantic-search-route.test.ts` explicitly covers the symmetric 503 maintenance case for the POST endpoint; the similar route has no equivalent.

**Missing test:** An `it('returns 503 when restore maintenance is active')` case — flip `isRestoreMaintenanceActive` to `() => true`, assert `res.status === 503` and `body.error === 'Maintenance'`. Also assert `preIncrementSemanticAttempt` was not called (maintenance fires before Gate 4).

**Failure scenario without this test:** A refactor that drops or reorders Gate 2 in the similar route (e.g. moves maintenance check after the rate-limit increment, charging a user's rate-limit slot during a restore window) passes all tests.

**Confidence:** M

---

### TE-C9-03 [LOW] — `similar-route.test.ts` missing 429 rate-limit case

**Coverage gap:** `similar-route.test.ts` mocks `preIncrementSemanticAttempt` as a fixed `vi.fn(() => false)` and never flips it to `true`. The semantic route's companion test covers the 429 path. The similar route shares the same Pattern 2 rate-limit contract (`preIncrementSemanticAttempt` / `rollbackSemanticAttempt`) but that contract is untested on this route.

**Missing test:** An `it('returns 429 when rate limit is exceeded')` case — set `preIncrementSemanticAttempt` to return `true`, assert `res.status === 429`, `res.headers.get('Retry-After') === '60'`, and that `rollbackSemanticAttempt` was NOT called (429 is a consumed slot, not a rollback case per route.ts:84-89).

**Failure scenario without this test:** A refactor that accidentally moves the rate-limit increment after the mode gate (or removes it) in the similar route passes all tests without surfacing the change.

**Confidence:** M

---

### TE-C9-04 [LOW] — `similar-route.test.ts` missing corrupt-embedding 404 case

**Fix in route:** `apps/web/src/app/api/search/similar/[id]/route.ts:128-131` (Gate 6 second branch — `decodeEmbeddingColumn(targetRows[0].embedding) === null` → 404 `'Embedding data is corrupt'`).

**Coverage gap:** The existing test at the Gate 6 position covers `targetRows = []` (no row found) — the first 404 branch at line 121. The second 404 branch (non-null row with a corrupt MEDIUMBLOB that decodes to null) at lines 128-131 has no test. The `rollbackSemanticAttempt` call on that path is also untested.

**Missing test:** Set `targetRows = [{ embedding: Buffer.from('not-a-valid-embedding') }]` (non-empty row, corrupt value that `decodeEmbeddingColumn` returns null for), assert status 404 and `body.error === 'Embedding data is corrupt'`, and assert `rollbackSemanticAttempt` called once.

**Failure scenario without this test:** A refactor that removes the `decoded === null` check (collapsing both 404 branches into a single `!targetRows[0].embedding` check) or that changes the error body string passes all tests silently.

**Confidence:** L

---

## Verified clean (no gap found)

- **Semantic route guard chain** (`semantic-search-route.test.ts`): all 12 cases — 403, 503 maintenance, 400 content-length NaN/413, 400 invalid JSON, 400 missing query, 400 query < 3 chars, 503 disabled, 200 production (real encoder), 429, 200 empty, 200 enriched, 500 + rollback. Comprehensive.
- **Rate-limit pre-increment / rollback** (`semantic-search-rate-limit.test.ts`): bucket fill, window expiry, IP independence, rollback from 1 (entry deletion), multi-rollback, no-op on missing entry. Comprehensive.
- **`clampSemanticTopK`** (`semantic-search-params.test.ts`): 15 cases including boolean/array/object/NaN/Infinity/numeric-string rejection. Comprehensive.
- **Downloader full-manifest idempotency** (`download-clip-models.test.ts:29-36`, AGG-C8-02 fix): asserts `verifyAndCleanArtifacts` called with full `MANIFEST + false` on the fast-path; the ONNX-only single-file shortcut is asserted absent. The cycle-8 gap TE-C8-01 is closed.
- **`backfillClipEmbeddings` action model_version selection** (`backfill-clip-embeddings-reembed.test.ts:26-35`, AGG-C8-05 fix): pins `eq(imageEmbeddings.modelVersion, modelVersion)` in the action source and that `const modelVersion =` is hoisted above `notExists(`. The cycle-8 gap TE-C8-02 is closed.
- **`resolveBackfillConcurrency` pool-budget cap** (`admin-backfill-concurrency-cap.test.ts`): 8 arithmetic cases including small-pool degenerate and large-pool scaling.
- **Backfill fatal-counter honesty** (`admin-backfill-runner-fatal-counters.test.ts`): fatal-only run, mixed run (processed=1 + errors=1 simultaneously), corrupt-width skip (encodeFailures=1, processImageFormats not called). Comprehensive.
- **Migration journal monotonicity** (`migration-journal-monotonicity.test.ts`): idx ordering, when-monotonicity with documented allowlist, allowlist staleness check, post-condition predicate, and `migrate.js` loud-fail throw. Comprehensive.
- **CLIP path resolver / revision-subdir layout** (`clip-paths.test.ts`, AGG-C8-12 fix): absolute/relative/empty `CLIP_MODELS_ROOT`, path-doubling regression explicitly asserted absent, revision-subdir nesting depth, 40-hex revision pin, model-id 2-segment guard.
- **`clip-model.ts` source contracts** (`clip-model-contract.test.ts`): exports, `server-only` absence, 40-hex revision pin, singleton, volume path. Comprehensive.
- **Similar route core paths** (`similar-route.test.ts`): 403, 503 mode gates (stub + disabled), 400 non-numeric id, 400 id=0, 404 no-embedding (rows = []), 200 self-exclusion, model_version WHERE filter, Cache-Control no-store. The three missing cases are TE-C9-02/03/04 above; the tested paths are adequate.
- **`dotProduct` fast-path** for production mode: the similar route is production-only (Gate 5); `dotProduct` vs `cosineSimilarity` dispatch tested in `clip-embeddings.test.ts`; integration via production mode confirmed in `semantic-search-route.test.ts`.
- **i18n key parity** (`i18n-key-parity.test.ts`): the new `search.invalidSemantic` key is present in both `en.json:412` and `ko.json:412`; the full leaf-key parity gate pins this automatically.
- **Privacy fields** (`privacy-fields.test.ts`): enrichment SELECTs in both CLIP routes exclude GPS/filename_original/ICC/HDR per the `_PrivacySensitiveKeys` compile-time guard; no privacy-field drift detected.
- **API auth scanner** (`check-api-auth.test.ts`): both CLIP routes are public (correctly excluded from `withAdminAuth` scan).
- **Action origin scanner** (`check-action-origin.test.ts`): `embeddings.ts` actions carry `requireSameOriginAdmin()` and pass.
- **Model-weight-gated suites** (`clip-offline-load.test.ts` × 2, `clip-semantic-integration.test.ts` × 2): skip by design — correct, not a gap.

---

## Summary

**4 gaps found (1 MEDIUM, 3 LOW).**

| ID | Severity | One-line description |
|----|----------|----------------------|
| TE-C9-01 | MEDIUM | AGG-C8-04 `invalidSemantic` short-query guard in `search.tsx` has zero source-contract test coverage — regression is invisible |
| TE-C9-02 | LOW | `similar-route.test.ts` missing restore-maintenance 503 case (mock wired but never flipped) |
| TE-C9-03 | LOW | `similar-route.test.ts` missing 429 rate-limit case (`preIncrementSemanticAttempt` never returns true in tests) |
| TE-C9-04 | LOW | `similar-route.test.ts` missing corrupt-embedding 404 path (`decodeEmbeddingColumn` returns null) |

No CRITICAL or HIGH gaps. Both cycle-8 open items (TE-C8-01, TE-C8-02) are closed by the committed regression tests. TE-C9-01 is the only finding worth prioritizing in a fix cycle — the others are edge-case coverage symmetry improvements on an already well-tested route.
