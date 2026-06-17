# Test-Engineer Review — Run-6 Cycle-10 (HEAD `0502ae86`)

**Date:** 2026-06-17
**Suite state (verified):** 2227 passed / 4 skipped (model-weight-gated by design) / 0 failed.
**Test files:** 236 unit/integration + 2 skipped suites (gated) + 5 Playwright e2e specs.

---

## Method

Full inventory of all 236 test files under `apps/web/src/__tests__/` plus 5 Playwright e2e specs.
For each area I traced: (1) the implementation location in source, (2) whether a test pins the invariant by importing the real implementation, (3) what failure scenario an absent or vacuous test would miss.
Sources read directly for every finding — no sampling.

---

## Findings

### TE-C10-01 [MEDIUM] — `similar-route.test.ts` mock `images` schema silently omits `lens_model` and `capture_date`

**Source:** `apps/web/src/app/api/search/similar/[id]/route.ts` lines 205–206, 227–228.  
**Test file:** `apps/web/src/__tests__/similar-route.test.ts` — the `vi.mock('@/db', ...)` block and the `imageRows` fixture in the 200-path test.

The production route selects `images.lens_model` and `images.capture_date` and maps them into the enriched result. The `SimilarResult` interface in `similar-photos.tsx` (lines 14–31) lists both fields as required, with an explicit comment noting the interface must match the wire shape (AGG-C9-04). The mock `images` schema in the test exposes only `id, title, description, filename_jpeg, width, height, topic, processed, camera_model` — `lens_model` and `capture_date` are absent. The Drizzle ORM `.select({ ..., lens_model: images.lens_model, ... })` call against the mock receives `undefined` for both fields. The test still passes because the 200-path assertion only checks `res.status` and `body.results[0].imageId`, never `lens_model` or `capture_date`.

**Regression scenario:** A future edit that drops either column from the route SELECT (or names it differently) will not be caught by any test. The client component's `SimilarResult` type guard is compile-time only and cannot detect runtime omissions.

**Fix:** Add `lens_model: 'lens_model'` and `capture_date: 'capture_date'` to the `images` object in the `vi.mock('@/db', ...)` block. Populate both fields in the `imageRows` fixture. Add assertions on the returned result item:
```typescript
expect(body.results[0]).toHaveProperty('lens_model');
expect(body.results[0]).toHaveProperty('capture_date');
```

**Confidence:** M

---

## Verified clean — prior-cycle open items closed

The three cycle-9 findings (TE-C9-01 through TE-C9-04) were closed in the commits leading to HEAD:

- **TE-C9-01 (MEDIUM):** `search-short-query-guard.test.ts` now pins the `SEMANTIC_MIN_QUERY_CODEPOINTS = 3` constant, the `countCodePoints` comparison against it, the `setSearchStatus('invalidSemantic')` branch outcome, the `return` before the fetch, and en/ko `invalidSemantic` key parity with a `3|three` wording check. Fully closed.
- **TE-C9-02 (LOW):** `similar-route.test.ts` now has an `it('returns 503 when restore-maintenance is active (before rate-limit is charged)')` case that flips `isRestoreMaintenanceActive` to `true` and asserts `preIncrementSemanticAttempt` was not called. Closed.
- **TE-C9-03 (LOW):** `similar-route.test.ts` now has an `it('returns 429 when the per-IP semantic rate limit is exceeded')` case that returns `true` from `preIncrementSemanticAttempt`, asserts `retry-after` is truthy, and verifies `rollbackSemanticAttempt` was not called. Closed.
- **TE-C9-04 (LOW):** `similar-route.test.ts` now has an `it('returns 404 when the target embedding row is present but corrupt')` case that writes a non-EMBEDDING_BYTES buffer, asserts status 404, and verifies `rollbackSemanticAttempt` was called once. The non-vacuity guard (`Buffer.from(corruptB64, 'base64').length !== EMBEDDING_BYTES`) is also present. Closed.

---

## Verified clean — full surface sweep

**CLIP semantic search pipeline:**
- Same-origin 403, maintenance 503, short-query 400, disabled 503: `semantic-search-route.test.ts` (12 cases), `similar-route.test.ts` (9 cases including the new cycle-9 additions).
- Model-version isolation: `semantic-route-production.test.ts` (WHERE clause via whereSpy), `similar-route.test.ts` (`filters the embedding scan on PRODUCTION_MODEL_VERSION via where()`).
- MEDIUMBLOB Buffer/base64 round-trip: `clip-embedding-column-roundtrip.test.ts` — imports the real `decodeEmbeddingColumn` and proves the old read path would have dropped the row (non-vacuity guard).
- Downloader idempotency — full manifest + loader-fatal set: `download-clip-models.test.ts` pins `verifyAndCleanArtifacts(MANIFEST, false)` AND `verifyLoaderFatalFiles`; `preCheck.ok && fatalCheck.ok` guard is asserted present. `clip-model-manifest.test.ts` drives the real `verifyAndCleanArtifacts` against a temp dir (mismatch deletes the file; missing-file fails; deleteOnMismatch=false keeps the file).
- Backfill model_version-aware selection: `backfill-clip-embeddings-reembed.test.ts` reads the action source and the sidecar script, asserts `eq(imageEmbeddings.modelVersion, modelVersion)` in both and that `const modelVersion =` is hoisted above `notExists(`.
- Rate-limit pre-increment / rollback: `semantic-search-rate-limit.test.ts` — bucket fill, window expiry, IP independence, rollback from count 1 (entry deletion), multi-rollback, no-op on missing entry.
- `clampSemanticTopK`: `semantic-search-params.test.ts` — 15 cases covering boolean/array/object/NaN/Infinity/numeric-string rejection.
- CLIP path layout / revision-subdir: `clip-paths.test.ts` — path-doubling regression asserted absent, revision-subdir depth, 40-hex pin, model-id 2-segment guard.

**Lint-gate fixture tests:**
- `check-api-auth.test.ts`: scanner imported directly, exercised against real source fixtures; would catch a new admin route missing `withAdminAuth`.
- `check-action-origin.test.ts`: scanner walks the real `src/app/actions/` directory at test time — any new file is automatically picked up.
- `check-public-route-rate-limit.test.ts`: covers function-declaration, variable-export, export-specifier, and exempt-tag forms; semantic POST covered by `preIncrementSemanticAttempt` call; similar GET is correctly excluded (GET is out of scope per the documented policy).
- `privacy-fields.test.ts`: symmetric guard (`admin-only keys == SENSITIVE_KEYS exactly`) is in place and would catch a new admin-only schema column that is neither added to `SENSITIVE_KEYS` nor to `publicSelectFields`. Timeline mirror test included.
- `sw-template-contract.test.ts`: reads both `public/sw.template.js` AND the committed `public/sw.js` — a build-step that stamps `sw.js` differently from the template will be caught.
- `migration-journal-monotonicity.test.ts` + `migration-journal.test.ts`: two overlapping tests check the non-monotonic `when` allowlist and the `migrate.js` post-condition throw. Would catch a new migration with a stale `when`.

**Backfill runner:**
- Fatal-counter honesty: `admin-backfill-runner-fatal-counters.test.ts` — fatal-only run, mixed run (processed=1 + errors=1 simultaneously), corrupt-width skip.
- Pool-budget cap: `admin-backfill-concurrency-cap.test.ts` — 8 arithmetic cases including small-pool degenerate and large-pool scaling.

**Privacy / data-layer:**
- `privacy-fields.test.ts`: enrichment SELECTs in both CLIP routes exclude GPS/filename_original/ICC/HDR per the compile-time guard; no drift detected.

**Model-weight-gated suites** (`clip-offline-load.test.ts` × 2, `clip-semantic-integration.test.ts` × 2): skip by design — correct, not a gap.

---

## Summary

**1 genuine finding (MEDIUM).** All 4 prior-cycle items (TE-C9-01 through TE-C9-04) are confirmed closed. The test surface is in strong shape for a cycle-10 convergence state.

| ID | Severity | Description |
|----|----------|-------------|
| TE-C10-01 | MEDIUM | `similar-route.test.ts` mock `images` schema omits `lens_model`/`capture_date`; 200-path test cannot catch their removal from the route SELECT |

No CRITICAL or HIGH gaps found across all 236 test files.
