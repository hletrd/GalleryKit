# Cycle 17 Test-Engineer Review

Date: 2026-07-08
Repo: `/Users/hletrd/flash-shared/gallery`
Role: test-engineer subagent. Scope is tests, coverage gaps, flaky tests, regression harness quality, TDD opportunities, CI/gate adequacy, fixtures, and whether tests prove the repo's stated behavior. I did not implement fixes.

## Inventory

- Repo guidance read: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, prior `.context/reviews/test-engineer.md`, and `.context/reviews/verifier-test-engineer.md`.
- Workflow guidance read: `/Users/hletrd/.agents/skills/code-review/SKILL.md`; applied only as a review format, with this report focused on test engineering.
- Test/config surface inventoried:
  - `apps/web/src/__tests__/`: 361 files total; 355 executable `*.test.ts(x)` files, 4 CLIP image fixtures, 1 `server-only` stub, and 1 untracked `.omc/.../pre-tool-advisory-throttle.json` artifact.
  - `apps/web/e2e/`: 12 files total; 9 executable `*.spec.ts` files plus `helpers.ts` and 2 image fixtures.
  - App/test/gate configs: root `package.json`, `.nvmrc`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, `apps/web/tsconfig*.json`, `apps/web/eslint.config.mjs`.
  - Gate scripts and fixtures: `apps/web/scripts/check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, `check-js-scripts.mjs`, `init-db.ts`, `migrate.js`, `run-e2e-server.mjs`, `download-clip-models.ts`, `seed-e2e.ts`.
  - Source areas cross-checked against tests: admin actions, public actions, API routes, migration/reconcile logic, auth/session/rate-limit/privacy gates, upload and Lightroom route paths, image queue/backfill/restore maintenance, service worker contracts, search/semantic search, admin token UI, public/admin e2e flows, touch-target/a11y scans.
- Inventory metrics:
  - 651 relevant source/test/script TS/TSX/JS/MJS files under `apps/web/src/app`, `components`, `lib`, `db`, `scripts`, `e2e`, and `src/__tests__`.
  - 8 API route files and 13 server-action files.
  - 3,836 Vitest `describe`/`it`/`test` declarations and 45 Playwright `test(...)` declarations.
  - 216 Vitest files use source/string-contract assertions (`readFileSync`, `toContain`, source slices, or similar).
- Sweep results:
  - No focused `.only` tests found.
  - Conditional skips found only for local/admin e2e/baseURL guards and real-CLIP env/model gates.
  - No `waitForTimeout` found; one `networkidle` wait remains in the hydration e2e.
  - No coverage command/provider/threshold/ratchet found in package, Vitest, or CI config.
- Relevant files not exhaustively read: archived `.context/plans/archive/**` and historical `.context/reviews/run*/**` artifacts. I used the current plan index and prior current review instead, because archived cycle prose is not authoritative over current HEAD.

## Confirmed Issues

### TE17-01 - No coverage report, threshold, or changed-file ratchet

- Severity: Medium
- Confidence: High
- File/region: unit test script at `apps/web/package.json:13`; Vitest config at `apps/web/vitest.config.ts:16-39`; CI unit gate at `.github/workflows/quality.yml:69-70`; absence confirmed by searching package/Vitest/workflow config for `coverage`, `threshold`, `v8`, `istanbul`, and `test:coverage`.
- Why this is a problem: the suite is large, but 216 test files are source/string-contract style. The repo has many high-risk branches in routes, server actions, migration repair, upload cleanup, and restore recovery where name-presence tests can stay green while executed behavior drops to zero.
- Concrete failure scenario: a new admin route or upload cleanup branch lands with no behavior test. `npm test` stays green because source tripwires still mention the helper names, and CI gives no signal that the changed file or branch was never executed.
- Suggested fix/test: add non-blocking V8 coverage first, then enforce a changed-file ratchet for `src/app/api`, `src/app/actions`, `src/lib`, `scripts/migrate.js`, and high-risk client components. Use reviewed exemptions for source-contract-only files instead of a broad immediate global threshold.

### TE17-02 - DB restore mysql child cleanup is source-pinned, not behavior-tested

- Severity: Medium
- Confidence: High
- File/region: source-string tests at `apps/web/src/__tests__/db-restore.test.ts:47-74` and `apps/web/src/__tests__/restore-upload-lock.test.ts:84-91`; production event/cleanup path at `apps/web/src/app/[locale]/admin/db-actions.ts:767-840`.
- Why this is a problem: restore import failure handling is operationally critical. The tests assert snippets such as `readStream.destroy()`, `restore.stdin.destroy()`, `restore.kill()`, and `keepMaintenance: true`, but do not execute fake `spawn`, stream, stdin, watchdog, close, or error events.
- Concrete failure scenario: a refactor keeps the same strings but misorders event registration, stops resolving on a close/error race, fails to kill the child on timeout, or returns success after a failed post-restore migration. Source tests can still pass while restore maintenance cleanup regresses.
- Suggested fix/test: extract or inject the restore import runner and test it with mocked `child_process.spawn`, fake read streams/stdin/stderr, and fake timers. Assert result shape, `kill()`, stream destruction, temp cleanup, watchdog cleanup, and maintenance retention for timeout, read error, stdin error, spawn error, nonzero close, migration failure, and success.

### TE17-03 - Lightroom upload route still has an incomplete failure-branch matrix

- Severity: Medium
- Confidence: High
- File/region: current behavior tests at `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:182-370`; untested route branches at `apps/web/src/app/api/admin/lr/upload/route.ts:101-158`, `:178-249`, `:252-313`, `:346-424`, and `:493-509`.
- Why this is a problem: the route is the external publish-client ingest path, with quota settlement, advisory-lock release, GPS/original cleanup, DB insert, audit, and queue side effects. Existing tests cover success, entry restore guard, missing content-length, file-count cap, low disk, and HDR rejection, but many branch outcomes are still unproved.
- Concrete failure scenario: chunked uploads, invalid multipart, missing file, bad filename/topic/title/description, total-byte cap, per-file cap, parse-slot saturation, late restore guard, lock denial, topic DB error/missing topic, settings read failure, save failure, GPS strip failure, blur-data-url assertion failure, or DB insert failure returns the wrong status or leaks quota/original files.
- Suggested fix/test: extend the handler harness with table-driven cases for each branch. For every case assert status/body plus tracker settlement, lock release, original cleanup, DB insert absence/presence, queue absence/presence, and audit absence/presence.

### TE17-04 - Admin token management UI is not covered by browser tests

- Severity: Medium
- Confidence: High
- File/region: nav exposes the page at `apps/web/src/components/admin-nav.tsx:15-24`; page/client behavior at `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx:10-22` and `tokens-client.tsx:70-128`, `:250-325`; admin e2e only navigates categories/tags/users/password/db/settings/upload at `apps/web/e2e/admin.spec.ts:20-43` and `:73-165`; action tests are server-only at `apps/web/src/__tests__/lr-tokens-action.test.ts:85-199`; UI source-contract tests at `apps/web/src/__tests__/client-source-contracts.test.ts:220-267`.
- Why this is a problem: token creation is a credential-management workflow with one-time plaintext display, copy acknowledgement, dialog blocking, label validation, list reload, and revoke confirmation. Server action tests do not prove the hydrated UI preserves the one-time secret or prevents duplicate/dropped plaintext flows.
- Concrete failure scenario: the create dialog closes but the plaintext dialog never appears, copy acknowledgement fails, Done remains disabled, the token list does not reload, or revoke confirmation targets the wrong row. Current e2e gates can pass because they never visit `/admin/tokens`.
- Suggested fix/test: add an authenticated Playwright flow: open Tokens, create a unique label, assert plaintext `gk_...` appears once, copy/acknowledge/Done closes it, assert list row appears, revoke it, and assert the row disappears. Include a validation subcase for an empty/invalid label alert.

### TE17-05 - Migration reconcile parity is still mostly name/source-based, not structural

- Severity: Medium
- Confidence: Medium
- File/region: test self-description at `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19` and index/FK tripwire scope at `:107-122`, `:216-225`; reconcile DDL path at `apps/web/scripts/migrate.js:348-740`; CI only runs normal DB init at `.github/workflows/quality.yml:72-73`.
- Why this is a problem: the repo's migration runbook requires `reconcileLegacySchema` to mirror current schema for fresh/legacy baselines. Current tests are strong tripwires for table/column/index/FK names, but they do not prove exact type, nullability, default, collation, index column order, uniqueness, or FK actions across reconcile versus normal migration.
- Concrete failure scenario: a migration changes an index order or column default. The name appears in `migrate.js`, source tests pass, but a reconcile-baselined database has different optimizer behavior or runtime insert semantics than a normally migrated database.
- Suggested fix/test: add a disposable-MySQL parity test that builds two schemas, one through normal migrations and one through reconcile/baseline, then diffs `information_schema` columns, indexes, and foreign keys. Keep source tripwires as fast authoring checks.

### TE17-06 - "Visual" nav e2e writes screenshots but has no visual assertion

- Severity: Low
- Confidence: High
- File/region: screenshots written at `apps/web/e2e/nav-visual-check.spec.ts:58`, `:72`, and `:85`; Playwright config captures failure artifacts but defines no snapshot assertions at `apps/web/playwright.config.ts:63-77`.
- Why this is a problem: the spec name and artifacts imply visual regression coverage, but the test only asserts visibility, 44 px geometry, and overlap. Color, spacing, wrapping, z-index, truncation, and responsive composition can drift while the test remains green.
- Concrete failure scenario: a nav CSS change makes the mobile expanded panel visually broken but all links remain visible, non-overlapping, and at least 44 px. The screenshots are saved as artifacts but not compared, so CI does not fail.
- Suggested fix/test: either rename the spec as geometry/artifact-only or convert the stable views to `expect(page).toHaveScreenshot(...)` with controlled fixtures and masks for dynamic content.

## Risks Needing Manual Validation

### TE17-07 - Required Playwright coverage is single-engine Desktop Chrome

- Severity: Medium
- Confidence: High
- File/region: only one Playwright project, Desktop Chrome, at `apps/web/playwright.config.ts:72-77`; CI installs only Chromium at `.github/workflows/quality.yml:75-80`.
- Why this needs manual validation: the app has mobile nav, bottom sheets, focus traps, touch swipe, clipboard, image rendering, fixed overlays, and color/HDR UI. Some tests set mobile viewport sizes, but they still run in desktop Chromium rather than mobile WebKit/Firefox.
- Concrete failure scenario: iOS/WebKit focus-trap, viewport, touch event, or fixed-position behavior regresses while Desktop Chrome passes.
- Suggested fix/test: add a small required mobile WebKit project for nav/search/photo/info-sheet/lightbox and one Firefox/WebKit desktop smoke. Keep admin specs isolated or serialized to avoid login-rate-limit collisions.

### TE17-08 - Real CLIP proof is scheduled/manual, not a PR gate

- Severity: Medium
- Confidence: High
- File/region: env/model-gated skips at `apps/web/src/__tests__/clip-offline-load.test.ts:32-41` and `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`; manual script at `apps/web/package.json:21-23`; scheduled/manual workflow at `.github/workflows/clip-preflight.yml:3-6` and `:40-45`; standard quality workflow omits it at `.github/workflows/quality.yml:69-83`.
- Why this needs manual validation: the scheduled preflight is useful, but normal PRs still skip real model loading/ranking. Dependency, model-layout, native ONNX, or path regressions can merge before the weekly/manual workflow catches them.
- Concrete failure scenario: a transformers/ONNX/cache-path change breaks offline `jina-clip-v2` loading; unit/stub tests pass, PR quality passes, and production semantic activation fails later.
- Suggested fix/test: make CLIP preflight path-filtered and required for dependency/model-path/search changes, or require a fresh manual workflow result before semantic-production changes merge.

### TE17-09 - Hydration e2e uses `networkidle` and a permissive restored-state assertion

- Severity: Low
- Confidence: Medium
- File/region: `apps/web/e2e/hydration-photo-page.spec.ts:36-49`.
- Why this needs manual validation: `networkidle` can be brittle with service workers, image waterfalls, analytics, or future polling. The restored-state assertion accepts either `/pinned/i` or `/info/i`, so it can pass without proving the desktop pinned-state restoration described in the test comments.
- Concrete failure scenario: a background request prevents `networkidle`, causing a flaky failure, or pinned-state restoration regresses but the fallback `Info` button stays visible and the test passes.
- Suggested fix/test: wait on a deterministic page readiness signal and assert the exact desktop restored state after a bounded post-hydration window. Keep the console hydration-error filter, but remove the alternate success path.

## Positive Coverage Evidence

- CI now runs lint, typecheck, custom auth/origin/public-route-rate-limit gates, production dependency audit, Vitest, DB init, Playwright e2e, and build (`.github/workflows/quality.yml:54-83`).
- Admin e2e is auto-enabled in CI through seeded local credentials (`.github/workflows/quality.yml:35-37`, `apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/helpers.ts:28-45`).
- The admin e2e now includes real topic create/delete and dashboard upload flows (`apps/web/e2e/admin.spec.ts:105-165`), so prior broad claims that admin e2e is navigation-only are no longer accurate.
- Custom security lint gates are fixture-tested and run in CI: API auth, server-action origin, and public-route rate-limit scanners.
- Migration journal monotonicity and pending/drift behavior have dedicated tests; the remaining migration concern is structural parity of reconcile output, not absence of migration coverage.
- Touch-target source audit is broad and backed by rendered nav geometry checks in Playwright; the remaining visual/a11y concern is pixel/layout comparison, not the 44 px floor.

## Final Sweep

- Checked focused/skipped tests, source-string overreliance, admin/browser e2e gates, visual screenshot assertions, browser matrix, auth/session revocation, upload quota/cleanup branches, GPS stripping, route rate limits, semantic scan caps, CLIP env gates, migration reconcile parity, touch targets, flaky waits/timers, and fixture hygiene.
- No `.only` tests found.
- Conditional skips are expected and documented: local/admin e2e/baseURL guards plus real-CLIP model gates.
- No full lint/typecheck/build/unit/e2e run was performed; this was a static review lane. Evidence came from repo inventory, targeted source/test reads, config inspection, and pattern sweeps.
- Files intentionally not exhaustively reviewed: archived historical `.context/plans/archive/**` and `.context/reviews/run*/**` artifacts. Current behavior was judged from HEAD source/tests/config plus current docs/indexes.
