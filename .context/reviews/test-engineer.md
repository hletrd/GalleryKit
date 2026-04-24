# Test Engineering Review — Cycle 3

- Repo: `/Users/hletrd/flash-shared/gallery`
- Scope: whole-repo coverage-gap + flake review (no code changes, no commit)
- Fresh verification: `npm test --workspace=apps/web` ✅ (57 files / 329 tests), `npm run test:e2e --workspace=apps/web` ❌ blocked by `ECONNREFUSED 127.0.0.1:3306` during `npm run init`

## Summary

- Unit coverage is strong around auth, rate limiting, validation, upload limits, queue bootstrap, and several security regressions.
- Highest-risk gaps are concentrated in untested destructive/admin paths (`sharing.ts`, `admin/db-actions.ts`) and in the core file-processing pipeline (`process-image.ts`, `process-topic-image.ts`).
- Main flaky/brittle surfaces are the Playwright bootstrap (`reuseExistingServer`), screenshot-only visual tests, and the admin upload poll loop with a fixed 30s DB wait.

## Findings

### 1) Untested share-link mutation flows leave the highest-concurrency admin surface without regression coverage
- **Production path**: `apps/web/src/app/actions/sharing.ts:92-185`, `188-304`, `307-388`
- **Severity**: High
- **Confidence**: High
- **Status**: Confirmed
- **Code region**: `createPhotoShareLink`, `createGroupShareLink`, `revokePhotoShareLink`, `deleteGroupShareLink`
- **Why this matters**: This file owns dual-layer rate limiting, duplicate-key retry loops, conditional updates to avoid share-key races, FK rollback handling, revalidation, and audit logging. Repo search found no direct unit or e2e coverage for these exports.
- **Concrete failure scenario**: A refactor can drop the `rollbackShareRateLimitFull()` path on duplicate/FK/infrastructure errors, causing admins to get permanently over-counted and rate-limited even though no share link was created. Another likely regression is revoking a newly regenerated share key if the conditional `WHERE share_key = oldShareKey` protection changes.
- **Suggested fix/test**: Add `apps/web/src/__tests__/sharing-actions.test.ts` mirroring the existing `public-actions.test.ts` style. Cover: invalid IDs, unprocessed image rejection, in-memory + DB counter rollback on over-limit, duplicate-key retry exhaustion, FK-delete rollback in group creation, conditional revoke returning `noActiveShareLink` when the key changed, and delete-group transaction failure mapping.

### 2) Backup / restore server actions are effectively untested despite being destructive and stateful
- **Production path**: `apps/web/src/app/[locale]/admin/db-actions.ts:33-99`, `102-235`, `245-470`
- **Severity**: High
- **Confidence**: High
- **Status**: Confirmed
- **Code region**: `exportImagesCsv`, `dumpDatabase`, `restoreDatabase`, internal `runRestore`
- **Why this matters**: Existing tests hit helpers like `db-restore.ts`, `sql-restore-scan.ts`, and the download route, but there is no direct test coverage for the server actions that coordinate auth/origin checks, advisory locks, maintenance mode, temp-file cleanup, child-process failure handling, and success-path revalidation/audit logging.
- **Concrete failure scenario**: A change to the restore early-return branches can leak the advisory lock or skip `resumeImageProcessingQueueAfterRestore()`, leaving all later restores blocked or image processing paused after a failed restore attempt. A backup-path regression could report success before the write stream flushes and produce truncated dumps.
- **Suggested fix/test**: Add `apps/web/src/__tests__/db-actions.test.ts` with mocked `spawn`, pool connections, FS streams, and maintenance helpers. Lock in: unauthorized/origin rejection, `beginRestoreMaintenance()` false branch releasing the lock, queue-resume on failure, empty-backup-file rejection, successful CSV export row escaping/warning behavior, and restore temp-file cleanup on invalid header / dangerous SQL / child-process failure.

### 3) The main image-processing pipeline has only partial EXIF coverage; file I/O and derivative generation are unguarded
- **Production path**: `apps/web/src/lib/process-image.ts:170-205`, `224-354`, `362-459`
- **Severity**: High
- **Confidence**: High
- **Status**: Confirmed
- **Code region**: `deleteImageVariants`, `saveOriginalAndGetMetadata`, `processImageFormats`
- **Why this matters**: Current tests only exercise EXIF extraction (`apps/web/src/__tests__/exif-datetime.test.ts`) plus queue orchestration with `process-image` mocked. The code that streams originals to disk, validates metadata, extracts ICC profile names, creates blur placeholders, writes multiple derivatives, deduplicates same-size renders, and verifies non-empty outputs has no direct regression suite.
- **Concrete failure scenario**: If the base-file rename/copy fallback in `processImageFormats()` regresses, uploads can finish with `*_2048.jpg` sized files present but the canonical base filename missing, producing broken gallery images in production while unit tests stay green. Another regression could leave partial files behind after a metadata read failure.
- **Suggested fix/test**: Add `apps/web/src/__tests__/process-image.test.ts` using temp directories + mocked `sharp` where needed. Cover: extension sanitization, zero-byte/oversize file rejection, cleanup on pipeline failure, ICC profile parsing bounds, `deleteImageVariants()` behavior with explicit vs empty size lists, same-width size dedupe via `copyFile`, and empty-output verification failure.

### 4) Topic-image file handling is untested even though topic CRUD depends on it for cleanup guarantees
- **Production path**: `apps/web/src/lib/process-topic-image.ts:42-106`
- **Severity**: Medium
- **Confidence**: High
- **Status**: Confirmed
- **Code region**: `processTopicImage`, `deleteTopicImage`, `cleanOrphanedTopicTempFiles`
- **Why this matters**: `topics-actions.test.ts` mocks this module entirely, so the file-type gate, temp-file cleanup, resize/write path, and orphan-temp sweeper are not actually exercised anywhere.
- **Concrete failure scenario**: A failed Sharp conversion can leave `tmp-*` files accumulating in `public/resources`, or a filename-validation regression can make `deleteTopicImage()` unlink unexpected paths without the test suite noticing.
- **Suggested fix/test**: Add `apps/web/src/__tests__/process-topic-image.test.ts` covering invalid extension/size rejection, temp-file cleanup on conversion error, successful WebP output creation, safe no-op deletion on invalid filenames, and orphaned-temp cleanup.

### 5) Search UI coverage is happy-path only; stale-response and keyboard-selection regressions are still open
- **Production path**: `apps/web/src/components/search.tsx:52-76`, `79-93`, `188-199`, `215-245`
- **Severity**: Medium
- **Confidence**: Medium
- **Status**: Likely
- **Code region**: debounced async search, request-id stale-response guard, arrow-key navigation, Enter-to-open behavior
- **Why this matters**: E2E covers opening the dialog and alias matching (`apps/web/e2e/public.spec.ts`), but there is no component-level test for the logic that prevents older async responses from overwriting newer ones or for keyboard navigation through results.
- **Concrete failure scenario**: A slower response for query `"e"` can arrive after a faster response for `"e2e"` and overwrite the result list, so the UI shows stale matches even though the current input is different. Keyboard users can also silently lose Enter-to-select behavior if `activeIndex` bookkeeping changes.
- **Suggested fix/test**: Add a client-component test with mocked `searchImagesAction`, fake timers, and deferred promises. Cover debounce timing, stale-result suppression, ArrowUp/ArrowDown focus state, Enter opening the highlighted result, and empty-query reset behavior.

### 6) `OptimisticImage` retry/fallback behavior is logic-heavy but entirely untested
- **Production path**: `apps/web/src/components/optimistic-image.tsx:18-53`
- **Severity**: Medium
- **Confidence**: Medium
- **Status**: Likely
- **Code region**: fallback swap, exponential retry timer, local-upload retry cap, terminal error state
- **Why this matters**: This component is used as the gallery fallback path when modern WebP/AVIF variants are absent, but no unit tests cover its timer-driven behavior.
- **Concrete failure scenario**: A small refactor can cause local `/uploads/...` images to retry forever, never reach the unavailable state, or append duplicate `retry=` query params incorrectly; users would see permanent loading spinners and CI would not catch it.
- **Suggested fix/test**: Add `apps/web/src/__tests__/optimistic-image.test.tsx` with fake timers and mocked `next/image`. Verify fallback promotion, one-retry cap for local uploads, five-retry cap for remote images, timer cleanup on unmount, and error message rendering after the retry budget is exhausted.

### 7) Visual-nav Playwright checks are screenshot dumps, not assertions
- **Test path**: `apps/web/e2e/nav-visual-check.spec.ts:5-39`
- **Severity**: Medium
- **Confidence**: High
- **Status**: Confirmed
- **Code region**: all three tests end in `page.screenshot({ path: ... })`
- **Why this matters**: These tests never compare against a snapshot or baseline. They pass as long as Playwright can write a PNG, even if layout, spacing, colors, or the visible controls are badly regressed.
- **Concrete failure scenario**: The mobile nav could render with collapsed controls overlapping the brand or with the menu panel off-screen; the spec would still go green because the screenshot file was created successfully.
- **Suggested fix/test**: Replace raw screenshot writes with `await expect(nav).toHaveScreenshot(...)` (or full-page baselines if desired), stabilize fonts/theme/viewport, and keep one explicit DOM assertion per test so failures explain whether the break is structural or purely visual.

### 8) Playwright bootstrap can silently bind to a stale local server instead of the freshly seeded app
- **Test/config path**: `apps/web/playwright.config.ts:54-60`
- **Severity**: Medium
- **Confidence**: Medium
- **Status**: Risk
- **Code region**: local `webServer` with `reuseExistingServer: true`
- **Why this matters**: The configured bootstrap command performs `npm run init`, `npm run e2e:seed`, and `npm run build`, but Playwright skips that entire command when something is already listening on the chosen base URL.
- **Concrete failure scenario**: A developer leaves an older dev server or previous branch running on port 3100. The suite reuses it, bypasses seeding/build, and then either flakes on missing fixtures (`/g/Abc234Def5`, `e2e-smoke`) or falsely passes against stale code/data.
- **Suggested fix/test**: Set `reuseExistingServer: false` for CI/review lanes, or gate reuse behind an explicit env var such as `PW_REUSE_SERVER=true`. Add a smoke assertion in `helpers.ts` that verifies seeded fixture data exists before running the rest of the suite.

### 9) Admin upload E2E uses fixed DB polling windows that are likely to flake under slower image-processing conditions
- **Test path**: `apps/web/e2e/admin.spec.ts:61-83`, `apps/web/e2e/helpers.ts:122-149`
- **Severity**: Medium
- **Confidence**: Medium
- **Status**: Likely
- **Code region**: upload flow + `waitForImageProcessed()` polling helper
- **Why this matters**: The test waits for async processing by polling MySQL every 500ms with a hard 30s timeout. That is sensitive to slower CI VMs, a busy image queue, or larger fixtures, and it couples a browser test directly to internal DB timing.
- **Concrete failure scenario**: The upload succeeds and the UI row appears, but background processing completes at 31s instead of 30s; the test fails spuriously even though the product behavior is correct.
- **Suggested fix/test**: Prefer a user-visible readiness signal (thumbnail variant, processed badge, delete button enabled state, or success toast after processing) plus a longer env-tunable timeout. If DB polling remains necessary, make the timeout configurable and log elapsed poll state on failure.

## Inventory

### Config / harness files inspected
 - `package.json`
 - `apps/web/package.json`
 - `apps/web/vitest.config.ts`
 - `apps/web/playwright.config.ts`
 - `apps/web/eslint.config.mjs`
 - `apps/web/next.config.ts`
 - `apps/web/drizzle.config.ts`
 - `apps/web/scripts/check-action-origin.ts`
 - `apps/web/scripts/check-api-auth.ts`
 - `apps/web/scripts/init-db.ts`
 - `apps/web/scripts/seed-e2e.ts`

### Test files inspected
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
 - `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
 - `apps/web/src/__tests__/image-queue.test.ts`
 - `apps/web/src/__tests__/image-url.test.ts`
 - `apps/web/src/__tests__/images-actions.test.ts`
 - `apps/web/src/__tests__/images-delete-revalidation.test.ts`
 - `apps/web/src/__tests__/lightbox.test.ts`
 - `apps/web/src/__tests__/live-route.test.ts`
 - `apps/web/src/__tests__/locale-path.test.ts`
 - `apps/web/src/__tests__/mysql-cli-ssl.test.ts`
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
 - `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`
 - `apps/web/src/__tests__/shared-page-title.test.ts`
 - `apps/web/src/__tests__/sql-restore-scan.test.ts`
 - `apps/web/src/__tests__/storage-local.test.ts`
 - `apps/web/src/__tests__/tag-input.test.ts`
 - `apps/web/src/__tests__/tag-records.test.ts`
 - `apps/web/src/__tests__/tag-slugs.test.ts`
 - `apps/web/src/__tests__/tags-actions.test.ts`
 - `apps/web/src/__tests__/topics-actions.test.ts`
 - `apps/web/src/__tests__/upload-dropzone.test.ts`
 - `apps/web/src/__tests__/upload-limits.test.ts`
 - `apps/web/src/__tests__/upload-tracker.test.ts`
 - `apps/web/src/__tests__/validation.test.ts`
 - `apps/web/e2e/admin.spec.ts`
 - `apps/web/e2e/helpers.ts`
 - `apps/web/e2e/nav-visual-check.spec.ts`
 - `apps/web/e2e/origin-guard.spec.ts`
 - `apps/web/e2e/public.spec.ts`
 - `apps/web/e2e/test-fixes.spec.ts`

### Production areas inventoried
 - App routes/actions: `apps/web/src/app/**`
 - Components: `apps/web/src/components/**`
 - Libraries: `apps/web/src/lib/**`
 - DB layer: `apps/web/src/db/**`
 - Middleware/proxy: `apps/web/src/proxy.ts`
 - i18n/runtime glue: `apps/web/src/i18n/**`, `apps/web/src/instrumentation.ts`

## Verification

- `npm test --workspace=apps/web` → passed (`57` files, `329` tests).
- `npm run test:e2e --workspace=apps/web` → failed before test execution because `npm run init` could not connect to MySQL at `127.0.0.1:3306`.

## Final skipped-file sweep

- **Reviewed and intentionally not escalated**: `apps/web/src/lib/session.ts`, `rate-limit.ts`, `request-origin.ts`, `serve-upload.ts`, `csv-escape.ts`, `sql-restore-scan.ts`, `restore-maintenance.ts`, `auth-rate-limit.ts`, `validation.ts`, `revalidation.ts`, `gallery-config-shared.ts`, `check-action-origin.ts`, and `check-api-auth.ts` because they already have targeted regression coverage that matches the current risk level.
- **Inventoried but not called out as findings**: public/admin route wrappers, metadata endpoints (`manifest.ts`, `robots.ts`, `sitemap.ts`, `api/og/route.tsx`), and several client components (`home-client.tsx`, `image-manager.tsx`, `photo-navigation.tsx`, `tag-filter.tsx`) remain partially covered via page/e2e tests; they are lower priority than the file-processing and admin mutation gaps above.
- **Skipped as low-signal for this review**: generated `.next/**`, `node_modules/**`, static assets, CSS-only files, and most `components/ui/**` wrapper primitives unless they participated in a higher-level failing flow.
