# Cycle 1 Test Strategy + Coverage Review

## Scope and method
- Reviewed **all test-relevant files in-repo; no sampling**.
- Examined: root/package test entrypoints, Playwright/Vitest config, every `apps/web/e2e/*` spec and helper, every `apps/web/src/__tests__/*.test.ts`, test-related scripts under `apps/web/scripts/`, `.github` CI surface, and the full `apps/web/src/**/*.{ts,tsx}` source inventory to spot uncovered critical paths.
- Coverage map note: direct unit-import coverage and e2e coverage are different. Several files are indirectly exercised by e2e, but many critical server/background paths still have **no direct regression test coverage**.

---

## Inventory of examined files

### Root / CI / entrypoint files
- `package.json`
- `.github/dependabot.yml`
- `.github/assets/logo.svg`
- `.github/workflows/` **does not exist**

### App test/config files
- `apps/web/package.json`
- `apps/web/playwright.config.ts`
- `apps/web/vitest.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.scripts.json`

### Playwright E2E files
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/helpers.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`

### Vitest files
- `apps/web/src/__tests__/action-guards.test.ts`
- `apps/web/src/__tests__/admin-user-create-ordering.test.ts`
- `apps/web/src/__tests__/admin-users.test.ts`
- `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/auth-rethrow.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/backup-filename.test.ts`
- `apps/web/src/__tests__/base56.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-api-auth.test.ts`
- `apps/web/src/__tests__/clipboard.test.ts`
- `apps/web/src/__tests__/csv-escape.test.ts`
- `apps/web/src/__tests__/data-pagination.test.ts`
- `apps/web/src/__tests__/db-pool-connection-handler.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/exif-datetime.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/health-route.test.ts`
- `apps/web/src/__tests__/histogram.test.ts`
- `apps/web/src/__tests__/image-url.test.ts`
- `apps/web/src/__tests__/images-actions.test.ts`
- `apps/web/src/__tests__/lightbox.test.ts`
- `apps/web/src/__tests__/live-route.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
- `apps/web/src/__tests__/next-config.test.ts`
- `apps/web/src/__tests__/photo-title.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/queue-shutdown.test.ts`
- `apps/web/src/__tests__/rate-limit.test.ts`
- `apps/web/src/__tests__/request-origin.test.ts`
- `apps/web/src/__tests__/restore-maintenance.test.ts`
- `apps/web/src/__tests__/revalidation.test.ts`
- `apps/web/src/__tests__/safe-json-ld.test.ts`
- `apps/web/src/__tests__/sanitize.test.ts`
- `apps/web/src/__tests__/seo-actions.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/session.test.ts`
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/tag-input.test.ts`
- `apps/web/src/__tests__/tag-records.test.ts`
- `apps/web/src/__tests__/tag-slugs.test.ts`
- `apps/web/src/__tests__/tags-actions.test.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`
- `apps/web/src/__tests__/upload-dropzone.test.ts`
- `apps/web/src/__tests__/upload-tracker.test.ts`
- `apps/web/src/__tests__/validation.test.ts`

### Test-related scripts reviewed
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/migrate-admin-auth.ts`
- `apps/web/scripts/migrate-aliases.ts`
- `apps/web/scripts/migrate-capture-date.js`
- `apps/web/scripts/migrate-titles.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/migration-add-column.ts`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/scripts/seed-admin.ts`
- `apps/web/scripts/seed-e2e.ts`

### Source inventory sweep summary
- Examined the full `apps/web/src/**/*.{ts,tsx}` inventory.
- Counted **148** source files under `apps/web/src` (excluding test files from the risk map).
- Only **47** files are directly imported by unit tests.
- **104** source files have no direct unit-import coverage. Highest-risk uncovered groups include:
  - auth action surface: `apps/web/src/app/actions/auth.ts:70-411`
  - settings actions: `apps/web/src/app/actions/settings.ts:16-136`
  - sharing actions: `apps/web/src/app/actions/sharing.ts:18-388`
  - image processing queue: `apps/web/src/lib/image-queue.ts:23-399`
  - topic image processing: `apps/web/src/lib/process-topic-image.ts:10-106`
  - local storage backend: `apps/web/src/lib/storage/local.ts:22-119`
  - upload routes: `apps/web/src/app/uploads/[...path]/route.ts:1-10`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:1-10`
  - critical admin/public client surfaces such as `apps/web/src/components/nav.tsx`, `search.tsx`, `home-client.tsx`, `photo-viewer.tsx`, `apps/web/src/app/[locale]/admin/login-form.tsx`, and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`

---

## Findings

### 1) “Visual” Playwright checks never assert against a baseline or DOM invariant
- **Type**: Confirmed issue
- **Severity**: High
- **Confidence**: High
- **Files / region**: `apps/web/e2e/nav-visual-check.spec.ts:4-33`
- **Why this is a problem**: Each test just takes a screenshot to `test-results/*.png` and exits. There is no `toHaveScreenshot`, no snapshot diff, and no follow-up DOM/layout assertion beyond nav visibility.
- **Concrete failure scenario**: The mobile menu could render off-screen, lose spacing, or regress colors/stacking, and CI would still pass because file creation is treated as success.
- **Suggested fix**: Convert these to true visual regression tests with `expect(page).toHaveScreenshot(...)` (or element-level snapshots), commit baselines, and keep one or two semantic assertions per screen.
- **TDD opportunity**: Start with a failing snapshot for the current nav states, then tighten only the specific unstable regions if needed.

### 2) Heading-hierarchy regression test contains a tautological assertion
- **Type**: Confirmed issue
- **Severity**: Medium
- **Confidence**: High
- **Files / region**: `apps/web/e2e/public.spec.ts:85-99`
- **Why this is a problem**: The test comment says at least one photo-card `h3` must exist, but the assertion is `expect(h3Count).toBeGreaterThanOrEqual(0)`, which always passes.
- **Concrete failure scenario**: If the gallery renders no `h3` headings at all, this WCAG regression still passes, so the advertised regression guard is ineffective.
- **Suggested fix**: Change to a meaningful contract such as `expect(h3Count).toBeGreaterThan(0)` or target a specific photo-card heading.
- **TDD opportunity**: Write the assertion first against a deliberately broken local branch/component story to ensure it fails when headings disappear.

### 3) Origin-guard E2E accepts outcomes that can hide a broken or missing route
- **Type**: Confirmed issue
- **Severity**: High
- **Confidence**: High
- **Files / region**: `apps/web/e2e/origin-guard.spec.ts:27-60`
- **Why this is a problem**:
  - The security assertion accepts `404` as success (`expect([401, 403, 404]).toContain(...)`).
  - The “sanity” request also accepts redirects (`200/301/302/307/308`), so it does not prove the specific admin route exists or that the earlier 404 was security-related.
- **Concrete failure scenario**: `/api/admin/db/download` could be accidentally removed or misrouted; the spoofed-origin test would still pass on 404 and falsely report the origin guard as covered.
- **Suggested fix**: Make the spoofed-origin expectation exact (`401` or `403` only), and add a control assertion against the same route under an allowed-origin condition or at least assert the route exists independently.
- **TDD opportunity**: Add a red test case that fails when the route returns 404, then harden the route-specific assertion.

### 4) Admin upload E2E mutates seeded state without cleanup, so the suite is not hermetic
- **Type**: Confirmed issue
- **Severity**: Medium
- **Confidence**: High
- **Files / region**: `apps/web/e2e/admin.spec.ts:61-76`
- **Why this is a problem**: The test uploads a new image with a timestamped filename and never removes it. Unlike the GPS-toggle test, there is no rollback/cleanup.
- **Concrete failure scenario**: Re-running against a reused local server or an opted-in remote admin target steadily changes dashboard counts/content and can make later assertions order-dependent or environment-dependent.
- **Suggested fix**: Either clean up the uploaded record/file in teardown, upload into a disposable topic seeded per run, or reset the dataset between tests instead of only before the Playwright server boot.
- **TDD opportunity**: Add a postcondition assertion that the uploaded artifact is deleted or the dataset returns to baseline after the test.

### 5) CI gate is effectively absent at the repo level
- **Type**: Confirmed issue
- **Severity**: High
- **Confidence**: High
- **Files / region**: `package.json:10-15`, `.github/` inventory (no `.github/workflows/*`), `apps/web/package.json:8-21`
- **Why this is a problem**: The workspace root exposes only `dev/build/start/deploy`; there is no root `test`, `lint`, or `typecheck` script, and there are no GitHub workflow files to enforce them in CI.
- **Concrete failure scenario**: A contributor can merge code that never ran `vitest`, Playwright, or the custom security lint gates, because there is no repository-level automation to require them.
- **Suggested fix**: Add root scripts that delegate to `apps/web` (`test`, `test:e2e`, `lint`, `typecheck`, security gate scripts) and wire them into a CI workflow.
- **TDD opportunity**: Add the root commands first, then make the workflow fail fast on missing gates.

### 6) Auth action coverage is mostly static-text inspection, not behavioral verification
- **Type**: Likely risk
- **Severity**: High
- **Confidence**: High
- **Files / region**:
  - Runtime surface: `apps/web/src/app/actions/auth.ts:70-411`
  - Current tests: `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:19-78`, `apps/web/src/__tests__/auth-rethrow.test.ts:16-53`
- **Why this is a problem**: Critical auth flows are guarded mainly by source-text searches (`readFileSync` + `indexOf`/regex). That catches some reordering, but it does **not** prove runtime outcomes: cookie creation/deletion, redirects, session invalidation, rate-limit rollback, or unhappy-path error handling.
- **Concrete failure scenario**: A refactor could preserve the matching strings while breaking actual behavior (wrong branch reached, rollback not awaited, session deletion skipped, redirect path wrong, cookie flags wrong).
- **Suggested fix**: Add behavioral unit tests around `login`, `logout`, and `updatePassword` with mocked `cookies`, `headers`, DB, Argon2, and rate-limit helpers. Keep one or two static tests if desired, but demote them to supplementary guards.
- **TDD opportunity**: Start with failing tests for: successful login sets a session cookie and redirects, failed login increments but does not reset, successful password change clears stale sessions, unexpected password-change failure rolls back the pre-increment.

### 7) Settings action surface has zero direct regression coverage despite high-value branching
- **Type**: Likely risk
- **Severity**: High
- **Confidence**: High
- **Files / region**: `apps/web/src/app/actions/settings.ts:16-136`
- **Why this is a problem**: `updateGallerySettings` includes auth/origin checks, sanitization, allowed-key validation, image-size normalization, processed-image locking, transaction semantics, audit logging, and cache revalidation, but there is no corresponding `settings*.test.ts`.
- **Concrete failure scenario**: A regression in `image_sizes` normalization or the processed-image lock (`imageSizesLocked`) could silently allow incompatible settings after images are processed, breaking derivative generation or viewer assumptions.
- **Suggested fix**: Add focused unit tests for invalid keys, control-char stripping, normalized `image_sizes`, lock behavior when processed images exist, and “empty value deletes setting” transaction behavior.
- **TDD opportunity**: Write the failing `image_sizes` lock test first; it is the most business-critical branch in the file.

### 8) Share-link creation/revocation flows are uncovered even though they contain concurrency/rate-limit logic
- **Type**: Likely risk
- **Severity**: High
- **Confidence**: High
- **Files / region**: `apps/web/src/app/actions/sharing.ts:18-388`
- **Why this is a problem**: This file carries custom in-memory + DB-backed rate limiting, rollback logic, duplicate-key retry loops, FK-recovery handling, and conditional revocation to avoid races. There is no direct test file covering any of it.
- **Concrete failure scenario**: A future change could double-charge rate limits, fail to roll back after `ER_DUP_ENTRY` / `ER_NO_REFERENCED_ROW_2`, or revoke a newly rotated share key due to a race, and the current suite would not catch it.
- **Suggested fix**: Add direct unit tests for `createPhotoShareLink`, `createGroupShareLink`, `revokePhotoShareLink`, and `deleteGroupShareLink`, especially the rollback/error branches.
- **TDD opportunity**: Start with the race-sensitive revocation case (`affectedRows === 0` after key changed) and the FK-violation rollback path.

### 9) Background image processing and storage safety paths are largely untested
- **Type**: Likely risk
- **Severity**: High
- **Confidence**: Medium
- **Files / region**:
  - `apps/web/src/lib/image-queue.ts:23-399`
  - `apps/web/src/lib/process-topic-image.ts:42-106`
  - `apps/web/src/lib/storage/local.ts:22-119`
- **Why this is a problem**: These files implement crash cleanup, retry/claim behavior, processed-file verification, temp-file cleanup, path-traversal blocking, symlink rejection, and stream writes. They are operationally critical but have no direct coverage.
- **Concrete failure scenario**: A path-normalization regression in `LocalStorageBackend.resolve()` or a queue retry/cleanup regression could expose files outside `UPLOAD_ROOT`, leak temp files, or mark images processed before derivatives exist.
- **Suggested fix**: Add isolated unit tests for path traversal/symlink rejection in storage, invalid image/topic temp-file cleanup, and queue-state transitions (`claimRetryCounts`, deletion during processing, processed-file verification failure).
- **TDD opportunity**: Begin with the storage traversal/symlink tests because they are cheap, deterministic, and high-signal.

### 10) Current `createAdminUser` runtime coverage is too thin for such a sensitive flow
- **Type**: Likely risk
- **Severity**: Medium
- **Confidence**: High
- **Files / region**:
  - `apps/web/src/__tests__/admin-users.test.ts:95-124`
  - `apps/web/src/__tests__/admin-user-create-ordering.test.ts:22-146`
  - Target runtime file: `apps/web/src/app/actions/admin-users.ts` (entire `createAdminUser` flow)
- **Why this is a problem**: There is only **one** behavioral unit test (`mismatched password confirmation`) plus a static source-ordering file. Sensitive branches like duplicate-username rollback, auth/origin rejection, maintenance rejection, success path audit/revalidation, and rate-limit exhaustion are not behaviorally verified.
- **Concrete failure scenario**: The duplicate-username rollback branch could stop resetting counters at runtime while the string-based ordering test still passes.
- **Suggested fix**: Expand `admin-users.test.ts` into small behavior tests: unauthorized, origin failure, duplicate username, successful create, rate-limited create, and rollback on DB failure.
- **TDD opportunity**: Write the duplicate-username rollback test first because the file already documents that business rule.

---

## Additional observations
- Test harness quality is mixed:
  - Good: many focused unit tests in utilities (`rate-limit`, `validation`, `request-origin`, `gallery-config-shared`, `upload-tracker`).
  - Weak areas cluster around **server actions**, **background processing**, and **visual/admin E2E**.
- Playwright is intentionally serialized (`apps/web/playwright.config.ts` uses `workers: 1`, `fullyParallel: false`), which reduces flake but also hides shared-state leaks rather than fixing them.
- The repo includes custom static lint gates (`check-action-origin.ts`, `check-api-auth.ts`) with decent unit coverage, but those gates are not wired into any visible CI workflow.

---

## Missed-issues sweep
Final sweep looked specifically for weak assertions, fixture leakage, and unowned critical paths:
- Weak assertions found in `nav-visual-check.spec.ts`, `public.spec.ts`, and `origin-guard.spec.ts`.
- Fixture/data isolation gap found in `admin.spec.ts` upload flow.
- CI gate gap confirmed from root scripts + missing workflow directory.
- Highest-risk uncovered runtime areas remain `auth.ts`, `settings.ts`, `sharing.ts`, `image-queue.ts`, `process-topic-image.ts`, and `storage/local.ts`.

No additional confirmed defects surfaced beyond the findings above, but the uncovered runtime surface is still large enough that I would treat the suite as **needs attention**, not release-blocking only because some core utility/security helpers are already covered.

## Overall assessment
- **Coverage shape**: Strong utility coverage, weak server-action/background/visual coverage.
- **Test health**: **NEEDS ATTENTION**.
- **Top priorities to fix next**:
  1. Make Playwright assertions real (`toHaveScreenshot`, remove tautologies, tighten security statuses).
  2. Add behavioral tests for `auth.ts`, `settings.ts`, and `sharing.ts`.
  3. Add repo-level CI gates for unit/e2e/security checks.
