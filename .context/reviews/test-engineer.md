# Test Engineer Review - Cycle 11

Date: 2026-06-29
HEAD inspected: `2bf3eb681224e6ad4a3f99a1a99bcb4a11010212`
Role: cycle 11 deep review subagent acting as `test-engineer`
Scope: whole-repository test coverage gaps, flaky tests, and TDD opportunities. Review-only: no production code edited; only this report artifact is intentionally changed.

## Inventory Built First

Required instructions read before review: `AGENTS.md`, `CLAUDE.md`, and the local code-review skill at `/Users/hletrd/.agents/skills/code-review/SKILL.md`. The OMX hook mentioned `TDD`; no separate `tdd` skill was available in the session skill list, so this report handles TDD opportunities directly under the requested test-engineer role.

Review-relevant inventory, excluding `node_modules` and generated `.next` output:

- Test/config surface: 264 source-controlled Vitest/Playwright files under `apps/web/src/__tests__/` and `apps/web/e2e/`, plus root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`, and `apps/web/scripts/run-e2e-server.mjs`.
- Source surface: 558 files under `apps/web/src`, `apps/web/scripts`, `apps/web/e2e`, and `apps/web/drizzle`.
- App-router/API surface: 52 files under `apps/web/src/app`, including 12 route handlers.
- Areas inspected: route/action behavior tests, source-contract tests, browser-flow e2e, visual assertions, CI gates, coverage tooling, gated CLIP/model suites, upload/LR ingest parity, feed routes, backup route tests, semantic search, migration/reconcile tripwires, scanner tests, env/timer/global-stub flake patterns, and prior current-cycle review artifacts enough to avoid stale duplicate claims.

I did not run the full test suite because this was a review-only artifact and no executable source changed. I did run static inventories and final sweeps with `find`, `rg`, `nl -ba`, and direct file reads.

## Confirmed Findings

### C11-TE-01 - Playwright "visual" nav checks still create screenshots without visual assertions

Severity: Medium  
Confidence: High  
Classification: confirmed test-oracle blind spot

Exact region:

- `apps/web/e2e/nav-visual-check.spec.ts:40-79` defines three screenshot-named nav tests.
- `apps/web/e2e/nav-visual-check.spec.ts:51`, `:65`, and `:78` call `page.screenshot({ path: 'test-results/...' })`.
- The same file's real assertions are only visibility, 44 px target size, and overlap checks in `apps/web/e2e/nav-visual-check.spec.ts:6-38`.
- Final grep found no `toHaveScreenshot` usage under `apps/web/e2e` or `apps/web/src/__tests__`.

Concrete failure scenario:

The nav can lose expected spacing, theme contrast, breakpoint composition, or menu placement while every visible target remains at least 44 px and non-overlapping. These tests still pass and simply overwrite local screenshot artifacts, so CI records no visual regression.

Suggested fix:

Convert these captures to Playwright visual assertions, e.g. `await expect(nav).toHaveScreenshot(...)` or `await expect(page).toHaveScreenshot(...)` with committed baselines and stable masking. If they are only manual artifacts, rename/move them out of pass/fail e2e and add a real visual assertion lane.

### C11-TE-02 - No coverage report or threshold gate exists for critical surfaces

Severity: Low  
Confidence: High  
Classification: confirmed quality-gate blind spot

Exact region:

- Root `package.json:11-22` exposes lint/typecheck/test/e2e/deploy scripts, but no coverage script.
- `apps/web/package.json:8-26` runs `vitest run` and has no `test:coverage` script.
- `apps/web/vitest.config.ts:16-39` configures include/exclude/timeouts only; no `coverage` block, provider, reporter, or thresholds.
- `.github/workflows/quality.yml:54-80` runs lint, typecheck, security lint, unit tests, e2e, and build, but no coverage report/artifact/threshold step.

Concrete failure scenario:

A refactor drops branch coverage from a security scanner, privacy projection, migration helper, upload cleanup path, or API route. The suite can remain green because existing happy-path and source-contract tests still pass, and reviewers get no changed-file or critical-file coverage signal.

Suggested fix:

Start with a scoped coverage job instead of a repo-wide hard threshold: report coverage for `src/lib`, `src/app/actions`, `src/app/api`, `scripts`, and migration helpers; publish CI artifacts; then add conservative per-file or changed-file thresholds for security/privacy/migration/upload/image-processing modules.

### C11-TE-03 - Backup download test uses chmod permissions as an error oracle, which can flake under root/elevated test users

Severity: Low  
Confidence: Medium-High  
Classification: confirmed flaky-test risk

Exact region:

- `apps/web/src/__tests__/backup-download-route.test.ts:142-160` writes a backup, `chmod`s the backup directory to `0o000`, calls the route, and expects HTTP 500.
- The production route path being tested calls `realpath`, `lstat`, and then streams the resolved file at `apps/web/src/app/api/admin/db/download/route.ts:43-88`.

Concrete failure scenario:

On a normal non-root developer or GitHub runner user, removing execute permission from the directory can make `lstat(filePath)` fail and the route returns 500 as expected. In a Docker sidecar or local CI container running tests as root, root can often bypass directory permission checks; `lstat` and `createReadStream` can succeed, the route returns 200, and the test fails even though the route behavior has not regressed.

Suggested fix:

Avoid relying on OS permission semantics. Mock `fs/promises.lstat` or `realpath` to throw a non-`ENOENT` error, or inject a temporary wrapper around the route's filesystem helpers so the test deterministically proves unexpected filesystem failures return 500. Keep a separate integration smoke for real files if desired, but do not use chmod as the sole oracle.

## Likely Gaps / TDD Opportunities

### C11-TE-04 - Lightroom upload route is still mostly source-contract tested, not behavior-tested

Severity: Medium  
Confidence: High  
Classification: likely TDD gap

Exact region:

- `apps/web/src/app/api/admin/lr/upload/route.ts:62-531` implements the full token/cookie-auth multipart route: restore gate, content-length validation, upload tracker preclaim/settle, filename/topic/title validation, contract lock, disk-space check, save, HDR/GPS/EXIF handling, DB insert, queue enqueue, audit, revalidation, and lock release.
- Existing LR route coverage is source-grep based: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16` explicitly describes the route as heavy and source-contract tested; the same file asserts strings/order throughout `:27-67`, `:78-105`, `:116-164`, `:175-279`, and `:289-417`.
- `rg` found no test importing `POST` from `@/app/api/admin/lr/upload/route`; only source-contract and nginx/source references mention `/api/admin/lr/upload`.

Concrete failure scenario:

A refactor preserves the searched strings but breaks runtime behavior: a malformed multipart body fails to settle quota, a topic lookup error returns the wrong JSON/status, `withAdminAuth` context is not propagated, the contract lock is not released on an early branch, an HDR reject deletes the wrong original, or the enqueue payload is built from stale state. The current tests can stay green because they do not execute the route against mocked auth/db/fs/queue dependencies.

Suggested fix:

Add a focused route-level Vitest suite that imports `POST` with mocks for `withAdminAuth`/`getAdminAuthToken`, `db`, `saveOriginalAndGetMetadata`, `statfs`, `acquireUploadProcessingContractLock`, tracker helpers, queue, audit, and revalidation. Cover at least: missing/invalid `Content-Length`, invalid multipart, missing file, invalid topic, topic DB throw settles quota, lock acquisition failure releases quota, disk-space failure releases quota, HDR reject deletes original and settles quota, successful insert/enqueue/audit, post-save failure deletes original, and `finally` releases the lock.

### C11-TE-05 - `backfillClipEmbeddings` action still has only source-order coverage

Severity: Low  
Confidence: Medium  
Classification: likely TDD opportunity

Exact region:

- `apps/web/src/app/actions/embeddings.ts:55-180` implements the action: maintenance/admin/origin gates, per-admin rate limit, mode resolution, model-version-aware candidate query, stub/production embedding, upsert, and processed/skipped accounting.
- `apps/web/src/__tests__/backfill-clip-embeddings-reembed.test.ts:19-35` only reads `src/app/actions/embeddings.ts` and checks that `modelVersion` is hoisted and used in the `notExists` source.
- `rg backfillClipEmbeddings` found no behavioral test importing/executing the action.

Concrete failure scenario:

If the action is later surfaced in UI/admin tooling, a refactor can keep the `modelVersion` strings intact while changing behavior: rate-limiting the wrong admin key, querying before origin validation, writing stub rows in production, not skipping missing originals, swallowing all item failures, or returning inaccurate counters.

Suggested fix:

Before wiring the action, add behavior tests with mocked `isAdmin`, `requireSameOriginAdmin`, `getCurrentUser`, `getGalleryConfig`, `db`, `resolveOriginalUploadPath`, `embedImageStub`, and `embedImageReal`. Cover disabled no-op, unauthorized/origin/rate-limited exits, stub upsert, production missing-original skip, production real-encoder upsert, per-item failure accounting, and top-level DB failure.

### C11-TE-06 - Atom feed route behavior is still not route-level tested

Severity: Low  
Confidence: Medium  
Classification: likely TDD opportunity

Exact region:

- Root feed route behavior lives in `apps/web/src/app/feed.xml/route.ts:29-166`.
- Topic feed route behavior lives in `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:28-165`.
- `apps/web/src/__tests__/feed-sized-derivative.test.ts:1-19` says it is a pure source-grep fixture; route assertions are source-order/string checks at `:51-93` and `:96-128`.
- `apps/web/src/__tests__/atom-feed.test.ts:65-275` tests `composeAtomFeed`, not the route's data/header/status wiring.
- `apps/web/src/__tests__/feed-conditional.test.ts:11-66` tests `isFeedNotModified`, not the route's 200/304 response branches.

Concrete failure scenario:

A future route edit can omit `Last-Modified`, call `getImagesForFeed` before invalid-locale rejection, wire the wrong `feedSelfUrl`, use the wrong locale in topic links, or return a 200 body when `If-Modified-Since` should produce 304. Helper and source-grep tests can stay green if the strings remain present in misleading order or unused code.

Suggested fix:

Add route-level Vitest tests importing both `GET` handlers with mocked `getSeoSettings`, `getGalleryConfig`, `getImagesForFeed`, and `getTopicBySlug`. Assert root 200 headers/body, root 304, unsupported topic locale 404 before DB calls, missing topic 404, topic 200 localized links, and topic 304.

## Risks Needing Scheduled / Manual Validation

### C11-TE-07 - Production CLIP/offline semantic-search tests remain gated out of default CI

Severity: Medium  
Confidence: High  
Classification: risk

Exact region:

- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-9` documents that default CI skips the suite without model weights.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31` gates the suite behind `CLIP_INTEGRATION=1`.
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-20` documents the `CLIP_OFFLINE_LOAD=1 CLIP_MODELS_ROOT=...` gate.
- `apps/web/src/__tests__/clip-offline-load.test.ts:32-41` skips unless the expected seeded model file exists.
- `.github/workflows/quality.yml:27-80` does not seed CLIP weights or set either gate.

Concrete failure scenario:

Production semantic search is live, but default CI does not exercise the real offline model load or semantic ranking path. A dependency, model-layout, model-manifest, path-resolution, tokenizer, or encoder-normalization regression can pass the normal gates and fail only during operator seeding/backfill or first production inference.

Suggested fix:

Add a scheduled or label-triggered CI job that restores a cached seeded `CLIP_MODELS_ROOT`, runs `clip-offline-load.test.ts` with `CLIP_OFFLINE_LOAD=1`, and runs `clip-semantic-integration.test.ts` with `CLIP_INTEGRATION=1`. Keep it separate from the fast gate if model weight size/runtime is too expensive.

### C11-TE-08 - Browser e2e remains Chromium-only

Severity: Low  
Confidence: High  
Classification: risk

Exact region:

- `apps/web/playwright.config.ts:72-77` defines one project, `chromium`, using `Desktop Chrome`.
- `.github/workflows/quality.yml:72-74` installs only `chromium`.

Concrete failure scenario:

A WebKit/Safari or Firefox-specific regression in dialog focus, mobile layout, image rendering, color/HDR presentation, route hydration, or upload controls ships because all automated browser-flow coverage runs in one engine. This matters because `CLAUDE.md` documents browser-specific color/HDR behavior and Firefox/Safari differences.

Suggested fix:

Keep the full admin suite serial/Chromium if login-rate-limit budget is the constraint, but add a small WebKit project for public smoke flows and one mobile viewport. Alternatively, document Chromium-only e2e as intentional and add a scheduled/manual Safari/WebKit smoke checklist for visual and color-heavy releases.

## Rechecked Items

- Prior short-form gate-doc finding is fixed: `AGENTS.md:29-38` now includes `npm run test:e2e --workspace=apps/web` in the quality-gate list.
- Admin e2e is not vacuous in CI: `.github/workflows/quality.yml:35-37` sets credentials, `apps/web/e2e/admin.spec.ts:6-13` asserts CI admin coverage is enabled, and `apps/web/e2e/helpers.ts:28-45` auto-enables local admin e2e when safe plaintext credentials exist.
- Cycle 9 semantic malformed-row gap remains fixed: `apps/web/src/__tests__/semantic-search-route.test.ts:328-367` now executes the route with a malformed scanned row plus a valid row and asserts only the valid result is returned.

## Final Missed-Issue Sweep

Final sweep covered:

- skipped/focused tests: `describe.skip`, `test.skip`, `.only`, `.todo`, `.fails`;
- visual assertions and screenshot artifacts: `page.screenshot`, `toHaveScreenshot`, `test-results`;
- coverage scripts/config/threshold terms across package scripts, Vitest config, CI, and docs;
- source-contract patterns: `readFileSync`, `source-contract`, `source-grep`, route source reads;
- environment/timer/global-stub flake patterns: `process.env`, fake timers, `Date.now`, `setTimeout`, temp directories, chmod, fixed artifact paths;
- route/action test reach for semantic search, LR upload, Atom feeds, OG routes, backup download, upload serving, and admin e2e;
- prior current-cycle review artifacts to avoid carrying fixed or non-test findings into this lane.

No production source files were edited. The only intended write from this lane is this report.

## Finding Summary

- C11-TE-01: Medium / High - nav "visual" e2e writes screenshots but has no visual assertion.
- C11-TE-02: Low / High - no coverage report or threshold gate exists for critical surfaces.
- C11-TE-03: Low / Medium-High - backup download chmod test can flake under root/elevated users.
- C11-TE-04: Medium / High - Lightroom upload route needs behavior tests beyond source contracts.
- C11-TE-05: Low / Medium - `backfillClipEmbeddings` action needs behavior tests before surfacing.
- C11-TE-06: Low / Medium - Atom feed routes need route-level tests beyond helpers/source contracts.
- C11-TE-07: Medium / High - real CLIP/offline semantic suites are skipped in default CI.
- C11-TE-08: Low / High - Playwright e2e is Chromium-only.
