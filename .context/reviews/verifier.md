# Verifier Review — CLIP Semantic-Search Feature (fresh-scrutiny target)

**Date:** 2026-06-16
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**Scope:** Evidence-based correctness verification of the CLIP semantic-search feature added this session (US-P51). Stated behavior (CLAUDE.md, code comments, test names, route docstrings) checked against what the CODE actually does, with fresh test execution.

**Method:** Read all 10 source files + 12 test files. Ran the CLIP unit/route/rate-limit/params suites fresh (NOT the gated integration suite — no weights present, and the HARD GUARD forbids seeding them). Traced the normalize/cosine math by hand and via a Node probe. Grepped for any persistent `production`-mode write.

**HARD GUARD STATUS: INTACT.** I did not flip `semantic_search_mode` to `'production'` anywhere, did not run `backfill --production`, and did not download model weights. The feature remains DARK. Default confirmed `'disabled'` at `gallery-config-shared.ts:108`.

---

## Verdict

**Status:** PASS (the dark-by-default contract and the math are correct and locked) **with documented non-blocking drift**
**Confidence:** High
**Blockers:** 0

The five primary claims are CONFIRMED. The findings below are doc/comment/test-adequacy drift, not runtime defects. Nothing here makes the feature unsafe to ship dark, and nothing requires un-darkening to fix.

---

## Evidence (fresh, this session)

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| CLIP unit + route-production + validator suites | PASS | `npx vitest run` (8 files) | 8 files / 43 tests passed |
| Route + similar + rate-limit + params suites | PASS | `npx vitest run` (4 files) | 4 files / 43 tests passed |
| Integration suite (no `CLIP_INTEGRATION`) | SKIP (honest) | `npx vitest run clip-semantic-integration` | 1 file / 2 tests **skipped**, not passed |
| Persistent `production` write scan | CLEAN | `grep -rn semantic_search_mode src/ scripts/ drizzle/ messages/` | no insert/seed/migration sets stub or production |
| `.only`/`.skip`/`xit` masking in CLIP unit tests | CLEAN | grep across 10 unit/route test files | NONE FOUND |
| `truncateAndNormalize` math (512 + 1024 inputs) | CORRECT | Node probe | both → len 512, unit-norm 1.000000 |

Total CLIP test surface: **86 tests passing + 2 honestly skipped.**

---

## Claim-by-claim

### Claim 1 — default `'disabled'`, route returns stub/disabled response (feature is DARK) — **CONFIRMED** (High)

- `gallery-config-shared.ts:108` → `semantic_search_mode: 'disabled'`. Validator (line 170) accepts `'disabled' | 'stub' | 'production'`.
- `gallery-config.ts:128-134` resolves missing/invalid value to the `'disabled'` default.
- `semantic/route.ts:227` returns 503 for anything that is not `'stub'` or `'production'`.
- `similar/[id]/route.ts:102` returns 503 unless mode is exactly `'production'`.
- Client: `search.tsx:414` hides the semantic toggle entirely when `semanticSearchMode === 'disabled'`; `similar-photos.tsx:63-66` renders nothing on the 503. Dark end-to-end: config default → route 503 → UI hidden.
- I did NOT change the default. It remains `'disabled'`.

### Claim 2 — L2-normalize + Matryoshka-512 → unit-length 512-dim vector; cosine math correct — **CONFIRMED** (High)

- `normalizeEmbedding` (`clip-embeddings.ts:106-114`): standard L2, zero-vector guard returns input unchanged (no NaN). Correct.
- `truncateAndNormalize` (lines 117-120): `subarray(0,512)` when `len>512`, copies via `Float32Array.from`, re-normalizes. Probe confirms both 512-input and 1024-input yield length 512 and norm 1.000000.
- `cosineSimilarity` (lines 20-35): `dot/(‖a‖‖b‖)`, throws on dim mismatch, returns 0 on zero denom. Unit tests assert identical→1, orthogonal→0, opposite→−1, `[3,4]·[4,3]→24/25`. Non-vacuous and green.

### Claim 3 — `model_version` filter prevents mixing stub and production embeddings — **CONFIRMED** (High)

- Writers tag rows: queue `image-queue.ts:447/450`, backfill `backfill-clip-embeddings.ts:165`.
- Semantic route scans `WHERE modelVersion = activeModelVersion` where active = prod-or-stub by mode (`semantic/route.ts:235,254`).
- Similar route is production-only and scans `WHERE modelVersion = PRODUCTION_MODEL_VERSION` for both the target lookup and the scan (`similar/[id]/route.ts:118,145`).
- `PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8'` ≠ `CLIP_MODEL_VERSION = 'stub-sha256-v1'`, both ≤ 32 chars (varchar(32)). Locked by `clip-embeddings-normalize.test.ts:25-29`. Stub and prod vectors can never co-rank.

### Claim 4 — CLIP smoke/ranking tests are NON-VACUOUS and skip honestly — **CONFIRMED, with a CI-coverage caveat** (High)

- `clip-semantic-integration.test.ts` is gated on `CLIP_INTEGRATION=1` (line 30-31, `describe.skip` otherwise). Verified fresh: with the env unset it reports **"2 skipped"**, NOT passed — the skip is honest (a green CI does not masquerade the ranking as verified).
- When it DOES run, it is a genuine ranking assertion: embeds 4 real fixtures + an EN and a KO query, requires the matching fixture (`red-flower`) to be the global argmax AND beat the runner-up by `MIN_LEAD = 0.03` (lines 64-69). If `truncateAndNormalize` broke, the towers were swapped, or preprocessing regressed, this goes RED. Non-vacuous.
- **Caveat (by design, not a defect):** the gate is the env flag, not actual weight presence. Real ranking correctness is therefore exercised ONLY when an operator sets `CLIP_INTEGRATION=1` AND has seeded the ~600 MB weights. In default CI it is never exercised. This is the correct trade-off for a heavyweight dark model — but it means "the test would fail if ranking regressed" holds only in the gated env, never in normal CI.

### Claim 5 — contract tests would go RED if the contract broke — **MIXED** (High)

Two classes of test exist:

- **Behavioral locks (strong, non-vacuous):** `clip-embeddings.test.ts` (cosine/buffer-roundtrip/topK/stub determinism), `clip-embeddings-normalize.test.ts` (real unit-vector math), `semantic-route-production.test.ts` (mocks config→production, asserts 200 + `embedTextReal` called once; mocks config→disabled, asserts 503), and the route/rate-limit/params suites. These execute real code and would fail on regression.
- **Source-text grep contracts (weak, name overstates assurance):** see findings F2/F3 below. They `readFileSync` the source and regex for tokens. They lock the source SHAPE, not behavior. Honest about being contracts, but several test NAMES claim behavioral verification they do not perform.

The `semantic-route-production.test.ts` "production" value is an ephemeral `vi.mock` return — it does NOT persist to DB/config. No HARD-GUARD violation.

---

## Findings

### F1 — Schema/comment says MEDIUMBLOB binary, app stores base64 ASCII (storage-intent drift) — **CONFIRMED** — Severity: Low — Confidence: High

- `drizzle/0012_image_embeddings.sql` and `scripts/migrate.js:563` create `embedding mediumblob NOT NULL`. Comments (migration header; `schema.ts:259-261,266-267`) say *"Stores 512-dim float32 CLIP embeddings as MEDIUMBLOB (2048 bytes per row)"* and *"the lib layer wraps Buffer reads/writes."*
- Reality: the write path stores **base64 text** of the buffer — `buf.toString('base64')` at `image-queue.ts:453` and `backfill-clip-embeddings.ts:160` — and the read path decodes with `Buffer.from(row.embedding as string, 'base64')` (`semantic/route.ts:267`, `similar/[id]/route.ts:127,157`). So each row holds ~2732 ASCII bytes (base64 of 2048), not 2048 raw binary float32.
- **Functionally correct and self-consistent**: base64 is ASCII-safe, mediumblob preserves the bytes, the round-trip matches, and the `buf.length !== EMBEDDING_BYTES` guards (route 268/128/158) check the *decoded* length (2048), which holds. No corruption or runtime risk.
- **But the documentation lies about the wire format**: it claims raw binary while the actual storage is base64-of-binary (~33% larger than the documented 2048 bytes). The `embeddingToBuffer`/`bufferToEmbedding` helpers operate on raw Buffers, but they are NOT the DB wire format — base64 is applied at the call sites, contradicting the "lib layer wraps Buffer reads/writes" comment. Scenario: a future maintainer trusts the "2048 bytes / MEDIUMBLOB binary" comment, writes a raw-binary backfill or an external reader expecting binary, and produces rows the existing routes will reject (decoded length ≠ 2048) — a silent data split across two encodings. Fix: correct the comments to state "base64-encoded float32 buffer stored as text-in-blob," or switch the storage to true binary and drop the base64 hop.

### F2 — `backfill-clip-embeddings-reembed.test.ts` name overstates verification — **CONFIRMED** — Severity: Low — Confidence: High

- The test (`backfill-clip-embeddings-reembed.test.ts:6-9`) is named *"re-embeds rows whose model_version != the target (filters notExists on modelVersion)"* but only asserts the source string contains `modelVersion` and matches `/eq\(\s*imageEmbeddings\.modelVersion/`. It never runs the backfill, never exercises the `notExists(... AND modelVersion = TARGET)` selection, and never proves idempotency or re-embed.
- The re-embed/idempotency logic IS correct (I verified by reading `backfill-clip-embeddings.ts:118-136`: keyset pagination + `notExists` scoped to `(imageId, TARGET_MODEL_VERSION)` re-selects rows at a different version; upsert overwrites in place; a second run at the same target selects nothing). But that correctness rests on READING the code, not on this test. If someone broke the `notExists` scoping while leaving the `eq(imageEmbeddings.modelVersion` token present, the test stays green. Re-open criterion: add an executed test (in-memory or mocked DB) that asserts a stub-version row is re-selected under `--production` and a same-version row is skipped.

### F3 — `download-clip-models.test.ts` does not verify the SHA gate actually gates — **CONFIRMED** — Severity: Low — Confidence: High

- The test (`download-clip-models.test.ts:12-15`) is named *"verifies a SHA-256 checksum manifest (not a console.log stub)"* but only asserts the source matches `/createHash\(['"]sha256['"]\)/` and lacks `"Running in stub mode"`. It does not prove a hash MISMATCH aborts.
- The gate IS correct (I read `download-clip-models.ts:111-135`: on any missing or mismatched manifest entry `allOk=false` → `process.exit(1)`; the idempotency pre-check at lines 73-85 re-verifies an existing file and re-downloads on mismatch). The download-script `--production` path was NOT executed here (no network/weights, and out of HARD-GUARD scope), so the gate is verified by code-reading, not by test. Sub-question answer: **on hash mismatch the script exits non-zero (fails closed)** — confirmed by reading, lines 132-135.

### F4 — Route docstring states stale threshold `(0.25)`; actual `PRODUCTION_COSINE_THRESHOLD = 0.22` — **CONFIRMED** — Severity: Low — Confidence: High

- `semantic/route.ts:25` docstring: *"Uses PRODUCTION_COSINE_THRESHOLD (0.25)"*. `clip-embeddings.ts:103` defines it as `0.22` (recalibrated 2026-06-16, with a detailed provenance comment at lines 87-102). The route USES the constant (line 236), so runtime is correct — only the docstring number is stale. Minor, but it is a misleading magic number in a security/relevance-sensitive doc.

### F5 — Stale "healed to disabled" comment contradicts current production-serving behavior — **CONFIRMED** — Severity: Low — Confidence: High

- `semantic/route.ts:189-192` comment claims *"a legacy 'production' string that healed to 'disabled' in getGalleryConfig"* and *"only 'stub' mode is the current encoder (CRT-R5C1-01)."* This is obsolete: `'production'` is now a first-class valid value (validator `gallery-config-shared.ts:170`; `semantic-search-mode-validator.test.ts:20`), `getGalleryConfig` does NOT heal it, and the route at lines 220-241 deliberately serves production with the real encoder. The comment describes a prior lifecycle that has been lifted; a reader relying on it would wrongly conclude production can never be served. Behavior is correct; the comment is wrong. Tidy up to avoid a future "why does production work when the comment says it heals to disabled?" investigation.

### F6 (informational) — Duplicate `describe('semantic_search_mode validator')` block — Severity: Low — Confidence: High

- The same describe name appears in both `semantic-search-mode-validator.test.ts` and `gallery-config-semantic-production.test.ts`. Both pass; harmless, but the duplication is redundant coverage. Not a defect.

---

## What I explicitly verified is SAFE / correct

- Default `'disabled'`; route 503 in non-stub/non-prod; similar route production-only; UI toggle hidden by default. (Claim 1)
- normalize/truncate/cosine math; buffer round-trip guards on decoded length 2048. (Claim 2)
- `model_version` partitioning across writer + both readers; stub and prod constants distinct and ≤32 chars. (Claim 3)
- Integration suite skips honestly (reports skipped, not passed) and is a real argmax+margin ranking assertion when run. (Claim 4)
- No `.only`/`.skip`/`xit` masking; behavioral suites are non-vacuous and green (86 passing). (Claim 5)
- Rate-limit Pattern-2 posture: pre-increment after cheap validation, rollback on every early return before expensive embed/DB work (`semantic/route.ts:209,228,243,258`; `similar/[id]/route.ts:84,103,123,129,134,149`). Both routes share one budget. Fail-closed on config error.
- Backfill re-embed/idempotency LOGIC is correct (keyset cursor + version-scoped `notExists` + upsert). Honesty posture intact: stub vectors are documented everywhere as non-semantic.

---

## Recommendation

**APPROVE for the dark-by-default state.** The feature is correctly dark, the math is correct and behaviorally locked, and stub/prod cannot mix. All six findings are Low-severity documentation/comment/test-name drift that should be cleaned up but do not block and do not require un-darkening. Highest-value cleanups: F1 (schema/wire-format comment is materially wrong and could mislead a future binary reader/backfill) and F2/F3 (two source-grep tests whose NAMES claim behavioral verification they don't perform — replace or rename so the test surface doesn't overstate its own assurance).

---

## Aggregator summary (severity · confidence)

- **PASS — dark-by-default contract correct** · High — default `'disabled'` (`gallery-config-shared.ts:108`), route 503 otherwise (`semantic/route.ts:227`), similar route prod-only (`similar/[id]/route.ts:102`), UI toggle hidden by default (`search.tsx:414`). HARD GUARD intact; not changed.
- **PASS — Matryoshka-512 + cosine math correct** · High — probe confirms unit-norm 512 for 512 & 1024 inputs; non-vacuous unit tests green.
- **PASS — model_version prevents stub/prod mixing** · High — version filter on writer + both readers; constants distinct, ≤32 chars.
- **PASS — integration smoke test honest + non-vacuous** · High — skips (not passes) without `CLIP_INTEGRATION`; real argmax + 0.03-lead assertion when run. Caveat: ranking never exercised in default CI by design.
- **PASS — 86 CLIP tests green, no .only/.skip masking** · High — fresh run this session.
- **LOW — F1 schema/comment says MEDIUMBLOB binary 2048B, app stores base64 ASCII (~2732B)** · High — `0012_image_embeddings.sql` / `migrate.js:563` vs `image-queue.ts:453` / `backfill:160`. Self-consistent + functionally correct, but doc lies about wire format; future binary reader/backfill could split encodings.
- **LOW — F2 backfill-reembed test is source-grep; name overstates ("re-embeds rows…") but never runs the logic** · High — `backfill-clip-embeddings-reembed.test.ts:6-9`.
- **LOW — F3 download-clip-models test never proves the SHA gate aborts on mismatch** · High — gate IS correct by code-read (`download-clip-models.ts:132-135` exit 1), but test only greps for `createHash`.
- **LOW — F4 route docstring says PRODUCTION_COSINE_THRESHOLD (0.25); actual 0.22** · High — `semantic/route.ts:25` vs `clip-embeddings.ts:103`. Runtime uses the constant; doc stale.
- **LOW — F5 route comment "production healed to disabled" contradicts current prod-serving** · High — `semantic/route.ts:189-192` obsolete after CRT-R5C1-01 lifted; behavior correct.
- **LOW — F6 (info) duplicate `semantic_search_mode validator` describe block across two test files** · High — harmless redundancy.
