# Cycle 33 Test-Engineer Review

Role: test-engineer
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `168c3837`
Date: 2026-06-30
Scope: repo-wide review for test adequacy, flaky-test risk, missing regression locks, lint/test gate blind spots, TDD opportunities, and behavior coverage. No app/source files changed.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, root/app `package.json`, `vitest.config.ts`, `playwright.config.ts`, custom lint scripts, App Router route/action inventory, E2E specs, and targeted source/test pairs for candidate gaps.

Inventory evidence:

- Vitest files: 276 under `apps/web/src/__tests__`.
- Playwright specs: 5 under `apps/web/e2e`.
- Route handlers: 12 under `apps/web/src/app`; 8 are under `apps/web/src/app/api`.
- Source-contract-heavy tests: 117 test files contain source-file reads or source-contract assertions.
- Custom gates sampled: `npm run lint:public-route-rate-limit --workspace=apps/web` and `npm run lint:action-origin --workspace=apps/web` both passed.

## Findings

### TE33-01 - Public route rate-limit lint misses non-`/api` route handlers

- Severity: Medium
- Confidence: High
- Source/test regions: `apps/web/scripts/check-public-route-rate-limit.ts:1-11`, `apps/web/scripts/check-public-route-rate-limit.ts:25`, `apps/web/scripts/check-public-route-rate-limit.ts:74-85`; `apps/web/src/app/feed.xml/route.ts:41-53`; `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:41-78`; `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:739-744`.
- Evidence: the lint contract says expensive public GET handlers must use a rate-limit helper or explicit exemption, but discovery starts at `../src/app/api` only. The passing lint output listed only `src/app/api/...` routes, while public route handlers such as `/feed.xml` and `/{locale}/{topic}/feed.xml` do SEO/config/topic/feed DB work outside that tree.
- Escaping bug: a future expensive or mutating route handler under `src/app` but outside `src/app/api` can ship without rate limiting or a conscious exemption. Feed-like endpoints are especially easy to abuse because they are anonymous, cacheable but still rebuild XML after cache misses, and route handlers bypass page-level guards.
- Suggested fix/tests: expand discovery to all `src/app/**/route.{ts,tsx,js,mjs,cjs}` and explicitly exclude or exempt intended static/operational surfaces. Add scanner tests that prove `app/feed.xml/route.ts`-style paths are discovered, and add route-level exemptions where rate limiting is intentionally not required.

### TE33-02 - `auth.ts` is intentionally excluded from the server-action origin gate

- Severity: High
- Confidence: High
- Source/test regions: `apps/web/scripts/check-action-origin.ts:13-19`, `apps/web/scripts/check-action-origin.ts:49`, `apps/web/scripts/check-action-origin.ts:70-73`; `apps/web/src/__tests__/check-action-origin.test.ts:493-503`; `apps/web/src/app/actions/auth.ts:95-99`, `apps/web/src/app/actions/auth.ts:215-227`, `apps/web/src/app/actions/auth.ts:271-280`, `apps/web/src/app/actions/auth.ts:291-299`, `apps/web/src/app/actions/auth.ts:396-407`.
- Evidence: the scanner recursively covers `app/actions/**` but excludes any basename `auth`. The current `login`, `logout`, and `updatePassword` functions do hand-coded `hasTrustedSameOrigin` checks, yet the lint gate would not fail if a future mutating auth export omitted the check.
- Escaping bug: a future auth mutation such as email change, session revocation, recovery-token rotation, or a refactor of `logout`/`updatePassword` could read the session and mutate `sessions` or `admin_users` without same-origin provenance. `npm run lint:action-origin` would still report all mutating server actions as protected because `auth.ts` is outside the scanned set.
- Suggested fix/tests: either include `auth.ts` in the scanner with a second approved guard shape for `hasTrustedSameOrigin(headers)` plus early return/redirect, or add a dedicated auth-action scanner that enumerates exported auth mutators and verifies origin-before-session-read ordering. Keep the current behavior tests, but make the lint gate fail on new unguarded auth exports.

### TE33-03 - Lightroom upload route is still mostly source-locked, not behavior-locked

- Severity: Medium
- Confidence: High
- Source/test regions: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:27-66`; `apps/web/src/app/api/admin/lr/upload/route.ts:114-158`, `apps/web/src/app/api/admin/lr/upload/route.ts:225-240`, `apps/web/src/app/api/admin/lr/upload/route.ts:357-365`, `apps/web/src/app/api/admin/lr/upload/route.ts:395-477`, `apps/web/src/app/api/admin/lr/upload/route.ts:479-547`.
- Evidence: the test file explicitly chooses source-text contracts because the route is multipart/token/DB/queue heavy. The route itself has quota preclaims and settlement, topic validation, contract locks, disk checks, original save, HDR/GPS/restore cleanup branches, insert, enqueue, audit, and revalidation. Most of those branch outcomes are asserted by substrings/order rather than invoking `POST`.
- Escaping bug: a refactor can preserve the searched strings while changing runtime behavior: fail to settle tracker quota on malformed multipart/topic-missing/HDR reject, orphan an original after a post-save throw, enqueue with incomplete processing settings, or return a non-JSON 500 to external clients. The source tests would still pass if the strings remain in the file.
- Suggested fix/tests: add mocked route-level tests that import `POST` and exercise at least malformed multipart, missing file, topic missing, HDR reject with original deletion, GPS strip failure, late restore maintenance, post-save throw cleanup, and successful insert/enqueue/audit. Mock `withAdminAuth` or present a valid token-path wrapper, and mock DB/Sharp/queue boundaries so these stay fast.

### TE33-04 - Feed conditional coverage tests dead code while the live route behavior is source-greped

- Severity: Low
- Confidence: High
- Source/test regions: `apps/web/src/lib/feed-conditional.ts:1-16`; `apps/web/src/__tests__/feed-conditional.test.ts:1-66`; `apps/web/src/__tests__/feed-sized-derivative.test.ts:63-69`; `apps/web/src/app/feed.xml/route.ts:151-180`; `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:158-187`.
- Evidence: `feed-conditional.ts` still claims it is shared by both feed routes, but `rg` found only the dead helper test and a source test that explicitly asserts the routes do not contain `isFeedNotModified`. The live 304 logic is inline ETag handling in the two route files; current tests mainly check for source strings.
- Escaping bug: the helper tests can stay green while the live feed routes regress conditional request behavior, for example by dropping `ETag`, mishandling comma-separated `If-None-Match`, returning a stale 304 after SEO/settings changes, or omitting cache headers on the 304 branch. Source-grep tests are easy to satisfy without proving the response semantics.
- Suggested fix/tests: delete the dead helper/test or repurpose it only if the routes actually call it. Add executable route tests with mocked `getSeoSettings`, `getGalleryConfig`, `getImagesForFeed`, and `getTopicBySlug` to assert 200 headers/body, matching `If-None-Match` 304, nonmatching ETag 200, and invalid locale/topic 404 behavior.

## Non-Findings

- The custom scanner internals are stronger than plain grep for the files they discover: the action-origin and public-route tests cover aliases, spoofed imports, dead branches, ignored results, local helper hiding, nested callbacks, and mutation-before-gate ordering.
- Admin E2E is CI-enforced when credentials are expected: `admin.spec.ts` and `origin-guard.spec.ts` skip locally, but both have CI guard tests that require admin coverage when `CI=true`.
- Upload serving has behavior tests for `serveUploadFile` plus route wiring tests for GET/HEAD method propagation; I did not count those static upload route handlers as a rate-limit finding without a product decision that image serving should be metered.

## Final Sweep

Final sweep covered route/action discovery, scanner fixtures, auth action exceptions, feed route/source tests, LR upload route/source tests, Playwright skip/CI behavior, route-handler inventory, source-contract density, and the two relevant custom lint gates. I did not run the full lint/typecheck/build/test/e2e suite because this was a review-only lane; targeted lint gates passed as evidence above.
