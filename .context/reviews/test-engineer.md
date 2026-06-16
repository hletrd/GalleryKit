# Test-Engineer Review — GalleryKit (CLIP semantic-search focus)

**Date:** 2026-06-16
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)

**Scope:** Comprehensive test-coverage-gap / test-quality review. Primary fresh-scrutiny
target: the CLIP semantic-search feature added this session (fast-model subagent output).
Non-CLIP surface (cycles 1–9) is at convergence; this pass concentrates fire on CLIP.

**Method:** Read every CLIP source file + every CLIP/semantic/similar/embedding test, ran the
CLIP suites locally (`vitest run`, `CLIP_INTEGRATION` unset = normal CI gate), and verified
each suspected gap against source.

**HARD GUARD respected:** CLIP is dark (`semantic_search_mode='disabled'` default). I did NOT
flip it, download weights, or run prod backfill. All suggested tests below are PROPOSALS, scoped
to run with the stub encoder or pure functions only — none require real weights or production mode.

---

## Test surface inventory (CLIP)

| Test file | Style | What it actually protects |
|---|---|---|
| `clip-embeddings.test.ts` | behavioral (pure fn) | cosine, buffer roundtrip, topK, stub determinism — **strong** |
| `clip-embeddings-normalize.test.ts` | behavioral (pure fn) | `normalizeEmbedding`, `truncateAndNormalize` (1024→512), `PRODUCTION_MODEL_VERSION` shape |
| `clip-model-contract.test.ts` | **source-string contract** | regex-matches `clip-model.ts` source text |
| `clip-semantic-integration.test.ts` | behavioral (real weights) | **`describe.skip` unless `CLIP_INTEGRATION=1` — silently skipped in CI** |
| `download-clip-models.test.ts` | **source-string contract** | regex-matches script source text |
| `backfill-clip-embeddings-reembed.test.ts` | **source-string contract** | regex-matches script source text |
| `image-queue-embed-wiring.test.ts` | **source-string contract** | regex-matches `image-queue.ts` source text |
| `semantic-search-route.test.ts` | behavioral (mocked) | route gates, 403/400/413/429/503/500/200, rollback — **strong** |
| `similar-route.test.ts` | behavioral (mocked) | similar gates, self-exclusion, model-version filter — **strong** |
| `semantic-route-production.test.ts` | behavioral (mocked) | production serves via real encoder, disabled→503 |
| `semantic-search-mode-validator.test.ts` + `gallery-config-semantic-production.test.ts` | behavioral | validator accepts disabled/stub/production (**duplicate pair**) |
| `semantic-search-params.test.ts` | behavioral (pure fn) | `clampSemanticTopK` exhaustively — **strong** |
| `semantic-search-rate-limit.test.ts` | behavioral (pure fn) | pre-increment / rollback / reset — **strong** |
| `search-disclaimer.test.ts` + `search-stale-response.test.ts` + `ime-composition-guard.test.ts` | **source-string contract** | regex-matches `search.tsx` source text |

Local run (CLIP_INTEGRATION unset): **4 files passed, 1 skipped; 45 tests passed, 2 skipped.**
The 1 skipped file / 2 skipped tests are the entire real-ranking integration suite.

The pure-function and mocked-route layers are genuinely good. The weaknesses are concentrated in
(a) the integration suite being invisible in CI, and (b) heavy reliance on source-string contract
tests for the embed hook, the download script's hash-mismatch path, the backfill re-embed logic,
and the search component — none of which execute the code they "cover."

---

## Findings

### F1 — CLIP ranking/smoke test SILENTLY SKIPS in CI (the only test that proves the model works at all) — HIGH / High confidence

**Test:** `src/__tests__/clip-semantic-integration.test.ts:30-31`
**Source:** `src/lib/clip-model.ts` (entire real encoder), `src/lib/clip-embeddings.ts` `truncateAndNormalize`

```ts
const RUN = process.env['CLIP_INTEGRATION'] === '1';
const d = RUN ? describe : describe.skip;
```

Confirmed by local run: with `CLIP_INTEGRATION` unset (the normal `npm test` gate), the whole
suite is `describe.skip` → **2 tests skipped, 0 executed.** This is the ONLY test in the repo that
exercises `embedTextReal` / `embedImageReal` end-to-end and asserts the model produces semantic
(not random) rankings.

**The honest framing:** the gating is *intentional and correct* — CI has no model weights and you
must not bake a 750 MB ONNX download into the gate. But the consequence is that **the entire real
encoder (`clip-model.ts`), the Matryoshka truncation as applied to real 1024-dim output, the Sharp
HWC→CHW preprocessing, the `l2norm_*_embeddings` output-key contract, and the int8/q8 dtype +
pinned-revision wiring have ZERO executed coverage in the normal gate.** Everything protecting that
code is either source-string regex (`clip-model-contract.test.ts`) or this skipped suite.

**Regression that slips through:** a refactor that breaks `embedTextReal` (wrong output key, missing
re-normalize, transposed CHW channels, dtype drift, revision bump that changes output dim) ships
green. `clip-model-contract.test.ts` still passes because the source string `truncateAndNormalize`
is still present — it cannot detect that the *behavior* changed. The first signal would be a
production user getting garbage rankings after the operator flips to `production`.

**Suggested (proposal only — does NOT require flipping the mode):**
1. Make the skip **loud**: add a top-level always-running `it(...)` that `console.warn`s "CLIP
   real-ranking suite SKIPPED — set CLIP_INTEGRATION=1 with weights mounted to validate." Today the
   skip is invisible in summary noise.
2. Wire a **scheduled / nightly job** (not the per-commit gate) that mounts the seeded
   `data/models/clip` volume and runs with `CLIP_INTEGRATION=1`, so the encoder is validated on a
   cadence even though it can't be in the fast gate.
3. Add a **shape-only smoke that runs in CI WITHOUT weights** by mocking `@huggingface/transformers`
   `AutoModel`/`AutoTokenizer` to return a fake 1024-dim `l2norm_text_embeddings` tensor — then assert
   `embedTextReal` returns a 512-dim unit vector and throws when the output key is missing or dim < 512.
   That executes the real `clip-model.ts` control flow (output-key guard, dim guard, truncate call)
   without any download. **This is the single highest-value gap to close.**

---

### F2 — Embed hook in `image-queue.ts` has NO behavioral test — only source-string regex — HIGH / High confidence

**Test:** `src/__tests__/image-queue-embed-wiring.test.ts` (entire file is `readFileSync` + `toContain`)
**Source:** `src/lib/image-queue.ts:411-471` (the fire-and-forget embedding hook)

Confirmed: none of the behavioral image-queue suites (`image-queue.test.ts`,
`image-queue-bootstrap.test.ts`, `image-queue-quiesce.test.ts`) touch `imageEmbeddings`,
`embedImageStub/Real`, `semanticSearchMode`, or the insert. The ONLY coverage is three
`toContain('embedImageReal')` / `toContain("=== 'production'")` string assertions.

The hook has real, testable behavior the string contract cannot see:
- It is **fire-and-forget** (`void (async () => {...})()`) — it MUST NOT block or reject the queue job.
- It **no-ops on `disabled`** (early `return`).
- It branches stub vs production and writes the **matching `modelVersion`** (the stub/prod isolation
  invariant the whole feature rests on).
- It **swallows embed errors** (`catch` → `console.warn`) so an encoder failure can't fail the upload.
- It uses `onDuplicateKeyUpdate` (re-embed in place).

**Regression that slips through:** someone changes `if (semanticMode === 'production')` to write
`CLIP_MODEL_VERSION` for prod (copy-paste), or accidentally `await`s the IIFE making embedding block
the queue, or drops the `if (semanticMode === 'disabled') return` guard so embeddings get written
even when the feature is dark. **All three ship green** — the source still contains the matched
strings. The stub/prod-isolation invariant (the core safety property protecting "CLIP is dark") is
literally untested at the behavior level on the WRITE side. (The READ side — route model-version
filter — IS behaviorally tested, which makes the write-side gap more glaring.)

**Suggested (stub mode only — does NOT flip the live setting):** extract the hook body into an
exported `storeEmbeddingForJob(jobId, originalPath, cfg)` (or test the existing module with mocks),
mock `getGalleryConfig`, `embedImageStub`, and `db.insert(...).onDuplicateKeyUpdate(...)`, then assert:
(a) `disabled` → no insert; (b) `stub` → insert called once with `modelVersion: CLIP_MODEL_VERSION`;
(c) a thrown encoder error does NOT propagate (promise resolves, job unaffected). No production-mode
or real-weight branch needed — the stub branch alone closes the isolation-invariant gap.

---

### F3 — SHA-256 manifest hash-MISMATCH path in `download-clip-models.ts` is NOT behaviorally tested — MEDIUM / High confidence

**Test:** `src/__tests__/download-clip-models.test.ts` (3 `toContain` source assertions)
**Source:** `scripts/download-clip-models.ts:71-138` (idempotency check + manifest verification + `process.exit(1)`)

The test asserts the *string* `createHash('sha256')` exists and the string `Running in stub mode`
does not. It never runs `sha256File`, never feeds a mismatching file, never asserts the script exits
non-zero on a corrupt/tampered artifact. The integrity guarantee (operator pulls a tampered ONNX → the
script aborts before the app loads it) is **entirely unexecuted.**

**Regression that slips through:** the verification loop's comparison is inverted
(`if (actual !== expectedHash)` ↔ `===`), or `allOk` is initialized `false`-then-never-set, or the
`process.exit(1)` is dropped during a refactor — script reports "All checksums verified" on a
hash mismatch and the app silently loads weights from a poisoned cache. The string contract passes
through every one of these.

**Suggested (no real download):** `sha256File` is pure I/O — unit-test it directly. Write a temp file
with known bytes, assert the digest matches a precomputed constant; write a second file whose digest
differs from a fake manifest entry and assert the comparison yields mismatch. To cover the exit
behavior, extract the verify loop into a pure `verifyManifest(dir, manifest): {ok, failures}` and
assert `ok===false` + the offending path on a mismatch. None of this touches HF or the network.

---

### F4 — Backfill re-embed + idempotency logic is NOT behaviorally tested — MEDIUM / High confidence

**Test:** `src/__tests__/backfill-clip-embeddings-reembed.test.ts` (3 `toContain` source assertions)
**Source:** `scripts/backfill-clip-embeddings.ts:111-185` (keyset pagination, `notExists` on target
model_version, re-embed-on-version-mismatch, `SEMANTIC_SCAN_LIMIT` cap, `--force` gate, exit code)

The test asserts the strings `modelVersion`, `eq(imageEmbeddings.modelVersion`, `embedImageReal`,
`--production` exist and `'semantic_search_enabled'` does not. It proves nothing about the actual
selection/idempotency behavior the CLAUDE.md doc explicitly promises ("Idempotent: a second run at
the same target version selects nothing"; "stub rows re-embedded under --production").

**Regression that slips through:** the keyset cursor advance (`cursor = rows[rows.length - 1].id`) is
dropped or the `notExists` subquery loses its `eq(modelVersion, TARGET_MODEL_VERSION)` clause — the
backfill either infinite-loops, skips half the backlog (the exact `COR-R4C19-04` LIMIT/OFFSET bug the
comment says was already fixed once), or stops re-embedding stub→prod. Source-string contract is blind
to all of it. There is real regression history on this very file, which raises the stakes.

**Suggested (stub path only):** extract the row-selection predicate and the cursor-advance into pure
helpers, or run the module against a mocked `db` whose `select(...).where(...).orderBy(...).limit(...)`
returns a scripted sequence; assert: a row at a *different* model_version is re-selected; a second pass
at the *same* target version selects nothing; the cursor strictly advances; the `SEMANTIC_SCAN_LIMIT`
break fires. All exercisable with the stub encoder / pure mock — no `--production`, no weights.

---

### F5 — Doc/source threshold drift: route docstrings claim `0.25`, constant is `0.22`; no test pins the constant value — MEDIUM / High confidence

**Source:** `src/app/api/search/semantic/route.ts:25` ("PRODUCTION_COSINE_THRESHOLD (0.25)") and the
`similar/[id]/route.ts:238` test-comment ("above PRODUCTION_COSINE_THRESHOLD (0.25)") vs
`src/lib/clip-embeddings.ts:103` `PRODUCTION_COSINE_THRESHOLD = 0.22`.

The constant was re-calibrated to `0.22` (with a detailed 2026-06-16 measurement comment) but the
route docstrings and a test comment still say `0.25`. No test asserts the numeric value of
`PRODUCTION_COSINE_THRESHOLD` or `COSINE_THRESHOLD`, so the drift went unnoticed.
`clip-embeddings-normalize.test.ts` checks `PRODUCTION_MODEL_VERSION` shape but not either threshold.

**Regression that slips through:** a future "tuning" PR nudges the threshold and silently changes the
public recall/precision of production search with nothing flagging it; or the two thresholds get
transposed. Because the value lives in a thresholds-are-just-numbers module, there's no canary.

**Suggested:** add a one-line guard test pinning `PRODUCTION_COSINE_THRESHOLD` and `COSINE_THRESHOLD`
to their current values with a comment "bump deliberately + update route docstrings" — the same
canary pattern used for `IMAGE_PIPELINE_VERSION`. Cheap, and it would have caught this drift. Also fix
the two `0.25` docstring/comment references to `0.22`.

---

### F6 — `truncateAndNormalize` short-input branch (`v.length <= EMBEDDING_DIM`) is untested — LOW / High confidence

**Test:** `src/__tests__/clip-embeddings-normalize.test.ts:16-23` (only tests the 1024-element case)
**Source:** `src/lib/clip-embeddings.ts:117-120`

```ts
const head = v.length > EMBEDDING_DIM ? v.subarray(0, EMBEDDING_DIM) : v;
return normalizeEmbedding(Float32Array.from(head));
```

Only the `>512` (truncate) branch is exercised. The `<=512` branch — where a model returns exactly
512 or fewer dims (e.g. a future smaller model, or the dim guard in `clip-model.ts` passing a borderline
length) — never runs. `clip-model.ts` already guards `data.length < EMBEDDING_DIM` then calls
`truncateAndNormalize`, so the exactly-512 case is reachable in production.

**Regression that slips through:** the ternary is inverted or `subarray` bounds change such that a
512-element input is mishandled — passes today because no test ever sends ≤512.

**Suggested:** one assertion: `truncateAndNormalize(Float32Array.from({length: 512}, ...))` returns a
512-dim unit vector; optionally a `<512` input (e.g. length 256) returns a 256-dim unit vector (documents
the no-pad behavior). Pure function, trivial.

---

### F7 — `bufferToEmbedding` NaN / non-finite float handling not asserted in the scan path — LOW / Medium confidence

**Source:** `clip-embeddings.ts:56-65` (`readFloatLE` can yield `NaN`/`±Infinity` from arbitrary bytes);
route scan `semantic/route.ts:263-276` decodes base64 → `bufferToEmbedding` → `cosineSimilarity`.

The route validates `buf.length === EMBEDDING_BYTES` but a length-correct buffer of arbitrary bytes can
deserialize to `NaN` floats. `cosineSimilarity` with a `NaN` component returns `NaN`; `topK`'s
`m.score >= threshold` is `false` for `NaN`, so a `NaN`-poisoned row is silently dropped — which is
*acceptable* behavior, but it's unverified and depends on a subtle `NaN >= x === false` fact. No test
feeds a NaN-bearing buffer through the scan.

**Regression that slips through:** if `topK` is ever rewritten to sort-then-filter, or the comparison
flips to `> -Infinity`, a corrupt-but-length-correct embedding could surface as a top result (or throw).
Low likelihood, but it's an untested data-integrity edge on a public endpoint.

**Suggested:** unit-test `cosineSimilarity` with a `NaN`-containing vector returns `NaN`, and `topK`
excludes a `NaN`-scored match. Pure functions. (The route-level test would need a NaN base64 fixture —
optional.)

---

### F8 — Duplicate validator test files (maintenance smell, not a coverage gap) — LOW / High confidence

`semantic-search-mode-validator.test.ts` and `gallery-config-semantic-production.test.ts` test the
*identical* assertion set (`isValidSettingValue('semantic_search_mode', ...)` accepts disabled/stub/
production, rejects junk). Two files, same coverage. Not harmful, but the second adds zero protection
and both must be kept in sync if the value set changes. Consolidate into one, or have the second test a
genuinely different facet (e.g. the `gallery-config.ts` *resolver's* heal-to-default on a stale DB value
— see F9, which neither currently covers).

---

### F9 — `getGalleryConfig` resolver heal-to-default for a STALE/invalid stored mode is untested — MEDIUM / Medium confidence

**Source:** `src/lib/gallery-config.ts:128-135`

```ts
if (!isValidSettingValue('semantic_search_mode', raw)) return DEFAULTS.semantic_search_mode ...
return raw as 'disabled' | 'stub' | 'production';
```

The `isValidSettingValue` *validator* is tested in isolation (F8), and the *route* gate is tested with
clean mocked configs. But the **resolver branch that maps an invalid/legacy stored value (e.g. a
pre-Task-5 `'enabled'`, or a corrupted row) back to `'disabled'`** has no direct test. This is the
defense-in-depth that the route docstring (`semantic/route.ts:189-192`) explicitly relies on
("a legacy 'production' string that healed to 'disabled' in getGalleryConfig").

**Regression that slips through:** the resolver is refactored to `return raw` without the validity gate
(or the gate is inverted) — a junk DB value flows through to the route, which then only has its own
`!== 'stub' && !== 'production'` check as backstop. The documented two-layer defense silently collapses
to one layer; nothing fails.

**Suggested:** unit-test `getGalleryConfig` (mock the settings map) returns `semanticSearchMode:
'disabled'` for a stored `'enabled'` / `''` / `'prod'` and passes through a valid `'stub'`. Mocked DB,
no live mode change. This is the more valuable replacement for the duplicate in F8.

---

## What's genuinely solid (no action)

- `clip-embeddings.test.ts` — cosine (identical/orthogonal/opposite/zero/mismatch/known-vector),
  buffer roundtrip + both dimension guards, topK (threshold, K-cap, no-mutation), stub determinism
  + cross-id divergence + explicit "not semantically meaningful" honesty test. Exemplary pure-fn coverage.
- `semantic-search-params.test.ts` — `clampSemanticTopK` is exhaustively covered: undefined/null/
  negative/zero/float/in-range/over-max/numeric-string/boolean/array/object/NaN/±Infinity/MAX_SAFE_INTEGER.
  The `typeof !== 'number'` hardening (rejecting `Number(true)===1`, `Number([])===0`, `Number(['5'])===5`)
  is each asserted. This is how a contract test should look. Verified `Infinity` correctly falls to DEFAULT.
- `semantic-search-rate-limit.test.ts` — pre-increment boundary, window reset, per-IP isolation,
  rollback (single/multi/from-count-1-deletes/no-op-on-missing/exact-budget-after-rollbacks). Strong.
- `semantic-search-route.test.ts` — all gates (403/maintenance-503/Content-Length-400/413/invalid-JSON/
  bad-shape/short-query/disabled-503/rate-429/empty-200/enriched-200/scan-fail-500), and crucially
  asserts **rate-limit rollback** on the disabled and scan-fail paths, and that production calls
  `embedTextReal` not `embedTextStub`. The table-keyed db dispatch (AGG-R5C3-07) is a real improvement
  over call-order coupling — it survives query reordering. Good.
- `similar-route.test.ts` — same-origin, production-only gate (stub/disabled→503 + rollback), id
  validation (non-numeric, 0), 404-on-missing-embedding + rollback, **self-exclusion**, and a behavioral
  assertion that the scan `where()` carries `PRODUCTION_MODEL_VERSION` (the stub/prod isolation invariant
  on the READ side). This is the model the embed-hook write-side test (F2) should follow.

---

## Compact summary (for aggregator)

- **[HIGH / High]** F1 — CLIP real-ranking integration suite `describe.skip` unless `CLIP_INTEGRATION=1`: silently skipped in CI, so the ENTIRE real encoder (`clip-model.ts`) + Matryoshka-on-real-output + Sharp CHW preprocessing have zero executed coverage in the normal gate. Propose: loud skip annotation + nightly weighted job + a weights-free mocked-transformers smoke that executes `embedTextReal` control flow.
- **[HIGH / High]** F2 — Embed hook (`image-queue.ts:411-471`) covered only by source-string regex; no behavioral test of disabled-no-op, stub-writes-`CLIP_MODEL_VERSION`, fire-and-forget non-blocking, or error-swallowing. The stub/prod-isolation invariant is untested on the WRITE side. Propose: stub-mode mocked-db behavioral test (no live-mode flip).
- **[MEDIUM / High]** F3 — `download-clip-models.ts` hash-MISMATCH → `exit(1)` path is string-contracted only; inverted comparison / dropped exit ships green. Propose: unit-test `sha256File` + extracted `verifyManifest` (no network).
- **[MEDIUM / High]** F4 — Backfill re-embed + idempotency + keyset-pagination string-contracted only; this file has prior LIMIT/OFFSET regression history. Propose: mocked-db selection/cursor/idempotency test (stub path).
- **[MEDIUM / High]** F5 — Doc/source drift: route docstrings say `PRODUCTION_COSINE_THRESHOLD (0.25)`, constant is `0.22`; no test pins either threshold value. Propose: value-canary test (like `IMAGE_PIPELINE_VERSION`) + fix the `0.25` docstrings.
- **[MEDIUM / Medium]** F9 — `getGalleryConfig` heal-invalid-mode→`disabled` resolver branch (documented defense-in-depth) is untested. Propose: mocked-settings resolver test (replaces the F8 duplicate).
- **[LOW / High]** F6 — `truncateAndNormalize` `<=512` (no-truncate) branch untested; reachable for exactly-512 model output. Propose: one assertion.
- **[LOW / Medium]** F7 — `bufferToEmbedding` NaN/non-finite floats unverified through the public scan path (currently dropped via `NaN >= x === false`, but untested + sort-order-rewrite-fragile). Propose: NaN cosine/topK unit assertions.
- **[LOW / High]** F8 — Duplicate validator test files (`semantic-search-mode-validator` ≈ `gallery-config-semantic-production`); zero added protection. Consolidate or repurpose one for F9.

**Overall CLIP test health: NEEDS ATTENTION.** Pure-function + mocked-route layers are strong (some
exemplary). The risk is concentrated in: (1) the real encoder being invisible-to-CI, and (2) four
source-string contract tests (embed hook, download hash-mismatch, backfill, search component) standing
in for behavior they never execute — three of which guard the stub/prod-isolation invariant that makes
"CLIP is dark" safe. Closing F1's weights-free smoke and F2's stub-mode hook test would move this to
HEALTHY without ever flipping the mode or touching real weights. No flaky tests observed; no tests
require weights in the normal gate (the only weighted suite is correctly gated).
