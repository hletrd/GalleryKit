# Cycle 35 Test-Engineer Review

Role: `cycle-35 test-engineer`
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-08 KST
Mode: review-only. No product-code edits, test edits, commits, pushes, deploys, or destructive runtime checks.

## Inventory / Scope Reviewed

Required guidance read first: `AGENTS.md`, `CLAUDE.md`, and the local `code-review` skill. The prompt's TDD keyword had no dedicated local `tdd` skill available, so TDD was handled as test-first opportunity review inside this report.

Inventoried test-relevant surfaces:

- 363 Vitest specs under `apps/web/src/__tests__`.
- 9 Playwright specs under `apps/web/e2e`.
- 31 Drizzle SQL migrations under `apps/web/drizzle`.
- 29 app scripts under `apps/web/scripts`, plus root scripts including `scripts/check-proxy-topology.mjs`.
- Gate/config files: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, `.nvmrc`.
- Custom lint/scanner gates and their fixture tests: `check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`, touch-target audit, migration/reconcile tripwires, source-contract tests, nginx/proxy checks, CLIP preflight tests, visual/hydration e2e specs.
- Implementation sampled against coverage claims: semantic/similar search routes, sidecar backfill scripts, migration reconcile path, nginx public page limiter, Playwright admin helpers, CLIP model proof tests.

Static inventory evidence: `find` counted 363 unit specs, 9 e2e specs, 31 migrations, and 29 app scripts. `rg` found no `test.only` / `describe.only` / `it.only`. About 248 unit test files contain source-contract/string assertions, so raw test count overstates behavior-level coverage.

## Findings

### TE-C35-01 - No coverage metric or ratchet exists for high-risk branches

- Type: Missing test/gate, not an observed product bug.
- Severity: Medium
- Confidence: High
- Classification: Confirmed
- File/region: `package.json:17-30`, `apps/web/package.json:8-30`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:54-83`
- Evidence: `npm test` is plain `vitest run`; Vitest config has include/exclude/timeout only; CI runs lint/typecheck/custom gates/unit/e2e/build but no coverage command, threshold, or changed-file coverage signal.
- Failure scenario: a new failure branch in an admin action, public route, image-processing path, or sidecar script lands with only source-shape assertions or no executable test. The suite can remain green because no gate reports branch/function coverage drop in `src/app/actions`, `src/app/api`, `src/lib`, or `scripts`.
- Suggested fix/test: add a non-blocking `test:coverage` job first using Vitest coverage, then ratchet thresholds by high-risk directory. Exclude pure fixture/source-scanner helper files deliberately so source-contract tests do not inflate confidence.

### TE-C35-02 - Semantic scan cap is source-pinned instead of behavior-pinned

- Type: Missing behavioral test, not an observed product bug.
- Severity: Medium
- Confidence: High
- Classification: Confirmed
- File/region: `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-76`, `apps/web/src/__tests__/semantic-search-route.test.ts:129-149`, `apps/web/src/__tests__/semantic-search-route.test.ts:552-559`, `apps/web/src/__tests__/similar-route.test.ts:68-95`, `apps/web/src/__tests__/similar-route.test.ts:324-356`, `apps/web/src/app/api/search/semantic/route.ts:263-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-190`
- Evidence: the dedicated cap test only checks source text for `.limit(SEMANTIC_SCAN_LIMIT)`. The semantic route mock has a `limit` stub resolving rows but does not assert the argument. The similar route mock's `limit` ignores arguments, and its behavioral assertion checks only model-version filtering/source text.
- Failure scenario: a refactor can leave `.limit(SEMANTIC_SCAN_LIMIT)` somewhere in either route file while the executed DB chain no longer applies that cap to the embedding scan, or applies it after an unbounded read helper. CI would still pass, but semantic/similar requests could scan all embeddings.
- Suggested fix/test: TDD route-level DB-chain mocks that record terminal query operations for both routes. Assert the embedding-scan query calls `limit(SEMANTIC_SCAN_LIMIT)` on the scan chain, distinct from target lookup/enrichment queries. Keep the source tripwire as secondary cheap protection.

### TE-C35-03 - Nav "visual" e2e captures screenshots but never compares them

- Type: Missing visual assertion, not an observed product bug.
- Severity: Medium
- Confidence: High
- Classification: Confirmed
- File/region: `apps/web/e2e/nav-visual-check.spec.ts:40-86`, `apps/web/playwright.config.ts:63-77`
- Evidence: the spec checks visibility, 44 px target geometry, and overlap, then writes screenshots with `page.screenshot(...)`. There is no `toHaveScreenshot`, `toMatchSnapshot`, threshold, or baseline comparison anywhere in e2e.
- Failure scenario: a regression in nav spacing, color, z-index, panel positioning, desktop wrapping, or mobile expanded layout can pass while producing a visibly broken screenshot artifact that nobody reviews in CI.
- Suggested fix/test: convert stable states to `expect(nav).toHaveScreenshot()` or page-level screenshots with masks for dynamic regions. Keep geometry checks because they diagnose overlap/touch-target defects that pixel diffs may not explain.

### TE-C35-04 - Production CLIP proof is outside PR/push gates for CLIP-touching changes

- Type: Gate completeness gap, not an observed product bug.
- Severity: Medium
- Confidence: High
- Classification: Confirmed
- File/region: `apps/web/package.json:21-23`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`, `.github/workflows/quality.yml:69-83`, `.github/workflows/clip-preflight.yml:3-46`
- Evidence: real-model CLIP tests are skipped unless env/model weights are present. The dedicated workflow seeds weights and runs `test:clip:preflight`, but it is only `workflow_dispatch` plus weekly schedule; the main quality workflow never invokes it.
- Failure scenario: a PR changes `clip-model.ts`, model-id/manifest/download logic, or semantic production routing and passes main CI while breaking offline model load or real semantic ranking. The weekly/manual workflow may catch it after merge or only when someone remembers to run it.
- Suggested fix/test: trigger `clip-preflight.yml` on pull requests/pushes with path filters for CLIP/model/semantic production files, or require an explicit CLIP-preflight check label for such changes. Keep the default stubbed unit tests for speed.

### TE-C35-05 - Sidecar backfill scripts still have mostly indirect/source coverage

- Type: Missing behavioral tests, not an observed product bug.
- Severity: Medium
- Confidence: Medium-High
- Classification: Likely
- File/region: `apps/web/scripts/backfill-alt-text.ts:55-160`, `apps/web/scripts/backfill-cicp-recheck.ts:51-157`, `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:34-40`, `apps/web/src/__tests__/cycle-11-source-contracts.test.ts:24-30`, `apps/web/src/__tests__/advisory-lock-release-contract.test.ts:27-33`
- Evidence: tests mostly assert source strings or allowlist placement for these scripts. The scripts own real operator behavior: settings/`--force` gates, advisory locks, restore-maintenance checks, keyset pagination, queue drain, tuple unwrapping, per-row error accounting, and process exit codes.
- Failure scenario: `backfill-alt-text` could regress disabled-vs-force behavior, continue across restore maintenance, skip rows while the candidate set shrinks, or return success despite row failures. `backfill-cicp-recheck` could regress mysql2 tuple unwrap or use a drain primitive that prints summary before queued tasks finish. Current source pins would miss several of those failures.
- Suggested fix/test: extract pure `runBackfillAltText(deps, options)` and `runCicpRecheck(deps, options)` runners with injected DB/queue/fs/caption/detection dependencies. Add table tests for lock held, disabled setting, force, restore marker before/after lock, empty caption, row error exit, tuple unwrap, missing originals, and queue idle drain.

### TE-C35-06 - Migration reconcile tests are broad tripwires but not structural validation

- Type: Missing structural integration test, not an observed product bug.
- Severity: Medium
- Confidence: Medium
- Classification: Risk
- File/region: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:76-103`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:124-180`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:182-226`
- Evidence: the file explicitly calls itself a source tripwire and not a structural validator. It now strips comments and pins some high-risk shapes, but most checks still prove only that table/column/index/FK names appear in executable `migrate.js` text.
- Failure scenario: `reconcileLegacySchema` can mention a column/index/FK name while emitting the wrong type, nullability, default, index columns/order, or FK target. A fresh/drifted DB can baseline successfully with schema still diverging from Drizzle and migrations.
- Suggested fix/test: add a disposable MySQL structural diff test for `reconcileLegacySchema`: create an empty schema, run reconcile, inspect `information_schema`, and compare table/column/index/FK metadata for high-risk tables first (`images`, `image_embeddings`, `admin_tokens`, analytics, `pending_file_deletions`). Keep source tripwires for fast local feedback.

### TE-C35-07 - Hydration e2e uses `networkidle` as the hydration completion oracle

- Type: Flake/coverage reliability gap, not an observed product bug.
- Severity: Low-Medium
- Confidence: Medium
- Classification: Risk
- File/region: `apps/web/e2e/hydration-photo-page.spec.ts:20-49`, `apps/web/playwright.config.ts:59-67`
- Evidence: the test collects console/page errors, navigates to a photo, calls `expectNoNextError`, then waits for `page.waitForLoadState('networkidle')` before checking hydration error text.
- Failure scenario: hydration warnings emitted after `networkidle`, or during later client state restoration, can evade the assertion. Conversely, unrelated background requests can make `networkidle` slow or flaky even when hydration is complete.
- Suggested fix/test: add a deterministic app-level ready marker for the photo viewer/info panel after client mount, then collect console/page errors for a bounded interval after that marker. Assert the expected hydrated UI state separately from network quiescence.

### TE-C35-08 - Browser-flow matrix is single-project Desktop Chromium

- Type: Manual-validation risk, not an observed product bug.
- Severity: Medium
- Confidence: High
- Classification: Risk
- File/region: `apps/web/playwright.config.ts:48-77`, `.github/workflows/quality.yml:75-80`, `CLAUDE.md` browser/display matrix notes
- Evidence: Playwright installs only Chromium in CI and defines one `Desktop Chrome` project. CLAUDE.md documents browser-specific display-gamut/HDR behavior, and the app has mobile nav, lightbox, service worker/PWA, and touch-heavy flows.
- Failure scenario: mobile WebKit/Safari behavior, Firefox media-query behavior, touch gestures, responsive overflow, or service-worker behavior can regress while CI stays green.
- Suggested fix/test: add small smoke projects for mobile Chromium and mobile WebKit first. If display-capability remains high risk, add a Firefox smoke around `useDisplayCapability`/wide-gamut hint behavior. Preserve admin rate-limit safety by keeping admin specs serialized or in a separate project.

### TE-C35-09 - Public SSR page throttling depends on manually-applied nginx config without executable proof

- Type: Gate completeness / ops test gap, not an observed product bug.
- Severity: Medium
- Confidence: High
- Classification: Confirmed
- File/region: `apps/web/scripts/check-public-route-rate-limit.ts:1-20`, `apps/web/scripts/check-public-route-rate-limit.ts:986-998`, `apps/web/nginx/default.conf:274-306`, `scripts/check-proxy-topology.mjs:7-16`, `scripts/check-proxy-topology.mjs:129-134`
- Evidence: the app scanner covers public route handlers, not SSR pages. The nginx template applies `limit_req zone=public` in `location /`, and comments state deploys do not apply host nginx. The proxy topology script explicitly reports that effective client-IP bucket/XFF overwrite is not verified.
- Failure scenario: a stale host nginx config, bad reload, missing `limit_req_zone`, or incorrect real-IP setup leaves dynamic public pages unthrottled, or overthrottles visitors behind a proxy. CI and deploy can pass because they validate app code/template text, not the live edge behavior.
- Suggested fix/test: add an nginx syntax/config test using the real nginx binary in CI when available, plus a local container smoke that bursts `/` until it observes 429 while a normal seeded page load does not. Keep live-host verification as an operator runbook item because deploys intentionally do not apply host nginx.

## Actual Behavior Bugs vs Missing Tests

No confirmed product behavior bug was found in this review pass. All findings above are coverage, fixture reliability, flake, TDD opportunity, or gate-completeness issues. TE-C35-02, TE-C35-03, TE-C35-04, and TE-C35-09 are confirmed test/gate weaknesses; TE-C35-05 through TE-C35-08 are risk/likely gaps where current tests are weaker than the production contract.

## Final Sweep

- Focused-test sweep: no `test.only`, `describe.only`, or `it.only` found.
- Intentional skips: admin e2e can skip locally without credentials but is asserted in CI; CLIP real-model tests skip by default and run only in the separate preflight workflow; no unexpected focused tests found.
- Commonly missed areas checked: CI gate order, source-contract tests, custom scanner fixture tests, Playwright screenshot assertions, admin credential gating, env-gated model tests, migration reconcile tripwires, sidecar scripts, nginx/proxy topology, hydration wait strategy, and browser project matrix.
- Skipped paths: `node_modules`, `.next`, Playwright reports/results, generated screenshots/assets under historical `.context/reviews`, and unrelated dirty review reports from other agents (`code-reviewer.md`, `critic.md`, `perf-reviewer.md`, `verifier.md`). Product source was not modified.
- Validation performed: static review/inventory only. I did not run `npm test`, Playwright, typecheck, build, deploy, live proxy checks, or CLIP preflight.
