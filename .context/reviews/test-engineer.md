# Run-10 Cycle 34 Test-Engineer Review

Role: `test-engineer`
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-08 KST
Review mode: review-only. No production changes, commits, pushes, deploys, or destructive checks.

## Inventory

Required guidance read first: `AGENTS.md`, `CLAUDE.md`, and the local `code-review` skill. The prompt mentioned TDD; no local `tdd` skill exists in this session, so TDD is handled as test-first opportunity review.

Inventoried surfaces:

- 294 tracked behavior/script files under `apps/web/src`, `apps/web/scripts`, and root `scripts` after excluding tests and e2e.
- 372 tracked test specs: 363 Vitest files in `apps/web/src/__tests__` plus 9 Playwright specs in `apps/web/e2e`.
- Blocking gates from `AGENTS.md`/`CLAUDE.md`: lint, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, typecheck, build, Vitest, production audit, and Playwright when browser-flow coverage is required.
- Harness/config files inspected: root and web `package.json`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, route/action lint scanners, nginx template tests, CLIP gated tests, semantic/similar route tests, migration/reconcile tests, sidecar scripts, and prior `.context/reviews/test-engineer.md`.
- Source-contract density check: 243 test files matched source/string-contract patterns (`readFileSync`, `toContain`, `indexOf`, or explicit contract wording). These are useful tripwires, but they are not equivalent to behavioral coverage.

## Confirmed Gaps

### TE-C34-01 - No coverage signal exists, so branch regressions can land behind a high raw test count

- Severity: Medium
- Confidence: High
- File/region: `package.json:17-30`, `apps/web/package.json:8-30`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:54-83`
- Untested failure scenario: a new failure branch in an admin action, image-processing path, route, or sidecar lands with only a source-shape assertion or no executable test. `npm test` still runs 363 Vitest files, but CI has no changed-file coverage or high-risk-directory branch signal to show executable coverage dropped.
- Fix/test recommendation: add a non-blocking `test:coverage` command first, then ratchet thresholds for `src/app/actions`, `src/app/api`, `src/lib`, and `scripts`. Exclude fixture/source-scanner helper files deliberately so adding more string tests does not inflate the metric.

### TE-C34-02 - Semantic scan caps are still source-pinned instead of behavior-pinned

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:1-17`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:52-76`, `apps/web/src/app/api/search/semantic/route.ts:263-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-190`
- Untested failure scenario: a route refactor can keep the string `.limit(SEMANTIC_SCAN_LIMIT)` somewhere in the file while the executed DB chain no longer applies it before scanning embeddings, or applies it to a non-terminal helper. The current test itself documents that the mock-based route tests do not assert the `.limit()` value.
- Fix/test recommendation: TDD a Drizzle-chain mock that records the exact terminal query operations for both semantic and similar routes, then assert `.limit(SEMANTIC_SCAN_LIMIT)` is called on the embedding scan before returning rows. Keep the source tripwire as a cheap secondary guard.

### TE-C34-03 - Nav visual specs produce artifacts but do not compare pixels

- Severity: Medium
- Confidence: High
- File/region: `apps/web/e2e/nav-visual-check.spec.ts:40-86`, `apps/web/playwright.config.ts:63-77`
- Untested failure scenario: a visual regression in mobile/desktop nav spacing, color, z-index, overflow, or expanded-state layout can pass because the spec only checks visibility/touch geometry and writes screenshots to `test-results/*.png`; Playwright never compares them to baselines.
- Fix/test recommendation: convert the stable nav states to `expect(nav).toHaveScreenshot()` or page screenshots with masked dynamic regions. Keep the existing geometry checks because they catch overlap/touch-target defects that pixel diffs may not localize well.

### TE-C34-04 - Production CLIP proof is outside the PR/push quality workflow

- Severity: Medium
- Confidence: High
- File/region: `apps/web/package.json:21-23`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `.github/workflows/quality.yml:69-83`, `.github/workflows/clip-preflight.yml:3-46`
- Untested failure scenario: a PR touching `clip-model.ts`, `download-clip-models.ts`, model-id/manifest logic, or semantic production routing passes the main quality workflow while breaking the seeded offline model load or real semantic ranking. The real-model suites skip unless `CLIP_OFFLINE_LOAD` / `CLIP_INTEGRATION` and seeded weights are present; the dedicated workflow is only manual plus weekly schedule.
- Fix/test recommendation: trigger `clip-preflight.yml` on PR/push path filters for CLIP and semantic production files, or add a required label/check for CLIP-touching changes. Keep the default unit stubs for speed, but make real-model proof impossible to forget when the model path changes.

## Likely Gaps / TDD Opportunities

### TE-C34-05 - Sidecar backfill scripts have high-risk behavior but mostly source/indirect coverage

- Severity: Medium
- Confidence: Medium-High
- File/region: `apps/web/scripts/backfill-alt-text.ts:55-153`, `apps/web/scripts/backfill-cicp-recheck.ts:51-157`, `apps/web/src/__tests__/advisory-lock-release-contract.test.ts:19-33`, `apps/web/src/__tests__/cycle-11-source-contracts.test.ts:24`
- Untested failure scenario: `backfill-alt-text` could regress its `auto_alt_text_enabled`/`--force` gate, lock contention exit, restore-maintenance rechecks, keyset cursor, or nonzero exit on row failures; `backfill-cicp-recheck` could regress the mysql2 tuple unwrap or `queue.onIdle()` drain. Existing references mostly pin strings or sibling contracts, not script behavior.
- Fix/test recommendation: extract pure `runBackfillAltText(deps, options)` and `runCicpRecheck(deps, options)` runners with injected DB/queue/fs/caption/detection dependencies. Add TDD table tests for disabled-vs-force, lock held, restore marker before/after lock, shrinking candidate sets, empty captions, per-row errors, tuple unwrap, and queue drain. Keep CLI wrappers thin.

### TE-C34-06 - Migration reconcile coverage is broad but still not structural

- Severity: Medium
- Confidence: Medium
- File/region: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-122`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-220`
- Untested failure scenario: `migrate.js` can mention a table, column, index, or FK name while emitting the wrong type/default/nullability/index columns/FK target. A fresh or drifted DB can then baseline cleanly with a schema that still diverges from `schema.ts` and migration SQL.
- Fix/test recommendation: add a disposable MySQL structural diff test for `reconcileLegacySchema`: create an empty schema, run reconcile, inspect `information_schema`, and compare table/column/index/FK metadata against Drizzle/migration expectations for high-risk tables first (`images`, `image_embeddings`, `admin_tokens`, analytics tables).

### TE-C34-07 - Hydration test uses `networkidle` as its completion oracle

- Severity: Low-Medium
- Confidence: Medium
- File/region: `apps/web/e2e/hydration-photo-page.spec.ts:20-49`, `apps/web/playwright.config.ts:59-67`
- Untested failure scenario: a hydration warning emitted after the `networkidle` wait, or masked by network timing, can evade the assertion. Conversely, background requests can make `networkidle` slow/flaky even when hydration is complete.
- Fix/test recommendation: add an app-level hydration-ready marker for the photo viewer/info panel or wait for a deterministic post-mount UI state, then collect console/page errors for a bounded interval after that marker. This gives the test a real hydration stop condition instead of a network heuristic.

## Manual-Validation Risks

### TE-C34-08 - Browser matrix is single-project Desktop Chromium

- Severity: Medium
- Confidence: High
- File/region: `apps/web/playwright.config.ts:48-77`, `.github/workflows/quality.yml:75-80`
- Untested failure scenario: mobile Safari/WebKit behavior, Firefox media-query behavior, touch gestures, PWA/service-worker behavior, and responsive visual issues can regress while CI stays green. This is material for this app because CLAUDE.md documents display-gamut/HDR browser differences and the UI has mobile nav/lightbox/share flows.
- Fix/test recommendation: add small smoke projects for mobile Chromium and mobile WebKit first, then a Firefox smoke if display-capability regressions remain a concern. Keep the existing serial/admin budget constraint by tagging or splitting admin specs rather than raising workers globally.

### TE-C34-09 - Public SSR page throttling is config/manual, not app-harness verified

- Severity: Medium
- Confidence: High
- File/region: `apps/web/scripts/check-public-route-rate-limit.ts:1-20`, `apps/web/scripts/check-public-route-rate-limit.ts:986-998`, `apps/web/nginx/default.conf:274-306`, `CLAUDE.md:248`, `CLAUDE.md:514-526`, `scripts/check-proxy-topology.mjs:7-17`
- Untested failure scenario: dynamic public pages (`/`, topic, photo, map, timeline, year, smart collection) are intentionally not app-rate-limited; protection depends on the host nginx `location /` public zone and an operator reload. A typo, stale host config, missing realip setup, or unapplied template change can leave pages unthrottled or overthrottle all visitors behind a load balancer. The topology probe explicitly says it does not prove the effective client-IP bucket.
- Fix/test recommendation: add an nginx syntax/config test using the real nginx binary in CI if available, plus a local container smoke that bursts `/` enough to observe 429 while a normal seeded page load does not. Keep live-host validation as a manual runbook item because deploys do not apply host nginx.

## Final Sweep

- Skipped/generated/vendor paths excluded: `node_modules`, `.next`, Playwright reports/results, `.claude/worktrees`, and historical review screenshots except where prior review context mattered.
- Checked for `test.only` / `describe.only`: none found.
- Checked intentional skips: admin e2e is local/credential-gated but auto-enabled in CI through `E2E_ADMIN_PASSWORD`; CLIP real-model suites are env/weight-gated; no unexpected focused tests found.
- Reviewed whole-repo test-relevant categories rather than sampling: package scripts, CI workflows, Vitest/Playwright configs, custom lint gates, source scanners, route/action guards, semantic search, migration/reconcile, sidecar scripts, nginx/proxy topology, CLIP preflight, visual/hydration specs, and prior test-engineer artifact.
- Validation performed: static review and inventory only. I did not run `npm test`, Playwright, build, typecheck, deploy, or live proxy checks in this review-only lane.
