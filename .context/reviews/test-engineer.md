# Test Engineer Ultradeep Review — Cycle 12 Prompt 1

## Inventory summary
- App surface reviewed: `apps/web` Next.js app, Vitest unit suite, Playwright e2e suite, server actions, shared lib modules, storage/image-processing paths, and high-state client components.
- Current automated coverage inventory:
  - Unit/integration: `apps/web/src/__tests__/*.test.ts` = **30 files / 159 passing tests** (`npm run test --workspace=apps/web` on 2026-04-22).
  - E2E: `apps/web/e2e/*.spec.ts` = **5 specs** (`public.spec.ts`, `test-fixes.spec.ts`, `nav-visual-check.spec.ts`, `admin.spec.ts`, helpers).
- Largest currently untested or only indirectly covered modules from inventory sweep: `src/lib/process-image.ts`, `src/components/photo-viewer.tsx`, `src/components/image-manager.tsx`, `src/app/actions/auth.ts`, `src/lib/image-queue.ts`, `src/components/upload-dropzone.tsx`, `src/app/actions/sharing.ts`, `src/app/actions/admin-users.ts`, `src/lib/storage/{index,s3,local}.ts`, `src/app/actions/{settings,seo}.ts`, `src/proxy.ts`, `src/app/api/{health,og}/route.*`.

## Confirmed findings

### 1) High — auth flows have no direct regression coverage despite heavy security logic
**Citations**
- `apps/web/src/app/actions/auth.ts:70-239` login path combines same-origin enforcement, dual rate limits, dummy-hash timing defense, session creation, and cookie security.
- `apps/web/src/app/actions/auth.ts:260-383` password change path pre-increments rate limits, verifies current password, and invalidates sessions.
- Existing unit inventory has no direct `auth.ts` test file; current tests only cover helpers/mocks (`src/__tests__/images-actions.test.ts`, `topics-actions.test.ts`, `tags-actions.test.ts`, `backup-download-route.test.ts`).

**Failure scenario**
A refactor can silently break any of: same-origin rejection, rate-limit rollback on infra failure, secure-cookie selection behind `x-forwarded-proto`, or session invalidation on password change. Those are all high-impact auth regressions that current tests would miss.

**Proposed tests/fixes**
- Add `src/__tests__/auth-actions.test.ts` covering one behavior per test:
  - returns `authFailed` when `hasTrustedSameOrigin()` is false.
  - returns `tooManyAttempts` when IP bucket is already limited.
  - rolls back pre-incremented limits on unexpected DB/session errors.
  - sets `secure: true` cookie when `x-forwarded-proto=https` or production mode.
  - invalidates all other sessions after password change.
  - returns validation errors before rate-limit consumption for empty username/password.
- Prefer pure helper extraction only if mocking Next server primitives becomes too brittle.

**Confidence:** High
**Classification:** Confirmed

### 2) High — share-link actions have no direct tests for collision/race/rate-limit paths
**Citations**
- `apps/web/src/app/actions/sharing.ts:78-161` photo-share creation retries on `ER_DUP_ENTRY`, re-fetches when concurrent writers win, and rate-limits by IP.
- `apps/web/src/app/actions/sharing.ts:164-267` group-share creation deduplicates image IDs, enforces processed-only inputs, and handles FK/collision failures.
- `apps/web/src/app/actions/sharing.ts:269-340` revoke/delete logic depends on conditional `WHERE` clauses to avoid revoking a newly-written key.
- No direct `sharing.ts` tests appear in `src/__tests__` inventory.

**Failure scenario**
A small change to retry handling or conditional `WHERE` clauses can leak stale share links, fail open on duplicates, or consume rate-limit budget forever on successful requests without any suite failure.

**Proposed tests/fixes**
- Add `src/__tests__/sharing-actions.test.ts` for:
  - existing `share_key` short-circuit.
  - duplicate-key retry then success.
  - re-fetch path when another request already set the key.
  - reject unprocessed images and mixed valid/invalid group IDs.
  - revoke returns `noActiveShareLink` when concurrent replacement changed the key.
  - in-memory rate-limit rollback when DB limit already exceeded.

**Confidence:** High
**Classification:** Confirmed

### 3) High — image-processing pipeline is only mocked by action tests, not validated end-to-end at unit level
**Citations**
- `apps/web/src/lib/process-image.ts:160-187` best-effort derivative cleanup scans directories and suppresses unlink failures.
- `apps/web/src/lib/process-image.ts:207-245` upload save path writes original to disk and removes partial files on stream/metadata failure.
- `apps/web/src/lib/process-image.ts:117-149` EXIF datetime parsing has multiple input branches and range checks.
- Current `images-actions.test.ts` mocks `@/lib/process-image` instead of exercising it (`src/__tests__/images-actions.test.ts:71-77`).

**Failure scenario**
Real Sharp/EXIF behavior can regress while action tests still pass: temp/original files may leak, invalid EXIF timestamps may become non-null, or derivative cleanup may miss stray suffix files after config changes.

**Proposed tests/fixes**
- Add `src/__tests__/process-image.test.ts` with temp directories + fixture buffers for:
  - `deleteImageVariants()` deleting base plus configured and stray suffix variants.
  - `saveOriginalAndGetMetadata()` rejecting empty or disallowed uploads and deleting partial original files on pipeline/metadata failure.
  - `parseExifDateTime` branches through valid EXIF string, invalid ranges, `Date`, numeric timestamp, and unparsable inputs.
- Add at least one fixture-backed test using a small real JPEG so Sharp metadata/exif parsing is exercised, not only mocked.

**Confidence:** High
**Classification:** Confirmed

### 4) High — storage abstraction has zero direct tests, including rollback and path-traversal guarantees
**Citations**
- `apps/web/src/lib/storage/index.ts:51-132` lazy singleton init and credential validation.
- `apps/web/src/lib/storage/index.ts:103-161` backend switch rolls forward then restores old backend on init failure.
- `apps/web/src/lib/storage/local.ts:21-27` path traversal guard in `resolve()`.
- `apps/web/src/lib/storage/s3.ts:196-212` public URL vs presigned URL branching.
- Inventory sweep found no direct storage backend tests.

**Failure scenario**
A backend-switch regression can leave the process pointing at a half-initialized backend after a failed init, or a local path normalization bug could allow writes outside `UPLOAD_ROOT`. S3 URL-generation regressions would only surface in deployment-specific environments.

**Proposed tests/fixes**
- Add `src/__tests__/storage-index.test.ts` and `storage-local.test.ts`; consider `storage-s3.test.ts` with mocked AWS SDK.
- Must-cover behaviors:
  - `switchStorageBackend()` restores old backend after init failure.
  - `LocalStorageBackend.resolve()` blocks traversal like `../secret`.
  - `getUrl()` returns `/uploads/...` locally and direct-public URL when `S3_PUBLIC_URL` is configured.
  - `stat()` maps 404s to `{ exists: false }` but rethrows non-404s.

**Confidence:** High
**Classification:** Confirmed

### 5) High — `data.ts` only has privacy-key coverage; buffered shared-group view-count logic is untested
**Citations**
- `apps/web/src/lib/data.ts:10-107` debounced view-count buffer, backoff escalation, rebuffering on DB failure, and explicit flush helper.
- Existing coverage for `data.ts` is limited to field-key privacy assertions and mocking inside public-action tests (`src/__tests__/privacy-fields.test.ts:2-32`, `src/__tests__/public-actions.test.ts:23-28`).

**Failure scenario**
A bug in backoff or rebuffering can drop group view increments during DB outages or schedule endless timers. Current tests would still pass because they never execute `bufferGroupViewCount()` / `flushBufferedSharedGroupViewCounts()`.

**Proposed tests/fixes**
- Add `src/__tests__/data-view-count-buffer.test.ts` with fake timers and mocked `db.update()`:
  - buffers and flushes exactly once for repeated views.
  - re-buffers failed increments and reschedules with backoff after total failure.
  - resets backoff after partial/full success.
  - no-ops during restore maintenance.
- Consider exporting narrow test helpers rather than testing private implementation via indirect public routes.

**Confidence:** High
**Classification:** Confirmed

### 6) Medium-High — admin/settings/SEO validation rules are untested, including image-size lock logic
**Citations**
- `apps/web/src/app/actions/settings.ts:36-129` sanitizes values, validates keys, normalizes `image_sizes`, and hard-locks size changes once any processed image exists.
- `apps/web/src/app/actions/seo.ts:50-133` validates key allowlist, length caps, URL protocol, and delete-on-empty semantics.
- No direct tests exist for either action module.

**Failure scenario**
An innocuous settings refactor can let invalid keys through, store unsanitized values, or mistakenly allow `image_sizes` changes after derivatives exist — a regression with broad cache/runtime fallout but no current test tripwire.

**Proposed tests/fixes**
- Add `settings-actions.test.ts` for invalid keys, invalid values, normalized `image_sizes`, and `imageSizesLocked` when processed images exist.
- Add `seo-actions.test.ts` for invalid OG URL protocols, max-length errors, empty-value deletion, and full-tree revalidation call.

**Confidence:** High
**Classification:** Confirmed

### 7) Medium-High — proxy/API auth/health/OG routes have no route-level tests
**Citations**
- `apps/web/src/proxy.ts:14-65` locale-aware admin-route detection and cookie-format redirects.
- `apps/web/src/lib/api-auth.ts:9-18` shared 401 wrapper for `/api/admin/*` routes.
- `apps/web/src/app/api/health/route.ts:6-16` toggles 200/503 based on DB reachability.
- `apps/web/src/app/api/og/route.tsx:27-156` validates topic/tags and fallback text before generating an edge image.
- No direct tests exist for these modules in `src/__tests__`.

**Failure scenario**
Middleware route matching or locale redirect behavior can change unnoticed; health can return 200 during DB failure; OG route can accept bad input or regress cache headers. Because these are integration boundaries, helper tests elsewhere will not catch them.

**Proposed tests/fixes**
- Add `proxy.test.ts` for protected admin route detection and locale-preserving redirects.
- Add `api-auth.test.ts` for 401 wrapper behavior.
- Add `health-route.test.ts` for 200 vs 503.
- Add `og-route.test.tsx` for invalid topic 400, tag filtering, label/site-title clamping, and cache headers.

**Confidence:** High
**Classification:** Confirmed

### 8) Medium — critical client components rely mostly on E2E smoke, not targeted behavior tests
**Citations**
- `apps/web/src/components/search.tsx:40-123` debounced async search, request-id race suppression, body-scroll locking, and focus restoration.
- `apps/web/src/components/photo-viewer.tsx:102-176` keyboard navigation, shared-route sync, `sessionStorage` auto-lightbox, breakpoint state transfer.
- `apps/web/src/components/image-manager.tsx:118-218` optimistic delete/share/batch-tag flows with toast handling.
- Current direct component tests only cover `lightbox.tsx` and `tag-input.tsx` behavior helpers.

**Failure scenario**
Out-of-order search responses, focus regressions, or stale selection state in the image manager can ship while all current unit tests remain green and E2E only exercises a thin happy path.

**Proposed tests/fixes**
- Add focused component tests (Vitest + existing patterns, likely with React test harness already available through Next/React deps if repo chooses to enable DOM test env later).
- If DOM harness is intentionally deferred, add more E2E assertions around:
  - stale search result suppression after quick query changes.
  - keyboard navigation/focus restoration in `PhotoViewer` and `Search`.
  - bulk delete/share/tag selection clearing in `ImageManager`.

**Confidence:** Medium
**Classification:** Confirmed

### 9) Medium — Playwright admin coverage is opt-in and can silently disappear from CI
**Citations**
- `apps/web/e2e/admin.spec.ts:6-7` entire admin suite is skipped unless `E2E_ADMIN_ENABLED=true`.
- `apps/web/e2e/admin.spec.ts:15-55` currently the only browser coverage for login, protected routes, admin navigation, and upload.

**Failure scenario**
If CI does not set the opt-in flag, all admin workflows can regress with zero browser coverage. Because unit tests do not cover `auth.ts`, `admin-users.ts`, `settings.ts`, or `sharing.ts`, this leaves a large blind spot.

**Proposed tests/fixes**
- Move at least one admin smoke (`redirect to login`, `login succeeds`) into always-on local e2e using seeded credentials.
- Keep destructive/admin-mutating flows behind opt-in if needed, but ensure auth/navigation smoke is mandatory.

**Confidence:** High
**Classification:** Confirmed

### 10) Medium — “visual checks” do not assert against a baseline, so they won’t catch visual regressions
**Citations**
- `apps/web/e2e/nav-visual-check.spec.ts:5-33` only writes screenshots to `test-results/*.png`; there is no `toHaveScreenshot()` or snapshot diff assertion.

**Failure scenario**
A broken nav layout still produces a PNG file, so these tests remain green while visual regressions slip through. They currently function as screenshot generators, not automated visual tests.

**Proposed tests/fixes**
- Replace raw `page.screenshot({ path })` with Playwright snapshot assertions (`expect(page).toHaveScreenshot(...)` or element-scoped equivalents).
- If repo intentionally keeps manual visual capture, relabel the spec to avoid false confidence and exclude it from pass/fail coverage claims.

**Confidence:** High
**Classification:** Confirmed

## Likely findings

### 11) Medium — `reuseExistingServer: true` is a probable E2E flake vector with stateful seeded data
**Citations**
- `apps/web/playwright.config.ts:54-60` reuses an existing local server instead of always running `e2e:seed && build && start`.
- E2E suite assumes seeded fixtures and English locale content (`apps/web/e2e/public.spec.ts`, `test-fixes.spec.ts`, `admin.spec.ts`).

**Why likely, not confirmed**
This is configuration-risk rather than an observed failure in the current run. If a developer already has a stale local server or mismatched DB running on port 3100, Playwright can target that instance and invalidate all fixture assumptions.

**Failure scenario**
Tests intermittently fail or falsely pass against an old server with different seeded data, app build, or locale state.

**Proposed tests/fixes**
- Prefer `reuseExistingServer: false` in CI.
- Or gate reuse behind an explicit env flag.
- Add an always-on first test asserting expected seed markers before continuing.

**Confidence:** Medium
**Classification:** Likely

### 12) Medium — real Sharp/upload/browser integration still needs manual validation even after more unit tests
**Citations**
- `apps/web/src/lib/process-image.ts:225-245` and `src/lib/process-topic-image.ts:43-68` depend on filesystem + Sharp + Web/File stream behavior.
- `apps/web/e2e/admin.spec.ts:40-55` only browser upload path is currently opt-in.

**Why manual-validation**
Node/Vitest mocks will not fully reproduce EXIF parsing, libvips image decoding, browser `File` handling, or production filesystem permission differences.

**Proposed manual validation**
- Run one real upload of each supported format class: JPEG with EXIF, PNG without EXIF, oversized file rejection, invalid-image rejection.
- Verify generated derivatives + cleanup on failure in a real environment.
- Run admin upload smoke against a freshly seeded local environment, not a reused server.

**Confidence:** Medium
**Classification:** Manual-validation

## Final missed-issues sweep
- Re-checked the highest-LOC untested modules and current `src/__tests__`/`e2e` imports after the first pass.
- No additional **high-confidence** gaps larger than the items above surfaced beyond the broad absence of tests for many UI wrappers (`components/ui/*`), which are lower priority because they are mostly thin composition layers around vendor primitives.
- Highest-priority next additions remain: `auth.ts`, `sharing.ts`, `process-image.ts`, `storage/*`, `data.ts` view-count buffering, and route/middleware coverage.

## Recommended TDD order
1. `auth-actions.test.ts`
2. `sharing-actions.test.ts`
3. `process-image.test.ts`
4. `storage-index.test.ts` / `storage-local.test.ts` / `storage-s3.test.ts`
5. `proxy.test.ts` + `health-route.test.ts` + `og-route.test.tsx`
6. `settings-actions.test.ts` + `seo-actions.test.ts`
7. Promote one admin Playwright smoke to always-on
8. Convert nav visual capture into actual snapshot assertions

## Verification evidence
- Unit test run: `npm run test --workspace=apps/web`
- Result: **30 test files passed, 159 tests passed, 0 failed**

## Totals
- **Total findings:** 12
  - Confirmed: 10
  - Likely: 1
  - Manual-validation: 1
