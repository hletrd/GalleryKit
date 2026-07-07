# Test-Engineer Review - Cycle 8

Date: 2026-07-07
HEAD reviewed: `eca55414677676462ae54a5579d9c35bfdf16d3c`
Mode: static test strategy / coverage / flakiness review. I did not run Playwright or any command that would initialize, seed, or mutate the existing `gallerykit-e2e-mysql-cycle7-47691` MySQL container on `127.0.0.1:33307`. This review file is the only intended write.

## Inventory

Read first: `AGENTS.md` and `CLAUDE.md`.

Inventoried review surface:
- Test and gate harness: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`.
- Test counts and shape: 340 Vitest test files under `apps/web/src/__tests__`, 9 Playwright specs under `apps/web/e2e`, 8 app API route files, 13 server-action files, 29 scripts, 33 migration/meta files.
- Source areas sampled for coverage quality: admin auth wrappers, server action origin guards, public route rate-limit guards, migration journal/reconcile tests, privacy field guards, upload/image queue/backfill tests, LR upload tests, token-management tests, public and admin Playwright flows, CLIP opt-in tests, touch-target/visual/UI interaction tests.
- Prior context reviewed: current `.context/reviews/_aggregate.md`, `.context/plans/README.md`, `.context/plans/cycle-96-2026-07-01-deferred.md`, `.context/plans/cycle-4-2026-07-07-deferred.md`, and the previous `test-engineer.md` artifact.

Static coverage summary:
- Strong guards exist for lint-scanned security contracts: API auth (`check-api-auth.test.ts`), action origin (`check-action-origin.test.ts`), public route rate limits (`check-public-route-rate-limit.test.ts`), and symmetric privacy field separation (`privacy-fields.test.ts`).
- Migration tests cover journal monotonicity/tag-file parity and reconcile coverage (`migration-journal.test.ts`, `migration-journal-monotonicity.test.ts`, `migrate-reconcile-coverage.test.ts`, `migrate-pending-migrations.test.ts`).
- Playwright now has positive public smokes for home/search/photo/share/map/timeline/year/smart-collection routes and targeted UI regressions, but it remains single-browser/single-worker and admin coverage is still partial.

Not run:
- `npm run test:e2e --workspace=apps/web`: the configured local web server path runs `npm run init`, `npm run e2e:seed`, and `npm run build` (`apps/web/scripts/run-e2e-server.mjs:75-84`), and the seed path deletes/replaces rows/files in disposable environments (`apps/web/scripts/seed-e2e.ts:217-233`).
- Unit/lint/type/build gates: not necessary for a static review and outside the instruction to avoid broader mutation; no completion claim depends on fresh green gates.

## Findings

### TE-C8-01 - E2E safety guard runs after database initialization

Severity: Medium
Confidence: High
Status: confirmed harness-safety gap
File/region: `apps/web/scripts/run-e2e-server.mjs:75-84`, `apps/web/scripts/init-db.ts:24-30`, `apps/web/scripts/seed-e2e.ts:169-183`, `apps/web/src/__tests__/seed-e2e-safety.test.ts:9-28`

Evidence: `run-e2e-server.mjs` loads env, then runs `npm run init` before `npm run e2e:seed` (`run-e2e-server.mjs:75-77`). `init-db.ts` immediately executes `node scripts/migrate.js` (`init-db.ts:24-30`). The disposable DB / explicit destructive opt-in guard lives inside `seed-e2e.ts` (`seed-e2e.ts:169-183`), so it does not protect the earlier migration/reconcile step. The existing safety test only asserts guard ordering inside `seed-e2e.ts` and CI DB names (`seed-e2e-safety.test.ts:9-28`); it does not assert `run-e2e-server` refuses unsafe DBs before init.

Failure scenario: a developer runs `npm run test:e2e` with `.env.local` pointing at a shared non-disposable database. `seed-e2e` will later refuse, but `npm run init` may already have run schema reconciliation/migrations against that database.

Concrete test/fix suggestion: move the disposable-db guard into a shared helper used by `run-e2e-server.mjs` before `npm run init`, or make `init` receive an explicit E2E-safe mode. Add a source/behavior test that proves `run-e2e-server` checks DB safety before spawning `npm run init`.

### TE-C8-02 - No coverage ratchet or thresholds protect new critical branches

Severity: Medium
Confidence: High
Status: confirmed strategy gap
File/region: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`

Evidence: the unit gate is plain `vitest run` (`apps/web/package.json:13`). The Vitest config defines include/exclude and timeout only (`vitest.config.ts:16-39`); there is no coverage provider, per-directory threshold, changed-file ratchet, or critical-path coverage report.

Failure scenario: a new branch in `src/app/actions`, `src/app/api`, `src/lib/data*`, migration scripts, or upload/restore code can ship with no executed test while the existing suite stays green. This is especially likely where the repo relies on source-contract tests that can prove string shape but not runtime behavior.

Concrete test/fix suggestion: add a non-blocking `test:coverage` baseline first, then ratchet changed files or critical directories. Require either branch coverage for new critical code or an explicit documented waiver in review artifacts.

### TE-C8-03 - LR PAT upload still lacks an auth-to-upload integration proof

Severity: Medium
Confidence: High
Status: confirmed integration gap
File/region: `apps/web/src/app/api/admin/lr/upload/route.ts:84-92`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-200`, `apps/web/src/app/api/admin/lr/upload/route.ts:252-344`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:44-47`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:172-199`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:191-336`

Evidence: the production route is wrapped with `withAdminAuth` and reads token context (`route.ts:84-92`) before many behavior branches for headers, quotas, parse slot, maintenance, topic lookup, settings, and disk space (`route.ts:101-200`, `252-344`). The route behavior test replaces `withAdminAuth` with an identity wrapper (`lr-upload-route-behavior.test.ts:44-47`) and currently exercises one late HDR rejection path (`lr-upload-route-behavior.test.ts:172-199`). Many other LR assertions are source-contract checks over route text (`lr-upload-hdr-gate.test.ts:191-336`).

Failure scenario: header name/casing, token scope enforcement, request-scoped token context, `last_used_at`, multipart parsing, or success enqueue can regress while mocked route tests and source scans still pass.

Concrete test/fix suggestion: add a disposable integration test that creates an `lr:upload` token, POSTs a multipart JPEG to `/api/admin/lr/upload` with `X-GalleryKit-Token`, asserts success row/actor/last-used/enqueue visibility, and verifies an `lr:read` token is rejected before handler work. Keep branch-unit tests for the many error statuses.

### TE-C8-04 - Admin Playwright coverage still omits first-class nav destinations

Severity: Medium
Confidence: High
Status: confirmed browser-flow gap
File/region: `apps/web/src/components/admin-nav.tsx:15-26`, `apps/web/e2e/admin.spec.ts:20-42`, `apps/web/e2e/admin.spec.ts:73-165`, `.context/plans/cycle-96-2026-07-01-deferred.md:102-107`

Evidence: `AdminNav` exposes dashboard, categories, tags, SEO, settings, tokens, password, users, DB, and analytics (`admin-nav.tsx:15-26`). Playwright navigation coverage exercises categories, tags, users, password, and DB (`admin.spec.ts:20-42`), then settings GPS toggle, topic create/delete, and dashboard upload (`admin.spec.ts:73-165`). There is still no browser assertion for SEO, tokens, or analytics pages. This exact class was previously deferred with the exit criterion that every `AdminNav` destination receive one stable assertion (`cycle-96 deferred:102-107`).

Failure scenario: SEO form hydration, token one-shot plaintext flow, analytics page data rendering, or route-level admin layout can break while admin e2e remains green because only lower-level mocked/source tests cover those surfaces.

Concrete test/fix suggestion: expand `admin.spec.ts` with one stable landmark/control assertion per `AdminNav` destination. For tokens, add create -> plaintext acknowledgement/copy -> revoke. For SEO, assert a field-level validation path. For analytics, assert the main dashboard/list loads with seeded data or an empty state.

### TE-C8-05 - Zoom and swipe interaction risks are not behavior-tested in the combined states

Severity: Medium
Confidence: Medium-High
Status: likely coverage gap
File/region: `apps/web/src/components/image-zoom.tsx:198-228`, `apps/web/src/components/image-zoom.tsx:230-258`, `apps/web/src/components/photo-viewer.tsx:400-420`, `apps/web/src/components/lightbox.tsx:331-350`, `apps/web/e2e/swipe-visual-reset.spec.ts:59-131`, `.context/plans/cycle-96-2026-07-01-deferred.md:65-70`, `.context/plans/cycle-96-2026-07-01-deferred.md:109-114`

Evidence: image zoom has keyboard toggle and touch pan/pinch handlers (`image-zoom.tsx:198-228`, `230-258`), while photo viewer and lightbox global handlers still consume left/right arrows for navigation (`photo-viewer.tsx:400-420`, `lightbox.tsx:331-350`). E2E covers shared-group swipe visual reset and repeated shallow stepping (`swipe-visual-reset.spec.ts:59-131`), but I found no browser test for "zoomed image receives arrow keys/pan/reset without navigating" or "zoomed mobile pan cannot trigger previous/next". Prior plans preserve both risks with explicit exit criteria (`cycle-96 deferred:65-70`, `109-114`).

Failure scenario: a user zooms into a photo and tries to pan or inspect details; arrow keys navigate away, or a touch pan accidentally triggers previous/next navigation. Existing math/source tests can pass because they do not exercise the combined browser event routing.

Concrete test/fix suggestion: add Playwright tests for desktop/lightbox keyboard zoom states and mobile/touch zoom pan states. Assert focused zoom can pan/reset without slide navigation, and assert swipe navigation is disabled or ignored while zoom/pan is active.

### TE-C8-06 - Playwright remains single-browser despite mobile/touch-heavy coverage

Severity: Low-Medium
Confidence: High
Status: confirmed matrix gap
File/region: `apps/web/playwright.config.ts:48-77`, `apps/web/e2e/test-fixes.spec.ts:16-82`, `apps/web/e2e/focus-restore.spec.ts:34-60`, `apps/web/e2e/swipe-visual-reset.spec.ts:23-49`

Evidence: Playwright defines one project, `chromium`, using Desktop Chrome (`playwright.config.ts:72-77`). The suite has mobile viewport checks, focus restore, and synthetic touch events (`test-fixes.spec.ts:16-82`, `focus-restore.spec.ts:34-60`, `swipe-visual-reset.spec.ts:23-49`), but no WebKit or mobile-emulation project.

Failure scenario: Safari/iOS-specific event behavior, focus restoration, passive touch listener behavior, viewport unit differences, or CSS rendering issues can ship with green Playwright because Chromium is the only runtime.

Concrete test/fix suggestion: add a small second project for Mobile Safari/WebKit smoke coverage limited to public home -> photo -> info sheet/lightbox -> zoom/swipe/focus restore. Keep the full suite Chromium-only if runtime cost is a concern.

### TE-C8-07 - Visual checks write screenshots as artifacts, not assertions

Severity: Low
Confidence: High
Status: confirmed assertion weakness
File/region: `apps/web/e2e/nav-visual-check.spec.ts:6-37`, `apps/web/e2e/nav-visual-check.spec.ts:58`, `apps/web/e2e/nav-visual-check.spec.ts:72`, `apps/web/e2e/nav-visual-check.spec.ts:85`

Evidence: the nav visual test asserts useful target-size and overlap metrics (`nav-visual-check.spec.ts:6-37`), then writes screenshots with `page.screenshot` (`nav-visual-check.spec.ts:58`, `72`, `85`). It never calls `expect(...).toHaveScreenshot(...)`.

Failure scenario: nav spacing, clipping, contrast, or hierarchy can regress while metric assertions pass; screenshots are produced only as artifacts for a human to inspect after the fact.

Concrete test/fix suggestion: either convert stable nav regions to `toHaveScreenshot` assertions with masks and deterministic theme/locale, or rename the spec to a layout-metrics smoke and add a separate visual snapshot gate.

### TE-C8-08 - CLIP real-model tests are opt-in and document a noisy native teardown failure mode

Severity: Low
Confidence: Medium
Status: confirmed manual-gate fragility
File/region: `apps/web/src/__tests__/clip-offline-load.test.ts:15-25`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`

Evidence: offline model-load proof runs only when `CLIP_OFFLINE_LOAD=1` and seeded weights exist (`clip-offline-load.test.ts:15-25`, `32-41`). Semantic ranking proof runs only under `CLIP_INTEGRATION=1` (`clip-semantic-integration.test.ts:8-10`, `30-31`). The offline-load test documents that `onnxruntime-node` may abort with code 134 after assertions complete (`clip-offline-load.test.ts:23-25`).

Failure scenario: production CLIP activation can depend on a manually skipped proof. If native teardown aborts, operators may either ignore a real failure as "known teardown" or rerun until green without preserving reliable evidence.

Concrete test/fix suggestion: run real CLIP proofs in a child-process harness that distinguishes assertion/model-load failures from the known post-assert teardown abort, and require recorded opt-in evidence whenever model paths, pinned revisions, Transformers, or production semantic activation changes.

## Final Sweep

Areas checked for missed coverage:
- Vitest config, timeout behavior, skipped/opt-in tests, source-contract density, and coverage instrumentation.
- Playwright config, admin skip gates, single-worker constraints, browser matrix, public/admin flow breadth, screenshots, touch/focus/hydration specs.
- Lint guard tests for admin API auth, server action same-origin, and public route rate limits.
- Migration/script safety tests, including journal invariants, reconcile coverage, e2e seed safety, and e2e server ordering.
- Auth/security/privacy tests, including sessions, rate limiting, token issuance, route wrappers, restore maintenance, backup/download, and public select-field guards.
- UI interaction tests for nav, lightbox, focus restore, zoom, swipe, touch targets, and mobile/admin deferred risks.
- Prior plan/review carry-forward items to avoid re-reporting closed public route coverage while preserving still-open admin/zoom/LR/CLIP gaps.

No production code defect was confirmed in this lane. The actionable findings are test-environment safety, integration-proof, browser-flow, matrix, visual-assertion, and opt-in evidence gaps that can let likely regressions pass current gates.
