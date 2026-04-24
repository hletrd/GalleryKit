# Test Engineer Review — PROMPT 1 / cycle 4

## Scope
- Repo: `/Users/hletrd/flash-shared/gallery`
- Focus: test coverage gaps, flaky tests, missing regression tests, false confidence, TDD opportunities, and gate robustness.
- Method: inventoried source/test files, traced source↔test coverage, inspected high-risk server actions / image pipeline / startup hooks / E2E harness, and checked test-runner configuration.

## Inventory

### Source inventory (apps/web/src)
- `app/`: 55 files
- `components/`: 44 files
- `lib/`: 46 files
- `db/`: 3 files
- `i18n/`: 1 file
- top-level: `instrumentation.ts`, `proxy.ts`, `site-config*.json`

### Test inventory
- Unit/integration-style Vitest files: 57
- Playwright E2E/support files: 6
- No coverage configuration or thresholds are present in `apps/web/vitest.config.ts:10-12`.

### Full source file list
```text
apps/web/src/app/[locale]/(public)/[topic]/page.tsx
apps/web/src/app/[locale]/(public)/g/[key]/page.tsx
apps/web/src/app/[locale]/(public)/layout.tsx
apps/web/src/app/[locale]/(public)/p/[id]/page.tsx
apps/web/src/app/[locale]/(public)/page.tsx
apps/web/src/app/[locale]/(public)/s/[key]/page.tsx
apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts
apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx
apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx
apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx
apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx
apps/web/src/app/[locale]/admin/(protected)/db/page.tsx
apps/web/src/app/[locale]/admin/(protected)/error.tsx
apps/web/src/app/[locale]/admin/(protected)/layout.tsx
apps/web/src/app/[locale]/admin/(protected)/loading.tsx
apps/web/src/app/[locale]/admin/(protected)/password/page.tsx
apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx
apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx
apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx
apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx
apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx
apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx
apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx
apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx
apps/web/src/app/[locale]/admin/(protected)/users/page.tsx
apps/web/src/app/[locale]/admin/db-actions.ts
apps/web/src/app/[locale]/admin/layout.tsx
apps/web/src/app/[locale]/admin/login-form.tsx
apps/web/src/app/[locale]/admin/page.tsx
apps/web/src/app/[locale]/error.tsx
apps/web/src/app/[locale]/globals.css
apps/web/src/app/[locale]/layout.tsx
apps/web/src/app/[locale]/loading.tsx
apps/web/src/app/[locale]/not-found.tsx
apps/web/src/app/actions/admin-users.ts
apps/web/src/app/actions/auth.ts
apps/web/src/app/actions/images.ts
apps/web/src/app/actions/public.ts
apps/web/src/app/actions/seo.ts
apps/web/src/app/actions/settings.ts
apps/web/src/app/actions/sharing.ts
apps/web/src/app/actions/tags.ts
apps/web/src/app/actions/topics.ts
apps/web/src/app/actions.ts
apps/web/src/app/api/admin/db/download/route.ts
apps/web/src/app/api/health/route.ts
apps/web/src/app/api/live/route.ts
apps/web/src/app/api/og/route.tsx
apps/web/src/app/apple-icon.tsx
apps/web/src/app/global-error.tsx
apps/web/src/app/icon.tsx
apps/web/src/app/manifest.ts
apps/web/src/app/robots.ts
apps/web/src/app/sitemap.ts
apps/web/src/app/uploads/[...path]/route.ts
apps/web/src/components/admin-header.tsx
apps/web/src/components/admin-nav.tsx
apps/web/src/components/admin-user-manager.tsx
apps/web/src/components/footer.tsx
apps/web/src/components/histogram.tsx
apps/web/src/components/home-client.tsx
apps/web/src/components/i18n-provider.tsx
apps/web/src/components/image-manager.tsx
apps/web/src/components/image-zoom.tsx
apps/web/src/components/info-bottom-sheet.tsx
apps/web/src/components/lazy-focus-trap.tsx
apps/web/src/components/lightbox.tsx
apps/web/src/components/load-more.tsx
apps/web/src/components/nav-client.tsx
apps/web/src/components/nav.tsx
apps/web/src/components/optimistic-image.tsx
apps/web/src/components/photo-navigation.tsx
apps/web/src/components/photo-viewer.tsx
apps/web/src/components/search.tsx
apps/web/src/components/tag-filter.tsx
apps/web/src/components/tag-input.tsx
apps/web/src/components/theme-provider.tsx
apps/web/src/components/topic-empty-state.tsx
apps/web/src/components/ui/alert-dialog.tsx
apps/web/src/components/ui/alert.tsx
apps/web/src/components/ui/aspect-ratio.tsx
apps/web/src/components/ui/badge.tsx
apps/web/src/components/ui/button.tsx
apps/web/src/components/ui/card.tsx
apps/web/src/components/ui/dialog.tsx
apps/web/src/components/ui/dropdown-menu.tsx
apps/web/src/components/ui/input.tsx
apps/web/src/components/ui/label.tsx
apps/web/src/components/ui/progress.tsx
apps/web/src/components/ui/scroll-area.tsx
apps/web/src/components/ui/select.tsx
apps/web/src/components/ui/separator.tsx
apps/web/src/components/ui/sheet.tsx
apps/web/src/components/ui/skeleton.tsx
apps/web/src/components/ui/sonner.tsx
apps/web/src/components/ui/switch.tsx
apps/web/src/components/ui/table.tsx
apps/web/src/components/ui/textarea.tsx
apps/web/src/components/upload-dropzone.tsx
apps/web/src/db/index.ts
apps/web/src/db/schema.ts
apps/web/src/db/seed.ts
apps/web/src/i18n/request.ts
apps/web/src/instrumentation.ts
apps/web/src/lib/action-guards.ts
apps/web/src/lib/action-result.ts
apps/web/src/lib/api-auth.ts
apps/web/src/lib/audit.ts
apps/web/src/lib/auth-rate-limit.ts
apps/web/src/lib/backup-filename.ts
apps/web/src/lib/base56.ts
apps/web/src/lib/clipboard.ts
apps/web/src/lib/constants.ts
apps/web/src/lib/csv-escape.ts
apps/web/src/lib/data.ts
apps/web/src/lib/db-restore.ts
apps/web/src/lib/error-shell.ts
apps/web/src/lib/exif-datetime.ts
apps/web/src/lib/gallery-config-shared.ts
apps/web/src/lib/gallery-config.ts
apps/web/src/lib/image-queue.ts
apps/web/src/lib/image-types.ts
apps/web/src/lib/image-url.ts
apps/web/src/lib/locale-path.ts
apps/web/src/lib/mysql-cli-ssl.ts
apps/web/src/lib/photo-title.ts
apps/web/src/lib/process-image.ts
apps/web/src/lib/process-topic-image.ts
apps/web/src/lib/queue-shutdown.ts
apps/web/src/lib/rate-limit.ts
apps/web/src/lib/request-origin.ts
apps/web/src/lib/restore-maintenance.ts
apps/web/src/lib/revalidation.ts
apps/web/src/lib/safe-json-ld.ts
apps/web/src/lib/sanitize.ts
apps/web/src/lib/seo-og-url.ts
apps/web/src/lib/serve-upload.ts
apps/web/src/lib/session.ts
apps/web/src/lib/sql-restore-scan.ts
apps/web/src/lib/storage/index.ts
apps/web/src/lib/storage/local.ts
apps/web/src/lib/storage/types.ts
apps/web/src/lib/tag-records.ts
apps/web/src/lib/tag-slugs.ts
apps/web/src/lib/upload-limits.ts
apps/web/src/lib/upload-paths.ts
apps/web/src/lib/upload-tracker-state.ts
apps/web/src/lib/upload-tracker.ts
apps/web/src/lib/utils.ts
apps/web/src/lib/validation.ts
apps/web/src/proxy.ts
apps/web/src/site-config.example.json
apps/web/src/site-config.json
```

### Full Vitest file list
```text
apps/web/src/__tests__/action-guards.test.ts
apps/web/src/__tests__/admin-user-create-ordering.test.ts
apps/web/src/__tests__/admin-users.test.ts
apps/web/src/__tests__/auth-rate-limit-ordering.test.ts
apps/web/src/__tests__/auth-rate-limit.test.ts
apps/web/src/__tests__/auth-rethrow.test.ts
apps/web/src/__tests__/backup-download-route.test.ts
apps/web/src/__tests__/backup-filename.test.ts
apps/web/src/__tests__/base56.test.ts
apps/web/src/__tests__/check-action-origin.test.ts
apps/web/src/__tests__/check-api-auth.test.ts
apps/web/src/__tests__/clipboard.test.ts
apps/web/src/__tests__/csv-escape.test.ts
apps/web/src/__tests__/data-pagination.test.ts
apps/web/src/__tests__/db-pool-connection-handler.test.ts
apps/web/src/__tests__/db-restore.test.ts
apps/web/src/__tests__/error-shell.test.ts
apps/web/src/__tests__/exif-datetime.test.ts
apps/web/src/__tests__/gallery-config-shared.test.ts
apps/web/src/__tests__/health-route.test.ts
apps/web/src/__tests__/histogram.test.ts
apps/web/src/__tests__/image-queue-bootstrap.test.ts
apps/web/src/__tests__/image-queue.test.ts
apps/web/src/__tests__/image-url.test.ts
apps/web/src/__tests__/images-actions.test.ts
apps/web/src/__tests__/images-delete-revalidation.test.ts
apps/web/src/__tests__/lightbox.test.ts
apps/web/src/__tests__/live-route.test.ts
apps/web/src/__tests__/locale-path.test.ts
apps/web/src/__tests__/mysql-cli-ssl.test.ts
apps/web/src/__tests__/next-config.test.ts
apps/web/src/__tests__/photo-title.test.ts
apps/web/src/__tests__/privacy-fields.test.ts
apps/web/src/__tests__/public-actions.test.ts
apps/web/src/__tests__/queue-shutdown.test.ts
apps/web/src/__tests__/rate-limit.test.ts
apps/web/src/__tests__/request-origin.test.ts
apps/web/src/__tests__/restore-maintenance.test.ts
apps/web/src/__tests__/revalidation.test.ts
apps/web/src/__tests__/safe-json-ld.test.ts
apps/web/src/__tests__/sanitize.test.ts
apps/web/src/__tests__/seo-actions.test.ts
apps/web/src/__tests__/serve-upload.test.ts
apps/web/src/__tests__/session.test.ts
apps/web/src/__tests__/settings-image-sizes-lock.test.ts
apps/web/src/__tests__/shared-page-title.test.ts
apps/web/src/__tests__/sql-restore-scan.test.ts
apps/web/src/__tests__/storage-local.test.ts
apps/web/src/__tests__/tag-input.test.ts
apps/web/src/__tests__/tag-records.test.ts
apps/web/src/__tests__/tag-slugs.test.ts
apps/web/src/__tests__/tags-actions.test.ts
apps/web/src/__tests__/topics-actions.test.ts
apps/web/src/__tests__/upload-dropzone.test.ts
apps/web/src/__tests__/upload-limits.test.ts
apps/web/src/__tests__/upload-tracker.test.ts
apps/web/src/__tests__/validation.test.ts
```

### Full E2E/support file list
```text
apps/web/e2e/admin.spec.ts
apps/web/e2e/helpers.ts
apps/web/e2e/nav-visual-check.spec.ts
apps/web/e2e/origin-guard.spec.ts
apps/web/e2e/public.spec.ts
apps/web/e2e/test-fixes.spec.ts
```

## Findings

### 1) Critical auth flows are mostly untested behaviorally
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Real logic sits in `apps/web/src/app/actions/auth.ts:70-419` (`login`, `logout`, `updatePassword`).
  - Existing auth-related tests only cover helper/static slices:
    - `apps/web/src/__tests__/auth-rate-limit.test.ts:16-64`
    - `apps/web/src/__tests__/auth-rethrow.test.ts:16-52`
    - `apps/web/src/__tests__/session.test.ts:4-43`
  - There is no behavioral test covering success/failure redirects, cookie attributes, session invalidation, or password-change transaction behavior.
- **Concrete failure scenario:** a refactor changes `login()` so secure cookies are not set for HTTPS/prod (`auth.ts:207-217`), or stops rolling back counters on DB failure (`auth.ts:225-241`), or `updatePassword()` stops deleting old sessions in-transaction (`auth.ts:365-381`); current tests would still pass.
- **Suggested test/fix:**
  - Add direct unit tests for `login()` covering: same-origin rejection, invalid credentials, successful redirect, secure-cookie selection, DB-over-limit rollback, and unexpected-error rollback.
  - Add `logout()` tests for same-origin redirect, hashed-session deletion, and cookie deletion (`auth.ts:245-265`).
  - Add `updatePassword()` tests for empty/mismatch validation before rate-limit increment, incorrect-password branch, success path invalidating other sessions, and rollback on transaction failure.
- **TDD opportunity:** start with failing tests around the `redirect()`/cookie contract before touching auth internals.

### 2) Share-link actions have zero direct regression coverage despite concurrency/rate-limit logic
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Complex share logic: `apps/web/src/app/actions/sharing.ts:92-345`.
  - Includes pre-increment + rollback paths, duplicate-key retries, FK rollback, conditional revoke updates, and audit/revalidation side effects.
  - No Vitest file targets `app/actions/sharing.ts`; a repo-wide search of `apps/web/src/__tests__` only finds share-page/title/static deletion references, not action coverage.
- **Concrete failure scenario:**
  - `createPhotoShareLink()` can drift DB and memory counters apart if a future edit drops `rollbackShareRateLimitFull()` on the `imageNotFound` or duplicate-key exhaustion paths (`sharing.ts:160-186`).
  - `createGroupShareLink()` can incorrectly charge admins for FK failures (`sharing.ts:288-300`).
  - `revokePhotoShareLink()` can revoke a newly created concurrent key if the conditional `WHERE` contract regresses (`sharing.ts:327-337`).
- **Suggested test/fix:**
  - Add `sharing-actions.test.ts` with mocked DB/rate-limit/auth modules.
  - Cover: already-shared photo fast path, over-limit rollback, duplicate-key retry, image deleted between select and update, FK failure rollback for groups, and race-safe revoke behavior.
- **TDD opportunity:** write tests for the rollback matrix before any future share-action cleanup.

### 3) The image-processing pipeline is a major untested core path
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Core upload/processing logic lives in `apps/web/src/lib/process-image.ts:224-459` and EXIF normalization in `apps/web/src/lib/process-image.ts:480-520`.
  - It handles file-size guards, empty files, extension allowlists, streaming-to-disk cleanup, Sharp metadata failures, blur placeholders, ICC parsing, resize deduplication, atomic base-file publish, and output verification.
  - There is no matching `process-image.test.ts`; current upload tests only stub the module (`apps/web/src/__tests__/images-actions.test.ts:71-75,127-179`).
- **Concrete failure scenario:**
  - A broken rename/copy fallback can leave missing base assets even though sized variants exist (`process-image.ts:414-435`).
  - EXIF date/GPS extraction can regress silently (`process-image.ts:495-516`).
  - Cleanup-on-invalid-image can fail and strand originals on disk (`process-image.ts:253-262`).
- **Suggested test/fix:**
  - Add direct unit/integration tests for `getSafeExtension`, `saveOriginalAndGetMetadata`, `processImageFormats`, and `extractExifForDb` with fs/sharp mocks or fixture images.
  - Must assert cleanup on invalid metadata, no-upscale duplicate-copy behavior, non-empty output verification, and GPS/date normalization.

### 4) Settings coverage is mostly source-text locking, not runtime behavior
- **Severity:** Medium-High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Real mutation logic: `apps/web/src/app/actions/settings.ts:38-162`.
  - The only targeted settings regression test is string-based source inspection in `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:5-22`.
  - No behavioral test asserts transaction writes, sanitization, upload-lock behavior, delete-on-empty semantics, or `revalidateAllAppData()`.
- **Concrete failure scenario:** a refactor preserves the text pattern the lock test looks for but breaks runtime semantics—e.g. storing unsanitized values (`settings.ts:56-70`), failing to block active uploads (`settings.ts:73-77`), or not deleting empty settings (`settings.ts:136-144`).
- **Suggested test/fix:**
  - Replace or supplement the source-text guard with actual action tests for `updateGallerySettings()` and `getGallerySettingsAdmin()`.
  - Cover: invalid key rejection, sanitized invalid values, image-size lock, GPS lock, delete-on-empty, transaction failure, and full-app revalidation.
- **False-confidence note:** static-source tests are useful tripwires, but they are not substitutes for runtime behavior tests here.

### 5) Startup/shutdown safety paths are uncovered
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Startup and signal handling live in `apps/web/src/instrumentation.ts:1-35`.
  - It bootstraps `assertNoLegacyPublicOriginalUploads()` (`apps/web/src/lib/upload-paths.ts:73-94`), queue startup, shared-group flush, and forced-exit timeout handling.
  - There is no direct instrumentation test; current related tests cover queue/bootstrap helpers but not the orchestration entrypoint.
- **Concrete failure scenario:** production boots with legacy originals present or stops flushing buffered view counts on SIGTERM; unit tests still stay green because none execute `register()`.
- **Suggested test/fix:**
  - Add `instrumentation.test.ts` that mocks `process.once`, queue/bootstrap imports, upload-path checks, `flushBufferedSharedGroupViewCounts`, and `process.exit`.
  - Assert nodejs-only registration, both signal handlers, and the shutdown race behavior.

### 6) “Visual check” E2E tests generate artifacts but do not assert visual correctness
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - `apps/web/e2e/nav-visual-check.spec.ts:14,27,39` writes screenshots to disk.
  - No `toHaveScreenshot()`, no snapshot baseline, no diff threshold, no pixel assertion.
- **Concrete failure scenario:** the nav visually regresses (spacing, overlap, hidden controls, wrong colors) but the test still passes because taking a screenshot is not an assertion.
- **Suggested test/fix:**
  - Convert these to snapshot assertions with `expect(nav).toHaveScreenshot(...)` or remove them from the gate if they are only for manual artifact generation.
  - If they remain non-gating, label them clearly as manual review helpers.
- **False-confidence note:** these tests currently look like visual regression tests without actually being that.

### 7) Admin upload E2E is likely flaky on slower environments
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely
- **Evidence:**
  - Upload flow waits on UI text and then a DB polling helper with a hard 30s timeout: `apps/web/e2e/admin.spec.ts:61-84`, `apps/web/e2e/helpers.ts:122-149`.
  - Polling uses fixed 500ms sleeps and wall-clock timeout, with no queue-state diagnostics on failure.
- **Concrete failure scenario:** image processing is slightly slower than 30 seconds under CI load or cold Sharp startup; the spec fails intermittently even though the system eventually succeeds.
- **Suggested test/fix:**
  - Prefer `expect.poll` with richer failure context or expose a deterministic processing-complete signal.
  - Increase timeout or tie it to queue/DB health, and emit debug state on timeout.
  - Consider cleanup safeguards if delete fails after processing succeeds.

### 8) The repo has no automated coverage gate, so gaps can widen silently
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - `apps/web/vitest.config.ts:10-12` only sets `include`; there is no coverage provider, reporter, threshold, or file-level floor.
  - `apps/web/playwright.config.ts` is configured for smoke/E2E execution, but there is no test-quality gate for critical server-action modules.
- **Concrete failure scenario:** new auth/sharing/process-image logic ships with zero tests and CI still reports green because only existing tests are run.
- **Suggested test/fix:**
  - Add coverage reporting and thresholds, at minimum for `app/actions/*`, `lib/process-image.ts`, `lib/session.ts`, `instrumentation.ts`, and `lib/upload-paths.ts`.
  - If global thresholds are too noisy, start with per-file allowlist thresholds for high-risk files.

## Coverage gap map (highest risk first)

### High-risk uncovered or under-covered files
- `apps/web/src/app/actions/auth.ts` — critical auth/session/password flows; only helper/static tests exist.
- `apps/web/src/app/actions/sharing.ts` — no direct tests for share creation/revocation/rate-limit rollback.
- `apps/web/src/lib/process-image.ts` — no direct tests for upload/Sharp/EXIF/output verification paths.
- `apps/web/src/app/actions/settings.ts` — behavior largely untested; current lock test is source-text only.
- `apps/web/src/instrumentation.ts` — no test for startup/signal orchestration.
- `apps/web/src/lib/upload-paths.ts` — no direct test for root resolution, legacy-path fallback, prod/dev behavior in `assertNoLegacyPublicOriginalUploads()`.
- `apps/web/src/lib/session.ts` — only hashing/token-format tests; no direct `verifySessionToken()` coverage for expiry, signature mismatch, future timestamps, or expired-session deletion (`session.ts:94-145`).
- `apps/web/src/lib/storage/local.ts` — tests only exercise `readBuffer()` traversal guards (`storage-local.test.ts:12-27`), not `init`, `write*`, `copy`, `createReadStream`, or symlink rejection (`storage/local.ts:43-127`).

### Medium-risk uncovered UI/route surfaces
- Public page/layout files under `apps/web/src/app/[locale]/(public)/*` are only partially covered through E2E smoke; route-specific metadata/empty/error states remain thin.
- Admin page clients/forms (`dashboard-client.tsx`, `password-form.tsx`, `settings-client.tsx`, `tag-manager.tsx`, `topic-manager.tsx`, `admin-user-manager.tsx`) have limited direct component tests despite significant interaction logic.
- `apps/web/src/app/sitemap.ts`, `manifest.ts`, `robots.ts`, `api/og/route.tsx` have no visible targeted tests in the current suite.

## False-confidence hotspots
- `apps/web/src/__tests__/auth-rethrow.test.ts:16-52` and `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22` are static-text/source-slice tests, not behavioral tests.
- `apps/web/e2e/nav-visual-check.spec.ts:5-40` produces screenshots without asserting them.
- `apps/web/src/__tests__/images-actions.test.ts:71-75` mocks out the actual image-processing engine, so upload tests do not cover the real filesystem/Sharp pipeline.

## Best next TDD sequence
1. **`auth.ts`** — highest user-impact/security surface.
2. **`sharing.ts`** — concurrency and rollback logic is easy to regress.
3. **`process-image.ts`** — highest operational risk, currently fully behind mocks.
4. **`settings.ts`** — replace source-string checks with action tests.
5. **`instrumentation.ts` + `upload-paths.ts`** — startup safety and prod-only behavior.

## Final missed-issues sweep
I explicitly re-checked for:
- fixed-time / timeout sensitivity (`Date.now`, `setTimeout`, polling loops),
- screenshot-only tests,
- static-text assertions standing in for runtime tests,
- high-risk server actions with no matching test file,
- startup/shutdown code with no execution coverage,
- and missing gate configuration.

No additional higher-priority test gaps stood out above the findings already listed.

## Skipped files / reduced-depth review
Inventoried but not reviewed line-by-line in depth because they are mostly low-logic wrappers, generated/schema/config surfaces, or present lower risk than the findings above:
- `apps/web/src/components/ui/*`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/seed.ts`
- `apps/web/src/site-config*.json`
- `apps/web/src/app/*icon*`, `manifest.ts`, `robots.ts`, `sitemap.ts` (not deeply inspected, but noted as under-tested)
- CSS/assets/config files outside test logic

If this lane continues, I would next turn the auth + sharing findings into concrete failing tests first.
