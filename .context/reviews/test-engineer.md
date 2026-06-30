# Test-Engineer Review - Cycle 21

Date: 2026-06-30 KST
HEAD reviewed: `1ed96484` (`docs(security): preserve cycle 21 audit evidence`)
Scope: repository-wide review of current HEAD for test coverage gaps, flaky tests, weak assertions, gate blind spots, and TDD opportunities tied to real product risk. No implementation code was modified.

## Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Current source/test inventory:

- App/source files under `apps/web/src`: 503 TypeScript/TSX/JS/MJS files.
- Unit/integration tests under `apps/web/src/__tests__`: 271 files.
- Playwright E2E/support files under `apps/web/e2e`: 8 files.
- Public/admin route handlers inventoried under `apps/web/src/app/**/route.ts(x)`.
- Server actions inventoried under `apps/web/src/app/actions/*.ts`.
- Gate scripts reviewed: `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, Vitest config, Playwright config, and source-contract scanner tests.

Focused implementation/test files inspected:

- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/cycle-20-source-contracts.test.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/__tests__/clip-model-contract.test.ts`
- `apps/web/src/__tests__/clip-semantic-integration.test.ts`
- `apps/web/src/__tests__/clip-offline-load.test.ts`
- `apps/web/src/__tests__/semantic-route-production.test.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/image-queue.ts`
- upload/retry/queue tests around processing snapshots and failed-image retry.

Validation notes:

- This was a review pass; I did not run the full lint/typecheck/build/test suite.
- Other cycle-21 artifacts report recent full gates green, but the findings below are based on fresh source/test inspection at current HEAD.
- The detected `tdd` routing has no readable skill surface in this session, so TDD is treated as a review criterion.

## Findings

### TEST21-01 - No-prefetch source contract misses the remaining hover prefetch path that can inflate analytics

Severity: Medium
Confidence: High
Status: Confirmed weak assertion / gate blind spot

Exact file+region:

- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156` records a photo view during server render.
- `apps/web/src/components/photo-navigation.tsx:220-228` and `apps/web/src/components/photo-navigation.tsx:235-242` still call `router.prefetch(getPhotoPath(prevId|nextId))` on hover.
- `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:25-31` claims to test that photo detail prefetch is gone, but it checks only home cards, hidden adjacent links, and the old `photo-viewer.tsx` `router.prefetch(buildPhotoPath(id))` string.
- `apps/web/src/__tests__/public-actions.test.ts:241-318` covers recorder behavior directly, not whether prefetch/hover can trigger the page render that calls it.

Failure scenario:

A visitor opens a photo and hovers the previous/next controls. The remaining manual prefetch can render adjacent photo routes, and those routes call `recordPhotoView` as render-time side effects. The current "does not prefetch photo detail routes" test still passes because it never scans `photo-navigation.tsx` for `router.prefetch(getPhotoPath(...))`.

Suggested fix/test:

Prefer a behavior regression: in Playwright or a route-level harness, hover previous/next and assert no analytics insert/rate-limit consumption occurs until navigation commits. At minimum, expand the source contract to scan all photo-navigation/client files for `router.prefetch(` targeting `/p/` routes, and rename the test if hover prefetch remains intentional.

TDD opportunity:

Write the failing regression against `photo-navigation.tsx` first: assert no photo-detail route prefetch calls exist while analytics remains render-bound. Then either remove/replace the hover prefetch or move analytics to a committed-view client effect.

### TEST21-02 - Backup download tests miss post-open failures that leak the validated file descriptor

Severity: Low-Medium
Confidence: High
Status: Confirmed missing regression test with live failure path

Exact file+region:

- `apps/web/src/app/api/admin/db/download/route.ts:56-64` opens a validated file handle and closes it only for the non-file branch.
- `apps/web/src/app/api/admin/db/download/route.ts:66-74` awaits `getCurrentUser()` and `logAuditEvent()` before creating the stream that would own the descriptor.
- `apps/web/src/app/api/admin/db/download/route.ts:87-99` catches errors but has no handle reference/close path.
- `apps/web/src/__tests__/backup-download-route.test.ts:170-184` covers `open()` rejection before a descriptor exists, not a throw after `open()` succeeds.

Failure scenario:

If `getCurrentUser()` or another pre-stream step throws after `open()` succeeds, the route returns 500 and leaves the file descriptor open. Repeated failed backup downloads can exhaust descriptors in the single web process. Existing tests stay green because they only simulate a failed `open()`.

Suggested fix/test:

Add a route test where `openMock` returns a fake handle with `stat`, `createReadStream`, and `close` spies, then make `getCurrentUserMock` reject. Assert the response is 500, `close` is called exactly once, and no stream is created. Fix with a `fileHandle` variable outside the try or a nested try/finally that closes until ownership transfers to `createReadStream()`.

TDD opportunity:

Start with the failing fake-handle test; it is deterministic and does not require real filesystem streaming.

### TEST21-03 - CLIP inference queue safety is still source-contract tested, not behavior-tested

Severity: Medium
Confidence: High
Status: Confirmed weak assertion

Exact file+region:

- `apps/web/src/lib/clip-model.ts:65-160` owns `activeInferenceCount`, `inferenceWaiters`, queue-full rejection, timeout rejection, abort listener cleanup, and slot release.
- `apps/web/src/lib/clip-model.ts:228-236` passes `InferenceSlotOptions` through `embedTextReal`.
- `apps/web/src/app/api/search/semantic/route.ts:253-257` relies on that abort behavior for production text embedding.
- `apps/web/src/__tests__/clip-model-contract.test.ts:32-50` only checks source strings such as `ClipInferenceQueueTimeoutError`, `signal.addEventListener('abort'`, and `}), options)`.

Failure scenario:

A refactor can preserve all strings while breaking the queue: aborted waiters may remain queued, timed-out waiters may still be woken by `inferenceWaiters.shift()?.resolve()`, `activeInferenceCount` may decrement too early, or a request aborted while waiting may still reach `model(...)`. The production semantic route would then waste scarce CLIP slots under cancelled requests.

Suggested fix/test:

Extract a small queue helper or add a test-only model/tokenizer injection seam. Use fake timers to saturate `CLIP_INFERENCE_CONCURRENCY`, enqueue a second request, abort it, and assert the fake model is not called. Add queue-full and timeout tests that prove removed waiters are never resolved later.

TDD opportunity:

Write the aborting-waiter test first against the smallest possible queue seam, then move the current implementation behind it without changing route behavior.

### TEST21-04 - Real CLIP production behavior is opt-in and skipped by the default gate

Severity: Low-Medium
Confidence: High
Status: Confirmed conditional coverage gap

Exact file+region:

- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31` skips real semantic ranking unless `CLIP_INTEGRATION=1`.
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-41` skips offline production-load proof unless `CLIP_OFFLINE_LOAD=1` and seeded weights exist.
- `apps/web/src/__tests__/semantic-route-production.test.ts:3-16` mocks `embedTextReal`, so default route tests do not load the real model.
- `CLAUDE.md` documents production semantic search is active with real `jina-clip-v2` embeddings, so this is a live production mode rather than an experimental dead path.

Failure scenario:

The default blocking suite can pass while the production model layout, pinned revision, tokenizer/model compatibility, Korean/English ranking quality, or offline `CLIP_MODELS_ROOT` load path is broken. That failure would surface only during operator seeding/backfill or live semantic search.

Suggested fix/test:

Keep heavy model tests out of every PR if necessary, but add a scheduled or release-blocking CI lane with seeded weights that runs `clip-offline-load.test.ts` and `clip-semantic-integration.test.ts`. If CI storage is too costly, add an explicit pre-deploy command/checklist and make the deploy/activation docs point to a required evidence artifact.

TDD opportunity:

Start with the offline-load test as the release gate because it proves the exact production seed-to-runtime path without needing a full DB.

### TEST21-05 - Failed-image retry snapshot forwarding is not behavior-tested or exhaustiveness-guarded

Severity: Low-Medium
Confidence: High
Status: Confirmed coverage gap

Exact file+region:

- `apps/web/src/lib/image-queue.ts:92-119` defines the processing snapshot fields.
- `apps/web/src/lib/image-queue.ts:208-232` defines corresponding optional `ImageProcessingJob` fields.
- Browser upload forwards the snapshot at `apps/web/src/app/actions/images.ts:500-526` and is behavior-tested at `apps/web/src/__tests__/images-actions.test.ts:239-276`.
- Lightroom upload forwards the snapshot at `apps/web/src/app/api/admin/lr/upload/route.ts:479-505`, but the regression is source-regex only at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:384-394`.
- Failed-image retry forwards the snapshot at `apps/web/src/app/actions/images.ts:1255-1271`, but `apps/web/src/__tests__/failed-image-retry.test.ts:87-103` only checks for a fresh snapshot, serialized persistence, and a generic `enqueueImageProcessing({ ... colorSignals ... })` payload.

Failure scenario:

Retrying a failed image is supposed to reprocess with the current admin settings. A future edit could drop `forceSrgbDerivatives`, chroma, effort, max-source-pixels, auto-alt, or semantic mode from the retry enqueue payload and tests would still pass. The image would retry with different behavior than a fresh browser upload or LR publish until another backfill corrects it.

Suggested fix/test:

Add a behavior test for `retryFailedImage` mirroring the browser upload assertion: mock `getGalleryConfigStrict` with distinctive values and assert `enqueueImageProcessingMock` receives every `ProcessingSettingsSnapshot` field. Longer term, add an exhaustiveness helper that maps `ProcessingSettingsSnapshot` to `ImageProcessingJob` in one place so TypeScript catches new fields.

TDD opportunity:

Write the retry behavior test first with a deliberately distinctive config. It should fail if any snapshot field is removed from the retry enqueue payload.

## Final Missed-Issues Sweep

Final sweep covered:

- Existing top-level cycle-20 `test-engineer.md` and current cycle-21 code/review/plan artifacts.
- Route/action inventory under `apps/web/src/app`, including public analytics, OG/search routes, backup download, upload serving, and server actions.
- Scanner tests for auth, action-origin, public route rate limits, touch targets, focus-visible rings, privacy fields, migration journal/reconcile, and service-worker contracts.
- Source-contract-heavy tests and whether their implementation targets still match current source.
- Skipped/conditional suites, especially real CLIP and admin E2E coverage.
- Upload/LR/retry processing snapshot parity tests.
- Flake indicators: fake timers, wall-clock sleeps, `.skip`, screenshots without assertions, and build-output exclusion rules.

No critical or high-severity test-engineering findings were confirmed. Confirmed findings: 5.
