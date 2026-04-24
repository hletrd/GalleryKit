# Test Engineer Review — Cycle 1

## Inventory examined
- Workspace/test entry points: `package.json`, `apps/web/package.json`, `apps/web/playwright.config.ts`
- Unit/integration coverage: `apps/web/src/__tests__/*.test.ts` (52 files)
- Browser coverage: `apps/web/e2e/*.spec.ts` (4 specs)
- High-risk mutation/orchestration paths reviewed in source: `apps/web/src/app/actions/{auth,sharing,settings,seo}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/{request-origin,action-guards,restore-maintenance,db-restore,sql-restore-scan}.ts`, `apps/web/src/components/{photo-navigation,info-bottom-sheet}.tsx`
- Cross-file interactions checked: auth ↔ rate limiting ↔ session cookies, share-link actions ↔ revalidation ↔ DB rollback, DB backup/restore ↔ maintenance mode ↔ queue quiescing, E2E specs ↔ helpers ↔ route guards

## Verification
- `npm test --workspace=apps/web` → 52 files passed, 307 tests passed
- `npm run test:e2e --workspace=apps/web` → 19 tests passed

## Confirmed issues

### 1) Nav “visual checks” only create screenshots; they never assert a baseline
- **File/region:** `apps/web/e2e/nav-visual-check.spec.ts:5-39`
- **Why this is a problem:** each case ends with `page.screenshot(...)`, which only records an artifact. There is no snapshot comparison, no pixel diff, and no assertion that the nav actually matches a known-good layout.
- **Concrete failure scenario:** a CSS regression causes the mobile menu to overlap the search button or the desktop nav to lose spacing. The tests still pass because the screenshot call succeeds.
- **Suggested fix:** switch these cases to `expect(page).toHaveScreenshot(...)` or an equivalent diff-based workflow with stable viewport/font settings.
- **Confidence:** High

### 2) The origin-guard E2E is a false positive because it never authenticates the request
- **File/region:** `apps/web/e2e/origin-guard.spec.ts:26-46`, `apps/web/src/app/api/admin/db/download/route.ts:1-77`
- **Why this is a problem:** the test intentionally omits an admin session cookie, so `withAdminAuth(...)` can return `401` before the same-origin check matters. The assertion accepts both `401` and `403`, which means the test stays green even if the origin check is removed.
- **Concrete failure scenario:** a refactor breaks `hasTrustedSameOriginWithOptions(...)` or `requireSameOriginAdmin()`, but the test still passes because the route is rejected for unauthenticated access anyway.
- **Suggested fix:** add an authenticated request path with a seeded admin session and assert `403` specifically for a bad `Origin`; keep the auth-negative case as a separate test.
- **Confidence:** High

### 3) The auth action surface has no runtime regression tests for its highest-risk branches
- **File/region:** `apps/web/src/app/actions/auth.ts:70-416`
- **Why this is a problem:** the current tests around auth are mostly structural or helper-level (`auth-rate-limit-ordering.test.ts`, `auth-rethrow.test.ts`, `auth-rate-limit.test.ts`, `session.test.ts`). They do not execute `login`, `logout`, or `updatePassword` end-to-end enough to catch cookie, redirect, rollback, or origin-guard regressions.
- **Concrete failure scenario:** a change disables `secure` cookies behind HTTPS, stops rolling back account-scoped rate limits on an unexpected error, or weakens logout/session invalidation. The current tests would still pass because they only check ordering and token helpers.
- **Suggested fix:** add runtime tests for login success/failure, logout, and password change with mocked headers/cookies/db so the real branches are exercised.
- **Confidence:** High

### 4) Share-link lifecycle logic has no direct coverage
- **File/region:** `apps/web/src/app/actions/sharing.ts:92-420`
- **Why this is a problem:** there are no direct tests for `createPhotoShareLink`, `createGroupShareLink`, `revokePhotoShareLink`, or `deleteGroupShareLink`. That leaves retry loops, rate-limit rollback, duplicate-key recovery, and stale-row cleanup unpinned.
- **Concrete failure scenario:** a duplicate-key retry starts failing too early, a DB error leaks share-rate-limit budget, or revoke/delete stops revalidating `/p/:id` / `/g/:key` after a successful mutation.
- **Suggested fix:** add focused action tests for the four share-link entry points, including duplicate-key, foreign-key, and non-retryable error branches.
- **Confidence:** High

### 5) Backup/restore/CSV orchestration is only covered through helper slices, not the full action flow
- **File/region:** `apps/web/src/app/[locale]/admin/db-actions.ts:32-470`
- **Why this is a problem:** the existing tests (`backup-download-route.test.ts`, `db-restore.test.ts`, `sql-restore-scan.test.ts`) validate helper behavior, but they do not exercise the orchestration layer that owns child-process lifecycles, temp-file cleanup, maintenance mode, advisory locks, or queue quiesce/resume.
- **Concrete failure scenario:** `mysqldump` exits 0 but writes an empty/corrupt file, or `restoreDatabase()` returns early without resuming image processing / releasing the lock. Those regressions would still leave the current suite green.
- **Suggested fix:** add mocked `spawn`, filesystem, and connection tests for `exportImagesCsv`, `dumpDatabase`, and `restoreDatabase` covering success, spawn error, stream error, zero-byte output, and early-return cleanup.
- **Confidence:** High

### 6) Admin gallery/SEO settings write paths lack action-level coverage
- **File/region:** `apps/web/src/app/actions/settings.ts:37-136`, `apps/web/src/app/actions/seo.ts:52-138`, `apps/web/e2e/admin.spec.ts:40-58`
- **Why this is a problem:** the only visible coverage here is one UI toggle check in `admin.spec.ts` and a helper URL validator in `seo-actions.test.ts`. The real transactional write paths, allow-list checks, sanitization, same-origin rejection, and `image_sizes` locking branches are not directly exercised.
- **Concrete failure scenario:** a malformed setting key slips through, `image_sizes` changes while processed images already exist, or sanitized SEO values diverge from what is persisted. The current tests would not catch it.
- **Suggested fix:** add action tests for `updateGallerySettings` and `updateSeoSettings` to cover key rejection, sanitization, transaction rollback, `image_sizes` locking, and same-origin denial.
- **Confidence:** High

## Risks requiring manual validation

### 7) The desktop photo-navigation visibility test is timing-sensitive
- **File/region:** `apps/web/e2e/test-fixes.spec.ts:44-59`, `apps/web/src/components/photo-navigation.tsx:207-219`
- **Why this is a problem:** the test polls computed opacity during a CSS transition. That makes pass/fail depend on animation timing rather than a settled semantic state.
- **Concrete failure scenario:** a CI slowdown, `prefers-reduced-motion`, or a small CSS timing tweak leaves the opacity below the polling threshold long enough to fail intermittently.
- **Suggested fix:** assert a stable state instead of a transition midpoint, or disable the transition in test mode and wait for a final visible state.
- **Confidence:** Medium

## Final missed-issues sweep
- The unit suite is fast and deterministic; I did not find random-data or network-dependent flakes in Vitest.
- The main regression risk is underasserted coverage around admin mutation/orchestration paths and one screenshot-only browser check.
- Public interaction paths are better covered than admin write paths, but the highest-risk stateful flows still need direct runtime tests.
