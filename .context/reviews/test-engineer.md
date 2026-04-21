# Cycle 9 Test Engineer Review

## Scope
Ultradeep repo-wide review of test strategy and coverage for `/Users/hletrd/flash-shared/gallery/apps/web`, focused on:
- missing coverage
- weak assertions
- flaky-test risk
- untested edge cases
- TDD opportunities

I did **not sample**. I built an inventory, examined every current test file, examined the test configs/runtime helpers, and inspected the corresponding protected code plus the highest-risk untested server/client surfaces.

## Verification snapshot
- Unit suite run: `npm test --workspace=apps/web`
- Result: **22 test files passed, 131 tests passed**
- Note: green tests do **not** imply healthy coverage; the current suite leaves most of the application surface unexercised.

## Inventory of review-relevant files examined

### Test/runtime config
- `package.json`
- `apps/web/package.json`
- `apps/web/vitest.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/e2e/helpers.ts`

### Unit tests examined
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/backup-filename.test.ts`
- `apps/web/src/__tests__/base56.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/image-url.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/queue-shutdown.test.ts`
- `apps/web/src/__tests__/rate-limit.test.ts`
- `apps/web/src/__tests__/restore-maintenance.test.ts`
- `apps/web/src/__tests__/revalidation.test.ts`
- `apps/web/src/__tests__/sanitize.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/session.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/tag-slugs.test.ts`
- `apps/web/src/__tests__/upload-tracker.test.ts`
- `apps/web/src/__tests__/validation.test.ts`

### E2E specs examined
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`

### Directly protected source examined
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/error-shell.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/tag-slugs.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/db/schema.ts`

### Untested/high-risk source additionally examined
- Server actions: `apps/web/src/app/actions/auth.ts`, `admin-users.ts`, `images.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`
- Admin DB actions: `apps/web/src/app/[locale]/admin/db-actions.ts`
- API/auth/routing: `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/proxy.ts`
- Image/storage pipeline: `apps/web/src/lib/gallery-config.ts`, `image-queue.ts`, `process-image.ts`, `process-topic-image.ts`, `upload-paths.ts`, `upload-limits.ts`, `storage/index.ts`, `storage/local.ts`, `storage/minio.ts`, `storage/s3.ts`
- Public route surfaces: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`
- Complex UI surfaces currently relying on E2E smoke only: `apps/web/src/components/nav-client.tsx`, `search.tsx`, `lightbox.tsx`, `photo-navigation.tsx`, `home-client.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `admin-user-manager.tsx`, `info-bottom-sheet.tsx`
- Utility/formatting helpers with no direct tests: `apps/web/src/lib/exif-datetime.ts`, `safe-json-ld.ts`, `clipboard.ts`, `image-types.ts`, `constants.ts`, `action-result.ts`

### Coverage inventory summary
- Source files under `apps/web/src`: **143**
- Unit test files: **22**
- Source files without a same-stem unit test: **121**
- Untested by top-level area:
  - `app`: 53
  - `components`: 44
  - `lib`: 21
  - `db`: 3
  - `i18n`: 1
  - `instrumentation.ts`: 1
  - `proxy.ts`: 1

---

## Findings

### 1) There is no coverage gate, so CI can stay green while most of the repo remains untested
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/vitest.config.ts:10-12`, inventory summary above
- **Why this matters:** Vitest is only configured with an `include` glob. There is no coverage provider, no threshold, and no failure condition tied to uncovered critical paths.
- **Concrete failure scenario:** a regression in `apps/web/src/app/actions/auth.ts:69-380` or `apps/web/src/app/[locale]/admin/db-actions.ts:243-431` can ship while `npm test` remains fully green because those paths are never exercised.
- **TDD opportunity:** introduce coverage reporting plus targeted thresholds for `src/app/actions`, `src/lib/session.ts`, `src/lib/storage/*`, and `src/app/[locale]/admin/db-actions.ts`.

### 2) The “visual check” suite is not a test suite yet; it only writes screenshots
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/e2e/nav-visual-check.spec.ts:5-33`
- **Why this matters:** all three cases call `page.screenshot(...)` and never assert against a baseline (`toHaveScreenshot`, snapshot diff, or pixel threshold).
- **Concrete failure scenario:** a broken mobile nav layout, wrong theme colors, hidden locale switcher, or clipped search button still passes because the test only produces files under `test-results/`.
- **TDD opportunity:** convert all three cases to baseline assertions and pin the exact nav states they are trying to protect.

### 3) Admin E2E coverage is skipped in the default path, so the most privileged flows are effectively outside normal verification
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/e2e/admin.spec.ts:6-8`, `apps/web/package.json:13-20`, `apps/web/playwright.config.ts:27-29`
- **Why this matters:** `admin.spec.ts` is opt-in behind `E2E_ADMIN_ENABLED=true`, and remote admin runs are blocked unless explicitly re-enabled.
- **Concrete failure scenario:** a regression in admin login, password change, user management, DB restore, or upload cannot be caught by the default `npm test:e2e` path unless the environment is specially prepared.
- **TDD opportunity:** split one always-on seeded local admin smoke from the destructive/remote-only admin flows.

### 4) The existing public/admin E2E assertions are mostly route-smoke assertions and miss content correctness
- **Risk type:** Likely
- **Confidence:** High
- **Files/regions:** `apps/web/e2e/admin.spec.ts:15-55`, `apps/web/e2e/public.spec.ts:4-19`, `:42-77`, `apps/web/e2e/test-fixes.spec.ts:15-54`
- **Why this matters:** most expectations stop at `toHaveURL(...)`, “table is visible”, “button is visible”, or “dialog is visible”. They rarely assert that the page rendered the right records, labels, navigation state, share context, or metadata.
- **Concrete failure scenario:**
  - admin categories/users/tags pages can render an empty or stale table and still pass;
  - locale switching can land on the wrong translated copy while still matching `/ko`;
  - shared-group navigation can show the wrong image order but still satisfy `photoId` URL checks.
- **Manual-validation note:** this is a real gap, but the exact production failure depends on fixture realism.

### 5) `backup-download-route` only covers a subset of the route’s security branches
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** source `apps/web/src/app/api/admin/db/download/route.ts:14-25`, `:34-42`, `:64-68`; tests `apps/web/src/__tests__/backup-download-route.test.ts:72-111`
- **Missing coverage:** invalid filename `400`, containment/symlink `403`, `ENOENT` `404`, and audit-logging failure tolerance.
- **Concrete failure scenario:** a future refactor could weaken filename validation or symlink containment and still pass the current suite because only unauthorized/success/unexpected-500 are asserted.
- **TDD opportunity:** add one test per branch rather than a single happy-path-heavy route suite.

### 6) Password-change rate limiting is implemented but not actually protected by tests
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/src/lib/auth-rate-limit.ts:37-75`
- **Why this matters:** the suite only covers login helpers in `auth-rate-limit.test.ts:29-64`; it never covers `passwordChangeRateLimit`, `getPasswordChangeRateLimitEntry`, `clearSuccessfulPasswordAttempts`, or `prunePasswordChangeRateLimit`.
- **Concrete failure scenario:** password-change attempts could stop pruning, over-evict active keys, or fail to reset after success, causing spurious lockouts or ineffective throttling with no failing test.
- **TDD opportunity:** mirror the login-helper suite for the password-change map and eviction path.

### 7) Session security coverage is dangerously thin for a critical trust boundary
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/src/lib/session.ts:16-145`, `apps/web/src/__tests__/session.test.ts:24-43`
- **What is missing:**
  - `getSessionSecret()` production refusal path (`NODE_ENV=production` without `SESSION_SECRET`)
  - DB fallback generation/re-fetch path
  - `verifySessionToken()` malformed token rejection, signature mismatch, future timestamp, expired session cleanup, missing DB row handling
- **Concrete failure scenario:** a regression that accepts future-dated cookies, stops deleting expired sessions, or silently falls back to a DB secret in production would currently go unnoticed.
- **TDD opportunity:** isolate `verifySessionToken` with mocked DB and deterministic secrets before touching auth behavior again.

### 8) The core auth server actions are almost entirely untested
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/actions/auth.ts:69-380`
- **Why this matters:** this file contains the actual login flow, account-scoped throttling, secure-cookie decision, session rotation, logout behavior, password-change transactionality, and restore-maintenance blocking.
- **Concrete failure scenarios:**
  - login success does not clear both IP and account buckets (`:162-173`);
  - secure cookies regress behind TLS/proxy (`:200-211`);
  - password change leaves other sessions alive (`:343-363`);
  - maintenance mode stops only some auth flows (`:70-74`, `:262-265`).
- **TDD opportunity:** add a dedicated mocked integration suite per action (`login`, `logout`, `updatePassword`) with one behavior per test.

### 9) The DB backup/restore action surface is still mostly unprotected despite being one of the highest-risk areas in the repo
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/[locale]/admin/db-actions.ts:25-100`, `:102-233`, `:243-431`
- **Why this matters:** only the authenticated download route is tested. The following are untested:
  - CSV sanitization and truncation behavior (`escapeCsvField`, `exportImagesCsv`)
  - `mysqldump` process success/failure paths (`dumpDatabase`)
  - restore lock acquisition, maintenance window handling, temp-file streaming, header validation, chunked SQL scan, ignorable stdin errors, and spawn failure handling (`restoreDatabase` / `runRestore`)
- **Concrete failure scenarios:**
  - formula-injection or line-break CSV regressions ship unnoticed;
  - restore refuses valid dumps or accepts dangerous SQL patterns without a failing test;
  - queue quiesce/resume or lock release regressions only show up during an actual incident.
- **Manual-validation note:** this area needs both mocked process tests and an environment-backed restore smoke, because unit-only coverage will not prove `mysql`/`mysqldump` wiring.

### 10) The upload/delete/update image actions are high-complexity and effectively unguarded
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/actions/images.ts:81-617`
- **What is missing:**
  - upload tracker preclaim + reconciliation around partial failures (`:117-171`, `:320-326`)
  - disk-space/body-size/topic/tag validation (`:134-163`)
  - GPS stripping fallback when config fetch fails (`:190-202`)
  - invalid `insertId` cleanup (`:233-241`)
  - batch delete stale/not-found accounting (`:482-560`)
  - metadata update sanitization/revalidation (`:563-616`)
- **Concrete failure scenario:** originals or derivatives can be orphaned, upload quota can drift, or revalidation can skip affected topic pages, and the current suite will still go green.
- **TDD opportunity:** this file is ready for transactional mocked tests built around one upload/delete edge case at a time.

### 11) `loadMoreImages()` has real validation logic but no tests at all
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/actions/public.ts:10-23`
- **Why this matters:** the existing suite only covers `searchImagesAction` (`public-actions.test.ts:61-88`). `loadMoreImages()` silently sanitizes topic, limit, offset, and tags.
- **Concrete failure scenario:** a refactor could drop the `offset > 10000` guard or widen tag acceptance and create expensive pagination/search behavior without breaking any test.
- **TDD opportunity:** add one test each for topic rejection, limit clamping, offset capping, and tag filtering.

### 12) The sanitize suite contains a duplicated null-path test and misses meaningful type/edge assertions
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** test `apps/web/src/__tests__/sanitize.test.ts:5-12`; source `apps/web/src/lib/sanitize.ts:6-8`
- **Why this matters:** the test named “undefined-ish empty input” just repeats `null`, so it does not expand coverage at all.
- **Concrete failure scenario:** if `stripControlChars()` changes handling for `''`, falsy coercion, or non-string misuse, the suite gives a false sense of thoroughness because it has many cases but one of the edge tests is redundant.
- **TDD opportunity:** replace the duplicate with an actual edge the function contract cares about.

### 13) Storage backend switching/rollback and URL generation are completely untested
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:** `apps/web/src/lib/storage/index.ts:53-177`, `apps/web/src/lib/storage/local.ts:22-118`, `apps/web/src/lib/storage/minio.ts:30-49`, `apps/web/src/lib/storage/s3.ts:57-217`
- **Why this matters:** this code handles credential validation, singleton initialization, rollback on failed backend switches, local traversal protection, S3 bucket creation, object URL generation, and presigned/public URL behavior.
- **Concrete failure scenarios:**
  - failed switch leaves the app stuck on an uninitialized backend;
  - local storage path traversal protections regress;
  - S3 public URL/presign behavior breaks asset links after backend switching.
- **Manual-validation note:** S3/MinIO need both mocked SDK tests and connector-backed smoke tests.

### 14) Image-processing and metadata-formatting logic remain a major blind spot
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:**
  - `apps/web/src/lib/process-image.ts:61-150`, `:160-245`
  - `apps/web/src/lib/process-topic-image.ts:37-106`
  - `apps/web/src/lib/exif-datetime.ts:1-37`
  - `apps/web/src/lib/safe-json-ld.ts:1-3`
- **Why this matters:** these files enforce extension allowlists, file-size limits, EXIF timestamp parsing, topic-image cleanup, and JSON-LD escaping.
- **Concrete failure scenarios:**
  - malformed EXIF timestamps silently sort incorrectly;
  - topic-image temp files accumulate forever;
  - dangerous `<` characters leak into JSON-LD script tags if escaping regresses;
  - invalid topic-image input is accepted/rejected incorrectly.
- **TDD opportunity:** pure helper tests (`parseExifDateTime`/formatters, `safeJsonLd`) are cheap wins; file-pipeline tests can be introduced with temporary directories.

### 15) Public route metadata and middleware behavior are not pinned by tests
- **Risk type:** Confirmed
- **Confidence:** High
- **Files/regions:**
  - `apps/web/src/proxy.ts:12-64`
  - `apps/web/src/app/api/health/route.ts:6-16`
  - `apps/web/src/app/api/og/route.tsx:27-157`
  - `apps/web/src/app/[locale]/(public)/page.tsx:18-136`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-152`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:1-247`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:26-187`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:25-125`
- **Why this matters:** metadata generation, locale redirects, share-page robots, OG image URLs, and middleware gating are all behavior-heavy and user-visible.
- **Concrete failure scenarios:**
  - protected admin subroutes stop redirecting anonymous users correctly;
  - OG endpoint stops clamping labels or filtering invalid tags;
  - topic canonical redirects or share-page robots regress without any failing test.
- **Manual-validation note:** metadata should get targeted server tests plus a lightweight rendered smoke.

### 16) Search/nav/lightbox UI behavior is only partially protected and misses result correctness and keyboard-state coverage
- **Risk type:** Likely
- **Confidence:** Medium
- **Files/regions:**
  - component `apps/web/src/components/search.tsx:40-81`, `:142-259`
  - component `apps/web/src/components/nav-client.tsx:35-63`, `:78-155`
  - tests `apps/web/e2e/public.spec.ts:21-40`, `apps/web/e2e/test-fixes.spec.ts:15-42`
- **Why this matters:** the current E2E suite checks focus trap open/close and a few nav visibility toggles, but it never enters a real query, asserts rendered search results, checks keyboard result navigation, or verifies locale-cookie persistence beyond URL changes.
- **Concrete failure scenario:** the search dialog can stop rendering matches, keyboard arrow navigation can break, or the locale switch can preserve the wrong query string while the current smoke tests still pass.

---

## Weak-assertion / flaky-risk notes

### Confirmed weak assertions
- `apps/web/e2e/nav-visual-check.spec.ts:5-33` — screenshots without snapshot assertions.
- `apps/web/e2e/admin.spec.ts:15-38` — page-level success reduced to “URL changed + table/file input visible”.
- `apps/web/e2e/public.spec.ts:4-19` — locale-switch test does not assert translated content, cookie persistence, or query preservation beyond the URL regex.
- `apps/web/src/__tests__/sanitize.test.ts:9-12` — duplicated edge assertion masquerading as extra coverage.

### Likely flaky or low-signal patterns
- `apps/web/e2e/public.spec.ts:10`, `:47`, `:65`; `apps/web/e2e/test-fixes.spec.ts:11`; `apps/web/e2e/admin.spec.ts:19`, `:23`, `:27`, `:31`, `:35` — repeated reliance on `.first()` and on whichever seeded entity happens to render first. This is acceptable for smoke, but it is brittle as a regression oracle because ordering changes can break or mask intent.
- `apps/web/e2e/admin.spec.ts:40-55` — upload success is asserted only by a toast string; it does not verify resulting dashboard presence or queue completion.

---

## Priority TDD backlog

### Highest priority
1. `apps/web/src/lib/session.ts` — `verifySessionToken()` and `getSessionSecret()`
2. `apps/web/src/app/actions/auth.ts` — login/logout/updatePassword integration tests
3. `apps/web/src/app/[locale]/admin/db-actions.ts` — CSV export + restore lock/scan/spawn handling
4. `apps/web/src/app/actions/images.ts` — upload/delete/update edge-case integration tests
5. `apps/web/e2e/nav-visual-check.spec.ts` — convert to real visual assertions

### Next wave
6. `apps/web/src/lib/storage/*` and `storage/index.ts`
7. `apps/web/src/proxy.ts` and `apps/web/src/app/api/og/route.tsx`
8. `apps/web/src/app/actions/public.ts` (`loadMoreImages` specifically)
9. `apps/web/src/lib/process-image.ts`, `process-topic-image.ts`, `exif-datetime.ts`, `safe-json-ld.ts`
10. Public route metadata generation for `/`, `/[topic]`, `/p/[id]`, `/g/[key]`, `/s/[key]`

---

## Final missed-issues sweep
I did a final pass against the full `apps/web/src` inventory after the detailed review.

### Sweep result
- I did **not** find additional already-tested areas that looked materially under-reviewed.
- I **did** confirm the broad pattern that the repo’s green suite is concentrated in pure helpers, while most stateful, transactional, or user-visible behavior remains unpinned.
- The biggest residual blind spots after the sweep remain:
  1. auth/session flows
  2. backup/restore flows
  3. image upload/delete pipeline
  4. storage backend switching
  5. route metadata/middleware behavior
  6. screenshot-based “visual checks” with no visual assertions

## Bottom line
The suite is **stable but shallow**: helper coverage is decent, but the repo still lacks protection where regressions would hurt most — auth, restore, uploads, metadata/routing, storage, and complex UI interactions.
