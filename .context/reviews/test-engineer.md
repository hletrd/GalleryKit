# Test Engineer Review — review-plan-fix cycle 1 prompt 1

## Scope And Inventory

Review scope: repository-wide test coverage, brittle/flaky tests, missing regression tests, TDD opportunities, and whether tests lock documented behavior. This was a read-only review except for this report file.

Inventory reviewed:
- Project rules and behavior docs: `AGENTS.md`, `CLAUDE.md`, `.github/workflows/quality.yml`, root `package.json`, `apps/web/package.json`.
- Test config and runners: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/scripts/run-e2e-server.mjs`, `apps/web/scripts/seed-e2e.ts`.
- Test suites: 245 Vitest test files under `apps/web/src/__tests__/`; 5 Playwright specs plus helpers/fixtures under `apps/web/e2e/`.
- Source surface: 473 non-test TS/TSX files under `apps/web/src` (app routes/actions, components, lib, db, proxy/instrumentation/i18n), plus scripts and Drizzle migrations where they interact with tests.
- Search/audit commands used included `rg --files`, `rg -n` for skips/TODOs/timers/snapshot assertions/routes, and line-numbered reads of every file cited below.

## Findings

### TE-01 — Documented public route rate-limit lint gate is not run by CI/root scripts

Severity: High  
Confidence: High  
Status: Confirmed

Evidence:
- [AGENTS.md](/Users/hletrd/flash-shared/gallery/AGENTS.md:29) lists all blocking quality gates; [AGENTS.md](/Users/hletrd/flash-shared/gallery/AGENTS.md:34) explicitly includes `npm run lint:public-route-rate-limit --workspace=apps/web`.
- [CLAUDE.md](/Users/hletrd/flash-shared/gallery/CLAUDE.md:579) says four lint scripts are blocking in CI; [CLAUDE.md](/Users/hletrd/flash-shared/gallery/CLAUDE.md:590) documents the public-route rate-limit scanner.
- [apps/web/package.json](/Users/hletrd/flash-shared/gallery/apps/web/package.json:24) defines `lint:public-route-rate-limit`, but root [package.json](/Users/hletrd/flash-shared/gallery/package.json:19) only forwards `lint:api-auth` and [package.json](/Users/hletrd/flash-shared/gallery/package.json:20) only forwards `lint:action-origin`.
- CI's "Security lint gates" step runs only `npm run lint:api-auth` and `npm run lint:action-origin` in [.github/workflows/quality.yml](/Users/hletrd/flash-shared/gallery/.github/workflows/quality.yml:60).

Failure scenario: a new anonymous public mutating route can omit `preIncrement*`/`checkAndIncrement*` and still pass `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and CI. This directly contradicts the documented security gate and leaves DoS-sensitive public mutation endpoints dependent on reviewer memory.

Concrete fix/test: add root `"lint:public-route-rate-limit": "npm run lint:public-route-rate-limit --workspace=apps/web"` and run it in `.github/workflows/quality.yml` next to the other security lint gates. Add a small CI-script/source test that asserts every documented blocking lint command in `AGENTS.md` has a root script and a CI invocation, or collapse the gates behind one `npm run lint:security` command used by both CI and docs.

### TE-02 — Valid single-photo share-link 200-path e2e is intentionally skipped

Severity: Medium  
Confidence: High  
Status: Confirmed

Evidence:
- [apps/web/e2e/public.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/public.spec.ts:125) declares a valid `/s/[key]` Playwright test, but [apps/web/e2e/public.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/public.spec.ts:131) documents that the 200-path has no e2e coverage until a share key is seeded.
- The test skips unless `E2E_SHARE_KEY` is present at [apps/web/e2e/public.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/public.spec.ts:136) and [apps/web/e2e/public.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/public.spec.ts:137).
- The seed script creates per-image `share_key` values at [apps/web/scripts/seed-e2e.ts](/Users/hletrd/flash-shared/gallery/apps/web/scripts/seed-e2e.ts:230), but they are random and never exported for Playwright. The same seed script does seed a deterministic shared group key at [apps/web/scripts/seed-e2e.ts](/Users/hletrd/flash-shared/gallery/apps/web/scripts/seed-e2e.ts:250).

Failure scenario: a regression that breaks valid `/s/[key]` rendering, navigation, metadata, or auth/privacy behavior can pass e2e as long as unknown-key 404s still work. This is exactly the kind of route-level integration gap e2e should catch because the page combines DB data, routing, localized not-found handling, and public rendering.

Concrete fix/test: make the seed deterministic for one photo share key, for example set the first seeded image to a fixed key and export/use `E2E_SHARE_KEY`, or have Playwright query the seeded key from the DB through `helpers.ts`. Remove the skip and assert a valid heading, image, canonical route context, and absence of Next error.

### TE-03 — Vitest discovery silently ignores future `.test.tsx` tests

Severity: Medium  
Confidence: High  
Status: Risk confirmed by config

Evidence:
- [apps/web/vitest.config.ts](/Users/hletrd/flash-shared/gallery/apps/web/vitest.config.ts:17) includes only `src/__tests__/**/*.test.ts`.
- There are currently zero `.test.tsx` files, while the source tree contains substantial TSX UI code under `components/` and `app/`.
- Component behavior is often locked through source-contract tests instead of render tests; for example [apps/web/src/__tests__/search-stale-response.test.ts](/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/search-stale-response.test.ts:8) says the suite has no jsdom render harness.

Failure scenario: a contributor doing TDD for a React component adds `foo.test.tsx`; `tsc` may typecheck it, but `npm test --workspace=apps/web` will not execute it. A red test can be committed as a false green if no reviewer notices the extension mismatch.

Concrete fix/test: change Vitest include to `src/__tests__/**/*.test.{ts,tsx}` and add a self-test or config assertion that fails if the include glob drops `.tsx`. If the project still wants source-only component contracts, document that policy and add a lint/check that rejects `.test.tsx` with a clear message instead of silently ignoring it.

### TE-04 — Navigation "visual checks" take screenshots but never compare them

Severity: Medium  
Confidence: High  
Status: Confirmed

Evidence:
- [apps/web/e2e/nav-visual-check.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/nav-visual-check.spec.ts:14), [apps/web/e2e/nav-visual-check.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/nav-visual-check.spec.ts:27), and [apps/web/e2e/nav-visual-check.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/nav-visual-check.spec.ts:39) call `page.screenshot(...)`.
- Repository search found no `toHaveScreenshot` or `toMatchSnapshot` use in `apps/web/e2e` or `apps/web/src/__tests__`.

Failure scenario: a nav layout regression, overlap, theme contrast issue, or responsive spacing break still passes because the test only emits PNG artifacts to `test-results/`; Playwright does not fail on visual difference without a snapshot assertion or explicit pixel/DOM assertion.

Concrete fix/test: convert these to `await expect(nav).toHaveScreenshot(...)` with committed baselines and stable masking, or rename them to smoke/artifact capture and add real DOM assertions for the visual contract that matters: no overlap, expected bounding boxes, control visibility, and minimum tap target dimensions at mobile/desktop widths.

### TE-05 — High-value client interaction regressions are locked by source regex, not behavior

Severity: Medium  
Confidence: Medium  
Status: Likely coverage gap

Evidence:
- [apps/web/src/__tests__/search-stale-response.test.ts](/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/search-stale-response.test.ts:8) explicitly states client-component behavior is locked with source contracts because there is no jsdom render harness. The assertion checks string ordering around `await resp.json()` and `setResults` at [apps/web/src/__tests__/search-stale-response.test.ts](/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/search-stale-response.test.ts:19).
- [apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts](/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts:15) is also a fixture-style source scan; [apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts](/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts:19) says driving the full dropzone through jsdom is brittle.
- The production code paths are actual async user interactions: search commits results in [apps/web/src/components/search.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/search.tsx:191) through [apps/web/src/components/search.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/search.tsx:210), and upload topic selection flows through [apps/web/src/components/upload-dropzone.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/upload-dropzone.tsx:219).

Failure scenario: a refactor can preserve the regex shape while breaking runtime behavior, or improve behavior while causing a brittle source test failure. More importantly, stale-response suppression, focus, selected topic, and upload form data are user-visible asynchronous contracts that should fail from behavior, not implementation spelling.

Concrete fix/test: add a minimal browser/component test harness for these two contracts. For search, mock semantic fetch responses so request A resolves JSON after request B and assert only B is rendered. For upload, use Playwright or a lightweight component harness with two queued files, change `#upload-topic` between sends, and assert the second request's `FormData` uses the new topic. Keep the source contracts only as secondary guardrails if they still add value.

### TE-06 — Admin e2e coverage is opt-in locally and only enforced indirectly in CI

Severity: Low  
Confidence: High  
Status: Confirmed risk

Evidence:
- [apps/web/e2e/admin.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/admin.spec.ts:11) wraps admin workflows in an opt-in describe, and [apps/web/e2e/admin.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/admin.spec.ts:12) skips unless `adminE2EEnabled`.
- `adminE2EEnabled` auto-enables only under specific local credential conditions in [apps/web/e2e/helpers.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/helpers.ts:28) through [apps/web/e2e/helpers.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/helpers.ts:45).
- CI sets credentials in [.github/workflows/quality.yml](/Users/hletrd/flash-shared/gallery/.github/workflows/quality.yml:35) through [.github/workflows/quality.yml](/Users/hletrd/flash-shared/gallery/.github/workflows/quality.yml:37), and the guard test at [apps/web/e2e/admin.spec.ts](/Users/hletrd/flash-shared/gallery/apps/web/e2e/admin.spec.ts:6) fails CI if admin coverage is missing. This keeps CI protected but still leaves local `npm run test:e2e` as a partial e2e run when credentials are absent or hashed.

Failure scenario: a developer can run `npm run test:e2e`, see green, and believe admin upload/settings/navigation paths were exercised when they were skipped. That is especially risky because admin e2e contains prior regression coverage for topic creation and upload workflow.

Concrete fix/test: emit a clear Playwright annotation/summary when admin coverage is skipped locally, or split scripts into `test:e2e:public` and `test:e2e:all` where the all script fails if admin credentials are unavailable. Keep the current CI guard.

## Positive Coverage Notes

- The project has unusually broad unit/source coverage: 245 Vitest files against 473 non-test TS/TSX source files, with focused tests around image processing, privacy guards, migrations, auth/session, rate limits, semantic search, uploads, color/HDR, and source-level architectural invariants.
- CI does run lint, typecheck, unit tests, e2e tests, and build in [.github/workflows/quality.yml](/Users/hletrd/flash-shared/gallery/.github/workflows/quality.yml:54) through [.github/workflows/quality.yml](/Users/hletrd/flash-shared/gallery/.github/workflows/quality.yml:79). The gap in TE-01 is specific to the missing third security lint command.
- The e2e runner seeds a real DB and builds the standalone app before Playwright via [apps/web/scripts/run-e2e-server.mjs](/Users/hletrd/flash-shared/gallery/apps/web/scripts/run-e2e-server.mjs:75) through [apps/web/scripts/run-e2e-server.mjs](/Users/hletrd/flash-shared/gallery/apps/web/scripts/run-e2e-server.mjs:89), which is stronger than a dev-server-only smoke.

## Final Sweep

Common missed test issue classes checked:
- Skipped tests: found intentional CLIP/model skips and e2e skips; actionable e2e skip is TE-02, local-admin skip risk is TE-06.
- `.only`/`.todo`: no committed focused test was found in the reviewed test tree.
- Timer/flaky patterns: several tests use fake timers or `vi.waitFor`; existing comments show prior cleanup from wall-clock sleeps. No new high-confidence flake beyond opt-in/skipped e2e coverage.
- Snapshot/visual tests: no real screenshot comparisons found; TE-04 covers the misleading screenshot-only visual checks.
- Route/auth/rate-limit gates: admin API and action-origin scanners have fixture tests and CI entries; public-route rate-limit scanner has fixture tests but is missing from root/CI execution (TE-01).
- Docs-vs-tests drift: main drift found in blocking-gate docs versus CI/root scripts, and `/s/[key]` e2e TODO versus current seed data.
- Type/test discovery: `tsconfig.typecheck.json` includes tests, but Vitest discovery excludes `.test.tsx` (TE-03).

Skipped/irrelevant areas:
- Did not run the full test suite; this prompt requested a review report only and source edits were prohibited.
- Did not review binary fixture contents beyond file type/usage.
- Did not inspect generated `.next`, `node_modules`, or gitignored runtime data.
