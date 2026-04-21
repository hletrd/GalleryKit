# Test / Coverage / Flakiness / TDD Review

Repository: `/Users/hletrd/flash-shared/gallery`
Reviewer lens: testing, coverage, flakiness, and TDD
Date: 2026-04-22

## Inspection inventory

### Test and verification config reviewed
- `package.json`
- `apps/web/package.json`
- `apps/web/vitest.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/scripts/check-api-auth.ts`
- `.github/` contents

### Existing unit/integration tests reviewed
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/backup-filename.test.ts`
- `apps/web/src/__tests__/base56.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
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

### Existing Playwright / E2E reviewed
- `apps/web/e2e/helpers.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/scripts/seed-e2e.ts`

### High-risk source files reviewed with no direct test coverage
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/exif-datetime.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/image-types.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/og/route.tsx`

### Fresh verification run
- `npm test --workspace=apps/web` → **21/21 files passed, 128/128 tests passed**
- `npm run lint:api-auth --workspace=apps/web` → **passed**

---

## Findings

### 1) Confirmed issue — there is no automated CI path enforcing tests, lint, typecheck, or the admin API auth guard
**Evidence**
- `.github/` contains only `dependabot.yml`; no test workflow exists.
- Root `package.json:5-9` exposes only `dev`, `build`, `start`, `deploy`.
- `apps/web/package.json:6-17` exposes `test`, `lint`, `test:e2e`, and `lint:api-auth`, but nothing in-repo runs them automatically.
- `apps/web/scripts/check-api-auth.ts:1-108` is explicitly described as a CI check, but no workflow invokes it.

**Problem**
The repo has useful checks, but nothing in the repository enforces them before merge.

**Concrete failure scenario**
A PR regresses `withAdminAuth(...)` usage or breaks a server action. Local tests may pass on one machine or never be run, and the regression merges because the repository itself provides no workflow gate.

**Suggested fix**
Add a GitHub Actions workflow that runs at minimum:
- install
- unit tests
- lint
- typecheck
- `npm run lint:api-auth --workspace=apps/web`
- optionally a seeded Playwright smoke subset

**Confidence**: High

---

### 2) Confirmed issue — `npm run test:e2e` does not provision the seed data that the specs require
**Evidence**
- `apps/web/playwright.config.ts:39-46` starts only `npm run build && npm run start -- --hostname ... --port ...`.
- `apps/web/e2e/public.spec.ts:60-77` hard-codes shared group key `Abc234Def5`.
- `apps/web/e2e/admin.spec.ts:46-54` requires topic slug `e2e-smoke`.
- `apps/web/scripts/seed-e2e.ts:22-28` defines the `e2e-smoke` topic.
- `apps/web/scripts/seed-e2e.ts:183-186` creates shared group key `Abc234Def5`.

**Problem**
The Playwright suite assumes seeded DB state, but the default local runner does not create that state.

**Concrete failure scenario**
A fresh clone runs `npm run test:e2e`. The app boots, but `/g/Abc234Def5` has no backing record and `#upload-topic` has no `e2e-smoke` option, so tests fail even though the UI code is fine.

**Suggested fix**
Run `npm run e2e:seed` in Playwright `globalSetup`, or include seeding in the local `webServer.command` / CI workflow so `test:e2e` is self-contained.

**Confidence**: High

---

### 3) Confirmed issue — the visual Playwright spec captures screenshots but performs no assertions
**Evidence**
- `apps/web/e2e/nav-visual-check.spec.ts:11`
- `apps/web/e2e/nav-visual-check.spec.ts:23`
- `apps/web/e2e/nav-visual-check.spec.ts:32`

Each test writes a file to `test-results/...png` and never calls `toHaveScreenshot()` or any diff/assertion API.

**Problem**
These tests are observational only; they cannot fail on visual regressions.

**Concrete failure scenario**
The mobile nav layout regresses badly, but CI/local Playwright still reports green because the suite only saved updated screenshots.

**Suggested fix**
Convert these to real visual assertions with `expect(page).toHaveScreenshot(...)` and stable masking/animation controls, or move them to a clearly manual visual-audit workflow.

**Confidence**: High

---

### 4) Likely issue — the E2E suite is brittle because it couples to exact seed values, exact English UI text, and mutable app state
**Evidence**
- `apps/web/e2e/helpers.ts:57-77` forces English-locale assumptions and logs in using hard-coded username `admin`.
- `apps/web/e2e/public.spec.ts:13-18` and `apps/web/e2e/test-fixes.spec.ts:29,41` rely on `EN` / `KO` text selectors.
- `apps/web/e2e/public.spec.ts:60-77` hard-codes `Abc234Def5`.
- `apps/web/e2e/admin.spec.ts:53-54` asserts an exact upload success toast string.

**Problem**
The suite is using real UI text and hard-coded seeded identifiers as test data contracts instead of a thinner fixture abstraction.

**Concrete failure scenario**
A harmless translation copy edit, seeded admin username change, or shared-group key generation change breaks Playwright without any product regression.

**Suggested fix**
Introduce reusable fixture accessors or test IDs for critical flows, and centralize seed contracts in one helper so spec files do not each bake in opaque literals.

**Confidence**: Medium

---

### 5) Risk needing coverage — `data.ts` is the largest untested business-logic surface in the repo
**Evidence**
- Entire file: `apps/web/src/lib/data.ts:10-794`
- Especially high-risk regions:
  - shared-group view buffering/backoff: `10-108`
  - privacy field partitioning: `110-200`
  - tag/topic query assembly: `230-358`
  - prev/next image navigation logic: `381-485`
  - share/group fetch logic: `492-610`
  - search dedupe/fallback logic: `664-734`
  - SEO fallback loading: `770-794`

**Problem**
The current suite validates some helper modules around this file, but not this file’s own DB-selection rules, privacy boundaries, buffering behavior, or fallback behavior.

**Concrete failure scenario**
A refactor changes `publicSelectFields`, `getImage()` prev/next ordering, or `searchImages()` dedupe behavior. Unit tests still pass because none exercise this module directly, but the public gallery leaks fields or serves incorrect navigation/search results.

**Suggested fix**
Add focused tests around:
- public/admin field separation
- `buildImageConditions()` and tag filters
- prev/next ordering with null `capture_date`
- `getSharedGroup()` tag hydration and view-count buffering
- `searchImages()` main-query vs tag-query merge behavior
- SEO DB fallback behavior

**Confidence**: High

---

### 6) Risk needing coverage — the file-processing pipeline has almost no direct test protection despite high complexity and I/O risk
**Evidence**
- `apps/web/src/lib/process-image.ts:160-438` (`deleteImageVariants`, `saveOriginalAndGetMetadata`, `processImageFormats`)
- `apps/web/src/lib/process-image.ts:459-568` (`extractExifForDb`)
- `apps/web/src/lib/process-topic-image.ts:42-106`
- `apps/web/src/lib/exif-datetime.ts:1-37`

**Problem**
This pipeline handles sharp transforms, EXIF extraction, ICC parsing, temp files, and resize fan-out, but the suite does not cover fixture-based happy paths or failure paths here.

**Concrete failure scenario**
A change in EXIF parsing starts dropping `DateTimeOriginal`, GPS stripping regresses, or one output format becomes zero-byte. The UI might not fail until production uploads occur.

**Suggested fix**
Add file-fixture tests that cover:
- malformed image rejection
- EXIF extraction / null-handling
- GPS coordinate parsing
- resize generation across configured sizes
- zero-byte / partial-output failure handling
- topic-image cleanup on processing failure

**Confidence**: High

---

### 7) Risk needing coverage — the background queue / retry / shutdown flow is largely untested beyond the small shutdown helper
**Evidence**
- existing coverage only hits `apps/web/src/__tests__/queue-shutdown.test.ts`
- untested orchestration remains in `apps/web/src/lib/image-queue.ts:100-281` and `292-370`

**Problem**
The queue includes advisory locking, retry bookkeeping, bootstrap behavior, shutdown/resume semantics, and periodic cleanup. Only the extracted shutdown helper is tested today.

**Concrete failure scenario**
A regression causes duplicate processing, abandoned retry entries, or restore-resume logic to fail to requeue pending images. The issue would appear only under concurrency or restart conditions.

**Suggested fix**
Add queue-state tests with mocked DB/fs/PQueue for:
- failed claim retry scheduling
- idempotent enqueue behavior
- processed-row skip path
- cleanup after delete-during-processing
- bootstrap pending-image replay
- quiesce/resume semantics around restore mode

**Confidence**: High

---

### 8) Risk needing coverage — authentication and admin-user mutation flows are security-sensitive but mostly untested
**Evidence**
- `apps/web/src/app/actions/auth.ts:69-235` (login/session issuance/rate-limit rollback)
- `apps/web/src/app/actions/auth.ts:238-380` (logout/update-password region)
- `apps/web/src/app/actions/admin-users.ts:68-240`
- `apps/web/src/lib/api-auth.ts:9-18`
- `apps/web/src/lib/audit.ts:8-56`

**Problem**
The suite tests token helpers and auth-rate-limit helpers, but not the action-level behavior where cookies, sessions, transactions, rate-limit rollbacks, and audit logging are combined.

**Concrete failure scenario**
A login regression stops clearing successful-login buckets, sets insecure cookies behind a proxy, or allows an admin-delete race to remove the final admin user. Helper tests still pass because the integration behavior is untested.

**Suggested fix**
Add action-level tests for:
- login success/failure rollback paths
- secure-cookie behavior with forwarded HTTPS
- session rotation / fixation prevention transaction
- update-password rate limiting and session invalidation
- `createAdminUser()` duplicate/rollback cases
- `deleteAdminUser()` final-admin and lock-timeout branches
- `withAdminAuth()` unauthorized response localization
- `logAuditEvent()` serialization/truncation behavior

**Confidence**: High

---

### 9) Risk needing coverage — image, tag, topic, and share mutations form the core admin product surface but are barely covered
**Evidence**
- `apps/web/src/app/actions/images.ts:81-617`
- `apps/web/src/app/actions/tags.ts:43-414`
- `apps/web/src/app/actions/topics.ts:34-396`
- `apps/web/src/app/actions/sharing.ts:62-334`

**Problem**
These modules carry the heaviest mutation logic in the app: upload quotas, restore-window cleanup, tag-collision handling, topic alias management, share-link generation, and deletion cleanup. The current unit suite only directly covers `public-actions` and `backup-download-route` on the action/API side.

**Concrete failure scenario**
A refactor reintroduces upload-tracker drift, silently accepts malformed topic aliases, revokes the wrong share key under a race, or leaves stale files after image deletion. The current test suite would not catch it.

**Suggested fix**
Add targeted tests for:
- `uploadImages()` cumulative quota reconciliation and restore interruption cleanup
- single/batch image deletion cleanup behavior
- tag slug-collision warnings and exact-name lookup precedence
- topic slug rename transaction behavior
- share-key collision retry and revoke race protection

**Confidence**: High

---

### 10) Risk needing coverage — configuration and boundary helper modules are untested even though they influence production behavior globally
**Evidence**
- `apps/web/src/app/actions/settings.ts:15-129`
- `apps/web/src/app/actions/seo.ts:23-134`
- `apps/web/src/lib/gallery-config.ts:33-88`
- `apps/web/src/lib/upload-paths.ts:48-94`
- `apps/web/src/lib/upload-limits.ts:1-22`
- `apps/web/src/lib/image-url.ts:1-21`
- `apps/web/src/lib/constants.ts:1-14`
- `apps/web/src/lib/safe-json-ld.ts:1-3`

**Problem**
These modules define runtime defaults, URL generation, upload size enforcement, settings persistence, and path safety. They are small individually, but a regression here has repo-wide blast radius.

**Concrete failure scenario**
A bad env value silently falls back incorrectly, `image_sizes` locking logic regresses, legacy original-upload detection stops failing in production, or JSON-LD escaping is weakened. Existing tests do not exercise these boundaries.

**Suggested fix**
Add narrow unit tests for each module’s edge behavior, especially env parsing, URL joining, path fallback order, settings deletion/upsert behavior, and JSON-LD escaping.

**Confidence**: High

---

### 11) Confirmed issue — the repo has no coverage reporting or threshold enforcement, so coverage can only drift downward silently
**Evidence**
- `apps/web/package.json:6-17` contains `test` and `test:e2e`, but no coverage script.
- `apps/web/vitest.config.ts:4-10` defines only aliasing and `include`; it sets no `coverage` configuration or thresholds.

**Problem**
There is no codified expectation for minimum coverage on high-risk modules.

**Concrete failure scenario**
A contributor removes tests from one of the few guarded helpers. The suite still passes, and there is no artifact showing that business-critical files remain effectively uncovered.

**Suggested fix**
Add a coverage command and thresholds, at least for statements/branches on the critical helper layer, plus a human-maintained allowlist for intentionally uncovered heavy I/O modules until they are backfilled.

**Confidence**: High

---

### 12) Likely flakiness / missed isolation — the admin upload Playwright flow validates only the success toast, not downstream processing completion or cleanup
**Evidence**
- `apps/web/e2e/admin.spec.ts:40-55`
- `apps/web/src/app/actions/images.ts:296-305` queues processing asynchronously
- `apps/web/src/lib/image-queue.ts:136-281` performs eventual background processing

**Problem**
The E2E upload test stops at the optimistic success toast, even though the user-visible feature depends on asynchronous background processing and cleanup.

**Concrete failure scenario**
The upload action succeeds, the toast appears, but background processing later fails due to queue/bootstrap/storage issues. The E2E suite stays green while uploaded images remain permanently unprocessed.

**Suggested fix**
Extend the upload E2E to verify a processed image becomes visible on the public/admin surface, or add an integration test that mocks queue completion and asserts the processed state transition.

**Confidence**: Medium

---

## Confirmed issues summary
1. No CI workflow enforces tests/lint/typecheck/api-auth guard.
2. Playwright suite is not self-seeding.
3. Visual Playwright spec has no assertions.
4. No coverage reporting / threshold enforcement.

## Likely issues summary
1. E2E suite is brittle due to hard-coded literals and text contracts.
2. Admin upload E2E verifies only the optimistic toast, not end-to-end processing.

## Risks needing manual validation / missing coverage
1. `data.ts`
2. `process-image.ts` / `process-topic-image.ts` / `exif-datetime.ts`
3. `image-queue.ts`
4. `auth.ts` / `admin-users.ts` / `api-auth.ts` / `audit.ts`
5. `images.ts` / `tags.ts` / `topics.ts` / `sharing.ts`
6. `settings.ts` / `seo.ts` / `gallery-config.ts`
7. `upload-paths.ts` / `upload-limits.ts` / `image-url.ts` / `safe-json-ld.ts`

## Missed-issues sweep
I did a final sweep specifically for hidden test blind spots and cross-file coupling. The biggest remaining exposure is not one more isolated bug; it is **systemic undercoverage of the heaviest server-action and image-processing paths**. The existing suite is healthy for helper functions, but it is still skewed toward leaf utilities rather than the mutation-heavy orchestration layers. If I were triaging next work, I would prioritize tests in this order:
1. `data.ts`
2. `process-image.ts` + `image-queue.ts`
3. `auth.ts` + `admin-users.ts`
4. `images.ts` + `sharing.ts`
5. `tags.ts` + `topics.ts` + settings/SEO actions

## Finding count
12 findings total
- 4 confirmed issues
- 2 likely issues
- 6 risk / coverage findings
