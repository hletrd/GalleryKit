# Cycle 3 Test Engineer Review

## Scope and inventory

### Repository inventory
- **Workspace root:** `/Users/hletrd/flash-shared/gallery`
- **Primary app:** `apps/web`
- **Source files inspected:** 140 TypeScript/TSX files under `apps/web/src`
- **Domain breakdown:**
  - `app/`: 53 files
  - `components/`: 44 files
  - `lib/`: 37 files
  - `db/`: 3 files
  - `i18n/`: 1 file
  - `instrumentation.ts`: 1 file
  - `proxy.ts`: 1 file

### Test inventory
- **Vitest config:** `apps/web/vitest.config.ts`
- **Unit test files:** 13 (`apps/web/src/__tests__/*.test.ts`)
- **Unit test count:** 97 total tests
- **Playwright config:** `apps/web/playwright.config.ts`, `apps/web/playwright-test.config.ts`
- **E2E spec files:** 4 main specs
  - `apps/web/e2e/admin.spec.ts`
  - `apps/web/e2e/public.spec.ts`
  - `apps/web/e2e/test-fixes.spec.ts`
  - `apps/web/e2e/nav-visual-check.spec.ts`
- **E2E helpers:** `apps/web/e2e/helpers.ts`

### Direct unit-coverage map
The current unit suite directly imports only these runtime surfaces:
- `lib/auth-rate-limit`
- `lib/backup-filename`
- `lib/base56`
- `lib/locale-path`
- `lib/data` (only via privacy field key checks)
- `lib/queue-shutdown`
- `lib/rate-limit`
- `lib/revalidation`
- `lib/sanitize`
- `lib/session` (format/hash only)
- `lib/sql-restore-scan`
- `lib/upload-tracker`
- `lib/validation`

### Important unprotected surfaces found during inventory
No direct unit tests currently import any of these high-risk modules:
- `apps/web/src/app/actions/*.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/exif-datetime.ts`
- `apps/web/src/lib/image-types.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/sitemap.ts`

---

## Confirmed issues

These are **confirmed test gaps / unprotected behaviors** from the current repo state, not speculative code defects.

### 1) Auth/session behavior is only shallowly protected
- **Confidence:** High
- **Code regions:**
  - `apps/web/src/lib/session.ts:16-145`
  - `apps/web/src/app/actions/auth.ts:20-372`
  - `apps/web/src/app/actions/admin-users.ts:56-215`
- **Current coverage reality:** `apps/web/src/__tests__/session.test.ts:1-44` only checks hashing and token string format.
- **What is unprotected:**
  - production refusal when `SESSION_SECRET` is missing
  - dev fallback secret generation and cache reuse
  - tampered-signature rejection
  - future timestamp rejection
  - expired-session deletion path
  - login pre-increment / rollback logic
  - password-change rate-limit rollback and session invalidation
  - admin-user creation rollback on duplicate/error
- **Failure scenarios:**
  - a regression makes `verifySessionToken()` accept a malformed or future token and no current unit test fails
  - `getSessionSecret()` silently falls back in production and weakens the auth model without a red test
  - `updatePassword()` stops deleting sibling sessions, leaving old sessions valid after password change
  - `createAdminUser()` stops resetting the rate-limit bucket on success/error, causing false throttling
- **Suggested tests/fixes:**
  - add mocked unit tests for `session.ts` covering secret sourcing, signature verification, expiry cleanup, and DB lookup behavior
  - add server-action tests for `login()`, `logout()`, `updatePassword()`, and `createAdminUser()` with mocked `cookies`, `headers`, `db`, `argon2`, `logAuditEvent`, and rate-limit helpers
  - explicitly assert both success rollback and infrastructure-error rollback paths

### 2) Upload + metadata ingestion flow is the largest untested action surface
- **Confidence:** High
- **Code regions:**
  - `apps/web/src/app/actions/images.ts:23-304`
  - `apps/web/src/app/actions/images.ts:307-556`
  - `apps/web/src/lib/upload-tracker.ts:12-49`
  - `apps/web/src/lib/gallery-config.ts:33-88`
- **Current coverage reality:** `apps/web/src/__tests__/upload-tracker.test.ts:1-71` only exercises the quota reconciliation helper.
- **What is unprotected:**
  - cumulative file-count and byte-limit enforcement
  - disk-space rejection path
  - topic/tag sanitization and validation rejection paths
  - EXIF GPS stripping when `strip_gps_on_upload` is enabled
  - privacy-safe fallback when config lookup fails
  - DB insert failure cleanup of originals
  - multi-file partial success vs all-failure behavior
  - delete-one / delete-many cleanup and revalidation behavior
  - metadata update length validation and topic-path revalidation
- **Failure scenarios:**
  - a refactor stops stripping GPS on DB/config failure and the suite stays green
  - a failure during DB insert leaves original files orphaned with no test signal
  - batch deletion returns success but leaves variants behind because cleanup behavior regressed
  - upload quota logic overcounts or undercounts after mixed success/failure batches
- **Suggested tests/fixes:**
  - add action-level tests for `uploadImages()` with mocked `headers`, `statfs`, `saveOriginalAndGetMetadata`, `extractExifForDb`, `db`, `getGalleryConfig`, `enqueueImageProcessing`, `logAuditEvent`, and `revalidateLocalizedPaths`
  - cover at least: unauthorized, invalid topic, invalid tag list, cumulative-byte rejection, disk-space rejection, GPS strip on/off, config-read failure fallback, full failure cleanup, and partial success reconciliation
  - add focused tests for `deleteImage()`, `deleteImages()`, and `updateImageMetadata()` asserting filename validation, cleanup calls, stale/not-found handling, and revalidation paths

### 3) Background image processing and EXIF/variant generation are almost entirely unprotected
- **Confidence:** High
- **Code regions:**
  - `apps/web/src/lib/image-queue.ts:135-344`
  - `apps/web/src/lib/process-image.ts:117-188`
  - `apps/web/src/lib/process-image.ts:207-439`
  - `apps/web/src/lib/process-image.ts:459-568`
  - `apps/web/src/lib/process-topic-image.ts:42-106`
- **Current coverage reality:** only `apps/web/src/__tests__/queue-shutdown.test.ts:1-52` covers the shutdown helper, not the queue pipeline.
- **What is unprotected:**
  - claim-lock miss/retry scheduling
  - missing-original short-circuit
  - verify-before-mark-processed behavior
  - delete-while-processing cleanup branch
  - retry exhaustion behavior
  - EXIF datetime parsing edge cases
  - GPS DMS conversion edge cases
  - ICC profile parsing fallback behavior
  - topic-image temp-file cleanup and invalid-image cleanup
  - deterministic variant deletion and base-file generation
- **Failure scenarios:**
  - a lock-contention regression schedules duplicate work or drops jobs forever with no failing test
  - `processImageFormats()` stops generating the base alias file and only sized variants exist; current suite never notices
  - EXIF parser changes produce wrong `capture_date`/GPS data and there is no regression coverage
  - topic-image temp files accumulate after failures without a test catching cleanup regressions
- **Suggested tests/fixes:**
  - add mocked integration tests around `enqueueImageProcessing()` for claim retry, retry exhaustion, missing original, processed update success, and delete-during-processing cleanup
  - add pure/helper tests around `extractExifForDb()` and EXIF date handling using representative EXIF payloads
  - add filesystem-backed tests for `deleteImageVariants()` and `processTopicImage()` using temp dirs

### 4) File-serving, DB backup/restore, and path-security boundaries are implemented but not regression-tested
- **Confidence:** High
- **Code regions:**
  - `apps/web/src/lib/serve-upload.ts:32-112`
  - `apps/web/src/app/api/admin/db/download/route.ts:12-54`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:21-91`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:94-221`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:232-392`
  - `apps/web/src/lib/upload-paths.ts:48-94`
- **Current coverage reality:** only `apps/web/src/__tests__/backup-filename.test.ts:1-18` checks the filename regex; it does not test route behavior.
- **What is unprotected:**
  - upload-route directory/extension mismatch rejection
  - containment and symlink rejection paths
  - success headers for image serving and SQL download
  - CSV escaping behavior in `escapeCsvField()`
  - dump/restore stream failure handling
  - dangerous SQL restore rejection path
  - legacy-originals warning/throw behavior in `upload-paths.ts`
- **Failure scenarios:**
  - a future refactor accidentally allows a symlink or mismatched extension through `serveUploadFile()`
  - the backup route loses `no-store` or `Content-Disposition` headers and nothing in tests fails
  - restore accepts malformed SQL header/content and only manual QA catches it
  - `resolveOriginalUploadPath()` or `assertNoLegacyPublicOriginalUploads()` regresses silently across deployment layouts
- **Suggested tests/fixes:**
  - add route tests for `serveUploadFile()` and the backup-download GET handler using temp fixtures and symlinks
  - add unit tests for CSV escaping, SQL restore header validation, dangerous SQL rejection, and `upload-paths.ts` fallback behavior
  - assert response headers, status codes, and cleanup side effects explicitly

### 5) Config/metadata/public-runtime behavior has almost no direct regression coverage
- **Confidence:** High
- **Code regions:**
  - `apps/web/src/app/actions/settings.ts:14-90`
  - `apps/web/src/app/actions/seo.ts:22-131`
  - `apps/web/src/app/actions/public.ts:10-100`
  - `apps/web/src/lib/data.ts:20-104`
  - `apps/web/src/lib/data.ts:246-606`
  - `apps/web/src/lib/data.ts:660-790`
  - `apps/web/src/lib/gallery-config-shared.ts:48-102`
  - `apps/web/src/proxy.ts:14-64`
  - `apps/web/src/app/api/og/route.tsx:9-110`
  - `apps/web/src/app/sitemap.ts:19-56`
  - `apps/web/src/app/robots.ts:13-21`
  - `apps/web/src/app/manifest.ts:6-30`
  - `apps/web/src/lib/image-url.ts:4-20`
  - `apps/web/src/lib/safe-json-ld.ts:1-3`
  - `apps/web/src/lib/exif-datetime.ts:1-37`
  - `apps/web/src/lib/upload-limits.ts:3-22`
  - `apps/web/src/lib/image-types.ts:50-78`
- **Current coverage reality:** `data.ts` only gets a privacy-key test (`apps/web/src/__tests__/privacy-fields.test.ts:1-32`) plus indirect use through public E2E; the pure config/metadata helpers above have no dedicated tests.
- **What is unprotected:**
  - settings/SEO validation + delete-empty/default fallback behavior
  - search action rate-limit and sanitization behavior
  - shared-group buffered view count flush/backoff logic
  - `getSharedGroup()` expiry and tag-batching behavior
  - `searchImages()` main-results + tag-results merge behavior
  - middleware redirect behavior for malformed session cookies and locale-prefixed admin routes
  - OG route validation/truncation/cache headers
  - sitemap/robots/manifest locale output contracts
  - URL/JSON-LD helper edge cases
  - EXIF formatting helper locale/time output
- **Failure scenarios:**
  - a regression in settings validation accepts bad values or stops deleting empty settings without a failing test
  - `getSharedGroup()` stops respecting expiry or view-count buffering rules and only production traffic reveals it
  - `/api/og` stops rejecting invalid topics or stops truncating labels cleanly, but no unit test catches it
  - middleware redirect logic changes for `/ko/admin/dashboard` or malformed tokens and only browser smoke tests occasionally notice
- **Suggested tests/fixes:**
  - add pure tests for `gallery-config-shared`, `image-url`, `safeJsonLd`, `exif-datetime`, `upload-limits`, and `image-types`
  - add mocked tests for `settings.ts`, `seo.ts`, `public.ts`, and `data.ts` shared-group/search behavior
  - add middleware/route tests for `proxy.ts` and `api/og/route.tsx`

---

## Confirmed risks

These are **credible test-health or flake risks** rather than already-broken coverage contracts.

### R1) Admin E2E is skipped by default, so a major workflow can disappear from regular runs
- **Confidence:** High
- **Code regions:**
  - `apps/web/e2e/helpers.ts:14`
  - `apps/web/e2e/admin.spec.ts:6-7`
- **Risk:** `admin.spec.ts` is completely skipped unless `E2E_ADMIN_ENABLED=true`, so the highest-risk workflow family is not part of the default Playwright signal.
- **Failure scenario:** CI/local `npm run test:e2e` stays green while admin auth, upload, DB tools, or settings flows are broken.
- **Suggested fix/test:** add a seeded local admin lane that runs by default in CI, or split admin E2E into a dedicated required job with stable fixtures.

### R2) The admin upload smoke test asserts only the toast, not the eventual outcome
- **Confidence:** High
- **Code regions:** `apps/web/e2e/admin.spec.ts:40-55`
- **Risk:** the test stops at the success toast and does not assert that the uploaded item appears in UI, becomes publicly reachable, or completes background processing.
- **Failure scenario:** uploads return a toast but the DB row, queue job, or processed derivatives never materialize; the E2E suite still passes.
- **Suggested fix/test:** after upload, assert the new image row/card appears in admin UI, then poll for a public/admin surface showing the asset or processed state.

### R3) “Visual checks” are artifact generators, not regression assertions
- **Confidence:** High
- **Code regions:** `apps/web/e2e/nav-visual-check.spec.ts:4-33`
- **Risk:** these specs call `page.screenshot()` but never compare against snapshots.
- **Failure scenario:** major nav layout regressions still pass as long as the page renders and a PNG file gets written.
- **Suggested fix/test:** convert to `expect(page).toHaveScreenshot(...)` with stable viewport/masking, or move these specs out of the passing suite and treat them as manual capture scripts.

### R4) `reuseExistingServer: true` can hide stale-build or stale-data problems
- **Confidence:** Medium
- **Code regions:** `apps/web/playwright.config.ts:54-60`
- **Risk:** Playwright may attach to an already-running local server whose code, env, or database state does not match the current checkout.
- **Failure scenario:** E2E passes against a stale dev server, or flakes because the reused server contains residual state from a previous run.
- **Suggested fix/test:** prefer an isolated test server in CI, or make reuse opt-in for local debugging only.

---

## Suggested priority test plan

1. **Session/auth first**
   - `session.ts`: secret sourcing, tamper rejection, expiry cleanup
   - `auth.ts`: login success/failure, rollback, password change, logout
2. **Upload pipeline second**
   - `images.ts`: quota, disk-space, EXIF privacy, cleanup, partial success
   - `image-queue.ts` + `process-image.ts`: retry/claim/delete-during-processing
3. **File/restore security third**
   - `serve-upload.ts`, backup download route, DB restore scanner
4. **Config/metadata fourth**
   - `settings.ts`, `seo.ts`, `gallery-config-shared.ts`, `api/og/route.tsx`, `proxy.ts`
5. **E2E hardening**
   - enable admin E2E in a required lane
   - replace screenshot-only specs with snapshot assertions

---

## Verification snapshot

### Commands run
- `npm run test --workspace=apps/web`
- `npm run lint --workspace=apps/web`
- `npx tsc -p apps/web/tsconfig.json --noEmit`

### Results
- **Vitest:** 13 files passed, 97 tests passed
- **ESLint:** passed
- **TypeScript:** passed
- **Playwright:** not executed in this review pass

### Important verification note
Passing verification here does **not** contradict the findings above: the existing automated suite is green, but it is green over a relatively small protected surface compared with the size and risk of the runtime code.

---

## Missed-issues sweep

I did a final sweep looking specifically for anything stronger than the findings above in:
- all server actions
- queue/image-processing code
- file-serving and DB restore/download paths
- middleware/metadata/runtime utilities
- existing unit and E2E specs

### Sweep result
- I did **not** find a stronger cycle-3 issue than the five confirmed coverage gaps and four confirmed risks above.
- The clearest pattern remains the same: **high-risk runtime behavior exists in production code, but the direct test surface is concentrated in small helper modules.**
- I intentionally did **not** promote generic “add more tests everywhere” observations; only surfaces with concrete failure modes and exact uncovered regions are included above.

