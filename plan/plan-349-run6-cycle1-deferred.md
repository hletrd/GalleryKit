# Plan 349 — Run-6 Cycle-1 (orchestrator cycle 1/100) — Deferred Findings

**Date:** 2026-06-16
**Source:** `.context/reviews/_aggregate.md` (cycle-1 deep review, 11/11 agents).
**HEAD at planning:** `158541b6`.

Every cycle-1 review finding is either scheduled in **plan-348** or recorded here. No finding is silently dropped. Severities are NOT downgraded to justify deferral. Each item lists file+line, original severity/confidence, concrete deferral reason, and the exit criterion that re-opens it.

**Repo-rule basis for deferring production-only CLIP items:** the orchestrator RUN CONTEXT (authoritative for this loop) states the CLIP feature is "intentionally deployed DARK… the live activation… is DEFERRED BY EXPLICIT USER CHOICE" and that this loop "MUST NOT… flip `semantic_search_mode` to `'production'`." Findings whose impact materializes ONLY when production is enabled are therefore deferred under that explicit user-choice deferral, not silently dropped. They remain bound by all repo commit policies when picked up (GPG-signed, conventional+gitmoji, rebase-before-push, no `--no-verify`/force-push).

---

## DEFERRED — production-only CLIP risks (re-open when/if production activation is approved)

### DEF-1 — Production CLIP inference blocks the Node event loop (AGG-C10-04)
- **File/line:** `apps/web/src/lib/clip-model.ts` (`embedTextReal`/`embedImageReal`); consumers `apps/web/src/app/api/search/semantic/route.ts:241`, `apps/web/src/lib/image-queue.ts:446`. Root: `onnxruntime-node@1.21.0` `InferenceSession.run()` is synchronous on the main V8 thread (`backend.js:44-56`, `binding.d.ts:9-22`).
- **Severity/confidence:** HIGH / High (perf-reviewer C1, architect CONFIRMED-4). NOT downgraded.
- **Why deferred:** Impact (a single client globally freezing the site for tens of seconds/min, amplified by the shared `'unknown'` rate-limit bucket when `TRUST_PROXY` unset) materializes ONLY when `semantic_search_mode='production'` AND the dark feature is activated — which is deferred by explicit user choice. Today (dark) the production branch never executes, so there is zero live impact. Not a security/data-loss/correctness defect in the shipped (dark) state.
- **Why NOT a TASK-4-style cheap fix:** the correct remedy is a worker_threads/sidecar inference pool — a substantial concurrency-architecture change that should be designed (architect-led) as part of the eventual activation work, not bolted on while the feature is dark.
- **Exit criterion:** RE-OPEN as a blocking HIGH the moment production activation is scheduled. Production MUST NOT be enabled on the single-instance topology until inference is moved off the main thread. Pair with DEF-2.

### DEF-2 — Missing `image_embeddings(model_version, updated_at)` index + silent 5000-row recall cliff (AGG-C10-05)
- **File/line:** `apps/web/src/app/api/search/semantic/route.ts:251-278`, `apps/web/src/app/api/search/similar/[id]/route.ts:142-168`, `apps/web/drizzle/0012_*.sql` (no composite index).
- **Severity/confidence:** MEDIUM / High (perf-reviewer H1, architect TRADEOFF-B). NOT downgraded.
- **Why deferred:** Full-table scan + filesort + the hard `LIMIT 5000` recall cliff only matter once there are many embeddings being scanned, which only happens when stub/production search is enabled (dark). Adding a migration now would be schema churn for a dormant table; per the migration runbook a new migration also needs `reconcileLegacySchema` + monotonic journal `when` updates — appropriate to do as part of the activation work, not speculatively.
- **Note:** the brute-force JS cosine itself is the CORRECT choice for the no-vector-DB single-instance topology and is NOT a defect — only the missing index + silent truncation are.
- **Exit criterion:** RE-OPEN when production activation is scheduled OR the stub mode is enabled with a non-trivial library. Add `KEY (model_version, updated_at)` via a properly-journaled migration + `reconcileLegacySchema` mirror, and surface the 5000-row truncation to operators.

### DEF-3 — Detached background hooks call request-scoped `getGalleryConfig()` (AGG-C10-11d)
- **File/line:** `apps/web/src/lib/image-queue.ts` embedding hook + the caption hook (both detached `void (async…)()` IIFEs calling React `cache()`-wrapped `getGalleryConfig()`).
- **Severity/confidence:** LOW / High mechanism, Low impact (perf-reviewer M1, architect TRADEOFF-D). NOT downgraded.
- **Why deferred:** React `cache()` only dedupes within a single SSR render; off-request detached hooks get no dedupe, so there are 2 extra `admin_settings` SELECTs per image — but ONLY when the hooks actually run (i.e. when semantic/caption modes are enabled; both default off/dark). Zero cost in the shipped default state. A short-TTL process memo is a reasonable improvement but is pure optimization on a dormant path.
- **Exit criterion:** RE-OPEN when either background hook is enabled by default OR profiling under enabled-mode batch upload shows the settings SELECTs are material. Fix: short-TTL process memo for `semantic_search_mode`/caption mode.

---

## RECORD-ONLY — non-CLIP / pre-existing / test-infra (carried, re-confirmed UNCHANGED)

### DEF-4 — Transitive `postcss <8.5.10` advisory via Next build toolchain (AGG-C10-R1 / security INFO-1)
- **Severity/confidence:** INFO / High. **Why deferred:** build-time CSS path only, not request-reachable, NOT CLIP; `npm audit fix --force` wrongly proposes `next@9.3.3` (a catastrophic downgrade) — must NOT run it. CLAUDE.md "Always Use Latest Versions" is satisfied by tracking the upstream Next bump, not by force-downgrading. **Exit:** Next ships a release whose transitive postcss is ≥8.5.10; bump Next then.

### DEF-5 — Duplicated scan/enrich logic across the two search routes (AGG-C10-R2 / architect TRADEOFF-A)
- **Severity/confidence:** LOW (maintainability) / Medium. **Why deferred:** ~80 lines of scan→cosine→topK→enrich duplicated across `semantic/route.ts` and `similar/[id]/route.ts` is tolerable for exactly two consumers; extracting to `lib/` now is speculative generality (the repo's own architecture guidance warns against premature abstraction). **Exit:** a 3rd consumer of the cosine-scan/enrich shape appears, OR the enrichment SELECT shape needs to change (so the duplication becomes a real two-edit hazard). Then extract `scanAndScore()` + `enrichResults()` to `lib/`.

### DEF-6 — No negative-cache backoff on repeated model-load failure; no AbortController fetch-cancel on unmount (AGG-C10-R3 / debugger LR-3/LR-4)
- **Severity/confidence:** LOW / High. **Why deferred:** model-reload storm only occurs in production mode when the weights volume is absent (dark; production deferred). The fetch-cancel-on-unmount is benign in React 19 (the stale-response `requestIdRef` guards already prevent state clobbering). **Exit:** bundle the model-load backoff with DEF-1 production-activation work; the AbortController nicety only if a future React version regresses the benign behavior.

### DEF-7 — Prior-cycle carried items (AGG-C10-R4)
- `gain-map-detection.ts:87` harmless unreachable guard; `isLosslessWebpByChunk` ANMF non-descent (GPS stripped either way — zero privacy impact); `map-privacy.test.ts` structural-mirror tests (real protection is the compile-time UNION + runtime INNER-JOIN/throw, which IS covered); `.context/plans` gitignore-nuance / AGENTS.md:40 plans-dir doc.
- **Severity:** LOW. **Why deferred:** all re-confirmed unchanged at HEAD across cycles 1–9; none re-escalated; each has zero functional/security/correctness impact. **Exit:** unchanged from prior cycles (re-open only if a real regression touches the surrounding code).

### DEF-8 — Real-encode AVIF/WebP test-isolation flake (AGG-C10-R5)
- **Severity/confidence:** LOW (test infra) / nondeterministic. **Why deferred:** parallelism-sensitive cold-encoder / shared `public/uploads` test-infra flake, NOT a source defect; did not reproduce under `--no-file-parallelism`. **Exit:** when a green-cold guarantee is required on a parallel CI lane — implement scoped `mkdtemp` per-test output isolation + `beforeAll` encoder warm-up.

---

## DEFERRED — scoped-down sub-items from plan-348 implementation (recorded, not dropped)

### DEF-9 — Embed-hook write-side model_version executed test still source-grep (test-engineer F2)
- **Severity/confidence:** MEDIUM / High. **Why deferred this cycle:** the queue embed hook (`image-queue.ts`) is a detached `void (async…)()` inside a PQueue worker; behaviorally executing it requires mocking the queue + db + getGalleryConfig + the encoder in one harness. The wiring test was strengthened to assert the write is RAW (not base64) and references both STUB/PRODUCTION model versions (`image-queue-embed-wiring.test.ts`), but it remains a source-contract test, not an executed write. The read-side isolation IS behaviorally tested (`similar-route.test.ts`). **Exit:** add an executed stub-mode hook test (mock db.insert, assert the persisted `model_version === STUB_MODEL_VERSION`) — stub-mode only, no dark-flag flip.

### DEF-10 — cosineSimilarity scan-loop NOT switched to the dotProduct fast path (perf M3)
- **Severity/confidence:** MEDIUM / High (production-relevant only). **Why deferred:** the `dotProduct` unit-vector fast path landed as a tested primitive (`ec50158b`), but it must NOT replace `cosineSimilarity` in the route scan loops because STUB embeddings are NOT L2-normalized (`deterministicEmbedding` returns raw [-1,1] values) — only the real production encoder normalizes. Swapping unconditionally would corrupt stub-mode ranking. The optimization is only meaningful for the production brute-force scan, which is itself deferred (DEF-1/DEF-2, production-only/dark). **Exit:** bundle with the production scan optimization (DEF-2) — gate the dotProduct fast path on production mode (where all stored vectors are unit-length) once that work is picked up.

## Deferral integrity statement
No CRITICAL or HIGH finding on the SHIPPED (dark) surface is deferred:
- AGG-C10-01 (CRITICAL) — SCHEDULED (plan-348 TASK-1). It is latent only because the feature is dark, but the FIX requires no activation, so it is fixed this cycle.
- AGG-C10-02, AGG-C10-03 (HIGH) — SCHEDULED (plan-348 TASK-2, TASK-3).
- AGG-C10-04 (HIGH) is deferred ONLY because its impact is unreachable in the dark state and the user has explicitly deferred production activation; it is re-opened as blocking the instant activation is scheduled.
All other deferred items are LOW/INFO or production-only-when-activated. No security, data-loss, or live-correctness finding is deferred.
