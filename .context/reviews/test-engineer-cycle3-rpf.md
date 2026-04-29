# Test Engineer Review — Cycle 3 RPF (Prompt 1)

**Date:** 2026-04-29
**Role:** test-engineer
**Scope:** Entire `/Users/hletrd/flash-shared/gallery` repo test surface: unit/e2e/config/source files relevant to test adequacy, coverage gaps, flaky/brittle tests, missing regressions, TDD opportunities, and CI gates.
**Edit policy followed:** Report-only change. No implementation files edited.

## Method / coverage of this review

- Enumerated tracked repo files with `git ls-files`, then expanded the test-relevant inventory to source, tests, scripts, DB migrations, app/root config, and CI files.
- Examined **282 unique relevant files** (counts below), including every `apps/web/src/**/*` source/config file, every `apps/web/src/__tests__/*.test.ts`, every `apps/web/e2e/*` file/fixture, every `apps/web/scripts/*` file, app/root package/config files, GitHub quality workflow, and Drizzle migrations/snapshots.
- Used line-numbered reads (`nl -ba`) for every cited region and repo-wide sweeps for skipped tests, source-text assertions, screenshots, direct imports, and uncovered high-risk modules.
- Did a final missed-issues sweep after drafting findings (see bottom of report).

## Test surface snapshot

- **Vitest unit files:** 72 (`apps/web/src/__tests__/*.test.ts`), rough static count 479 `it(`/`test(` declarations.
- **Playwright specs/fixtures:** 5 specs plus `helpers.ts` and 2 image fixtures, rough static count 22 `test(` declarations.
- **CI gates present:** lint, typecheck, custom API/action-origin lints, Vitest, DB init, Playwright, build (`.github/workflows/quality.yml:54-79`).
- **Notable gate gaps:** no coverage threshold/coverage report, no DB schema/migration drift gate, no visual baseline diff despite screenshot-named e2e suite.

## Findings

### TE-C3RPF-01 — Share-link server actions have no direct behavioral regression coverage

- **Severity:** High
- **Confidence:** High
- **Cited regions:**
  - Photo share create/retry/rollback path: `apps/web/src/app/actions/sharing.ts:92-188`
  - Group share transaction/retry/FK rollback path: `apps/web/src/app/actions/sharing.ts:190-308`
  - Photo/group share revocation/deletion path: `apps/web/src/app/actions/sharing.ts:310-390`
  - Existing share-related test is only a static public lookup length contract: `apps/web/src/__tests__/share-key-length.test.ts:6-13`
  - E2E only navigates a seeded shared group, not creation/revocation: `apps/web/e2e/public.spec.ts:101-119`
- **Gap:** No unit test imports `@/app/actions/sharing`, so the action's rate-limit pre-increment, DB-backed limit check, rollback, duplicate-key retry, FK recovery, conditional revocation, and audit/revalidation behavior are unverified.
- **Failure scenario:** A refactor removes `rollbackShareRateLimitFull()` on `ER_NO_REFERENCED_ROW_2`, charges admins for failed group creation, or changes the conditional revoke `WHERE share_key = oldShareKey` so a concurrent new key is revoked. Current tests would still pass because seeded share-page navigation does not execute these branches.
- **Fix / TDD opportunity:** Add `sharing-actions.test.ts` with mocked `db`, `headers`, `rate-limit`, `base56`, `audit`, and `revalidation`. Start red tests for (1) FK violation rolls back both counters, (2) duplicate key retries up to success/failure, (3) stale photo missing after conditional update rolls back, (4) revoke with `affectedRows === 0` returns `noActiveShareLink` and does not revalidate/audit.

### TE-C3RPF-02 — Backup/restore action orchestration and stderr redaction are not behavior-tested

- **Severity:** High
- **Confidence:** High
- **Cited regions:**
  - Private stderr sanitizer: `apps/web/src/app/[locale]/admin/db-actions.ts:35-46`
  - `dumpDatabase()` process/file handling: `apps/web/src/app/[locale]/admin/db-actions.ts:128-265`
  - `restoreDatabase()` locks/maintenance handoff: `apps/web/src/app/[locale]/admin/db-actions.ts:275-367`
  - `runRestore()` temp-file scan/spawn/cleanup handling: `apps/web/src/app/[locale]/admin/db-actions.ts:369-521`
  - Current helper-only tests: `apps/web/src/__tests__/db-restore.test.ts:5-33`
  - Current source-text lock test: `apps/web/src/__tests__/restore-upload-lock.test.ts:7-17`
  - Download route tests do not cover dump/restore spawning: `apps/web/src/__tests__/backup-download-route.test.ts:48-160`
- **Gap:** The most failure-prone DB backup/restore paths are private inside a `'use server'` action file and are covered only indirectly by helper tests and source-text checks. There is no behavioral test for child process exit/error events, write-stream flush failures, empty dump files, stderr redaction, temp-file cleanup, lock release, queue resume, or audit/revalidation success paths.
- **Failure scenario:** `mysqldump` exits 0 with an empty/truncated file and the action still resolves success, or `mysql` stderr includes the real `MYSQL_PWD` and logs it. Current tests would not execute either action path.
- **Fix / TDD opportunity:** Extract `sanitizeStderr` and child-process orchestration seams into testable helpers, then write Vitest tests with mocked `child_process.spawn`, `fs` streams, and temp files. First red tests: password redaction for literal and `password=` patterns, write-stream error returns `failedToWriteBackup`, empty output returns failure, restore stdin `EPIPE` is ignored, non-ignorable stdin error cleans up temp file and fails.

### TE-C3RPF-03 — Gallery settings update is protected mostly by source-text and one non-persistent UI smoke

- **Severity:** High
- **Confidence:** High
- **Cited regions:**
  - Settings action validation/locks/transaction: `apps/web/src/app/actions/settings.ts:40-173`
  - Existing image-size lock test reads source text only: `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22`
  - E2E settings coverage flips a client switch but does not save or assert persistence/server behavior: `apps/web/e2e/admin.spec.ts:45-64`
- **Gap:** `updateGallerySettings()` has auth/origin checks, control-character sanitization, allowed-key validation, upload-claim/contract locking, existing-image locks for `image_sizes` and `strip_gps_on_upload`, transaction upsert/delete behavior, audit logging, and full-app revalidation. None of those branches are behavior-tested.
- **Failure scenario:** A future change moves the existing-image lock after the transaction, changes `strip_gps_on_upload` while images exist, or returns success without releasing the upload contract lock. The source-text test could still match `from(images).limit(1)`, and the E2E toggle would still pass because it never clicks Save.
- **Fix / TDD opportunity:** Add `settings-actions.test.ts` with mocked DB/action guards and lock helpers. Start with red tests for invalid keys, sanitized invalid values, `image_sizes` normalization returned to the client, existing-image lock for both upload-contract settings, empty values deleting rows, transaction failure releasing locks, and no audit/revalidation on validation failure.

### TE-C3RPF-04 — Cursor pagination validation/order logic is not directly tested; public-action tests mock the normalizer

- **Severity:** Medium-High
- **Confidence:** High
- **Cited regions:**
  - Cursor input regex/normalization: `apps/web/src/lib/data.ts:381-445`
  - Cursor condition / query shape: `apps/web/src/lib/data.ts:447-509`
  - `public-actions.test.ts` replaces `normalizeImageListCursor` with a test-local implementation: `apps/web/src/__tests__/public-actions.test.ts:33-48`
  - Existing data pagination test only covers `normalizePaginatedRows`: `apps/web/src/__tests__/data-pagination.test.ts:5-30`
- **Gap:** Tests exercise `loadMoreImages()` with a mocked cursor normalizer, so regressions in the real `normalizeImageListCursor()` accepted formats, length caps, invalid `Date` rejection, null `capture_date` handling, and cursor SQL ordering are not caught.
- **Failure scenario:** `normalizeCreatedAt()` starts accepting arbitrary long strings or `buildCursorCondition()` drops the `isNull(images.capture_date)` branch, causing infinite scroll to skip/duplicate photos only when users paginate through mixed captured/uncaptured images.
- **Fix / TDD opportunity:** Add direct tests in `data-pagination.test.ts` for valid MySQL/ISO dates, invalid/oversized dates, invalid IDs, null capture dates, and generated Drizzle SQL ordering for both `capture_date === null` and non-null cursors. Prefer testing the exported normalizer directly and, if SQL condition remains private, asserting `getImagesLite()` passes the expected Drizzle condition through a proxy DB.

### TE-C3RPF-05 — Topic image processing and orphan cleanup are fully mocked at action/queue level

- **Severity:** Medium-High
- **Confidence:** High
- **Cited regions:**
  - Topic image validation/process/temp cleanup: `apps/web/src/lib/process-topic-image.ts:42-80`
  - Topic image deletion and orphan `tmp-*` cleanup: `apps/web/src/lib/process-topic-image.ts:83-106`
  - Topic action tests mock the module instead of exercising it: `apps/web/src/__tests__/topics-actions.test.ts:111-114`
- **Gap:** `processTopicImage()`, `deleteTopicImage()`, and `cleanOrphanedTopicTempFiles()` have no direct tests. Existing topic action tests verify callers' behavior while replacing this module, so extension allowlisting, size/empty validation, Sharp resize options, temp-file unlink-on-failure, output cleanup, invalid filename deletion guard, and orphan cleanup can regress unnoticed.
- **Failure scenario:** A failed Sharp conversion leaves `tmp-*` files in `public/resources`, or `deleteTopicImage()` stops rejecting invalid filenames and can unlink outside resources. Current tests would still pass because they only assert `processTopicImageMock`/`deleteTopicImageMock` calls.
- **Fix / TDD opportunity:** Add `process-topic-image.test.ts`. Use a temp cwd/import isolation or mocks for `fs`, `fs/promises`, `sharp`, `randomUUID`, and streams. First red tests: oversized/empty/disallowed file rejects before writing, valid file writes 512x512 WebP and deletes temp, Sharp failure deletes temp/output, invalid delete filename is no-op, `cleanOrphanedTopicTempFiles()` removes only `tmp-*` files.

### TE-C3RPF-06 — Proxy middleware locale/admin/CSP behavior has only narrow E2E smoke coverage

- **Severity:** Medium
- **Confidence:** High
- **Cited regions:**
  - Production CSP request/response nonce propagation: `apps/web/src/proxy.ts:21-50`
  - Protected admin-route detection and malformed-cookie redirect: `apps/web/src/proxy.ts:53-98`
  - Matcher excludes API/static paths: `apps/web/src/proxy.ts:101-107`
  - E2E covers only unprefixed `/admin/dashboard` unauthenticated redirect: `apps/web/e2e/admin.spec.ts:14-18`
- **Gap:** There is no unit test for the middleware/proxy itself and no E2E assertion for locale-prefixed admin paths (`/en/admin/...`, `/ko/admin/...`), malformed `admin_session` cookie format, production CSP nonce/header propagation, or matcher intent.
- **Failure scenario:** `/ko/admin/settings` stops redirecting unauthenticated users to `/ko/admin`, or production responses lose the CSP nonce header while development and admin smoke tests still pass.
- **Fix / TDD opportunity:** Add `proxy.test.ts` using `NextRequest` and import-isolated `NODE_ENV` values. Red tests: unprefixed and locale-prefixed admin subroutes redirect without a three-part cookie, login pages are not protected, valid-format cookie delegates to intl middleware, production adds matching `x-nonce` and CSP, development skips production CSP.

### TE-C3RPF-07 — “Visual” Playwright checks write screenshots but perform no visual regression assertion

- **Severity:** Medium
- **Confidence:** High
- **Cited regions:**
  - Screenshot-only checks: `apps/web/e2e/nav-visual-check.spec.ts:4-40`
  - Playwright config captures screenshots only on failure, not as baselines: `apps/web/playwright.config.ts:57-60`
- **Gap:** `nav-visual-check.spec.ts` is named and structured as visual QA, but each test only calls `page.screenshot({ path: ... })`; it never compares against a committed baseline (`toHaveScreenshot`) or asserts layout dimensions/positions beyond a few visibility checks.
- **Failure scenario:** The mobile menu renders offscreen, loses spacing, or changes colors/stacking. CI still passes because writing `test-results/nav-*.png` is treated as success.
- **Fix / TDD opportunity:** Convert to element-level `await expect(nav).toHaveScreenshot(...)` with stable baselines, or rename the suite to smoke and add explicit layout assertions (bounding boxes, overflow, menu item count). Start red by intentionally perturbing nav spacing and proving the assertion fails.

### TE-C3RPF-08 — Client-side admin form flows lack interaction tests for changed-field submission and error handling

- **Severity:** Medium
- **Confidence:** High
- **Cited regions:**
  - Settings client changed-field/save/rehydration logic: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:34-68`
  - SEO client changed-field/save/rehydration logic: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-69`
  - Password form client-side confirmation gate: `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:29-38`
  - E2E admin navigation only confirms pages/controls are visible: `apps/web/e2e/admin.spec.ts:20-43`
- **Gap:** The suite verifies action modules and page visibility, but not browser/client behavior for changed-only payloads, no-change toasts, server-normalized value rehydration, error toasts, or password confirmation blocking `formAction()`.
- **Failure scenario:** Settings/SEO pages submit stale full forms or fail to update `initialRef` after server normalization, causing repeated saves or misleading “No changes” states. Password mismatch could still call the action if the form handler changes. Existing E2E navigation would not catch this.
- **Fix / TDD opportunity:** Add Playwright admin tests for save flows that mutate one harmless field and assert persistence/normalization after reload, plus a password mismatch test that asserts no server action side effect. If component testing is added later, isolate the clients with mocked actions/toasts.

### TE-C3RPF-09 — Many high-value “regression” tests assert source text rather than behavior

- **Severity:** Medium
- **Confidence:** High
- **Cited regions:**
  - View-count flush invariants via `readFileSync`/regex: `apps/web/src/__tests__/data-view-count-flush.test.ts:31-124`
  - Restore/upload coordination via source text: `apps/web/src/__tests__/restore-upload-lock.test.ts:5-17`
  - Delete revalidation via source text: `apps/web/src/__tests__/images-delete-revalidation.test.ts:5-24`
  - Settings lock via source text: `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22`
- **Gap:** Source-text tests are useful as cheap structural sentinels, but several load-bearing behaviors rely on them as the only regression coverage. They can pass when behavior is broken but strings remain, and they can fail on safe refactors that preserve behavior but alter formatting or helper boundaries.
- **Failure scenario:** `flushGroupViewCounts()` preserves the text `viewCountBuffer = new Map()` but moves error handling so failed writes are not re-buffered; the regex suite can still pass. Conversely, extracting the same behavior to a helper could fail tests despite no runtime regression.
- **Fix / TDD opportunity:** Keep a small number of source guards for architectural lints, but add behavioral seams/tests for the underlying state machines: export/test a buffer instance, inject DB clients, or isolate file-processing/revalidation helpers. Convert each source-only regression into at least one failing behavioral test before refactor.

### TE-C3RPF-10 — Quality gates do not enforce coverage thresholds or DB schema/migration drift

- **Severity:** Medium
- **Confidence:** High
- **Cited regions:**
  - Vitest includes tests but no coverage config/threshold: `apps/web/vitest.config.ts:10-12`
  - `npm test` only runs `vitest run`: `apps/web/package.json:13`
  - CI runs unit/e2e/build but no coverage or migration drift step: `.github/workflows/quality.yml:65-79`
  - Drizzle schema/out config exists: `apps/web/drizzle.config.ts:6-12`
  - DB scripts expose `db:push`/`init` but no drift-check script: `apps/web/package.json:17-19`
- **Gap:** The project can gain large untested areas (as above) without any failing threshold, and schema changes can drift from generated migrations/snapshots without a CI check that proves a fresh DB and the TypeScript schema stay aligned beyond the current init/e2e happy path.
- **Failure scenario:** A new server action lands with zero tests and coverage still passes; or `src/db/schema.ts` changes a column/index but `apps/web/drizzle/*.sql` is not updated, so a fresh deployment created from migrations differs from what application code expects.
- **Fix / TDD opportunity:** Add a coverage gate focused first on critical modules/actions rather than an all-repo percentage shock. Add a migration/schema drift script that runs in CI (for example, generate/check into a temp directory and fail on diff, or apply migrations then assert schema-introspection expectations for key tables/indexes).

## Positive coverage observations

- CI now has a real quality workflow with lint, typecheck, custom security lint gates, unit tests, DB init, E2E, and build (`.github/workflows/quality.yml:54-79`).
- Public action rate-limit behavior is well covered, including rollback and DB fallback (`apps/web/src/__tests__/public-actions.test.ts:161-247`, `apps/web/src/__tests__/load-more-rate-limit.test.ts:89-182`).
- API backup download route has good auth/origin/error coverage (`apps/web/src/__tests__/backup-download-route.test.ts:72-160`).
- Restore SQL scanner and helper tests cover destructive SQL and stdin error classification (`apps/web/src/__tests__/sql-restore-scan.test.ts`, `apps/web/src/__tests__/db-restore.test.ts:5-33`).
- Image upload action, admin users, tags, topics, SEO, validation, rate-limit, and CSP helpers have meaningful unit coverage, though some still mix behavior and source-text sentinels.

## Final missed-issues sweep

- `rg "test.skip|it.skip|describe.skip|test.only|it.only|describe.only|fixme|TODO|todo" apps/web/src/__tests__ apps/web/e2e ...` found no `.only`; conditional skips are limited to admin/origin E2E environment guards (`apps/web/e2e/admin.spec.ts:7,12`, `apps/web/e2e/origin-guard.spec.ts:29,35,56,58,77`).
- `rg "page.screenshot" apps/web/e2e` confirmed screenshot-only visual checks are confined to `nav-visual-check.spec.ts` and are captured in TE-C3RPF-07.
- `rg "@/app/actions/sharing|db-actions|process-topic-image|@/proxy|src/proxy" apps/web/src/__tests__ apps/web/e2e` confirmed direct behavioral coverage gaps for sharing, db actions, topic image processing, and proxy; existing hits are source-text or mocks.
- `rg "readFileSync|source\.|indexOf\(|toMatch\(" apps/web/src/__tests__` confirmed broad source-text regression style; highest-impact examples are captured in TE-C3RPF-09.
- Rechecked prior cycle fixes implicitly visible in current tests: prior tautological heading and origin-route-404 issues appear fixed (`public.spec.ts:97-98` now asserts `> 0`; `origin-guard.spec.ts:49-52` no longer accepts 404).

## Inventory of examined files

**Counts:** config/root/app config 21, scripts 17, drizzle migrations/snapshots 7, non-test app source/config under `src` 159, unit tests 72, e2e files/fixtures 8; **282 unique files total**.

### Config / root / CI / app config
- `.github/dependabot.yml` (19 lines)
- `.github/workflows/quality.yml` (79 lines)
- `.nvmrc` (1 lines)
- `apps/web/.env.local.example` (63 lines)
- `apps/web/Dockerfile` (90 lines)
- `apps/web/README.md` (46 lines)
- `apps/web/components.json` (22 lines)
- `apps/web/docker-compose.yml` (25 lines)
- `apps/web/drizzle.config.ts` (13 lines)
- `apps/web/eslint.config.mjs` (21 lines)
- `apps/web/next.config.ts` (86 lines)
- `apps/web/package.json` (75 lines)
- `apps/web/playwright.config.ts` (80 lines)
- `apps/web/postcss.config.mjs` (8 lines)
- `apps/web/tailwind.config.ts` (64 lines)
- `apps/web/tsconfig.json` (43 lines)
- `apps/web/tsconfig.scripts.json` (16 lines)
- `apps/web/tsconfig.typecheck.json` (18 lines)
- `apps/web/vitest.config.ts` (13 lines)
- `package-lock.json` (7529 lines)
- `package.json` (23 lines)

### Scripts
- `apps/web/scripts/check-action-origin.ts` (345 lines)
- `apps/web/scripts/check-api-auth.ts` (178 lines)
- `apps/web/scripts/check-js-scripts.mjs` (42 lines)
- `apps/web/scripts/ensure-site-config.mjs` (43 lines)
- `apps/web/scripts/entrypoint.sh` (39 lines)
- `apps/web/scripts/init-db.ts` (35 lines)
- `apps/web/scripts/migrate-admin-auth.ts` (77 lines)
- `apps/web/scripts/migrate-aliases.ts` (31 lines)
- `apps/web/scripts/migrate-capture-date.js` (82 lines)
- `apps/web/scripts/migrate-titles.ts` (34 lines)
- `apps/web/scripts/migrate.js` (556 lines)
- `apps/web/scripts/migration-add-column.ts` (21 lines)
- `apps/web/scripts/mysql-connection-options.js` (28 lines)
- `apps/web/scripts/prepare-next-typegen.mjs` (32 lines)
- `apps/web/scripts/run-e2e-server.mjs` (117 lines)
- `apps/web/scripts/seed-admin.ts` (76 lines)
- `apps/web/scripts/seed-e2e.ts` (268 lines)

### Drizzle migrations and snapshots
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql` (79 lines)
- `apps/web/drizzle/0001_sync_current_schema.sql` (81 lines)
- `apps/web/drizzle/0002_fix_processed_default.sql` (1 lines)
- `apps/web/drizzle/0003_audit_created_at_index.sql` (1 lines)
- `apps/web/drizzle/meta/0000_snapshot.json` (536 lines)
- `apps/web/drizzle/meta/0001_snapshot.json` (990 lines)
- `apps/web/drizzle/meta/_journal.json` (34 lines)

### App source files (excluding unit tests)
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` (204 lines)
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` (202 lines)
- `apps/web/src/app/[locale]/(public)/layout.tsx` (24 lines)
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` (263 lines)
- `apps/web/src/app/[locale]/(public)/page.tsx` (193 lines)
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` (132 lines)
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts` (10 lines)
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx` (15 lines)
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` (343 lines)
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx` (77 lines)
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx` (38 lines)
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx` (246 lines)
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx` (39 lines)
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx` (18 lines)
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx` (14 lines)
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx` (13 lines)
- `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx` (23 lines)
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` (114 lines)
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx` (22 lines)
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` (180 lines)
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx` (24 lines)
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (191 lines)
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx` (14 lines)
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` (165 lines)
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx` (25 lines)
- `apps/web/src/app/[locale]/admin/db-actions.ts` (522 lines)
- `apps/web/src/app/[locale]/admin/layout.tsx` (29 lines)
- `apps/web/src/app/[locale]/admin/login-form.tsx` (110 lines)
- `apps/web/src/app/[locale]/admin/page.tsx` (16 lines)
- `apps/web/src/app/[locale]/error.tsx` (39 lines)
- `apps/web/src/app/[locale]/globals.css` (169 lines)
- `apps/web/src/app/[locale]/layout.tsx` (134 lines)
- `apps/web/src/app/[locale]/loading.tsx` (14 lines)
- `apps/web/src/app/[locale]/not-found.tsx` (54 lines)
- `apps/web/src/app/actions.ts` (30 lines)
- `apps/web/src/app/actions/admin-users.ts` (264 lines)
- `apps/web/src/app/actions/auth.ts` (431 lines)
- `apps/web/src/app/actions/images.ts` (743 lines)
- `apps/web/src/app/actions/public.ts` (168 lines)
- `apps/web/src/app/actions/seo.ts` (177 lines)
- `apps/web/src/app/actions/settings.ts` (174 lines)
- `apps/web/src/app/actions/sharing.ts` (391 lines)
- `apps/web/src/app/actions/tags.ts` (432 lines)
- `apps/web/src/app/actions/topics.ts` (496 lines)
- `apps/web/src/app/api/admin/db/download/route.ts` (108 lines)
- `apps/web/src/app/api/health/route.ts` (43 lines)
- `apps/web/src/app/api/live/route.ts` (10 lines)
- `apps/web/src/app/api/og/route.tsx` (206 lines)
- `apps/web/src/app/apple-icon.tsx` (40 lines)
- `apps/web/src/app/global-error.tsx` (83 lines)
- `apps/web/src/app/icon.tsx` (45 lines)
- `apps/web/src/app/manifest.ts` (30 lines)
- `apps/web/src/app/robots.ts` (19 lines)
- `apps/web/src/app/sitemap.ts` (77 lines)
- `apps/web/src/app/uploads/[...path]/route.ts` (10 lines)
- `apps/web/src/components/admin-header.tsx` (30 lines)
- `apps/web/src/components/admin-nav.tsx` (46 lines)
- `apps/web/src/components/admin-user-manager.tsx` (192 lines)
- `apps/web/src/components/footer.tsx` (56 lines)
- `apps/web/src/components/histogram.tsx` (332 lines)
- `apps/web/src/components/home-client.tsx` (320 lines)
- `apps/web/src/components/i18n-provider.tsx` (19 lines)
- `apps/web/src/components/image-manager.tsx` (505 lines)
- `apps/web/src/components/image-zoom.tsx` (151 lines)
- `apps/web/src/components/info-bottom-sheet.tsx` (411 lines)
- `apps/web/src/components/lazy-focus-trap.tsx` (10 lines)
- `apps/web/src/components/lightbox.tsx` (392 lines)
- `apps/web/src/components/load-more.tsx` (125 lines)
- `apps/web/src/components/nav-client.tsx` (166 lines)
- `apps/web/src/components/nav.tsx` (14 lines)
- `apps/web/src/components/optimistic-image.tsx` (82 lines)
- `apps/web/src/components/photo-navigation.tsx` (241 lines)
- `apps/web/src/components/photo-viewer-loading.tsx` (24 lines)
- `apps/web/src/components/photo-viewer.tsx` (654 lines)
- `apps/web/src/components/search.tsx` (300 lines)
- `apps/web/src/components/tag-filter.tsx` (105 lines)
- `apps/web/src/components/tag-input.tsx` (252 lines)
- `apps/web/src/components/theme-provider.tsx` (11 lines)
- `apps/web/src/components/topic-empty-state.tsx` (24 lines)
- `apps/web/src/components/ui/alert-dialog.tsx` (157 lines)
- `apps/web/src/components/ui/alert.tsx` (66 lines)
- `apps/web/src/components/ui/aspect-ratio.tsx` (11 lines)
- `apps/web/src/components/ui/badge.tsx` (46 lines)
- `apps/web/src/components/ui/button.tsx` (62 lines)
- `apps/web/src/components/ui/card.tsx` (92 lines)
- `apps/web/src/components/ui/dialog.tsx` (145 lines)
- `apps/web/src/components/ui/dropdown-menu.tsx` (257 lines)
- `apps/web/src/components/ui/input.tsx` (21 lines)
- `apps/web/src/components/ui/label.tsx` (24 lines)
- `apps/web/src/components/ui/progress.tsx` (26 lines)
- `apps/web/src/components/ui/scroll-area.tsx` (58 lines)
- `apps/web/src/components/ui/select.tsx` (190 lines)
- `apps/web/src/components/ui/separator.tsx` (32 lines)
- `apps/web/src/components/ui/sheet.tsx` (141 lines)
- `apps/web/src/components/ui/skeleton.tsx` (13 lines)
- `apps/web/src/components/ui/sonner.tsx` (40 lines)
- `apps/web/src/components/ui/switch.tsx` (31 lines)
- `apps/web/src/components/ui/table.tsx` (116 lines)
- `apps/web/src/components/ui/textarea.tsx` (18 lines)
- `apps/web/src/components/upload-dropzone.tsx` (492 lines)
- `apps/web/src/db/index.ts` (90 lines)
- `apps/web/src/db/schema.ts` (143 lines)
- `apps/web/src/db/seed.ts` (13 lines)
- `apps/web/src/i18n/request.ts` (15 lines)
- `apps/web/src/instrumentation.ts` (36 lines)
- `apps/web/src/lib/action-guards.ts` (44 lines)
- `apps/web/src/lib/action-result.ts` (4 lines)
- `apps/web/src/lib/api-auth.ts` (27 lines)
- `apps/web/src/lib/audit.ts` (62 lines)
- `apps/web/src/lib/auth-rate-limit.ts` (93 lines)
- `apps/web/src/lib/backup-filename.ts` (12 lines)
- `apps/web/src/lib/base56.ts` (41 lines)
- `apps/web/src/lib/blur-data-url.ts` (120 lines)
- `apps/web/src/lib/bounded-map.ts` (132 lines)
- `apps/web/src/lib/clipboard.ts` (43 lines)
- `apps/web/src/lib/constants.ts` (14 lines)
- `apps/web/src/lib/content-security-policy.ts` (91 lines)
- `apps/web/src/lib/csp-nonce.ts` (9 lines)
- `apps/web/src/lib/csv-escape.ts` (64 lines)
- `apps/web/src/lib/data.ts` (1078 lines)
- `apps/web/src/lib/db-restore.ts` (34 lines)
- `apps/web/src/lib/error-shell.ts` (49 lines)
- `apps/web/src/lib/exif-datetime.ts` (78 lines)
- `apps/web/src/lib/gallery-config-shared.ts` (154 lines)
- `apps/web/src/lib/gallery-config.ts` (101 lines)
- `apps/web/src/lib/image-queue.ts` (503 lines)
- `apps/web/src/lib/image-types.ts` (78 lines)
- `apps/web/src/lib/image-url.ts` (48 lines)
- `apps/web/src/lib/locale-path.ts` (95 lines)
- `apps/web/src/lib/mysql-cli-ssl.ts` (16 lines)
- `apps/web/src/lib/photo-title.ts` (95 lines)
- `apps/web/src/lib/process-image.ts` (623 lines)
- `apps/web/src/lib/process-topic-image.ts` (106 lines)
- `apps/web/src/lib/queue-shutdown.ts` (37 lines)
- `apps/web/src/lib/rate-limit.ts` (296 lines)
- `apps/web/src/lib/request-origin.ts` (107 lines)
- `apps/web/src/lib/restore-maintenance.ts` (56 lines)
- `apps/web/src/lib/revalidation.ts` (57 lines)
- `apps/web/src/lib/safe-json-ld.ts` (19 lines)
- `apps/web/src/lib/sanitize.ts` (28 lines)
- `apps/web/src/lib/seo-og-url.ts` (30 lines)
- `apps/web/src/lib/serve-upload.ts` (115 lines)
- `apps/web/src/lib/session.ts` (145 lines)
- `apps/web/src/lib/sql-restore-scan.ts` (130 lines)
- `apps/web/src/lib/storage/index.ts` (146 lines)
- `apps/web/src/lib/storage/local.ts` (139 lines)
- `apps/web/src/lib/storage/types.ts` (105 lines)
- `apps/web/src/lib/tag-records.ts` (69 lines)
- `apps/web/src/lib/tag-slugs.ts` (49 lines)
- `apps/web/src/lib/upload-limits.ts` (31 lines)
- `apps/web/src/lib/upload-paths.ts` (103 lines)
- `apps/web/src/lib/upload-processing-contract-lock.ts` (75 lines)
- `apps/web/src/lib/upload-tracker-state.ts` (61 lines)
- `apps/web/src/lib/upload-tracker.ts` (33 lines)
- `apps/web/src/lib/utils.ts` (6 lines)
- `apps/web/src/lib/validation.ts` (117 lines)
- `apps/web/src/proxy.ts` (107 lines)
- `apps/web/src/site-config.example.json` (11 lines)
- `apps/web/src/site-config.json` (11 lines)

### Unit tests
- `apps/web/src/__tests__/action-guards.test.ts` (81 lines)
- `apps/web/src/__tests__/admin-user-create-ordering.test.ts` (145 lines)
- `apps/web/src/__tests__/admin-users.test.ts` (178 lines)
- `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts` (139 lines)
- `apps/web/src/__tests__/auth-rate-limit.test.ts` (103 lines)
- `apps/web/src/__tests__/auth-rethrow.test.ts` (53 lines)
- `apps/web/src/__tests__/backup-download-route.test.ts` (160 lines)
- `apps/web/src/__tests__/backup-filename.test.ts` (19 lines)
- `apps/web/src/__tests__/base56.test.ts` (56 lines)
- `apps/web/src/__tests__/blur-data-url.test.ts` (207 lines)
- `apps/web/src/__tests__/check-action-origin.test.ts` (315 lines)
- `apps/web/src/__tests__/check-api-auth.test.ts` (124 lines)
- `apps/web/src/__tests__/client-source-contracts.test.ts` (35 lines)
- `apps/web/src/__tests__/clipboard.test.ts` (122 lines)
- `apps/web/src/__tests__/content-security-policy.test.ts` (56 lines)
- `apps/web/src/__tests__/csv-escape.test.ts` (132 lines)
- `apps/web/src/__tests__/data-pagination.test.ts` (30 lines)
- `apps/web/src/__tests__/data-tag-names-sql.test.ts` (174 lines)
- `apps/web/src/__tests__/data-view-count-flush.test.ts` (179 lines)
- `apps/web/src/__tests__/db-pool-connection-handler.test.ts` (68 lines)
- `apps/web/src/__tests__/db-restore.test.ts` (33 lines)
- `apps/web/src/__tests__/error-shell.test.ts` (32 lines)
- `apps/web/src/__tests__/exif-datetime.test.ts` (45 lines)
- `apps/web/src/__tests__/gallery-config-shared.test.ts` (64 lines)
- `apps/web/src/__tests__/health-route.test.ts` (70 lines)
- `apps/web/src/__tests__/histogram.test.ts` (60 lines)
- `apps/web/src/__tests__/image-queue-bootstrap.test.ts` (194 lines)
- `apps/web/src/__tests__/image-queue.test.ts` (112 lines)
- `apps/web/src/__tests__/image-url.test.ts` (34 lines)
- `apps/web/src/__tests__/images-action-blur-wiring.test.ts` (49 lines)
- `apps/web/src/__tests__/images-actions.test.ts` (293 lines)
- `apps/web/src/__tests__/images-delete-revalidation.test.ts` (25 lines)
- `apps/web/src/__tests__/lightbox.test.ts` (12 lines)
- `apps/web/src/__tests__/live-route.test.ts` (12 lines)
- `apps/web/src/__tests__/load-more-rate-limit.test.ts` (183 lines)
- `apps/web/src/__tests__/locale-path.test.ts` (95 lines)
- `apps/web/src/__tests__/mysql-cli-ssl.test.ts` (21 lines)
- `apps/web/src/__tests__/next-config.test.ts` (27 lines)
- `apps/web/src/__tests__/og-rate-limit.test.ts` (60 lines)
- `apps/web/src/__tests__/photo-title.test.ts` (108 lines)
- `apps/web/src/__tests__/privacy-fields.test.ts` (62 lines)
- `apps/web/src/__tests__/process-image-blur-wiring.test.ts` (47 lines)
- `apps/web/src/__tests__/process-image-dimensions.test.ts` (137 lines)
- `apps/web/src/__tests__/process-image-variant-scan.test.ts` (85 lines)
- `apps/web/src/__tests__/public-actions.test.ts` (248 lines)
- `apps/web/src/__tests__/queue-shutdown.test.ts` (53 lines)
- `apps/web/src/__tests__/rate-limit.test.ts` (237 lines)
- `apps/web/src/__tests__/request-origin.test.ts` (144 lines)
- `apps/web/src/__tests__/restore-maintenance.test.ts` (53 lines)
- `apps/web/src/__tests__/restore-upload-lock.test.ts` (18 lines)
- `apps/web/src/__tests__/revalidation.test.ts` (78 lines)
- `apps/web/src/__tests__/safe-json-ld.test.ts` (57 lines)
- `apps/web/src/__tests__/sanitize.test.ts` (73 lines)
- `apps/web/src/__tests__/seo-actions.test.ts` (139 lines)
- `apps/web/src/__tests__/serve-upload.test.ts` (75 lines)
- `apps/web/src/__tests__/session.test.ts` (44 lines)
- `apps/web/src/__tests__/settings-image-sizes-lock.test.ts` (23 lines)
- `apps/web/src/__tests__/share-key-length.test.ts` (14 lines)
- `apps/web/src/__tests__/shared-page-title.test.ts` (137 lines)
- `apps/web/src/__tests__/sql-restore-scan.test.ts` (112 lines)
- `apps/web/src/__tests__/storage-local.test.ts` (38 lines)
- `apps/web/src/__tests__/tag-input.test.ts` (34 lines)
- `apps/web/src/__tests__/tag-label-consolidation.test.ts` (128 lines)
- `apps/web/src/__tests__/tag-records.test.ts` (19 lines)
- `apps/web/src/__tests__/tag-slugs.test.ts` (39 lines)
- `apps/web/src/__tests__/tags-actions.test.ts` (178 lines)
- `apps/web/src/__tests__/topics-actions.test.ts` (346 lines)
- `apps/web/src/__tests__/touch-target-audit.test.ts` (608 lines)
- `apps/web/src/__tests__/upload-dropzone.test.ts` (19 lines)
- `apps/web/src/__tests__/upload-limits.test.ts` (65 lines)
- `apps/web/src/__tests__/upload-tracker.test.ts` (76 lines)
- `apps/web/src/__tests__/validation.test.ts` (260 lines)

### E2E specs/helpers/fixtures
- `apps/web/e2e/admin.spec.ts` (90 lines)
- `apps/web/e2e/fixtures/e2e-landscape.jpg` (6 lines)
- `apps/web/e2e/fixtures/e2e-portrait.jpg` (6 lines)
- `apps/web/e2e/helpers.ts` (200 lines)
- `apps/web/e2e/nav-visual-check.spec.ts` (41 lines)
- `apps/web/e2e/origin-guard.spec.ts` (88 lines)
- `apps/web/e2e/public.spec.ts` (119 lines)
- `apps/web/e2e/test-fixes.spec.ts` (70 lines)
