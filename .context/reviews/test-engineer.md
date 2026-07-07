# Test-Engineer Review - Cycle 20

Role: test-engineer  
Repo: `/Users/hletrd/flash-shared/gallery`  
HEAD reviewed: `ae54e6c22ece7dfb4cb9b4402699c7a41e5d511e`  
Review time: `2026-07-08T05:59:14+09:00`

Scope note: source/test strategy review only. I read `AGENTS.md` and `CLAUDE.md`, inventoried the test/gate surface, and did not modify application source. Existing modified files observed before review: `.context/reviews/perf-reviewer.md`, `.context/reviews/verifier.md`.

## Inventory Reviewed

- Test surface: 357 Vitest test files under `apps/web/src/__tests__/` and 9 Playwright specs under `apps/web/e2e/`.
- Operational/gate surface: root/web `package.json`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, custom lint scripts, migration scripts, deploy scripts, Docker/compose/nginx templates.
- High-risk domains checked: auth/security lint gates, migrations/reconcile, backup/restore, upload queue/backfill races, service worker/PWA, CLIP/search, i18n, UI/accessibility, E2E browser coverage, deploy script contracts.
- I did not run the full gates, deploy, real CLIP model download, live browser matrix beyond source inspection, or destructive DB restore flows.

## Findings

### TEST-C20-01 - Legacy schema reconcile can still pass with structurally wrong DDL

- Severity: High
- Confidence: High
- Location: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-101`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-180`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:292-297`; implementation region `apps/web/scripts/migrate.js:348-493`
- Failure scenario: A migration changes a column type, nullability, default, index column order, or FK behavior, and `reconcileLegacySchema` still mentions the right table/column/index names. The current source tripwire passes, but a legacy/baselined DB converges to a schema that differs from Drizzle and later fails at runtime.
- Concrete test/fix: Add a disposable MySQL integration gate for the reconcile/baseline path. After `reconcileLegacySchema`, diff `INFORMATION_SCHEMA` for tables, columns, types, nullability, defaults, indexes, and FKs against the current schema/migration contract.

### TEST-C20-02 - Backup/restore is mostly source-pinned, not exercised as a child-process workflow

- Severity: High
- Confidence: Medium
- Location: `apps/web/src/__tests__/db-restore.test.ts:47-75`, `apps/web/src/__tests__/db-restore.test.ts:77-136`, `apps/web/src/__tests__/restore-upload-lock.test.ts:7-20`, `apps/web/src/__tests__/restore-upload-lock.test.ts:48-59`; implementation regions `apps/web/src/app/[locale]/admin/db-actions.ts:137-385`, `apps/web/src/app/[locale]/admin/db-actions.ts:400-620`
- Failure scenario: A change breaks `mysqldump`/`mysql` spawn env, stream completion, watchdog cleanup, temp-file handoff, lock release, post-restore migration failure handling, or durable maintenance marker behavior. Many tests can stay green because they assert source substrings and ordering, not a spawned process with observable files/locks/results.
- Concrete test/fix: Add an integration harness with temp backup dirs, disposable DB state, and stub `mysqldump`/`mysql` binaries injected through `PATH`. Cover success, nonzero exit, timeout, truncated trailer, bad header, post-restore migration failure, and lock-release failure. Keep the source contracts as cheap tripwires, but make the spawned workflow executable.

### TEST-C20-03 - High-risk client behavior is over-represented by source contracts

- Severity: Medium
- Confidence: High
- Location: `apps/web/vitest.config.ts:13-38` (node-style test config, no jsdom setup), `apps/web/src/__tests__/search-stale-response.test.ts:1-11`, `apps/web/src/__tests__/search-status-source.test.ts:15-70`, `apps/web/src/components/search.tsx:163-280`, `apps/web/src/__tests__/load-more-source-contracts.test.ts:5-30`, `apps/web/src/components/load-more.tsx:43-110`
- Failure scenario: Search can keep `requestIdRef.current` strings but still commit stale semantic results after a slow `resp.json()`, or load-more can keep cooldown constants but still double-call under observer/click races. Source tests pass when strings remain in dead code, moved code, or code with incorrect closure/runtime behavior.
- Concrete test/fix: Add a small jsdom/RTL or Playwright component-behavior lane for search and pagination. Test delayed semantic fetch A vs fresher B, abort-on-query-change, live region updates, cooldown call counts with fake timers, and image fallback error events.

### TEST-C20-04 - Browser E2E is Chromium-only and real mobile/touch remains unproven

- Severity: Medium
- Confidence: High
- Location: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:75-80`, `apps/web/e2e/swipe-visual-reset.spec.ts:23-27`
- Failure scenario: Mobile Safari/WebKit, real touch input, viewport behavior, passive listener differences, and browser-specific rendering regressions break photo navigation, lightbox gestures, nav, or forms. The suite still passes because CI installs/runs only Chromium and the swipe test constructs synthetic `TouchEvent`s in a desktop Chromium context.
- Concrete test/fix: Add at least one mobile/touch project, preferably WebKit iPhone plus Chromium mobile smoke. Run public gallery, photo viewer swipe/zoom/reset, nav, and search. Keep admin flows serialized in Chromium unless separate seeded accounts are added.

### TEST-C20-05 - Service worker/PWA has no production browser install/offline test

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/components/register-service-worker.tsx:13-23`, `apps/web/src/__tests__/sw-template-contract.test.ts:1-16`, `apps/web/src/__tests__/sw-template-contract.test.ts:59-168`, `apps/web/src/__tests__/sw-cache.test.ts:1-14`
- Failure scenario: `/sw.js` registration scope, generated worker freshness, CacheStorage writes, offline HTML fallback, or sensitive-route bypass breaks in a real browser. Unit/source tests still pass because they execute reference helpers and template slices, not an installed service worker under offline network conditions.
- Concrete test/fix: Add a production Playwright PWA spec against the standalone server: wait for `navigator.serviceWorker.ready`, visit a cacheable public route, inspect cache keys, set context offline, verify public fallback, and assert admin/share/smart-collection/map routes are not cached as offline fallbacks.

### TEST-C20-06 - i18n checks key parity, but not placeholder/argument parity

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/__tests__/i18n-key-parity.test.ts:16-20`, `apps/web/src/__tests__/i18n-key-parity.test.ts:139-158`; example message regions `apps/web/messages/en.json:156-177`, `apps/web/messages/ko.json:156-177`, `apps/web/messages/en.json:892-896`, `apps/web/messages/ko.json:943-947`
- Failure scenario: A locale keeps the same key but drops or adds `{file}`, `{label}`, `{count}`, `{error}`, etc. Key parity passes. Users either lose critical context in one language or hit runtime formatting errors when a new placeholder is not supplied by callers.
- Concrete test/fix: Add a placeholder extractor for every leaf string and compare argument-name sets per key, allowing English ICU plural syntax and Korean fixed-count wording while still requiring the same argument identifiers. Add a runtime smoke that formats representative server/client namespaces with dummy values.

### TEST-C20-07 - Real CLIP production proof is not PR-blocking for CLIP/search changes

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-42`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-32`, `.github/workflows/clip-preflight.yml:3-6`, `.github/workflows/quality.yml:69-83`
- Failure scenario: A PR changes `clip-model`, model path resolution, download/backfill scripts, package versions, or production semantic ranking. Normal PR quality can pass because the real-weight suites skip by default; the scheduled/manual CLIP workflow may catch it only later.
- Concrete test/fix: Trigger the CLIP preflight workflow on PRs touching `clip-*`, semantic search routes, download/backfill scripts, `package-lock.json`, or Docker/runtime model paths. If cost is too high for every PR, require a label/manual check before merging those path changes.

### TEST-C20-08 - Admin browser coverage is enabled in CI but shallow for high-risk workflows

- Severity: Medium
- Confidence: High
- Location: `apps/web/e2e/helpers.ts:28-45`, `apps/web/e2e/admin.spec.ts:20-43`, `apps/web/e2e/admin.spec.ts:73-103`, `apps/web/e2e/admin.spec.ts:105-165`
- Failure scenario: Token revoke/copy, backup download/restore UI, share-link management, semantic-search banners, settings persistence beyond the GPS toggle, and destructive confirmation flows can break in hydrated browser code while unit/source action tests stay green.
- Concrete test/fix: Split admin E2E into tagged, low-cost workflows: settings save, token create/copy/revoke, backup dump/download, restore dry-run rejection, share create/revoke, image delete confirmation, and semantic setup banner. Require the tag when touching the relevant area.

### TEST-C20-09 - Visual screenshots are manual artifacts, not regression assertions

- Severity: Low
- Confidence: High
- Location: `apps/web/e2e/nav-visual-check.spec.ts:40-86`
- Failure scenario: Header/nav spacing, icon placement, density, or visual hierarchy regresses. The spec passes as long as controls are visible, 44px, and non-overlapping; saved screenshots are not compared.
- Concrete test/fix: Either rename/report these as manual screenshot captures, or add stable `toHaveScreenshot` baselines for the nav states. Keep the geometry checks because they catch accessibility/touch-target regressions.

## Positive Coverage Notes

- Security lint gates are strong and fixture-heavy: admin API auth, server-action origin/barrier checks, and public route rate-limit detection all have many AST-shape tests.
- Migration journal tests cover monotonic `when`, hash postconditions, pending-vs-drift split, mixed batches, DML-baseline refusal, and null-cursor legacy behavior.
- Queue/backfill coverage is broad around retries, permanent failure state, deleted-mid-reencode cleanup, lock naming, batching, detection failures, quiescence, and concurrency caps.
- E2E runs a production build through the standalone server before Playwright, and CI seeds admin credentials so the admin describe is not silently skipped there.
- Deploy env-permission failures are exercised with subprocess tests and stubbed commands, not only source-string checks.

## Final Missed-Issues Sweep

- Rechecked skipped/opt-in tests, source-contract density, E2E browser matrix, CLIP workflow triggers, service-worker registration, i18n parity, backup/restore source contracts, migration reconcile coverage, deploy script tests, and CI gate ordering.
- No `test.only`/focused tests found in reviewed output.
- Main residual risk is test strategy shape, not absence of tests: the repo has extensive coverage, but several high-impact paths rely on source contracts where executable integration or browser behavior would provide stronger failure signals.
