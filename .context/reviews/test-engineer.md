# Test Engineering Review — Cycle 6

## Scope and inventory
- Repo reviewed: `/Users/hletrd/flash-shared/gallery`
- Docs/config/scripts reviewed: `README.md`, `apps/web/README.md`, root/app `package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/next.config.ts`, `apps/web/scripts/*`
- Source inventory reviewed: 135 non-UI source/config files under `apps/web/src`
- Automated tests reviewed: 58 Vitest files under `apps/web/src/__tests__`
- E2E reviewed: 5 Playwright specs + 2 fixtures + `apps/web/e2e/helpers.ts`
- Fresh verification: `npm test --workspace=apps/web` → **58 files passed, 354 tests passed**

## Coverage map summary
Strongest coverage is on pure helpers (`rate-limit`, `request-origin`, `validation`, `csv-escape`, `db-restore`, `sql-restore-scan`, `session`, `serve-upload`, `content-security-policy`) and on a few action-level contracts (`auth`, `images`, `topics`, `tags`) mostly through mocked unit tests.

Weakest coverage is on:
- security-critical middleware/runtime surfaces
- admin backup/restore and share-link actions
- true image-processing pipelines (tests mock them away)
- admin settings/SEO persistence flows
- metadata/OG/icon routes
- client component behavior outside a few E2E happy paths

## Findings

### 1) Admin DB backup/restore actions are effectively untested
- **Files/region:** `apps/web/src/app/[locale]/admin/db-actions.ts:33-470`
- **Severity:** High
- **Confidence:** High
- **Risk type:** Confirmed
- **Why this matters:** This file owns CSV export, `mysqldump` backup creation, advisory-lock restore orchestration, SQL scanning, queue quiesce/resume, temp-file cleanup, and post-restore revalidation.
- **Current gap:** Existing tests cover helpers (`db-restore`, `sql-restore-scan`, `backup-filename`) and the authenticated download route, but there is no direct test coverage for `exportImagesCsv`, `dumpDatabase`, or `restoreDatabase` itself.
- **Failure scenario current tests miss:** a refactor could stop releasing the restore advisory lock, skip `resumeImageProcessingQueueAfterRestore()`, accept an oversized upload, fail to delete temp files on early return, or mis-handle `mysqldump`/`mysql` child-process failures while all current tests still pass.
- **Recommendation:** Add focused server-action tests that mock child processes, pool connections, queue hooks, and filesystem cleanup. Minimum cases: unauthorized/origin fail-closed, restore lock already held, size/header/disallowed-SQL rejection, successful restore cleanup/revalidation, `mysqldump` zero-byte output handling, and CSV truncation/audit behavior.
- **TDD opportunity:** start with failing tests for restore-lock release and restore cleanup because those are the most failure-prone operational branches.

### 2) Share-link creation/revocation has no regression tests despite concurrency/rate-limit logic
- **Files/region:** `apps/web/src/app/actions/sharing.ts:21-389`
- **Severity:** High
- **Confidence:** High
- **Risk type:** Confirmed
- **Why this matters:** `createPhotoShareLink`, `createGroupShareLink`, `revokePhotoShareLink`, and `deleteGroupShareLink` contain pre-incremented in-memory + DB rate limits, collision retries, FK-recovery rollback, and race-aware conditional updates.
- **Current gap:** no Vitest or Playwright coverage references these actions.
- **Failure scenario current tests miss:** a duplicate-key or deleted-image path could burn rate-limit budget permanently, a concurrent revoke could clear a newly generated key, or group-link creation could stop rolling back on FK failures without any test signal.
- **Recommendation:** Add unit tests for each branch: existing share key short-circuit, invalid IDs, processed-image gating, DB over-limit rollback, duplicate-key retry, FK failure rollback, concurrent revoke returning `noActiveShareLink`, and successful revalidation/audit payloads. Add one E2E that creates and revokes a photo share and validates public-route access changes.
- **TDD opportunity:** write a failing test for `rollbackShareRateLimitFull()` coverage before touching any share-link internals in future cycles.

### 3) Security-critical middleware has no direct test coverage
- **Files/region:** `apps/web/src/proxy.ts:13-103`, `apps/web/src/instrumentation.ts:1-37`
- **Severity:** High
- **Confidence:** High
- **Risk type:** Manual-validation risk
- **Why this matters:** `proxy.ts` is the request gate for locale routing, admin-route cookie redirects, and production CSP nonce propagation. `instrumentation.ts` enforces legacy-upload startup checks and graceful queue draining.
- **Current gap:** no tests reference `proxy.ts` or `instrumentation.ts` directly.
- **Failure scenario current tests miss:** protected `/admin/...` paths could stop redirecting unauthenticated users, CSP headers/nonces could stop propagating in production, or shutdown/startup hooks could regress without any automated signal.
- **Recommendation:** Add middleware/instrumentation integration tests: protected-vs-login route classification, locale-preserving redirects, production CSP header propagation, and startup/shutdown hook invocation ordering.

### 4) Admin E2E coverage is conditional and does not exercise real settings persistence
- **Files/region:** `apps/web/e2e/admin.spec.ts:6-7, 40-58`, `apps/web/e2e/helpers.ts:33-45, 47-73`, `apps/web/src/app/actions/settings.ts:38-163`, `apps/web/src/app/actions/seo.ts:52-138`, `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:1-23`, `apps/web/src/__tests__/seo-actions.test.ts:1-20`
- **Severity:** High
- **Confidence:** High
- **Risk type:** Confirmed
- **Why this matters:** the admin suite is skipped unless `adminE2EEnabled` resolves truthy; in hardened environments using hashed `ADMIN_PASSWORD` without explicit `E2E_ADMIN_PASSWORD`, the entire admin browser suite drops out. Separately, the only settings-browser check flips a switch and reads `data-state`; it never saves, reloads, or verifies server persistence.
- **Failure scenario current tests miss:** `updateGallerySettings`/`updateSeoSettings` could reject changes, sanitize unexpectedly, fail revalidation, or fail to persist at all while the current admin spec still passes because it only observes client-side hydration and never clicks Save.
- **Recommendation:** Make one admin path mandatory in CI with explicit E2E credentials, and add browser tests for settings/SEO save + reload persistence. Replace or supplement `settings-image-sizes-lock.test.ts` static-source matching with behavior tests against `updateGallerySettings()`.
- **TDD opportunity:** write a failing browser test: toggle GPS → click Save → reload page → assert persisted value.

### 5) The “visual check” Playwright spec does not actually assert visual correctness
- **Files/region:** `apps/web/e2e/nav-visual-check.spec.ts:4-40`
- **Severity:** Medium
- **Confidence:** High
- **Risk type:** Confirmed
- **Why this matters:** all three tests only save screenshots to `test-results/*.png`; there is no snapshot comparison, pixel diff, or baseline assertion.
- **Failure scenario current tests miss:** major nav spacing/color/layout regressions still pass as long as the page loads and the screenshot file is written.
- **Recommendation:** convert these to `expect(page).toHaveScreenshot(...)`/`expect(locator).toHaveScreenshot(...)` with stable masking where needed, or remove them if they are only for manual artifact collection.

### 6) The real image-processing pipelines are mocked out, leaving the riskiest file/Sharp behavior unverified
- **Files/region:** `apps/web/src/lib/process-image.ts:224-589`, `apps/web/src/lib/process-topic-image.ts:42-106`, `apps/web/src/__tests__/images-actions.test.ts:73-77`, `apps/web/src/__tests__/topics-actions.test.ts:108-110`
- **Severity:** Medium
- **Confidence:** High
- **Risk type:** Confirmed
- **Why this matters:** upload/topic action tests mock `saveOriginalAndGetMetadata`, `extractExifForDb`, and `processTopicImage`, so the suite never exercises extension allowlists, zero-byte rejection, EXIF parsing, GPS stripping interactions, sized derivative generation, atomic base-file writes, temp-file cleanup, or 512x512 topic-image rendering.
- **Failure scenario current tests miss:** Sharp output naming could drift from `imageUrl()` expectations, EXIF timestamps/GPS extraction could regress, corrupted uploads could leave orphaned files, or topic-image cleanup could stop removing temp files.
- **Recommendation:** Add fixture-backed integration tests using small real JPEG/PNG/HEIC samples. Assert derivative filenames, EXIF extraction/normalization, cleanup on invalid inputs, and topic-image output dimensions/format.

### 7) Discoverability/metadata surfaces have almost no automated coverage
- **Files/region:** `apps/web/src/app/api/og/route.tsx:1-157`, `apps/web/src/app/sitemap.ts:1-59`, `apps/web/src/app/robots.ts:1-20`, `apps/web/src/app/manifest.ts:1-31`, `apps/web/src/app/icon.tsx:1-46`, `apps/web/src/app/apple-icon.tsx:1-41`, `apps/web/src/app/global-error.tsx:1-84`, `apps/web/vitest.config.ts:4-12`
- **Severity:** Medium
- **Confidence:** High
- **Risk type:** Manual-validation risk
- **Why this matters:** these routes affect SEO, crawler behavior, OG image generation, branding, and fatal-error UX. Current tests cover only the helper `validateSeoOgImageUrl()`, and the Vitest setup has no browser/jsdom environment for rendering these UI surfaces.
- **Failure scenario current tests miss:** sitemap locale URLs could be malformed, robots could point at the wrong origin, OG generation could reject/clip valid topic/tag combinations incorrectly, or icon/error rendering could break silently.
- **Recommendation:** add route-level tests for sitemap/robots/manifest/OG status and payload shape, plus minimal render tests for icon/global-error output. If broader client-component coverage is desired, introduce a jsdom/RTL lane instead of relying exclusively on coarse Playwright happy paths.

## Final sweep / commonly missed issues
- No skipped Vitest files were found, but **admin Playwright coverage is intentionally skippable** and can disappear in CI depending on credential shape.
- Several tests are source-text guards rather than behavior tests (`settings-image-sizes-lock.test.ts`, `auth-rate-limit-ordering.test.ts`, `admin-user-create-ordering.test.ts`, `auth-rethrow.test.ts`). They are useful tripwires, but they should not be treated as sufficient proof of runtime behavior.
- Major client surfaces with zero direct tests include `home-client.tsx`, `nav-client.tsx`, `image-manager.tsx`, `settings-client.tsx`, and `seo-client.tsx`; current strategy relies on a small number of E2E happy paths to cover them indirectly.

## Recommended next test additions (priority order)
1. `db-actions` restore/backup behavior tests
2. `sharing.ts` server-action regression suite
3. mandatory admin E2E save/reload coverage for Settings + SEO
4. real Sharp/fixture integration tests for `process-image` and `process-topic-image`
5. middleware tests for `proxy.ts`
6. convert nav screenshot capture into real screenshot assertions
