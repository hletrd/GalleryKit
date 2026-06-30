# Cycle 25 Test-Engineer Review

Review target: current `HEAD` (`4cb1258ba0b2`, branch `master`) in `/Users/hletrd/flash-shared/gallery`.

Role: cycle-25 test-engineer. Scope: whole-repo test coverage and flakiness review, focused on missing regression tests that would catch correctness, security, race-condition, gate-check, and UI behavior bugs. Per user instruction, this is review-only: no commits and no pushes.

## Inventory First

Instruction and architecture docs read before review:

- `AGENTS.md`, including project git/deploy/test gates, schema rules, and review conventions.
- `CLAUDE.md`, including architecture, security model, CLIP semantic search, race-condition protections, migration/deploy runbooks, and operational constraints.

Repository/test inventory built before filing findings:

- Source/test surface scanned under `apps/web/src`, `apps/web/e2e`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/public`, root config, and workflow/config files.
- Counted inventory, excluding `node_modules`, `.git`, `.next`, coverage/build outputs, and generated reports: `802` app-relevant files.
- Unit test files: `275` under `apps/web/src/__tests__/`.
- E2E files: `8` under `apps/web/e2e/`.
- App routes/actions mapped: `77`.
- Components mapped: `57`.
- Library modules mapped: `97`.
- Scripts mapped: `27`.
- Drizzle files mapped: `31`.
- Public/static assets mapped: `221`.

Key gates confirmed:

- `apps/web/package.json:13-26` wires `vitest`, Playwright E2E, custom auth/origin/rate-limit scanners, typecheck, and build.
- `apps/web/playwright.config.ts:48-87` runs Playwright serially with one Chromium project and a local standalone server.
- `apps/web/scripts/run-e2e-server.mjs:75-93` initializes, seeds, builds, copies static output, and starts the E2E server.
- `apps/web/scripts/seed-e2e.ts:157-171` blocks destructive seeding unless the DB is explicitly disposable or opt-in.

## Findings

### C25-TE-01 - Settings update race protections are helper-tested, but the action path is not behavior-tested

- Severity: High
- Confidence: High
- Area: race condition / correctness
- Evidence:
  - `updateGallerySettings` performs the user-visible race guard at `apps/web/src/app/actions/settings.ts:68-79`, checking whether `image_sizes` or `strip_gps_on_upload` changes require the upload-processing contract lock.
  - It then enforces historical-image locks at `apps/web/src/app/actions/settings.ts:81-134`, writes settings transactionally at `apps/web/src/app/actions/settings.ts:136-148`, and releases the lock in `finally` at `apps/web/src/app/actions/settings.ts:150-166`.
  - Existing tests cover pieces: source contract around image-size locking in `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22`, upload-claim helper behavior in `apps/web/src/__tests__/upload-tracker-state.test.ts:121-146`, and lock helper behavior in `apps/web/src/__tests__/upload-processing-contract-lock.test.ts:54-145`.
  - The action itself has no behavior test that proves those helpers are called in the right order or that the lock is released on errors.
- Failure scenario:
  - A refactor keeps all helper tests green but removes the `hasActiveUploadClaims` check, skips lock acquisition for one setting, returns before `releaseUploadProcessingContractLock`, or performs the DB transaction before the lock. In production, an admin can change upload-processing settings while an upload is active, creating mixed derivative/GPS behavior.
- Concrete test/fix recommendation:
  - Add action-level unit tests for `updateGallerySettings` with mocked auth, DB, settings cache, upload tracker, lock helper, audit, and revalidation.
  - Cover: active upload claim returns locked without DB writes; lock unavailable returns locked; image-size change after existing images is rejected; GPS-strip change after existing images is rejected; successful mutable setting update writes transactionally; DB throw releases lock; audit/revalidate failures do not leak the lock.
  - Keep helper tests, but make the action behavior test the regression lock for ordering and cleanup.

### C25-TE-02 - Lightroom upload route relies on source contracts for critical side effects

- Severity: High
- Confidence: High
- Area: correctness / security / quota race
- Evidence:
  - The route prechecks maintenance, content length, size, auth context, and upload quota at `apps/web/src/app/api/admin/lr/upload/route.ts:78-151`.
  - Multipart validation and topic lookup live at `apps/web/src/app/api/admin/lr/upload/route.ts:153-240`.
  - Upload-contract locking, strict settings load, disk-space checks, original save, HDR rejection, GPS stripping, restore-window cleanup, DB insert, queue enqueue, audit, and response are split across `apps/web/src/app/api/admin/lr/upload/route.ts:252-547`.
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16` explicitly describes itself as source-contract coverage because the route is heavy to exercise directly.
  - Several important assertions are string/order checks rather than runtime behavior checks, including tracker settlement at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:275-293`, queue payload settings at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:384-395`, and post-save containment at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:407-450`.
- Failure scenario:
  - A route refactor leaves the same identifiers in source but changes observable behavior: a quota claim is not settled on one thrown branch, a lock release is missed after a late return, HDR cleanup deletes the wrong path, the queue payload diverges from inserted settings, or GPS-strip errors still persist an image. Source-text tests can continue passing.
- Concrete test/fix recommendation:
  - Add a behavior-level route harness that imports `POST`, constructs synthetic `NextRequest`/`FormData`, and mocks auth context, DB chains, gallery config, upload tracker, disk checks, original save, GPS strip, queue, audit, revalidation, and lock helpers.
  - Start with a small but high-value matrix: happy path; missing file; invalid filename; invalid topic; topic missing; contract lock unavailable; config load failure; disk low; save failure; HDR rejection; GPS strip failure; restore maintenance after save; insert failure.
  - Assert HTTP status/body plus observable side effects: tracker settlement arguments, original cleanup, DB insert values, queue payload, audit calls, and lock release.

### C25-TE-03 - Database restore lifecycle is mostly source-locked, not failure-path behavior-locked

- Severity: High
- Confidence: Medium-High
- Area: security / race condition / operational correctness
- Evidence:
  - `restoreDatabase` acquires a DB restore lock, upload-processing lock, and backfill locks at `apps/web/src/app/[locale]/admin/db-actions.ts:388-445`.
  - It starts restore maintenance and quiesces the image queue at `apps/web/src/app/[locale]/admin/db-actions.ts:447-489`, then performs restore and cleanup/release at `apps/web/src/app/[locale]/admin/db-actions.ts:491-548`.
  - `runRestore` validates the backup header, scans SQL chunks, spawns `mysql`, and keeps maintenance enabled on restore failure at `apps/web/src/app/[locale]/admin/db-actions.ts:554-746`.
  - Existing tests include pure/source-contract checks in `apps/web/src/__tests__/db-restore.test.ts:1-78` and source-order/lifecycle checks in `apps/web/src/__tests__/restore-upload-lock.test.ts:7-118`.
- Failure scenario:
  - A future edit releases only one lock on an early branch, resumes uploads after a failed restore, fails to end maintenance after a pre-restore failure, or starts restore while backfill lock acquisition is partial. Source-order tests can miss a runtime branch that depends on mocked connection return values or thrown promises.
- Concrete test/fix recommendation:
  - Add behavior tests around `restoreDatabase` using mocked admin auth, same-origin guard, connection pool, advisory lock results, maintenance helpers, queue quiesce/resume, and restore runner boundaries.
  - Cover these concrete branches: DB restore lock denied; upload lock denied; first backfill lock denied after earlier locks acquired; `beginRestoreMaintenance` denied; `quiesceImageQueueForRestore` throw; restore failure keeps maintenance; pre-restore failure ends maintenance and resumes queue; success releases all locks and connection exactly once.
  - If direct testing is difficult because `runRestore` is internal, extract the lifecycle coordinator into a small injectable helper and test that helper directly.

### C25-TE-04 - Smart-collection pagination lacks a behavioral regression test

- Severity: Medium
- Confidence: High
- Area: correctness / UI behavior
- Evidence:
  - `loadMoreSmartCollectionImages` is implemented at `apps/web/src/app/actions/public.ts:169-233`.
  - It has unique logic for slug lookup, public visibility, cursor parsing, exact page-size fetch, and `hasMore` calculation at `apps/web/src/app/actions/public.ts:185-221`.
  - The nearby public action tests exercise sibling actions in `apps/web/src/__tests__/public-actions.test.ts:99-280`, but this export is not covered by those behavior tests.
- Failure scenario:
  - Pagination regresses to double-lookahead, loses cursor pass-through, treats private smart collections as public, or reports `hasMore` incorrectly. Users see duplicate tiles, missing next pages, or private collection leakage while existing public action tests stay green.
- Concrete test/fix recommendation:
  - Extend `public-actions.test.ts` with mocked `getSmartCollectionBySlugCached`, `parseSmartCollectionQuery`, `compileSmartCollection`, and `getImagesForSmartCollection`.
  - Cover invalid slug, missing collection, non-public collection, valid cursor forwarding, exact `safeLimit` fetch count, no duplicate lookahead, `hasMore` true/false boundaries, and thrown query compilation returning the current error contract.

### C25-TE-05 - Admin token plaintext acknowledgement is source-checked, but not interaction-tested

- Severity: Medium
- Confidence: Medium
- Area: security UX / credential safety
- Evidence:
  - The token client creates a token and stores the one-time plaintext value at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:46-73`.
  - Copy and acknowledgement state are separate at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:88-95`.
  - The plaintext dialog prevents closing until acknowledged at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:188-235`.
  - Existing coverage includes action tests for token APIs and a source-contract check in `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:49`, but no component or E2E interaction test proves the dialog cannot lose the only plaintext copy.
- Failure scenario:
  - A UI refactor accidentally enables outside-click close, enables Done before acknowledgement, drops plaintext before copy, or fails to refresh the token list after creation. The server-side action tests still pass, but an admin can permanently lose a newly generated LR upload token.
- Concrete test/fix recommendation:
  - Add either a focused component test for `TokensClient` or a Playwright admin test in the disposable E2E DB.
  - Assert: create shows plaintext exactly once; Done is disabled until acknowledgement; outside close does not dismiss before acknowledgement; Copy toggles acknowledgement; after Done the plaintext is removed; token list refreshes; revoke confirmation removes the token.

### C25-TE-06 - Visual-check E2E captures screenshots but does not assert visual regressions

- Severity: Low
- Confidence: High
- Area: UI behavior / flakiness boundary
- Evidence:
  - Playwright is intentionally serialized and Chromium-only at `apps/web/playwright.config.ts:48-87`; this reduces auth/rate-limit flake but limits browser diversity.
  - `apps/web/e2e/nav-visual-check.spec.ts:6-37` asserts nav visibility, touch target size, and non-overlap.
  - The same spec writes screenshots at `apps/web/e2e/nav-visual-check.spec.ts:51`, `apps/web/e2e/nav-visual-check.spec.ts:65`, and `apps/web/e2e/nav-visual-check.spec.ts:78`, but there is no `toHaveScreenshot` baseline comparison.
- Failure scenario:
  - A layout/color regression ships in the public nav or admin shell. The test still passes because screenshots are artifacts, not assertions. A browser-specific regression in WebKit or Firefox also stays invisible to the default E2E gate.
- Concrete test/fix recommendation:
  - Keep the current geometry checks as the low-flake fast gate.
  - Convert one or two stable critical screenshots to `expect(...).toHaveScreenshot(...)` with tight masking only where needed, or rename/document the screenshot writes as diagnostic artifacts.
  - Add a scheduled/manual WebKit smoke for public gallery, lightbox, and nav only if it can run outside the main auth-rate-limited admin lane.

## Flakiness Review

- No high-confidence flaky test was found in the current default gate.
- The main Playwright flake control is deliberate: `apps/web/playwright.config.ts:48-57` forces one worker because admin login and rate-limit state are shared.
- The E2E server path is heavier than typical because `apps/web/scripts/run-e2e-server.mjs:75-84` runs init, seed, and build before tests. This is slow but deterministic when the disposable DB guard is satisfied.
- `apps/web/e2e/helpers.ts:151-172` bounds image-processing polling at 30 seconds. That can fail under a very slow local machine, but the current fixture path appears intentional and bounded rather than an unbounded race.
- The largest remaining flake-adjacent risk is not random failure; it is false confidence from source-contract tests and non-assertive screenshots.

## Coverage Strengths Observed

- Admin API auth, mutating server-action origin guards, and public mutating route rate-limit scanners are wired as package gates and have fixture coverage.
- Semantic search and similar-image API routes have strong mocked route coverage for origin, maintenance, rate-limit, malformed bodies, disabled modes, aborts, empty results, and success branches.
- Auth action ordering and cookie/session behavior have targeted tests, including hostile origin and rate-limit ordering.
- Migration/schema coverage is unusually strong: journal ordering, hash checks, reconcile logic, privacy-sensitive fields, and migration postconditions are represented.
- Touch target minimums and several UI focus/nav invariants are covered by tests rather than left to manual review.

## Final Missed-Issue Sweep

After drafting the findings, I rechecked these areas to avoid filing stale or duplicate gaps:

- Re-read the cited source regions for settings updates, LR upload, DB restore, public actions, tokens UI, Playwright config, and nav visual tests.
- Re-scanned route/action coverage, scanner scripts, E2E specs, source-contract tests, screenshot-only tests, skipped tests, and package/workflow gates.
- Checked that auth, semantic search, similar-image search, migration, privacy-field, seed-safety, and touch-target areas already have meaningful targeted coverage and did not file broad "more coverage" requests there.
- Did not line-review generated build output, binary fixtures, `.git`, `node_modules`, `.next`, Playwright/Vitest output, or historical duplicate worktrees.

Validation note: this was a review-only pass. I did not run lint/typecheck/build/unit/E2E gates because no executable source was changed; the only intended workspace change is this report file.
