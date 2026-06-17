# Test-Engineer Review — Run-6 Cycle-8 (HEAD 1a325fa6)

**Scope:** test coverage of the now-LIVE CLIP semantic-search activation (commits e0da12ee, b1d6331c, 1a325fa6) plus a sweep of the security-critical test surface.

**Gate state (verified by verifier this cycle):** Vitest 2207 passed / 4 skipped / 0 failed. The 4 skipped are the model-weight-gated `clip-offline-load.test.ts` (`CLIP_OFFLINE_LOAD=1`) and `clip-semantic-integration.test.ts` (`CLIP_INTEGRATION=1`) — gated by design, not dead.

**Findings: 0 CRITICAL / 0 HIGH / 1 MEDIUM / 1 LOW** (both are coverage gaps that mirror live-code findings other agents raised; the underlying code findings are tracked separately).

---

## TE-C8-01 [MEDIUM, confidence High] — No test pins the downloader idempotency fast-path against a partial seed

**File:** `apps/web/scripts/download-clip-models.ts:63-76` (the early-return fast path); test surface `apps/web/src/__tests__/clip-paths.test.ts` (12 tests, none cover the downloader's verify/idempotency branch).

The idempotency fast-path checks only `onnx/model_quantized.onnx`'s SHA-256 before printing "already up to date" and exiting 0. `tokenizer.json` / `tokenizer_config.json` / `config.json` are not checked on the fast path, yet `from_pretrained` (offline, `allowRemoteModels=false`) treats them as fatal. No test exercises a seed dir that has a valid ONNX but a missing/corrupt config — so the "report MISSING and abort" guarantee the manifest gate is supposed to provide is untested for the fast-path.

**Bug that slips through:** a future edit that leaves the fast-path ONNX-only (or that adds a new required artifact to the manifest without updating the fast path) would ship a downloader that green-lights a partial seed; the regression surfaces only as a production 503 storm, not a red test.

**Test to add:** a Vitest that builds a temp cache dir with a correct ONNX checksum but an absent `tokenizer.json`, runs the verify helper the script uses (`verifyAndCleanArtifacts(dir, MANIFEST, false)`), and asserts it reports the missing file rather than "up to date". (This also locks the recommended fix for the code-level HIGH the debugger filed.)

---

## TE-C8-02 [LOW, confidence Medium] — `backfillClipEmbeddings` model_version selection gap is untested

**File:** `apps/web/src/app/actions/embeddings.ts:86-99` (the `notExists` candidate query); no test covers this action's selection semantics.

The `notExists` subquery filters only on `imageEmbeddings.imageId`, not `modelVersion`, so an image carrying a stub-version row is excluded even when the action runs in `production` mode (it can never upgrade stub→production rows). The canonical sidecar `scripts/backfill-clip-embeddings.ts:125-131` applies the correct two-condition filter. The action is currently **unwired** from any UI, so there is no live impact — but there is also no test asserting the selection matches the sidecar, so wiring it later would silently ship the gap.

**Bug that slips through:** if a future cycle binds this action to the admin "re-embed" button, a deployment that already has stub rows would report `processed: 0` with no error and no failing test.

**Test to add:** a unit/integration test asserting that, given an image with a stub-version embedding, `backfillClipEmbeddings` in production mode selects it (after the code fix) — i.e. pin the selection to be model_version-aware, matching the sidecar's documented contract.

---

## Verified-solid coverage (no gap)

- **`clip-paths.test.ts` (12 tests)** correctly pins: absolute-vs-relative `resolveClipModelsRoot` (the `/app/apps/web/app/...` path-doubling anti-pattern is explicitly asserted absent), the revision-subdir layout (`dir !== flat` assertion), and a no-drift grep proving both downloader and loader route through the shared resolver. The path-doubling regression cannot silently return.
- **`client-server-only-boundary.test.ts`** is **non-vacuous** for the `server-only` removal: it reads `clip-model.ts` from disk, asserts `server-only` absent + the `sharp`/`@huggingface/transformers` native imports present (the server-only-equivalent signal), and the closure walk would flag any `'use client'` → `@/lib/clip-model` value import. The comment-stripping in `hasServerOnlyImport` prevents a false-positive from the explanatory comment block.
- The semantic + similar route guard behaviors (same-origin 403, <3-char 400, topK clamp, rate-limit) are covered by the existing route/lib test suites and re-confirmed by the verifier's green gate run.

**No re-reports of cycle 1-7 closed items.** The many fixture-lock tests (blur wiring, tag-names SQL, touch-target audit, privacy-fields, sw-template-contract, backfill column set) remain green and were not re-litigated.
