# Cycle 36 Test-Engineer Review

Role: cycle-36 test-engineer review worker
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-08 KST
Mode: review-only. No production-code edits, test edits, deploys, or destructive runtime checks.

## Inventory / Scope Reviewed

Read first: `AGENTS.md`, `CLAUDE.md`, and `/Users/hletrd/.agents/skills/code-review/SKILL.md`. The prompt's TDD keyword had no dedicated local `tdd` skill exposed, so TDD opportunities are handled inside this report.

Test/gate inventory:

- 363 Vitest files under `apps/web/src/__tests__`.
- 10 E2E files under `apps/web/e2e` (9 specs plus helper).
- 29 app scripts under `apps/web/scripts`.
- CI/gate files: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`.
- Custom gates reviewed and run: `check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`.

Fresh validation:

```bash
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
```

All passed. Static focus sweep found no `.only`; local/admin E2E skip guards are explicit in `apps/web/e2e/admin.spec.ts:7-12` and `apps/web/e2e/origin-guard.spec.ts:29-77`.

## Findings

### TE-C36-01 - No coverage metric or changed-code ratchet exists

- Severity: Medium
- Confidence: High
- Classification: Confirmed
- File/region: `package.json:17-30`, `apps/web/package.json:13-30`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:54-83`
- Evidence: `npm test` is plain `vitest run`; Vitest config defines include/exclude/timeout only; CI runs lint/typecheck/custom gates/unit/e2e/build without coverage instrumentation or thresholds. A repo-wide `rg` found no coverage config or `test:coverage` script.
- Failure scenario: a new branch in `app/actions`, `app/api`, migrations, restore, upload, or image processing lands with source-shape assertions only. The large suite stays green while branch/function coverage for high-risk code drops.
- Suggested fix/test: add non-blocking `test:coverage` first, then ratchet changed-file coverage for high-risk directories. Require behavior tests or an explicit waiver for changed branches in `src/app/actions`, `src/app/api`, `scripts/migrate.js`, `lib/rate-limit`, `lib/restore-*`, and `lib/process-image`.

### TE-C36-02 - Nav "visual" E2E captures screenshots but has no visual oracle

- Severity: Medium
- Confidence: High
- Classification: Confirmed
- File/region: `apps/web/e2e/nav-visual-check.spec.ts:40-87`, `apps/web/playwright.config.ts:63-77`
- Evidence: the spec checks target geometry and overlap, then writes screenshots at lines 58, 72, and 85. A search found no `toHaveScreenshot` / `toMatchSnapshot` visual assertions anywhere in E2E.
- Failure scenario: nav color, spacing, z-index, wrapping, density, or expanded-panel visual hierarchy regresses while all elements remain visible, 44 px, and non-overlapping. CI passes and only leaves artifacts for humans to inspect after failure triage.
- Suggested fix/test: either rename the spec as geometry-only or add stable `toHaveScreenshot` baselines with masks for dynamic regions for collapsed mobile, expanded mobile, and desktop nav.

### TE-C36-03 - Browser-flow matrix is single-project desktop Chromium

- Severity: Medium
- Confidence: High
- Classification: Confirmed risk
- File/region: `apps/web/playwright.config.ts:48-77`, `.github/workflows/quality.yml:75-80`, `CLAUDE.md:708-721`
- Evidence: Playwright defines one project using `devices['Desktop Chrome']`, and CI installs only Chromium. The product has mobile nav, touch gestures, bottom sheets, PWA/service-worker behavior, and browser-specific color/HDR assumptions.
- Failure scenario: mobile WebKit/Safari focus trapping, fixed positioning, touch interaction, service-worker behavior, or Firefox color-gamut behavior regresses while desktop Chromium CI stays green.
- Suggested fix/test: add a small mobile WebKit smoke project for public gallery/photo/search/info-sheet flows, and optionally mobile Chromium. Keep admin specs serialized or isolated to avoid login rate-limit collisions.

### TE-C36-04 - CLIP production preflight is not PR/push-triggered for CLIP-touching changes

- Severity: Medium
- Confidence: High
- Classification: Confirmed
- File/region: `apps/web/package.json:21-23`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `.github/workflows/quality.yml:69-83`, `.github/workflows/clip-preflight.yml:3-46`
- Evidence: real CLIP tests skip by default unless env/model weights exist. The workflow that seeds weights is only `workflow_dispatch` plus weekly schedule, while the required quality workflow runs only ordinary unit/e2e/build gates.
- Failure scenario: a PR changes `clip-model.ts`, `clip-model-id.ts`, model manifest/download logic, semantic production route behavior, or dependency locks and breaks offline real-model loading. Required CI passes; the manual/weekly job catches it later, if observed.
- Suggested fix/test: add path filters so `clip-preflight.yml` runs on PR/push for CLIP/model/semantic files and dependency-lock changes, or require a checked artifact from `npm run test:clip:preflight` before production-mode activation.

### TE-C36-05 - Two operator sidecars remain mostly source-contract tested

- Severity: Medium
- Confidence: Medium-High
- Classification: Likely coverage gap
- File/region: `apps/web/scripts/backfill-alt-text.ts:55-160`, `apps/web/scripts/backfill-cicp-recheck.ts:51-157`, `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:34-53`, `apps/web/src/__tests__/cycle-11-source-contracts.test.ts:20-31`, `apps/web/src/__tests__/advisory-lock-release-contract.test.ts:18-34`
- Evidence: `backfill-color-pipeline` has extracted behavior tests, but searches for `backfill-alt-text` and `backfill-cicp-recheck` found only source-contract/allowlist assertions. These scripts own operator-visible behavior: settings/force gates, restore-maintenance checks, advisory lock handling, tuple unwrapping, missing originals, queue drain, counters, and exit codes.
- Failure scenario: `backfill-alt-text` regresses disabled-vs-force behavior, skips rows while the candidate set shrinks, exits success despite row failures, or writes during restore maintenance. `backfill-cicp-recheck` regresses mysql2 tuple unwrapping or prints summary before in-flight queue tasks finish. Existing source pins can remain present while behavior breaks.
- Suggested fix/test: extract pure runners with injected DB/queue/fs/caption/detection/process-exit dependencies. Add table tests for lock held, disabled setting, `--force`, restore marker before/after lock, empty captions, per-row error exit code, tuple unwrap, missing originals, and `onIdle` drain.

### TE-C36-06 - Hydration E2E uses `networkidle` as the completion oracle

- Severity: Low-Medium
- Confidence: Medium
- Classification: Flake / reliability risk
- File/region: `apps/web/e2e/hydration-photo-page.spec.ts:20-50`, `apps/web/playwright.config.ts:59-67`
- Evidence: the test collects console/page errors, navigates to a photo, calls `expectNoNextError`, then waits for `page.waitForLoadState('networkidle')` before checking hydration errors.
- Failure scenario: hydration warnings emitted after `networkidle`, or during later client state restoration, evade the assertion. Conversely, unrelated background requests can make `networkidle` slow or flaky even when hydration is complete.
- Suggested fix/test: add a deterministic client-ready marker for the photo viewer/info panel after mount, then collect console/page errors for a bounded interval after that marker and assert hydrated UI state separately.

## Closed / Not Carried Forward

- Semantic/similar scan-limit behavior is now asserted in route tests: `apps/web/src/__tests__/semantic-search-route.test.ts:553-560` and `apps/web/src/__tests__/similar-route.test.ts:345-355`. I did not re-file the prior source-only cap finding.
- The three security/custom lint gates passed freshly in this lane.

## Final Missed-Issue Sweep

- Focused tests: no `.only` found.
- Skips: only documented admin/local E2E skip branches found in the sweep; CLIP skips are env-gated by design.
- Checked common false-confidence areas: custom scanners and fixtures, CI order, Playwright browser matrix, visual screenshot assertions, CLIP workflow triggers, sidecar script test shape, migration reconcile tripwires, live nginx/proxy proof, and public route/action rate-limit gates.
- Validation not run: full unit suite, typecheck, build, Playwright, live proxy checks, CLIP preflight, deployment, or production upload load tests.
