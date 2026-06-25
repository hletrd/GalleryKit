# Comprehensive Test Review — GalleryKit

**Repository:** `/Users/hletrd/flash-shared/gallery`  
**HEAD:** `bcd67b12`  
**Previous Review HEAD:** `c0522dec` (Cycle 10, Run 3)  
**Date:** 2026-06-25  
**Reviewer:** Test Engineer (oh-my-claudecode:test-engineer)  

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Unit test files | 227 (225 passed, 2 skipped) |
| Unit tests | 2,064 passed, 4 skipped |
| E2E test files | 5 (admin.spec.ts, public.spec.ts, origin-guard.spec.ts, nav-visual-check.spec.ts, test-fixes.spec.ts) |
| E2E tests | ~20 (many gated behind env flags) |
| Test duration | 225.36s (cold import: 621.52s, tests: 65.04s) |
| Test framework | Vitest 4.1.9 (unit), Playwright 1.59.1 (e2e) |
| Test timeout | 15,000ms (raised from 5,000ms in cycle 3) |

**Overall Assessment:** The test suite is **exceptionally strong** for a project of this size. It features a mature fixture-style testing culture, extensive lint-gate coverage, thorough security contract tests, and a well-documented history of regression-driven test additions. However, there are **significant coverage gaps** in client-side React components, several server action files, the storage abstraction layer, and the e2e suite. The test pyramid is **inverted**: heavy on fixture/structural tests (which are valuable but not behavioral), light on true unit tests for component logic, and very light on integration tests.

**Since the previous review (c0522dec -> bcd67b12):** 6 new commits landed, all security fixes. Critically, **5 of the 6 fixes have NO corresponding regression tests** — this is the most important finding of this review.

---

## 2. New Commits Since Previous Review (c0522dec -> bcd67b12)

### 2.1 bcd67b12: Array.isArray guard to loadMoreImages tagSlugs parameter

**File:** `src/app/actions/public.ts`  
**Change:** Added `Array.isArray(tagSlugs)` guard before `tagSlugs.map(...)` in `loadMoreImages`.  
**Risk:** A malformed `tagSlugs` parameter (string, object, null) would cause `.map()` to throw or behave unexpectedly, potentially crashing the server action or leaking internal error details.  
**Test Status:** **NO REGRESSION TEST.** The `public-actions.test.ts` tests `loadMoreImages` but does not test the `tagSlugs` parameter with non-array inputs.  
**Confidence:** HIGH  
**Recommendation:** Add test: `loadMoreImages({ tagSlugs: 'not-an-array' })` should return an error or empty result, not throw.

### 2.2 9c5c38ca: Distinguish ENOENT from other opendir errors in deleteImageVariants

**File:** `src/lib/process-image.ts`  
**Change:** `deleteImageVariants` now checks `error.code === 'ENOENT'` vs other `opendir` errors. Previously, any `opendir` error was silently caught, masking real filesystem problems.  
**Risk:** A permissions error (EACCES) or corrupted directory would be silently swallowed, leaving orphaned files on disk.  
**Test Status:** **NO REGRESSION TEST.** `deleteImageVariants` has no dedicated tests at all.  
**Confidence:** HIGH  
**Recommendation:** Add test mocking `fs.opendir` to throw `EACCES` and verify the error is re-thrown, not swallowed.

### 2.3 7453030e: Add restore-maintenance checks to smart collections and embedding backfill

**File:** `src/app/actions/collections.ts`, `src/app/actions/embeddings.ts`  
**Change:** Added `isRestoreMaintenanceActive()` guards to `retryFailedCollection` and `retryFailedEmbedding` actions.  
**Risk:** Without the guard, these actions could modify the database during a restore operation, causing data corruption or inconsistent state.  
**Test Status:** **NO REGRESSION TEST.** Neither `collections.ts` nor `embeddings.ts` has any test file.  
**Confidence:** HIGH  
**Recommendation:** Add tests for both actions with `isRestoreMaintenanceActive` returning `true`, verifying they return a maintenance message without making DB calls.

### 2.4 db55056f: Move revalidation outside try/catch to prevent image cleanup on revalidation errors

**File:** `src/app/actions/topics.ts`  
**Change:** `revalidatePath` calls moved outside the try/catch that wraps the DB transaction. Previously, a `revalidatePath` error would trigger the catch block, which deleted the newly uploaded topic image, leaving a broken reference.  
**Risk:** A Next.js revalidation error (e.g., filesystem permission issue) would cause the topic image to be deleted from disk while the DB still referenced it, resulting in 404 images.  
**Test Status:** **NO REGRESSION TEST.** The `topics-actions.test.ts` tests topic creation but does not test the revalidation error path.  
**Confidence:** HIGH  
**Recommendation:** Add test mocking `revalidatePath` to throw and verifying the topic image is NOT deleted.

### 2.5 5f4a5e95: Return shallow copies from rate-limit entry getters to prevent mutable reference leaks

**File:** `src/lib/rate-limit.ts`  
**Change:** `getAccountLoginRecord`, `getPasswordChangeRecord`, and `getShareAttemptRecord` now return `{ ...entry }` (shallow copy) instead of the raw object reference.  
**Risk:** Callers could mutate the returned object, corrupting the rate-limit state (e.g., resetting `count` to 0 to bypass rate limiting).  
**Test Status:** **NO REGRESSION TEST.** The `rate-limit.test.ts` and `auth-rate-limit.test.ts` test the getters but do not verify that returned objects are immutable copies.  
**Confidence:** HIGH  
**Recommendation:** Add test: get a record, mutate the returned object, then get the record again and verify the original is unchanged.

### 2.6 b22fa85e: Lock down deleteAdminUser and LR token actions with isAdmin() checks

**File:** `src/app/actions/admin-users.ts`, `src/app/actions/lr-tokens.ts`  
**Change:** Added `isAdmin()` checks to `deleteAdminUser` and `createLrToken`/`deleteLrToken`/`revokeAllLrTokens`.  
**Risk:** Without the check, these actions could be called by unauthenticated users, allowing arbitrary admin deletion or token revocation.  
**Test Status:** **NO REGRESSION TEST.** `admin-users.ts` has no test file. `lr-tokens.ts` has `lr-tokens-action.test.ts` but it does not test the auth check.  
**Confidence:** HIGH  
**Recommendation:** Add tests for all four actions with `isAdmin()` mocked to return `false`, verifying they return an auth error without making DB calls.

---

## 3. Test Coverage Gaps

### 3.1 High-Risk: Untested Source Files

The following `lib/` files have **no dedicated test file** and contain non-trivial logic. Risk is assessed by surface area, failure impact, and whether the code is exercised by other tests.

| File | Lines (approx) | Risk | Why Untested Is Problematic |
|------|---------------|------|---------------------------|
| `lib/action-result.ts` | ~40 | **Medium** | Standardized action result shapes; a refactor could break every server action's return contract silently. |
| `lib/analytics-data.ts` | ~200 | **High** | Analytics aggregation queries (country breakdown, referrer breakdown, view counts). No tests for the SQL generation or data transformation. A schema change or index change could silently corrupt analytics. |
| `lib/avif-support.ts` | ~30 | **Low** | Browser feature detection; mostly static constants. Low risk. |
| `lib/bulk-edit-types.ts` | ~20 | **Low** | Type definitions only. No runtime logic. |
| `lib/caption-constants.ts` | ~15 | **Low** | Constant strings. No runtime logic. |
| `lib/clip-inference.ts` | ~150 | **High** | CLIP model inference orchestration. The most complex untested file. Loads ONNX models, runs inference, handles batching. A memory leak or model-loading failure here would crash semantic search. |
| `lib/clip-model-id.ts` | ~30 | **Medium** | Model version identifier. A drift here breaks model-version isolation (AGG-14). |
| `lib/color-pipeline-decisions.ts` | ~80 | **Medium** | `isP3Pipeline` predicate and `COLOR_PIPELINE_DECISIONS` enum. Used by color-details-section and process-image. A logic error here mislabels photos. |
| `lib/constants.ts` | ~50 | **Low** | Static constants. Low risk. |
| `lib/csp-nonce.ts` | ~30 | **Medium** | CSP nonce generation. Security-critical but trivial. |
| `lib/gps-exif-strip.ts` | ~200 | **High** | GPS stripping logic for JPEG/TIFF/HEIF/WebP/PNG. Security-critical privacy feature. No dedicated tests — only exercised via `images-action-gps-toggle-wiring.test.ts` (wiring check, not behavior). A format-specific bug could leak GPS coordinates. |
| `lib/icc-extractor.ts` | ~150 | **Medium** | ICC profile descriptor parser (v2 `desc`, v4 `mluc`). Used by color-detection. Has indirect coverage via `process-image-color-roundtrip.test.ts` but no direct unit tests for edge cases (truncated profiles, malformed descriptors). |
| `lib/image-types.ts` | ~30 | **Low** | Type definitions. |
| `lib/og-photo-fetch.ts` | ~80 | **Medium** | OG photo fallback buffer selection. Used by OG image routes. No direct tests. |
| `lib/seo-og-url.ts` | ~30 | **Low** | URL construction helper. |
| `lib/storage/index.ts` | ~50 | **Medium** | Storage abstraction (not wired end-to-end per CLAUDE.md). The abstraction exists but has no tests. |
| `lib/storage/local.ts` | ~200 | **High** | Local filesystem storage implementation. File operations, path validation, directory creation. No tests. A bug here could corrupt uploads or expose files. |
| `lib/storage/types.ts` | ~30 | **Low** | Type definitions. |
| `lib/utils.ts` | ~50 | **Low** | `cn()` helper and generic utilities. |

**Total untested lib/ files with runtime logic:** ~15 files, ~1,300 lines of non-trivial code.

### 3.2 High-Risk: Partially Tested Source Files

Files with test files that cover only a narrow slice of the module's surface:

| File | Test File | Coverage Gap |
|------|-----------|--------------|
| `lib/data.ts` | `data-tag-names-sql.test.ts` | Only tests SQL shape contracts (GROUP_CONCAT, LEFT JOIN, GROUP BY). No tests for query execution, pagination, filtering, search, or the `getImage()` function's tag/prev/next aggregation. |
| `lib/process-image.ts` | 8 test files (blur-wiring, color-roundtrip, dimensions, exif-strip, icc-options, metadata, orientation, p3-icc, post-encode, raw-rejection, variant-scan, webp-lossless) | Strong coverage of the pipeline but **no tests for the `deleteImageVariants` function** (line 9c5c38ca fix), error handling paths, or the `processImage` wrapper that coordinates the full flow. |
| `lib/admin-backfill-runner.ts` | 6 test files (batching, detection-failure, deleted-mid-reencode, fatal-counters, leak, status-shape) | Good coverage of the runner's edge cases, but **no tests for the actual `processImageFormats` call** inside the runner, or the batching logic's interaction with the DB cursor. |
| `lib/api-auth.ts` | `api-auth-response-headers.test.ts` | Only tests response header shape. No tests for the `withAdminAuth` wrapper's auth verification, cookie parsing, or redirect behavior. |
| `lib/audit.ts` | `audit-retention.test.ts` | Only tests retention pruning. No tests for `logAuditEvent`, event type validation, or the audit log query helpers. |
| `lib/password-hashing.ts` | `password-hashing-policy.test.ts` | Only tests policy constants (memory cost, time cost). No tests for the actual `hashPassword` or `verifyPassword` functions. |
| `lib/theme.ts` | `theme-resolve.test.ts` | Only tests theme resolution. No tests for the theme provider component or CSS variable injection. |

### 3.3 Component Test Coverage: Near Zero

**Critical finding:** Of 55 component files (`src/components/*.tsx`), only **3** have any test coverage:

| Component | Test File | Coverage |
|-----------|-----------|----------|
| `lightbox.tsx` | `lightbox.test.ts` | Single function: `shouldAutoHideLightboxControls` (4 lines). The 400+ line component has no tests for keyboard navigation, slideshow, pinch-zoom, or focus management. |
| `histogram.tsx` | `histogram.test.ts` | Canvas rendering tests (good). |
| `photo-viewer.tsx` | `photo-viewer-no-hdr-download.test.ts` | Single assertion: no HDR download button. |

**All other 52 components are completely untested**, including:
- `image-manager.tsx` (bulk edit, delete, pagination — 800+ lines)
- `upload-dropzone.tsx` (drag-and-drop, file validation, progress — 400+ lines)
- `search.tsx` (search dialog, focus trap, results — 300+ lines)
- `admin-user-manager.tsx` (admin CRUD — 300+ lines)
- `topic-manager.tsx` (topic CRUD — 400+ lines)
- `tag-input.tsx` (tag creation, autocomplete — 200+ lines)
- `color-details-section.tsx` (color metadata display — 200+ lines)
- `info-bottom-sheet.tsx` (mobile bottom sheet — 200+ lines)
- `load-more.tsx` (infinite scroll — 200+ lines)

**Risk:** Component logic is the most frequent source of UI regressions. The touch-target audit (`touch-target-audit.test.ts`) catches CSS size violations but does not test behavior, state management, or accessibility interactions.

### 3.4 Server Action Test Coverage: Sparse

Of 13 server action files (`src/app/actions/*.ts`), only **5** have any test coverage:

| Action File | Test File | Coverage |
|-------------|-----------|----------|
| `actions/auth.ts` | `auth-rate-limit.test.ts`, `session-verify.test.ts`, `auth-rethrow.test.ts` | Good coverage of rate limiting and session verification. No tests for the actual login/logout flow or Argon2 verification. |
| `actions/images.ts` | `images-actions.test.ts`, `images-action-blur-wiring.test.ts`, `images-action-gps-toggle-wiring.test.ts` | Tests for blur wiring and GPS toggle. No tests for upload, delete, bulk update, or the image processing trigger. |
| `actions/topics.ts` | `topics-actions.test.ts` | Tests for topic CRUD. |
| `actions/tags.ts` | `tags-actions.test.ts` | Tests for tag CRUD. |
| `actions/public.ts` | `public-actions.test.ts` | Tests for public search and load-more. |

**Untested server actions:**
- `actions/admin-backfill.ts` — triggers backfill; no behavioral tests
- `actions/admin-users.ts` — admin user CRUD; **NO TEST FILE EXISTS** (b22fa85e fix untested)
- `actions/collections.ts` — smart collection CRUD; **NO TEST FILE EXISTS** (7453030e fix untested)
- `actions/embeddings.ts` — CLIP embedding generation; **NO TEST FILE EXISTS** (7453030e fix untested)
- `actions/lr-tokens.ts` — Lightroom token management; only `lr-tokens-action.test.ts` (narrow, b22fa85e fix untested)
- `actions/seo.ts` — SEO settings; only `seo-actions.test.ts` (narrow)
- `actions/settings.ts` — admin settings; only `settings-image-sizes-lock.test.ts` (narrow)
- `actions/sharing.ts` — share group/link creation; only `sharing-source-contracts.test.ts` (narrow)

### 3.5 API Route Test Coverage: Minimal

Of ~20 API route files, only these have tests:

| Route | Test File | Coverage |
|-------|-----------|----------|
| `api/health/route.ts` | `health-route.test.ts` | Basic response shape. |
| `api/live/route.ts` | `live-route.test.ts` | Basic response shape. |
| `api/og/route.tsx` | `og-route-source-contracts.test.ts` | Source contract only. |
| `api/og/photo/[id]/route.tsx` | `og-photo-fallback.test.ts`, `og-image-icc.test.ts`, `og-rate-limit.test.ts` | Partial coverage. |
| `api/search/semantic/route.ts` | `semantic-search-route.test.ts`, `semantic-route-production.test.ts` | Good coverage. |
| `api/search/similar/[id]/route.ts` | `similar-route.test.ts` | Good coverage. |
| `api/admin/db/download/route.ts` | `backup-download-route.test.ts` | Narrow. |

**Untested routes:**
- `api/admin/lr/upload/route.ts` — Lightroom plugin upload endpoint. No tests. Critical: 216 MiB body limit, file processing.
- `app/[locale]/(public)/uploads/[...path]/route.ts` — File serving route. No tests.
- `app/uploads/[...path]/route.ts` — Non-locale file serving. No tests.
- `app/[locale]/(public)/[topic]/feed.xml/route.ts` — Atom feed generation. No tests for the XML output shape.
- `app/feed.xml/route.ts` — Root atom feed. No tests.
- `app/sitemap.ts` — SEO sitemap. No tests.
- `app/robots.ts` — robots.txt. No tests.

### 3.6 E2E Coverage: Thin and Gated

The e2e suite has **5 spec files** but most tests are gated behind environment flags:

| Spec | Tests | Gated? | Notes |
|------|-------|--------|-------|
| `admin.spec.ts` | 6 | Yes (`E2E_ADMIN_ENABLED`) | Only runs with local plaintext credentials. Admin login, topic CRUD, upload, settings. |
| `public.spec.ts` | 8 | No | Homepage, search, photo page, lightbox, 404, shared group. |
| `origin-guard.spec.ts` | 3 | No | CSRF origin checks. |
| `nav-visual-check.spec.ts` | 2 | No | Visual regression (screenshot comparison). |
| `test-fixes.spec.ts` | 3 | No | Regression tests for specific bugs. |

**E2E gaps:**
- No e2e coverage for **image upload processing** (the upload test exists but does not verify processed derivatives)
- No e2e coverage for **bulk operations** (bulk delete, bulk tag)
- No e2e coverage for **DB backup/restore** (admin db page)
- No e2e coverage for **semantic search** (the most complex user-facing feature added recently)
- No e2e coverage for **shared link pages** (`/s/[key]`) — skipped unless `E2E_SHARE_KEY` is set
- No e2e coverage for **analytics dashboard**
- No e2e coverage for **smart collections**
- No e2e coverage for **mobile-specific flows** (touch gestures, bottom sheet)
- Only **Chromium** is tested (no Firefox, no WebKit, no mobile viewport)

---

## 4. Test Quality Assessment

### 4.1 Strengths

1. **Fixture-style structural tests are excellent.** The `touch-target-audit.test.ts`, `check-action-origin.test.ts`, `check-api-auth.test.ts`, `check-public-route-rate-limit.test.ts`, `data-tag-names-sql.test.ts`, and `client-server-only-boundary.test.ts` are exemplary. They read source code, assert structural invariants, and prevent regressions that would be invisible to traditional unit tests.

2. **Security contract tests are thorough.** `privacy-fields.test.ts`, `session-verify.test.ts`, `auth-rate-limit.test.ts`, `request-origin.test.ts`, `sanitize.test.ts`, `validation.test.ts`, and `csv-escape.test.ts` form a strong defense-in-depth testing layer.

3. **Color/HDR pipeline tests are impressive.** `process-image-color-roundtrip.test.ts` uses real Sharp image generation and pixel-value assertions. `color-detection.test.ts` tests NCLX parsing, ICC name resolution, and HDR detection. `icc-chromaticity.test.ts` tests custom monitor profile detection. This is a level of domain-specific testing rarely seen.

4. **Test documentation is thorough.** Almost every test file has a detailed header comment explaining the regression it prevents, the cycle it was added in, and the concrete failure scenario. This is a best-practice culture.

5. **Mock isolation is careful.** `session-verify.test.ts` uses `vi.resetModules()` and `vi.doMock()` to isolate module-level singletons. `auth-rate-limit.test.ts` uses `vi.hoisted()` for clean mock setup. This prevents test pollution.

6. **Timeout management is explicit.** The vitest config raised `testTimeout` to 15,000ms (from 5,000ms) to accommodate fixture-style tests. Individual slow tests declare `{ timeout: 30000 }` explicitly. This is correct — the timeout is sized to the test, not suppressed.

### 4.2 Weaknesses

1. **Test names are inconsistent.** Some tests use descriptive names (`"resets expired in-memory login counts before evaluating a new attempt"`), while others use numbered branches (`"(1) wrong HMAC signature -> null"`, `"(4a) malformed: only 2 parts -> null"`). The numbered style is harder to read in failure output and does not describe the *expected behavior*.

2. **Some tests are too large.** `touch-target-audit.test.ts` is 1,244 lines — it is essentially a linter written as a test. While valuable, it mixes multiple concerns (Button patterns, Link patterns, select patterns, checkbox patterns, Badge patterns, recovery link assertions) into one file. A future refactor would be easier if split into `touch-target-button.test.ts`, `touch-target-link.test.ts`, etc.

3. **Some tests assert implementation, not behavior.** `data-tag-names-sql.test.ts` extracts function bodies via brace-depth walking and asserts regex matches against source code. This is a structural test, not a behavioral test. It catches regressions but does not verify that the query *returns correct data*.

4. **Missing assertion of error messages.** Many tests assert that a function throws (`expect(...).rejects.toThrow()`) but do not verify the error message content. A refactor that changes the error message would not be caught, yet the message is user-facing (e.g., login error messages).

5. **No snapshot testing.** The project does not use Vitest snapshots or Playwright visual snapshots (except `nav-visual-check.spec.ts`). This means UI text changes (e.g., i18n key updates) are not caught unless the e2e tests happen to assert the exact text.

6. **No property-based testing.** Complex validation functions (`isValidSlug`, `isValidFilename`, `isValidTopicAlias`) are tested with hand-picked examples. Property-based testing (e.g., with `fast-check`) would catch edge cases like Unicode combining characters, RTL marks, or surrogate pairs.

7. **No mutation testing.** With 2,000+ tests, mutation testing (e.g., Stryker) would reveal which tests are actually exercising the code vs. merely passing because the code happens to be correct.

### 4.3 Flaky Test Risk Assessment

| Test File | Flakiness Risk | Reason |
|-----------|---------------|--------|
| `client-server-only-boundary.test.ts` | **Medium** | Uses TypeScript compiler API to parse entire source tree. Cold import of `typescript` can exceed timeout under CPU contention. Already had a timeout bump (cycle 5). |
| `process-image-color-roundtrip.test.ts` | **Medium** | Uses Sharp to generate and decode images. File I/O and image processing are non-deterministic under load. The `afterAll` cleanup uses `Promise.all` with `.catch(() => {})` which could mask failures. |
| `data-tag-names-sql.test.ts` | **Low** | The Drizzle `.toSQL()` test dynamically imports `drizzle-orm` and `drizzle-orm/mysql-proxy`. Already had a timeout bump to 30,000ms. |
| `admin-backfill-runner-leak.test.ts` | **Low** | Uses `vi.waitFor()` with 5,000ms timeout. Under heavy CPU contention, the fire-and-forget runner may not complete within the window. |
| `touch-target-audit.test.ts` | **Low** | Scans entire source tree. The 15,000ms global timeout is generous, but adding new scan roots or files could push it over. |
| `e2e/admin.spec.ts` | **High** | Admin topic creation test uses `Date.now()` for slug generation. If two tests run concurrently (though workers=1, test isolation is within one worker), or if the DB has stale data, the test fails. The `try/finally` cleanup is good but the `isVisible().catch(() => false)` pattern could mask real failures. |

---

## 5. TDD Opportunities

The codebase does **not** follow TDD. Tests are written after implementation, often as regression guards after a bug is found in production. This is a valid approach for a mature codebase, but there are opportunities where TDD would improve design:

1. **New feature: Auto alt-text generation** (`lib/caption-generator.ts`)
   - The current implementation is a stub. TDD would force a clear API contract before implementation.
   - Opportunity: Write tests for the caption generation pipeline first, then implement.

2. **New feature: HDR AVIF delivery** (`lib/hdr-filenames.ts`, `process-image.ts`)
   - The HDR pipeline is partially implemented but not wired. TDD would clarify the delivery contract.
   - Opportunity: Write tests for `_hdr.avif` filename derivation and HDR detection before wiring.

3. **Refactor: Storage abstraction** (`lib/storage/`)
   - The storage layer is untested and not wired. TDD would force a clean interface.
   - Opportunity: Write tests for the `StorageBackend` interface first, then implement S3/MinIO adapters.

4. **New feature: Embedding model versioning** (`lib/clip-model-id.ts`)
   - AGG-14 calls for model-version isolation. TDD would prevent the version drift that necessitated the fix.
   - Opportunity: Write tests for model ID resolution and compatibility checks first.

---

## 6. Missing Edge Cases

### 6.1 Auth and Session

- **No test for session secret rotation:** What happens when `SESSION_SECRET` changes mid-session? Existing tokens should be invalidated.
- **No test for concurrent login attempts:** The rate limiter has per-IP and per-account buckets, but no test verifies the interaction when both buckets are near limit.
- **No test for cookie parsing edge cases:** The `admin_session` cookie could be malformed, contain multiple values, or be oversized. `session.ts` handles these but they are not tested.
- **No test for password change mid-session:** Changing password should invalidate all other sessions for that user.

### 6.2 Image Processing

- **No test for Sharp failure modes:** What happens when `sharp()` throws on a corrupted file? The queue has retry logic but no test for the error path.
- **No test for out-of-disk-space during encoding:** The `processImageFormats` function writes to `public/uploads/`. A full disk would cause silent failures.
- **No test for concurrent processing of the same image:** The advisory lock prevents this, but no test verifies the lock contention path.
- **No test for `deleteImageVariants` when files are missing:** The cleanup function should not throw if variants were already deleted.

### 6.3 Database and Data Layer

- **No test for connection pool exhaustion:** The pool has 10 connections. What happens when all are in use?
- **No test for DB timeout during long queries:** The `image_views` analytics queries can be slow. No test for query timeout behavior.
- **No test for transaction rollback:** `createTopic` uses a transaction, but no test verifies rollback on error.
- **No test for `GROUP_CONCAT` truncation:** The `group_concat_max_len` is set to 65535, but no test verifies behavior when tags exceed this limit.

### 6.4 Upload and File Handling

- **No test for symlink in upload path:** The upload routes reject symlinks via `lstat()`, but no test verifies this.
- **No test for upload quota enforcement:** `UPLOAD_MAX_TOTAL_BYTES` and `UPLOAD_MAX_FILES_PER_WINDOW` are configured but not tested.
- **No test for the upload processing contract lock:** `upload-processing-contract-lock.ts` acquires an advisory lock, but no test verifies the serialization.

### 6.5 Public Routes and Sharing

- **No test for shared group expiration:** Shared groups have no expiration, but if they did, the behavior is untested.
- **No test for shared group view count race conditions:** The view count is best-effort and buffered. No test for the flush-on-SIGTERM behavior.
- **No test for the OG image route when the image is deleted mid-render:** The OG route fetches the image asynchronously. A race condition is possible.

---

## 7. Recommendations

### 7.1 Immediate (High Priority)

1. **Add regression tests for the 6 new commits (bcd67b12 -> c0522dec):**
   - `bcd67b12`: Test `loadMoreImages` with non-array `tagSlugs` (string, null, object)
   - `9c5c38ca`: Test `deleteImageVariants` with `EACCES` vs `ENOENT` errors
   - `7453030e`: Test `retryFailedCollection` and `retryFailedEmbedding` with `isRestoreMaintenanceActive() === true`
   - `db55056f`: Test `createTopic` with `revalidatePath` throwing, verifying image NOT deleted
   - `5f4a5e95`: Test rate-limit getters returning immutable copies (mutate returned object, verify original unchanged)
   - `b22fa85e`: Test `deleteAdminUser`, `createLrToken`, `deleteLrToken`, `revokeAllLrTokens` with `isAdmin() === false`

2. **Add tests for `lib/gps-exif-strip.ts`** — This is a security-critical privacy feature with zero tests. At minimum, test that GPS coordinates are stripped from JPEG, TIFF, and HEIF files.

3. **Add tests for `lib/clip-inference.ts`** — The most complex untested file. Test model loading, inference batching, and error handling.

4. **Add component tests for `image-manager.tsx` and `upload-dropzone.tsx`** — These are the largest untested components with the most user-facing logic. Use React Testing Library with Vitest.

5. **Add e2e tests for semantic search** — The most complex new feature has no e2e coverage. Test the search input, results display, and empty state.

6. **Add tests for `lib/analytics-data.ts`** — Test the SQL generation and aggregation logic for country/referrer breakdowns.

### 7.2 Short-Term (Medium Priority)

7. **Add tests for server action error handling** — Every server action has error paths (DB failure, auth failure, validation failure) that are untested.

8. **Add tests for `lib/storage/local.ts`** — Test file operations, path validation, and directory creation.

9. **Add property-based tests for validation functions** — Use `fast-check` to test `isValidSlug`, `isValidFilename`, `isValidTopicAlias` with generated inputs.

10. **Add e2e tests for Firefox and mobile viewport** — The current e2e only tests Chromium desktop. Firefox has known gaps (wide-gamut MQ always false) that should be verified.

11. **Extract shared test utilities** — Create `src/__tests__/helpers.ts` with common mock setups, DB mocking, and Sharp fixture generation.

### 7.3 Long-Term (Lower Priority)

12. **Add snapshot tests for i18n strings** — Ensure `en.json` and `ko.json` stay in sync with snapshot testing.

13. **Add mutation testing** — Run Stryker to identify weak tests and improve the suite's effectiveness.

14. **Add integration tests for the full upload pipeline** — Test from file upload through processing to serving, verifying each derivative is created correctly.

15. **Add load tests for rate limiting** — Verify the rate limiter behaves correctly under concurrent requests.

---

## 8. Verification

The full test suite was run at the start of this review:

```
RUN  v4.1.9 /Users/hletrd/flash-shared/gallery/apps/web

 Test Files  225 passed | 2 skipped (227)
      Tests  2064 passed | 4 skipped (2068)
   Start at  12:11:42
   Duration  225.36s (transform 65.51s, setup 0ms, import 621.52s, tests 65.04s, environment 11ms)
```

All tests pass. The 2 skipped files and 4 skipped tests are gated behind environment flags (e2e setup, admin credentials) and are expected.

---

## 9. Conclusion

The GalleryKit test suite is **one of the strongest I have reviewed** for a project of this size. The fixture-style structural tests, security contract tests, and color pipeline integration tests are exemplary. The test culture is mature, with detailed regression documentation and careful mock isolation.

However, the **inverted test pyramid** (heavy on structural/lint tests, light on behavioral/component tests) creates real risk. The 52 untested React components, 8 untested server actions, and 15 untested lib/ modules represent significant coverage gaps. The e2e suite is thin and gated, leaving the most user-critical flows (upload, bulk edit, semantic search, mobile interactions) without automated verification.

**Most critically, 5 of the 6 commits since the previous review (c0522dec -> bcd67b12) are security fixes with NO regression tests.** This pattern — fixing bugs without adding tests — is the single biggest risk to the project's long-term maintainability. Each security fix should be accompanied by a test that would have caught the vulnerability.

**Priority order for improvement:**
1. Add regression tests for the 6 new commits (security fixes without tests)
2. Component tests for `image-manager.tsx`, `upload-dropzone.tsx`, `search.tsx`
3. Unit tests for `gps-exif-strip.ts`, `clip-inference.ts`, `analytics-data.ts`
4. E2E tests for semantic search, upload processing, and mobile viewport
5. Server action error-path tests
6. Shared test utilities and real-world image fixtures

---

*Review completed by Test Engineer agent. All findings are based on direct examination of source and test files at HEAD `bcd67b12`.*
