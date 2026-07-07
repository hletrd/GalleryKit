# Document-Specialist Review - Cycle 18

Date: 2026-07-08 KST
Reviewer lane: document-specialist
Scope: code/docs/runbook/test mismatch review against authoritative repo sources. External API/version lookup was not needed for the confirmed findings because both are repo-local behavior mismatches.

Constraints honored: review-only; no source edits, no commits, no pushes, no deploys. The pre-existing untracked `.context/reviews/cycle-8-2026-07-07/perf-reviewer.md` was not touched.

## Inventory And Coverage

Required policy and planning context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-17-2026-07-08-plan.md`
- `.context/plans/cycle-17-2026-07-08-deferred.md`

Documentation-relevant inventory was built with `rg --files` before findings. Surfaces reviewed:

- Current operator docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`
- Current plan ledgers: `.context/plans/README.md`, Cycle 17 plan/deferred files
- Code comments treated as operator/source contracts: CLIP sidecar, color sidecar, advisory locks, restore/migration, service worker, upload storage, queue bootstrap
- Tests-as-docs/source contracts: Cycle 17 source contracts, advisory-lock release contract, CLIP/backfill tests, restore/upload tests, privacy/rate-limit/action-origin guard tests
- Authoritative code for mismatches: CLIP embedding constants, canonical sidecar, live queue bootstrap, server action, deploy scripts, schema/migration scripts

Skipped deliberately: secret env files, runtime upload/data directories, binary assets, `node_modules`, build output, and clearly historical archives unless current docs pointed to them. No external version/API fact materially affected the findings.

## Confirmed Issues

### DOC-C18-01 - CLIP backfill runbooks say `SEMANTIC_SCAN_LIMIT` caps candidate rows, but the sidecar now caps embedding attempts

Severity: Low
Confidence: High
Status: Confirmed issue.

Files/regions:

- `CLAUDE.md:598`
- `apps/web/README.md:85`
- `apps/web/scripts/backfill-clip-embeddings.ts:157-190`
- `apps/web/scripts/backfill-clip-embeddings.ts:199-207`
- `apps/web/scripts/backfill-clip-embeddings.ts:237-239`

Why this is a real problem:

The current runbook says the sidecar processes at most `SEMANTIC_SCAN_LIMIT` candidate rows per run. The code no longer does that after the Cycle 17 skipped-prefix fix: it computes `remainingEmbeddingBudget = SEMANTIC_SCAN_LIMIT - attemptedEmbeddings`, advances a keyset cursor through candidate rows, and increments `attemptedEmbeddings` only when it is about to run stub/real embedding inference. Missing `filename_original` or missing original-path rows fail and advance the cursor without consuming the limit.

Concrete failure scenario:

An operator sets `SEMANTIC_SCAN_LIMIT` expecting to bound total row scanning/DB/filesystem work per run. A corpus with many missing originals can scan and fail more than that many candidate rows before the inference-attempt budget is exhausted. The final `Reached SEMANTIC_SCAN_LIMIT` message means "embedding attempts reached the cap," not "candidate rows reached the cap," so the runbook overstates the boundary.

Suggested fix:

Update `CLAUDE.md`, `apps/web/README.md`, and the script header to say the sidecar caps embedding attempts per run; failed/missing-original candidates still advance the keyset cursor and may make the candidate scan exceed the limit. If a hard candidate-row cap is intended, add a separate `scannedCandidates` budget in code and document both counters.

### DOC-C18-02 - CLIP sidecar header says operators can raise concurrency after real ONNX ships, but production ONNX already ships and concurrency is hardcoded

Severity: Low
Confidence: High
Status: Confirmed issue.

Files/regions:

- `apps/web/scripts/backfill-clip-embeddings.ts:49-50`
- `apps/web/scripts/backfill-clip-embeddings.ts:59-60`
- `apps/web/scripts/backfill-clip-embeddings.ts:73-75`
- `apps/web/scripts/backfill-clip-embeddings.ts:81-85`

Why this is a real problem:

The same header documents `--production` real `jina-clip-v2` embeddings and imports `embedImageReal`, but still says operators can raise `BATCH_CONCURRENCY` "once the real ONNX inference ships." The constant is also hardcoded at `BATCH_CONCURRENCY = 2`; there is no env/CLI knob to raise it. This leaves a stale future-tense operator instruction inside the executable runbook.

Concrete failure scenario:

An operator tuning a seeded production backfill reads the header, looks for a supported way to raise concurrency, and either cannot find one or edits the script directly. Direct edits risk diverging from the locked sidecar behavior and can overload the deploy host without the same bounded/env-parsed pattern used by the color sidecar.

Suggested fix:

Replace the stale sentence with the actual contract: concurrency is currently fixed at 2. If tuning is desired, implement a bounded env parser such as `CLIP_BACKFILL_CONCURRENCY` with a documented max and tests before documenting it as operator-adjustable.

## Likely Issues

No additional likely documentation/code mismatches were promoted. Current plan indexing is internally consistent for Cycle 17, and previous Cycle 17 document findings for stale Cycle 16 status, CLIP command examples, upload storage comments, metadata icon routing, and localized analytics country names appear addressed in current sources.

## Manual-Validation Risks

### DOC-C18-MV-01 - Live deployment/operator state cannot be verified from the repository

Severity: Low
Confidence: High
Status: Manual-validation risk.

Files/regions:

- `apps/web/README.md:80-88`
- `CLAUDE.md:553-631`
- `CLAUDE.md:509-521`

Why this needs validation:

The checked-in docs and code agree that production semantic search, proxy topology, env-file application, and deploy completion require live host state. This static repo pass cannot prove model weights are seeded, the DB mode row is production, the running container has `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, nginx is using the checked-in template, or the latest commit is deployed.

Concrete failure scenario:

A later report states "semantic search is live" or "Cycle 17 deploy completed" from repo state alone while production still serves an older container or lacks CLIP weights/env.

Suggested fix:

Require concrete operator evidence in any completion ledger: deploy transcript, health smoke, `npm run test:clip:preflight`, semantic/similar smoke when production mode is enabled, and proxy topology verification against the live URL.

## Final Sweep

I did not find other current docs/runbooks/tests that contradicted authoritative code in the reviewed lanes. Historical `.context` archives were treated as history unless surfaced by current plan/docs links. External docs were not queried because no finding depends on a changing external API/version fact.
