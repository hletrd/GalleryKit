# Test-Engineer Review - Cycle 19 Prompt 1

Role: test-engineer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `6efd737b3ad5791c662fded4801701992684e54d`
Scope note: read-only test strategy and coverage-gap review. I did not implement fixes, run destructive actions, commit, push, or touch files outside this review.

## Inventory Reviewed

- Guidance and conventions: `AGENTS.md`, `CLAUDE.md` testing/gate/schema sections, root and web `package.json` scripts, `README.md`, `.context/plans/**`, and existing `.context/reviews/**` convention.
- Test inventory: 356 Vitest test files under `apps/web/src/__tests__/**` and 9 Playwright specs under `apps/web/e2e/**`.
- Gate/config inventory: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/scripts/run-e2e-server.mjs`, root deploy/check scripts, custom lint gates, and web package scripts.
- Production-risk surfaces checked against tests: migrations and `scripts/migrate.js`, admin/auth gates, public route rate limits, server actions, PWA/service worker, upload/backfill/CLIP scripts, search/load-more/photo-grid UI, and seeded E2E fixtures.
- Skipped: I did not run the full lint/typecheck/build/test/e2e/deploy gates, live deploy, real CLIP model downloads, or external network/browser matrix. This review is based on source and test inspection.

## Findings

### TEST-C19-01 - `reconcileLegacySchema` is still mostly source/name-presence tested, not structurally verified

- Severity: High
- Confidence: High
- Status: Confirmed coverage gap
- Location: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-101`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:157-170`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:216-224`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:292-297`
- Evidence: The test file explicitly says it is a "SOURCE tripwire" and "cannot verify types or defaults." Current assertions mostly check that table, column, index, and FK names appear somewhere in comment-stripped `scripts/migrate.js`; only one drift case has a narrow regex pin for `images.processed`.
- Failure scenario: A future migration changes a column type, nullability, default, index column order, or FK action in Drizzle SQL and `migrate.js` mentions the right names but applies the wrong DDL. The tripwire passes, while a fresh or legacy-baseline database silently diverges and fails later at runtime.
- Suggested test/fix: Add an integration schema-convergence test that initializes a disposable MySQL database through the reconcile/baseline path, then compares `INFORMATION_SCHEMA` against the current Drizzle/migration schema for tables, columns, types, nullability, defaults, indexes, and FKs. If CI cost is a concern, gate it behind a `test:schema:reconcile` script and require it for migration changes.

### TEST-C19-02 - E2E browser matrix is desktop Chromium only, while mobile/touch behavior is synthetic

- Severity: Medium
- Confidence: High
- Status: Confirmed coverage gap
- Location: `apps/web/playwright.config.ts:72-77`, `apps/web/e2e/swipe-visual-reset.spec.ts:23-49`
- Evidence: The standard Playwright `projects` array contains only `Desktop Chrome`. The swipe regression dispatches constructed `TouchEvent`s in any Chromium context rather than running in a `hasTouch` device context.
- Failure scenario: Mobile Safari/WebKit, real touch dispatch, viewport meta, passive listener, or compositor-specific behavior regresses in photo swipe, lightbox reset, responsive navigation, or admin forms. The current suite stays green because it exercises desktop Chromium plus synthetic events.
- Suggested test/fix: Add at least one mobile/touch Playwright project, such as `Pixel`/`iPhone` device settings with `hasTouch`, for public browsing, photo viewer swipe/zoom/reset, and responsive nav. Keep admin credential flows serialized, but split public mobile tests so they can run without admin rate-limit constraints.

### TEST-C19-03 - Production service-worker/PWA behavior has no real browser install/offline test

- Severity: Medium
- Confidence: High
- Status: Confirmed coverage gap
- Location: `apps/web/src/components/register-service-worker.tsx:13-23`, `apps/web/src/__tests__/sw-template-contract.test.ts:1-16`, `apps/web/src/__tests__/sw-cache.test.ts:1-14`
- Evidence: The service worker only registers in production. Coverage is a combination of reference-unit tests and source contracts over `public/sw.template.js`/`public/sw.js`; there is no Playwright test asserting registration, CacheStorage behavior, or offline navigation under the built production server.
- Failure scenario: `/sw.js` generation, registration scope, cache headers, offline fallback eligibility, or sensitive-route bypass breaks. Unit/source tests can still pass because they do not install the shipped worker in a browser or toggle network offline.
- Suggested test/fix: Add a production Playwright PWA spec that waits for `navigator.serviceWorker.ready`, visits a cacheable public photo/share route, verifies relevant cache entries, switches the browser context offline, and asserts the public route still behaves while admin/share-sensitive routes are not cached improperly.

### TEST-C19-04 - Custom gate scanner logic is well-covered, but CLI discovery/exit wiring is mostly source-pinned

- Severity: Medium
- Confidence: Medium
- Status: Likely risk
- Location: `apps/web/src/__tests__/check-api-auth.test.ts:127-132`, `apps/web/scripts/check-api-auth.ts:30-40`, `apps/web/scripts/check-api-auth.ts:190-207`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:1317-1330`, `apps/web/scripts/check-public-route-rate-limit.ts:119-138`, `apps/web/scripts/check-public-route-rate-limit.ts:986-998`, `apps/web/src/__tests__/check-js-scripts-contract.test.ts:10-19`, `apps/web/scripts/check-js-scripts.mjs:27-45`
- Evidence: The AST-level gate fixtures are extensive, especially for public route rate limits and action-origin scanning. The discovery and CLI failure paths, however, are checked by reading the scanner source and asserting string presence, not by running the CLI against controlled fixture trees and observing exit codes.
- Failure scenario: A path constant, admin/public route filter, supported extension list, zero-file guard, or process-exit branch changes in a way that skips real files. Pure `check*Source` tests still pass, and the source-string test can pass if the expected tokens remain in dead or unreachable code.
- Suggested test/fix: Export injectable discovery helpers or add a fixture-root env override, then spawn `tsx scripts/check-api-auth.ts`, `tsx scripts/check-public-route-rate-limit.ts`, and `node scripts/check-js-scripts.mjs` against temp directories. Assert pass/fail exit codes, stderr, supported extensions, public/admin filtering, and zero-discovery failure.

### TEST-C19-05 - Several high-risk async UI contracts are source-scanned instead of behavior-tested

- Severity: Medium
- Confidence: High
- Status: Confirmed coverage gap
- Location: `apps/web/src/__tests__/load-more-source-contracts.test.ts:5-30`, `apps/web/src/components/load-more.tsx:43-110`, `apps/web/src/__tests__/search-status-source.test.ts:15-69`, `apps/web/src/components/search.tsx:163-280`, `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts:18-34`, `apps/web/src/components/grid-picture-fallback-boundary.tsx:14-27`
- Evidence: The tests assert strings and regexes for retry cooldowns, live-region status, stale search invalidation, abort handling, and delegated image fallback. They do not render the components, click/scroll/type, advance timers, dispatch real image error events, or assert callback/network side effects.
- Failure scenario: `load-more` can keep the right constants but call the server action again during cooldown; search can retain `requestIdRef.current++` but still commit a stale semantic response after `resp.json()`; the grid fallback boundary can contain the right strings but fail to remove `<source>` elements on a real image error.
- Suggested test/fix: Add focused behavior regressions for these contracts: fake timers plus mocked load-more actions for cooldown/status/call-count; a delayed semantic fetch race that verifies stale results never render; and a DOM/browser test that dispatches an image `error` and asserts source removal plus single JPEG fallback.

### TEST-C19-06 - Admin browser coverage is credential-gated and still shallow for high-risk admin workflows

- Severity: Medium
- Confidence: High
- Status: Manual-validation risk
- Location: `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/helpers.ts:28-45`, `apps/web/e2e/admin.spec.ts:20-43`, `apps/web/e2e/admin.spec.ts:73-103`, `apps/web/e2e/admin.spec.ts:105-165`
- Evidence: CI has a sentinel requiring admin credentials, and local runs can auto-enable only with safe plaintext credentials. The actual admin browser flows cover login/navigation, wrong password, GPS toggle display, topic create/delete, and upload. They do not exercise many high-risk admin workflows such as settings persistence beyond one toggle, token revoke/copy flows, backup restore/dump flows, share-link management, semantic search enablement, or destructive confirmation text.
- Failure scenario: A change breaks an authenticated admin workflow while local `npm run test:e2e` skips admin credentials or only hits page-level visibility. Unit/source tests may validate server actions or copy tokens, but the hydrated browser path can still fail.
- Suggested test/fix: Split admin Playwright into small tagged flows and require the relevant tag for touched areas: settings-save, token revoke/copy, backup dump/restore dry run, share-link create/revoke, topic alias delete confirmation, semantic-search setup banner, and upload/delete. Reports should state whether `adminE2EEnabled` was true.

### TEST-C19-07 - Visual E2E captures screenshots but does not compare them

- Severity: Low
- Confidence: High
- Status: Confirmed coverage gap
- Location: `apps/web/e2e/nav-visual-check.spec.ts:40-86`
- Evidence: The spec saves desktop/mobile screenshots and asserts touch target size plus overlap checks, but there are no `toHaveScreenshot` baselines or semantic visual assertions for the captured artifacts.
- Failure scenario: A substantial visual regression in header layout, spacing, icon placement, or mobile expanded navigation can still pass if elements remain visible, non-overlapping, and at least 44 px.
- Suggested test/fix: Either rename the spec/reporting to clarify that screenshots are manual artifacts, or add stable screenshot baselines for the narrow header/nav states where visual appearance is the contract. Keep the existing DOM geometry checks because they catch a different class of accessibility regressions.

## Positive Coverage Notes

- The custom gate source scanners have strong fixture coverage for many AST shapes: admin auth wrapping, action-origin guards, public route rate limiting, comment/string stripping, aliases, re-exports, extension variants, and ordering of limiter calls.
- Migration journal tests cover monotonic `when` values, SQL/journal parity, hash presence, and several pending/drift cases.
- E2E server startup is conservative: local disposable DB checks, seeding, build-before-serve, and serial workers reduce common integration-test hazards.
- Touch target minimums are unit-audited and some Playwright specs additionally check runtime target sizes and overlaps.

## Final Sweep

- Examined file categories: guidance docs, package scripts, Vitest config, Playwright config, all E2E specs, custom lint scripts and their tests, migration SQL/meta/tests, PWA/service-worker tests, representative high-risk UI/source-contract tests, admin E2E helpers, e2e fixtures, and script inventory.
- Skipped categories: generated build output, `node_modules`, live production deploys, external model downloads, full database integration execution, and exhaustive line-by-line review of every one of the 356 unit tests after categorizing recurring source-contract patterns.
