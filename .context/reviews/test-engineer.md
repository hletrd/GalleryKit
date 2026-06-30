# Cycle 23 Test-Engineer Deep Review

Review target: current `HEAD` (`45208b21`, branch `master`) in `/Users/hletrd/flash-shared/gallery`.

Role: test-engineer. Scope: full-repository test strategy, regression coverage, flaky patterns, TDD gaps, test/source mismatches, migration/script/package gates, and docs-to-test alignment. I kept changes limited to this review file.

## Inventory Examined

Instruction and architecture docs:

- `AGENTS.md:1-49` and the prompt-provided AGENTS overlay for repo rules, quality gates, deploy expectations, and review artifact output.
- `CLAUDE.md:1-671`, including stack overview, runtime/security model, color/HDR contracts, race protections, migration runbook, deploy runbook, CLIP production activation, lint gates, E2E notes, and touch-target audit.
- `README.md`, `apps/web/README.md`, `docs/superpowers/**`, and active `.context/reviews/test-engineer.md` history for prior coverage gaps and current docs contracts.

Test/gate inventory:

- Package scripts and configs: `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tsconfig*.json`, `apps/web/eslint.config.mjs`.
- Unit tests: all files under `apps/web/src/__tests__/` were inventoried (`267` active `.test.ts/.test.tsx` files plus fixtures/stubs).
- E2E tests: all files under `apps/web/e2e/`.
- Custom gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/check-js-scripts.mjs`, `apps/web/src/__tests__/tracked-secrets.test.ts`, migration/reconcile tests, deploy contract tests, touch-target/focus scans, client/server boundary scan, i18n parity.

Implementation inventory:

- Active TypeScript/TSX source under `apps/web/src/` (`237` non-test TS/TSX files), app routes/actions, components, lib modules, DB schema, proxy, instrumentation, site config.
- Scripts under `apps/web/scripts/`, root `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, Dockerfile, compose, nginx config.
- Drizzle SQL and journal files under `apps/web/drizzle/`.
- Active docs/plans/reviews were inventoried; line-level review focused on executable/product surfaces and prior-cycle test-risk hot spots.

Repository-wide scans used:

- Active file inventory excluding `node_modules`, `.git`, build outputs, test result outputs, and nested generated `.claude/worktrees`.
- Full test list, route/action/script/migration lists, source-contract scan, skip/mock/flakiness scan, package-script review, and targeted line reads for every finding below.

## Findings

### T23-01 - Lightroom upload route is still protected by source-text contracts instead of route behavior tests

- Severity: Medium
- Confidence: High
- Status: Confirmed coverage gap
- Evidence:
  - The route performs many production-critical side effects in one handler: token/user resolution and quota preclaim at `apps/web/src/app/api/admin/lr/upload/route.ts:68-151`; multipart/filename/title/topic validation at `apps/web/src/app/api/admin/lr/upload/route.ts:153-240`; upload-contract locking, config snapshotting, disk checks, save, GPS/HDR/restore guards, insert, and quota settlement at `apps/web/src/app/api/admin/lr/upload/route.ts:252-477`; queue/audit/revalidation at `apps/web/src/app/api/admin/lr/upload/route.ts:479-547`.
  - The test explicitly describes itself as a source-text guard because the route is "heavy to exercise" at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15`.
  - Critical assertions inspect strings and ordering, not behavior: enqueue payload fields at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:384-395`, post-save containment at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:407-450`, and quota settlement/source ordering at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:275-293`.
- Failure scenario:
  - A refactor keeps the same tokens in `route.ts` but changes runtime data flow: quota is not settled after a thrown parse/save/insert branch, the persisted snapshot differs from the queue payload, `actorUserId` is lost, or a late restore/GPS failure leaks an original. The source tests still pass because the strings remain present.
- Concrete fix/test:
  - Add a behavior-level route harness that imports `POST`, builds a synthetic `Request`/`FormData` upload, and mocks auth context, DB chains, config, upload tracker, filesystem checks, original save, GPS strip, queue, audit, and revalidation.
  - Cover success plus at least: invalid multipart, missing/invalid filename, topic lookup throw, topic missing, lock unavailable, config read failure, disk low/throw, save failure, HDR reject, GPS strip failure, late restore, insert failure.
  - Assert observable behavior: HTTP status/body, `settleUploadTrackerClaim` arguments, original cleanup, lock release, DB insert shape, and exact queue payload.

### T23-02 - Browser upload quota rollback has behavior coverage for success, but failure-path rollback is still source-topology tested

- Severity: Medium
- Confidence: High
- Status: Confirmed regression-lock gap
- Evidence:
  - `uploadImages` preclaims upload quota after synchronous checks at `apps/web/src/app/actions/images.ts:238-242`.
  - The claim must be rolled back for awaited validation failures: disk low/throw at `apps/web/src/app/actions/images.ts:247-264`, topic lookup throw/not-found at `apps/web/src/app/actions/images.ts:280-292`, and all-files-failed settlement at `apps/web/src/app/actions/images.ts:569-596`.
  - The dedicated invariant test is source-order/count based: `apps/web/src/__tests__/images-action-toctou-claim.test.ts:18-57`.
  - The behavior test exercises a successful upload and queue snapshot at `apps/web/src/__tests__/images-actions.test.ts:239-277`, but does not drive the post-claim failure branches that can leak quota.
- Failure scenario:
  - A future awaited validation is inserted after the claim, or an existing post-claim branch starts throwing before `settleUploadTrackerClaim`. The regex test can still pass while the in-memory upload window remains inflated for the admin/IP, causing false "upload limit reached" failures for up to the reset window.
- Concrete fix/test:
  - Add behavior tests in `images-actions.test.ts` that execute `uploadImages` with mocks for each post-claim failure path: low disk, `statfs` throw, topic select throw, topic not found, save failure, insert failure, all files rejected, GPS strip failure, and late restore.
  - Assert `settleUploadTrackerClaim(uploadTracker, uploadTrackerKey, files.length, totalSize, 0, 0)` or the correct partial-success reconciliation, plus no queue enqueue on rejected paths.
  - Prefer a small idempotent claim-settlement helper so tests assert one cleanup path rather than counting source snippets.

### T23-03 - CLIP inference queue correctness is string-matched, not concurrency-tested

- Severity: Medium
- Confidence: High
- Status: Confirmed regression-lock gap
- Evidence:
  - Queue limits, active count, waiter storage, timeout, abort, and release are implemented at `apps/web/src/lib/clip-model.ts:53-160`.
  - Real text inference threads the request signal into the slot wrapper at `apps/web/src/lib/clip-model.ts:228-249`; image inference uses the same slot wrapper at `apps/web/src/lib/clip-model.ts:261-312`.
  - The current test only scans source text for queue constants/errors/removal/abort threading at `apps/web/src/__tests__/clip-model-contract.test.ts:32-50`.
- Failure scenario:
  - An aborted or timed-out waiter remains in `inferenceWaiters`, a failed inference leaves `activeInferenceCount` elevated, release resolves an already-aborted waiter, or max-pending enforcement drifts. The source test passes if the same identifiers remain, while production semantic search can hang, overrun concurrency, or process disconnected requests.
- Concrete fix/test:
  - Extract the slot scheduler into a tiny resettable helper or expose a test-only factory.
  - Add fake-timer tests for: max pending rejection, timeout removal, abort removal, release after success, release after throw, FIFO release, and "aborted queued task never executes after a slot frees."
  - Add a semantic route abort test that uses a pending mocked `embedTextReal`, aborts the request signal, and asserts a 499 path without later DB scan.

### T23-04 - Real CLIP/offline production smoke tests skip in the default gate while production route tests mock the encoder

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed conditional-gate blind spot / manual-validation risk
- Evidence:
  - Production semantic search is live per `CLAUDE.md:158` and depends on offline weights plus inference queue limits documented at `CLAUDE.md:496-500`.
  - `apps/web/package.json:13` runs plain `vitest run`; it does not enable real CLIP lanes.
  - The real semantic ranking test skips unless `CLIP_INTEGRATION=1` at `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`.
  - The offline loader test skips unless `CLIP_OFFLINE_LOAD=1` and seeded weights exist at `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`.
  - The production route test mocks `embedTextReal` at `apps/web/src/__tests__/semantic-route-production.test.ts:3-4` and asserts the mock call at `apps/web/src/__tests__/semantic-route-production.test.ts:33-41`.
- Failure scenario:
  - A dependency, Docker packaging, model path, pinned revision, ONNX native binding, or offline-cache layout change breaks real production inference. Unit tests pass because the route uses mocks and the real smoke tests silently skip by default; the first hard failure appears after production mode receives traffic.
- Concrete fix/test:
  - Add a named CI/deploy preflight lane, for example `npm run test:clip-production`, that runs the offline load and semantic integration tests with seeded model assets.
  - If full weights are too heavy for every CI run, add a fast production-readiness script that fails when `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` and `CLIP_MODELS_ROOT` lacks the pinned revision files or loader bootstrap cannot initialize.
  - Make skipped CLIP production validation visible in normal gate output or deployment logs so operators do not mistake mocked production-route coverage for real inference coverage.

### T23-05 - The E2E seed safety test blesses `CI=true` as sufficient for destructive cleanup

- Severity: Medium-High
- Confidence: High
- Status: Confirmed test/code mismatch
- Evidence:
  - `seed-e2e.ts` allows destructive seeding when any of three conditions is true: explicit opt-in, `CI === 'true'`, or disposable DB name at `apps/web/scripts/seed-e2e.ts:162-166`.
  - The script then mutates persistent state: deletes topic aliases at `apps/web/scripts/seed-e2e.ts:185`, deletes existing E2E-topic image/tag/share rows at `apps/web/scripts/seed-e2e.ts:199-203`, removes upload files and variants at `apps/web/scripts/seed-e2e.ts:205-215`, and rewrites the shared group at `apps/web/scripts/seed-e2e.ts:262-266`.
  - The safety test asserts this weak condition as the expected contract, including `process.env.CI === 'true'`, at `apps/web/src/__tests__/seed-e2e-safety.test.ts:8-18`.
- Failure scenario:
  - A CI job or local shell with `CI=true` accidentally points `DB_HOST`/`DB_NAME` at a non-disposable database. `npm run test:e2e` starts `scripts/run-e2e-server.mjs`, which runs `npm run e2e:seed` at `apps/web/scripts/run-e2e-server.mjs:75-78`; the seed script is allowed to delete/rewrite any rows/files under the `e2e-smoke` topic and shared-group keys.
- Concrete fix/test:
  - Tighten the guard so `CI=true` alone is not enough. Require a disposable DB name or explicit `E2E_ALLOW_DESTRUCTIVE_SEED=true`; for CI, require both `CI=true` and a disposable DB name unless explicitly overridden.
  - Replace the source-string test with table-driven guard tests around a pure `shouldAllowE2ESeed(env)` helper: production env rejects, empty DB rejects, `CI=true` + `gallery` rejects, disposable DB allows, explicit override allows.
  - Add a run-e2e-server contract test that refuses to call `e2e:seed` unless the same guard passes.

### T23-06 - `retryFailedImage` has source/auth tests but no behavior test for stale rows or queue-reject state restoration

- Severity: Medium
- Confidence: Medium
- Status: Likely bug plus confirmed coverage gap
- Evidence:
  - `retryFailedImage` selects a failed image at `apps/web/src/app/actions/images.ts:1202-1223`.
  - It updates the row to clear failure state at `apps/web/src/app/actions/images.ts:1239-1242`, but does not inspect `affectedRows` before clearing in-memory failure state at `apps/web/src/app/actions/images.ts:1244-1250` and re-enqueueing at `apps/web/src/app/actions/images.ts:1252-1282`.
  - If enqueue rejects, it restores DB/in-memory failed state at `apps/web/src/app/actions/images.ts:1283-1294`.
  - The broad retry-flow test is source-text only at `apps/web/src/__tests__/failed-image-retry.test.ts:71-126`.
  - The behavior test covers only auth short-circuit cases at `apps/web/src/__tests__/retry-failed-image-auth.test.ts:138-160`.
- Failure scenario:
  - The row is deleted or concurrently processed after the initial select but before the clear-failure update. The update affects zero rows, yet the action clears in-memory failure maps, enqueues a job for a stale row, and can return success. Conversely, if queue rejection restoration fails or updates the wrong state, current tests can miss it because the non-auth behavior is not executed.
- Concrete fix/test:
  - Add behavior tests for `retryFailedImage` with mocked DB chains and queue state:
    - `affectedRows === 0` after the clear update returns `imageNotInFailedState` or `imageNotFound`, does not clear in-memory state, and does not enqueue.
    - Successful clear update enqueues with the full snapshot and clears `permanentlyFailedIds`, `retryCounts`, `claimRetryCounts`, and `lastErrors`.
    - `enqueueImageProcessing` returning `false` restores `processing_error`, `failed_at`, and `processing_settings_json: null`, re-adds `permanentlyFailedIds`, and returns `failedToRetryImage`.
  - In implementation, check the update result before mutating in-memory state or enqueueing.

## Coverage Strengths Observed

- Migration safety is well covered: journal order, global max `when`, tag-to-file mapping, hash post-condition source lock, schema/table/column/index reconcile tripwires, and DROP tripwires are present in `migration-journal*.test.ts` and `migrate-reconcile-coverage.test.ts`.
- Security lint gates are explicit and fixture-tested: admin API auth, mutating server action origin checks, and public mutating route rate limits.
- Client/server boundary, privacy-field symmetry, tracked secret hygiene, upload path safety, deploy script contracts, service-worker drift, touch targets, focus visibility, i18n parity, and several race contracts have dedicated regression tests.
- Playwright runs single-worker (`apps/web/playwright.config.ts:45-54`) to avoid admin-login rate-limit flakiness, and public/admin flows have meaningful assertions rather than only screenshots.

## Flakiness / Strategy Notes

- Confirmed flaky-pattern mitigations already exist: Vitest excludes `.next` build copies and has a 15s timeout (`apps/web/vitest.config.ts:17-39`); Playwright is serial/single-worker (`apps/web/playwright.config.ts:45-54`); admin E2E has credential guards (`apps/web/e2e/admin.spec.ts:6-13`); long image-processing E2E polling uses bounded DB polling (`apps/web/e2e/helpers.ts:151-172`).
- Remaining manual-validation risk is mainly production CLIP, because the real model lanes are intentionally gated and skipped by default.
- The largest strategic gap is not lack of test volume; it is several high-risk source-contract tests standing in for behavior around multipart uploads, queue scheduling, and retry state transitions.

## Final Missed-Issues Sweep

Sweep performed after drafting:

- Rechecked prior cycle 22 findings against current files. The stale deploy-doc command from cycle 22 is fixed in current `CLAUDE.md:67` and `CLAUDE.md:658`, so it is not re-filed.
- Re-scanned for skips, sleeps, source-contract patterns, route/action coverage, scripts, migrations, and package gates.
- Rechecked migration and deploy contract tests for obvious current gaps; no additional high-confidence findings found there.
- Checked git state before writing: other review files were already modified/untracked by other agents/users; I did not touch them.

Skipped or not line-reviewed:

- `node_modules`, `.git`, `.next`/build outputs, Playwright/Vitest output folders, binary image/font fixtures, generated screenshots, and nested `.claude/worktrees` duplicate worktrees.
- Historical `.context` review/plan artifacts beyond active/prior-cycle context were inventoried but not exhaustively line-reviewed; they are review history, not executable product/test surface.

Validation:

- Review-only pass. I did not run the full lint/typecheck/build/test/e2e gates because no source/test implementation was changed and the requested deliverable was the written review.
