# Cycle 28 Test-Engineer Review

Role: test-engineer
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `e08e6a34`
Date: 2026-06-30

## Inventory First

I reviewed the project instructions and all test-relevant surfaces, not a sampled subset.

- Project instructions and test policy: `AGENTS.md`, `CLAUDE.md`.
- Current and prior review context: `.context/reviews/test-engineer.md`, `.context/reviews/run9-cycle8/test-engineer.md`, `.context/plans/archive/74-deferred-cycle28.md`.
- CI and command gates: `.github/workflows/quality.yml`, `package.json`, `apps/web/package.json`.
- Test configuration: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tsconfig.typecheck.json`, `apps/web/tsconfig.scripts.json`.
- Custom gate scripts and fixtures: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/__tests__/check-api-auth.test.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`.
- E2E harness: all 5 specs in `apps/web/e2e/` plus `apps/web/e2e/helpers.ts`, `apps/web/scripts/run-e2e-server.mjs`, `apps/web/scripts/seed-e2e.ts`, and `apps/web/src/__tests__/seed-e2e-safety.test.ts`.
- Unit suite: all 272 Vitest files under `apps/web/src/__tests__/**/*.test.{ts,tsx}` were inventoried and searched for skips, weak assertions, source-contract tests, gate tests, and route/action coverage.
- App source under test: all 238 non-test `apps/web/src/**/*.{ts,tsx}` files were inventoried, including all 77 `src/app` route/action/page files, 98 `src/lib` files, 58 component files, DB schema, proxy, instrumentation, and site config.
- Scripts and deploy/test support: all 29 files under `apps/web/scripts/` plus `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, and migration files under `apps/web/drizzle/`.

Mechanical inventory counts from `rg --files`:

- 808 tracked files total.
- 512 `apps/web/src` TS/TSX files.
- 272 Vitest test files.
- 5 Playwright specs.
- 29 app scripts.
- 77 app route/page/action files.
- 98 lib files.
- 58 component files.

Validation run during review:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web` passed: 270 files passed, 2 skipped; 2528 tests passed, 4 skipped.

I did not run `npm run test:e2e` because the Playwright web server path runs `scripts/seed-e2e.ts`, which deletes/recreates E2E rows and upload files in the configured database/filesystem. For this prompt-1 review, I inspected all e2e files and the CI e2e wiring statically instead.

## Findings

### C28-TE-01 - Semantic search ranking invariant is source-locked, not behavior-locked

Severity: Medium
Confidence: High
Status: Confirmed test-quality gap

Evidence:

- The live branch is behaviorally important in `apps/web/src/app/api/search/semantic/route.ts:296-301`: production uses `dotProduct`, while stub mode must use `cosineSimilarity` because stub embeddings are not normalized.
- The current behavior test uses one uniform vector row and an identical uniform query vector in `apps/web/src/__tests__/semantic-search-route.test.ts:326-397`. That proves the happy path returns an enriched result, but it does not distinguish dot product from cosine ranking.
- The source-contract test explicitly documents the gap in `apps/web/src/__tests__/semantic-similarity-selector-contract.test.ts:17-22`, then pins only source text with regex assertions at `apps/web/src/__tests__/semantic-similarity-selector-contract.test.ts:47-63`.

Problem:

The suite knows this is a ranking invariant but proves it by matching implementation text. A refactor that preserves the regex shape while changing the actual function used, moving similarity selection behind a helper, or accidentally normalizing only some stub vectors can still break ranking semantics without a behavior-level failure.

Concrete failure scenario:

A contributor extracts `const similarity = pickSimilarity(isProd)` and leaves the old comment or a dead compatibility line in the route. The source regex can still pass if the text remains nearby, while stub-mode search ranks by vector magnitude instead of angle and returns the wrong photo order.

Suggested fix:

Add a behavior test in `semantic-search-route.test.ts` with two deliberately non-normalized candidate embeddings where dot product and cosine produce opposite order. Run it in stub mode and assert the cosine winner is first. Keep the source-contract test only as a secondary guard for the documented production fast path.

### C28-TE-02 - Default CI skips the real CLIP offline load and semantic ranking proof

Severity: Medium
Confidence: High
Status: Confirmed coverage gap with accepted operational constraint

Evidence:

- `apps/web/src/__tests__/clip-offline-load.test.ts:15-21` says the real offline load proof runs only with `CLIP_OFFLINE_LOAD=1` and a seeded `CLIP_MODELS_ROOT`.
- The test switches to `describe.skip` unless that seeded path exists in `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10` says default CI skips the real semantic-ranking suite, and `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31` implements `describe.skip` unless `CLIP_INTEGRATION=1`.
- The fresh unit run confirmed 4 skipped tests.

Problem:

The production semantic-search activation path depends on seeded local weights, offline `allowRemoteModels=false` loading, ONNX runtime compatibility, and real multilingual ranking. Default CI proves surrounding contracts, but it does not execute the only tests that use the real encoder.

Concrete failure scenario:

A dependency update or path-layout change breaks `embedTextReal()` offline loading from `CLIP_MODELS_ROOT`. `npm test`, typecheck, build, and the e2e suite can stay green because the real model tests are skipped by default. The failure appears only when an operator seeds weights and enables production semantic search.

Suggested fix:

Add a scheduled or manually triggered CI job with a cached seeded model directory that runs:

`CLIP_OFFLINE_LOAD=1 CLIP_INTEGRATION=1 CLIP_MODELS_ROOT=<cache> npm test --workspace=apps/web -- src/__tests__/clip-offline-load.test.ts src/__tests__/clip-semantic-integration.test.ts`

If model weights are too heavy for every PR, make it a nightly or release-blocking workflow and report its status separately from the normal unit suite.

### C28-TE-03 - Public route rate-limit gate intentionally ignores expensive GET endpoints

Severity: Medium
Confidence: High
Status: Confirmed gate blind spot / future-risk

Evidence:

- `apps/web/scripts/check-public-route-rate-limit.ts:36` defines mutating methods as only `POST`, `PUT`, `PATCH`, and `DELETE`.
- `apps/web/scripts/check-public-route-rate-limit.ts:344-346` passes files with no mutating handlers as OK.
- The gate run reported `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/og/route.tsx`, and `apps/web/src/app/api/search/similar/[id]/route.ts` as "no mutating handlers" even though those GET routes perform CPU, DB, or embedding-scan work.
- Existing GET routes have bespoke tests, for example OG rate-limit behavior in `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:47-74` and similar-route rate-limit behavior in `apps/web/src/__tests__/similar-route.test.ts:236-244`.

Problem:

The current repo has manual tests for known expensive GET endpoints, but the blocking gate does not enforce that pattern for future public GET routes. The script header documents the boundary, but CI still gives a green "OK" for GET-only public API files.

Concrete failure scenario:

A future public `GET /api/export/preview` or image-generation route imports DB/sharp/ImageResponse and ships without a `preIncrement*` limiter. `npm run lint:public-route-rate-limit` passes it as "no mutating handlers"; unless a reviewer notices manually, CI does not require a limiter or an explicit exemption.

Suggested fix:

Add a second public GET audit gate or extend this script with a conservative rule: public API `GET` handlers that import `db`, `ImageResponse`, `sharp`, `getGalleryConfig`, data-layer helpers, or embedding/OG helpers must call an approved pre-increment limiter or carry `@public-no-rate-limit-required: <reason>`. Keep health/live routes exempt explicitly.

### C28-TE-04 - E2E coverage runs only one desktop Chromium project

Severity: Medium
Confidence: High
Status: Risk

Evidence:

- `apps/web/playwright.config.ts:72-77` defines a single project: `chromium` with `Desktop Chrome`.
- The config serializes all e2e tests with `fullyParallel: false` and `workers: 1` in `apps/web/playwright.config.ts:48-59`, which is reasonable for admin rate-limit isolation but means no browser matrix is present.
- The product has browser-specific surfaces around display gamut, HDR, service worker behavior, focus, responsive nav, and photo viewing, but the e2e gate only exercises Chromium.

Problem:

Viewport resizing inside Chromium is not equivalent to WebKit/Safari or mobile browser behavior. The repo has strong unit tests for display capability helpers, but no real-browser e2e smoke for the engine most relevant to P3/HDR photographer delivery.

Concrete failure scenario:

A change to photo viewer picture sources, color hint visibility, dialog focus, or service-worker caching works in Chromium but fails in WebKit. CI remains green because no WebKit project runs, even though Safari/iOS is a first-class target for P3/HDR viewing.

Suggested fix:

Add a small, serialized WebKit project for public smoke coverage only: home page, photo page, lightbox open/close, search dialog focus, and one color-display/hint path with mocked media features where possible. Keep admin flows Chromium-only unless distinct seeded admin accounts are added.

### C28-TE-05 - Nav visual tests save screenshots but do not assert visual baselines

Severity: Low
Confidence: High
Status: Confirmed test-quality gap

Evidence:

- `apps/web/e2e/nav-visual-check.spec.ts:40-79` checks visibility, 44 px target size, and overlap geometry, then writes screenshots at lines 51, 65, and 78.
- The tests do not call `expect(page).toHaveScreenshot(...)` or compare against committed baselines.

Problem:

The tests are named visual checks and create artifacts, but CI only enforces geometry. Color, spacing, icon alignment, unexpected wrapping, theme styling, and other visual regressions can pass unless someone manually opens the screenshots.

Concrete failure scenario:

A nav CSS change keeps all targets 44 px and non-overlapping but clips the theme icon, changes contrast, or shifts the expanded mobile menu into an obviously wrong visual state. The screenshots are produced, but the test still passes.

Suggested fix:

Either convert these to Playwright screenshot assertions with stable masks and thresholds, or rename/document them as artifact-only smoke tests and add a separate visual-review checklist owner.

## TDD Opportunities

- Add the semantic ranking behavior test before touching `semantic-search/route.ts` again. The failing-first fixture should prove cosine and dot product disagree on stub vectors.
- Add a public GET rate-limit fixture to the gate tests before extending `check-public-route-rate-limit.ts`. The fixture should fail for a DB-backed GET without a limiter and pass for `/api/health` with a documented exemption.
- Add a scheduled CLIP real-model job before enabling production semantic search in a new environment. Treat the offline-load tests as release evidence, not optional local confidence.

## Non-Findings

- The previous cycle's sharing-action, image metadata, browser-upload settings, and `updateTag` coverage gaps have been addressed by behavior tests in `sharing-actions.test.ts`, `images-actions.test.ts`, and `tags-actions.test.ts`.
- No `test.only`, `it.only`, or `describe.only` markers were found.
- Every Vitest test file contains at least one `expect(...)`.
- The custom admin API auth and action-origin gates are AST-based, fixture-tested, and passed on the current tree.
- The 2 skipped Vitest files are the expected CLIP real-model suites; they account for the 4 skipped tests in the fresh unit run.

## Final Missed-Issues Sweep

Final sweep commands searched all unit/e2e/script files for `.skip`, `.only`, `waitForTimeout`, `setTimeout`, weak boolean assertions, TODO/FIXME markers, source-contract patterns, route methods, action exports, and mock targets. I also mechanically inventoried all app routes, server actions, source files, unit tests, e2e specs, scripts, and gate configs.

No relevant file category was skipped. No app implementation code was changed. This report is the only file intentionally updated by this test-engineer pass.

## Summary

Finding count: 5

- Medium: 4
- Low: 1
- Confirmed test-quality gaps: 3
- Risks / future gate blind spots: 2
