# CRITIC — Run-6 Cycle-9 Deep Review (HEAD `af9ae6c5`)

**Date:** 2026-06-17
**Reviewer:** critic (Opus, read-only)
**Working tree:** clean at `af9ae6c5`.
**Mode operated in:** THOROUGH (no escalation to ADVERSARIAL — the single finding is a contained incomplete-fix, not a systemic pattern).
**Scope:** whole-repo correctness + design + risk angle, with independent verification of every cycle-8 fix. Convergence was strongly expected; this review confirms it almost completely, with ONE real incomplete prior-cycle fix.

---

## VERDICT: REVISE — 1 MEDIUM finding (an incomplete cycle-8 fix), 0 CRITICAL, 0 HIGH.

The cycle-8 activation surface is in excellent shape. Six of the seven cycle-8 fixes I was asked to verify are sound and complete. The seventh (AGG-C8-02 downloader idempotency) was executed but is **partially incomplete**: it now verifies "the full manifest," but the manifest itself omits the two config files the original finding explicitly named as fatal-required by the offline loader. The fix narrowed the blast radius (the most-likely partial-download casualty is now caught) but left a documented sub-case open. The remedy is trivial and risk-free.

---

## Pre-commitment predictions vs. findings

Before the deep dive I predicted the highest-probability latent issues would be: (1) a cycle-8 fix being subtly incomplete (esp. the manifest idempotency or the const-hoist), (2) contract drift between the two routes after parity edits, (3) migration 0022 name/column issues, (4) client/server codepoint-min mismatch, (5) error-swallowing in backfill/download.

**Outcome:** prediction (1) hit exactly — the manifest idempotency fix is incomplete (CRT-C9-01). Predictions (2),(3),(4),(5) all verified CLEAN (routes are parity-correct, migration 0022 is fully wired + monotonic, client/server both use `countCodePoints < 3`, error paths are caught-and-counted, not swallowed-silently). No surprises outside the predicted set.

---

## Critical Findings (block execution)

None. Cycle-8 found 0 CRITICAL and this cycle finds 0 CRITICAL.

---

## Major Findings (significant rework)

None at HIGH. (CRT-C9-01 below was assessed at the original AGG-C8-02 HIGH, then recalibrated to MEDIUM by the Realist Check — see rationale.)

---

## CRT-C9-01 [MEDIUM, Confidence HIGH] — AGG-C8-02 fix is incomplete: the CLIP manifest omits `config.json` + `tokenizer_config.json`, so a partial seed missing EITHER is still green-lit → runtime 503 storm

**Where:**
- `apps/web/scripts/clip-model-manifest.ts:25-30` — `CLIP_MODEL_MANIFEST` contains exactly TWO entries: `onnx/model_quantized.onnx` and `tokenizer.json`.
- `apps/web/scripts/download-clip-models.ts:72-84` — the cycle-8 idempotency fast-path now calls `verifyAndCleanArtifacts(modelCacheDir, MANIFEST, false)` and short-circuits to "already up to date" when `preCheck.ok`.
- `apps/web/scripts/clip-model-manifest.ts:71` — `verifyAndCleanArtifacts` iterates ONLY `Object.entries(manifest)`, so any file not in the manifest is never checked.

**Why this matters (the fix only half-closed its own finding):**
The original AGG-C8-02 problem statement (preserved verbatim in `plan/done/plan-360-run6-cycle8-fixes.md:23`) reads: *"`tokenizer.json` / `tokenizer_config.json` / `config.json` are not re-checked, yet offline `from_pretrained` (`allowRemoteModels=false`) treats them as fatal."* I independently verified the "fatal" claim against the installed transformers 3.8.1 source:
- `node_modules/@huggingface/transformers/src/configs.js:53-54` — `loadConfig` calls `getModelJSON('config.json', /*fatal*/ true)`.
- `.../src/tokenizers.js:67-71` — `loadTokenizer` calls `getModelJSON('tokenizer.json', true)` AND `getModelJSON('tokenizer_config.json', true)`.
- `.../src/utils/hub.js:710` + the offline branch at `getModelFile` (`!env.allowRemoteModels` → if `fatal` THROW, else return null) — so all three JSONs throw when absent on an offline (`allowRemoteModels=false`) load.

The fix (plan-360 TASK-1) said "verify the FULL manifest" and explicitly "**Do not change the download path itself**" — and did NOT add `config.json` / `tokenizer_config.json` to `CLIP_MODEL_MANIFEST` (the manifest's own comment, lines 19-24, deliberately verifies only "large binary artifacts," excluding small JSON configs). Net result: the fast-path now treats a seed as complete whenever ONNX + `tokenizer.json` verify, even if `config.json` or `tokenizer_config.json` is missing/corrupt — the exact two files the finding named. There is NO compensating runtime/startup integrity probe: the only consumers of `verifyAndCleanArtifacts` / `CLIP_MODEL_MANIFEST` are the download script + its tests; `lib/clip-model.ts` does not verify on load (that absence is the separately-deferred AGG-C8-08 / DEF-C8-2).

**Failure scenario:** an operator seeds the bind-mount; the download is interrupted or selectively corrupted such that `onnx/model_quantized.onnx` + `tokenizer.json` are complete-and-valid but `config.json` (or `tokenizer_config.json`) is absent. A subsequent `download-clip-models.ts` run's pre-check returns `ok: true`, prints "All checksums OK — already up to date", exits 0. The operator believes the seed succeeded and flips `semantic_search_mode=production` (+ `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`). The first live `/api/search/semantic` (production) or `/api/search/similar/[id]` request calls `embedTextReal`/`embedImageReal` → `getModelBundle()` → `AutoModel.from_pretrained` (or `AutoTokenizer`) throws on the missing fatal JSON → `loadPromise` nulls → the route's `catch` returns 503. Every subsequent semantic/similar request re-attempts the load, re-throws, and returns 503 indefinitely — the precise "wedged production search" blast radius AGG-C8-02 was raised to prevent.

**Realist Check (severity recalibration from the original HIGH):**
- Realistic worst case: production semantic + similar search wedged at 503 until the operator re-seeds. Easy rollback (re-run the seed correctly, or set mode back to `disabled`/`stub`). No data loss, no security exposure.
- Mitigating factors: (a) operator-only seed surface behind the `SEMANTIC_SEARCH_ALLOW_PRODUCTION` + DB-row double-gate; (b) the MOST LIKELY partial-download casualty — the ~170 MB ONNX weight — IS in the manifest and IS caught, as is `tokenizer.json`; the residual gap is the narrower "a ~1 KB config JSON specifically missing while both large artifacts are intact" case; (c) detection is immediate and loud on first query (503 + server-logged throw), and the documented (gated) `clip-offline-load.test.ts` would catch it pre-activation if the operator runs it.
- Detection time: silent during seeding (the core of the finding), but immediate + logged on first production query.
- **Recalibrated to MEDIUM.** Mitigated by: the narrowed trigger surface (large artifacts already covered), operator-only path, easy rollback, and loud first-query detection. It remains a real, worth-fixing incomplete fix — the documented failure mode is not fully closed and the remedy is trivial — but the realistic blast radius is contained, not the unbounded-availability HIGH the unmitigated original implied.

**Fix (trivial, additive, risk-free — no logic change):**
1. Add the SHA-256 of `config.json` and `tokenizer_config.json` (at the pinned revision) to `CLIP_MODEL_MANIFEST` in `clip-model-manifest.ts`. Both `verifyAndCleanArtifacts` and both download-script call sites already iterate the full manifest, so they pick the new entries up automatically — the fast-path and post-download gate then verify the complete fatal set.
2. Extend the acceptance test: TE-C8-01 (`download-clip-models.test.ts` line 29-36 + `clip-model-manifest.test.ts`) currently only covers the `tokenizer.json`-absent case. Add a fixture-style case where ONNX + `tokenizer.json` verify but `config.json` (or `tokenizer_config.json`) is absent → assert `verifyAndCleanArtifacts(dir, MANIFEST, false).ok === false`, so the manifest can never silently drop a fatal file again.
3. Update `clip-model-manifest.test.ts:38-44` to assert the manifest CONTAINS `config.json` + `tokenizer_config.json`, pinning the completeness contract.

(Scope note, verified: this load path builds the pixel tensor manually via Sharp and does NOT call `AutoProcessor`, so `preprocessor_config.json` is NOT required; `generation_config.json` is loaded `fatal=false` and is NOT required. The q8 weight is self-contained — no `.onnx_data` sidecar — confirmed by the offline-load test asserting only `onnx/model_quantized.onnx`. The complete fatal set for THIS path is exactly the four files: `onnx/model_quantized.onnx`, `config.json`, `tokenizer.json`, `tokenizer_config.json`. So the manifest is short by exactly two.)

---

## Minor Findings

None worth raising. (One ARIA nuance examined and dismissed as correct-by-design — see Multi-Perspective notes.)

---

## What's Missing (gaps examined, none rising to a new finding)

- No runtime/startup CLIP-artifact integrity probe — this is the separately-tracked, formally-deferred AGG-C8-08 / DEF-C8-2 (`plan-361:28-33`), not re-reported here. CRT-C9-01's fix would, as a side effect, make the *seed* path fully honest, reducing the practical likelihood of the AGG-C8-08 scenario.
- The unwired `backfillClipEmbeddings` server action selects up to `SEMANTIC_SCAN_LIMIT` rows in a single non-paginated query with no continuation, whereas the canonical sidecar uses keyset pagination to walk the whole library. Examined and dismissed: the action's single materialized SELECT is immune to the OFFSET-skip bug the sidecar's COR-R4C19-04 comment warns about (it never re-queries), and the action is UNWIRED from any UI, so there is no live recall-ceiling impact. Not a finding.

---

## Ambiguity Risks

None. The cycle-8 fixes are unambiguously specified; the one gap (CRT-C9-01) is a concrete omission, not an interpretation risk.

---

## Multi-Perspective Notes

- **Executor:** the CRT-C9-01 fix is fully actionable with what's written — add two SHA entries (computed via `sha256File` against a freshly-seeded volume) + two test cases. No access/knowledge gap.
- **Stakeholder (operator):** the incomplete fix means the integrity gate's promise ("a bad seed is caught before it can wedge production") is only partly delivered; an operator could still be surprised by a 503 storm after a "successful" seed. The fix restores the promised guarantee.
- **Skeptic:** strongest counter-argument to CRT-C9-01 — "the configs are tiny and download first, so they're essentially never the missing file." Partially valid (it's why I recalibrated to MEDIUM), but transformers fetches config.json BEFORE the large ONNX, so a download killed mid-stream can leave config absent while a *previous* run's ONNX persists; and selective FS corruption / manual tampering bypasses the "download order" assumption entirely. The gate exists precisely to not rely on download-order luck. The fix is one-line-cheap, so the cost/benefit overwhelmingly favors closing it.

---

## Independently VERIFIED CLEAN (the cycle-8 fixes + invariants)

**Cycle-8 fixes (7 verified; 6 fully sound, 1 = CRT-C9-01):**
1. **Full-manifest idempotency** (`download-clip-models.ts:72-84`) — mechanism correct (pre-check uses `deleteOnMismatch=false`, post-download gate owns delete); the ONLY gap is the manifest's missing two configs → CRT-C9-01.
2. **model_version-aware `backfillClipEmbeddings`** (`embeddings.ts:84-115`) — CLEAN. `modelVersion` hoisted ABOVE the query (line 92), used in the inner `notExists` (line 109); matches the sidecar's per-version selection.
3. **Short-query client guard** (`search.tsx:165-170`) — CLEAN. `countCodePoints(searchQuery.trim()) < 3` → `'invalidSemantic'`; exactly matches the server's `countCodePoints(query) < 3` (`semantic/route.ts:185`). `'invalidSemantic'` is in the status union (line 129) and renders via `t('search.${searchStatus}')`.
4. **Production-gated dotProduct** (`semantic/route.ts:271`, `similar/[id]/route.ts:163`) — CLEAN. Semantic gates `isProd ? dotProduct : cosineSimilarity`; I independently confirmed `deterministicEmbedding` (`clip-inference.ts`) returns raw [-1,1] (NOT normalized) and neither stub wrapper normalizes, so cosine is mandatory for stub and dotProduct is valid only for the (unit-vector) production path. Similar route is production-only (Gate 5 → 503), so unconditional dotProduct is correct there. Score-identical for unit vectors.
5. **Migration 0022** (`0022_..._idx.sql`, `_journal.json`, `schema.ts:287`, `migrate.js:570-573`) — CLEAN. Index `(model_version, updated_at)` order matches `WHERE model_version=? ORDER BY updated_at DESC`; journal `when=1781687094232` is strictly > all prior (monotonic per runbook); `schema.ts` index def present; `migrate.js` reconcile uses idempotent `ensureIndex` (checks `indexExists` before CREATE) so it cannot double-create on a fresh DB.
6. **aria-controls** (`similar-photos.tsx:110` + `:121`) — CLEAN. `aria-controls="similar-photos-results"` pairs with the region `id`.
7. **clip-paths asserts (AGG-C8-12)** (`clip-paths.ts:84-97`) — CLEAN. Throws on a non-2-segment model id and on a non-40-hex / `main` revision; matches the verified transformers v3 revision-subdir-vs-flat cache behavior (`hub.js` `proposedCacheKey`).

**`server-only` removal (1a325fa6)** — CLEAN + non-vacuous test. `client-server-only-boundary.test.ts` walks every `'use client'` module's transitive closure and treats `sharp` / `@huggingface/transformers` / `mysql2` imports as server-only-equivalent signals; `clip-model.ts`'s value-import of `sharp` (line 29) would trip it RED on any client leak. The comment-stripper handles clip-model.ts's literal `import 'server-only'` text in its comment.

**Invariants / HARD GUARDS (all intact):**
- Production heal gate `gallery-config.ts:143-144` — `value === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true' → 'disabled'`. Strict `!== 'true'`. NOT weakened.
- `semantic_search_mode` validator (`gallery-config-shared.ts`) — strict allowlist of exactly `disabled|stub|production`; junk DB values fall back to `disabled`.
- `allowRemoteModels=false` + revision pin (`clip-model.ts:88,93`) — intact; runtime never fetches.
- `model_version` isolation — consistent across ALL writers (image-queue.ts:445-471, embeddings.ts, backfill sidecar) and BOTH readers (both routes). Independently grep-confirmed: only these 4 files touch `imageEmbeddings`, all filter/set `model_version` consistently.
- No `import 'server-only'` re-added to `clip-model.ts` or `@/db`. Code default `semantic_search_mode` remains `disabled`.
- Rate-limit Pattern-2 rollback (semantic + similar routes) — verified: `rollbackSemanticAttempt` guards under-count (decrement only if `count>1`, else delete); no double-rollback path; the on-limit 429 correctly does NOT roll back.
- `countCodePoints` (`utils.ts`) — uses spread `[...s].length` (true code points), so client/server short-query guards agree on multi-byte input.

**Correctly DEFERRED (NOT re-reported — tracked with preserved severity in `plan-361`):**
- AGG-C8-01 (event-loop, HIGH) / AGG-C8-08 (runtime checksum, MEDIUM) / AGG-C8-13 (CSP/reload-storm, LOW) — all three are honestly recorded in `plan/plan-361-run6-cycle8-deferred.md` with original severity, concrete "needs architect-led design, not a same-cycle bolt-on" rationale, interim mitigations, and FIRED re-open criteria. Repo-policy-compliant; none silently dropped. Per task instructions I do not re-report deferred cycle-1..8 items.

**Non-CLIP repo:** swept (Explore, very thorough) — `clip-inference.ts` stub, rate-limit rollback, Stripe `async_payment_succeeded` (still a DOCUMENTED deferral, plan-316 CRT-R5C1-04, with the `payment_method_types:['card']` interim guard — not a regression), proxy admin guard (search routes correctly PUBLIC + same-origin gated), and all `imageEmbeddings` consumers — all CLEAN.

---

## Verdict Justification

REVISE on the strength of one real, HEAD-verified incomplete prior-cycle fix (CRT-C9-01). It is MEDIUM, not HIGH, after a Realist Check that credited the already-covered large artifacts, the operator-only trigger surface, easy rollback, and loud first-query detection. It is not a nitpick: the documented AGG-C8-02 failure mode (503-wedged production search after a "successful" seed) is only partially closed, and the remedy is a two-entry additive manifest change plus one test — high value, near-zero risk. No CRITICAL, no HIGH, no other MEDIUM/LOW. The review did not escalate to ADVERSARIAL because the finding is an isolated omission, not evidence of systemic decay — the rest of the activation surface is genuinely converged and was confirmed clean across both the seven cycle-8 fixes and the broader invariant set.

To upgrade to ACCEPT: add `config.json` + `tokenizer_config.json` SHAs to `CLIP_MODEL_MANIFEST` and extend TE-C8-01 to cover a config-absent partial seed.

---

## Open Questions (unscored)

- None material. (The `backfillClipEmbeddings` single-query recall ceiling and the always-present `aria-controls` referencing a conditionally-rendered id were both examined and resolved as correct-by-design; recorded under "What's Missing" / Multi-Perspective rather than as open questions.)
