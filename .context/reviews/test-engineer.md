# Test Engineer Review - Cycle 10

Date: 2026-06-29
HEAD inspected: `4fd8bf3b`
Role: cycle 10 test-engineer
Scope: whole-repository test coverage, flakiness, quality-gate, and TDD-opportunity review. No source code or plans were edited.

## Inventory

Required instructions read first: `AGENTS.md` and `CLAUDE.md`.

Review-relevant inventory:

- Gates/config reviewed: `AGENTS.md`, `CLAUDE.md`, root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`, `apps/web/scripts/run-e2e-server.mjs`.
- Test surface inventoried: 255 Vitest files under `apps/web/src/__tests__/` and 5 Playwright specs under `apps/web/e2e/`.
- Source surface inventoried: 556 TypeScript/TSX/JS/MJS/SQL/JSON files under `apps/web/src`, `apps/web/scripts`, `apps/web/e2e`, and `apps/web/drizzle`; 12 route handlers, 20 page files, and 57 component TSX files.
- Areas traced: route/action security scanners, public/admin e2e enablement, semantic search routes, CLIP embedding writers, feed routes, upload route twins, audit logging, migration/reconcile tests, visual/navigation e2e, skipped/gated CLIP integration suites, environment/timer/global-stub flake patterns.

This was a static review of test shape and coverage. I did not run the full Vitest or Playwright suites because no implementation source changed and the requested artifact is a review report.

## Confirmed Issues

### C10-C01 - Playwright "visual" nav checks still generate screenshots without visual assertions

Severity: Medium
Confidence: High
Classification: confirmed generated-artifact blind spot

Exact region:

- `apps/web/e2e/nav-visual-check.spec.ts:40-79` names three tests as screenshot checks.
- `apps/web/e2e/nav-visual-check.spec.ts:51`, `:65`, and `:78` call `page.screenshot({ path: ... })`.
- `apps/web/e2e/nav-visual-check.spec.ts:6-38` asserts only target size and overlap.
- Repository grep found no `toHaveScreenshot` assertion under `apps/web/e2e` or `apps/web/src/__tests__`.
- `apps/web/playwright.config.ts:63-67` keeps failure artifacts, but that is not a baseline comparison.

Failure scenario:

The nav loses expected spacing, theme contrast, menu placement, or breakpoint composition while every visible button remains at least 44 px and non-overlapping. The three tests still pass and overwrite `test-results/*.png`; CI records artifacts but does not fail.

Concrete fix:

Convert the three raw screenshot writes to `await expect(nav).toHaveScreenshot(...)` or `await expect(page).toHaveScreenshot(...)` with committed baselines. If the screenshots are intended only for manual review, move them out of pass/fail e2e specs or rename the tests so they are not treated as visual regression coverage.

### C10-C02 - No coverage reporting or threshold gate exists for critical test surfaces

Severity: Low
Confidence: High
Classification: confirmed quality-gate blind spot

Exact region:

- Root `package.json:11-22` exposes `test` and `test:e2e`, but no coverage script.
- `apps/web/package.json:8-26` runs `vitest run` and has no `test:coverage` script.
- `apps/web/vitest.config.ts:16-39` configures include/exclude/timeouts only; no `coverage` block or threshold exists.
- `.github/workflows/quality.yml:54-80` runs lint, typecheck, security lint, unit tests, e2e, and build, but no coverage report/artifact/threshold step.

Failure scenario:

A broad refactor removes branch coverage from a server action, API route, migration helper, scanner, privacy guard, or image-processing path. The suite can remain green because existing tests still exercise some happy paths, and reviewers get no changed-file or critical-file coverage signal.

Concrete fix:

Add a scoped coverage script first rather than a repo-wide hard gate on day one. Start with `src/lib`, `src/app/actions`, `src/app/api`, `scripts`, and migration helpers; publish CI coverage artifacts; then add conservative changed-file or per-file thresholds for security/privacy/migration/image-processing modules.

## Likely Issues and TDD Opportunities

### C10-L01 - `backfillClipEmbeddings` action is still mostly source-contract tested, not behavior-tested

Severity: Low
Confidence: Medium
Classification: likely TDD opportunity

Exact region:

- `apps/web/src/app/actions/embeddings.ts:55-180` implements the full action: maintenance/admin/origin gates, per-admin rate limit, mode resolution, candidate query, stub/production embedding, upsert, and processed/skipped accounting.
- `apps/web/src/__tests__/backfill-clip-embeddings-reembed.test.ts:19-35` only reads `src/app/actions/embeddings.ts` and checks source order/model-version text.
- `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:1-54` source-checks upload queue embedding wiring, not this action's runtime behavior.
- `rg backfillClipEmbeddings` found no UI caller; the action is currently unwired except for its declaration and source-contract test.

Failure scenario:

If this action is later surfaced, a refactor can keep the model-version strings intact while changing behavior: querying before origin validation, rate-limiting the wrong user key, writing stub rows in production, not skipping missing originals, swallowing all item failures, or returning inaccurate counters. Current tests would still pass because they never execute the action against mocked auth/config/db/encoder dependencies.

Concrete fix:

Before wiring this action to UI or admin tooling, add a behavioral suite with mocked `isAdmin`, `requireSameOriginAdmin`, `getCurrentUser`, `getGalleryConfig`, `db`, `resolveOriginalUploadPath`, `embedImageStub`, and `embedImageReal`. Cover disabled no-op, unauthorized/origin/rate-limited exits, stub upsert, production missing-original skip, production real-encoder upsert, per-item failure accounting, and top-level DB failure.

### C10-L02 - Atom feed route behavior is protected mostly by helper/source tests, not route-level tests

Severity: Low
Confidence: Medium
Classification: likely TDD opportunity

Exact region:

- Root feed route behavior lives in `apps/web/src/app/feed.xml/route.ts:29-166`.
- Topic feed route behavior lives in `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:28-165`.
- `apps/web/src/__tests__/feed-sized-derivative.test.ts:1-19` explicitly describes itself as a pure source-grep fixture and then checks route source strings at `:51-93` and `:96-128`.
- `apps/web/src/__tests__/atom-feed.test.ts:65-275` tests `composeAtomFeed`, not route data/header wiring.
- `apps/web/src/__tests__/feed-conditional.test.ts:11-66` tests `isFeedNotModified`, not the route's 200/304 responses.

Failure scenario:

A future route edit can omit `Last-Modified`, wire the wrong `feedSelfUrl`, use the wrong locale in topic photo links, call `getImagesForFeed` before invalid-locale rejection, or return a 200 body when `If-Modified-Since` should be 304. Helper tests and source-grep tests can remain green if the strings are preserved or moved in a misleading way.

Concrete fix:

Add route-level Vitest tests that import both `GET` handlers with mocked `getSeoSettings`, `getGalleryConfig`, `getImagesForFeed`, and `getTopicBySlug`. Assert root 200 headers/body, topic invalid-locale 404 before DB calls, missing-topic 404, topic 200 localized links, and both routes' 304 behavior when `If-Modified-Since` covers the max entry update.

### C10-L03 - Short-form blocking-gate docs still omit Playwright e2e

Severity: Low
Confidence: High
Classification: likely process gap, not a CI omission

Exact region:

- `AGENTS.md:29-37` lists "Quality gates (all blocking)" but omits `npm run test:e2e --workspace=apps/web`.
- `CLAUDE.md:571-578` includes `npm run test:e2e --workspace=apps/web` in the formal test surface.
- Root `package.json:17-18` exposes both `test` and `test:e2e`.
- `.github/workflows/quality.yml:76-77` does run e2e, so CI is not missing it.

Failure scenario:

An agent or contributor following only `AGENTS.md` after a route/UI/admin-flow change reports completion after lint/typecheck/build/Vitest. CI later catches the Playwright failure, but the local per-iteration expectation is ambiguous and delays feedback until after push.

Concrete fix:

Either add `npm run test:e2e --workspace=apps/web` to `AGENTS.md`'s blocking gate list, or explicitly label it as CI-only/required for UI, route, and admin-flow changes. A root `test:all` script chaining Vitest plus Playwright would reduce drift.

## Risks Needing Manual or Scheduled Validation

### C10-R01 - Playwright coverage is Chromium-only

Severity: Low
Confidence: High
Classification: risk

Exact region:

- `apps/web/playwright.config.ts:72-77` defines a single `chromium` project using `Desktop Chrome`.

Failure scenario:

A WebKit/Safari or Firefox-specific regression in dialog focus, mobile layout, CSS, image rendering, color/HDR presentation, or upload controls ships because all automated e2e coverage runs in one engine. This matters for GalleryKit because `CLAUDE.md` documents browser-specific color/HDR behavior and Firefox/Safari differences.

Concrete fix:

Keep the full admin suite serial/Chromium if login-rate-limit cost is too high, but add a small WebKit project for public smoke flows and one mobile viewport. Alternatively, document Chromium-only e2e as intentional and add a scheduled/manual WebKit/Safari smoke checklist for visual/color-heavy releases.

### C10-R02 - Real CLIP semantic-search tests are skipped in default CI

Severity: Medium
Confidence: High
Classification: risk

Exact region:

- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-9` says default CI skips the suite without model weights.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31` gates the suite behind `CLIP_INTEGRATION=1`.
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-17` gates the offline activation proof behind `CLIP_OFFLINE_LOAD=1` and a seeded `CLIP_MODELS_ROOT`.
- `apps/web/src/__tests__/clip-offline-load.test.ts:32-41` skips unless the pinned model file exists.
- `.github/workflows/quality.yml:27-80` does not seed CLIP weights or set either gate.

Failure scenario:

Production semantic search is live, but default CI does not exercise the real offline model load or semantic ranking path. A dependency, model-layout, path-resolution, or encoder-normalization regression can pass all default gates and only fail during operator seeding/backfill or first production inference.

Concrete fix:

Add a scheduled or label-triggered CI job that restores a cached seeded `CLIP_MODELS_ROOT`, runs `clip-offline-load.test.ts` with `CLIP_OFFLINE_LOAD=1`, and runs `clip-semantic-integration.test.ts` with `CLIP_INTEGRATION=1`. Keep it separate from the normal fast gate if model weight size/runtime is too expensive.

## Prior Findings Rechecked as Fixed

- Cycle 9 semantic malformed-row gap is fixed: `apps/web/src/__tests__/semantic-search-route.test.ts:328-367` now covers a corrupt scanned embedding row plus a valid row and asserts only the valid result is returned.
- Cycle 9 audit writer gap is fixed: `apps/web/src/__tests__/audit-log-event.test.ts:25-57` now calls `logAuditEvent` directly and asserts prioritized metadata plus oversized preview truncation.
- Admin e2e is not vacuous in CI: `.github/workflows/quality.yml:35-37` sets plaintext admin/e2e credentials, `apps/web/e2e/helpers.ts:28-45` auto-enables local admin e2e when those credentials exist, and `apps/web/e2e/admin.spec.ts:6-13` fails/skips appropriately.

## Final Missed-Issue Sweep

Final sweep covered:

- `rg` for skipped/focused tests (`describe.skip`, `test.skip`, `.only`, `.todo`, `.fails`).
- `rg` for visual screenshot assertions and raw screenshot artifacts.
- `rg` for coverage scripts/configuration and threshold terminology in package scripts, Vitest config, CI workflow, and docs.
- `rg` for `process.env`, fake timers, global stubs, temp directories, fixed test-output paths, and source-grep tests.
- Source reads for semantic search, audit logging, CLIP embedding backfills, Atom feeds, upload route twins, e2e helper/config, and CI.

No source files or plans were edited. The only intended write from this lane is this report.

## Finding Summary

- C10-C01: Medium / High - nav visual e2e writes screenshots but performs no visual baseline assertion.
- C10-C02: Low / High - no coverage script/report/threshold exists for critical surfaces.
- C10-L01: Low / Medium - `backfillClipEmbeddings` needs behavior tests before being surfaced.
- C10-L02: Low / Medium - Atom feed routes need route-level tests beyond helper/source contracts.
- C10-L03: Low / High - short-form gate docs omit Playwright e2e despite CI/formal test surface.
- C10-R01: Low / High - Playwright e2e is Chromium-only.
- C10-R02: Medium / High - real CLIP/offline-load semantic tests are skipped in default CI.
