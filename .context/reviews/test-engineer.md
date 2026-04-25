# Test Engineer Deep Review — Cycle 8 Prompt 1

Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-25
Reviewer focus: test strategy, TDD shape, flakiness, regression coverage, weak assertions

## Inventory reviewed

Reviewed without sampling:
- Unit/Vitest: all `apps/web/src/__tests__/*.test.ts` files (59 files)
- E2E/Playwright: all `apps/web/e2e/*.spec.ts` files plus `apps/web/e2e/helpers.ts`
- Test/runtime config: `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`
- Relevant scripts: all files under `apps/web/scripts/`
- Source under test and adjacent critical source: action/lib/component/route files referenced by tests, plus uncovered critical flows in `auth`, `settings`, `sharing`, `seo`, `api/og`, search/nav/photo viewer, upload/storage/config, and shared-group view-count buffering.

## Findings

### Confirmed risks

#### 1) Critical auth flows are mostly protected by source-text tests, not executable behavior tests
- **Severity:** High
- **Confidence:** High
- **Files:**
  - `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:17-25,31-139`
  - `apps/web/src/__tests__/auth-rethrow.test.ts:12-15,17-52`
  - `apps/web/src/app/actions/auth.ts:70-245,247-429`
- **Why this is confirmed:** the current tests explicitly read `auth.ts` as text and assert string ordering/contains. There is no runtime unit test exercising successful login, failed login, logout CSRF rejection, session insertion/deletion, account-scoped bucket reset, or password-change session rotation.
- **Failure scenario:** a refactor can preserve the searched strings while breaking behavior: wrong cookie flags, partial session rotation, incorrect rollback after DB failure, wrong redirect locale, or broken logout deletion.
- **Concrete test/fix:** add executable tests for `login`, `logout`, and `updatePassword` with mocked `cookies`, `headers`, `db.transaction`, `argon2`, `verifySessionToken`, and rate-limit helpers. Cover:
  - login success resets IP + account buckets and sets secure cookie correctly
  - login invalid credentials increments only once and returns localized error
  - logout cross-origin request redirects without deleting session
  - updatePassword rotates *all* sessions and inserts exactly one fresh session
  - unexpected DB failure rolls back pre-incremented counters

#### 2) Share-link mutation actions have no direct tests despite high race/rollback complexity
- **Severity:** High
- **Confidence:** High
- **Files:**
  - `apps/web/src/app/actions/sharing.ts:92-187`
  - `apps/web/src/app/actions/sharing.ts:189-305`
  - `apps/web/src/app/actions/sharing.ts:308-389`
- **Why this is confirmed:** there is no `sharing*.test.ts` coverage. The action file contains retry loops, conditional updates, DB + in-memory rollback, transaction-based group creation, and concurrent-revocation protection.
- **Failure scenario:** stale share keys can be returned, rate-limit buckets can drift on failures, FK failures can charge the admin anyway, or concurrent revoke/create can revoke the wrong key.
- **Concrete test/fix:** add a dedicated `sharing-actions.test.ts` covering:
  - existing `share_key` short-circuit
  - over-limit rollback for both photo/group share paths
  - duplicate-key retry exhaustion
  - `ER_NO_REFERENCED_ROW_2` rollback on group creation
  - conditional revoke returning `noActiveShareLink` when another request replaced the key
  - delete-group transaction ordering and revalidation paths

#### 3) Settings and SEO admin mutations are under-tested; the only settings guard is static text
- **Severity:** High
- **Confidence:** High
- **Files:**
  - `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:5-22`
  - `apps/web/src/__tests__/seo-actions.test.ts:5-20`
  - `apps/web/src/app/actions/settings.ts:39-164`
  - `apps/web/src/app/actions/seo.ts:54-143`
- **Why this is confirmed:** settings coverage is limited to one source-slice assertion around `image_sizes`; SEO coverage tests only `validateSeoOgImageUrl`, not `updateSeoSettings`. No executable tests cover transactionality, sanitized return payloads, invalid-key rejection, upload-claim locking, `strip_gps_on_upload` locking, deletion-on-empty, or full-app revalidation.
- **Failure scenario:** invalid admin keys slip through, sanitized values differ from persisted values, upload-setting lockouts regress, or empty values stop deleting rows and silently pin stale config.
- **Concrete test/fix:** add `settings-actions.test.ts` and `seo-actions-runtime.test.ts` with mocked DB transaction + audit + revalidation. Cover:
  - invalid key rejection
  - sanitization before validation
  - `hasActiveUploadClaims()` lock path
  - `image_sizes` and `strip_gps_on_upload` existing-image lock paths
  - empty value deletes row
  - success returns sanitized settings and calls `revalidateAllAppData()`

#### 4) Shared-group view-count buffering/backoff has no regression coverage
- **Severity:** Medium
- **Confidence:** High
- **Files:**
  - `apps/web/src/lib/data.ts:11-108`
- **Why this is confirmed:** no test file exercises `bufferGroupViewCount`, `flushGroupViewCounts`, `flushBufferedSharedGroupViewCounts`, buffer-cap enforcement, or failure backoff.
- **Failure scenario:** DB outage could drop increments, leak timer state, or cause runaway retries/buffer growth without a failing test.
- **Concrete test/fix:** extract/ export a narrow test seam or add internal test hooks, then cover:
  - partial chunk failure re-buffering
  - full failure exponential backoff
  - buffer-cap drop behavior
  - maintenance-mode no-op
  - explicit flush cancelling the timer and draining remaining counts

#### 5) Search UI’s concurrency and keyboard-selection logic lacks direct tests
- **Severity:** Medium
- **Confidence:** High
- **Files:**
  - `apps/web/src/components/search.tsx:53-104,110-145,193-215`
  - `apps/web/e2e/public.spec.ts:21-59`
- **Why this is confirmed:** E2E covers open/focus/basic result visibility, but there is no direct unit/integration test for request-id stale-response suppression, debounce cleanup, arrow-key selection, Enter activation, or body-scroll unlock cleanup.
- **Failure scenario:** an older slow search response can overwrite a newer query, keyboard navigation can regress while the dialog still “opens”, or body scroll can remain locked after close.
- **Concrete test/fix:** add component tests for `Search` with mocked `searchImagesAction`; cover stale response dropping, debounce cancellation on rapid input changes, arrow navigation bounds, Enter navigation on active result, and body overflow restoration.

#### 6) The suite relies heavily on brittle source-inspection tests for UI/runtime behavior
- **Severity:** Medium
- **Confidence:** High
- **Files:**
  - `apps/web/src/__tests__/client-source-contracts.test.ts:5-33`
  - `apps/web/src/__tests__/db-pool-connection-handler.test.ts:19-20,23-67`
  - `apps/web/src/__tests__/images-delete-revalidation.test.ts:5-24`
  - `apps/web/src/__tests__/admin-user-create-ordering.test.ts:22-142`
  - `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:17-18,19-139`
- **Why this is confirmed:** these tests mostly assert `readFileSync(...).toContain()/toMatch()` rather than exercising behavior. They are useful as narrow guardrails, but many are standing in for missing runtime coverage.
- **Failure scenario:** behavior can break while strings remain present; conversely, benign refactors can cause noisy false failures.
- **Concrete test/fix:** keep the narrow structural guards only where AST/text shape is the actual contract (lint scanners), but replace UI/action/runtime source-contract checks with behavioral tests around exported functions/components.

### Likely risks

#### 7) Admin settings Playwright test can false-pass if persistence fails
- **Severity:** Medium
- **Confidence:** Medium
- **Files:**
  - `apps/web/e2e/admin.spec.ts:45-64`
- **Why this is likely:** the test only checks `data-state` before/after clicks. It never verifies that the mutation persisted, survived refresh, or returned success feedback.
- **Failure scenario:** the toggle updates locally in hydrated UI, but the server action fails or is ignored; the test still passes.
- **Concrete test/fix:** after toggling, wait for a save acknowledgement (toast/network idle if exposed), reload `/admin/settings`, and assert the value persisted; then restore the original state.

#### 8) Fixed 30s DB polling in E2E upload helper is a probable CI flake source
- **Severity:** Medium
- **Confidence:** Medium
- **Files:**
  - `apps/web/e2e/helpers.ts:151-173`
  - `apps/web/e2e/admin.spec.ts:83-88`
- **Why this is likely:** the helper polls MySQL every 500ms and hard-fails at 30s. Slow image processing, cold build caches, or slower CI disks can exceed that budget intermittently.
- **Failure scenario:** upload/delete workflow flakes only in slower runners although the app is correct.
- **Concrete test/fix:** make timeout configurable via env, log observed processing duration, and prefer waiting on a UI/API completion signal where possible instead of DB polling alone.

### Manual-validation / evidence gaps

#### 9) “Visual” nav checks are artifact generation, not assertions
- **Severity:** Medium
- **Confidence:** High
- **Files:**
  - `apps/web/e2e/nav-visual-check.spec.ts:5-40`
- **Why this is manual-validation risk:** these tests save screenshots but do not compare against a baseline or assert pixel/DOM invariants beyond a few visibility checks.
- **Failure scenario:** layout regressions slip through CI unless someone manually opens the generated PNGs.
- **Concrete test/fix:** either convert to Playwright snapshot assertions (`toHaveScreenshot`) with stable masking/thresholds, or downgrade these to explicit manual-review scripts outside the automated gate.

## Missing regression coverage for prior-fix areas

- `auth.ts` prior rate-limit/session-rotation fixes are guarded mainly by static source checks, not runtime regressions.
- `settings.ts` prior image-size locking fix has only `settings-image-sizes-lock.test.ts`, which is static and does not execute `updateGallerySettings()`.
- `sharing.ts` contains multiple rollback/race comments and fix history but has no dedicated regression suite.
- `search.ts` contains explicit stale-request protection (`requestIdRef`) with no dedicated test locking that behavior.

## Final missed-issues sweep

Additional sweep across uncovered critical files found no stronger high-confidence gaps than the items above, but these remain notable secondary gaps:
- `apps/web/src/app/api/og/route.tsx:25-118` has no direct tests for invalid params, tag truncation/filtering, or response caching headers.
- `apps/web/src/lib/upload-tracker-state.ts:15-60` has no direct tests for pruning / active-claim detection, even though `settings.ts` depends on it to lock upload-contract changes.
- `apps/web/src/lib/storage/index.ts:52-141` has no direct tests for backend switching / init rollback.

## Overall assessment

- **Test strategy health:** mixed
- **Strengths:** strong coverage on many pure helpers, good security-lint scanner tests, useful smoke E2E around public/admin routes
- **Weakness pattern:** too many critical action flows are covered by source-shape assertions or not covered at all; several visual/e2e checks prove “page loads” rather than “behavior is correct and persisted”
- **Recommended next TDD order:**
  1. `sharing-actions.test.ts`
  2. executable `auth` action tests
  3. executable `settings` + `seo` action tests
  4. `search` component concurrency/keyboard tests
  5. `data.ts` shared-group view-count buffering tests
