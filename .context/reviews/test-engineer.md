# Cycle 38 Test-Engineer Review

Role: cycle-38 test-engineer
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-08 KST
Mode: review-only. No production code, test code, deploy, database, live proxy, or destructive changes were made.

## Provenance And Inventory

Read first, per instruction: `AGENTS.md` and `CLAUDE.md`.

Inventory built before reviewing:

- Test files: 381 files under `apps/web/src/__tests__` and `apps/web/e2e`; one hidden `.omc/state/...json` agent-state file is inside `src/__tests__` but is not matched by Vitest's include.
- Implementation files: 263 TypeScript/TSX source files under `apps/web/src`, excluding `src/__tests__`.
- Test declarations: about 4,050 `describe` / `it` / `test` declarations across unit and e2e files.
- Unit test discovery: `apps/web/vitest.config.ts:16-39` includes only `src/__tests__/**/*.test.{ts,tsx}` and excludes `.next`.
- E2E discovery: `apps/web/playwright.config.ts:48-87` runs `apps/web/e2e` through one serialized Chromium project.
- CI and gate files reviewed: `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, and `apps/web/scripts/check-public-route-rate-limit.ts`.
- Cross-file review included test-to-implementation links for queue processing, image processing, upload/e2e fixtures, CLIP preflight, nginx edge behavior, browser/display capability detection, and CI gates.

Commands used for evidence included `find`, `rg`, `nl -ba`, `sed`, `file`, and `git status --short`. I did not run the full test suite, build, Playwright, CLIP preflight, live nginx checks, deployment, or any mutation-heavy validation because this lane is review-only.

## Findings

### TE-C38-01 - Queue delete-during-processing cleanup is still pinned by source shape, not behavior

- Classification: Confirmed issue
- Severity: Medium
- Confidence: High
- Evidence: `apps/web/src/lib/image-queue.ts:914-936`; `apps/web/src/__tests__/image-queue-delete-race-cleanup-wiring.test.ts:1-21` and `:33-62`; `apps/web/src/__tests__/image-queue-settings-wiring.test.ts:45-79` and `:151-234`

The implementation conditionally updates the image row after processing and, when `affectedRows === 0`, deletes webp/avif/jpeg variants with an empty-size directory scan (`image-queue.ts:920-936`). The dedicated test says the PQueue branch is "hard to unit-isolate" and therefore asserts source text with regexes (`image-queue-delete-race-cleanup-wiring.test.ts:10-17`, `:33-62`). A behavioral PQueue harness already exists in `image-queue-settings-wiring.test.ts`, but its shared mock update result is `affectedRows: 1` (`:52-61`) and its first two tests exercise the normal processed path (`:196-273`), not the deleted-mid-processing branch.

Failure scenario: a refactor can keep the textual `deleteImageVariants(..., [])` calls present while changing control flow so the queue task never reaches them, does not await them, reads a different update result shape, or starts caption/embedding side effects after the deleted-row return. The test suite stays green while deleted-during-processing uploads leak non-default derivatives.

Concrete fix: add a behavioral test beside `image-queue-settings-wiring.test.ts` that reuses `runQueuedTask()`, makes `updateChain.where` resolve `[{ affectedRows: 0 }]`, mocks `deleteImageVariants`, enqueues a job, runs the captured task, and asserts exactly three awaited calls with `/tmp/webp`, `/tmp/avif`, `/tmp/jpeg` plus `[]`. Also assert no caption or embedding side effects fire after the cleanup return.

### TE-C38-02 - Full e2e upload coverage uses unrealistic baseline JPEGs

- Classification: Likely issue / TDD opportunity
- Severity: Medium
- Confidence: High
- Evidence: `apps/web/e2e/admin.spec.ts:137-158`; `apps/web/scripts/seed-e2e.ts:112-167`

The only full browser admin upload flow reads `e2e/fixtures/e2e-landscape.jpg`, submits it through the dashboard, and waits for the DB row to become processed (`admin.spec.ts:137-158`). The seed data used by public e2e pages is generated with `sharp({ create: ... })`, solid colors, and copied derivatives (`seed-e2e.ts:112-167`). `file` inspection showed these e2e upload/CLIP fixtures are tiny baseline 8-bit JPEGs; the seed path also bypasses actual upload metadata parsing by writing originals and derivatives directly.

Failure scenario: the browser upload/FormData path, `strip_gps_on_upload`, EXIF orientation, ICC/P3 profile handling, privacy fields, derivative color conversion, and public UI metadata can drift apart while e2e stays green because the uploaded image has no GPS, EXIF orientation, ICC profile, wide-gamut payload, HDR metadata, or realistic dimensions. Unit tests may cover primitives, but they do not prove the end-to-end ingestion contract for a photographer-style image.

Concrete fix: add one small committed upload fixture with EXIF orientation, GPS, and ICC/P3 metadata. In e2e or a focused integration test, enable GPS stripping, upload that fixture, wait for processing, then assert DB/public responses have no GPS, the rendered orientation is correct, derivatives exist, public privacy fields remain omitted, and color/HDR metadata surfaces are consistent. Keep the image small enough for CI.

### TE-C38-03 - "Visual" nav e2e tests write screenshots but do not compare them

- Classification: Confirmed issue
- Severity: Low-Medium
- Confidence: High
- Evidence: `apps/web/e2e/nav-visual-check.spec.ts:6-38` and `:40-87`; `.github/workflows/quality.yml:75-80`

The nav spec makes useful geometry assertions for 44 px targets and non-overlap (`nav-visual-check.spec.ts:6-38`), then writes screenshots at `:58`, `:72`, and `:85`. There is no visual oracle in this file: no `toHaveScreenshot`, no snapshot comparison, and the CI workflow only installs Chromium and runs Playwright (`quality.yml:75-80`) without uploading these manually named screenshots as review artifacts.

Failure scenario: nav color, spacing, z-index, menu hierarchy, density, or collapsed/expanded visual polish regresses while all targets remain visible and non-overlapping. CI passes, and the generated screenshots are only diagnostic files that a human may never inspect.

Concrete fix: either rename this as a geometry-only spec or convert the three screenshot writes into `expect(page).toHaveScreenshot(...)` assertions with masks for dynamic regions. If full visual snapshots are too noisy, upload the three files as CI artifacts on nav-related failures and document the manual oracle.

### TE-C38-04 - Live public-page flood protection depends on manual nginx application

- Classification: Manual-validation risk
- Severity: Medium
- Confidence: High
- Evidence: `apps/web/src/__tests__/nginx-config.test.ts:12-76`; `apps/web/deploy.sh:51-56`; `CLAUDE.md:245-248` and `:514-526`

The repo has solid source-contract tests for the committed nginx template (`nginx-config.test.ts:12-76`), but deploy only rebuilds and starts Docker Compose (`deploy.sh:51-56`). The project documentation is explicit that public pages are throttled at the nginx edge, not in the app, and that applying host nginx config requires manual `nginx -t`, reload, and burst verification (`CLAUDE.md:245-248`, `:514-526`).

Failure scenario: CI and source tests are green while the production host still runs an older nginx config, a different proxy/CDN sits in front, or the public/next-image limiters were copied but not reloaded. Public dynamic pages can then be unthrottled, or legitimate asset fan-out can be accidentally throttled, with no repository gate detecting the live state.

Concrete fix: keep the source-contract test, but add an operator smoke script or release checklist artifact for nginx-affecting changes. It should record `nginx -t`, reload evidence, a same-IP burst that returns 429 beyond the `zone=public` and `zone=nextimage` budgets, and a normal page load that does not 429. Treat this as required manual evidence, not as closed by a commit alone.

### TE-C38-05 - Browser-flow coverage is Chromium-only despite browser-specific display/color behavior

- Classification: Manual-validation risk / likely coverage gap
- Severity: Medium
- Confidence: High
- Evidence: `apps/web/playwright.config.ts:48-77`; `.github/workflows/quality.yml:75-80`; `apps/web/src/__tests__/use-display-capability.test.ts:1-14`, `:43-82`, and `:111-235`; `CLAUDE.md:401-422`

Playwright defines one project, `chromium`, using `Desktop Chrome` (`playwright.config.ts:72-76`), and CI installs only Chromium (`quality.yml:75-80`). The display capability tests intentionally mock `window`, `screen.colorGamut`, and `matchMedia` (`use-display-capability.test.ts:1-14`, `:43-82`) and then invoke `_detectForTesting` over those mocked paths (`:111-235`). Meanwhile, CLAUDE documents real browser differences for Safari, Chrome, Edge, Firefox, HDR media queries, and display-change limitations (`CLAUDE.md:401-422`).

Failure scenario: Safari/WebKit focus behavior, mobile fixed positioning, touch gestures, `screen.colorGamut`, `matchMedia('(dynamic-range: high)')`, or Firefox gamut fallback diverges from the mocked unit assumptions. The suite remains green because no real WebKit or Firefox browser executes the photographer-visible photo/color flows.

Concrete fix: add a small scheduled or manual Playwright browser-matrix job with WebKit and Firefox for the public home, photo viewer/lightbox, color/HDR badges or wide-gamut hint, search, and mobile nav. Keep the required PR gate Chromium-only if runtime is a concern, but make non-Chromium evidence a documented release or browser-compatibility gate.

### TE-C38-06 - No coverage report or changed-code coverage ratchet exists

- Classification: Confirmed gate adequacy issue
- Severity: Low-Medium
- Confidence: High
- Evidence: `apps/web/package.json:8-30`; `apps/web/vitest.config.ts:16-39`; `.github/workflows/quality.yml:54-83`

The test script is plain `vitest run` (`apps/web/package.json:13`), Vitest config has include/exclude/timeout only (`vitest.config.ts:16-39`), and CI runs lint, typecheck, custom security lint gates, audit, unit tests, e2e, and build without collecting coverage (`quality.yml:54-83`). A repo-wide search found no coverage provider, threshold, or coverage script.

Failure scenario: a new API route, action branch, migration reconcile path, queue branch, or script runner lands with only source-shape assertions or no tests. The absolute test count is high, but reviewers have no objective signal that changed executable branches are covered.

Concrete fix: add `@vitest/coverage-v8` and start with a non-blocking coverage artifact. Then ratchet changed-file coverage or high-risk directories (`src/app/actions`, `src/app/api`, `src/lib`, `scripts/migrate.js`, and sidecar scripts) instead of imposing a broad global threshold immediately.

### TE-C38-07 - Real CLIP activation proof is outside the default quality gate

- Classification: Manual-validation risk with existing mitigation
- Severity: Medium
- Confidence: High
- Evidence: `apps/web/package.json:21-23`; `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`; `.github/workflows/clip-preflight.yml:1-46`; `CLAUDE.md:618-626`

The CLIP preflight script requires `CLIP_MODELS_ROOT` and env-gates the two real-model suites (`apps/web/package.json:23`). The tests skip by default unless weights/env are present (`clip-offline-load.test.ts:15-41`, `clip-semantic-integration.test.ts:8-31`). A separate workflow seeds weights and runs preflight, but it is only scheduled weekly or manually triggered (`clip-preflight.yml:3-6`). CLAUDE explicitly says the manual preflight is the only verification that the real encoder loads offline and ranks semantically (`CLAUDE.md:618-626`).

Failure scenario: a change to CLIP model paths, dependency locks, download layout, semantic search activation, or embedding code breaks real offline loading. The required quality workflow can still pass because it does not seed weights or run `test:clip:preflight`; the scheduled workflow may catch it later, after the change is already merged or deployed.

Concrete fix: trigger `clip-preflight.yml` on PR/push path filters for CLIP/model/semantic files plus lockfile changes, or require a recorded manual `npm run test:clip:preflight` result before any CLIP production-mode activation or release touching those paths.

## Final Sweep

Commonly missed areas checked: `.only`/skip patterns, e2e helper enablement, CI gate order, visual-test oracles, static source-contract tests, fixture realism, nginx live-vs-template proof, CLIP env-gated tests, Playwright browser matrix, and coverage instrumentation.

Relevant source/test files skipped: none intentionally from the source-controlled test and implementation inventory. I intentionally did not review generated `.next/**` copies, dependency folders, or the hidden `apps/web/src/__tests__/.omc/**` agent-state file because they are not source tests. I also did not perform live external validation for nginx, CLIP weights, deployment, or real non-Chromium browser devices; those are identified above as manual-validation risks where applicable.
