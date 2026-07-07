# Test-Engineer Review - Cycle 18 Prompt 1

Role: test-engineer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `a186340570351af0cab5347de21a5bb1b50c327a` (`origin/master` matches)
Scope note: read-only review. I did not edit source, commit, push, deploy, or touch `.context/reviews/cycle-8-2026-07-07/perf-reviewer.md`.

## Inventory Reviewed

- Test/gate config: root and web `package.json`, `vitest.config.ts`, `playwright.config.ts`, custom lint scripts.
- Unit tests: `apps/web/src/__tests__/**` inventory, with focused inspection of source-contract-heavy tests and custom lint-gate tests.
- E2E tests: `apps/web/e2e/*.ts`, admin opt-in helpers, Playwright project matrix.
- Source surfaces sampled against coverage: Cycle 17 changed paths, route/API/action guards, service worker generation, admin UI flows, image/CLIP/backfill/restore/session areas.
- Fresh checks run: `npm run lint:api-auth --workspace=apps/web`, `npm run lint:action-origin --workspace=apps/web`, and `npm run lint:public-route-rate-limit --workspace=apps/web` all passed.

## Confirmed Issues

### TEST-01 - Cycle 17 high-risk fixes are pinned mostly by source-shape contracts, not behavior

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:10-50`, `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:54-77`
- Evidence: The tests assert strings like `destroyPooledAdvisoryLockConnectionOnAcquireError`, `settleTrackerToActual(false)`, `attemptedEmbeddings++`, and selected log messages. They do not execute the affected error paths with mocked pool connections, upload-directory failures, or CLIP candidate batches.
- Why this is real: A refactor can keep the asserted string in a file while moving it outside the failing branch, skipping rollback, or incrementing the wrong counter. The test still passes because it validates text presence/order, not behavior.
- Concrete failure scenario: `GET_LOCK` acquisition throws after partially acquiring a lock; the file still contains the destroy helper, but the catch path releases the connection. The source contract passes, while a pooled session can retain an advisory lock.
- Suggested fix: Add behavior tests around the specific contracts: mocked `PoolConnection` acquisition failure destroys instead of releases; LR upload `ensureUploadDirectories()` failure settles quota and returns JSON; CLIP backfill skips failed metadata rows while advancing to later valid candidates.

### TEST-02 - Cycle 17 UI/operator-copy acceptance was not browser-verified

- Severity: Medium
- Confidence: High
- Location: `.context/plans/cycle-17-2026-07-08-plan.md:89-120`, `.context/plans/cycle-17-2026-07-08-plan.md:151-158`, `apps/web/src/__tests__/cycle-17-source-contracts.test.ts:80-112`
- Evidence: WP4 changed proxy routing, settings copy, destructive confirmation context, and analytics country labels. The plan explicitly says `npm run test:e2e` was not run. The replacement checks only search source/messages for tokens such as `confirmRevokeLabel`, `topicLabel: editingTopic.label`, `Intl.DisplayNames`, and literal copy.
- Why this is real: These are user-visible flows. Source tokens do not prove the confirmation text is rendered in the active dialog state, that localized country names appear after data load, or that `/icon` and `/apple-icon` resolve correctly through the running app.
- Concrete failure scenario: The token revoke dialog imports `confirmRevokeLabel` but renders a fallback string because the selected token state is reset before the dialog opens; source tests pass, but admins still see an ambiguous destructive confirmation.
- Suggested fix: Add narrow Playwright coverage for `/icon` and `/apple-icon`, token revoke dialog target text, topic alias delete target text, and analytics country rendering with seeded rows. Run it when these UI/routing surfaces change.

### TEST-03 - E2E browser matrix is Chromium desktop only

- Severity: Medium
- Confidence: High
- Location: `apps/web/playwright.config.ts:72-77`
- Evidence: The Playwright `projects` array contains only `chromium` with `Desktop Chrome`. No WebKit, Firefox, mobile, or touch-device project runs in the standard e2e suite.
- Why this is real: The app has browser-sensitive behavior: service worker caching, responsive navigation/admin surfaces, touch gestures, P3/HDR display signaling, clipboard permissions, and image zoom/pan. A single desktop Chromium project cannot prove those contracts.
- Concrete failure scenario: A Safari/WebKit mobile regression in photo swipe/zoom, service-worker install behavior, or wide-gamut display detection ships because Chromium desktop passes all e2e specs.
- Suggested fix: Add at least a scheduled or opt-in matrix for WebKit mobile and Firefox desktop for public browsing, photo viewer/lightbox, service worker registration, and core admin smoke. Keep default serial admin constraints, but separate browser-matrix public tests from credential-heavy admin flows.

## Likely Issues / Coverage Debt

### TEST-04 - Admin E2E remains conditionally skipped outside CI/credentialed runs

- Severity: Low-Medium
- Confidence: High
- Location: `apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/helpers.ts:28-45`
- Evidence: Local admin workflows skip unless plaintext admin credentials are available; CI asserts admin coverage only when `CI=true`. This is intentional, but it means local per-cycle `npm run test:e2e` can report green while skipping the most important authenticated flows.
- Failure scenario: A developer changes the token/settings/category UI and runs local e2e without admin credentials. The suite passes, but the changed authenticated workflow never ran.
- Suggested fix: Make cycle reports include the admin skip count and whether `adminE2EEnabled` was true. For UI/admin-touching work, require `npm run test:e2e:admin --workspace=apps/web` with seeded credentials or explicitly record the skip as a validation gap.

## Clean Areas

- Custom lint gates passed fresh:
  - `lint:api-auth`: both admin API route files wrapped with `withAdminAuth`.
  - `lint:action-origin`: scanned mutating server actions and reported same-origin coverage.
  - `lint:public-route-rate-limit`: scanned public API/feed/upload routes and reported rate-limit or documented exemptions.
- Vitest discovery is constrained to `src/__tests__/**/*.test.{ts,tsx}` and excludes `.next/**`, which avoids the known standalone-build duplicate-test flake.
