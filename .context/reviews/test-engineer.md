# Test-engineer review — GalleryKit

Scope: `/Users/hletrd/flash-shared/gallery` at the current worktree state. This was a read-only review except for this report file; I did not implement fixes or run gates because the requested task was a coverage/gate review and the Playwright suite writes artifacts under `test-results/`.

## Inventory built and examined

Excluded as generated/runtime/artifacts: `node_modules/`, `.git/`, `.next/`, `dist/`, `coverage/`, `test-results/`, uploaded image derivatives, `.omx/`, `.omc/`, prior `.context/` review/plan artifacts, and binary assets.

Review-relevant inventory examined:

- **Root/config/docs:** `.dockerignore`, `.env.deploy.example`, `.github/dependabot.yml`, `.github/workflows/quality.yml`, `.gitignore`, `.nvmrc`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, `package-lock.json`, `scripts/deploy-remote.sh`.
- **Web config/deploy/migrations/messages/scripts:** `apps/web/.dockerignore`, `apps/web/.env.local.example`, `apps/web/.gitignore`, `apps/web/Dockerfile`, `apps/web/README.md`, `apps/web/components.json`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/drizzle.config.ts`, all committed `apps/web/drizzle/**` migration/meta files, `apps/web/eslint.config.mjs`, `apps/web/messages/{en,ko}.json`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/package.json`, `apps/web/playwright.config.ts`, `apps/web/postcss.config.mjs`, all `apps/web/scripts/*`, `apps/web/tailwind.config.ts`, `apps/web/tsconfig*.json`, `apps/web/vitest.config.ts`.
- **Tests:** 71 Vitest files under `apps/web/src/__tests__/*.test.ts`; 6 Playwright files under `apps/web/e2e/*.ts`.
- **Application source:** 55 app route/action files under `apps/web/src/app/**`, 45 component files under `apps/web/src/components/**`, 57 lib/db/i18n/proxy/instrumentation files under `apps/web/src/{lib,db,i18n}/**`, `apps/web/src/proxy.ts`, and `apps/web/src/instrumentation.ts`.

Current test shape: unit gate is `vitest run` (`apps/web/package.json:13`), E2E gate is `npx playwright test` (`apps/web/package.json:19`), CI runs lint, typecheck, custom security lints, unit tests, DB init, Playwright, then build (`.github/workflows/quality.yml:54-79`).

## Findings

### TE-01 — React/TSX component behavior is effectively outside the unit-test gate

- **Severity:** High
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:** `apps/web/vitest.config.ts:10-12` includes only `src/__tests__/**/*.test.ts`; there is no `.tsx` include pattern and no DOM/jsdom test environment. All discovered unit/spec files are `.ts`, not `.tsx`. Critical client flows live in TSX, e.g. `ImageManager` selection/share/bulk-delete/edit state at `apps/web/src/components/image-manager.tsx:62-193` and its toolbar controls at `apps/web/src/components/image-manager.tsx:253-333`; `PhotoViewer` share UI calls `createPhotoShareLink` in an inline handler at `apps/web/src/components/photo-viewer.tsx:303-328`.
- **Gap:** The suite can test exported pure helpers from components, but cannot TDD or regression-test rendered React behavior such as selection state, disabled/loading states, dialog submit paths, toast/error branches, focus restoration, or share URL construction at component level. Playwright covers a few user journeys, but not the state matrix inside the admin/photo components.
- **Failure scenario that could escape:** A refactor changes `ImageManager` so selecting rows no longer exposes the share/delete toolbar, `handleShare` clears selection before copying, or `PhotoViewer` builds `/g/` instead of `/s/` share URLs. Server action tests and lint/typecheck can still pass; E2E currently does not exercise those branches deeply.
- **Suggested test/fix:** Add a component-test lane (for example `src/**/*.test.{ts,tsx}` plus a DOM environment, or a separate Vitest config/project) and cover at least `ImageManager` row selection/share/bulk delete/edit-save branches and `PhotoViewer` share success/error/copy-failure branches with mocked server actions/clipboard/router/toasts. Keep pure helper tests in the fast node lane if desired.

### TE-02 — Sharing server actions have no behavioral unit coverage despite rate-limit, collision, rollback, audit, and revalidation logic

- **Severity:** High
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:** The sharing action surface is exported at `apps/web/src/app/actions.ts:16-17`. The implementation contains four mutating actions: `createPhotoShareLink` (`apps/web/src/app/actions/sharing.ts:92-188`), `createGroupShareLink` (`apps/web/src/app/actions/sharing.ts:190-308`), `revokePhotoShareLink` (`apps/web/src/app/actions/sharing.ts:310-348`), and `deleteGroupShareLink` (`apps/web/src/app/actions/sharing.ts:350-391`). The only share-key-specific unit test is a static `data.ts` source check in `apps/web/src/__tests__/share-key-length.test.ts:6-13`; tests do not import `@/app/actions/sharing` directly.
- **Gap:** Existing tests verify adjacent primitives (Base56 format, data lookup key length) but not action behavior: auth/origin/maintenance gates, processed-image checks, existing-key fast path, DB-backed + in-memory rate-limit rollback, duplicate-key retry, FK violation rollback, transaction link-count checks, audit metadata, or localized revalidation paths.
- **Failure scenario that could escape:** A change removes `rollbackShareRateLimitFull` from the duplicate/FK/error branch, stops revalidating `/s/{key}` or `/g/{key}`, accepts unprocessed images into a group, or changes retry semantics. Static source checks and E2E public shared-route navigation can still pass because they operate on seeded data rather than creating/revoking links through the actions.
- **Suggested test/fix:** Add mocked behavioral Vitest coverage for all four sharing actions. Minimum matrix: unauthorized/origin/maintenance rejection; invalid IDs; existing photo share key fast path; unprocessed image/group rejection; successful photo/group create with audit + `revalidateLocalizedPaths`; duplicate key retry; DB rate-limit overage rollback; FK violation and generic DB error rollback; revoke/delete race branches.

### TE-03 — `nav-visual-check` writes screenshots but never compares them to a baseline

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:** `apps/web/e2e/nav-visual-check.spec.ts:14`, `apps/web/e2e/nav-visual-check.spec.ts:27`, and `apps/web/e2e/nav-visual-check.spec.ts:39` call `page.screenshot({ path: ... })`; the file has no `expect(page).toHaveScreenshot(...)` or pixel/DOM snapshot assertion. Playwright config only retains screenshots/videos on failure globally (`apps/web/playwright.config.ts:59-61`), but these tests unconditionally write screenshots as side effects.
- **Gap:** The tests assert a few controls are visible/hidden, then save images. They do not fail on visual regressions: spacing, wrapping, overlap, color contrast, cropped controls, or dark/light theme regressions can pass while the screenshot artifact changes.
- **Failure scenario that could escape:** A CSS change makes the mobile expanded nav overlap the first photo card or pushes locale controls off-screen. The controls can still be technically visible, the test passes, and the screenshot is overwritten rather than compared.
- **Suggested test/fix:** Convert these to real visual assertions with Playwright snapshot baselines (`toHaveScreenshot`) or replace them with explicit layout assertions (bounding boxes, no overlap, viewport containment, contrast/a11y checks). If artifacts are only for manual review, move them out of the required test suite so the gate name does not imply visual regression coverage.

### TE-04 — Several regression tests are source-contract checks, not behavioral tests of the load-bearing code paths

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:** Representative examples:
  - `apps/web/src/__tests__/data-view-count-flush.test.ts:13-19` explicitly states it is fixture/source inspection instead of behavioral; assertions read `data.ts` and match regexes (`apps/web/src/__tests__/data-view-count-flush.test.ts:31-122`) for the runtime buffer at `apps/web/src/lib/data.ts:16-121`.
  - `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:5-22` reads action source rather than invoking `updateGallerySettings`.
  - `apps/web/src/__tests__/images-delete-revalidation.test.ts:5-23` checks for strings in `images.ts` instead of exercising `deleteImage(s)` revalidation output.
  - `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:19-104` and `apps/web/src/__tests__/auth-rethrow.test.ts:16-53` verify source ordering/strings in `auth.ts` rather than action results.
  - `apps/web/src/__tests__/db-pool-connection-handler.test.ts:23-66` checks the text of `db/index.ts`.
- **Gap:** Source-contract tests can be useful seatbelts, but they can pass when behavior is broken: code can contain the expected string in an unused branch, call the right helper with wrong arguments, swallow an error after the matched region, or fail due to a module-state interaction that regexes cannot observe.
- **Failure scenario that could escape:** `flushGroupViewCounts` still contains `viewCountBuffer = new Map()` and `db.update(sharedGroups)`, satisfying the regex, but a refactor changes the rebuffer count or retry map so increments are dropped after one transient DB failure. The static test passes; only a behavioral mock DB test would catch lost counts.
- **Suggested test/fix:** Keep source-contract tests only where AST/source shape is the actual contract, and add behavioral tests around the same load-bearing logic. For view counts, expose a test-only state reset/flush hook or inject a DB adapter and assert buffered increments survive partial failures, retry cap behavior, timer rearm, and maintenance skip. For action ordering/rate limits, use mocked `headers`, `db`, `argon2`, and cookies to assert return values and rollback calls, not just text offsets.

### TE-05 — Script/deployment gates do not match the operational surface they are supposed to protect

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:** Main typecheck excludes scripts (`apps/web/tsconfig.typecheck.json:10-13`), while `apps/web/tsconfig.scripts.json:6-10` exists but is not called by `apps/web/package.json:15`. CI runs `npm run typecheck` and tests (`.github/workflows/quality.yml:57-66`) but does not run a separate script typecheck. Operational scripts are live entrypoints: `apps/web/package.json:10`, `apps/web/package.json:17-22`; `apps/web/scripts/init-db.ts:24-30` shells into `node scripts/migrate.js`; `apps/web/scripts/migrate.js:244-463` contains substantial legacy-schema reconciliation. Docker deployment is also live (`apps/web/Dockerfile:60-90`, `apps/web/docker-compose.yml:1-25`) but CI ends with `npm run build` (`.github/workflows/quality.yml:78-79`), not a Docker build/entrypoint smoke.
- **Gap:** The quality gate validates the Next app and one empty-DB initialization path, but not TypeScript script compilation as a standalone contract, legacy migration branches, Dockerfile copy paths, entrypoint permissions/user-switch behavior, nginx config, or compose-specific environment wiring.
- **Failure scenario that could escape:** A script import/type error lands in `seed-e2e.ts` or `init-db.ts` but is outside the main typecheck; or a Dockerfile `COPY` path/dependency omission breaks production container startup while `npm run build` passes. A legacy deployed DB missing one reconciled column can fail even though CI's clean MySQL path succeeds.
- **Suggested test/fix:** Add `typecheck:scripts` (`tsc -p tsconfig.scripts.json --noEmit`) to CI or the main `typecheck` script. Add focused unit tests for exported migration helpers or extract pure helpers from `migrate.js` for fake-connection assertions. Add a lightweight Docker build smoke (possibly `docker build --target runner` with prepared site config) and a static nginx/compose sanity check if full container startup is too expensive.

### TE-06 — Middleware, metadata, and OG route behavior have thin or no route-level coverage

- **Severity:** Medium
- **Confidence:** High
- **Category:** Likely/confirmed by test inventory and grep
- **Evidence:** `proxy.ts` owns locale routing, admin route redirect, and production CSP nonce propagation (`apps/web/src/proxy.ts:73-107`), but tests only mention middleware indirectly in comments/search results. SEO/metadata endpoints are implemented in `apps/web/src/app/sitemap.ts:24-77`, `apps/web/src/app/robots.ts:10-18`, and `apps/web/src/app/manifest.ts:6-30`; no tests reference `sitemap`, `robots`, or `manifest`. The OG route validates params, rate-limits, computes ETags/cache headers, and renders `ImageResponse` (`apps/web/src/app/api/og/route.tsx:26-194`), while existing OG tests cover only the helper rate limiter (`apps/web/src/__tests__/og-rate-limit.test.ts:15-60`).
- **Gap:** These routes are public crawler/browser entrypoints and security/SEO surfaces, but the suite mostly tests helper functions. It does not assert middleware redirects for locale-prefixed and unprefixed admin routes, production CSP header propagation, sitemap fallback/budget/locale expansion, robots disallows, manifest DB values, OG 400/404/429/304/cache-control/ETag behavior, or tag sanitization in the rendered route.
- **Failure scenario that could escape:** A matcher change excludes `/en/admin/dashboard`, allowing an unauthenticated page shell through; a sitemap refactor emits more than 50,000 localized URLs; OG starts returning `no-store` on success or stops honoring `If-None-Match`. Unit helpers can still pass.
- **Suggested test/fix:** Add route-level tests with mocked `next-intl/middleware`, `getTopics`, `getImageIdsForSitemap`, `getSeoSettings`, `getTopicBySlug`, and `next/og`. Assert `proxy` redirect/no-redirect paths and CSP propagation; sitemap URL count and fallback; robots admin disallows; manifest uses SEO settings; OG invalid/missing/not-found/rate-limited/ETag/success cache headers.

### TE-07 — Touch-target gate documents and permits existing <44px admin controls, so it is not a true 44px floor

- **Severity:** Low to Medium
- **Confidence:** High
- **Category:** Confirmed
- **Evidence:** The audit declares the 44px floor at `apps/web/src/__tests__/touch-target-audit.test.ts:9-20`, but `KNOWN_VIOLATIONS` permits current violations: `components/image-manager.tsx: 5`, `components/admin-user-manager.tsx: 2`, `components/upload-dropzone.tsx: 1`, `components/admin-header.tsx: 1`, and admin route group counts (`apps/web/src/__tests__/touch-target-audit.test.ts:81-190`). The assertion checks actual count does not exceed the documented count (`apps/web/src/__tests__/touch-target-audit.test.ts:417-470`). One permitted example is the ImageManager toolbar/share/delete controls at `apps/web/src/components/image-manager.tsx:268-327` plus per-row icon buttons at `apps/web/src/components/image-manager.tsx:442-460`.
- **Gap:** This is a regression-count gate, not a conformance gate. It prevents *new* compact controls but allows known compact controls to remain forever, and stale reductions are explicitly informational rather than hard failures (`apps/web/src/__tests__/touch-target-audit.test.ts:453-457`).
- **Failure scenario that could escape:** Admin becomes mobile-primary or responsive admin table controls are used on touch devices, but existing 32/36px controls still pass because counts match the allowlist. A reviewer may read the test name as complete WCAG touch-target coverage.
- **Suggested test/fix:** Rename/scope the test to “new touch-target regression count” or split it into two gates: a strict zero-violation gate for public/mobile-primary surfaces and a tracked debt test for admin exceptions. Consider failing stale allowlist entries when actual count drops below documented count so cleanup cannot silently regress documentation.

## TDD opportunities and strengthening sequence

1. Add behavioral tests for `app/actions/sharing.ts` before changing share/revoke/group logic.
2. Add a React component test lane before refactoring `ImageManager`, `PhotoViewer`, `Search`, `NavClient`, `TagInput`, and admin managers.
3. Replace high-value source-regex tests with behavior-first tests while leaving source contracts as secondary guardrails where useful.
4. Add route-level tests for `proxy`, sitemap/robots/manifest, and `/api/og` before SEO or middleware refactors.
5. Add script and Docker smoke gates before further deploy/migration changes.

## Final sweep / coverage confirmation

- Examined all review-relevant source, config, script, migration, message, unit-test, and E2E files in the inventory above, excluding generated/runtime/artifact/binary paths.
- Confirmed the repo has broad coverage for validation/sanitization helpers, rate-limit primitives, upload/image-processing edge cases, selected server actions, restore/download guards, and several custom lint scanners.
- The most important gaps are not “no tests at all”; they are mismatches between critical behavior and what the tests actually prove: absent sharing-action behavior tests, no component DOM test lane, visual tests without visual assertions, source-text tests standing in for runtime behavior, and operational scripts/deploy surfaces not fully gated.
- No fixes were implemented.
