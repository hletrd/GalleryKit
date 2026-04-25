# Cycle 5 Deep Repository Review — Test Engineer

## Scope and inventory

### Config/build/runtime files inventoried
- `package.json`
- `apps/web/package.json`
- `apps/web/vitest.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/next.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.typecheck.json`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`

### Unit/integration test files inventoried
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
- `apps/web/src/__tests__/content-security-policy.test.ts`
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

### E2E files inventoried
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/e2e/helpers.ts`

### High-risk source surfaces inspected in detail
- Sharing/public-share flow: `apps/web/src/app/actions/sharing.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/lib/data.ts`
- Settings/upload-contract flow: `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/lib/upload-tracker-state.ts`
- Runtime guardrails: `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/upload-paths.ts`
- Public/admin client behavior: `apps/web/src/components/load-more.tsx`, `apps/web/src/components/tag-filter.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/image-zoom.tsx`, `apps/web/src/components/lazy-focus-trap.tsx`, `apps/web/src/app/[locale]/admin/login-form.tsx`
- Upload/serve/image pipeline surfaces: `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`

## Findings

### 1) High — confirmed coverage gap: share-link creation/revocation/group flows have no direct regression tests
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Mutation logic spans `apps/web/src/app/actions/sharing.ts:21-389`
  - UI entry points are `apps/web/src/components/photo-viewer.tsx:269-299` and `apps/web/src/components/image-manager.tsx:171-191`
  - Public consumers are `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:32-125`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:27-180`, and `apps/web/src/lib/data.ts:552-669`
  - Repo search found no dedicated unit/e2e coverage for `createPhotoShareLink`, `createGroupShareLink`, `revokePhotoShareLink`, or `deleteGroupShareLink`
- **Failure scenario:** A rollback bug in the dual rate-limit path (`sharing.ts:117-186`, `229-305`), a race in conditional revocation (`308-345`), or a shared-group FK failure path (`288-299`) could silently ship and only appear under concurrent admin usage.
- **Recommendation:**
  - Add a focused `sharing-actions.test.ts` with mocked DB/auth/rate-limit/audit dependencies covering:
    1. existing key reuse,
    2. over-limit rollback,
    3. duplicate-key retry,
    4. missing/deleted image rollback,
    5. revoke race returning `noActiveShareLink`,
    6. group-delete success/error branches.
  - Add one E2E flow that creates a photo share and one that creates a group share, then verifies the generated `/s/[key]` and `/g/[key]` pages render and 404 after revocation/deletion.
  - TDD opportunity: write the revoke-race and FK-rollback tests first; those are the most failure-prone branches.

### 2) High — confirmed coverage gap: locale/admin middleware and request CSP behavior are untested
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Middleware logic lives in `apps/web/src/proxy.ts:20-101`
  - It owns CSP nonce/header propagation (`20-45`) plus locale-aware admin redirects (`48-94`)
  - Existing E2E only checks one unauthenticated redirect path: `apps/web/e2e/admin.spec.ts:9-13`
  - No unit tests reference `isProtectedAdminRoute`, `applyProductionCsp`, or `withProductionCspRequest`
- **Failure scenario:** A refactor could break `/en/admin/...` redirect handling, drop CSP headers in production responses, or treat malformed `admin_session` cookies as valid enough to skip redirect. The current suite would still pass unless `/admin/dashboard` specifically regressed.
- **Recommendation:**
  - Add a middleware unit test file that exercises:
    1. `/admin` vs `/admin/dashboard`,
    2. `/<locale>/admin` vs `/<locale>/admin/dashboard`,
    3. malformed cookie redirect,
    4. production CSP nonce/header propagation,
    5. development no-op behavior.
  - Add one E2E assertion for a localized protected route (for example `/ko/admin/dashboard`) redirecting to `/ko/admin`.

### 3) Medium — confirmed coverage gap: upload-contract lock depends on untested global tracker state
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Global tracker state is implemented in `apps/web/src/lib/upload-tracker-state.ts:15-60`
  - Settings lock depends on it at `apps/web/src/app/actions/settings.ts:73-77`
  - Existing tests cover only reconciliation math in `apps/web/src/__tests__/upload-tracker.test.ts:1-74`; they do **not** cover `getUploadTracker`, `pruneUploadTracker`, `resetUploadTrackerWindowIfExpired`, or `hasActiveUploadClaims`
  - The admin settings UI exposes those contract-changing controls in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:142-186`
- **Failure scenario:** Expired claims may keep `uploadSettingsLocked` stuck on forever, or pruning may evict the wrong keys and allow settings changes during active uploads. Both bugs would evade current tests because the stateful global path is untested.
- **Recommendation:**
  - Add `upload-tracker-state.test.ts` that freezes time and covers:
    1. global singleton creation,
    2. one-window reset,
    3. two-window pruning,
    4. hard-cap eviction behavior,
    5. `hasActiveUploadClaims` before/after expiry.
  - Add one action-level test for `updateGallerySettings` proving an active claim blocks `image_sizes` / `strip_gps_on_upload` changes.

### 4) Medium — confirmed wrong/weak assertion: “visual check” tests do not actually assert visual correctness
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - `apps/web/e2e/nav-visual-check.spec.ts:5-39` only captures screenshots to `test-results/*.png`
  - There is no `toHaveScreenshot`, no baseline comparison, and no pixel/assertion step
- **Failure scenario:** Major nav layout regressions can ship while this suite stays green because saving a screenshot file is not a regression assertion.
- **Recommendation:**
  - Replace raw `page.screenshot({ path: ... })` calls with `expect(nav).toHaveScreenshot(...)` or `expect(page).toHaveScreenshot(...)` snapshots.
  - Keep the existing visibility assertions, but treat screenshot generation as evidence only after comparison is enforced.

### 5) Medium — likely wrong-behavior coverage: admin settings E2E checks optimistic toggle state, not persisted settings behavior
- **Severity:** Medium
- **Confidence:** High
- **Status:** Likely
- **Evidence:**
  - The test named `admin settings GPS toggle reflects in the hydrated UI` only checks local `data-state` flips: `apps/web/e2e/admin.spec.ts:40-58`
  - The actual save contract requires `updateGallerySettings(...)` and toast/rehydration behavior: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:34-68` and `apps/web/src/app/actions/settings.ts:38-162`
- **Failure scenario:** The switch can animate locally while the save action fails, strips/normalizes different values, or rejects due to `uploadSettingsLocked`. This test would still pass and falsely imply the setting works.
- **Recommendation:**
  - Replace or supplement with an E2E that toggles the value, clicks **Save**, asserts success/failure toast, reloads the page, and verifies the persisted state.
  - Add one unhappy-path E2E for the locked state when existing images or active upload claims block the change.

### 6) Medium — confirmed false-confidence pattern: several “regression” tests assert source text, not runtime behavior
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - `apps/web/src/__tests__/admin-user-create-ordering.test.ts:22-145`
  - `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:19-130`
  - `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22`
  - These tests use `readFileSync`, regex slicing, and `indexOf()` string offsets rather than importing functions and observing behavior
- **Failure scenario:** A semantic regression can pass if the same strings remain in comments/dead code, while harmless refactors can fail if text shifts. That gives brittle CI and weak behavioral protection around security/rate-limit ordering.
- **Recommendation:**
  - Convert these into behavior-driven tests with mocked collaborators:
    - For auth/admin ordering: assert invalid form data returns before `incrementRateLimit` is invoked.
    - For settings locking: assert the action queries images / returns `imageSizesLocked` or `uploadSettingsLocked` under controlled mocks.
  - Keep at most one static-text test where AST/source scanning is the feature under test; otherwise prefer executable assertions.

### 7) Medium — likely coverage gap: client-side pagination/filter state transitions are effectively untested
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely
- **Evidence:**
  - Pagination state/race logic is in `apps/web/src/components/load-more.tsx:21-83`
  - Tag query mutation logic is in `apps/web/src/components/tag-filter.tsx:17-47`
  - Existing public E2E covers home/search/lightbox/shared-group navigation (`apps/web/e2e/public.spec.ts:4-119`) but does not exercise tag filtering, query replacement, intersection-driven pagination, or stale-response suppression
- **Failure scenario:** A slow `loadMoreImages` response from an old query can append stale images after a tag change, or `TagFilter` can preserve/remove the wrong `tags` query string ordering. Those regressions are user-visible and currently unguarded.
- **Recommendation:**
  - Add component tests for:
    1. `LoadMore` ignoring stale responses when `queryVersionRef` changes,
    2. observer-triggered loading,
    3. error toast path,
    4. `TagFilter` add/remove/clear query-string behavior.
  - Add one E2E that filters by tag, verifies URL mutation, then loads more to confirm results stay scoped to the selected tag set.

### 8) Medium — confirmed coverage gap: startup/shutdown runtime wiring is untested
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - `apps/web/src/instrumentation.ts:1-35` wires startup checks, queue bootstrap, SIGTERM/SIGINT handlers, shared-group flush, and `process.exit(0)`
  - No test files reference `register()`
  - This code reaches into `upload-paths`, `image-queue`, and `data` at process lifecycle boundaries
- **Failure scenario:** A boot regression can skip legacy-upload safety checks, fail to attach shutdown handlers, or drop queued image/view-count work on termination. Those are high-impact operational bugs with zero automated coverage.
- **Recommendation:**
  - Add `instrumentation.test.ts` with mocked dynamic imports and `process.once`/`process.exit` spies.
  - Cover Node vs non-Node runtime, handler registration, successful drain, and timeout/error branches.

## Missed-issues sweep
- I re-swept for uncovered runtime surfaces using symbol/path search across source, test, and E2E files.
- Additional uncovered files exist in lower-risk UI shell areas (`admin-header`, `admin-nav`, some `ui/*` wrappers, `theme-provider`, `footer`, `topic-empty-state`), but I did **not** find another gap that is more urgent than the eight findings above.
- I also checked for existing tests that mention the share actions, upload tracker state, middleware helpers, and instrumentation entrypoint; those references are absent or partial as called out above.
- Highest remaining unreviewed risk after the items above is direct image-processing branch coverage (`process-image.ts` / `process-topic-image.ts`) beyond the current smoke coverage.

## Files reviewed
- All config/test/E2E files listed in the inventory sections above
- Focused source review on:
  - `apps/web/src/app/actions/sharing.ts`
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
  - `apps/web/src/app/[locale]/admin/login-form.tsx`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  - `apps/web/src/components/photo-viewer.tsx`
  - `apps/web/src/components/image-manager.tsx`
  - `apps/web/src/components/load-more.tsx`
  - `apps/web/src/components/tag-filter.tsx`
  - `apps/web/src/components/info-bottom-sheet.tsx`
  - `apps/web/src/components/image-zoom.tsx`
  - `apps/web/src/components/lazy-focus-trap.tsx`
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/lib/upload-tracker-state.ts`
  - `apps/web/src/proxy.ts`
  - `apps/web/src/instrumentation.ts`
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/process-topic-image.ts`
  - `apps/web/src/lib/gallery-config.ts`
  - `apps/web/src/lib/upload-paths.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - `apps/web/src/app/api/health/route.ts`
  - `apps/web/src/app/api/live/route.ts`
  - `apps/web/src/app/uploads/[...path]/route.ts`
  - `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
