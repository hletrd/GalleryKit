# Test Engineer Review — Cycle 7 RPF

## Scope and method
I reviewed the full test surface for this repo’s web app, not a sample:

- Config/scripts: `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/next.config.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`
- Playwright: `apps/web/e2e/admin.spec.ts`, `helpers.ts`, `nav-visual-check.spec.ts`, `origin-guard.spec.ts`, `public.spec.ts`, `test-fixes.spec.ts`
- Vitest: all 59 files under `apps/web/src/__tests__/*.test.ts`
- Source/test interaction sweep: mapped test imports plus repo-wide search for uncovered high-risk paths in `src/app`, `src/components`, `src/lib`, `src/db`, `src/proxy.ts`, and `src/i18n/request.ts`

## Inventory / coverage snapshot

### Current executable gates
- `npm run test --workspace=apps/web` → **59 passed files, 369 passed tests**
- `npm run lint:api-auth --workspace=apps/web` → **pass**
- `npm run lint:action-origin --workspace=apps/web` → **pass**

### Coverage shape from source→test mapping
- `src/lib`: 34 / 48 files have direct test imports
- `src/app`: 10 / 54 files have direct test imports
- `src/components`: 4 / 45 files have direct test imports
- `src/db`: 1 / 3 files have direct test imports
- `src/i18n`: 0 / 1 files have direct test imports
- `src/proxy.ts`: 0 / 1 files have direct test imports

### High-risk source paths currently lacking direct behavioral coverage
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/proxy.ts`
- `apps/web/src/i18n/request.ts`

## Findings

### 1) “Visual checks” do not actually assert visuals
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:** `apps/web/e2e/nav-visual-check.spec.ts:5-40`
- **Problem:** All three tests call `page.screenshot(...)`, but none compare against a golden image or any expectation. These tests only prove that a PNG file can be written.
- **Failure scenario:** A nav spacing/alignment regression ships; Playwright still passes because the file write succeeds and no diff is checked.
- **Suggested fix:** Replace raw screenshot writes with `await expect(nav).toHaveScreenshot(...)` or `await expect(page).toHaveScreenshot(...)`, commit baselines, and keep a separate “debug screenshot” path only for ad hoc investigation.

### 2) Too many critical regressions are guarded by source-text tests instead of runtime behavior
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:19-139`
  - `apps/web/src/__tests__/auth-rethrow.test.ts:16-52`
  - `apps/web/src/__tests__/client-source-contracts.test.ts:9-35`
  - `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22`
  - `apps/web/src/__tests__/db-pool-connection-handler.test.ts:22-67`
  - `apps/web/src/__tests__/images-delete-revalidation.test.ts:10-24`
- **Problem:** These tests read source files and assert string/regex presence. That catches some accidental deletions, but it does not verify runtime semantics, side effects, or integration boundaries.
- **Failure scenario:** A refactor leaves the expected string in a comment/dead branch/helper wrapper while actual behavior regresses; the static test still passes. The inverse also happens: harmless refactors fail tests because formatting or helper extraction changed.
- **Suggested fix:** Keep a small number of structural lint-style tests where absolutely necessary, but move critical contracts to behavioral tests with mocks/spies:
  - auth → assert rate-limit rollback, session rotation, cookie flags, and redirect behavior
  - settings → assert DB writes/deletes, normalization, and lock behavior under image/upload state
  - client components → render/interact and assert DOM/focus/router behavior rather than string presence
  - db pool → exercise wrapper functions with mocked connections instead of regexing implementation text

### 3) Auth actions are security-critical but still lack direct behavioral tests
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:** `apps/web/src/app/actions/auth.ts:70-267` and `270-428`; current auth-focused tests are mostly structural (`auth-rate-limit-ordering.test.ts`, `auth-rethrow.test.ts`) or helper-level (`session.test.ts`, `auth-rate-limit.test.ts`)
- **Problem:** The suite does not directly execute `login`, `logout`, or `updatePassword` through their success/error branches.
- **Failure scenario:** A future change stops deleting old sessions on login/password rotation, drops the secure-cookie condition, or returns the wrong localized error on same-origin rejection. Current tests can stay green because they mostly inspect source ordering rather than observable behavior.
- **Suggested fix:** Add a dedicated `auth-actions.test.ts` with mocked `cookies`, `headers`, `redirect`, `db`, `argon2`, and audit/rate-limit helpers covering at least:
  - login success rotates sessions and sets cookie flags correctly
  - login invalid credentials logs failure without creating a session
  - login over-limit branch rolls back both IP and account buckets
  - logout deletes the hashed session and clears the cookie
  - updatePassword rotates all sessions, sets a fresh cookie, and preserves rollback on transaction failure

### 4) Sharing and settings mutations have important state/error branches with little or no behavioral coverage
- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - `apps/web/src/app/actions/sharing.ts:92-187` and `189-260+`
  - `apps/web/src/app/actions/settings.ts:39-163`
  - repo-wide test search shows no dedicated sharing test file and only a structural settings lock test (`apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22`)
- **Problem:** Rate-limit rollback, duplicate-key retry, processed-image gating, normalized settings return values, and upload-lock/image-lock behavior are implemented in source but not exercised as behavior.
- **Failure scenario:**
  - sharing: DB duplicate-key retries or rollback paths drift and admins get charged attempts for infrastructure failures
  - settings: empty values stop deleting rows, normalized `image_sizes` stop round-tripping, or upload claims fail to lock dangerous config changes
- **Suggested fix:** Add focused action tests:
  - `sharing-actions.test.ts` for existing-share fast path, processed guard, over-limit rollback, duplicate-key retry, revoke/delete revalidation
  - `settings-actions.test.ts` for invalid keys, normalization, delete-on-empty, image-size lock, upload-claim lock, and transaction failure fallback

### 5) Playwright server reuse can hide fixture drift and produce non-reproducible local E2E outcomes
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely
- **Evidence:** `apps/web/playwright.config.ts:59-65`
- **Problem:** `reuseExistingServer: true` means a previously running local server bypasses the configured `init && e2e:seed && build && ...` command entirely.
- **Failure scenario:** A developer has an old server or stale DB already running on port 3100; Playwright reuses it, skips seed/build, and tests pass/fail based on stale fixtures instead of the current checkout.
- **Suggested fix:** Default `reuseExistingServer` to `false`, or gate reuse behind an explicit opt-in env var (`E2E_REUSE_SERVER=true`). If reuse stays enabled, seeding must move out of `webServer.command` into an explicit pretest step that always runs.

### 6) There is no coverage threshold or aggregate quality gate for the unit suite
- **Severity:** Medium
- **Confidence:** High
- **Status:** Risk
- **Evidence:**
  - `apps/web/vitest.config.ts:4-12`
  - `apps/web/package.json:8-22`
- **Problem:** Vitest is configured only with an `include` glob, and the app-level `test` script is just `vitest run`. There is no coverage collection, no minimum threshold, and no single script that enforces `test + typecheck + lint + custom security lint gates` together.
- **Failure scenario:** Coverage erodes in high-risk directories (`src/app`, `src/components`) while CI still reports green because the existing tests happen to pass.
- **Suggested fix:** Add coverage reporting with floor(s) for changed/high-risk areas and a single CI script such as `verify` that runs `lint`, `typecheck`, `test`, `lint:api-auth`, and `lint:action-origin` together.

## TDD opportunities
1. Start with failing behavioral tests for `auth.ts`, `sharing.ts`, and `settings.ts` before more refactors land there.
2. Convert `nav-visual-check.spec.ts` from screenshot capture to screenshot assertion before any further nav polish work.
3. Replace the most brittle source-text tests first (`client-source-contracts`, `settings-image-sizes-lock`, `images-delete-revalidation`) with behavior-level tests; keep text-based checks only where they intentionally act as lint rules.

## Final sweep / missed-issue check
I did a final pass specifically for commonly missed review items:
- flaky-local E2E setup drift
- screenshot tests that do not assert anything
- test helpers that mutate shared state
- security-sensitive actions covered only by structural tests
- route/page metadata surfaces with no direct regression coverage
- missing aggregate CI/coverage gates

No relevant test/config/e2e file from the inventory above was skipped in this review. The biggest overall pattern is not “tests are failing”; it is **green tests with large behavior gaps**, especially in auth/sharing/settings and in the visual suite.
