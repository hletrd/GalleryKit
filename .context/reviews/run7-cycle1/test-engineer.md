# Test Engineer Review — Run-7 Cycle-1 (HEAD `17f743f7`)

**Date:** 2026-06-18
**Agent:** test-engineer
**Scope:** `apps/web/src/__tests__/` (Vitest unit, 241 files / ~2140 cases), `apps/web/e2e/` (Playwright, 5 spec files), inline lint/audit tests.

## Summary

**Coverage:** Broad and disciplined. The suite follows a consistent source-contract pattern for documented invariants, with proven-RED guards on the load-bearing ones.
**Test Health:** HEALTHY. Full suite **2231 passed / 4 skipped / 0 failed** (fresh foreground run, 18.3s). The 4 skips are model-weight-gated CLIP suites (by design).
**Prior-cycle verification:** AGG-C11-01 (semantic similarity-selector contract) is **CONFIRMED CLOSED** at commit `2fc9a23f` — a 75-line source-contract test at `semantic-similarity-selector-contract.test.ts` pins the guarded ternary, the corrupting unconditional shape, and the rationale comment. Verified non-vacuous per the commit message (temporary mutation fails the test).

**Findings: 1 MEDIUM (spec-correctness, cross-confirmed with document-specialist R7C1-F1), 2 LOW (coverage gaps).**

---

## Findings

### TE-R7C1-01 [MEDIUM] — NCLX matrix code 8 mapped to `bt2020-ncl`; spec says YCgCo (cross-confirmed R7C1-F1)

**Confidence:** HIGH (independently verified against ITU-T H.273:2024-07 Table 4)
**Where (source):** `apps/web/src/lib/color-detection.ts:207`
```ts
const NCLX_MATRIX_MAP: Record<number, ColorSignals['matrixCoefficients']> = {
    0: 'identity',
    1: 'bt709',
    8: 'bt2020-ncl', // R5-M1: ITU-T H.273 Table 4 value 8 = BT.2020 NCL (same as 9)  ← WRONG
    9: 'bt2020-ncl',
    10: 'bt2020-cl',
};
```
**Where (test asserts the wrong behavior):** `apps/web/src/__tests__/color-detection.test.ts:294-298`
```ts
// R5-M1: ITU-T H.273 Table 4 value 8 = BT.2020 NCL (same as 9)
it('maps nclx matrix=8 to bt2020-ncl', async () => {
    const signals = await detectFromNclx(1, 1, 8);
    expect(signals.matrixCoefficients).toBe('bt2020-ncl');  ← asserts the wrong spec
});
```

**Problem:** Per **ITU-T H.273 (V4, 2024-07-14) Table 4 "Matrix coefficients"**, value `8` is **YCgCo** (the Y-Co-Cg color space, a simple RGB transform), NOT BT.2020 NCL. Value `9` is BT.2020 NCL; value `10` is BT.2020 CL. The code comment ("value 8 = BT.2020 NCL (same as 9)") is spec-incorrect, and the test at line 295 **locks in the wrong behavior** — meaning a future contributor who corrects the mapping to `8: 'ycgco'` would FAIL this test and likely "fix" it by reverting the source.

I independently verified this via web search (ITU-T H.273 e-publication + Rust `ssimulacra2` docs `MatrixCoefficients::YCgCo = 8`) — I agree with the document-specialist's R7C1-F1 flag.

**Why MEDIUM (not LOW):**
- This is a **spec-correctness** defect on the admin-only `matrix_coefficients` audit column. The wrong label is surfaced to admins in the Color Details panel for any HEIF/AVIF source that carries NCLX matrix code 8 (YCgCo sources — rare in photography but possible from screen-recording / game-capture pipelines transcoded to HEIF).
- The test is **actively harmful**: it prevents the correct fix from landing cleanly. A test that asserts wrong spec behavior is worse than no test.
- Not HIGH because: (a) the column is admin-only (not public); (b) YCgCo sources are uncommon in a photo gallery; (c) `matrix_coefficients` does not drive any encoder decision (it is a display-only audit field) — the downstream `resolveColorPipelineDecision` keys off primaries + ICC, not matrix.

**Suggested fix (test + source):**
1. The `ColorSignals['matrixCoefficients']` type and the `matrix_coefficients` DB column currently have no `'ycgco'` value. Add it to the enum/union (and any validation surface).
2. Update `NCLX_MATRIX_MAP`: `8: 'ycgco'` (keep `9: 'bt2020-ncl'`, `10: 'bt2020-cl'`).
3. Update the test to assert the correct spec: `expect(signals.matrixCoefficients).toBe('ycgco')` and rename the test to `'maps nclx matrix=8 to ycgco (ITU-T H.273 Table 4)'`.
4. Audit whether any i18n label / admin UI renders the new `'ycgco'` value; add a label key if needed.

**TDD note:** This is a case where the existing test was written to mirror an incorrect implementation (the exact anti-pattern in my role's Failure Modes). The test should have been written from the spec, not from the code. The fix is to correct BOTH the source and the test so the test documents the spec.

---

### TE-R7C1-02 [LOW] — Stripe webhook POST handler has NO behavioral test (source-contract only)

**Confidence:** HIGH (exhaustive grep confirmed)
**Where:** `apps/web/src/app/api/stripe/webhook/route.ts` (454 lines, the entire POST handler)
**Test coverage:** `apps/web/src/__tests__/stripe-download-tokens.test.ts:137-200` — 6 source-contract (structural) tests only. They read the route source via `fs.readFileSync` and assert presence of `constructStripeEvent`, `stripe-signature`, `request.text()`, `runtime = 'nodejs'`. **The POST handler is never imported or invoked in any test.**

**Problem:** The webhook route is ~400 lines of dense, money-handling logic with 15+ distinct branches, and NONE of them are exercised behaviorally:
- `payment_status !== 'paid'` gate (the documented C3-RPF-01 / CRT-R5C1-04 async-payment no-op) — untested.
- `customerEmail.length > 255` reject (C5-RPF-06) — untested.
- `EMAIL_SHAPE` malformed reject — untested.
- `missing required metadata` reject — untested.
- `unknown+<sessionId>@stripe.local` sentinel for missing email (D-101-04) — untested.
- `isPaidLicenseTier` reject — untested.
- `invalid imageId` reject — untested.
- **deleted-image 200 + manual-refund log** (COR-R4C18-02) — untested.
- tier-mismatch warn (C4-RPF-02) — untested.
- zero-amount reject (C3-RPF-02) — untested.
- **idempotent skip on existing sessionId** (C3-RPF-07) — untested.
- **`insertedFresh = affectedRows === 1 && insertId > 0` disambiguation** (COR-R4C3-02, the subtle mysql2 FOUND_ROWS fix) — untested.
- `ER_NO_REFERENCED_ROW_2` catch → 200 manual-refund (COR-R4C18-02 belt-and-suspenders) — untested.
- `LOG_PLAINTEXT_DOWNLOAD_TOKENS` opt-in log line — untested.

**Why LOW (not MEDIUM):**
- The route IS covered by source-contract tests for the most security-critical invariant (signature verification before any DB work), and the card-only checkout pin is locked at `checkout-route.test.ts:211`.
- The individual PRIMITIVES are tested (`generateDownloadToken`, `verifyTokenAgainstHash`, `isPaidLicenseTier`, `hasMySQLErrorCode`).
- The `idempotent skip` and `insertedFresh` logic is the highest-risk untested branch (the COR-R4C3-02 fix was a real bug where mysql2's default FOUND_ROWS flag made a dup-key loser report `affectedRows=1`, indistinguishable from a fresh insert, logging a dead plaintext token). A behavioral test here would be genuinely valuable.
- However, behavioral testing this route requires mocking Stripe's `constructStripeEvent` to return synthetic `Stripe.Event` objects, plus mocking the full `db` surface — a meaningful lift. The source-contract tests catch structural regressions (removing the signature check, switching to edge runtime).

**Why it matters:** A refactor that subtly breaks the `insertedFresh` disambiguation (e.g. simplifying to `affectedRows === 1`) would log plaintext download tokens whose hashes are never stored — handing operators dead credentials — with zero failing test. This is exactly the "mocks that hide bugs" pattern: the structural tests prove the shape is present but not that the behavior is correct.

**Suggested test (highest-value subset):**
```ts
// Mock constructStripeEvent → synthetic checkout.session.completed with payment_status='paid'
// Mock db.select (existing entitlement) → [] (no prior row)
// Mock db.insert → { affectedRows: 1, insertId: 999 } (fresh)
// Assert: response 200, generateDownloadToken called once, console.info 'Entitlement created' called
//
// Then: Mock db.insert → { affectedRows: 1, insertId: 0 } (dup-key loser per COR-R4C3-02)
// Assert: response 200, NO 'Entitlement created' log, NO plaintext token log (dead-token guard)
```
This single test would lock the most subtle untested invariant in the route.

---

### TE-R7C1-03 [LOW] — Semantic route malformed-embedding skip behavior untested at route level

**Confidence:** HIGH
**Where (source):** `apps/web/src/app/api/search/semantic/route.ts:263-279` — the `.map(...).filter(m => m !== null)` block with the AGG-C10-01 comment.
**Where (test gap):** `apps/web/src/__tests__/semantic-search-route.test.ts` — the three route-level cases are:
1. `returns 200 with empty results when no embeddings match` (line 216) — empty rows.
2. `returns 200 with enriched results on successful search` (line 223) — ONE valid embedding.
3. `returns 500 and rolls back rate limit when embedding scan fails` (line 281) — DB reject.

**Problem:** No test exercises the documented AGG-C10-01 fix at the route integration level: when the scan returns a MIX of valid and malformed (null-decoding) embeddings, the valid ones are returned and the malformed ones are silently skipped (previously every row was silently dropped). The unit-level `decodeEmbeddingColumn` tests at `clip-embedding-column-roundtrip.test.ts:84-93` cover the decoder returning null for bad inputs, but the route's `.filter(m => m !== null)` skip-plural-while-preserving-valid behavior is not pinned at the route level.

**Why LOW:**
- The decoder primitive IS thoroughly tested (5 cases including null/wrong-length/non-buffer).
- A refactor would have to both break the decoder AND remove the filter to cause a regression — two changes.
- The route test DOES cover the happy-path single-valid-embedding case, which proves the decode→score→enrich pipeline works end-to-end.
- The "every row silently dropped" bug was a decoder bug (base64-vs-Buffer), not a route-filter bug — and that decoder bug IS locked.

**Why it matters:** The AGG-C10-01 comment at route.ts:263-265 explicitly calls out "previously every row was silently dropped" — but there is no test that would catch a regression where the filter is removed (returning malformed rows that crash `cosineSimilarity`) OR where the filter is over-aggressive (filtering valid rows). A single test mixing one valid + one null-decoding embedding, asserting exactly one result returns, would close this.

**Suggested test:** Add to `semantic-search-route.test.ts`:
```ts
it('skips malformed (null-decoding) embeddings while returning valid ones (AGG-C10-01)', async () => {
    const validBuf = Buffer.alloc(2048); validBuf.fill(0);
    // A 100-byte buffer decodes to null (wrong length) — simulate a corrupt row
    const malformedBuf = Buffer.alloc(100);
    const mockEmbeddingRows = [
        { imageId: 1, embedding: validBuf.toString('base64') },      // valid
        { imageId: 2, embedding: malformedBuf.toString('base64') },  // null-decoding
    ];
    // ... mock dbSelect to return both rows, mock image enrichment for id=1 only
    // Assert: response 200, results.length === 1, results[0].imageId === 1
});
```

---

## Coverage examined (no findings)

The following surfaces were investigated and found to have ADEQUATE coverage — no gaps worth scheduling:

**CLIP semantic search routes** (`semantic-search-route.test.ts`, `semantic-route-production.test.ts`, `semantic-search-rate-limit.test.ts`, `semantic-search-params.test.ts`, `semantic-search-mode-validator.test.ts`):
- 403 same-origin, 503 maintenance, 400 invalid JSON / body shape / short query, 413 payload, 429 rate-limit, 503 disabled-mode + rollback, 500 scan-failure + rollback, 200 stub happy-path, 200 production-mode (real encoder) happy-path — all covered.
- Production/stub/disabled branches: covered. The `SEMANTIC_SEARCH_ALLOW_PRODUCTION` resolver gate is covered in `gallery-config-semantic-production.test.ts` + `gallery-config.test.ts`.
- Rate-limit rollback on ALL three early-return paths (503 disabled, 503 embed-fail, 500 scan-fail): covered with explicit `rollbackSemanticAttemptMock` assertions. The 429 path correctly does NOT rollback (it's the pre-increment count).

**Stripe checkout card-only pin** (`checkout-route.test.ts:204-211`): VERIFIED STILL LOCKS. The test asserts `sessionPayload.payment_method_types` toEqual `['card']` exactly, with the AGG-H1 / CRT-R5C1-04 comment explaining the async-payment-method gate. A drop of the pin fails the test.

**Image processing pipeline edge cases:**
- Wide-gamut downscale cap (WI-15, `process-image.ts:1004-1042`): the `WIDE_GAMUT_MAX_SOURCE_PIXELS` threshold + `Math.sqrt` proportional downscale is exercised via `process-image-color-roundtrip.test.ts` and `process-image-icc-options-lockin.test.ts`. The 50 MP default is pinned in `settings-hash.test.ts` and `privacy-fields.test.ts`.
- 10-bit AVIF fallback (`canUseHighBitdepthAvif` Promise-singleton + per-image 8-bit fallback): `process-image-color-roundtrip.test.ts:318-347` exercises BOTH branches (`if (probe) { expect 10-bit } else { expect 8-bit fallback }`). Solid.
- Delete-during-reencode cleanup: heavily covered across BOTH paths — in-app runner (`admin-backfill-runner-deleted-mid-reencode.test.ts`, `-detection-failure.test.ts`) AND sidecar (`backfill-color-pipeline-deleted-mid-reencode.test.ts`). The `affectedRows===0 → deleteImageVariants(dir, fn, [])` contract is pinned with proven-RED guards (dropping the filter or changing `[]` to default sizes fails the test).

**Backfill runner concurrency cap** (`admin-backfill-concurrency-cap.test.ts`): Excellent coverage. 8 tests covering the AGG-5 reserved-headroom formula, clamping, min-1 floor, fractional flooring, small-pool edge cases, large-pool scaling, and the core invariant `limit - worstCaseHeld >= reserved`.

**Server action auth guards** (`action-guards.test.ts`, `check-action-origin.test.ts`): The `requireSameOriginAdmin` primitive is tested for both valid + invalid origin branches. The `lint:action-origin` scanner covers every mutating export in `app/actions/` with fixture-based coverage. The e2e `origin-guard.spec.ts` covers the cross-origin rejection end-to-end.

**Color detection precedence (NCLX > ICC chromaticity > ICC name)**: covered in `color-detection.test.ts` — the NCLX branch, ICC chromaticity fallback (`promotes opaquely-named ICC to adobergb via chromaticity fallback`), and ICC name allowlist all have tests. The precedence ORDERING itself is implicitly covered by the NCLX-first structure of `detectColorSignals`.

**TDD / non-vacuity discipline:** The repo has a strong "proven NON-VACUOUS" convention — many test headers explicitly state "dropping X fails the test" or "verified by temporary mutation." Spot-checked: `backfill-color-pipeline-deleted-mid-reencode.test.ts:24`, `semantic-similarity-selector-contract.test.ts` (commit message), `clip-embedding-column-roundtrip.test.ts:55-74` (DEMONSTRATES old read would have failed). This is exemplary.

**Timing / isolation:** No `useFakeTimers` needed in the view-count flush test because it is a source-contract test (reads source text, no runtime). The rate-limit tests use deterministic mock functions (not real timers). No `Date.now()`-dependent assertions without injection found in the spot-check.

**Tautology spot-check:** The source-contract tests are the repo's established pattern for pinning documented invariants (see the lineage: `search-short-query-guard`, `clip-model-contract`, `image-queue-embed-wiring`, `semantic-similarity-selector-contract`). They are NOT tautological when they pin a specific guarded shape against a plausible corrupting refactor — and the convention of stating the mutation that fails makes this verifiable. The `data-tag-names-sql.test.ts` fixture is a good example of a behavioral (non-tautological) contract test.

---

## Test baseline (fresh foreground run)

```
> vitest run
 Test Files  237 passed | 2 skipped (239)
      Tests  2231 passed | 4 skipped (2235)
   Duration  18.28s
```
The 4 skips are `clip-offline-load` (×2) + `clip-semantic-integration` (×2), gated on `CLIP_MODELS_ROOT` weights being present — by design, not failures.

---

## Recommendation

- **TE-R7C1-01 (MEDIUM):** Schedule. This is a spec-correctness defect where the TEST asserts the wrong behavior, blocking the correct fix. Coordinate with document-specialist R7C1-F1 (same finding, doc angle). Requires a `'ycgco'` enum value addition + source + test + i18n label. Test-only in the narrow sense (the column is admin-only display), but the test fix is the blocking piece.
- **TE-R7C1-02 (LOW):** Defensible to defer. The webhook's signature-verification invariant (the security-critical piece) IS source-contract pinned. The highest-value follow-up is a behavioral test for the `insertedFresh` disambiguation (COR-R4C3-02) — that is the subtle real-bug fix with no behavioral coverage.
- **TE-R7C1-03 (LOW):** Defensible to defer. The decoder primitive is thoroughly tested; this is a route-integration nicety. One small test would close it cleanly.

**Net: 1 MEDIUM (spec-correctness, schedule), 2 LOW (defensible defer).** The suite is healthy, disciplined, and follows strong TDD/non-vacuity conventions. The MEDIUM finding is notable precisely because it is the one place the repo's otherwise-exemplary test discipline locked in a spec error instead of catching it.
