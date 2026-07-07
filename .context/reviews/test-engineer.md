# Cycle 13 Test-Engineer Review

Scope: deep test coverage and reliability review for missing regression tests, fragile tests, test-only type gaps, Playwright coverage, fixture risk, and TDD opportunities. I inspected `AGENTS.md`, `CLAUDE.md`, test configs, CI workflows, E2E setup/fixtures, and representative test/source pairs across app routes, server actions, client components, scripts, migrations, image/color/HDR, semantic search, and operational helpers. I did not modify source code or plans.

## Inventory

- Test harness: `apps/web/vitest.config.ts:16-39` runs `src/__tests__/**/*.test.{ts,tsx}` with Node-default environment, `.next` excluded, and a 15s timeout; `apps/web/playwright.config.ts:48-87` runs E2E with one serialized Chromium project and a local seeded/build server by default.
- Test count: 348 Vitest test files under `apps/web/src/__tests__`; 9 Playwright specs plus helper/fixtures under `apps/web/e2e`.
- Source-contract density: 213 Vitest files match source-reading/source-contract patterns (`readFileSync`, `SOURCE`, `toContain`, `toMatch`, or fixture-style source scans). These are useful tripwires, but they also create false-green risk where behavior is not executed.
- CI gates: `.github/workflows/quality.yml:54-83` runs lint, typecheck, custom auth/origin/rate-limit scanners, production dependency audit, Vitest, DB init, Chromium E2E, and build. `.github/workflows/clip-preflight.yml:1-46` separately runs scheduled/manual real CLIP preflight.
- E2E data setup: `apps/web/scripts/run-e2e-server.mjs:91-101` guards DB safety, initializes, seeds, and builds before serving; `apps/web/scripts/seed-e2e.ts:169-183` refuses production/non-disposable DBs unless explicitly opted in.
- Conditional skips/focus: no `.only` found. Skips are admin credential/baseURL guards (`apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/origin-guard.spec.ts:28-77`) and real CLIP env/fixture gates (`apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`).

## Findings

### TE13-01 - Playwright browser/device coverage is too narrow for the UI risk profile

- Severity: Medium
- Confidence: High
- File/region: `apps/web/playwright.config.ts:48-77`, `.github/workflows/quality.yml:75-80`, `apps/web/e2e/nav-visual-check.spec.ts:40-87`, `apps/web/e2e/swipe-visual-reset.spec.ts:23-31`
- Failure scenario: a regression affects iOS/WebKit touch handling, Safari focus/clipboard behavior, Firefox color-gamut/media-query behavior, or mobile viewport layout while desktop Chromium stays green. The suite defines only the Desktop Chrome project, CI installs only Chromium, and the swipe test synthesizes `TouchEvent`s inside a desktop Chromium context instead of using a real touch-capable/mobile project.
- Suggested fix/test: add a small required Playwright matrix rather than duplicating all specs: mobile WebKit for nav/search/photo/lightbox/swipe, plus one Firefox or WebKit desktop smoke. Keep admin specs serialized, but split public mobile smoke into its own project so the login-rate-limit constraint does not block device coverage.
- TDD opportunity: first add a mobile WebKit smoke that opens the mobile nav, search dialog, first photo, and lightbox; make it fail on any missing role/visibility before broadening.

### TE13-02 - Nav “visual” checks write screenshots but do not assert visual diffs

- Severity: Low
- Confidence: High
- File/region: `apps/web/e2e/nav-visual-check.spec.ts:40-87`
- Failure scenario: nav colors, spacing, logo/title alignment, menu panel composition, or visual regressions drift while tests pass because the spec only validates target sizes/non-overlap and writes PNG artifacts with `page.screenshot(...)`. No `toHaveScreenshot(...)` baseline or pixel comparison can fail the gate.
- Suggested fix/test: either convert the three screenshots to Playwright `expect(page).toHaveScreenshot(...)` baselines or rename the spec to “nav layout metrics” and add a true screenshot-diff spec for the visual claim.
- TDD opportunity: add a failing baseline for `mobile nav expanded` first, then update once the expected rendering is confirmed.

### TE13-03 - Admin password-change UI has no browser-level regression test

- Severity: Medium
- Confidence: High
- File/region: `apps/web/e2e/admin.spec.ts:20-43`, `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:36-45`, `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:65-120`, `apps/web/src/__tests__/password-form-a11y.test.ts:10-18`, `apps/web/src/__tests__/auth-actions-behavior.test.ts:241-254`, `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:31-103`
- Failure scenario: the password page renders and navigation passes, but the form can stop calling `formAction(formData)`, input names can drift from the server action, client-side mismatch validation can stop announcing/focusing, pending disable/focus restore can regress, or successful password rotation can break in the real browser path. Existing tests cover source strings, action ordering, and one hostile-origin action branch, but no Playwright test submits the password form.
- Suggested fix/test: add a non-destructive admin E2E for mismatched new/confirm passwords that asserts the inline/summary error and focus behavior without changing credentials. Add an opt-in destructive-safe local test that changes to a generated temporary password, logs in with it, then changes back in `finally`.
- TDD opportunity: start with the mismatch-only E2E because it is reversible and does not mutate stored credentials.

### TE13-04 - Service-worker registration can disappear while SW logic tests stay green

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/components/register-service-worker.tsx:13-25`, `apps/web/src/app/[locale]/layout.tsx:13-14`, `apps/web/src/app/[locale]/layout.tsx:136-152`, `apps/web/src/__tests__/sw-template-contract.test.ts:22-28`
- Failure scenario: a refactor removes `<RegisterServiceWorker />` from the root layout or changes the production-only registration path. The extensive SW template/cache tests still pass because they read `public/sw.template.js`, `scripts/build-sw.ts`, `proxy.ts`, and generated `public/sw.js`, not the runtime registration wiring.
- Suggested fix/test: add a source/SSR contract that the locale root layout imports and renders `RegisterServiceWorker`, plus a small component test or Playwright production-build smoke that stubs `navigator.serviceWorker.register` and asserts `/sw.js` with `{ scope: '/' }` only in production.
- TDD opportunity: write the layout wiring test first; then add the browser registration smoke once a DOM/component harness exists.

### TE13-05 - Client component behavior is over-represented by source-string tests

- Severity: Medium
- Confidence: High
- File/region: `apps/web/vitest.config.ts:16-39`, `apps/web/package.json:72-88`, `apps/web/src/__tests__/use-restore-focus-after-pending.test.ts:5-21`, `apps/web/src/__tests__/search-status-source.test.ts:15-70`, `apps/web/src/__tests__/load-more-source-contracts.test.ts:7-30`, `apps/web/src/__tests__/client-source-contracts.test.ts:172-224`
- Failure scenario: search stale-response handling, load-more retry/backoff/live-region behavior, token creation pending guards, or field-error rendering changes behavior but preserves the asserted source tokens. The project currently has no jsdom/happy-dom/testing-library dependency and the Vitest config does not set a DOM environment, forcing many client tests to inspect strings instead of user-visible state.
- Suggested fix/test: add a small DOM-capable test lane for high-value client islands (`Search`, `LoadMore`, `PasswordForm`, Tokens page interactions). Keep source contracts only for static architecture invariants that are hard to execute cheaply.
- TDD opportunity: start by porting `search-status-source.test.ts` to a behavior test with mocked `searchImagesAction`/`fetch`, fake timers, and assertions that stale slow responses do not render visible status/results.

### TE13-06 - Timeline/year-in-review tests partly reimplement behavior instead of executing it

- Severity: Low
- Confidence: High
- File/region: `apps/web/src/__tests__/data-timeline.test.ts:121-204`, `apps/web/src/lib/data-timeline.ts:195-221`, `apps/web/src/lib/data-timeline.ts:243-267`
- Failure scenario: `getYearInReviewImages()` stops calling `getTimelineImages(year)`, mishandles `truncated`, changes grouping behavior, or sorts sections incorrectly. The tests at `data-timeline.test.ts:121-204` validate inline fake grouping helpers and source snippets, not the exported function with a mocked `getTimelineImages`/DB result.
- Suggested fix/test: refactor the month-grouping logic into a pure exported helper and test it directly, or mock the DB chain so `getYearInReviewImages(year)` executes against controlled rows and asserts `sections` plus `truncated`.
- TDD opportunity: write a failing direct test where `getTimelineImages` returns `{ images: [...], truncated: true }` and assert `getYearInReviewImages` preserves `truncated` and groups by descending month.

### TE13-07 - Test-only request mocks erase route contract types

- Severity: Low
- Confidence: Medium
- File/region: `apps/web/src/__tests__/semantic-search-route.test.ts:83-105`, `apps/web/src/__tests__/semantic-search-route.test.ts:163-168`, `apps/web/src/__tests__/semantic-search-route.test.ts:294-298`, `apps/web/src/app/api/search/semantic/route.ts:107-184`
- Failure scenario: the semantic route starts relying on another `NextRequest` property (`nextUrl`, `cookies`, a real `AbortSignal`, streaming body semantics, etc.) and tests continue compiling because partial object literals are force-cast with `as unknown as NextRequest`. Failures would appear as runtime-only surprises or be missed if the exercised branch never touches the missing property.
- Suggested fix/test: use real `new NextRequest(new Request(...))` objects where possible, and centralize any partial mocks behind typed factories that satisfy the actual route access surface without `unknown` double-casts. Keep one explicit already-aborted factory, but type it as a minimal interface consumed by a helper if `NextRequest` cannot be constructed aborted.
- TDD opportunity: add a typed request factory test that fails if route code accesses a property absent from the factory.

### TE13-08 - Real HEIF/AVIF/HDR fixture gap remains documented but open

- Severity: Medium
- Confidence: High
- File/region: `apps/web/__test_fixtures__/color/README.md:19-39`, `apps/web/__test_fixtures__/color/README.md:61-73`, `apps/web/src/__tests__/color-fixtures.test.ts:1-15`, `apps/web/src/__tests__/gain-map-detection.test.ts:1-12`, `apps/web/src/__tests__/process-image-color-roundtrip.test.ts:11-14`, `apps/web/src/__tests__/process-image-color-roundtrip.test.ts:81-114`
- Failure scenario: hand-crafted ISOBMFF/ICC buffers and Sharp-generated synthetic images cover parser shapes, but a real iPhone HDR HEIC, real CICP-only AVIF, or real 10-bit PQ/HLG HEIF exposes box ordering, auxiliary-image references, decoder metadata, or ICC/CICP interactions not represented by the synthetic fixtures. The docs explicitly list these planned fixtures and explain they are absent.
- Suggested fix/test: add compact real-world metadata fixtures for PQ HEIF, HLG HEIF, Rec.2020 CICP-only AVIF, DCI-P3 TIFF, and iPhone gain-map HEIC. If proprietary pixel data is a concern, keep metadata-only/pixel-stripped fixtures as suggested in the README and assert detection through the public `detectColorSignals` path.
- TDD opportunity: start with a metadata-only `iphone-15-hdr.heic` fixture and a failing `detectColorSignals` test that asserts `hasGainMap === true`, `isHdr === true`, and NCLX precedence over ICC naming.

### TE13-09 - No coverage report, threshold, or changed-file coverage ratchet exists

- Severity: Low
- Confidence: High
- File/region: `apps/web/package.json:13-29`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:54-83`
- Failure scenario: a new public API route, server action, migration reconciliation branch, queue path, or client component lands with no executed tests. The suite can still pass because there is no coverage measurement or changed-file coverage ratchet, and source-contract tests may assert static strings without covering execution.
- Suggested fix/test: add a non-blocking `test:coverage` using Vitest V8 coverage, then introduce a changed-file ratchet for critical directories (`src/app/actions`, `src/app/api`, `src/lib`, `scripts/migrate.js`) before considering broad global thresholds. Require explicit reviewed exemptions for generated/source-contract-only cases.
- TDD opportunity: create a temporary fixture module under a critical directory with no tests and make the ratchet fail before wiring it to CI.

## Positive Coverage Notes

- The migration/journal risk is well guarded: `migration-journal*.test.ts`, `migrate-pending-migrations.test.ts`, and `migrate-reconcile-coverage.test.ts` cover journal monotonicity, pending/drift behavior, DML baseline refusal, and reconcile coverage.
- Security scanners are both implemented and tested: API auth, action origin, and public route rate-limit gates have fixture-based tests and are run in CI.
- E2E seed safety is strong: destructive seed/init requires a disposable DB name or explicit opt-in before DB deletes/file removes.
- CLIP production proof is not absent: it is split into a scheduled/manual workflow with seeded weights, which is appropriate for a heavy model path. The remaining risk is that normal PR quality does not run it.

## Final Sweep

- Missed coverage sweep checked route/action inventory, source-contract density, Playwright projects, skipped tests, E2E seed/build flow, CLIP preflight workflow, SW registration, client-only components, timeline grouping, color/HDR fixtures, and request mocks.
- Flaky-test sweep found no focused tests. Existing reliability controls include serialized Playwright workers for login budgets, `.next` exclusion from Vitest discovery, raised source-scan timeout, deterministic E2E seed data, and guarded destructive seed setup.
- Full gates were not run because this was a review-only task and no application source changed.
