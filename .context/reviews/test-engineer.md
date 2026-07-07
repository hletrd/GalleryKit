# Test-Engineer Review - Cycle 5 Prompt 1

Scope: read-only review of upload, process, delete, restore, config/cache, queue, backfill, and gate-test flows. No source files were modified.

## Inventory

Reviewed groups:
- Upload/delete actions: `apps/web/src/app/actions/images.ts`
- Lightroom/admin upload route: `apps/web/src/app/api/admin/lr/upload/route.ts`
- Queue and image processing: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`
- Restore and maintenance barriers: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/sql-restore-scan.ts`
- Settings/cache/static upload serving: `apps/web/src/app/actions/settings.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/serve-upload.ts`, upload route files under `apps/web/src/app/**/uploads/[...path]/route.ts`
- Backfill paths: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`
- Tests/gates sampled: 335 unit test files under `apps/web/src/__tests__`, 10 e2e specs under `apps/web/e2e`, plus root and web package scripts.

## Confirmed Issues

### TE-1: Lightroom upload route is protected mostly by source-contract tests, not route behavior tests

Evidence:
- Runtime surface is large and stateful in `apps/web/src/app/api/admin/lr/upload/route.ts:84-609`: token/cookie actor selection, maintenance guard, upload tracker preclaim/settle, multipart parse slot, contract lock, disk precheck, file save, HDR/GPS policy, DB insert, queue enqueue, audit, revalidation, and lock release.
- Current focused coverage in `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16` explicitly says the route is tested through source-contract checks because multipart/API mocking is heavy.
- The same test file asserts implementation text and ordering with `readFileSync`, `toContain`, `toMatch`, and index comparisons across `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:38-335`.

Failure scenario:
- A refactor can keep the expected strings while breaking the live route's `NextRequest.formData()` handling, the upload tracker claim/settle pairing, lock release on a late rejection, or queue enqueue ordering after insert. CI would still pass the source-contract assertions even though the route fails at runtime.

Suggested fix:
- Add a small behavioral route test that imports `POST`, constructs a `NextRequest` with `FormData`, and mocks auth/session, settings, DB, upload tracker, process-image, and queue helpers.
- Cover at least one success path and one policy-reject path, asserting `deleteOriginalUploadFile`, `settleUploadTrackerClaim`, `releaseUploadProcessingContract`, insert-before-enqueue ordering, and response status/body.

Confidence: High.

### TE-2: Restore child-process cleanup is guarded by text-shape tests, not failure-mode behavior tests

Evidence:
- Dump/restore subprocess behavior spans watchdog setup in `apps/web/src/app/[locale]/admin/db-actions.ts:42-80`, dump locking and child completion in `apps/web/src/app/[locale]/admin/db-actions.ts:165-394`, restore lock stack and queue quiescing in `apps/web/src/app/[locale]/admin/db-actions.ts:403-629`, restore import child handling in `apps/web/src/app/[locale]/admin/db-actions.ts:760-854`, and post-restore migrations in `apps/web/src/app/[locale]/admin/db-actions.ts:856-933`.
- Existing focused tests in `apps/web/src/__tests__/db-restore.test.ts:47-115` mainly assert source snippets for temp cleanup, dump/restore lock coverage, header/trailer ordering, and post-restore migration setup.

Failure scenario:
- A child timeout, stream error, nonzero close code, or post-restore migration timeout could leave temp SQL files, durable maintenance markers, upload-processing locks, color/semantic locks, or queue quiesce state behind. A source-contract test can pass while the rejected promise path leaks state.

Suggested fix:
- Extract the child-process runner/watchdog into a small injectable helper, or add tests with fake `spawn`, fake streams, and fake lock releasers.
- Cover success, nonzero close, timeout kill, write-stream error, and post-migration failure. Assert cleanup ordering and whether `keepMaintenance` preserves or releases durable maintenance exactly as intended.

Confidence: Medium.

## Likely Issues

### TE-3: Color sidecar backfill has no scalable batch regression test

Evidence:
- The sidecar reads all candidates at once in `apps/web/scripts/backfill-color-pipeline.ts:383-400` with `SELECT ... ORDER BY id ASC`, stores the full result in `rows`, then queues work across that full array in `apps/web/scripts/backfill-color-pipeline.ts:525-560`.
- The in-app runner already uses bounded keyset pagination in `apps/web/src/lib/admin-backfill-runner.ts:401-431`.
- The sidecar comment at `apps/web/scripts/backfill-color-pipeline.ts:379-382` says batch size intentionally keeps DB reads and in-memory arrays bounded, but the implementation does not bound the candidate result set.

Failure scenario:
- A large production gallery, especially with `FORCE_REENCODE=1`, can allocate a full candidate list and many queued promises before meaningful progress is made. The process can be killed or make the host unstable while unit/build gates remain green.

Suggested fix:
- Add a regression test around the candidate-selection loop, or refactor sidecar candidate fetching to the same keyset-paginated shape as `admin-backfill-runner.ts`.
- Assert that only one batch of rows is materialized at a time and that progress continues across cursor boundaries.

Confidence: Medium.

## Manual-Validation Risks

### TE-4: CLIP model activation is intentionally outside default CI

Evidence:
- `apps/web/src/__tests__/clip-offline-load.test.ts:1-65` skips unless `CLIP_OFFLINE_LOAD=1` and seeded local model files exist.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-80` skips unless `CLIP_INTEGRATION=1`.

Failure scenario:
- A model path, artifact format, provider revision, or runtime loading behavior can break production semantic search activation while default CI stays green.

Suggested fix:
- Keep the manual gate, but require recorded run evidence before enabling or changing CLIP production settings. Add a lightweight CI manifest check only if it can run without real weights.

Confidence: High.

### TE-5: Authenticated admin E2E coverage is opt-in for local runs

Evidence:
- `apps/web/e2e/admin.spec.ts:6-12` enables admin E2E only when admin credentials are configured, though CI asserts they must be configured.
- `apps/web/e2e/origin-guard.spec.ts:28-30` and `apps/web/e2e/origin-guard.spec.ts:55-57` skip the authenticated admin origin-guard branch when admin E2E config is missing.

Failure scenario:
- Local review iterations can report green unit/build checks while skipping the browser paths that exercise admin upload, delete, settings, and authenticated origin protections.

Suggested fix:
- For changes touching admin/upload/delete/restore flows, require either configured `npm run test:e2e --workspace=apps/web` evidence or a targeted route/action behavioral test proving the changed path.

Confidence: Medium.

### TE-6: Static derivative settings changes need operational verification beyond unit tests

Evidence:
- `apps/web/src/app/actions/settings.ts:86-167` detects `image_sizes` and `strip_gps` changes and uses the upload-processing contract lock, but no automatic derivative backfill is run in the action.
- `apps/web/src/app/actions/settings.ts:168-199` returns a warning when existing images require backfill.
- `apps/web/src/lib/serve-upload.ts:240-265` serves existing static derivative files as-is when they exist.

Failure scenario:
- An operator can change derivative settings, see a successful save, and still serve old derivative dimensions/metadata until a backfill is run.

Suggested fix:
- Keep this as an explicit manual runbook requirement, or add a small admin UI affordance/e2e assertion that the warning appears and backfill state is visible after relevant setting changes.

Confidence: Medium.

## Final Sweep

Commonly missed areas checked:
- Origin/admin auth wrapping: route/actions sampled against `withAdminAuth`, `requireSameOriginAdmin`, and lint scripts.
- Cleanup paths: upload tracker claims, contract lock release, temp upload deletion, restore temp SQL cleanup, queue quiesce/resume.
- Cache invalidation: `revalidateAdminUploads`, `revalidatePublicPages`, gallery config invalidation, service-worker cache tests.
- Manual gates: CLIP tests and admin E2E skip conditions.

No source edits were made. This file is the only test-engineer artifact.
