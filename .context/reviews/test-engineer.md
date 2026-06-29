# Cycle 18 Test-Engineer Review

Date: 2026-06-30 KST
HEAD: `4ad6a394`
Scope: current HEAD of `/Users/hletrd/flash-shared/gallery`
Lane: test-engineer, cycle 18

## Inventory Summary

Read `AGENTS.md` and `CLAUDE.md` first, then inventoried the current repo before selecting findings. This review is test-only: no application changes were made or recommended as required work inside this cycle artifact.

- Vitest: `apps/web/src/__tests__/**/*.test.{ts,tsx}` under `apps/web/vitest.config.ts`.
- Playwright: 5 specs in `apps/web/e2e/`: `admin`, `public`, `origin-guard`, `nav-visual-check`, `test-fixes`.
- API routes inspected under `apps/web/src/app/api`, including admin DB download, Lightroom upload, health/live, OG, and semantic/similar search.
- Server actions inspected under `apps/web/src/app/actions/` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Migration gate inspected across `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, and `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.
- PWA/public metadata surfaces inspected: `manifest.ts`, generated icon script/assets, sitemap/robots tests, dynamic topic route guards.
- Gate surfaces inspected: lint scanners for API auth, action origin, public route rate limit, typecheck/build/test scripts, and e2e server wiring.

Validation performed during this review:

- Read-only shell inventory/search and line-number inspection only.
- Verified current PNG dimensions with `file` while reviewing the PWA icon gap.
- Did not run full `lint`, `typecheck`, `build`, `test`, or Playwright. This is a review-only artifact and no implementation was requested.

## Confirmed Findings

### TE18-01. Middleware CSP/header wiring is not behavior-tested

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/proxy.ts:21-34` copies a generated CSP from request headers to the response only in `applyProductionCsp`.
- `apps/web/src/proxy.ts:36-50` generates the nonce and request-side CSP in `withProductionCspRequest`.
- `apps/web/src/proxy.ts:76-118` must pass the CSP-mutated request into `intlMiddleware(cspRequest)` and wrap both redirect and normal responses with `applyProductionCsp`.
- `apps/web/src/proxy.ts:128-130` also emits `x-gk-admin-render` whenever an `admin_session` cookie is present.
- Existing CSP tests exercise only `buildContentSecurityPolicy` directly at `apps/web/src/__tests__/content-security-policy.test.ts:5-66`.
- The service-worker contract only source-checks the admin-render marker at `apps/web/src/__tests__/sw-template-contract.test.ts:209-216`.
- The admin e2e smoke checks unauthenticated redirect at `apps/web/e2e/admin.spec.ts:14-18`, but does not assert middleware response headers.

Concrete failure not currently caught:
A refactor can accidentally call `intlMiddleware(request)` instead of `intlMiddleware(cspRequest)`, drop `applyProductionCsp` on redirects, or stop emitting CSP headers on production HTML. The CSP builder tests would still pass because the builder output is unchanged. The admin-render marker can also drift from real middleware behavior while the source grep remains green.

Suggested test/fix:
Add a focused middleware behavior test that imports the default proxy handler, forces production mode, builds `NextRequest` instances for `/en` and `/en/admin/dashboard`, and asserts `Content-Security-Policy` is present with a nonce-bearing `script-src` and no production `unsafe-inline`. Include cookie/no-cookie assertions for `x-gk-admin-render`. If direct proxy import is brittle under Next, add a Playwright production-header smoke against the standalone e2e server.

### TE18-02. Lightroom upload route is still protected mostly by source-contract tests

Severity: Medium
Confidence: High

Evidence:
- The route authenticates via the PAT-aware wrapper at `apps/web/src/app/api/admin/lr/upload/route.ts:68-75`.
- It preclaims and settles upload quota at `apps/web/src/app/api/admin/lr/upload/route.ts:114-150`, then parses multipart form data at `apps/web/src/app/api/admin/lr/upload/route.ts:153-223`.
- It owns high-risk runtime branches: advisory lock and disk check at `apps/web/src/app/api/admin/lr/upload/route.ts:252-305`, HDR/GPS/restore cleanup at `apps/web/src/app/api/admin/lr/upload/route.ts:357-401`, DB insert at `apps/web/src/app/api/admin/lr/upload/route.ts:404-462`, enqueue payload at `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`, audit logging at `apps/web/src/app/api/admin/lr/upload/route.ts:525-540`, and lock release at `apps/web/src/app/api/admin/lr/upload/route.ts:544-551`.
- The main LR test explicitly documents that it is a source-text contract because the route is multipart/token-auth heavy at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16`.
- That file continues with regex/order assertions for many critical branches, e.g. upload quota/parser ordering at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:250-282` and insert containment/source contracts at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:309-360`.
- The browser e2e upload smoke at `apps/web/e2e/admin.spec.ts:132-160` exercises the dashboard upload path, not `/api/admin/lr/upload` or the PAT flow.

Concrete failure not currently caught:
The route can return the right-looking source strings while runtime behavior is broken: a mocked `formData()` failure may fail to settle the tracker, an HDR/GPS reject may skip cleanup, the insert payload may omit `uploaded_by` or color fields after a refactor, or enqueue may omit snapshot fields. Regex assertions do not prove the branches execute with real `FormData`, `File`, `NextRequest`, mocked DB, and mocked queue dependencies.

Suggested test/fix:
Add a focused route-level Vitest suite that invokes `POST` with a real `FormData`/`File` and mocked dependencies. Cover at least one success path and one post-save rejection path. Assert status, `settleUploadTrackerClaim`, `deleteOriginalUploadFile`, inserted values including `uploaded_by` and color/HDR fields, enqueue payload, and lock release. Keep source-contract tests for ordering, but make at least one behavioral test prove the route can actually execute.

### TE18-03. Migration reconcile coverage is a source tripwire, not schema equivalence

Severity: Medium
Confidence: High

Evidence:
- `apps/web/scripts/migrate.js:307-702` manually reconciles legacy/fresh schemas through table DDL, `ensureColumn`, `ensureColumnDefinition`, `ensureIndex`, `ensureForeignKey`, and drop helpers.
- The coverage test says its column check is a source tripwire, not a structural validator, at `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`.
- The table/column assertions only require table creation text and comment-stripped name presence at `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:86-103`.
- The index assertions collect names from SQL and only require name presence in `migrate.js` at `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:124-172`.
- Drop removals are pinned by specific source regexes at `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:190-208`.

Concrete failure not currently caught:
A new or edited migration can be mirrored with the right column/index names but wrong type, nullability, default, foreign-key action, index column order, or index uniqueness. The current test still passes because it does not compare an actual reconciled database against Drizzle/current SQL metadata. That is exactly the gate-fragility class for fresh DBs and legacy re-baselines.

Suggested test/fix:
Add an integration gate that runs `npm run init` against a disposable MySQL schema, then diffs `information_schema` tables/columns/indexes/foreign keys against Drizzle schema plus committed migration expectations. Keep the source tripwire for fast feedback, but make the structural diff the authoritative regression test for `reconcileLegacySchema`.

### TE18-04. PWA manifest and generated icon assets lack installability tests

Severity: Low
Confidence: High

Evidence:
- `apps/web/src/app/manifest.ts:6-52` builds the Web App Manifest dynamically, including `display_override`, categories, theme/background colors, and five icon entries.
- The committed PNG icons are produced by `apps/web/scripts/generate-pwa-icons.ts:61-75`.
- Existing sitemap/robots coverage at `apps/web/src/__tests__/sitemap-robots.test.ts:21-85` does not import or assert the manifest.
- Repo search found PWA icon mentions only in the generator and one service-worker derivative exclusion check, `apps/web/src/__tests__/sw-cache.test.ts:107-108`; no test validates manifest icon entries or actual PNG dimensions.

Concrete failure not currently caught:
The manifest can drop `display_override`, lose the maskable icon purpose, point to a missing icon, or ship a regenerated icon with wrong dimensions/corruption. Browsers would degrade or reject installability while unit/build gates remain green.

Suggested test/fix:
Add `manifest.test.ts` that mocks `getSeoSettings`, calls `manifest()`, and asserts `name`, `short_name`, `display`, `display_override`, categories, colors, and required icons with exact `src`, `sizes`, `type`, and `purpose`. Add a small asset test using `sharp.metadata()` for `public/icons/icon-192.png`, `icon-512.png`, and `icon-maskable-512.png`.

### TE18-05. Reserved topic route segments are duplicated without a sync test

Severity: Low
Confidence: Medium

Evidence:
- The dynamic topic route has its own file/metadata route reservation set at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:19-31`.
- That route returns noindex metadata for reserved segments at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:33-40` and `notFound()` for the page at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:129-139`.
- Validation has a separate `RESERVED_TOPIC_ROUTE_SEGMENTS` list at `apps/web/src/lib/validation.ts:4-25`, with a comment saying it must stay in sync with the route.
- Current validation tests cover only a subset of static/localized segments at `apps/web/src/__tests__/validation.test.ts:122-138`; they do not cover `apple-icon`, `favicon.ico`, `icon`, `manifest`, `manifest.webmanifest`, `robots.txt`, or `sitemap.xml`, and do not compare the route-local list with validation.

Concrete failure not currently caught:
A future edit can let admins create a topic slug such as `manifest` or `icon`, or can remove the dynamic-route guard for one reserved public file route while validation still passes. The result is route shadowing or inconsistent admin validation versus runtime behavior.

Suggested test/fix:
Centralize the reserved public-file segments in an exported constant and consume it from both validation and the topic page, then test the full list. If the route-local helper must stay private, add a source-sync test plus route behavior tests for representative reserved segments asserting `generateMetadata()` returns `robots: { index: false, follow: false }` and `TopicPage()` calls `notFound()`.

### TE18-06. Admin token auth rate-limit wrapper path has no wrapper-level test

Severity: Medium
Confidence: High

Evidence:
- The PAT branch in `withAdminAuth` pre-increments the token-auth limiter and returns 429 before `verifyToken` at `apps/web/src/lib/api-auth.ts:72-81`.
- Existing wrapper tests cover token success, header defaults, invalid token, wrong scope, and request-scoped token context at `apps/web/src/__tests__/api-auth-response-headers.test.ts:50-149`.
- The rate-limit helper itself is tested in `apps/web/src/__tests__/semantic-search-rate-limit.test.ts:62-81`.
- Repo search shows no test where `preIncrementAdminTokenAuthAttempt` is mocked to return `true` while invoking `withAdminAuth`; semantic route rate-limit assertions do not prove the auth wrapper gates PAT probes before token verification.

Concrete failure not currently caught:
A refactor can remove or move the wrapper-level `preIncrementAdminTokenAuthAttempt` call after `verifyToken`. Helper tests still pass, and token response-header tests still pass, but invalid PAT guessing can hit expensive token verification and avoid the intended 429/`Retry-After` branch.

Suggested test/fix:
Extend `api-auth-response-headers.test.ts` with a mocked `@/lib/rate-limit` branch where `preIncrementAdminTokenAuthAttempt` returns `true`. Assert the response is 429 with `Retry-After: 60`, `Cache-Control` no-store, `verifyToken` is not called, `markTokenUsed` is not called, and the wrapped handler is not called.

## Final Missed-Issues Sweep

- Re-checked the cycle 17 scanner findings against current tests before writing this file. The public-route scanner now has local/inverted helper fixtures, and the action-origin scanner now has try-before-limiter catch/finally fixtures, so those are not repeated here.
- Reviewed high-risk areas for additional blind spots: admin actions, public analytics routes, CLIP tests, service worker contracts, migration journal handling, upload processing, privacy omit guards, and e2e bootstrapping.
- Remaining watch item not counted as a finding: real CLIP semantic/offline tests are intentionally env-gated (`CLIP_INTEGRATION=1`, `CLIP_OFFLINE_LOAD=1`) and therefore not part of default CI. That is an operational coverage risk, but the tests themselves clearly document the gate and production-weight requirement.

## Count

6 confirmed findings.
