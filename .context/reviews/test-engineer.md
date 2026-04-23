# Test Engineer Review — Cycle 6

## Inventory examined
- Workspace/test entry points: `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`
- Existing automated coverage: all `apps/web/src/__tests__/*.test.ts`, all `apps/web/e2e/*.ts`
- High-risk server mutations and routes: `apps/web/src/app/actions/{auth,images,public,settings,sharing,seo,tags,topics,admin-users}.ts`, `apps/web/src/app/api/{health,live,og}/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Supporting libraries with direct test impact: `apps/web/src/lib/{api-auth,auth-rate-limit,backup-filename,base56,clipboard,data,db-restore,error-shell,exif-datetime,gallery-config,gallery-config-shared,image-queue,image-url,locale-path,photo-title,process-image,process-topic-image,queue-shutdown,rate-limit,request-origin,restore-maintenance,revalidation,sanitize,seo-og-url,serve-upload,session,sql-restore-scan,tag-records,tag-slugs,upload-tracker,validation}.ts`
- Cross-file interactions reviewed: auth ↔ rate limiting ↔ request-origin, upload actions ↔ process-image ↔ image-queue, admin DB actions ↔ restore-maintenance ↔ queue/data flushing, Playwright specs ↔ package/test config.

## Verification
- `npm test --workspace=apps/web` → 41 files passed, 214 tests passed.

## Confirmed Issues

### 1) Default E2E runs silently skip the entire admin surface
- **File/region:** `apps/web/e2e/admin.spec.ts:6-7`, `apps/web/package.json:18`
- **Why this is a problem:** the only browser coverage for login, protected admin navigation, and dashboard upload is gated behind `E2E_ADMIN_ENABLED=true`, while the shipped `test:e2e` command does not set that flag. A normal `npm run test:e2e` run therefore exercises only public flows.
- **Concrete failure scenario:** a regression in the admin login form, session redirect, dashboard uploader, or `/admin/db` page ships unnoticed because CI/local E2E stays green with the entire file skipped.
- **Suggested fix:** make admin E2E part of the default CI matrix (or add a dedicated required CI job that always seeds admin data and enables the flag). At minimum, fail the pipeline if the admin project/spec is skipped unintentionally.
- **Confidence:** High

### 2) The “visual checks” are artifact generation, not assertions
- **File/region:** `apps/web/e2e/nav-visual-check.spec.ts:5-32`
- **Why this is a problem:** each test only writes a screenshot to `test-results/...png`; nothing compares those images against a baseline and nothing asserts layout fidelity. These tests pass even when the nav is visually broken.
- **Concrete failure scenario:** the mobile menu overlaps controls or the desktop nav loses spacing after a CSS change; Playwright still reports success because `page.screenshot()` itself succeeds.
- **Suggested fix:** convert these to snapshot assertions such as `expect(page).toHaveScreenshot(...)` (or an equivalent review-gated diff workflow) so visual regressions fail automatically.
- **Confidence:** High

## Likely Issues

### 3) Critical auth/session mutations have no direct regression tests despite dense security logic
- **File/region:** `apps/web/src/app/actions/auth.ts:70-259`, `apps/web/src/app/actions/auth.ts:261-...`
- **Why this is a problem:** `login`, `logout`, and `updatePassword` coordinate same-origin enforcement, dual IP/account rate limits, rollback behavior, cookie security flags, session invalidation, and redirects. The current test suite does not directly exercise these actions; existing tests only cover lower-level helpers or mock these functions out from other modules.
- **Concrete failure scenario:** a future refactor drops `hasTrustedSameOrigin`, stops clearing the account-scoped limiter after success, or writes a non-secure cookie on HTTPS requests. Unit tests still pass because none of those branches are asserted end-to-end at the action layer.
- **Suggested fix:** add focused action tests for (a) same-origin rejection, (b) successful login clearing both rate-limit buckets and rotating sessions, (c) unexpected-auth-error rollback, (d) logout deleting the hashed session and redirecting, and (e) password-change success/failure rate-limit behavior.
- **Confidence:** High

### 4) Share-link lifecycle coverage is missing for the most concurrency-sensitive admin action outside auth
- **File/region:** `apps/web/src/app/actions/sharing.ts:78-344`
- **Why this is a problem:** photo/group sharing contains pre-increment rate limiting, duplicate-key retries, “already shared” short-circuits, delete transactions, and cache revalidation. I found no direct tests for `createPhotoShareLink`, `createGroupShareLink`, `revokePhotoShareLink`, or `deleteGroupShareLink`.
- **Concrete failure scenario:** a duplicate-key retry path starts returning `failedToGenerateKey`, or group deletion stops removing join rows before revalidation. The suite remains green because no test currently drives those branches.
- **Suggested fix:** add action tests covering existing-share short-circuit, processed/unprocessed image checks, duplicate-key retry success, stale row deletion (`groupNotFound`/`imageNotFound`), and rate-limit rollback when the DB bucket is already over limit.
- **Confidence:** High

### 5) Backup/restore/export orchestration is effectively unguarded by tests
- **File/region:** `apps/web/src/app/[locale]/admin/db-actions.ts:41-420`
- **Why this is a problem:** this file owns CSV sanitization, `mysqldump`/`mysql` child-process lifecycles, temp-file handling, dangerous-SQL scanning, maintenance mode transitions, advisory locks, and queue quiescing. The repository has helper coverage (`backup-download-route`, `db-restore`, `sql-restore-scan`) but not the orchestration layer that wires them together.
- **Concrete failure scenario:** a failed dump leaves a zero-byte backup reported as success, a restore early-return forgets to resume queue processing, or malformed CSV escaping regresses for spreadsheet-formula payloads. None of those failures are currently pinned by tests.
- **Suggested fix:** add isolated tests with mocked `spawn`, filesystem streams, lock connections, and maintenance helpers for `exportImagesCsv`, `dumpDatabase`, and `restoreDatabase`, especially the error/cleanup branches.
- **Confidence:** High

## Risks Requiring Manual Validation

### 6) Real-image processing + queue behavior is still under-validated at integration level
- **File/region:** `apps/web/src/lib/process-image.ts:1-~430`, `apps/web/src/lib/image-queue.ts:1-~320`, `apps/web/src/app/actions/images.ts:1-~620`
- **Why this is a problem:** helpers are partially tested (`extractExifForDb`, upload revalidation, upload-tracker math), but the production path still depends on Sharp transforms, temp-file cleanup, queue claiming, restore maintenance pauses, and filesystem verification across multiple output formats.
- **Concrete failure scenario:** a real HEIC/JPEG upload produces one zero-byte variant, or queue resume/quiesce behavior breaks after a restore window. Mock-based tests would not necessarily catch it.
- **Suggested fix:** add a small integration harness that seeds a real image fixture, runs the processing pipeline/queue against a temp upload root, and asserts all variants plus `processed=true` transitions.
- **Confidence:** Medium

### 7) The experimental storage abstraction has no automated characterization tests
- **File/region:** `apps/web/src/lib/storage/index.ts:1-117`, `apps/web/src/lib/storage/local.ts:1-115`
- **Why this is a problem:** even if the comments say the abstraction is not yet on the live path, it already contains init/rollback/dispose behavior and path-traversal protections that are easy to break when someone starts wiring it into production.
- **Concrete failure scenario:** `switchStorageBackend()` leaves the singleton in a half-initialized state after an init failure, or `LocalStorageBackend.resolve()` protections regress during future backend work.
- **Suggested fix:** add small unit tests now so the module has a safety net before it becomes part of the hot path.
- **Confidence:** Medium

## Final missed-issues sweep
- Public read paths are in materially better shape than admin/mutation paths: `public.spec.ts`, `test-fixes.spec.ts`, `public-actions.test.ts`, `serve-upload.test.ts`, `privacy-fields.test.ts`, and multiple utility tests cover the public surface reasonably well.
- The largest remaining gap is not “tests are failing”; it is that several of the repository’s highest-risk admin/security/data-recovery paths can regress without any test turning red.
