# Cycle 24 Test-Engineer Review

Role: `test-engineer`
Repo: `/Users/hletrd/flash-shared/gallery`
Current HEAD at write: `4b43fad7` on `master`

## Inventory

Required guidance read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.

Test and verification surfaces inventoried:

- Vitest: 362 `apps/web/src/__tests__/**/*.test.{ts,tsx}` files; `apps/web/vitest.config.ts:16-39` includes only that tree, excludes `.next`, and uses a 15s default timeout.
- Playwright: 9 specs in `apps/web/e2e`; `apps/web/playwright.config.ts:48-87` runs one serial Desktop Chrome project against a production standalone build started by `scripts/run-e2e-server.mjs`.
- Custom lint/source gates: `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, `check:js-scripts`, `tracked-secrets.test.ts`, touch-target/focus scanners, migration journal/reconcile scanners, source-contract suites.
- CI: `.github/workflows/quality.yml:54-83` runs lint, typecheck, security lint gates, production `npm audit`, Vitest, DB init, Playwright, then build. `.github/workflows/clip-preflight.yml:3-45` runs CLIP preflight on schedule/manual.
- Source-contract density: full-tree scan found 107 likely source-reading contract tests. These are useful tripwires, but they are a recurring false-confidence class for behavior, timing, and DB/child-process semantics.
- Production areas inspected with tests: auth actions/rate limits, semantic/similar routes, migration/reconcile, DB backup/restore contracts, e2e harness/seed path, Playwright visual/hydration specs, CLIP preflight tests/workflows, package scripts/configs.

## Findings

### TE-C24-01 - Auth rollback source test inspects the wrong catch block

- Severity: High
- Confidence: High
- Status: Confirmed issue / false confidence
- Files/regions: `apps/web/src/__tests__/auth-rate-limit-rollback.test.ts:24-44`, `apps/web/src/__tests__/auth-rate-limit-rollback.test.ts:61-120`, `apps/web/src/app/actions/auth.ts:261-271`, `apps/web/src/app/actions/auth.ts:483-498`
- Problem: `extractOuterCatchBody()` starts at a function header, but its first scan runs to end-of-file and never computes the target function end. A probe of the helper showed the `login` test chooses the `updatePassword` catch at `auth.ts:483`, not the `login` outer catch at `auth.ts:261`.
- Failure scenario: a future edit can reintroduce `rollbackLoginRateLimit(...)` inside the `login` verification catch while leaving `updatePassword` unchanged; `auth-rate-limit-rollback.test.ts` still passes because the login assertion checks the later catch body.
- Suggested fix: replace this source parser with a behavior test around `login()` that mocks `db.select()` or `argon2.verify()` to throw after rate-limit pre-increment and asserts no rollback helpers are called. If keeping the parser temporarily, make it brace-match the named function body and add a self-test proving `login` resolves to the catch near `auth.ts:261`.

### TE-C24-02 - Critical runtime contracts still rely on source tripwires rather than behavior

- Severity: Medium
- Confidence: High
- Status: Likely issue with one confirmed exemplar above
- Files/regions: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-101`, `apps/web/src/__tests__/db-restore.test.ts:47-74`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:1-17`, `apps/web/src/__tests__/search-stale-response.test.ts:8-10`, `apps/web/src/app/api/search/semantic/route.ts:270-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:181-190`
- Problem: several high-risk guarantees are asserted by string presence or source ordering. `migrate-reconcile-coverage` explicitly says it is not a structural validator; `db-restore.test.ts` string-pins cleanup/failure paths; semantic scan caps are protected by `.limit(SEMANTIC_SCAN_LIMIT)` source regex because route mocks do not assert the terminal `.limit()` argument.
- Failure scenario: a refactor can preserve the searched strings while changing transaction sequencing, child-process settlement, or query execution. The auth finding proves this is not hypothetical: a source helper can pass while testing a different region.
- Suggested fix: keep source tripwires as cheap lint, but add TDD behavior harnesses for the top risks: disposable MySQL schema-diff after `reconcileLegacySchema`, fake `mysql`/`mysqldump` child-process restore failure tests, and DB-chain mocks that record `.limit(SEMANTIC_SCAN_LIMIT)` on semantic and similar scans.

### TE-C24-03 - Browser and visual coverage is narrow and partly artifact-only

- Severity: Medium
- Confidence: High
- Status: Manual-validation risk
- Files/regions: `apps/web/playwright.config.ts:48-77`, `.github/workflows/quality.yml:75-80`, `apps/web/e2e/nav-visual-check.spec.ts:40-86`, `apps/web/e2e/hydration-photo-page.spec.ts:36-49`
- Problem: Playwright defines one Desktop Chrome project and CI installs/runs only Chromium. The nav "visual" tests save screenshots at `nav-visual-check.spec.ts:58`, `:72`, and `:85`, but do not compare them to baselines. Hydration waits on `networkidle`, which is a known flaky readiness proxy for modern apps.
- Failure scenario: WebKit/mobile viewport regressions, Firefox media-query/display-gamut differences, PWA/service-worker issues, or visual spacing/color regressions can ship green. A hydration warning emitted after `networkidle`, or suppressed by timing, can also evade the current assertion.
- Suggested fix: add small tagged smoke projects for mobile WebKit and mobile Chromium, and convert stable nav screenshots to `expect(locator).toHaveScreenshot()` with masked dynamic regions. Replace `networkidle` with an app-level hydration-ready marker or a bounded console-error collection window after a concrete UI-ready assertion.

### TE-C24-04 - Main quality workflow does not exercise production CLIP preflight

- Severity: Low-Medium
- Confidence: High
- Status: Risk needing manual/scheduled validation
- Files/regions: `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`, `.github/workflows/quality.yml:54-83`, `.github/workflows/clip-preflight.yml:3-45`
- Problem: default Vitest skips real CLIP loading/ranking unless model env and weights are present. The dedicated preflight exists, but it is only `workflow_dispatch` plus weekly schedule, not part of the PR/push quality workflow.
- Failure scenario: a PR that changes `clip-model.ts`, manifest/download behavior, transformer setup, or semantic production routing can pass the main quality workflow while breaking production semantic search until the weekly preflight or an operator run catches it.
- Suggested fix: trigger `clip-preflight.yml` on PRs/pushes that touch CLIP model/download/semantic production files, or add a required lightweight non-weighted contract plus an optional required preflight label/check for CLIP-touching changes.

### TE-C24-05 - No coverage report or threshold exists for regression visibility

- Severity: Low-Medium
- Confidence: High
- Status: Test strategy gap
- Files/regions: `package.json:17-29`, `apps/web/package.json:13-29`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:54-83`
- Problem: scripts run many tests, but there is no coverage command, changed-file coverage signal, or threshold. This is especially risky in a repo with 107 source-contract tests because raw test count can look strong while behavior coverage for new branches remains absent.
- Failure scenario: a new failure branch in an admin action, route, restore path, or image pipeline lands with only a source pin or no test at all; CI has no objective signal that executable coverage dropped.
- Suggested fix: add a non-blocking coverage report first, then ratchet changed-file or high-risk-directory thresholds. Exclude fixture/source-scanner files deliberately so the metric does not reward more string-only tests.

## Evidence

- Full inventory commands used: `find apps/web/src/__tests__ -type f -name '*.test.*'`, `find apps/web/e2e -type f -name '*.spec.ts'`, `find .github -maxdepth 4 -type f`, package/config reads, and repo-wide `rg` for skips/source contracts.
- Counts observed: 362 Vitest files, 9 Playwright specs, 4008 `describe`/`it`/`test` call sites, 107 likely source-reading contract tests.
- Confirmed parser false-confidence with a read-only Node probe: both `extractOuterCatchBody(authSource, 'export async function login')` and the updatePassword call select the catch beginning at `auth.ts:483`.
- No full test suite, Playwright suite, build, typecheck, or deploy was run in this review lane.

## Final Sweep

- Examined file categories: root/app package scripts, Vitest config, Playwright config, GitHub workflows, e2e helper/server/seed scripts, all test file names, skip/only/todo patterns, custom lint gates, source-contract tests, auth/semantic/restore/migration production regions, CLIP gated tests, and existing carry-forward test-infra registers.
- Checked common misses: `test.only`/`describe.only` none found; intentional skips are CLIP env gates and admin/local e2e gates; admin e2e auto-enables in CI through local origin plus plaintext `E2E_ADMIN_PASSWORD`; `.next` test discovery is excluded; Playwright serializes admin login to avoid rate-limit flakes.
- Remaining manual validation: non-Chromium browsers, real CLIP weights outside scheduled preflight, live nginx/proxy topology, production deploy smoke, and full gate execution.
