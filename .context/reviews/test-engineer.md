# Test-Engineer Review — Run-6 Cycle-11 (HEAD `a7de3ebd`)

**Date:** 2026-06-17
**Suite state (verified):** 2227 passed / 4 skipped (model-weight-gated by design) / 0 failed.
**Test files:** 236 unit/integration + 2 skipped suites (gated) + 5 Playwright e2e specs.

---

## Method

Full inventory of all 236 test files under `apps/web/src/__tests__/` plus 5 Playwright e2e specs.
For each area traced: (1) implementation location in source, (2) whether a test pins the invariant, (3) what failure scenario an absent or vacuous test would miss.
Sources read directly for every finding — no sampling.

---

## Cycle-10 Finding Confirmed Closed

**TE-C10-01** (`similar-route.test.ts` mock schema omitting `lens_model`/`capture_date`) is confirmed fixed at HEAD (commit `563d09d3`).

- `lens_model` and `capture_date` are now declared in the `vi.mock('@/db')` `images` object at lines 116–118.
- The `imageRows` fixture in the 200-path test populates both fields with real values.
- Assertions `toHaveProperty('lens_model', 'EF 50mm f/1.8')` and `toHaveProperty('capture_date', '2026-01-02 03:04:05')` are present and load-bearing — a SELECT-drop of either field would blank the mock return and fail these checks.

The fix genuinely guards the contract it claims to guard. No false-confidence issue.

---

## Findings

### TE-C11-01 [LOW] — semantic route `isProd ? dotProduct : cosineSimilarity` selector has no source-contract pin

**Source:** `apps/web/src/app/api/search/semantic/route.ts`, line 271.

```ts
const similarity = isProd ? dotProduct : cosineSimilarity;
```

**Documented invariant (comment at lines 267–270 of the same file):**
> "STUB embeddings are NOT normalized (deterministicEmbedding returns raw [-1,1]), so stub MUST keep cosineSimilarity or ranking would be corrupted. Gate on isProd."

**Why this gap is real:** The invariant is explicitly documented as load-bearing. `dotProduct` is only a valid cosine-similarity shortcut when both operands are L2-normalized unit vectors. The production encoder path (`embedTextReal` / `embedImageReal` in `clip-model.ts`) always passes through `truncateAndNormalize`, so production vectors satisfy the unit-length precondition. The stub path (`embedImageStub` / `embedTextStub` in `clip-inference.ts`) returns raw hash-based `[-1, 1]` values that are NOT normalized — using `dotProduct` on unnormalized stub vectors would produce inflated or deflated scores depending on vector magnitude, silently corrupting stub search rankings.

**The silent refactor scenario:** A contributor simplifying the selector — for example, removing the `isProd` ternary and always using `dotProduct` for performance — would corrupt stub-mode search results without failing any existing test. The `semantic-search-route.test.ts` 200-path test (`returns 200 with enriched results`) uses mock embedding values produced by `fill(0.5)` and `fill(0.1)`, which happen to have near-unit magnitude due to how `Float32Array.fill` interacts with 512 dimensions. The score difference between `dotProduct(fill(0.5), fill(0.5))` and `cosineSimilarity(fill(0.5), fill(0.5))` for those specific values is essentially zero, so the test passes regardless of which function is selected.

**Verification that no test pins this:** Exhaustive grep for `dotProduct`, `isProd`, `const similarity`, and `similarity.*=.*isProd` across all 236 test files found zero matches outside of `clip-embedding-column-roundtrip.test.ts` (which tests `dotProduct` as a pure function in isolation, not the route's branch selector). The three test files that import the semantic route source (`semantic-search-params.test.ts`, `semantic-route-production.test.ts`, `semantic-search-route.test.ts`) contain no reference to `dotProduct`, `isProd`, or `const similarity`.

**Assertion to add** — a source-contract test consistent with the existing pattern in `image-queue-embed-wiring.test.ts`, `search-short-query-guard.test.ts`, and the cycle source-contract files:

```ts
// In a new or existing source-contract test file:
const SRC = readFileSync(
    join(process.cwd(), 'src/app/api/search/semantic/route.ts'), 'utf8'
);

it('stub mode selects cosineSimilarity and production selects dotProduct (AGG-C8-09 invariant)', () => {
    // Must contain the guarded ternary exactly.
    expect(SRC).toMatch(
        /const\s+similarity\s*=\s*isProd\s*\?\s*dotProduct\s*:\s*cosineSimilarity/
    );
    // Must NOT assign dotProduct unconditionally (would corrupt stub rankings
    // because stub vectors are NOT L2-normalized).
    expect(SRC).not.toMatch(/const\s+similarity\s*=\s*dotProduct\b/);
});
```

**Confidence:** Low-to-Medium. The invariant is clearly documented in source and the refactor path (performance simplification) is plausible. The severity is LOW because: (a) stub mode is the demo/experimental posture and a ranking regression there is not a security or data-integrity issue; (b) the behavioral tests do not actively misreport — they just fail to catch the wrong branch. Raising to MEDIUM would require the stub path being used in production, which the `semanticSearchMode` double-gate prevents.

---

## Verified Clean — Full Surface Sweep

**Cycle-10 finding:** TE-C10-01 confirmed closed (see above).

**CLIP semantic search pipeline:**
- Same-origin 403, maintenance 503, short-query 400, disabled 503: covered in `semantic-search-route.test.ts` (12 cases) and `similar-route.test.ts` (10 cases including AGG-C9-03/04 additions).
- `lens_model` + `capture_date` in similar-route 200-path: confirmed fixed at HEAD.
- Model-version WHERE filter: `similar-route.test.ts` `filters the embedding scan on PRODUCTION_MODEL_VERSION via where()`.
- `semanticSearchMode` double-gate (heal to disabled / pass-through with env opt-in): `gallery-config.test.ts` — two explicit env-restore test cases.
- `decodeEmbeddingColumn` MEDIUMBLOB round-trip: `clip-embedding-column-roundtrip.test.ts` — raw-Buffer, legacy-base64-in-Buffer, defensive-string, null/wrong-length paths, non-vacuity demonstration.
- `dotProduct` equals `cosineSimilarity` for unit vectors: `clip-embedding-column-roundtrip.test.ts` lines 102–115 — correctness proven for the fast path itself. (The branch selector in the route is the gap above.)
- `normalizeEmbedding` / `truncateAndNormalize`: `clip-embeddings-normalize.test.ts` — unit-length output, zero-vector safety, 1024→512 truncation.
- `clampSemanticTopK`: `semantic-search-params.test.ts` — 15 cases.
- Rate-limit rollback paths: `semantic-search-rate-limit.test.ts`.
- `clip-model-contract.test.ts`: pins `truncateAndNormalize` use, `CLIP_MODELS_ROOT`, sRGB preprocessing, HF revision pin, `server-only` absence.
- `image-queue-embed-wiring.test.ts`: pins `embedImageReal`, `PRODUCTION_MODEL_VERSION`, `embeddingToBuffer` (no base64 write), stub/production branching presence.

**Lint-gate fixture tests:** All four lint gates (`check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`, ESLint) have fixture-based coverage and walk the live source tree at test time.

**Privacy / data-layer:** `privacy-fields.test.ts` — symmetric guard catches any new schema column that is neither added to `SENSITIVE_KEYS` nor to `publicSelectFields`. No drift detected.

**OG sanitization global replace:** `og-sanitize.test.ts` and `sanitize-for-og-global.test.ts` — all three consuming files import `sanitizeForOg` from the shared module; non-global `.replace(UNICODE_FORMAT_CHARS` call form forbidden.

**Blur-data-url wiring:** `process-image-blur-wiring.test.ts` and `images-action-blur-wiring.test.ts` — producer and consumer both pinned.

**Backfill runner:** Fatal-counter honesty (fatal-only, mixed, corrupt-width) and pool-budget cap — all covered.

**Touch-target audit:** `touch-target-audit.test.ts` — 44 px floor, multi-line normalization, `Badge asChild`, native `<select>`.

**Model-weight-gated suites** (`clip-offline-load.test.ts` × 2, `clip-semantic-integration.test.ts` × 2): skip by design — not a gap.

---

## Summary

**1 genuine finding (LOW).** TE-C10-01 is confirmed closed. The test surface is in strong convergence shape.

| ID | Severity | Contract at risk | Refactor that breaks silently |
|----|----------|------------------|-------------------------------|
| TE-C11-01 | LOW | `const similarity = isProd ? dotProduct : cosineSimilarity` in `app/api/search/semantic/route.ts:271` — stub rankings would be corrupted if `dotProduct` is used on unnormalized stub vectors | Simplifying the ternary to always use `dotProduct` for performance |

No CRITICAL or HIGH gaps found across all 236 test files.
