# Cycle 24 Test-Engineer Review

Review target: current `HEAD` (`0cc094dd76d51e88fe163c0b7075e3f0b341f74c`, branch `master`) in `/Users/hletrd/flash-shared/gallery`.

Role: test-engineer. Scope: whole-repo test coverage, flaky tests, TDD opportunities, regression-lock quality, fixture realism, and gate adequacy. This is a review-only pass; the only intended edit is this review file.

## Inventory Examined

Instruction and architecture docs:

- Prompt-provided `AGENTS.md` overlay and project rules, including quality gates, review output, destructive-action boundaries, and commit/deploy expectations.
- `CLAUDE.md` current HEAD architecture, security model, color/HDR pipeline, CLIP production notes, migration/runbook guidance, E2E/deploy notes, and lint/test gate descriptions.
- `README.md`, `apps/web/README.md`, `docs/superpowers/**`, `.github/workflows/quality.yml`, and active `.context/reviews/**` history for current/prior test-risk context.

Test and gate inventory:

- Package/config gates: `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tsconfig*.json`, `apps/web/eslint.config.mjs`, and `.github/workflows/quality.yml`.
- Unit tests: all tracked files under `apps/web/src/__tests__/` were inventoried (`272` files total, `267` active `.test.ts/.test.tsx` files).
- E2E tests: all `8` files under `apps/web/e2e/`, including `admin.spec.ts`, `origin-guard.spec.ts`, `public.spec.ts`, `test-fixes.spec.ts`, `nav-visual-check.spec.ts`, helpers, and image fixtures.
- Custom gates/scripts: all `27` files under `apps/web/scripts/`, including auth/origin/rate-limit scanners, migration/init/seed scripts, CLIP/backfill scripts, deploy/build helpers, and PWA/icon generation.
- Implementation surface mapped for test relevance: route files under `apps/web/src/app/**/route.ts`, server actions in `apps/web/src/app/actions.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts`, top-level `apps/web/src/lib/*` modules, components, DB schema, migrations, Docker/deploy files, and site config.

Repository-wide scans used:

- `git ls-files` inventory, targeted `rg` scans for `describe.skip`/`test.skip`, source-contract tests, screenshot-only checks, waits/sleeps, route/action coverage, seed/deploy gates, and CLIP production toggles.
- Line reads for every file cited below. Excluded from source review: `node_modules`, `.git`, generated build/test outputs, binary fixtures/screenshots/fonts, and nested `.claude/worktrees` duplicate worktrees.

## Confirmed Issues

### C24-TE-01 - CI E2E gate is currently broken by a seed guard / workflow DB-name mismatch

- Severity: High
- Confidence: High
- Status: Confirmed issue
- Evidence:
  - CI exports `DB_NAME: gallery` and does not set `E2E_ALLOW_DESTRUCTIVE_SEED` in `.github/workflows/quality.yml:27-37`.
  - The E2E job runs `npm run test:e2e` at `.github/workflows/quality.yml:76-77`.
  - Playwright's local web server runs `npm run init` and then `npm run e2e:seed` before build at `apps/web/scripts/run-e2e-server.mjs:75-78`.
  - Current seed safety correctly refuses any DB name that is neither explicitly allowed nor disposable at `apps/web/scripts/seed-e2e.ts:157-170`; `gallery` does not match the disposable pattern defined at `apps/web/scripts/seed-e2e.ts:44`.
  - The updated safety test locks the stronger rule and explicitly rejects `process.env.CI === 'true'` as a bypass at `apps/web/src/__tests__/seed-e2e-safety.test.ts:8-20`.
- Concrete failure scenario:
  - On every push/PR quality run, Playwright starts the configured web server. `run-e2e-server.mjs` calls `e2e:seed`; `seed-e2e.ts` sees `DB_NAME=gallery`, no explicit opt-in, prints "CI=true alone is not sufficient", exits `1`, and the entire E2E gate fails before browser tests run.
- Test/fix recommendation:
  - Prefer changing CI `DB_NAME` to a disposable name such as `gallery_e2e` or `gallery_ci`. Alternatively set `E2E_ALLOW_DESTRUCTIVE_SEED=true` only in this isolated MySQL service job.
  - Add a workflow/source contract test that parses `.github/workflows/quality.yml` and fails unless the E2E DB name matches `DISPOSABLE_DB_NAME_PATTERN` or the explicit seed opt-in is present. That locks the gate wiring, not just the script guard.

### C24-TE-02 - Lightroom upload remains protected mainly by source-text contracts rather than route behavior tests

- Severity: Medium
- Confidence: High
- Status: Confirmed coverage gap
- Evidence:
  - The route performs auth/user attribution and quota preclaim at `apps/web/src/app/api/admin/lr/upload/route.ts:68-151`.
  - It parses multipart data and validates filename/topic/title/description at `apps/web/src/app/api/admin/lr/upload/route.ts:153-240`.
  - It then handles upload-contract locking, config snapshotting, disk checks, original save, HDR/GPS/restore guards, insert, and quota settlement at `apps/web/src/app/api/admin/lr/upload/route.ts:252-477`.
  - Queue/audit/revalidation/response are separate side effects at `apps/web/src/app/api/admin/lr/upload/route.ts:479-547`.
  - The coverage file explicitly calls itself a source-text/source-contract guard because the route is heavy to exercise at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15`.
  - Critical invariants are string/order checks: tracker settlement at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:275-293`, enqueue payload settings at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:384-395`, and post-save containment at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:407-450`.
- Concrete failure scenario:
  - A refactor keeps the same identifiers in source but changes runtime behavior: quota settlement is skipped on a thrown branch, insert shape differs from the queue payload, lock release is missed after a late return, or a cleanup function is never awaited. Source-contract tests still pass because the strings remain present.
- Test/fix recommendation:
  - Add a behavior-level route harness importing `POST`, constructing synthetic `NextRequest`/`FormData`, and mocking auth context, DB chains, gallery config, upload tracker, filesystem checks, original save, GPS strip, queue, audit, revalidation, and lock release.
  - Cover success plus invalid multipart, missing file, invalid filename, invalid/missing topic, topic lookup throw, topic missing, lock unavailable, config failure, disk low/throw, save failure, HDR reject, GPS strip failure, late restore, and insert failure.
  - Assert observable outputs: HTTP status/body, `settleUploadTrackerClaim` arguments, original cleanup, lock release, DB insert values, and exact queue payload.

### C24-TE-03 - Browser upload failure-path quota settlement is behavior-adjacent but not behavior-asserted

- Severity: Medium
- Confidence: High
- Status: Confirmed regression-lock gap
- Evidence:
  - `uploadImages` preclaims quota synchronously at `apps/web/src/app/actions/images.ts:238-248`.
  - The post-claim disk low/throw branches settle and return at `apps/web/src/app/actions/images.ts:250-271`.
  - The post-claim topic select throw/not-found branches settle at `apps/web/src/app/actions/images.ts:286-299`.
  - All-failed and final success/partial success settle at `apps/web/src/app/actions/images.ts:575-602`.
  - The dedicated invariant test is source topology/count based at `apps/web/src/__tests__/images-action-toctou-claim.test.ts:18-57`.
  - Behavior tests drive disk low, disk inspection throw, and topic missing at `apps/web/src/__tests__/images-actions.test.ts:358-403`, but they assert only returned errors plus no save/insert; they do not assert `settleUploadTrackerClaimMock`, which is available in the same test file at `apps/web/src/__tests__/images-actions.test.ts:17-39` and wired at `apps/web/src/__tests__/images-actions.test.ts:155-156`.
- Concrete failure scenario:
  - A branch keeps `settleClaim(0, 0)` somewhere in source, satisfying the source-count test, but the actual disk/topic failure path stops calling it or passes wrong arguments. The user receives the right error, no image is saved, and existing tests pass, but the in-memory upload window remains inflated for that admin/IP until reset.
- Test/fix recommendation:
  - In `images-actions.test.ts`, assert `settleUploadTrackerClaimMock` arguments for disk low, statfs throw, topic select throw, topic missing, HDR-all-failed, GPS-strip-all-failed, save failure, insert failure, and partial success.
  - Prefer a small shared settlement helper boundary so tests assert one behavior surface rather than source snippet counts.

### C24-TE-04 - CLIP inference queue correctness is source-string locked, not concurrency-tested

- Severity: Medium
- Confidence: High
- Status: Confirmed regression-lock gap
- Evidence:
  - Queue configuration and mutable state live at `apps/web/src/lib/clip-model.ts:53-72`.
  - Waiter removal, abort checks, pending wait, timeout, and slot release are implemented at `apps/web/src/lib/clip-model.ts:99-160`.
  - The test only checks source strings for queue limits, timeout, removal, and abort threading at `apps/web/src/__tests__/clip-model-contract.test.ts:32-50`.
  - The semantic route test mocks `embedTextReal` and only asserts that an `AbortSignal` object is passed at `apps/web/src/__tests__/semantic-search-route.test.ts:53-55` and `apps/web/src/__tests__/semantic-search-route.test.ts:287-304`.
- Concrete failure scenario:
  - Timeout removal, abort removal, FIFO release, max-pending rejection, active-count decrement on throw, or "aborted queued task never executes" breaks while the same symbol names remain in source. Production semantic search can hang, overrun concurrency, or retain dead waiters, and the current string tests still pass.
- Test/fix recommendation:
  - Extract the scheduler into a resettable helper or expose a test-only factory.
  - Add fake-timer tests for max pending rejection, timeout removal, abort removal, release after success, release after throw, FIFO ordering, active count recovery, and an aborted queued task not running after a slot frees.
  - Add one route-level abort test with a pending mocked encoder promise to prove request abort maps to the expected 499 path without later DB scan.

### C24-TE-05 - Real production CLIP validation skips in the default gate while route tests mock the encoder

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed conditional-gate blind spot
- Evidence:
  - The default app test script is plain `vitest run` at `apps/web/package.json:13`; the GitHub workflow runs `npm test` without CLIP production env at `.github/workflows/quality.yml:66-67`.
  - Offline real-model load skips unless `CLIP_OFFLINE_LOAD=1`, `CLIP_MODELS_ROOT` is set, and a seeded pinned model file exists at `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`.
  - Semantic ranking integration skips unless `CLIP_INTEGRATION=1` at `apps/web/src/__tests__/clip-semantic-integration.test.ts:27-31`.
  - Production route tests mock `embedTextReal` at `apps/web/src/__tests__/semantic-search-route.test.ts:49-55`.
- Concrete failure scenario:
  - A model revision, on-disk cache layout, Docker volume mount, ONNX native binding, or offline bootstrap change breaks production inference. Default CI remains green because real CLIP tests are skipped and route tests mock the encoder; the first failure appears in deploy/backfill/production traffic.
- Test/fix recommendation:
  - Add a named `test:clip-production` or deploy preflight lane that runs the offline load and semantic integration tests with seeded weights.
  - If full weights are too heavy for per-push CI, add a lightweight readiness script that fails when production semantic search is enabled but pinned files or loader bootstrap are unavailable.
  - Print an explicit skipped-validation warning in normal gates/deploy logs so mocked route coverage is not mistaken for real encoder coverage.

## Risks Needing Manual Validation

### C24-TE-06 - E2E visual/color coverage is Chromium-only and captures screenshots without comparing them

- Severity: Low
- Confidence: High
- Status: Risk needing manual validation
- Evidence:
  - Playwright is intentionally serial and defines only one browser project, `chromium`, at `apps/web/playwright.config.ts:48-77`.
  - `nav-visual-check.spec.ts` asserts nav visibility, touch target size, and non-overlap at `apps/web/e2e/nav-visual-check.spec.ts:6-37`.
  - The same spec writes screenshots to `test-results/*.png` at `apps/web/e2e/nav-visual-check.spec.ts:51`, `apps/web/e2e/nav-visual-check.spec.ts:65`, and `apps/web/e2e/nav-visual-check.spec.ts:78`, but there is no `toHaveScreenshot` baseline comparison in the spec.
- Concrete failure scenario:
  - A Safari/WebKit or Firefox-only layout/color/HDR presentation regression ships while Chromium E2E stays green. Or a visual drift is captured as an artifact but never fails the gate because screenshots are not compared.
- Test/fix recommendation:
  - Keep the current single-worker Chromium lane as the fast gate if admin login rate limits require it, but add a scheduled/manual WebKit and Firefox smoke lane for public gallery/nav/lightbox flows.
  - Either convert the nav screenshots to `expect(page).toHaveScreenshot(...)` for stable critical layouts or document them as diagnostic artifacts rather than visual regression gates.

## Likely Issues

No additional likely runtime bugs are filed beyond the confirmed coverage/gate gaps above. The current cycle's strongest newly confirmed bug is the CI E2E seed mismatch in C24-TE-01. Prior cycle seed-safety and retry-state findings were rechecked against current HEAD and are not carried forward as open findings.

## Coverage Strengths Observed

- Security lint gates are broad and fixture-tested: admin API auth, mutating server action origin checks, and public mutating route rate limits are all wired into package/workflow gates.
- Migration coverage is strong: journal order/hash checks, reconcile coverage, schema guards, and deploy-time post-condition assertions are represented in tests and scripts.
- Many high-risk photographer/domain contracts have explicit regression locks: privacy-field symmetry, upload path safety, color/HDR metadata, touch targets, focus visibility, i18n parity, service worker drift, tracked secrets, and deploy script contracts.
- Flake mitigations are visible: Vitest excludes `.next` copies and sets a 15s timeout in `apps/web/vitest.config.ts`; Playwright is single-worker with retained traces/screenshots/videos in `apps/web/playwright.config.ts:48-68`; admin E2E has credential skips at `apps/web/e2e/admin.spec.ts:6-13`; long image processing polling is bounded in `apps/web/e2e/helpers.ts:151-172`.

## TDD Opportunities

- For future upload/action fixes, write failing behavior tests first around observable side effects (`settleUploadTrackerClaim`, DB insert shape, cleanup, queue payload, lock release) before touching source. This would replace several fragile source-text tests with executable regression locks.
- For CLIP scheduler changes, extract the scheduling primitive first, then TDD the queue with fake timers and synthetic abort signals before changing route behavior.
- For gate wiring, add lightweight contract tests that parse workflow/package scripts. These catch CI-only breakage without requiring the full E2E job to run locally.

## Final Missed-Gap Sweep

Rechecks performed after drafting:

- Re-read current HEAD for all findings, especially areas changed since cycle 23: `seed-e2e.ts`, `seed-e2e-safety.test.ts`, workflow E2E env, Lightroom upload source contracts, browser upload quota settlement, CLIP queue tests, CLIP skip gates, and Playwright visual config.
- Re-scanned for `describe.skip`/`test.skip`, source-contract tests, screenshots without comparisons, waits/sleeps, route/action coverage, scripts, migrations, and package/workflow gates.
- Rechecked prior-cycle findings against current HEAD. The old seed-safety bug is fixed by `seed-e2e.ts:157-170` and locked by `seed-e2e-safety.test.ts:8-20`; the remaining issue is now the workflow/env mismatch. The prior retry stale-row/queue-reject concern was not re-filed because current HEAD appears to have addressed it and this pass did not find a new high-confidence gap there.

Skipped-file confirmation:

- Not line-reviewed: `node_modules`, `.git`, `.next`/build outputs, Playwright/Vitest output folders, binary image/font fixtures, generated screenshots, and nested `.claude/worktrees` duplicate worktrees.
- Historical `.context` plan/review archives were inventoried for context but not exhaustively line-reviewed as executable product/test surface.
- No source implementation files were modified by this review pass.

Validation:

- Review-only pass. I did not run full lint/typecheck/build/unit/E2E gates because no implementation/test source changed and the requested deliverable was this written review. Diff validation should be limited to `.context/reviews/test-engineer.md`.
