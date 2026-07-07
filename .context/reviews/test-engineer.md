# Test-Engineer Review - Cycle 21

Role: `test-engineer`
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `45b32d1db373e03d82a29511f53832051c770880`
Review time: `2026-07-08`

## Required Reads

Read first, before findings:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`

I also loaded the `code-review` skill surface because this is a review task. The hook-routed `TDD` workflow name does not have a directly available `tdd` skill in this session, so I handled TDD opportunities inside this test-engineer review.

## Inventory

Test-relevant files inventoried before findings:

- Unit/source tests: 357 files under `apps/web/src/__tests__/`.
- E2E tests: `apps/web/e2e/admin.spec.ts`, `focus-restore.spec.ts`, `hydration-photo-page.spec.ts`, `nav-visual-check.spec.ts`, `not-found-status.spec.ts`, `origin-guard.spec.ts`, `public.spec.ts`, `swipe-visual-reset.spec.ts`, `test-fixes.spec.ts`; helpers and fixtures in `apps/web/e2e/helpers.ts` and `apps/web/e2e/fixtures/`.
- Check scripts: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/check-js-scripts.mjs`, and root `scripts/check-proxy-topology.mjs`.
- Package scripts: root `package.json` workspace gates plus `apps/web/package.json` scripts for `lint`, `typecheck`, `test`, `test:e2e`, `test:e2e:admin`, `test:clip:preflight`, and the three lint scanners.
- Test configs and CI: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tsconfig.typecheck.json`, `apps/web/tsconfig.scripts.json`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`.
- High-risk source/test interaction map: `apps/web/src/app/actions/`, `apps/web/src/app/api/`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/image-queue.ts`, `admin-backfill-runner.ts`, `process-image.ts`, `sql-restore-scan.ts`, `migrate.js`, semantic/CLIP routes and libs, service worker template/generated worker, upload browser/PAT paths, public/search/load-more client components, migrations/schema, deploy/nginx/operator scripts.

Unit-test inventory by dominant filename prefix: cycle/source contracts 22; image* 20; admin* 15; process* 14; clip* 10; upload/settings/semantic 9 each; data/auth 7 each; search/restore/photo/og/color 6 each. This confirms the suite is broad but also source-contract-heavy: 219 test files read source text or assert source-string shape somewhere.

Relevant file categories inspected: unit tests, E2E tests, scanner scripts, package/CI scripts, migration/schema tests, backup/restore tests, upload/LR tests, image queue/backfill tests, semantic/CLIP tests, service worker tests, accessibility/touch-target tests, i18n tests, and deferred/carry-forward test-risk registers.

## Findings

### C21-TE-01 - Reconcile schema coverage is still a name-presence tripwire, not a DB-backed schema proof

- Severity: High
- Confidence: High
- Region: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-103`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-180`; implementation in `apps/web/scripts/migrate.js:348-493`
- Current-bug or hardening: broader hardening for a historically production-breaking class; no new migration at this HEAD.
- Evidence: the test explicitly says it is a "SOURCE tripwire" and "cannot verify types or defaults"; the assertions mostly check that table, column, index, and FK names occur in `migrate.js`.
- Failure scenario: a migration changes a type, nullability, default, FK action, index column order, or charset/collation while keeping the same names. The test passes, but a reconcile-baselined legacy/fresh DB diverges from Drizzle and can fail later at upload, restore, analytics, or semantic-search runtime.
- Suggested fix/test: add a disposable-MySQL integration gate that runs the reconcile/baseline path, then diffs `INFORMATION_SCHEMA.COLUMNS`, `STATISTICS`, and FK metadata against the current Drizzle/migration contract. Write the failing drift fixture first, then edit `migrate.js`.

### C21-TE-02 - Backup/restore child-process paths remain source-pinned instead of execution-tested

- Severity: High
- Confidence: Medium
- Region: `apps/web/src/__tests__/db-restore.test.ts:47-136`; implementation in `apps/web/src/app/[locale]/admin/db-actions.ts:157-405` and `apps/web/src/app/[locale]/admin/db-actions.ts:740-860`
- Current-bug or hardening: broader hardening; the current helpers around dump headers/trailers and SQL scanning have unit coverage.
- Evidence: critical guarantees around temp-file finalization, `mysqldump`/`mysql` spawn ordering, cleanup transfer, trailer validation, and maintenance retention are asserted by reading substrings and relative source positions.
- Failure scenario: a refactor preserves the expected strings but breaks runtime stream settlement, `close`/`error` ordering, temp-file cleanup, child timeout cleanup, post-restore migration failure handling, or advisory-lock release. Tests pass because no child process path executes.
- Suggested fix/test: build a stub-binary integration harness with a temp backup dir and `PATH` pointing to fake `mysqldump`/`mysql` scripts. Cover success, nonzero exit, timeout, bad header, truncated trailer, write error, stdin error, post-restore migration failure, and release failure.

### C21-TE-03 - High-risk client behavior still relies on source contracts rather than component behavior tests

- Severity: Medium
- Confidence: High
- Region: `apps/web/src/__tests__/search-stale-response.test.ts:1-35`, `apps/web/src/__tests__/load-more-source-contracts.test.ts:7-30`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`; source in `apps/web/src/components/search.tsx:163-281` and `apps/web/src/components/load-more.tsx:43-111`
- Current-bug or hardening: broader hardening; no live client regression confirmed at this HEAD.
- Evidence: tests assert source text and ordering for stale semantic responses, cooldowns, live-region feedback, and scan-limit wiring. The comments acknowledge the lack of a jsdom/RTL harness.
- Failure scenario: a stale semantic response still overwrites a newer query because closure state changes, a cooldown blocks the wrong branch, observer/click load-more races duplicate requests, or live-region text does not render. The strings can remain present and the tests still pass.
- Suggested fix/test: extract small state-machine helpers or add a focused jsdom/React Testing Library harness. TDD cases: slow semantic response A vs newer response B, abort-on-query-change, 503 setup-required branch after `resp.clone().json()`, load-more transient cooldown, observer plus manual click double-fire, and status live-region rendering.

### C21-TE-04 - Playwright matrix is single-project Desktop Chromium despite browser/touch/PWA-specific code

- Severity: Medium
- Confidence: High
- Region: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:75-80`, `apps/web/src/components/register-service-worker.tsx:13-23`, `apps/web/src/__tests__/sw-template-contract.test.ts:1-16`
- Current-bug or hardening: broader future hardening.
- Evidence: the only Playwright project is `chromium` with `devices['Desktop Chrome']`. Mobile coverage largely uses viewport resizing, and PWA/service-worker behavior is unit/source-tested rather than installed in a browser.
- Failure scenario: Safari/WebKit touch events, iOS viewport behavior, Firefox color/HDR detection, service-worker registration scope, offline cache writes, or admin/share offline-bypass behavior breaks while CI remains green.
- Suggested fix/test: add a small tagged matrix: one mobile WebKit smoke, one mobile Chromium touch smoke, and one production PWA spec that waits for `navigator.serviceWorker.ready`, caches a public page, goes offline, verifies the fallback, and proves admin/share/smart-collection/map routes are not served from the offline HTML cache.

### C21-TE-05 - Nav "visual" E2E checks write screenshots but never compare them

- Severity: Low-Medium
- Confidence: High
- Region: `apps/web/e2e/nav-visual-check.spec.ts:40-86`
- Current-bug or hardening: broader hardening.
- Evidence: the spec checks visibility, touch-target size, and overlap, then writes PNGs to `test-results/nav-*.png` with `page.screenshot(...)`. There is no `toHaveScreenshot` or baseline comparison.
- Failure scenario: spacing, icon alignment, density, color contrast, or responsive hierarchy regresses. The test still passes as long as targets remain visible, >=44 px, and non-overlapping; the generated PNG is only a manual artifact.
- Suggested fix/test: either rename this as a manual screenshot-capture spec, or add stable `expect(page).toHaveScreenshot(...)` baselines for collapsed mobile, expanded mobile, and desktop nav states with seeded data and deterministic theme.

### C21-TE-06 - Hydration E2E uses `networkidle`, which is a flakiness trigger as background work grows

- Severity: Low-Medium
- Confidence: Medium
- Region: `apps/web/e2e/hydration-photo-page.spec.ts:20-49`
- Current-bug or hardening: flakiness hardening; no failure reproduced during this review.
- Evidence: after navigating to a photo, the spec waits for `page.waitForLoadState('networkidle')` to "give hydration a beat".
- Failure scenario: service-worker registration, analytics, image probes, slow network, or future background requests keep the page from reaching Playwright's idle heuristic within timeout. The test then fails for runner timing rather than a hydration regression.
- Suggested fix/test: replace `networkidle` with an app-specific readiness condition: wait for the photo viewer root and pinned/info control, then poll a short deterministic microtask/RAF boundary or a test-only hydration sentinel. Keep console-error collection unchanged.

### C21-TE-07 - Root operator check script is outside the JS-script syntax gate and CI quality path

- Severity: Low
- Confidence: High
- Region: `scripts/check-proxy-topology.mjs:1-131`, `apps/web/scripts/check-js-scripts.mjs:6-9`, `package.json:28`, `.github/workflows/quality.yml:54-83`
- Current-bug or hardening: broader hardening for operator validation.
- Evidence: `check-js-scripts.mjs` scans only `apps/web/scripts`; root `scripts/check-proxy-topology.mjs` is exposed as `npm run check:proxy-topology` but is not syntax-checked by `typecheck:scripts` and is not run in the CI quality workflow.
- Failure scenario: a syntax error or argument-parsing regression in the proxy topology checker ships unnoticed. The operator reaches for the documented command during a proxy incident and the checker itself fails before proving anything.
- Suggested fix/test: extend `check-js-scripts.mjs` or add a root-level syntax check for `scripts/*.mjs`, plus a tiny fixture test for `--help`, missing `--url`, malformed URL, and mocked `fetch` classification.

## Existing Strengths

- The suite is broad and security-aware: admin API auth, action origin/barrier, public route rate limits, privacy-field guards, touch targets, i18n key parity, migration journal monotonicity, upload tracker, image queue, backfill, CLIP limits, SQL restore scanning, and service-worker cache logic all have focused tests.
- The E2E runner uses a disposable-DB guard in `run-e2e-server.mjs` and serializes Playwright workers to avoid login/share-rate-limit flakiness.
- Several old source-only risks have been converted to behavior tests, notably restore drain checklist, LR upload route behavior, smart collection pagination, upload path resolution, and SQL restore scanner helpers.

## TDD Opportunities

- Before the next migration/schema change: write the failing DB-backed reconcile diff first.
- Before the next backup/restore change: write a stub-child failing branch first.
- Before changing search/load-more UI behavior: add executable stale-response/cooldown tests first.
- Before changing service-worker logic: add a browser install/offline spec first.
- Before broad admin UI work: split admin Playwright into workflow tags for settings save, token revoke, backup download, restore rejection, share create/revoke, image deletion, and semantic status banners.

## Final Sweep

No `test.only` was found. Intentional skips/opt-ins remain:

- `apps/web/e2e/admin.spec.ts:6-12` and `apps/web/e2e/origin-guard.spec.ts:28-58` gate credentialed/admin checks.
- `apps/web/src/__tests__/clip-offline-load.test.ts:41` and `apps/web/src/__tests__/clip-semantic-integration.test.ts:31` skip without seeded CLIP/integration env.

Relevant file categories I could not dynamically inspect: live production nginx/proxy behavior, real deployed CLIP weights, actual browser coverage outside Chromium, and numeric line/branch coverage percentages because the repository has no coverage collection gate configured. I did not run the full gate suite; this was a read-only repository-wide inspection plus this report write.
