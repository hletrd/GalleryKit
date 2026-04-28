# Test Engineer Deep Review Slice

Repo: `/Users/hletrd/flash-shared/gallery`
Role: `test-engineer`
Scope: test strategy, coverage, flakiness, false positives, environment coupling, and gate configuration.
Constraint honored: no source/test/config edits; only this report was written.

## Inventory

### Test/config surface inspected
- Root scripts: `package.json` delegates `lint`, `typecheck`, `test`, `test:e2e`, `lint:api-auth`, and `lint:action-origin` to `apps/web`.
- App test scripts: `apps/web/package.json` runs Vitest (`vitest run`) and Playwright (`env -u NO_COLOR npx playwright test`).
- Unit config: `apps/web/vitest.config.ts` includes `src/__tests__/**/*.test.ts`; current uncommitted change adds global `testTimeout: 120_000`.
- E2E config: `apps/web/playwright.config.ts` runs one Chromium worker, seeds/builds/starts the local server, and currently derives `webServer.timeout` from `E2E_WEB_SERVER_TIMEOUT_MS` with a very large fallback.
- Static gates: `apps/web/eslint.config.mjs`, `apps/web/src/__tests__/check-api-auth.test.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/touch-target-audit.test.ts`, `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`, and source-contract tests such as `client-source-contracts.test.ts`.
- E2E specs: `apps/web/e2e/admin.spec.ts`, `nav-visual-check.spec.ts`, `origin-guard.spec.ts`, `public.spec.ts`, `test-fixes.spec.ts`, plus `e2e/helpers.ts` and the fixtures.
- High-value source surfaces with weak direct coverage: `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/components/photo-navigation.tsx`, and several visual/UI flows that are only smoke-tested or source-scanned.

## Findings

### TE-01 — Global Vitest timeout is now 120s, which makes hangs expensive and easier to miss
- **Severity:** High
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/vitest.config.ts:10-12`
- **Problem:** the new global timeout applies to every unit test, including small static/source-contract checks. Most tests in this repo are synchronous or only need a short async window, so 120 seconds is a very permissive default.
- **Failure scenario:** a mocked queue/bootstrap test, a deadlocked import, or a Promise that never settles now burns two minutes per failing file before surfacing. CI gets slower and hangs become harder to distinguish from legitimate long-running tests.
- **Suggested fix:** restore a shorter global timeout and scope longer timeouts to the few tests that truly need them via per-test or per-file overrides.

### TE-02 — Playwright’s local web-server gate can now wait 30 minutes by default and accepts invalid timeout input
- **Severity:** High
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/playwright.config.ts:32`, `apps/web/playwright.config.ts:61-68`
- **Problem:** `webServer.timeout` is built from `Number(process.env.E2E_WEB_SERVER_TIMEOUT_MS || '1800000')`, so the default is 1,800,000 ms and malformed values can become `NaN` instead of failing clearly.
- **Failure scenario:** if `npm run init`, `e2e:seed`, `next build`, or the standalone server startup hangs, the gate can stall for far longer than the previous 180s budget. A typo like `E2E_WEB_SERVER_TIMEOUT_MS=fast` produces a non-finite timeout and a confusing configuration failure mode.
- **Suggested fix:** parse and validate the env var explicitly, reject non-finite values, and keep the default much closer to the old timeout unless a CI-specific override is intentionally set.

### TE-03 — The touch-target audit still misses 40px controls
- **Severity:** High
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/__tests__/touch-target-audit.test.ts:204-247`, `apps/web/src/__tests__/touch-target-audit.test.ts:486-590`, `apps/web/src/components/lightbox.tsx:310,329`
- **Problem:** the audit catches `h-8` and `h-9` literals plus `size="sm"` / `size="icon"`, but it does not currently catch `h-10`, `w-10`, `size-10`, or equivalent 40 px class combinations.
- **Failure scenario:** a future regression can quietly reintroduce sub-44 px lightbox controls or other compact buttons and still pass the static audit, because the current regex set does not cover the 40 px class family.
- **Suggested fix:** add fixtures for `h-10`, `w-10`, `size-10`, and explicit 40 px variants, or add a small Playwright/mobile bounding-box assertion for actual rendered controls.

### TE-04 — The origin-guard E2E can pass without proving the guard actually fired
- **Severity:** Medium
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/e2e/origin-guard.spec.ts:28-67`, `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/helpers.ts:28-45`
- **Problem:** the unauthenticated origin-guard branch accepts either 401 or 403, so a missing same-origin check can still pass as long as auth rejects first. The authenticated branch that forces a definite 403 is skipped whenever admin E2E credentials are not configured.
- **Failure scenario:** the same-origin guard regresses on `/api/admin/db/download`, but local or CI runs without admin credentials still pass because the route remains protected by the auth wrapper.
- **Suggested fix:** make the authenticated branch mandatory in protected CI lanes, or fail the spec when admin credentials are absent so the origin-guard claim is not silently vacuous.

### TE-05 — The nav “visual” checks only capture screenshots; they do not compare against baselines
- **Severity:** Low
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/e2e/nav-visual-check.spec.ts:5-40`
- **Problem:** each test writes a screenshot artifact, but there is no `toHaveScreenshot` or equivalent baseline comparison.
- **Failure scenario:** clipping, overlap, spacing drift, or contrast regressions can slip through while the screenshot artifact still gets written and the test continues to pass.
- **Suggested fix:** convert these to real Playwright visual-diff assertions or rename them as smoke/artifact-capture tests so they are not mistaken for regression checks.

### TE-06 — `process-topic-image.ts` is only covered indirectly through mocked topic-action tests
- **Severity:** Medium
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/lib/process-topic-image.ts:42-106`, `apps/web/src/__tests__/topics-actions.test.ts:111-114`, `apps/web/src/__tests__/topics-actions.test.ts:183-260`
- **Problem:** the topic actions mock `processTopicImage` and `deleteTopicImage`, so the real Sharp / temp-file cleanup path is not exercised directly.
- **Failure scenario:** a Sharp upgrade, temp-file cleanup regression, or invalid-image path breaks topic image processing while the server-action tests remain green because they never execute the module.
- **Suggested fix:** add focused tests for `processTopicImage`, `deleteTopicImage`, and `cleanOrphanedTopicTempFiles` with a temporary working directory and small fixtures.

## Final sweep / missed-gap checklist
- The audit and source-contract tests are useful guardrails, but several high-value flows are still checked only by regex or smoke coverage.
- `sharing.ts` remains a high-value missing behavioral-test surface even though it was not tallied as a formal finding here.
- E2E startup remains tightly coupled to local DB/bootstrap state; the current timeout increase hides slowness rather than reducing it.

## Summary counts
- Findings: 6 (4 high, 1 medium, 1 low)
- Report file written: `.context/reviews/test-engineer.md`
