# Test-engineer review — GalleryKit cycle 1 continuation

Scope: `/Users/hletrd/flash-shared/gallery` at the current worktree state. I only wrote this report file. I did not edit source, test, config, fixture, or generated files.

## Inventory first

Excluded from review as generated/runtime/artifact paths: `.git/`, `node_modules/`, `.next/`, `coverage/`, binary screenshots, prior `.context/` plan/review artifacts except this output, and local OMX/OMC runtime state.

Review-relevant inventory inspected:

- **Quality entrypoints:** root `package.json` scripts (`package.json:11-21`), app scripts (`apps/web/package.json:8-25`), Vitest config (`apps/web/vitest.config.ts:1-10`), Playwright config (`apps/web/playwright.config.ts:1-70`), and CI workflow (`.github/workflows/quality.yml:54-79`).
- **Unit tests:** 72 current files under `apps/web/src/__tests__/*.test.ts` on disk; latest committed gate log in `.context/gate-logs/test.log` recorded 70 passing test files / 470 tests for that prior run.
- **E2E tests:** `apps/web/e2e/admin.spec.ts`, `helpers.ts`, `nav-visual-check.spec.ts`, `origin-guard.spec.ts`, `public.spec.ts`, `test-fixes.spec.ts`; fixtures are only two JPEGs: `e2e-landscape.jpg` and `e2e-portrait.jpg`.
- **Application source:** 156 current TS/TSX source files outside tests: 54 app route/action files, 45 component files, 51 lib files, plus db/i18n/proxy/instrumentation support files.
- **High-risk surfaces sampled deeply:** sharing actions, upload/image processing, topic image processing, shared-group view-count buffering, middleware/CSP, sitemap/robots/manifest/OG, admin backup download, e2e bootstrap/seed helpers, and representative source-contract tests.

## Findings

### TE-01 — React/TSX component behavior is mostly outside the unit-test gate

- **Severity:** High
- **Confidence:** High
- **Evidence:** `apps/web/vitest.config.ts:6-10` includes only `src/__tests__/**/*.test.ts` and does not configure a DOM/jsdom project. Complex client behavior lives in TSX components such as `Search` debounce/focus/result state (`apps/web/src/components/search.tsx:32-104`), infinite-load state and `IntersectionObserver` behavior (`apps/web/src/components/load-more.tsx:22-120`), and `PhotoViewer` navigation/lightbox/share state (`apps/web/src/components/photo-viewer.tsx:58-150`).
- **Failure scenario:** A refactor breaks keyboard search result navigation, stale search-response suppression, infinite-load query reset, or shared-route photo navigation. Pure helper tests and server-action tests still pass; current E2E covers only a small seeded subset of browser behavior.
- **Suggested fix:** Add a component-test lane (`*.test.tsx` + DOM environment, e.g. Testing Library) for `Search`, `LoadMore`, `PhotoViewer`, `ImageManager`, `TagInput`, and admin managers. Keep fast node-only tests for pure helpers if desired.

### TE-02 — Sharing server actions lack direct behavioral tests

- **Severity:** High
- **Confidence:** High
- **Evidence:** Four mutating actions carry auth, origin, maintenance, rate-limit, collision retry, rollback, audit, and revalidation logic: `createPhotoShareLink` (`apps/web/src/app/actions/sharing.ts:92-188`), `createGroupShareLink` (`apps/web/src/app/actions/sharing.ts:190-308`), `revokePhotoShareLink` (`apps/web/src/app/actions/sharing.ts:310-348`), and `deleteGroupShareLink` (`apps/web/src/app/actions/sharing.ts:350-391`). The share-key test currently reads `data.ts` source text rather than invoking actions (`apps/web/src/__tests__/share-key-length.test.ts:6-13`). I found no direct behavioral test importing `@/app/actions/sharing`.
- **Failure scenario:** A change stops rolling back DB share rate-limit counters after duplicate-key exhaustion, stops revalidating `/s/{key}` or `/g/{key}`, accepts unprocessed images into groups, or revokes a concurrently recreated key. Existing public shared-route E2E can still pass because it navigates seeded data instead of creating/revoking links through the actions.
- **Suggested fix:** Add mocked Vitest coverage for all four sharing actions: unauthorized/origin/maintenance branches, invalid IDs, existing-key fast path, unprocessed/missing images, success with audit + `revalidateLocalizedPaths`, duplicate-key retry exhaustion, FK violation rollback, and concurrent revoke/delete race branches.

### TE-03 — Topic cover image processing has no real image/filesystem regression tests

- **Severity:** High
- **Confidence:** High
- **Evidence:** `processTopicImage` performs extension checks, temp-file streaming, Sharp decode/resize, output cleanup, and pixel limiting (`apps/web/src/lib/process-topic-image.ts:42-80`); `deleteTopicImage` and orphan temp cleanup are also file-system effects (`apps/web/src/lib/process-topic-image.ts:83-105`). Topic action tests mock this module entirely (`apps/web/src/__tests__/topics-actions.test.ts:111-114`), so action coverage does not prove the real processor.
- **Failure scenario:** A future change accepts a spoofed extension with corrupt bytes, fails to delete `tmp-*` files after Sharp throws, writes an output before throwing and leaves it behind, or breaks `public/resources` path resolution. The topic action tests still pass because `processTopicImage` is mocked.
- **Suggested fix:** Add a focused `process-topic-image.test.ts` using a temporary cwd/resources directory and real `File` objects: valid JPEG/PNG/WebP output to `.webp`, empty file, disallowed extension, corrupt bytes cleanup, huge-pixel/limit behavior, safe delete of invalid filenames, and `cleanOrphanedTopicTempFiles` cleanup.

### TE-04 — `nav-visual-check` captures screenshots but does not assert visual diffs

- **Severity:** Medium
- **Confidence:** High
- **Evidence:** The visual spec writes screenshots at `apps/web/e2e/nav-visual-check.spec.ts:14`, `apps/web/e2e/nav-visual-check.spec.ts:27`, and `apps/web/e2e/nav-visual-check.spec.ts:39`, but never calls `toHaveScreenshot` or compares against baselines.
- **Failure scenario:** Mobile nav overlaps the first photo, spacing regresses, dark/light colors become unreadable, or controls are clipped. The tests still pass as long as a few elements remain visible/hidden, and the artifact is overwritten for manual review.
- **Suggested fix:** Convert these to Playwright visual assertions with baselines/masks or replace them with explicit layout assertions (viewport containment, no overlap, bounding boxes, contrast). If they are manual artifacts only, move them out of the blocking E2E suite or rename them accordingly.

### TE-05 — E2E bootstrap is brittle around transient DB startup/migration failures

- **Severity:** Medium to High
- **Confidence:** High
- **Evidence:** Playwright starts the local app via `scripts/run-e2e-server.mjs` (`apps/web/playwright.config.ts:64-70`). That script runs `npm run init`, `npm run e2e:seed`, and `npm run build` exactly once before launching the server (`apps/web/scripts/run-e2e-server.mjs:75-84`). The prior gate log shows a concrete transient DB/protocol failure during init: `Got timeout reading communication packets` in `.context/gate-logs/e2e-init.log`.
- **Failure scenario:** MySQL is technically healthy per container healthcheck but still rejects/times out during migration; Playwright reports a web-server startup failure rather than a useful migration diagnostic, and a retry would likely have succeeded.
- **Suggested fix:** Add bounded retry/backoff around init/seed with clear DB env diagnostics, or wait for an app-level DB readiness probe before migration. Keep retries narrow enough to avoid hiding deterministic migration failures.

### TE-06 — E2E fixture cleanup leaks DB/session state on failures

- **Severity:** Medium
- **Confidence:** High
- **Evidence:** Authenticated API E2E helper inserts a session row and returns only a cookie header (`apps/web/e2e/helpers.ts:137-144`) with no paired cleanup. Admin upload E2E creates a timestamped image (`apps/web/e2e/admin.spec.ts:72-85`) and deletes it only after processing succeeds (`apps/web/e2e/admin.spec.ts:86-88`). The seeder cleans the fixed `e2e-smoke` seed images on startup (`apps/web/scripts/seed-e2e.ts:182-203`), not arbitrary failed uploads or inserted sessions.
- **Failure scenario:** If `waitForImageProcessed` times out, the uploaded row/file remains. If origin-guard authenticated tests run repeatedly, session rows accumulate. Later E2E runs can slow down, collide with cleanup assumptions, or produce false positives/negatives against polluted state.
- **Suggested fix:** Add `test.afterEach`/helper cleanup for `playwright-upload-%` images and generated files, and delete sessions created by `createAdminSessionCookie` (return token/session id or register cleanup). Consider using per-run UUID prefixes and a final cleanup fixture.

### TE-07 — High-value regression tests still inspect source text instead of behavior

- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `data-view-count-flush.test.ts` explicitly documents that it avoids behavioral testing and reads source text (`apps/web/src/__tests__/data-view-count-flush.test.ts:13-19`, `apps/web/src/__tests__/data-view-count-flush.test.ts:31-123`) for runtime logic in `data.ts` (`apps/web/src/lib/data.ts:37-121`). Similar source-contract style appears in share-key length (`apps/web/src/__tests__/share-key-length.test.ts:6-13`) and several ordering/lock tests.
- **Failure scenario:** `flushGroupViewCounts` keeps the strings `viewCountBuffer = new Map()` and `db.update(sharedGroups)`, satisfying regexes, but a refactor drops increments in the retry map or rearms timers incorrectly. Static source tests pass while production loses view counts.
- **Suggested fix:** Keep source-contract tests only as secondary guardrails. Add behavior-first tests with fake timers and mocked DB for partial flush failure, retry cap, capacity guard, maintenance skip, timer rearm, and successful flush reset. For server-action ordering, prefer mocked action execution that asserts return values and rollback calls.

### TE-08 — Middleware/metadata/OG route behavior has thin route-level coverage

- **Severity:** Medium
- **Confidence:** High
- **Evidence:** Middleware handles admin redirects and production CSP nonce propagation (`apps/web/src/proxy.ts:73-107`). Metadata routes have sitemap budget/fallback/locale logic (`apps/web/src/app/sitemap.ts:24-77`), robots admin disallows (`apps/web/src/app/robots.ts:10-18`), and dynamic manifest SEO values (`apps/web/src/app/manifest.ts:6-30`). Existing CSP tests cover the policy builder only (`apps/web/src/__tests__/content-security-policy.test.ts:5-56`), and OG tests focus on rate-limit helper behavior rather than full route responses.
- **Failure scenario:** A matcher change stops protecting `/en/admin/dashboard`; sitemap emits more than 50,000 localized URLs; `robots.txt` misses locale admin paths; manifest ignores DB SEO values; `/api/og` cache/ETag/404/429 behavior regresses. Helper tests can still pass.
- **Suggested fix:** Add route-level tests with mocked `next-intl/middleware`, data getters, and `next/og`: proxy redirect/no-redirect/CSP propagation; sitemap fallback/budget/locales; robots disallow list; manifest SEO values; OG invalid/missing/not-found/rate-limited/ETag/cache success paths.

### TE-09 — Permission-dependent backup-download test can be flaky across runners

- **Severity:** Low to Medium
- **Confidence:** Medium
- **Evidence:** `backup-download-route.test.ts` simulates an unexpected filesystem failure by `chmod`ing the backups directory to `0o000` (`apps/web/src/__tests__/backup-download-route.test.ts:140-158`). The route itself uses `lstat`, `realpath`, and `createReadStream` (`apps/web/src/app/api/admin/db/download/route.ts:53-95`).
- **Failure scenario:** On runners with elevated filesystem privileges or different permission semantics, `chmod 000` may not cause the expected operation to fail, so the test can return 200/404 instead of the asserted 500. Conversely, cleanup can fail if permissions are not restored after an early error.
- **Suggested fix:** Mock `fs/promises`/`fs` for this specific unexpected-failure branch, or construct a deterministic ENOTDIR/EISDIR scenario. Keep separate real-filesystem tests for happy path, symlink rejection, missing file, and invalid filename.

### TE-10 — No coverage thresholds or coverage artifact gate exist

- **Severity:** Low to Medium
- **Confidence:** High
- **Evidence:** App test script is plain `vitest run` (`apps/web/package.json:13`), and `vitest.config.ts` has only alias + include configuration (`apps/web/vitest.config.ts:1-10`), with no coverage provider, thresholds, or report output.
- **Failure scenario:** New route/action/lib code can land with no tests and no visible coverage regression, especially for TSX components and route handlers not currently imported by unit tests.
- **Suggested fix:** Add a non-blocking coverage report first, then ratchet thresholds for high-risk folders (`src/app/actions`, `src/lib`, `src/app/api`) once baseline is stable. Avoid global thresholds that punish generated/Next route glue; use targeted include/exclude patterns.

## TDD opportunities / recommended order

1. Add sharing-action tests before touching share/revoke/group behavior.
2. Add `process-topic-image` tests before changing topic cover uploads or resource paths.
3. Add a DOM component-test lane before refactoring `Search`, `LoadMore`, `PhotoViewer`, `ImageManager`, or admin managers.
4. Replace the highest-risk source-text tests with behavior tests around view-count flushing and action rollback semantics.
5. Make E2E bootstrap/cleanup deterministic before expanding browser coverage.
6. Convert manual screenshot captures into real visual or layout assertions.

## Final sweep

- Inspected all test/config/source areas relevant to test coverage, flaky tests, regression gaps, E2E reliability, fixtures, and TDD opportunities.
- Confirmed broad existing coverage for validation/sanitization, rate-limit primitives, upload action paths, restore/download guards, custom lint scanners, and selected public/admin E2E smoke flows.
- Main residual risks are behavioral gaps around sharing actions, topic image processing, TSX components, route-level middleware/metadata/OG behavior, source-text tests standing in for runtime behavior, and E2E bootstrap/cleanup reliability.
- Wrote only `.context/reviews/test-engineer.md`; no source files changed.
