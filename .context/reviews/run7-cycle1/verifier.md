# Verifier — Run-7 Cycle-1 (evidence-based correctness check)

**Date:** 2026-06-18
**HEAD:** `17f743f7` (docs(claude): record 2026-06-17 disk-full incident + SSH-wedged recovery)
**Prior context:** Run-6 c11 (HEAD `a7de3ebd`) — verifier reported 0 blockers, gates green (ESLint 0, typecheck 0, Vitest 2227 passed/4 skipped/0 failed, 3 custom lint gates 0). AGG-C11-01 fixed in `2fc9a23f`. DEF-C11-01 deferred LOW.
**Angle:** evidence-based correctness — every gate run fresh by this verifier; every claim cross-checked against code; test adequacy spot-checked.

---

## Verdict
**Status:** PASS
**Confidence:** high
**Blockers:** 0

All 7 gates green with fresh exit codes captured below. All three run-6 carry-over fixes (AGG-C10-01 nginx body cap, AGG-C10-02 similar-route guard, AGG-C11-01 semantic selector contract) verified present at HEAD with non-tautological evidence. The 4 Vitest skips are honestly env-gated on real CLIP model weights, not failure-hiders. Spot-checked tests assert real input→output contracts.

---

## Evidence — Gates (fresh foreground/background runs at HEAD `17f743f7`)

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| ESLint | PASS | `npm run lint --workspace=apps/web` | exit 0 |
| lint:api-auth | PASS | `npm run lint:api-auth --workspace=apps/web` | exit 0 |
| lint:action-origin | PASS | `npm run lint:action-origin --workspace=apps/web` | exit 0 |
| lint:public-route-rate-limit | PASS | `npm run lint:public-route-rate-limit --workspace=apps/web` | exit 0 |
| typecheck | PASS | `npm run typecheck --workspace=apps/web` | exit 0 (app + scripts) |
| Vitest | PASS | `npm test --workspace=apps/web` | exit 0 — **2231 passed / 4 skipped / 0 failed** (237 files passed / 2 skipped), 25.23 s |
| Next.js prod build | PASS | `npm run build --workspace=apps/web` | exit 0 — all routes compiled (admin, public, API, OG, semantic, similar, stripe webhook), no errors/warnings |

### Test-count delta vs run-6 c11
- Run-6 c11 baseline (HEAD `a7de3ebd`, pre-fix): **2227 passed / 4 skipped**.
- Run-7 c1 (HEAD `17f743f7`, post-`2fc9a23f`): **2231 passed / 4 skipped**.
- Delta = **+4 passed**, matching exactly the 4 `it()` blocks in the new `semantic-similarity-selector-contract.test.ts` (AGG-C11-01 fix). Skip count unchanged at 4 (same model-weight-gated suites). No tests were silently removed or recategorized.

---

## Acceptance Criteria — Run-6 carry-over fixes

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | AGG-C10-01: nginx LR upload body cap — `^~ /api/admin/lr/upload` must carry `client_max_body_size 216M` and win over the generic `^~ /api/admin/` 2M cap | VERIFIED | `apps/web/nginx/default.conf:131-132` — `location ^~ /api/admin/lr/upload { client_max_body_size 216M; … }` with the AGG-C10-01 lineage comment at L126-130. The competing generic block is at L148-149 (`^~ /api/admin/` → `2M`). Longest-prefix `^~` match (22 chars vs 14 chars) makes the LR block win regardless of source ordering. No `=` exact or regex location intercepts the path. |
| 2 | AGG-C10-02: similar-route test must assert `lens_model` + `capture_date` so a SELECT-drop fails loudly | VERIFIED | `apps/web/src/__tests__/similar-route.test.ts:270-271` populates `lens_model: 'EF 50mm f/1.8'` + `capture_date: '2026-01-02 03:04:05'` in `imageRows`; `:292-293` asserts `expect(neighbour).toHaveProperty('lens_model', 'EF 50mm f/1.8')` and `toHaveProperty('capture_date', '2026-01-02 03:04:05')`. NOT a tautology — if the route drops the SELECT columns, the response field goes `undefined` and `toHaveProperty` with a value argument fails. Cross-checked against real route: SELECTs + maps both fields (`app/api/search/similar/[id]/route.ts`). |
| 3 | AGG-C11-01: semantic selector source-contract pin for `isProd ? dotProduct : cosineSimilarity` | VERIFIED | `apps/web/src/__tests__/semantic-similarity-selector-contract.test.ts` — 4 tests: L48-53 asserts the guarded ternary via regex `/const\s+similarity\s*=\s*isProd\s*\?\s*dotProduct\s*:\s*cosineSimilarity\b/`; L55-63 negative-pins BOTH corrupting shapes (`const similarity = dotProduct;` AND `const similarity = cosineSimilarity;`); L65-67 pins the `isProd` discriminator derivation; L69-74 pins the rationale comment. Landed in commit `2fc9a23f` ("test(search): pin semantic dotProduct/cosineSimilarity selector contract (AGG-C11-01)"). Source line still present at `app/api/search/semantic/route.ts:271`. NOT a tautology — a refactor that flattens the ternary to `const similarity = dotProduct;` (the documented corrupting shape for stub-mode rankings) now fails the negative-pin test. |

---

## Test adequacy spot-check (anti-tautology audit)

Three tests inspected for whether they actually assert what their names claim:

| Test file | Claim | Substantive? | Evidence |
|-----------|-------|--------------|----------|
| `__tests__/similar-route.test.ts` | "asserts lens_model + capture_date enrichment" | YES | Distinct fixture values (`'EF 50mm f/1.8'`, `'2026-01-02 03:04:05'`) asserted via `toHaveProperty` with value argument — a SELECT-drop produces `undefined` ≠ the asserted value → failure. |
| `__tests__/privacy-fields.test.ts` | "public/timeline select fields omit sensitive contract keys; admin-only keys match SENSITIVE_KEYS symmetrically" | YES | L89 `expect(adminOnlyKeys).toEqual(sensitiveSorted)` — set equality between derived admin-only keys and the contract fixture. L57-59 / L101-103 iterate every `SENSITIVE_KEYS` entry asserting `.not.toContain(key)` on public/timeline selections. A leaked field fails loudly. |
| `__tests__/csv-escape.test.ts` | "escapes formula injection, strips control/bidi chars" | YES | Concrete byte-level input→output pairs: `'=SUM(A1)' → '"\'=SUM(A1)"'` (L41), `'a\x00b\x01c' → '"abc"'` (L24), `'ab‮cd' → '"abcd"'` (L92, bidi override strip), CRLF collapse `'a\r\r\nb' → '"a b"'` (L37). Real escape contracts, not tautologies. |

No tautological tests found in the spot check.

---

## Model-weight-gated skip audit (4 skips)

The 4 Vitest skips are honestly gated on real CLIP model weights, not hiding failures:

| Test file | Gating mechanism | Honest? |
|-----------|------------------|---------|
| `__tests__/clip-offline-load.test.ts` (×2 tests) | `clip-offline-load.test.ts:32-41` — `SEEDED = process.env['CLIP_OFFLINE_LOAD'] === '1' && !!ROOT && existsSync(<exact-pinned-revision-model_quantized.onnx>)`; `d = SEEDED ? describe : describe.skip`. Requires BOTH the env flag AND the seeded `.onnx` file at the exact pinned revision path (`jinaai/jina-clip-v2/e10d47f…/onnx/model_quantized.onnx`). | YES — strict double-gate on a real file path. No weight file → skip. |
| `__tests__/clip-semantic-integration.test.ts` (×2 tests) | `clip-semantic-integration.test.ts:30-31` — `RUN = process.env['CLIP_INTEGRATION'] === '1'`; `d = RUN ? describe : describe.skip`. | YES — explicit env flag, documented in header comment ("Default CI (no model weights) skips the whole suite via describe.skip"). |

2 skipped files × 2 tests each = 4 skipped tests — matches the run-6 c11 baseline exactly. When the gates ARE satisfied (operator runs with weights + env), the tests execute and assert real semantic behavior (argmax + ≥ 0.03 lead for `red-flower` over `beach-sunset`/`snowy-mountain`/`city-night` in EN+KO). Not failure-hiders.

---

## Gaps
None at blocker or action level. Optional observations only:

- **[INFO]** Run-6 c11 deferred item DEF-C11-01 (search dialog `<Input>` is `h-8` = 32 px, `components/search.tsx:374`) remains in deferred state. The repo's `touch-target-audit.test.ts` deliberately excludes `<Input>` from scope, so this is a documented policy exemption, not a test gap. Single-line full-width text field (large horizontal hit target); vertical-only shortfall. No change since c11. Severity LOW, carried forward per deferred-fix rules.
- **[INFO]** The 4 model-weight-gated CLIP tests cannot be exercised in this verifier's environment (no `CLIP_MODELS_ROOT` weights seeded). This is the documented design — the gating is honest and the tests have been exercised in production activation per the run-6 review trail. Not a verification failure; recorded for transparency.

---

## Recommendation
**APPROVE**

All 7 gates green with fresh exit codes; all 3 run-6 carry-over fixes (AGG-C10-01/C10-02/C11-01) verified present at HEAD with non-tautological evidence; test delta matches the AGG-C11-01 fix exactly (+4); 4 skips are honestly model-weight-gated; spot-checked tests assert real byte-level and set-equality contracts. No new findings.
