# Test Engineer Review

## Scope / inventory
I built and inspected the review surface for the repo before evaluating findings:

- `apps/web/src/**` application code: 151 files
- `apps/web/src/__tests__/**/*.test.ts`: 52 unit test files
- `apps/web/e2e/**`: 8 E2E files/assets
- `apps/web/scripts/**` plus test runner config: 14 script/config files
- Key runner/config files reviewed: `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`

I then did a missed-issues sweep over the untested/weakly-tested surfaces (actions, admin DB flows, image pipeline, search/UI state, middleware/security harnesses).

## Findings

### 1) Confirmed: the “visual check” E2E suite does not actually assert visuals
- **Type:** Confirmed issue
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `apps/web/e2e/nav-visual-check.spec.ts:5-39`
- **Why this matters:** All three tests only call `page.screenshot({ path: ... })` and never compare against a baseline (`toHaveScreenshot`) or inspect pixels/layout afterward.
- **Concrete failure scenario:** The nav layout regresses (missing spacing, overlapping controls, wrong breakpoint behavior) and the suite still passes because file creation alone is treated as success.
- **Recommendation:** Convert these to real snapshot assertions with stable masking/viewport controls, e.g. `await expect(nav).toHaveScreenshot(...)` or `await expect(page).toHaveScreenshot(...)` with deterministic fixtures.

### 2) Confirmed: the origin-guard E2E can pass even if CSRF/origin protection regresses
- **Type:** Confirmed issue
- **Severity:** High
- **Confidence:** High
- **Evidence:** `apps/web/e2e/origin-guard.spec.ts:27-47`
- **Why this matters:** The test accepts either `401` or `403` without an authenticated admin session. That means auth failure alone is enough to pass the test.
- **Concrete failure scenario:** `requireSameOriginAdmin()` or route-level origin enforcement is accidentally removed, but the unauthenticated request still returns `401`; the test stays green and misses the regression.
- **Recommendation:** Add an authenticated request-path assertion that distinguishes auth from origin enforcement: log in first, send a forged `Origin`, and require the explicit origin-rejection behavior (`403` or exact error body/header contract).

### 3) Confirmed: the settings E2E only verifies optimistic client state, not persistence
- **Type:** Confirmed issue
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `apps/web/e2e/admin.spec.ts:40-58`
- **Why this matters:** The test checks `data-state` before/after clicks, but never verifies that the server action succeeded or that the setting survives a refresh.
- **Concrete failure scenario:** The toggle updates locally, but `updateGallerySettings()` fails server-side or is blocked by same-origin/maintenance checks; the test still passes because the DOM attribute flips immediately.
- **Recommendation:** After toggling, save and reload the page, then assert the hydrated state matches persisted settings. Also assert success toast or network/server-action completion.

### 4) Confirmed coverage gap: action tests stub out same-origin enforcement, leaving no regression coverage for many mutating actions
- **Type:** Confirmed issue
- **Severity:** High
- **Confidence:** High
- **Evidence:**
  - `apps/web/src/__tests__/admin-users.test.ts:90-94`
  - `apps/web/src/__tests__/images-actions.test.ts:100-104`
  - `apps/web/src/__tests__/tags-actions.test.ts:107-111`
  - `apps/web/src/__tests__/topics-actions.test.ts:126-130`
- **Why this matters:** These suites explicitly replace `requireSameOriginAdmin()` with `async () => null`, so they cannot catch wiring regressions on the real action entrypoints.
- **Concrete failure scenario:** A future edit removes the origin check from one of these actions; the unit suite remains green because the guard is mocked away, and only a narrow scanner/E2E path might notice.
- **Recommendation:** Keep fast unit tests mocked, but add at least one integration-style test per action family that exercises the real guard behavior from the exported server action boundary.

### 5) Likely high-risk gap: gallery settings actions and UI have no direct regression tests
- **Type:** Likely risk
- **Severity:** High
- **Confidence:** High
- **Evidence:**
  - Server action surface: `apps/web/src/app/actions/settings.ts:16-136`
  - Client save/diff logic: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:22-180`
  - Only related E2E is the optimistic toggle check in `apps/web/e2e/admin.spec.ts:40-58`
- **Concrete failure scenarios:**
  - invalid keys bypass validation,
  - `image_sizes` normalization/lock behavior regresses,
  - changed-fields diffing skips a real change or resubmits unchanged values,
  - persisted server-normalized values are not rehydrated correctly.
- **Recommendation:** Add unit tests for `getGallerySettingsAdmin` / `updateGallerySettings` covering invalid keys, normalization, processed-image lockout, delete-on-empty, maintenance/origin gating, and returned normalized payload; add a component test for `SettingsClient.handleSave()` diffing and persistence rehydration.

### 6) Likely high-risk gap: share-link creation/revocation paths are completely untested
- **Type:** Likely risk
- **Severity:** High
- **Confidence:** High
- **Evidence:** `apps/web/src/app/actions/sharing.ts:92-388`
- **Concrete failure scenarios:**
  - `createPhotoShareLink()` fails to roll back counters on duplicate key / DB failure,
  - `createGroupShareLink()` mishandles FK deletion races (`ER_NO_REFERENCED_ROW_2`),
  - `revokePhotoShareLink()` revokes a newly-issued concurrent key incorrectly,
  - `deleteGroupShareLink()` deletes the group row but leaves link rows or misreports not-found.
- **Recommendation:** Add a dedicated `sharing-actions.test.ts` covering happy path, rate-limit rollback symmetry, duplicate-key retries, FK-race handling, conditional revoke race, and delete transaction error branches.

### 7) Likely high-risk gap: backup/restore actions have only route coverage, not action/process-failure coverage
- **Type:** Likely risk
- **Severity:** High
- **Confidence:** High
- **Evidence:** `apps/web/src/app/[locale]/admin/db-actions.ts:101-470`
- **Concrete failure scenarios:**
  - `dumpDatabase()` resolves success before pipe/write failures are handled,
  - `restoreDatabase()` leaks or mishandles advisory-lock/maintenance transitions,
  - dangerous SQL scanning or file-header validation regresses,
  - spawn/stdio failure paths stop cleaning temp files.
- **Recommendation:** Add unit tests that mock `spawn`, streams, `connection.getConnection()`, and temp-file I/O to cover backup success/failure, restore early returns, GET_LOCK / RELEASE_LOCK branches, dangerous-SQL rejection, and temp cleanup.

### 8) Likely high-risk gap: `deleteAdminUser()`’s concurrency-critical path is untested
- **Type:** Likely risk
- **Severity:** High
- **Confidence:** High
- **Evidence:** `apps/web/src/app/actions/admin-users.ts:193-273`
- **Why this matters:** Existing tests only cover `createAdminUser()` (`apps/web/src/__tests__/admin-users.test.ts:96-144`).
- **Concrete failure scenario:** A refactor breaks the advisory-lock / transaction logic and allows deleting the last remaining admin or returning the wrong error on lock timeout/user-not-found.
- **Recommendation:** Extend `admin-users.test.ts` with delete-path tests for self-delete rejection, invalid ID, lock timeout, last-admin prevention, missing-user, successful delete, and release-lock behavior.

### 9) Likely gap on the image processing hot path: core upload/transform functions are not directly tested
- **Type:** Likely risk
- **Severity:** Medium
- **Confidence:** High
- **Evidence:**
  - `apps/web/src/lib/process-image.ts:224-589`
  - `apps/web/src/lib/process-topic-image.ts:42-106`
- **Concrete failure scenarios:**
  - invalid extensions / empty files / corrupt files are accepted or cleaned up incorrectly,
  - EXIF/GPS parsing regresses on edge metadata,
  - largest-size “base filename” copy/link logic regresses and leaves missing base assets,
  - topic-image temp files leak after failed writes.
- **Recommendation:** Add focused unit tests around `saveOriginalAndGetMetadata`, `processImageFormats`, `extractExifForDb`, `processTopicImage`, and `cleanOrphanedTopicTempFiles`, with `sharp`/fs mocked where needed.

### 10) Likely client-behavior gap: search interaction coverage misses keyboard navigation and stale-response handling
- **Type:** Likely risk
- **Severity:** Medium
- **Confidence:** Medium-High
- **Evidence:**
  - Search logic: `apps/web/src/components/search.tsx:52-125, 182-230`
  - Existing E2E only covers open/focus/basic matching: `apps/web/e2e/public.spec.ts:21-59`
- **Concrete failure scenario:** A slow earlier request resolves after a later query and overwrites current results, or arrow/enter navigation activates the wrong result while the existing E2E still passes.
- **Recommendation:** Add component tests for debounce behavior, request-id stale-response suppression, arrow key movement, `Enter` selection, and body-scroll lock cleanup.

### 11) Likely performance-regression gap: no tests lock in the intended “no extra work” optimizations
- **Type:** Likely risk
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:**
  - Image variant dedupe/copy optimization: `apps/web/src/lib/process-image.ts:390-459`
  - CSV export row cap / truncation behavior: `apps/web/src/app/[locale]/admin/db-actions.ts:50-99`
  - Paged image sentinel logic is covered, but these hot-path I/O optimizations are not.
- **Concrete failure scenario:** A refactor re-renders identical widths repeatedly, or CSV export silently drops warning behavior / blows up memory again without any regression test catching it.
- **Recommendation:** Add targeted unit tests asserting duplicate resize-width reuse, base-file verification, CSV truncation warning at the 50k cap, and non-empty output validation.

## Weak assertions / flaky tendencies summary
- `apps/web/e2e/nav-visual-check.spec.ts:5-39` — weak assertion: screenshot creation instead of visual comparison.
- `apps/web/e2e/origin-guard.spec.ts:27-47` — weak assertion: auth failure can masquerade as origin-guard success.
- `apps/web/e2e/admin.spec.ts:40-58` — weak assertion: optimistic UI state checked without persistence.
- I did **not** find a clear, currently reproducible flaky test root cause as strong as the weak-assertion problems above; the bigger problem here is false positives / missing coverage rather than classic timing flake.

## TDD opportunities
1. `sharing.ts` — write failing tests first for rollback symmetry and concurrent revoke/create races.
2. `settings.ts` + `settings-client.tsx` — write failing tests for normalized `image_sizes`, processed-image lockout, and diffed save payloads.
3. `admin-users.ts` delete path — write failing tests for last-admin protection and advisory-lock timeout handling.
4. `db-actions.ts` restore path — write failing tests for invalid SQL dumps, GET_LOCK failure, and temp-file cleanup before any further refactors.
5. `search.tsx` — write failing interaction tests for stale request suppression and keyboard selection.

## Missed-issues sweep result
After sweeping the untested/high-risk surfaces, the biggest remaining exposure is concentrated in:
- admin mutation actions with mocked origin guards,
- destructive DB backup/restore flows,
- share-link workflows,
- image processing / storage hot paths,
- client interaction state machines that E2E currently covers only superficially.

I did not find additional confirmed defects stronger than the three weak-test issues above, but the uncovered surfaces are large enough that I would treat them as the next priority for regression hardening.
