# Cycle 72 Test Engineer / Verifier Review

Scope: read-only review; no files edited.

## Inventory

- `AGENTS.md`, `CLAUDE.md`, package scripts, CI workflow, custom lint scanners, key fixture tests, e2e config/specs, feed tests, restore-maintenance scripts.
- Configured gates: lint, three custom lint gates, typecheck, build, unit tests, and Chromium e2e when browser-flow coverage is required.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

## Findings

### C72-04 - Feed conditional tests are stale and do not prove route behavior

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/__tests__/feed-conditional.test.ts:2`, `apps/web/src/__tests__/feed-sized-derivative.test.ts:63`, `apps/web/src/__tests__/feed-sized-derivative.test.ts:68`, `apps/web/src/app/feed.xml/route.ts:156`, `apps/web/src/app/feed.xml/route.ts:157`.
- Evidence: `isFeedNotModified` is now dead outside its own helper/test, while actual feed routes build and compare ETags inline.
- Failure scenario: a route-level conditional regression can pass because the behavioral test exercises dead helper code and the route checks are source fixtures.
- Suggested fix: replace the stale helper test with route-level tests for root/topic feed `GET` handlers and ETag/304 behavior.

### C72-05 - Shipped restore-maintenance recovery command is only syntax/source-contract tested

- Severity/confidence: Medium / Medium.
- File/line: `apps/web/package.json:20`, `apps/web/Dockerfile:125`, `apps/web/scripts/restore-maintenance-recovery.ts:1`, `apps/web/scripts/restore-maintenance-recovery.mjs:13`, `apps/web/scripts/restore-maintenance-recovery.mjs:21`, `apps/web/src/lib/restore-maintenance-durable.ts:24`, `apps/web/scripts/check-js-scripts.mjs:43`, `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:26`.
- Evidence: the production-copied `.mjs` script duplicates marker location logic and is only syntax/source-contract tested, while the typed script delegates to the durable helper.
- Failure scenario: future marker-path or env support changes in the durable helper could leave the shipped recovery command clearing/reporting a different marker.
- Suggested fix: add subprocess tests for the actual `.mjs` script using temp marker paths and confirmation behavior.

### C72-06 - Browser matrix invariants are mostly mocked, not engine-smoked

- Severity/confidence: Low / High.
- File/line: `CLAUDE.md:365`, `CLAUDE.md:377`, `apps/web/playwright.config.ts:72`, `apps/web/src/__tests__/use-display-capability.test.ts:4`.
- Evidence: documented browser differences for gamut/HDR behavior are covered mostly through mocked unit tests and a Chromium-only Playwright project.
- Failure scenario: Firefox/WebKit media-query or hydration behavior can regress color/HDR presentation while Chromium-only e2e and unit mocks stay green.
- Suggested fix: add a small tagged Firefox/WebKit smoke project for home/photo render and display-capability outcomes.

## Final Sweep

No critical/high test findings. The custom lint gates are broad and passed locally.
