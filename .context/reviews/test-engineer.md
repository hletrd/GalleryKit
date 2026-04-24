# Test Engineer Review

## Scope and method
- Reviewed all relevant repo-owned runtime and test surfaces under `apps/web/src/**/*.ts(x)`, `apps/web/e2e/*.ts`, `apps/web/scripts/*.ts`, and test/config entrypoints (`vitest.config.ts`, `playwright.config.ts`, `next.config.ts`).
- Explicitly excluded generated/vendor artifacts (`.next/**`, `node_modules/**`, `test-results/**`, historical review artifacts under `.context/**`) from findings.
- Inventory reviewed: **148** runtime source files in `apps/web/src`, **54** Vitest files, **5** Playwright spec files + **1** helper, plus lint/config scripts.
- Fresh verification: `npm test --workspace=apps/web` → **54 passed, 316 passed, 0 failed** on **2026-04-24**.

## Overall assessment
- **Suite health:** Healthy, but strongly skewed toward utility/helper coverage.
- **Main risk pattern:** many critical action / route / processing / page flows are either untested or only protected by structural source-text assertions.
- **Confirmed flakes:** none found with high confidence.
- **Likely weak points:** long-running admin E2E and screenshot-only specs.

## Findings

### 1) HIGH — Confirmed coverage gap — session auth path is barely tested
- **File/region:** `apps/web/src/lib/session.ts:16-145`
- **Current coverage:** `apps/web/src/__tests__/session.test.ts:1-44` only checks hash length and token format.
- **Why this matters:** the untested logic contains the actual security contract: production-only secret enforcement, DB fallback generation, HMAC verification, timestamp expiry/future rejection, stale-session deletion, and DB lookup by hashed token.
- **Failure scenario:** a regression could accept forged/future tokens, stop deleting expired sessions, or silently fall back to DB secrets in production.
- **Concrete failing tests to add first:**
  1. rejects tokens with mismatched signature / malformed part count;
  2. rejects future timestamps and >24h-old timestamps;
  3. deletes expired DB sessions and returns null;
  4. `getSessionSecret()` throws in production when `SESSION_SECRET` is missing/short;
  5. concurrent `getSessionSecret()` calls reuse the same promise instead of writing duplicate secrets.
- **Concrete fix if tests fail:** keep the current logic but extract DB-secret bootstrap and token-age validation into directly testable helpers.
- **Confidence:** high.

### 2) HIGH — Confirmed coverage gap — share-link mutation flows are completely unprotected by tests
- **File/region:** `apps/web/src/app/actions/sharing.ts:92-388`
- **Why this matters:** this file owns photo/group share creation, DB+memory rate-limit symmetry, duplicate-key retry, FK rollback, revoke races, and delete semantics.
- **Failure scenario:** admins can get permanently rate-limited after duplicate-key/FK failures, revoked links can race with recreation, or invalid/unprocessed images can still get share links.
- **Concrete tests to add first:**
  1. `createPhotoShareLink` returns existing key without consuming rate limit;
  2. over-limit DB branch rolls back both counters;
  3. duplicate key retries stop after success and after 5 failures;
  4. `createGroupShareLink` rolls back on `ER_NO_REFERENCED_ROW_2` and mismatched insert counts;
  5. `revokePhotoShareLink` does not revoke a newly recreated key when the conditional update affects 0 rows;
  6. `deleteGroupShareLink` maps concurrent already-deleted groups to `groupNotFound`.
- **Concrete fix if tests fail:** extract rate-limit rollback helpers and transactional share creation into isolated pure helpers / injected DB adapters.
- **Confidence:** high.

### 3) HIGH — Confirmed coverage gap — settings actions have zero regression tests despite config-lock logic
- **File/region:** `apps/web/src/app/actions/settings.ts:16-135`
- **Why this matters:** this is the only write path for gallery-wide quality/privacy/image-size settings.
- **Failure scenario:** a regression could accept unknown keys, persist unsanitized values, allow `image_sizes` changes after processed images exist, or return stale non-normalized settings to the UI.
- **Concrete tests to add first:**
  1. rejects unknown keys before touching DB;
  2. trims/strips control chars before validation and returns normalized values;
  3. rejects invalid `image_sizes` strings;
  4. blocks `image_sizes` changes when at least one processed image exists;
  5. deletes blank settings so defaults reapply;
  6. revalidates the full app tree on success.
- **Concrete fix if tests fail:** keep the transaction boundary, but extract `sanitize+validate+normalize` into a pure helper used by both action and tests.
- **Confidence:** high.

### 4) HIGH — Confirmed coverage gap — image delete / batch delete / metadata update paths are barely tested
- **File/region:** `apps/web/src/app/actions/images.ts:349-620`
- **Current coverage:** `apps/web/src/__tests__/images-actions.test.ts:1-97` only locks one revalidation path and empty-slug tag rejection on upload.
- **Why this matters:** the highest-risk admin mutations are currently untested.
- **Failure scenario:** invalid filenames bypass safety checks, partial file cleanup is silently lost, batch delete miscounts stale/not-found rows, or sanitized metadata is not returned to the client.
- **Concrete tests to add first:**
  1. `deleteImage` rejects invalid stored filenames before filesystem calls;
  2. `deleteImage` reports `cleanupFailureCount` when one derivative delete fails;
  3. `deleteImages` returns correct `count/errors/cleanupFailureCount` for mixed found/stale IDs;
  4. `deleteImages` switches to `revalidateAllAppData()` when `foundIds.length > 20`;
  5. `updateImageMetadata` trims/strips values and returns normalized payload;
  6. `updateImageMetadata` rejects overlong title/description before DB work.
- **Concrete fix if tests fail:** isolate cleanup-plan calculation and metadata normalization into testable helpers.
- **Confidence:** high.

### 5) HIGH — Confirmed coverage gap — admin-user deletion logic is untested
- **File/region:** `apps/web/src/app/actions/admin-users.ts:193-274`
- **Current coverage:** `admin-users.test.ts` and `admin-user-create-ordering.test.ts` only cover create-user behavior.
- **Why this matters:** delete-user correctness is concurrency-sensitive and security-sensitive.
- **Failure scenario:** self-delete / last-admin prevention regresses, advisory lock timeout returns the wrong error, sessions are left behind, or concurrent deletes double-log / partially commit.
- **Concrete tests to add first:**
  1. rejects self-delete;
  2. rejects deleting the last remaining admin;
  3. maps lock acquisition failure to `failedToDeleteUser`;
  4. deletes sessions before the user row inside the transaction;
  5. maps missing target to `userNotFound`.
- **Concrete fix if tests fail:** wrap raw-connection branch in a thin repository so lock / transaction paths can be mocked deterministically.
- **Confidence:** high.

### 6) HIGH — Confirmed coverage gap — shared-group/search/view-count data logic is effectively untested
- **File/region:** `apps/web/src/lib/data.ts:11-109`, `594-845`
- **Current coverage:** `data-pagination.test.ts`, `privacy-fields.test.ts`, and `public-actions.test.ts` cover only narrow helpers/callers.
- **Why this matters:** this file contains public read-path privacy and performance logic, plus the shared-group view buffer.
- **Failure scenario:** shared groups leak expired/invalid keys, image tags are mis-associated, buffered view counts are dropped or never retried, alias search duplicates results, or search result limits/dedupe regress.
- **Concrete tests to add first:**
  1. `getSharedGroup()` returns null for invalid keys and expired groups;
  2. `getSharedGroup({ incrementViewCount:false })` does not buffer view increments;
  3. view-count flush rebuffers failed chunks and applies backoff after total failure;
  4. `searchImages()` dedupes main/tag/alias matches and respects limit trimming;
  5. alias search path still excludes already-seen IDs;
  6. `getTopicBySlug()` resolves CJK/emoji aliases after direct-slug miss.
- **Concrete fix if tests fail:** export a small internal test seam for the view-count buffer/flush state.
- **Confidence:** high.

### 7) HIGH — Confirmed coverage gap — image-processing pipelines have no regression coverage
- **File/region:** `apps/web/src/lib/process-image.ts:170-589`, `apps/web/src/lib/process-topic-image.ts:42-106`
- **Why this matters:** these files own file validation, EXIF extraction, derivative generation, temp-file cleanup, GPS parsing, and topic-image processing.
- **Failure scenario:** invalid images leave temp files behind, historical derivatives are not deleted, EXIF GPS bounds regress, ICC parsing throws, or topic-image cleanup leaves orphaned `tmp-*` files.
- **Concrete tests to add first:**
  1. `deleteImageVariants()` removes historical variants when `sizes=[]`;
  2. `saveOriginalAndGetMetadata()` rejects zero-byte / oversized / bad-extension files and removes partial writes;
  3. `processImageFormats()` copies instead of re-rendering duplicate resize widths and produces non-empty base files;
  4. `extractExifForDb()` rejects out-of-range GPS coordinates and preserves valid DMS conversion;
  5. `processTopicImage()` removes temp/output files on Sharp failure;
  6. `cleanOrphanedTopicTempFiles()` only removes `tmp-*` files.
- **Concrete fix if tests fail:** split pure EXIF parsing / filename generation / cleanup enumeration from Sharp/FS integration.
- **Confidence:** high.

### 8) MEDIUM — Confirmed coverage gap — upload path and storage-backend fallback paths are untested
- **File/region:** `apps/web/src/lib/upload-paths.ts:48-93`, `apps/web/src/lib/storage/index.ts:52-143`
- **Why this matters:** these modules hide migration and rollback behavior that only appears during failures.
- **Failure scenario:** original-file fallback prefers the wrong path, production warnings never fire, or backend switch rollback restores a half-initialized backend.
- **Concrete tests to add first:**
  1. `resolveOriginalUploadPath()` prefers private root then falls back to legacy public root;
  2. `assertNoLegacyPublicOriginalUploads()` warns in dev and throws in production mode;
  3. `switchStorageBackend()` keeps the old backend when the new backend init fails;
  4. `getStorage()` coalesces concurrent init calls.
- **Concrete fix if tests fail:** inject fs/backend factories instead of closing over globals.
- **Confidence:** high.

### 9) MEDIUM — Confirmed coverage gap — OG image route has no direct tests
- **File/region:** `apps/web/src/app/api/og/route.tsx:27-157`
- **Why this matters:** this route is user-input-driven and easy to regress without noticing.
- **Failure scenario:** invalid topic params return 200 instead of 400, tag validation drifts, text clamping breaks, or cache headers disappear.
- **Concrete tests to add first:**
  1. rejects invalid/missing `topic` with 400;
  2. clamps oversized `label` and `site` strings;
  3. drops invalid tags and limits accepted tags to 20;
  4. returns cacheable success headers and no-store failure headers.
- **Concrete fix if tests fail:** export `clampDisplayText`, `topicLabelFromSlug`, and param parsing for unit coverage.
- **Confidence:** high.

### 10) MEDIUM — Confirmed coverage gap — page/component behavior is mostly covered only by happy-path E2E
- **File/region:**
  - `apps/web/src/components/search.tsx:52-135,187-260`
  - `apps/web/src/components/photo-viewer.tsx:27-34,107-180,138-141`
  - `apps/web/src/components/image-manager.tsx:118-251,303-498`
  - `apps/web/src/components/admin-user-manager.tsx:35-77`
  - `apps/web/src/components/nav-client.tsx:35-68`
  - `apps/web/src/components/home-client.tsx:14-42,90-106,167-230`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:24-105,107-220`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:27-188`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:26-129`
- **Why this matters:** core UI state machines are exercised only through broad browser flows, leaving edge cases unpinned.
- **Failure scenario:** stale search results win races, `Cmd/Ctrl+K` toggling breaks, shared-view query syncing regresses, locale-switch cookie preservation breaks, metadata generation diverges from rendered titles, or admin dialogs stop updating local state after successful mutations.
- **Concrete tests to add first:** targeted component tests for stale-search request ordering, `isEditableTarget`, shared-view `router.replace` syncing, locale-switch href/cookie preservation, edit-dialog optimistic state updates, and page `generateMetadata()`/JSON-LD branches.
- **Concrete fix if tests fail:** export small pure helpers (`buildPhotoPath`, metadata builders, locale-switch computation) and add React Testing Library coverage.
- **Confidence:** medium.

### 11) MEDIUM — Confirmed misleading-test pattern — several tests assert source text instead of behavior
- **Files/regions:**
  - `apps/web/src/__tests__/auth-rethrow.test.ts:16-53`
  - `apps/web/src/__tests__/admin-user-create-ordering.test.ts:22-146`
  - `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:19-78`
  - `apps/web/src/__tests__/db-pool-connection-handler.test.ts:22-55`
- **Why this matters:** these tests pass when strings remain present, even if runtime behavior breaks because logic moved, dead code was introduced, or the same text appears in comments / unreachable branches.
- **Failure scenario:** e.g. `unstable_rethrow(e)` could remain as dead text while the real catch path swallows control flow; ordering strings can still exist after a refactor that changes execution order.
- **Concrete fix:** keep one structural smoke test if desired, but add runtime tests around observable behavior (mock rate-limit functions, induce thrown Next control-flow signals, assert `getConnection()` waits for init promise).
- **Confidence:** high.

### 12) MEDIUM — Confirmed misleading test — “visual check” spec does not actually gate visuals
- **File/region:** `apps/web/e2e/nav-visual-check.spec.ts:5-39`
- **Why this matters:** the spec only writes PNG files to `test-results/`; it never compares against a baseline or asserts anything about pixels.
- **Failure scenario:** a severe nav regression still leaves the spec green as long as the page renders and screenshots can be written.
- **Concrete fix:** replace raw `page.screenshot({ path })` calls with Playwright snapshot assertions (`expect(page).toHaveScreenshot(...)` or element-level `toHaveScreenshot`) and commit/update baselines intentionally.
- **Confidence:** high.

### 13) LOW — Likely flaky candidate — admin upload E2E depends on queue completion timing
- **File/region:** `apps/web/e2e/admin.spec.ts:61-83`, `apps/web/e2e/helpers.ts:122-149`
- **Why this matters:** the test waits for background image processing by polling MySQL for 30s.
- **Failure scenario:** slow CI, cold Sharp startup, or transient DB latency causes intermittent timeouts even though the product is healthy.
- **Concrete fix:** make the timeout configurable, poll an explicit processing-status API/helper instead of raw DB state, and surface elapsed timing in failures.
- **Confidence:** medium.

## TDD priorities (best next failing tests)
1. `lib/session.ts` verification/expiry/production-secret tests.
2. `app/actions/sharing.ts` rollback + race tests.
3. `app/actions/settings.ts` image-size lock tests.
4. `app/actions/images.ts` delete/batch-delete/update metadata tests.
5. `lib/process-image.ts` filesystem/EXIF cleanup tests.
6. `lib/data.ts` shared-group/search/view-count tests.

## Final sweep
- **Reviewed with findings:** auth/session, admin-user actions/UI, image actions/UI, sharing, settings, data layer, image processing, upload/storage paths, OG route, page metadata, nav/search/photo viewer/home/shared pages, unit/e2e suites, config/lint gates.
- **Reviewed with no notable new test findings beyond existing coverage:** smaller utility wrappers/reexports (`action-result.ts`, `constants.ts`, many `components/ui/*` wrappers), plus existing lint-gate scripts already protected by dedicated source-inspection tests.
- **Skipped files:** none in the relevant runtime/test surface. Only generated/vendor/history artifacts were intentionally excluded.
