# Critic Review — Run-6 Cycle-8 (post-CLIP-activation, fresh-angle)

- **HEAD:** `1a325fa6`
- **Agent:** critic
- **Date:** 2026-06-17
- **Angle:** The fresh-angle feature-activation audit the cycle-7 critic explicitly recommended ("a fresh-angle feature/behavior audit ... would surface more signal"). The ONLY delta since the cycle-7 convergence (`a7758ef0`, 0/11 findings) is the three commits `e0da12ee` + `b1d6331c` + `1a325fa6` that turned the previously-DARK CLIP semantic-search feature into an operationally-supported PRODUCTION feature. Scrutinized hardest: `clip-paths.ts`, the downloader, the `server-only` removal, and the live consumption paths.
- **Mode:** Started THOROUGH; **ESCALATED to ADVERSARIAL** after surfacing one HIGH (DEF-1/DEF-17 re-open). The escalation expanded scope to the full deferred-blocker checklist (plan-349 / plan-351) and the seed→load contract's completeness.

---

## VERDICT: REVISE — 1 HIGH (re-opened) + 1 MEDIUM (novel) + 2 MEDIUM (re-opened) + 1 LOW (re-opened) + 1 LOW (novel)

The seed→offline-load PLUMBING the three commits fixed is **correct** — I verified the load-bearing empirical claims against the actual installed `@huggingface/transformers@3.8.1` source and they hold. The path-doubling fix, the revision-subdir layout claim, the FileCache write/read symmetry, and every HARD GUARD are sound.

**But the commits operationalized PRODUCTION CLIP (CLAUDE.md §"CLIP semantic search" now documents the full go-live procedure as supported) without addressing ANY of the four production-activation blockers that prior cycles explicitly DEFERRED with the exit criterion "RE-OPEN the moment production CLIP activation is scheduled."** Activation is the trigger. The deferrals' own contract requires these to surface now. This is not re-litigating closed work — these were never closed; they were parked behind "dark by default," and the dark just got a documented light switch.

The most serious (DEF-1/DEF-17, HIGH) is a self-inflicted whole-site availability hazard on the single-instance topology that the deferral states in capital letters MUST be fixed before enabling production. I am NOT proposing to weaken any HARD GUARD; the `SEMANTIC_SEARCH_ALLOW_PRODUCTION` + DB-row double-gate still bounds the blast radius to operators who deliberately flip both, which is the only reason this is REVISE and not REJECT.

---

## Pre-commitment predictions vs. findings

Before reading the diffs in detail I predicted the highest-risk areas for an activation commit set:

1. **Are the empirical comments in `clip-paths.ts` (transformers v3 revision-subdir, path.join doubling) actually TRUE?** → **YES, both verified against installed source.** `hub.js:488`: `revision === 'main' ? requestURL : pathJoin(path_or_repo_id, revision, filename)`. `FileCache.put`/`.match` both `path.join(this.path, request)`. The comments are accurate, not overconfident. (No finding — credit where due.)
2. **Is the seed→offline-load contract genuinely CLOSED, or are there files the loader needs that the manifest/idempotency don't cover?** → **GAP FOUND.** The manifest verifies 2 files; `from_pretrained` fatally requires ≥4. See CRT-C8-02.
3. **Did activation re-trigger the deferred production blockers (event-loop, index, checksum)?** → **YES — none addressed.** See CRT-C8-01/03/04/05.
4. **Did the `server-only` removal open a client-leak path?** → **NO.** Native `sharp`+`@huggingface/transformers` imports + the boundary test's `hasNativeModuleImport()` detector cover it; HARD GUARD respected. (No finding.)
5. **Is the live encoder's 1024→512 Matryoshka math correct?** → **YES.** `truncateAndNormalize` subarrays first 512 then re-normalizes; the offline-load test asserts `dims=512 norm≈1.0`. (No finding.)

4 of 5 predictions confirmed a real issue or cleanly cleared the code. The empirical-claim audit (prediction 1) is the one I most expected to break and it held — the author did the homework.

---

## Change surface since cycle-7 convergence (`git log a7758ef0..1a325fa6`)

```
e0da12ee fix(search): resolve absolute CLIP_MODELS_ROOT in downloader (+ offline-load layout)
b1d6331c test(search): pin CLIP_MODELS_ROOT resolution + offline-load activation
1a325fa6 fix(search): drop server-only from clip-model so tsx backfill can import it
```

Shipping-source files touched: `src/lib/clip-paths.ts` (new), `scripts/download-clip-models.ts`, `src/lib/clip-model.ts`, plus test files. The cycle-7 aggregate confirms the prior 0-finding convergence was at `a7758ef0` and that CLIP was still self-skipping (`CLIP_INTEGRATION !== '1'`) — i.e. **the prior convergence never reviewed the activated feature.** That is the whole justification for this pass.

---

## What the commits got RIGHT (verified, not assumed)

- **Empirical claim #1 (path doubling)** — `resolveClipModelsRoot` (clip-paths.ts:60-66) uses `isAbsolute(root) ? root : join(cwd, root)`. Correct. The old `join(process.cwd(), absolutePath)` doubling is genuinely fixed and pinned by `clip-paths.test.ts:39-46`.
- **Empirical claim #2 (revision-subdir layout)** — VERIFIED against `node_modules/@huggingface/transformers/src/utils/hub.js:488`. For a non-`main` revision (the pin is a 40-hex SHA), the FS cache key is `pathJoin(repoId, revision, filename)`. `clipModelArtifactDir` (clip-paths.ts:77-80) returns `<root>/<org>/<name>/<revision>` — exactly the write key (`FileCache.put` → `path.join(cacheDir, cacheKey)`) and the offline read key. The `revision === 'main'` edge the prompt asked about is moot: the pin is a SHA, the non-main branch is taken, and the comment's claim is precise.
- **Shared resolver (no drift)** — both consumers assign `env.cacheDir = resolveClipModelsRoot()` from the same `CLIP_MODELS_ROOT` env. They cannot drift *given the same env value* (see CRT-C8-06 for the doc-consistency caveat).
- **`server-only` removal** — sound and necessary (tsx scripts import the module; `server-only` throws under plain Node). Client-safety preserved by native imports + the boundary test's native-import detector + the new contract pin (`clip-model-contract.test.ts:44-52`). HARD GUARD #1 respected.
- **Checksum-on-mismatch** — `verifyAndCleanArtifacts` deletes a checksum-mismatched file before aborting (good; prevents a poisoned weight from being trusted). The runtime `embedTextReal` failure path in the semantic route degrades to 503 with rate-limit rollback (semantic/route.ts:241-244) — graceful, not a crash.

---

## Critical / High Findings

### CRT-C8-01 — [HIGH] Production CLIP activation shipped without moving inference + cosine scan off the main event loop (re-opened DEF-1 / DEF-17, exit criterion FIRED)

- **Confidence:** HIGH.
- **Files:** `apps/web/src/lib/clip-model.ts:78-108` (synchronous `InferenceSession.run()` via `await model(...)`), `apps/web/src/app/api/search/semantic/route.ts:265-274` (synchronous `.map()` cosine over up to 5000 rows), `apps/web/src/app/api/search/similar/[id]/route.ts:153-163` (same shape).
- **Evidence (verified at HEAD):** `grep -rn "worker_threads|setImmediate|new Worker|yield" src/app/api/search/ src/lib/clip-model.ts` → **zero** matches (only an unrelated comment using the word "yield"). The deferral plan-349 DEF-1 states verbatim: *"RE-OPEN as a blocking HIGH the moment production activation is scheduled. Production MUST NOT be enabled on the single-instance topology until inference is moved off the main thread."* plan-351 DEF-17 echoes it for the cosine scan: *"RE-OPEN as a BLOCKING HIGH the moment production CLIP activation is scheduled."* CLAUDE.md (the on-disk doc, lines 486-492) now documents production activation as a fully-supported operator procedure — i.e. activation has been *operationalized*, which is the trigger condition.
- **Flawed assumption:** The commits treat "make the seed→load work" as the activation deliverable. But `onnxruntime-node`'s `InferenceSession.run()` is **synchronous on the V8 main thread** (documented in DEF-1, confirmed by the absence of any off-thread path). The shipped Docker Compose topology is explicitly single-web-instance (CLAUDE.md §"Runtime topology").
- **Concrete failure scenario:** Operator follows the now-documented go-live procedure (seed weights, run `--production` backfill, set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, set the DB row). First public semantic query triggers a **cold model load** (hundreds of MB ONNX session init) + synchronous inference + a synchronous cosine scan over up to 5000 embeddings — all on the one Node thread that serves every other HTTP request. For the duration (seconds to tens of seconds on a cold load), the **entire site freezes** for all visitors — homepage, photo viewer, admin, health probe. The shared-`unknown` rate-limit bucket (when `TRUST_PROXY` unset) makes this trivially repeatable by one client. This is precisely the impact DEF-1 enumerates and forbids before activation.
- **Fix (per the deferral's own exit criterion):** Before production is enabled, move ONNX inference to a `worker_threads`/sidecar pool (architect-led, as DEF-1 specifies) AND chunk/yield or push the cosine scan to a worker or MySQL-side. At minimum, gate the documented go-live procedure behind a prominent "single-instance availability hazard — do NOT enable on the production topology until DEF-1/DEF-17 land" warning so an operator reading CLAUDE.md cannot activate into a foot-gun. The activation commits should not have made the procedure look turnkey while the HIGH blocker is open.

---

## Medium Findings

### CRT-C8-02 — [MEDIUM] Seed manifest + idempotency short-circuit verify only 2 of the ≥4 files the offline loader fatally requires (NOVEL)

- **Confidence:** HIGH (mechanism), MEDIUM (severity).
- **Files:** `apps/web/scripts/clip-model-manifest.ts:25-30` (manifest = `onnx/model_quantized.onnx` + `tokenizer.json` only), `apps/web/scripts/download-clip-models.ts:62-76` (idempotency short-circuit checks ONLY the ONNX file then `return`s "Nothing to do").
- **Evidence (verified against installed source + the HF repo tree at the pinned revision):**
  - Model load: `configs.js:54` → `getModelJSON(..., 'config.json', true, ...)` — **`fatal=true`**.
  - Tokenizer load: `tokenizers.js:70-71` → `getModelJSON(..., 'tokenizer.json', true)` AND `getModelJSON(..., 'tokenizer_config.json', true)` — **both `fatal=true`**.
  - `getModelText`/`getModelJSON` with `fatal=true` + `allowRemoteModels=false` + file absent → **throws** `env.allowRemoteModels=false ... file was not found locally` (hub.js:535-538).
  - The pinned revision's repo contains `config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json` (HF tree API confirmed). The manifest covers exactly **two** of these; `config.json` and `tokenizer_config.json` are **unverified** and the idempotency check never looks at them.
- **Flawed assumption:** The commit message asserts the seed→offline-load contract "round-trips NATIVELY." It does on a *clean full download into an empty volume* (where `from_pretrained` fetches every file). But the "verified-complete seed" guarantee the manifest+idempotency machinery exists to provide is **incomplete**: it certifies the cache healthy when 2 files match, even if a config file is missing.
- **Concrete failure scenario:** A download is interrupted after the large `model_quantized.onnx` lands but before `config.json` (network blip, OOM, container killed). Operator re-runs the seed: the idempotency check (line 64 `existsSync(onnxPath)` + checksum) matches → prints "Checksum OK — already up to date. Nothing to do." and exits 0. The cache is now *permanently* reported healthy across every re-run, yet the runtime offline load throws on `config.json`. Symptom at the app: every production semantic query 503s (semantic/route.ts:241-244) and every upload logs `[Queue] Failed to store embedding`. The operator has a green seed script and a broken feature with no signal pointing at the missing file.
- **Why it's MEDIUM not HIGH (Realist Check):** Fails closed (503/warning, no data loss/corruption); the happy path (empty-volume full download) works; recovery is "delete the dir and re-seed." But it directly undermines the verify-gate's stated purpose and can wedge across re-runs, so it is a real defect, not awareness-only. **Mitigated by:** detection is immediate on first query, and a clean re-seed fixes it — but the operator must first know to distrust the "Nothing to do" output.
- **Fix:** Add `config.json` and `tokenizer_config.json` to `CLIP_MODEL_MANIFEST` (pin their SHA-256 at the revision), and make the idempotency short-circuit (line 64) require ALL manifest files present+matching before it returns "Nothing to do" — i.e. run `verifyAndCleanArtifacts` for the skip decision too, not just `existsSync(onnxPath)`. This is distinct from DEF-18 (CRT-C8-04), which is about runtime trust of an *existing* ONNX; this is about *absent* files the verify gate never names.

### CRT-C8-03 — [MEDIUM] No `image_embeddings(model_version, updated_at)` index — production scan is full-table + filesort with a silent 5000-row recall cliff (re-opened DEF-2, exit criterion FIRED)

- **Confidence:** HIGH.
- **Files:** `apps/web/src/db/schema.ts:` `imageEmbeddings` (PRIMARY KEY on `image_id` only — no secondary index), `apps/web/drizzle/0012_image_embeddings.sql` (adds no index), query at `semantic/route.ts:250-255` and `similar/[id]/route.ts:142-147` (`WHERE model_version=? ORDER BY updated_at DESC LIMIT 5000`).
- **Evidence:** Schema dump confirms `image_embeddings` has only `PRIMARY KEY (image_id)` + the FK; migration 0012 adds no `KEY`. The scan thus does a full table scan + filesort on every semantic/similar request once production is enabled. DEF-2 exit criterion: *"RE-OPEN when production activation is scheduled ... Add KEY (model_version, updated_at) via a properly-journaled migration + reconcileLegacySchema mirror, and surface the 5000-row truncation to operators."*
- **Concrete failure scenario:** With a non-trivial library (the `--production` backfill populates one row per processed photo), each request filesorts the whole table; combined with CRT-C8-01's synchronous scan this lengthens the main-thread freeze. Beyond 5000 embeddings, the `LIMIT 5000` silently drops the oldest rows from recall with no operator signal — "similar"/"semantic" quietly stops finding older photos.
- **Fix:** Add `KEY (model_version, updated_at)` via a properly-journaled migration (monotonic `when`, `reconcileLegacySchema` mirror per the runbook) and surface the truncation. Bundle with CRT-C8-01.

### CRT-C8-04 — [MEDIUM] Runtime loader trusts on-disk ONNX bytes with no checksum before `from_pretrained` (re-opened DEF-18, exit criterion FIRED)

- **Confidence:** MEDIUM.
- **File:** `apps/web/src/lib/clip-model.ts:81-100` (`getModelBundle` calls `AutoModel.from_pretrained` directly; no SHA check against `CLIP_MODEL_MANIFEST`).
- **Evidence:** `getModelBundle` sets `env.cacheDir`/`allowRemoteModels=false` and loads — no integrity gate. DEF-18 exit criterion: *"RE-OPEN when production activation is scheduled; have getModelBundle() verify the ONNX SHA-256 against the manifest (or gate startup on download-clip-models.ts --verify-only) before from_pretrained."*
- **Concrete failure scenario:** A partially-truncated or bit-rotted ONNX that survives on the `:ro` volume is loaded and instantiated unverified. ONNX session init on a corrupt file either throws (caught → 503) or, worse, loads a subtly-wrong session producing garbage embeddings that pollute production results under `PRODUCTION_MODEL_VERSION`. The downloader's checksum only runs at seed time, not at load time.
- **Fix:** In `getModelBundle`, before `from_pretrained`, `sha256File` the manifest artifacts under `clipModelArtifactDir(CLIP_MODELS_ROOT)` and refuse to load on mismatch (or gate container startup on a `--verify-only` pass). Note this finding shares the manifest with CRT-C8-02 but is independent: even with a complete manifest, the *runtime* never checks it.

---

## Low Findings

### CRT-C8-05 — [LOW] Model-reload storm + CSP `wasm-unsafe-eval` gap on activation (re-opened DEF-20)

- **Confidence:** LOW (reload storm) / MEDIUM (CSP latent, but onnxruntime-node is native today so inert).
- **Files:** `apps/web/src/lib/clip-model.ts:101-105` (on load failure `loadPromise = null` → next request retries the full cold load with no backoff), `apps/web/src/lib/content-security-policy.ts` (no `wasm-unsafe-eval`).
- **Evidence:** The catch nulls the cached promise unconditionally — on a permanently-absent/broken volume in production mode, every request re-attempts a multi-hundred-MB cold load (amplifies CRT-C8-01). DEF-20 exit criterion: add a short negative-cache TTL on the rejected load. The CSP gap is inert today (server-side native runtime) but DEF-20 flags it for any future onnxruntime-web/WASM path.
- **Fix:** Add a short negative-cache backoff (e.g. 30-60s) on a rejected model load before allowing a retry; add the conditional `wasm-unsafe-eval` gated behind `SEMANTIC_SEARCH_ALLOW_PRODUCTION` only if/when a WASM backend is adopted. Bundle with CRT-C8-01.

### CRT-C8-06 — [LOW] Doc-vs-doc drift: the backfill script's own sidecar example omits `-e CLIP_MODELS_ROOT`, which silently re-introduces the path-mismatch the commits just fixed (NOVEL)

- **Confidence:** MEDIUM.
- **Files:** `apps/web/scripts/backfill-clip-embeddings.ts:13-21` (header sidecar example: `--env-file .env.local` + a `data/models/clip:/app/data/models/clip:ro` mount, but **no** `-e CLIP_MODELS_ROOT=...`), vs. CLAUDE.md:466 / 481 (the canonical procedure **does** set `-e CLIP_MODELS_ROOT=/app/data/models/clip`). `apps/web/.env.local.example` does **not** define `CLIP_MODELS_ROOT`.
- **Flawed assumption:** "Both consumers share the resolver so they can never drift." True only when the env value is identical in both processes. The runtime container bakes `ENV CLIP_MODELS_ROOT=/app/data/models/clip` (Dockerfile:90). A sidecar that copies the *backfill script's own header example* (not CLAUDE.md) runs with `CLIP_MODELS_ROOT` unset → resolver falls back to `data/models/clip` relative to cwd `/app/apps/web` → `/app/apps/web/data/models/clip`, while the weights are mounted at `/app/data/models/clip`. The `--production` backfill then can't find the model and every row fails.
- **Concrete failure scenario:** Operator pastes the backfill sidecar from the script header, runs `--production`, and gets a wall of `Failed for image N: file not found locally` because the resolved cache root and the mount diverge — the *exact symptom class* `e0da12ee` set out to eliminate, re-introduced via an inconsistent doc.
- **Fix:** Add `-e CLIP_MODELS_ROOT=/app/data/models/clip` to the sidecar example in `backfill-clip-embeddings.ts:13-21` (and the `download-clip-models.ts:26` usage line), or add `CLIP_MODELS_ROOT` to `.env.local.example` with a comment, so every documented invocation path sets it identically.

---

## What's Missing (gap analysis)

- **No activation-blocker linkage.** The three commits make production turnkey in CLAUDE.md but neither the commits nor a new plan reconcile against plan-349 DEF-1/2/3/6 (the *authoritative* "CLIP production-activation checklist" per plan-351:154) or plan-351 DEF-17/18/19/20. The deferrals' re-open triggers fired; nothing re-opened them.
- **No test exercises the activated production path.** `clip-paths.test.ts` and `clip-model-contract.test.ts` pin path math + the no-`server-only` invariant; `clip-offline-load.test.ts` is env-gated and self-skips in CI. There is zero coverage asserting (a) a partial seed is rejected, (b) the runtime checksums weights, (c) the scan/inference doesn't block, or (d) the index exists. The green suite gives false confidence that "CLIP activation is reviewed."
- **No operator signal for the 5000-row recall cliff** (DEF-2) — silent truncation remains.
- **DEF-19 (unbounded fire-and-forget production embed hook + per-image config read)** — not separately re-opened here because it overlaps CRT-C8-01's "off-thread" remedy and is MEDIUM/inert until the batch-upload + production combination; flagged in Open Questions.

---

## Ambiguity Risks (the activation commits' doc surface)

- CLAUDE.md §"Activating production" reads as a complete, safe runbook. **Interpretation A:** an operator reads it as "these are all the steps; it's supported, go." **Interpretation B (intended by the deferrals):** "production is gated and inert; do NOT enable on the single-instance topology until DEF-1/DEF-17 land." The doc currently supports A while the deferral record requires B. **Risk if A is chosen:** whole-site freeze (CRT-C8-01). The runbook must state the hazard inline.

---

## Multi-Perspective Notes

- **Executor:** The plumbing fixes are unambiguous and correct; an executor could re-run the seed and it works on a clean volume. The blocker work (worker-thread pool, index migration, runtime checksum, manifest completeness) is substantial and architect-led, not a token edit — matching the deferrals' own "not a cheap fix" framing.
- **Stakeholder:** The feature now *appears* shippable but the prerequisite availability/recall/integrity work the team itself gated on is undone. Shipping the light switch before the wiring is the core mismatch.
- **Skeptic:** I tried hardest to break the empirical comments (they held), the path math (held), the `server-only` removal (held), and the Matryoshka math (held). The author clearly verified the transformers internals. The finding is NOT in the commits' stated scope — it's in what activation *implies* and what the deferrals *promised*. The strongest counter-argument is "production is still double-gated, so it's still effectively dark" — which is why CRT-C8-01 is HIGH-but-REVISE, not CRITICAL-REJECT. If the operator never sets `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, every finding here is inert. But the prompt states the feature is now live in production, and CLAUDE.md documents exactly how to make it so.

---

## Realist Check (severity pressure-test)

- **CRT-C8-01 (HIGH):** Realistic worst case is a whole-site freeze on a deliberately-activated single instance — not theoretical. Mitigating factor: double opt-in gate. Detection: immediate (site hangs). NOT downgraded — availability impact on the documented topology is real and the deferral itself rates it HIGH. Held at HIGH; severity-to-the-repo bounded to REVISE by the gate.
- **CRT-C8-02 (MEDIUM):** Worst case is a wedged seed reported healthy; fails closed, no data loss, clean re-seed fixes it. Held at MEDIUM (not HIGH) — **Mitigated by:** immediate 503 detection + recoverability, but it genuinely defeats the verify gate's purpose so not downgraded to LOW.
- **CRT-C8-03 (MEDIUM):** Held — full-table filesort + silent recall cliff are real once a library exists; bounded today by small scale.
- **CRT-C8-04 (MEDIUM):** Held — integrity gap, fails closed on a hard-corrupt file but risks silent garbage on a subtle one.
- **CRT-C8-05 / CRT-C8-06 (LOW):** Held at LOW — reload storm is production-volume-absent only; doc drift requires copying the wrong example.

No finding involves data loss, security breach, or financial impact, so none was floored there; equally none was inflated by hunting-mode momentum — each maps to a pre-existing deferral or a source-verified mechanism.

---

## Hard-guard compliance

- Did NOT propose adding `import 'server-only'` to `clip-model.ts` (its removal is correct; HARD GUARD honored). The boundary-test native-import substitute is sound.
- Did NOT propose weakening `semantic_search_mode: 'disabled'` default, the `SEMANTIC_SEARCH_ALLOW_PRODUCTION` heal, the revision pin, `allowRemoteModels=false`, or `model_version` isolation. Every finding here ADDS safety before activation; none relaxes a gate.
- Did NOT re-report any item closed in cycles 1-7. CRT-C8-01/03/04/05 are explicit re-opens of plan-349/plan-351 deferrals whose "re-open at activation" triggers fired at HEAD `1a325fa6`; CRT-C8-02 and CRT-C8-06 are novel.

---

## Evidence of green at HEAD `1a325fa6`

- `vitest run clip-paths.test.ts clip-model-contract.test.ts` — 17/17 PASS (the plumbing pins hold; they just don't cover the blockers).
- `@huggingface/transformers` installed version = 3.8.1 (matches the comment's claim).
- `hub.js:488` confirms the revision-subdir cache key for non-`main` revisions (empirical claim TRUE).
- `grep worker_threads|setImmediate|Worker|yield` in search routes + clip-model = 0 (synchronous main-thread scan confirmed).
- `image_embeddings` schema + migration 0012 = PRIMARY KEY only, no `(model_version, updated_at)` index.
- `.env.local.example` defines no `CLIP_MODELS_ROOT`; Dockerfile:90 bakes `/app/data/models/clip`; backfill header example omits the `-e`.

---

## Open Questions (unscored)

- **DEF-19 (fire-and-forget production embed concurrency):** the upload hook is correctly `void`-detached and failure-isolated (image-queue.ts:434-478), but under `production` + a large batch upload it spawns unbounded concurrent ONNX inferences (CPU oversubscription, not corruption — `session.run` is thread-safe). Overlaps CRT-C8-01's off-thread remedy. Re-open with the activation work per plan-351 DEF-19; not separately scored here to avoid double-counting the same fix.
- **Is production ACTUALLY enabled in the live deployment, or merely made enable-able?** The commits + CLAUDE.md make it operationally supported; whether the operator has set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` + the DB row determines whether CRT-C8-01/03/04 are live or latent. Either way the activation commits should not have shipped the turnkey runbook ahead of the HIGH blocker. A future cycle should confirm the live `semantic_search_mode` value.
- **Marginal value of further pure-plumbing review:** none — the plumbing is correct. The next useful pass is verifying the blocker-remediation work (worker pool + index + runtime checksum + manifest completeness) once it lands.
