# Cycle 37 Test-Engineer Review

Role: cycle-37 test-engineer  
Repo: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-07-08 KST  
Mode: review-only. No product-code edits, test edits, deploys, or destructive runtime checks.

## Inventory / Examined Files

Read first:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Routing note: the prompt included `TDD`; the hook routed it to a `tdd` workflow, but no dedicated local `tdd` skill was exposed in this session. I handled TDD opportunities inside this test-engineer review.

Inventory built before findings:
- 938 review-relevant files from `rg --files` with generated/runtime assets excluded (`node_modules`, `.next`, `public/uploads`, `public/resources`, `data`).
- 363 Vitest files under `apps/web/src/__tests__/`.
- 9 Playwright spec files under `apps/web/e2e/`.
- 29 app scripts under `apps/web/scripts/`.
- 12 App Router route handlers under `apps/web/src/app/**/route.{ts,tsx}`.
- CI/gates: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`.

Deep-examined files and regions:
- Test/gate config: `package.json:17-30`, `apps/web/package.json:8-30`, `apps/web/vitest.config.ts:16-39`, `apps/web/playwright.config.ts:48-86`, `.github/workflows/quality.yml:54-83`, `.github/workflows/clip-preflight.yml:3-46`.
- E2E: `apps/web/e2e/admin.spec.ts:6-166`, `apps/web/e2e/origin-guard.spec.ts:27-87`, `apps/web/e2e/nav-visual-check.spec.ts:40-87`, `apps/web/e2e/hydration-photo-page.spec.ts:20-50`, `apps/web/e2e/helpers.ts:28-73`.
- Custom scanners: `apps/web/scripts/check-api-auth.ts:17-207`, `apps/web/scripts/check-action-origin.ts` via tests and gate output, `apps/web/scripts/check-public-route-rate-limit.ts:1-138`.
- Scanner tests: `apps/web/src/__tests__/touch-target-audit.test.ts:42-88`, `apps/web/src/__tests__/focus-visible-links-scan.test.ts:52-77`, `apps/web/src/__tests__/check-action-origin.test.ts:37-260`.
- CLIP preflight: `apps/web/src/__tests__/clip-offline-load.test.ts:15-65`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-80`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:56-65`.
- Operator sidecars: `apps/web/scripts/backfill-alt-text.ts:47-160`, `apps/web/scripts/backfill-cicp-recheck.ts:51-157`, `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:34-53`, `apps/web/src/__tests__/cycle-11-source-contracts.test.ts:20-31`, `apps/web/src/__tests__/advisory-lock-release-contract.test.ts:18-34`.
- Proxy diagnostic proof: `scripts/check-proxy-topology.mjs:7-16` and `106-134`, `apps/web/src/app/api/search/semantic/route.ts:173-200`, `apps/web/src/lib/rate-limit.ts:415-433`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:29-47`.

Validation run:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Focus/skip sweep: `rg -n "describe\\.skip|it\\.skip|test\\.skip|\\.only\\b" apps/web/src/__tests__ apps/web/e2e` found no `.only`; skips are documented E2E credential/baseURL guards and CLIP env-gated suites.

Not run: full Vitest, Playwright, build, typecheck, CLIP preflight, live proxy checks, deploy, or production load tests.

## Findings

### TE-C37-01: No coverage metric or changed-code ratchet exists

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Category: gate coverage gap / TDD opportunity
- Files/regions: `package.json:17-30`, `apps/web/package.json:8-30`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:54-83`

Evidence: `npm test` is plain `vitest run` (`apps/web/package.json:13`), Vitest config only sets include/exclude/timeout (`apps/web/vitest.config.ts:16-39`), and the quality workflow runs lint/typecheck/custom gates/audit/unit/e2e/build without coverage collection (`.github/workflows/quality.yml:54-83`). There is no `test:coverage` script in the root or app package scripts.

Concrete failure scenario: a branch adds new behavior to a high-risk module such as `app/actions/images.ts`, `app/api/search/semantic/route.ts`, `scripts/migrate.js`, restore code, or image processing. Existing source-contract tests and broad smoke tests remain green, but the new branch has no behavior-level test and there is no coverage signal to force a discussion.

Suggested fix/test: add a non-blocking `test:coverage` first, then ratchet changed-file coverage for high-risk directories. Gate changed branches in `src/app/actions`, `src/app/api`, `scripts/migrate.js`, `src/lib/restore-*`, `src/lib/rate-limit.ts`, and `src/lib/process-image.ts` with behavior tests or explicit waiver comments.

### TE-C37-02: Browser-flow CI is still single-project desktop Chromium

- Severity: Medium
- Confidence: High
- Status: Confirmed risk
- Category: insufficient browser/device regression lock
- Files/regions: `apps/web/playwright.config.ts:48-86`, `.github/workflows/quality.yml:75-80`, `CLAUDE.md:708-721`

Evidence: Playwright defines one project, `devices['Desktop Chrome']` (`apps/web/playwright.config.ts:72-76`), and CI installs only Chromium (`.github/workflows/quality.yml:75-80`). The product contract explicitly includes mobile nav, touch gestures, bottom sheets, PWA/service-worker behavior, and browser-specific color/HDR assumptions, including Safari/Firefox differences (`CLAUDE.md:708-721`).

Concrete failure scenario: a mobile WebKit regression breaks the info bottom sheet, swipe reset, focus trap, fixed nav, or service-worker fallback while desktop Chromium E2E, unit scans, and typecheck stay green. Similarly, Firefox color-gamut fallback behavior can regress with no browser-flow signal.

Suggested fix/test: add a small mobile WebKit project for public gallery/photo/search/info-sheet flows and keep admin specs serialized or isolated. Add mobile Chromium only if runtime cost allows. For Firefox-specific color/HDR assumptions, add a small browser-context smoke or keep the expectation in a deterministic unit test with explicit browser-feature mocks.

### TE-C37-03: Nav “visual” E2E writes screenshots but has no visual oracle

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Category: false confidence in visual fixtures
- Files/regions: `apps/web/e2e/nav-visual-check.spec.ts:40-87`, `apps/web/playwright.config.ts:63-77`

Evidence: the nav spec checks visibility, target size, and overlap, then saves screenshots to `test-results` (`apps/web/e2e/nav-visual-check.spec.ts:58`, `72`, `85`). There is no `toHaveScreenshot` or `toMatchSnapshot` assertion in the E2E suite, and Playwright config only retains failure artifacts (`apps/web/playwright.config.ts:63-77`).

Concrete failure scenario: nav color contrast, spacing, wrapping, layering, density, expanded panel hierarchy, or theme treatment regresses while all controls remain visible, non-overlapping, and at least 44 px. CI passes and screenshots are only passive artifacts.

Suggested fix/test: either rename the spec to geometry-only, or add stable `toHaveScreenshot` baselines for collapsed mobile, expanded mobile, and desktop nav with masks for dynamic regions.

### TE-C37-04: CLIP production preflight is not required on PR/push for CLIP-touching changes

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Category: env-gated test gap
- Files/regions: `apps/web/package.json:21-23`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-65`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-80`, `.github/workflows/quality.yml:69-83`, `.github/workflows/clip-preflight.yml:3-46`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:56-65`

Evidence: real CLIP tests intentionally skip unless `CLIP_MODELS_ROOT` and env flags are present (`clip-offline-load.test.ts:32-41`, `clip-semantic-integration.test.ts:30-31`). The required quality workflow runs ordinary unit/e2e/build gates only (`.github/workflows/quality.yml:69-83`). The weight-seeding workflow is manual plus weekly schedule (`.github/workflows/clip-preflight.yml:3-6`), and the existing ops contract only asserts that schedule/manual workflow exists (`cycle12-ops-contracts.test.ts:56-65`).

Concrete failure scenario: a PR changes `clip-model.ts`, `clip-model-id.ts`, model download/manifest logic, semantic production route behavior, or dependency locks. Required CI passes because the real-model suites skip. The manual/weekly workflow catches the offline-load or ranking break later, if somebody notices before production activation.

Suggested fix/test: add PR/push path filters to `clip-preflight.yml` for CLIP/model/semantic files and package lock changes, or make production-mode activation require a fresh `npm run test:clip:preflight` artifact for the target commit.

### TE-C37-05: Operator sidecars still rely mostly on source-contract tests

- Severity: Medium
- Confidence: Medium-High
- Status: Likely
- Category: weak regression locks / TDD opportunity
- Files/regions: `apps/web/scripts/backfill-alt-text.ts:47-160`, `apps/web/scripts/backfill-cicp-recheck.ts:51-157`, `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:34-53`, `apps/web/src/__tests__/cycle-11-source-contracts.test.ts:20-31`, `apps/web/src/__tests__/advisory-lock-release-contract.test.ts:18-34`

Evidence: `backfill-alt-text.ts` owns settings/force gates, restore-maintenance checks, advisory lock acquisition/release, keyset pagination, per-row failure counters, and exit code selection (`backfill-alt-text.ts:47-160`). `backfill-cicp-recheck.ts` owns mysql2 tuple unwrapping, filesystem-original resolution, queued detection work, counters, and final summary timing (`backfill-cicp-recheck.ts:51-157`). Current locks are source-string assertions: restore guard placement (`cycle-71-source-contracts.test.ts:34-53`), parser/cap text (`cycle-11-source-contracts.test.ts:20-31`), and advisory-lock raw-release allowlisting (`advisory-lock-release-contract.test.ts:18-34`).

Concrete failure scenario: `backfill-alt-text` regresses disabled-vs-force behavior, returns success despite row failures, skips rows while the candidate set shrinks, or writes during restore maintenance. `backfill-cicp-recheck` regresses tuple unwrapping or prints a summary before in-flight queue work finishes. Source strings can remain present while behavior breaks.

Suggested fix/test: extract pure runner functions with injected DB, queue, filesystem, caption/detection, and exit-code dependencies. Add behavior tests for lock-held, disabled setting, `--force`, restore marker before/after lock, empty captions, per-row error exit code, tuple unwrap, missing originals, queue `onIdle` drain, and summary counters.

### TE-C37-06: Proxy topology “read-only” proof test misses the semantic limiter side effect

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed
- Category: false confidence in operational test fixture
- Files/regions: `scripts/check-proxy-topology.mjs:7-16` and `106-134`, `apps/web/src/app/api/search/semantic/route.ts:173-200`, `apps/web/src/lib/rate-limit.ts:415-433`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:29-47`

Evidence: the diagnostic help says it is a “Read-only public-edge check” that sends semantic-search POST probes (`scripts/check-proxy-topology.mjs:7-10`), and the test locks that wording plus the `/api/search/semantic` probe (`cycle12-ops-contracts.test.ts:29-47`). The semantic route deliberately pre-increments the public semantic limiter before disabled-mode responses (`route.ts:173-200`), using the in-process 30/minute bucket (`rate-limit.ts:406-426`). The script sends two such probes per run (`scripts/check-proxy-topology.mjs:106-127`).

Concrete failure scenario: an operator repeatedly runs the proxy topology check during an incident. Each run consumes semantic-search attempts from the caller’s effective client-IP bucket. After enough runs, the diagnostic itself can produce 429s or affect users behind the same NAT, while the test suite still asserts the script is “read-only.”

Suggested fix/test: update the proof test and help text to distinguish “no data mutation” from “rate-limit budget side effect,” or move the diagnostic to a dedicated route/probe that exercises forwarded host/proto handling without charging the public semantic-search limiter. Add a behavior test around the probe route or a source contract that explicitly fails if the diagnostic claims no side effects while using a charged endpoint.

### TE-C37-07: Hydration E2E uses `networkidle` as the completion oracle

- Severity: Low-Medium
- Confidence: Medium
- Status: Risk
- Category: flaky/insufficient regression lock
- Files/regions: `apps/web/e2e/hydration-photo-page.spec.ts:20-50`, `apps/web/playwright.config.ts:59-67`

Evidence: the hydration spec records console/page errors, opens a photo, calls `expectNoNextError`, then waits for `page.waitForLoadState('networkidle')` before filtering hydration errors (`hydration-photo-page.spec.ts:20-42`). The global E2E timeout is 60 s and traces/screenshots/videos retain on failure (`playwright.config.ts:59-67`), but there is no deterministic client-ready marker.

Concrete failure scenario: a hydration warning emitted after `networkidle`, or after a mount effect/state restoration, evades the assertion. Conversely, unrelated background requests can delay `networkidle` and create flakes even when hydration is correct.

Suggested fix/test: add a deterministic photo-viewer hydrated marker or wait for a specific post-mount UI state, then collect console/page errors for a bounded interval after that marker. Assert both “no hydration errors” and the restored pinned/info UI state.

## Closed / Not Re-Filed

- Admin E2E is not silently skipped in CI: `adminE2EEnabled` auto-enables on local origins when plaintext admin credentials are present (`apps/web/e2e/helpers.ts:28-45`), and quality CI sets those credentials (`.github/workflows/quality.yml:27-37`).
- Public/admin route static gates are alive and freshly passed.
- `.only` was not present in unit or E2E tests.
- CLIP test skips are intentional env gates; the finding is that the seeded workflow is not required on CLIP-touching PR/push changes.

## Final Missed-Issues Sweep

I re-swept before closing for:
- Missing/weak tests in CI scripts, package scripts, Vitest config, Playwright config, custom lint gates, source-contract tests, CLIP preflight, sidecar scripts, and proxy diagnostics.
- Flaky-test signals: `.only`, explicit skip branches, `networkidle`, passive screenshots, single-browser assumptions, and env-gated suites.
- False confidence in fixtures: source-string tests that assert wording/imports/placement without behavior, and screenshot artifacts without visual assertions.
- Gate coverage gaps: no coverage ratchet, no required CLIP real-model preflight for CLIP-touching changes, no WebKit/mobile browser flow in CI.
- TDD opportunities: sidecar runner extraction, changed-code coverage ratchet, deterministic hydration readiness marker, and true visual screenshot assertions.

No product code was edited. The review artifact itself is the only file created by this lane.
