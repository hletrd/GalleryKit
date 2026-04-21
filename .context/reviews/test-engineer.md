# Test Engineer Review — Cycle 7

## Inventory / Coverage Baseline
- Repo inventory completed across root scripts/docs plus `apps/web` application code, unit tests, Playwright specs, API routes, server actions, image pipeline, and migration/deploy scripts.
- Existing automated coverage is concentrated in helper libraries: `apps/web/src/__tests__/*.test.ts` currently covers 17 modules / 115 Vitest assertions, mostly validation, rate limiting, session helpers, privacy-field shape checks, restore helpers, and revalidation utilities.
- Existing browser coverage is narrow happy-path coverage: `apps/web/e2e/admin.spec.ts:9-55`, `apps/web/e2e/public.spec.ts:4-78`, `apps/web/e2e/test-fixes.spec.ts:15-54`, and `apps/web/e2e/nav-visual-check.spec.ts:5-33` total 13 Playwright tests.
- Final missed-issues sweep: searched the repo inventory, traced the import map from every test file, compared high-risk modules against direct test hits, and checked deployment / migration scripts for coverage gaps.

## Confirmed Issues

### 1) Critical upload/delete server actions have only a single happy-path browser check and no direct failure-path coverage
- **Files/regions:** `apps/web/src/app/actions/images.ts:81-282`, `apps/web/src/app/actions/images.ts:283-617`, `apps/web/e2e/admin.spec.ts:40-54`
- **Why this is a problem:** the largest mutation surface in the repo handles quota pre-claims, EXIF privacy stripping, DB inserts, tag creation, queue handoff, cleanup rollback, and multi-file deletion cleanup, but the suite only proves that one dashboard upload can succeed.
- **Concrete failure scenario:** a regression in `settleUploadTrackerClaim`, `deleteOriginalUploadFile`, or the DB-insert / queue-enqueue boundary can leave an admin permanently rate-limited, leak orphaned originals/variants, or report success while background processing never starts; the current suite would still stay green because it does not exercise partial failures, invalid topics/tags, cleanup failures, or delete paths.
- **Suggested fix:** add targeted Vitest/integration tests for `uploadImages`, `deleteImage`, `deleteImages`, and `updateImageMetadata` with mocks for `saveOriginalAndGetMetadata`, `db`, `getGalleryConfig`, `cleanupOriginalIfRestoreMaintenanceBegan`, and queue helpers; add one E2E that deletes an uploaded image and verifies it disappears from admin/public views.
- **Confidence:** High

### 2) Share-link creation/revocation and shared-group behavior are effectively untested end to end
- **Files/regions:** `apps/web/src/app/actions/sharing.ts:62-250`, `apps/web/src/app/actions/sharing.ts:252-333`, `apps/web/src/lib/data.ts:492-610`, `apps/web/e2e/public.spec.ts:60-78`
- **Why this is a problem:** this code contains rate-limit rollback, duplicate-key retry loops, revocation race protection, expiry filtering, processed-image filtering, and buffered view-count side effects, but the only browser assertion is that an already-existing shared group keeps route context while navigating.
- **Concrete failure scenario:** a refactor could break duplicate-key retry handling or revoke the wrong key during a concurrent admin action, or `getSharedGroup()` could start returning expired/unprocessed records; none of those regressions are exercised by the current tests because no test creates links, revokes them, deletes group shares, or validates expiry/view-count behavior.
- **Suggested fix:** add unit/integration tests around `createPhotoShareLink`, `createGroupShareLink`, `revokePhotoShareLink`, `deleteGroupShareLink`, and `getSharedGroup`; include cases for duplicate-entry retry, already-shared images, revoked links, expired groups, and `incrementViewCount: false`.
- **Confidence:** High

### 3) Security-critical file-serving and admin download routes have zero route-level coverage
- **Files/regions:** `apps/web/src/lib/serve-upload.ts:32-112`, `apps/web/src/lib/api-auth.ts:9-18`, `apps/web/src/app/api/admin/db/download/route.ts:12-54`
- **Why this is a problem:** these endpoints enforce traversal containment, extension/directory matching, symlink rejection, and admin authentication, but there are no route tests proving those guards keep working.
- **Concrete failure scenario:** a future change to segment validation or `withAdminAuth()` could accidentally allow unauthorized backup downloads, accept mismatched `/uploads/jpeg/*.webp` requests, or follow a symlink into unintended files; the current suite would not detect the regression because it never hits these routes directly.
- **Suggested fix:** add request-level tests for unauthenticated `401`, invalid filename `400`, traversal/symlink `403`, ENOENT `404`, and successful stream responses for both upload-serving routes and `/api/admin/db/download`.
- **Confidence:** High

### 4) The Sharp processing pipeline and background queue have no automated regression net
- **Files/regions:** `apps/web/src/lib/process-image.ts:117-188`, `apps/web/src/lib/process-image.ts:207-439`, `apps/web/src/lib/process-image.ts:459-520`, `apps/web/src/lib/image-queue.ts:23-55`, `apps/web/src/lib/image-queue.ts:100-345`
- **Why this is a problem:** this path is responsible for file admission, metadata extraction, ICC parsing, sized-variant generation, zero-byte verification, retry/claim logic, deleted-row cleanup, bootstrap replay, and orphaned-temp cleanup, yet none of those functions have direct tests.
- **Concrete failure scenario:** a change in the atomic base-file write path (`fs.link`/`rename` fallbacks) or queue retry logic could leave zero-byte variants on disk, never mark images processed, or endlessly requeue claimed jobs; only production traffic would expose it because no test currently simulates these branches.
- **Suggested fix:** add unit tests with filesystem/sharp mocks for `saveOriginalAndGetMetadata`, `processImageFormats`, and `extractExifForDb`, plus queue tests that simulate claim contention, missing originals, partial output verification failures, deleted images during processing, and bootstrap of pending rows.
- **Confidence:** High

### 5) Admin settings/SEO persistence is covered only at the shared-parser level, not at the mutation boundary
- **Files/regions:** `apps/web/src/app/actions/settings.ts:15-129`, `apps/web/src/app/actions/seo.ts:23-134`, `apps/web/src/lib/gallery-config.ts:33-88`, `apps/web/src/__tests__/gallery-config-shared.test.ts:13-51`
- **Why this is a problem:** current tests only exercise the client-safe shared helpers; they do not verify server-side auth gating, invalid-key rejection, image-size locking against processed images, fallback-to-default behavior when DB values are corrupt, or SEO URL validation/persistence.
- **Concrete failure scenario:** a regression could allow invalid admin keys through, incorrectly unlock `image_sizes` after images already exist, or stop falling back to defaults when `admin_settings` contains bad data; `gallery-config-shared.test.ts` would still pass because it never touches the server-side data source or action-layer branching.
- **Suggested fix:** add action tests with mocked `db`, `isAdmin`, and `getCurrentUser` for `getGallerySettingsAdmin`, `updateGallerySettings`, `getSeoSettingsAdmin`, `updateSeoSettings`, and `getGalleryConfig`; include corrupt DB values, empty deletes, processed-image lock, and bad OG URL cases.
- **Confidence:** High

## Likely Issues

### 6) Public data-query behavior has only partial coverage despite carrying ordering, filtering, and dedupe logic
- **Files/regions:** `apps/web/src/lib/data.ts:250-485`, `apps/web/src/lib/data.ts:534-610`, `apps/web/src/lib/data.ts:650-708`, `apps/web/src/app/actions/public.ts:10-89`, `apps/web/e2e/public.spec.ts:4-78`, `apps/web/src/__tests__/privacy-fields.test.ts:1-33`
- **Why this is a problem:** privacy field shape is checked and a few happy-path pages render in Playwright, but the suite does not validate tag-intersection filtering, `NULL capture_date` prev/next ordering, search main-result/tag-result de-duplication, or public action rate-limit behavior.
- **Concrete failure scenario:** a query rewrite could produce duplicate search results, break next/previous navigation when `capture_date` is null, or return the wrong image set when multiple tag filters are applied; the current tests would still pass because they only assert that some public pages render and that sensitive keys are omitted from the select-field contract.
- **Suggested fix:** add DB-mocked tests for `getImagesLite`, `getImage`, `getSharedGroup`, `searchImages`, and `searchImagesAction` covering multi-tag filtering, null-date ordering, duplicate suppression, invalid slugs, and rate-limit exhaustion behavior.
- **Confidence:** Medium

## Risks Requiring Manual Validation

### 7) Deployment and migration scripts remain manual-only and have no smoke coverage despite destructive potential
- **Files/regions:** `scripts/deploy-remote.sh:4-63`, `apps/web/deploy.sh:6-34`, `apps/web/scripts/init-db.ts:5-34`, `apps/web/scripts/migrate.js:21-220`, `apps/web/scripts/seed-admin.ts:17-74`
- **Why this is a problem:** these scripts resolve environment files, run remote shell commands, mutate schema state, migrate legacy uploads, and seed/update admin credentials, but the repo has no dry-run harness or smoke tests around them.
- **Concrete failure scenario:** a path-resolution regression or env mismatch could deploy to the wrong host/path, skip required app files, partially migrate legacy originals, or seed an unusable admin account; CI would not catch it because none of these scripts are exercised automatically.
- **Suggested fix:** add script-level smoke tests where feasible (argument/env validation and path resolution), plus a documented manual validation checklist for deploy/migration flows that must run before release.
- **Confidence:** Medium

## Verification Notes
- `npm test --workspace=apps/web` → 17 test files passed, 115 tests passed.
- `npm run test:e2e --workspace=apps/web -- --list` → 13 Playwright tests discovered across 4 files.
- Direct test-hit sweep found **no direct automated coverage hits** for: `uploadImages`, `deleteImages`, `updateImageMetadata`, `createPhotoShareLink`, `createGroupShareLink`, `revokePhotoShareLink`, `deleteGroupShareLink`, `getSharedGroup`, `searchImages`, `getImage`, `getImagesLite`, `processImageFormats`, `saveOriginalAndGetMetadata`, `getGalleryConfig`, `updateGallerySettings`, `updateSeoSettings`, `withAdminAuth`, `serveUploadFile`, `bootstrapImageProcessingQueue`, and `enqueueImageProcessing`.
