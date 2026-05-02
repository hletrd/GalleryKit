# Test Engineer Review — Cycle 1

Review target: `/Users/hletrd/flash-shared/gallery` on 2026-05-02. I only wrote this report; I did not edit application code. At review time the worktree already contained non-report changes in `apps/web/messages/*.json`, `apps/web/src/components/{image-zoom,photo-navigation,photo-viewer}.tsx`, and an untracked `apps/web/src/__tests__/image-zoom-math.test.ts`; I inspected the current tree but will not stage those files.

## Test/source inventory

- **Unit tests:** 85 Vitest files under `apps/web/src/__tests__`, 607 tests passing locally. Config only includes `src/__tests__/**/*.test.ts` (`apps/web/vitest.config.ts:10-12`) and uses the default Node environment (`setup 0ms`, `environment 10ms` in the run output), so there is no first-class TSX/jsdom component-test lane.
- **E2E tests:** 22 Playwright tests in 5 spec files (`apps/web/e2e/admin.spec.ts`, `nav-visual-check.spec.ts`, `origin-guard.spec.ts`, `public.spec.ts`, `test-fixes.spec.ts`) plus `helpers.ts` and two JPG fixtures. `npx playwright test --list` from `apps/web` confirmed the 22 tests.
- **Source surface:** 158 TS/TSX source files outside `src/__tests__` were inventoried. Covered areas include:
  - `src/lib/*`: broad behavioral coverage for validation, sanitization, rate limits, sessions, image URLs, image processing helpers, queues, restore/backup utilities, storage, DB restore, JSON-LD, locale paths, CSV escaping, and config parsing.
  - `src/app/actions/*`: mocked unit coverage for `images`, `admin-users`, `topics`, `tags`, `seo`, and `public`; `auth` and `settings` rely heavily on static/source-contract tests.
  - `src/app/api/*` and upload routes: health/live/backup/upload serving route tests plus source-contract checks.
  - UI/components: helper-level tests for lightbox/histogram/tag-input/upload-dropzone plus E2E coverage of public nav/search/lightbox/admin smoke; little direct render/event coverage for complex client components.
- **Quality gates inspected:** root/app package scripts (`package.json:11-21`, `apps/web/package.json:8-25`), Vitest (`apps/web/vitest.config.ts:10-12`), Playwright (`apps/web/playwright.config.ts:48-80`), ESLint (`apps/web/eslint.config.mjs:5-19`), and CI (`.github/workflows/quality.yml:54-79`).

## Verification performed

- `npm test` — **pass**, 85 files / 607 tests.
- `npm run lint` — **pass**.
- `npm run typecheck` — **pass**.
- `npm run lint:api-auth` — **pass**.
- `npm run lint:action-origin` — **pass**.
- `npx playwright test --list` in `apps/web` — **pass**, lists 22 E2E tests.
- `npm run test:e2e -- --list` from repo root — **blocked locally**: the root wrapper did not pass `--list` through to Playwright and the web server attempted DB init, then failed on missing `DB_NAME`.
- `npm run build` — **blocked locally** by a pre-existing `.next/lock` (`Another next build process is already running`); not counted as a test finding.

## Findings

### HIGH 1 — Touch-target audit misses `global-error.tsx`, and the missed file already has a sub-44px primary button

- **Evidence:** The audit documents that it walks `SCAN_ROOTS` recursively (`apps/web/src/__tests__/touch-target-audit.test.ts:14-24`) but `SCAN_ROOTS` only contains `componentsDir` and `adminDir` (`apps/web/src/__tests__/touch-target-audit.test.ts:49-52`). Its forbidden rules explicitly flag HTML buttons with `h-10` as 40px touch targets (`apps/web/src/__tests__/touch-target-audit.test.ts:257-260`). `apps/web/src/app/global-error.tsx` is outside both roots and renders the fatal reset button with `h-10` (`apps/web/src/app/global-error.tsx:71-75`).
- **Failure scenario:** A fatal app error page can ship with a 40px primary reset target while the WCAG/mobile touch-target gate stays green because that route is never scanned.
- **Suggested fix/test:** Expand `SCAN_ROOTS` to include all app-level error/public route TSX files or scan `src/app` with documented exemptions; then either fix `global-error.tsx` to `min-h-11`/`h-11` or add a narrowly justified exemption that fails on new violations.
- **Confidence:** High. **Status:** Confirmed.

### HIGH 2 — Password-change behavior is not tested beyond route visibility and static source text

- **Evidence:** E2E only clicks to `/admin/password` and checks that `input[name="currentPassword"]` exists (`apps/web/e2e/admin.spec.ts:36-38`). The main unit coverage for `updatePassword` reads `auth.ts` as text (`apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:20-26`) and asserts substrings/order such as session rotation and cookie setting (`apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:97-103`). The actual server action verifies the current password, hashes the new one, rotates sessions, sets a cookie, and clears rate limits (`apps/web/src/app/actions/auth.ts:281-425`). The client-side form has its own mismatch branch before calling the server action (`apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:29-38`).
- **Failure scenario:** A regression where `PasswordForm` never calls `formAction`, `argon2.verify` is bypassed, sessions are not actually rotated, or the cookie is not set can pass the current static tests if the expected strings remain in the file.
- **Suggested fix/test:** Add behavioral unit tests for `updatePassword` with mocked `db`, `argon2`, `headers`, and `cookies`: unauthorized, mismatch/length validation before rate-limit, incorrect current password, successful hash/session/cookie rotation, DB failure, and rate-limit rollback/clear cases. Add a TSX component test for client mismatch and submit wiring. Consider a guarded E2E that changes to a temporary password and restores it in `finally`.
- **Confidence:** High. **Status:** Confirmed coverage gap / likely regression risk.

### HIGH 3 — Settings persistence path is barely covered; the E2E toggle test does not save or reload

- **Evidence:** The admin settings E2E flips `#strip-gps` and asserts the switch `data-state` changes, then flips it back (`apps/web/e2e/admin.spec.ts:45-63`). The Save button and async `handleSave` path are separate (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:34-68`, button at `settings-client.tsx:84-87`), while the switch only updates local state (`settings-client.tsx:175-179`). The server action has validation, same-origin checks, upload-lock checks, image-size/GPS lock behavior, a transaction, audit, and revalidation (`apps/web/src/app/actions/settings.ts:40-166`). Existing settings coverage is only a static source slice for `image_sizes` locking (`apps/web/src/__tests__/settings-image-sizes-lock.test.ts:5-22`).
- **Failure scenario:** `updateGallerySettings` can stop persisting settings, same-origin protection can break, GPS/image-size locks can regress, or revalidation can be removed; the E2E still passes because it only observes client state before Save.
- **Suggested fix/test:** Add mocked behavioral tests for `updateGallerySettings` covering invalid keys/values, delete-default behavior, successful upsert transaction, image-size and GPS locks with existing images, active upload lock, same-origin failure, audit/revalidation calls. Upgrade E2E to click Save, wait for the success toast, reload, assert persisted state, and restore via `try/finally` or an isolated seeded DB.
- **Confidence:** High. **Status:** Confirmed coverage gap.

### MEDIUM 1 — Many critical invariants are locked with source-text tests instead of behavior or AST-aware checks

- **Evidence:** `auth-rate-limit-ordering.test.ts` says it is a static-text check (`apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:13-18`) and then relies on `indexOf`/`toContain` strings (`apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:31-103`). `resolved-stream-source.test.ts` passes if exact strings are present/absent (`apps/web/src/__tests__/resolved-stream-source.test.ts:8-19`). `data-view-count-flush.test.ts` explicitly chooses fixture/source inspection instead of behavioral tests (`apps/web/src/__tests__/data-view-count-flush.test.ts:13-19`). `settings-image-sizes-lock.test.ts` slices source text (`apps/web/src/__tests__/settings-image-sizes-lock.test.ts:5-17`).
- **Failure scenario:** Strings can survive in comments/dead branches while behavior changes, or harmless refactors can break tests even when behavior is correct. This weakens high-value invariants around auth, path traversal prevention, rate-limit semantics, and DB flush safety.
- **Suggested fix/test:** Keep a small number of source-contract sentinels where useful, but move load-bearing checks to behavioral tests with mocked dependencies or AST-level assertions that ignore comments/dead code. Extract hard-to-test units (for example view-count buffer/flush state) behind injectable dependencies.
- **Confidence:** High. **Status:** Confirmed.

### MEDIUM 2 — “Visual” E2E tests only write screenshots; they do not compare them to baselines

- **Evidence:** `nav-visual-check.spec.ts` writes three PNGs with `page.screenshot` (`apps/web/e2e/nav-visual-check.spec.ts:14`, `apps/web/e2e/nav-visual-check.spec.ts:27`, `apps/web/e2e/nav-visual-check.spec.ts:39`). Playwright is configured to keep screenshots only on failure (`apps/web/playwright.config.ts:58-60`); there is no `toHaveScreenshot` baseline assertion in the visual spec.
- **Failure scenario:** A nav spacing/overflow/theme regression can ship if the controls still exist and are visible; CI will only leave unasserted screenshots, not fail the gate.
- **Suggested fix/test:** Replace artifact-only screenshots with `await expect(nav).toHaveScreenshot(...)` using stable masks/styles, or remove “visual” from the test name and add explicit layout assertions (bounding boxes/no horizontal overflow). Upload screenshot artifacts on failure.
- **Confidence:** High. **Status:** Confirmed.

### MEDIUM 3 — No dedicated render/event test lane for complex client components

- **Evidence:** Vitest includes only `.test.ts` files under `src/__tests__` (`apps/web/vitest.config.ts:10-12`), and the package `test` script is plain `vitest run` (`apps/web/package.json:13`). Complex client components contain substantial browser/event behavior, e.g. `ImageZoom` wheel, click, touch, keyboard, reduced-motion, and transform handling (`apps/web/src/components/image-zoom.tsx:102-356`) and `PasswordForm` local validation/submit wiring (`apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:29-38`).
- **Failure scenario:** Event handlers, ARIA state, focus management, or DOM style updates can break while pure helper tests and E2E smoke still pass.
- **Suggested fix/test:** Add a `jsdom`/RTL (or Playwright component) lane and include `.test.tsx`; render `ImageZoom`, `PasswordForm`, `NavClient`, `SettingsClient`, and `PhotoViewer` interaction paths. Export pure helper functions from source when testing math-heavy behavior.
- **Confidence:** High. **Status:** Confirmed / likely risk.

### MEDIUM 4 — Local E2E gate is all-or-nothing on DB fixtures, so public smoke tests cannot run in an unseeded checkout

- **Evidence:** Playwright always starts the local web server for localhost runs (`apps/web/playwright.config.ts:71-78`). That server unconditionally runs init, E2E seed, and build before serving (`apps/web/scripts/run-e2e-server.mjs:75-78`). The app E2E script is plain `env -u NO_COLOR npx playwright test` (`apps/web/package.json:20`). Locally, `npm run test:e2e -- --list` from the repo root attempted server startup and failed before tests on missing `DB_NAME`.
- **Failure scenario:** Developers without the full DB env cannot run even public/nav smoke tests or reliably list E2E tests from the root wrapper, so fixture drift is discovered later in CI instead of before push.
- **Suggested fix/test:** Add a preflight env check with an actionable message, plus separate scripts such as `test:e2e:list`, `test:e2e:public`, and `test:e2e:admin`. Ensure root script argument forwarding works (`npm run test:e2e --workspace=apps/web -- --list`) and document `E2E_ENV_FILE` setup.
- **Confidence:** High. **Status:** Confirmed locally; CI has DB env.

### MEDIUM 5 — Admin upload E2E can leave database/filesystem fixture drift on mid-test failure

- **Evidence:** The upload test creates a unique file name (`apps/web/e2e/admin.spec.ts:73`), uploads it, waits for DB processing (`apps/web/e2e/admin.spec.ts:80-85`), and deletes it only at the end (`apps/web/e2e/admin.spec.ts:86-88`). There is no `try/finally`. The helper polls the DB for up to 30s and throws on timeout (`apps/web/e2e/helpers.ts:151-172`). The seed script resets the fixed E2E topic/group at startup (`apps/web/scripts/seed-e2e.ts:168-253`), but uploaded rows after seed are not cleaned if the test aborts before the delete step.
- **Failure scenario:** A processing timeout, selector failure, or delete-dialog regression leaves an uploaded image row and files behind. Subsequent local runs or CI retries can see extra homepage/admin rows, causing order-dependent flakes or masking seed assumptions.
- **Suggested fix/test:** Wrap upload cleanup in `try/finally` and delete by unique `user_filename` via admin action/API/DB even if assertions fail. Prefer per-run topic/group keys or a DB transaction/cleanup fixture for Playwright.
- **Confidence:** Medium. **Status:** Likely fixture-drift risk.

### LOW 1 — Cross-browser/mobile coverage is limited to Chromium with manually-set viewports

- **Evidence:** Playwright defines only one project, Desktop Chrome (`apps/web/playwright.config.ts:65-70`), and CI installs only Chromium (`.github/workflows/quality.yml:71-73`). Mobile tests set viewport sizes manually (`apps/web/e2e/nav-visual-check.spec.ts:5-18`, `apps/web/e2e/test-fixes.spec.ts:15-57`) rather than using real mobile browser/device projects.
- **Failure scenario:** Safari/WebKit focus, touch, dialog, clipboard, and viewport behavior can regress without a gate, especially for the mobile nav, info sheet, and lightbox interactions.
- **Suggested fix/test:** Add a small WebKit/mobile project for public nav/search/lightbox and mobile info sheet smoke, while keeping the full admin/upload suite Chromium-only if runtime is a concern.
- **Confidence:** High. **Status:** Risk.

### LOW 2 — Failure artifacts are retained by Playwright but not uploaded by CI

- **Evidence:** Playwright retains trace/video/screenshots on failure (`apps/web/playwright.config.ts:58-60`). The workflow runs E2E and then build (`.github/workflows/quality.yml:75-79`) but has no failure-only `actions/upload-artifact` step for `apps/web/test-results` or `apps/web/playwright-report`.
- **Failure scenario:** Intermittent E2E failures lose the trace/video context after CI completion, making flaky admin upload/navigation failures harder to diagnose.
- **Suggested fix/test:** Add an `if: failure()` artifact upload step for Playwright outputs, and optionally HTML report retention.
- **Confidence:** Medium. **Status:** Confirmed workflow gap.

## TDD opportunities

1. Start with failing behavioral tests for `updatePassword` and `updateGallerySettings` before changing those actions; both have source-contract coverage but need red/green runtime assertions.
2. Add a first `.test.tsx` render test for `PasswordForm` mismatch handling and submit wiring, then use the same setup for `SettingsClient` Save/reload state and `ImageZoom` keyboard/click state.
3. Convert `nav-visual-check` to real screenshot assertions and commit the baseline images as the first visual-regression TDD loop.
4. Extract view-count flush state into a small injectable module, then replace source-slice tests with behavioral tests for swap-before-write, retry cap, and backoff.

## Final missed-issues sweep

- Searched for `.skip`, `.only`, `page.screenshot`, `waitForTimeout`, `Date.now`, and source-reading tests. Result: 7 skip sites (admin/origin guard opt-in/baseURL skips), 0 `.only`, 3 unasserted screenshot writes, no `waitForTimeout`.
- Searched for source-text tests (`readFileSync`, `indexOf`, `toContain`, `toMatch`) and sampled all load-bearing examples cited above.
- Re-inventoried unit/E2E test counts after the current worktree changed: 85 unit test files and 22 E2E tests.
- Skipped files: binary image fixtures (`apps/web/e2e/fixtures/*.jpg`), generated screenshots/logs/artifacts under `.context/`, `.next/`, `test-results`, and `playwright-report`, dependency folders, and historical `.context/plans/*` documents. I did inspect all active test/config/gate files and source files tied to findings.

## Severity counts

- High: 3
- Medium: 5
- Low: 2
- Total findings: 10
