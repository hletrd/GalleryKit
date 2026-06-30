# Cycle 22 Test-Engineer Review

Review target: current `HEAD` (`e072975c`, `master...origin/master`) in `/Users/hletrd/flash-shared/gallery`.

Scope: test coverage gaps, flaky tests, missing regression locks, weak fixtures, TDD opportunities, and gate blind spots. I did not edit source code and did not commit or push. This artifact is the only file intentionally changed.

## Inventory Examined

Project and workflow guidance:

- `AGENTS.md` instructions supplied in the prompt, including no source edits, review artifact output, quality gates, and deploy/git rules.
- `CLAUDE.md:90-117` for stack, key files, and CLIP/semantic-search runtime environment.
- `CLAUDE.md:430-443` for migration runbook and Drizzle journal constraints.
- `CLAUDE.md:495-500` for CLIP semantic-search production/offline model expectations.
- `CLAUDE.md:642-657` for deployment checklist and operator commands.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md` for review output expectations.

Gate and test configuration:

- `apps/web/package.json:9-26` for lint, typecheck, build, unit, E2E, and custom lint gates.
- `apps/web/vitest.config.ts:1-16` for unit-test include/exclude and timeout settings.
- `apps/web/playwright.config.ts:1-83` for E2E worker, browser, local-server, and remote-admin behavior.
- `apps/web/e2e/admin.spec.ts:1-160` and `apps/web/e2e/helpers.ts:1-172` for browser-flow coverage and admin test gating.

Focused live code and tests:

- Upload and Lightroom ingest: `apps/web/src/app/actions/images.ts:238-586`, `apps/web/src/app/api/admin/lr/upload/route.ts:114-516`, `apps/web/src/__tests__/images-actions.test.ts:239-277`, `apps/web/src/__tests__/images-action-toctou-claim.test.ts:1-57`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-450`, `apps/web/src/__tests__/upload-tracker.test.ts:1-76`.
- Semantic search and CLIP: `apps/web/src/lib/clip-model.ts:53-160`, `apps/web/src/lib/clip-model.ts:228-264`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-177`, `apps/web/src/__tests__/clip-model-contract.test.ts:1-50`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-80`, `apps/web/src/__tests__/clip-offline-load.test.ts:1-65`, `apps/web/src/__tests__/semantic-route-production.test.ts:1-41`, `apps/web/src/__tests__/semantic-search-route.test.ts`, `apps/web/src/__tests__/similar-route.test.ts:59-78`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:1-76`.
- Deployment and docs locks: `apps/web/deploy.sh`, `apps/web/src/__tests__/deploy-script-contract.test.ts:1-68`, `README.md:188`, `CLAUDE.md:67`, `CLAUDE.md:657`.
- Regression context: `.context/reviews/architect.md`, `.context/reviews/perf-reviewer.md`, `.context/plans/cycle-22-deferred.md`, prior `.context/reviews/test-engineer.md`.

I also spot-checked recently fixed areas so they would not be re-filed: backup download handle cleanup (`apps/web/src/app/api/admin/db/download/route.ts:42-96`, `apps/web/src/__tests__/backup-download-route.test.ts:186-203`) and photo navigation prefetch removal (`apps/web/src/components/photo-navigation.tsx:220-245`).

## Findings

### TEST22-01 - Lightroom upload route is protected mostly by source-text contracts, not route behavior

- Severity: Medium
- Confidence: High
- Status: Confirmed coverage gap / weak fixture
- Evidence:
  - `apps/web/src/app/api/admin/lr/upload/route.ts:114-151` claims upload quota and defines the `settleUpload` path.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:153-240` contains early validation and topic failure branches that must settle quota correctly.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:243-516` performs config snapshotting, disk checks, original save, post-save processing, DB insert, and queue enqueue.
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15` explicitly describes the test as a source-contract guardrail.
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:384-394` verifies the queue payload using regex against route source instead of executing `POST`.
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:407-450` verifies post-save containment by source ordering/string assertions.
  - In contrast, browser upload has a behavior-level snapshot assertion in `apps/web/src/__tests__/images-actions.test.ts:239-277`.
- Concrete failure scenario:
  - A refactor keeps the same strings in `route.ts` but changes runtime data flow, for example by passing stale config into `enqueueImageProcessing`, failing to settle quota after a parsed-form error, or constructing `FormData` fields differently. The source-contract test still passes because the tokens and order remain present, while Lightroom upload breaks only in production or during manual testing.
- Suggested fix:
  - Add a behavior-level route harness for `POST` with a synthetic `NextRequest`/`FormData` upload and mocked DB, upload tracker, config snapshot, file save, and queue modules.
  - Cover at least: successful upload enqueues the exact snapshot payload; validation failure settles quota; topic lookup failure settles quota; disk/full or save failure settles quota and does not enqueue.
  - Keep the source-contract tests only for invariants that are genuinely hard to execute, such as broad ordering constraints.
- TDD opportunity:
  - Start with a failing test that executes the Lightroom `POST` success path and asserts `enqueueImageProcessing` receives the same HDR/color fields currently regex-locked in `lr-upload-hdr-gate.test.ts:384-394`.

### TEST22-02 - CLIP inference pool and queue behavior is asserted by string matching instead of concurrency tests

- Severity: Medium
- Confidence: High
- Status: Confirmed regression-lock gap
- Evidence:
  - `apps/web/src/lib/clip-model.ts:53-64` parses `CLIP_INFERENCE_CONCURRENCY`, `CLIP_INFERENCE_MAX_PENDING`, and `CLIP_INFERENCE_QUEUE_TIMEOUT_MS`.
  - `apps/web/src/lib/clip-model.ts:65-72` stores global active inference and waiter state.
  - `apps/web/src/lib/clip-model.ts:99-109` removes waiters.
  - `apps/web/src/lib/clip-model.ts:117-145` implements timeout and abort-aware `waitForInferenceSlot`.
  - `apps/web/src/lib/clip-model.ts:148-160` increments/decrements active inference count and releases the next waiter.
  - `apps/web/src/__tests__/clip-model-contract.test.ts:32-40` checks queue-full, timeout, waiter removal, and release behavior by source strings only.
  - `apps/web/src/__tests__/clip-model-contract.test.ts:42-50` checks abort-signal threading by source strings only.
- Concrete failure scenario:
  - A race in waiter removal causes an aborted or timed-out semantic-search request to remain queued and later run anyway, or a thrown inference leaves `activeInferenceCount` elevated. The contract test still passes as long as matching text remains in the file, but production requests can hang, overrun memory, or return work for a disconnected client.
- Suggested fix:
  - Factor the pool into an injectable helper or export a test-only resettable scheduler.
  - Add deterministic fake-timer tests for: max pending rejection, timeout removal, abort removal, release after success, release after throw, and "aborted waiter is never executed".
  - Exercise the semantic route with an aborted request and assert `embedTextReal` is not started after abort where practical.
- TDD opportunity:
  - Write a failing fake-timer test for `CLIP_INFERENCE_CONCURRENCY=1`, `MAX_PENDING=1`: start one held inference, queue one request, abort it, release the held inference, and assert the aborted queued task never runs.

### TEST22-03 - Real CLIP/offline model smoke coverage is skipped by default while production route tests use mocks

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed conditional gate blind spot
- Evidence:
  - `CLAUDE.md:110-114` documents production CLIP runtime settings including `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, `CLIP_MODELS_ROOT`, and inference queue limits.
  - `CLAUDE.md:495-500` says real CLIP weights are not baked into the image and must be mounted at runtime.
  - `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-9` says the real CLIP test is skipped by default when weights are absent.
  - `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31` gates the suite on `CLIP_INTEGRATION=1`.
  - `apps/web/src/__tests__/clip-offline-load.test.ts:15-18` says offline load only runs with `CLIP_OFFLINE_LOAD=1` and seeded weights.
  - `apps/web/src/__tests__/clip-offline-load.test.ts:32-41` skips when required model files are missing.
  - `apps/web/src/__tests__/semantic-route-production.test.ts:3-4` mocks `embedTextReal`, and `apps/web/src/__tests__/semantic-route-production.test.ts:41` asserts the mock was called.
  - `apps/web/package.json:13` defines `test` as plain `vitest run`, with no CLIP integration lane.
- Concrete failure scenario:
  - A dependency, packaging, model-path, or ONNX/session change breaks real offline model loading. Unit and production-route tests still pass because they mock embedding, and the real smoke tests silently skip in the default gate. The first hard failure appears after deploy when `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.
- Suggested fix:
  - Add a documented optional CI/job or deploy preflight lane that seeds minimal approved CLIP assets and runs `CLIP_OFFLINE_LOAD=1 CLIP_INTEGRATION=1 vitest run src/__tests__/clip-offline-load.test.ts src/__tests__/clip-semantic-integration.test.ts`.
  - If full weights are too heavy for every run, add a lightweight "model mount/readability/session bootstrap" script that fails loudly when production CLIP is enabled but weights are absent or incompatible.
  - Make the skip visible in normal test output with an explicit post-test summary or dedicated npm script.
- TDD opportunity:
  - Add a failing preflight test around the production env contract: when `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, the configured `CLIP_MODELS_ROOT` must contain the required files and the loader must initialize at least once.

### TEST22-04 - Deployment command drift in docs is not caught by the deployment contract test

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed gate blind spot
- Evidence:
  - `README.md:188` shows the corrected command with `--env-file apps/web/.env.local`.
  - `CLAUDE.md:67` still shows `docker compose -f apps/web/docker-compose.yml up -d --build` without the env file.
  - `CLAUDE.md:657` repeats the stale deployment checklist command without the env file.
  - `apps/web/src/__tests__/deploy-script-contract.test.ts:12-18` builds a `deploymentDocs` string from `deploy.sh`, `AGENTS.md`, `CLAUDE.md`, `README.md`, and `apps/web/README.md`.
  - `apps/web/src/__tests__/deploy-script-contract.test.ts:56-60` asserts `--env-file` only in `deployScript`, not in documented manual compose commands.
  - `apps/web/src/__tests__/deploy-script-contract.test.ts:40-45` and `apps/web/src/__tests__/deploy-script-contract.test.ts:63-68` use `deploymentDocs` for other documentation invariants, proving the test already has the docs loaded but misses this drift.
- Concrete failure scenario:
  - An operator follows `CLAUDE.md:657`, runs compose without `--env-file`, and builds/deploys with missing public URL or runtime-derived build args. The deployment contract test passes because the script is correct, even though the operator-facing runbook is wrong.
- Suggested fix:
  - Update the stale `CLAUDE.md` commands.
  - Extend `deploy-script-contract.test.ts` to scan documented `docker compose ... up -d --build` commands and require `--env-file apps/web/.env.local` unless the line is explicitly marked as an example that assumes exported environment variables.
  - Keep this as a docs/gate test because the failure mode is operator behavior, not app code behavior.
- TDD opportunity:
  - First add a test that extracts compose build lines from `deploymentDocs`; it should fail on current `CLAUDE.md:67` and `CLAUDE.md:657`.

### TEST22-05 - Browser upload quota claim/settle invariant relies on source topology checks instead of stateful failure tests

- Severity: Medium
- Confidence: High
- Status: Confirmed weak regression lock
- Evidence:
  - `apps/web/src/app/actions/images.ts:238-242` claims upload quota before several asynchronous validations.
  - `apps/web/src/app/actions/images.ts:244-292` includes disk and topic failure branches that must settle the preclaimed quota.
  - `apps/web/src/app/actions/images.ts:267-279` carries the key invariant comment: any `await` added between claim and final settle must roll back on throw.
  - `apps/web/src/app/actions/images.ts:340-586` contains the per-file async processing loop and all-failed settlement path.
  - `apps/web/src/__tests__/images-action-toctou-claim.test.ts:1-10` describes the test as a source-order guard against TOCTOU and rollback regressions.
  - `apps/web/src/__tests__/images-action-toctou-claim.test.ts:18-31` asserts source ordering around the quota claim.
  - `apps/web/src/__tests__/images-action-toctou-claim.test.ts:34-43` asserts there are exactly four zero-success settle call shapes by regex.
  - `apps/web/src/__tests__/upload-tracker.test.ts:1-76` tests tracker primitives, but does not execute `uploadImages` failure paths with the tracker wired in.
- Concrete failure scenario:
  - A future awaited validation is inserted after quota claim and before the per-file `try`, or an existing branch starts throwing before a settle call. The regex count can still pass if the expected source snippets remain elsewhere, but the upload tracker leaks claimed bytes/count for up to the reset window, causing admins to hit false quota limits.
- Suggested fix:
  - Add behavior tests for `uploadImages` with mocked `getUploadTracker`, `statfs`, topic lookup, file save, and DB insert failures.
  - Assert tracker state or `settleUpload` calls after: low disk, disk check throw, missing topic, topic query throw, save failure, DB insert failure, and all-files-failed.
  - Consider centralizing claim settlement behind a small idempotent helper so tests can assert one observable cleanup path instead of source topology.
- TDD opportunity:
  - Start with a failing behavior test that forces a topic lookup throw after quota claim and asserts claimed quota returns to zero.

## Final Sweep and Skipped Files

I inspected the main app/test/gate surfaces that affect uploads, Lightroom ingest, semantic search/CLIP, deployment, admin E2E, and recently changed regression areas. I also used existing cycle 22 architect/performance reviews and the deferred plan as cross-checks, but the findings above are independently grounded in current files.

Skipped or intentionally not exhaustively reviewed:

- Binary/static assets, uploaded-image fixtures, generated screenshots, and cache/build outputs.
- Historical review and plan artifacts beyond the current cycle context and prior test-engineer baseline.
- Full line-by-line review of every UI component where no test-gate or regression-lock signal surfaced during repository search.
- Full execution of the entire test suite; this was a review-only pass focused on coverage design and gate blind spots. No runtime failures are claimed here.

No source-code edits, commits, pushes, or deploy actions were performed.
