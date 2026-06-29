# Test Engineer Review - Cycle 13

Date: 2026-06-29
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `b269a36bde0fa6e22ebe6c025a41af3f4e050cc6`
Role: test-engineer
Scope: repository-wide test coverage and test quality review. No production code modified.

## Process Evidence

Read first, per instruction:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory built before findings:

- Relevant app/source inventory under `apps/web/src`, `apps/web/scripts`, `apps/web/e2e`, and `apps/web/drizzle`: 570 files, excluding `node_modules`, `.git`, build output, runtime upload/resource/data dirs, and test result output.
- Non-test source TS/TSX under `apps/web/src`: 237 files.
- Unit tests: 259 Vitest files under `apps/web/src/__tests__`.
- Playwright tests: 5 specs under `apps/web/e2e` plus helpers/fixtures.
- App route/page metadata surface: 41 route/page/layout/metadata files.
- Server actions: 13 files under `apps/web/src/app/actions`.
- API routes: 8 files under `apps/web/src/app/api`.
- Shared libraries: 96 files under `apps/web/src/lib`.
- Components: 57 files under `apps/web/src/components`.
- Scripts/custom gates: 27 files under `apps/web/scripts`.
- Source-contract tests using `readFileSync`: 99 test files. This is a useful pattern in this repo, but it is also the dominant test-quality risk where runtime side effects matter.

Representative source/test mapping checked:

- Security/custom gates: `scripts/check-api-auth.ts` -> `check-api-auth.test.ts`; `scripts/check-action-origin.ts` -> `check-action-origin.test.ts`; `scripts/check-public-route-rate-limit.ts` -> `check-public-route-rate-limit.test.ts`.
- Auth/session actions: `app/actions/auth.ts` -> `auth-actions-behavior.test.ts`, `auth-rate-limit-ordering.test.ts`, `auth-rate-limit-rollback.test.ts`, `auth-rethrow.test.ts`, `session*.test.ts`, `origin-guard.spec.ts`.
- Image upload/processing/retry: `app/actions/images.ts`, `lib/image-queue.ts`, `lib/process-image.ts` -> `images-actions.test.ts`, `images-action-*.test.ts`, `image-queue*.test.ts`, `process-image-*.test.ts`, `failed-image-retry.test.ts`, `retry-failed-image-auth.test.ts`.
- Public search/semantic routes: `api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts` -> `semantic-search-route.test.ts`, `semantic-search-rate-limit.test.ts`, `similar-route.test.ts`, `search-route-privacy.test.ts`, `semantic-scan-limit-source.test.ts`.
- OG/service worker/static serving: `api/og*.tsx`, `lib/og-photo-fetch.ts`, `public/sw.template.js`, `public/sw.js`, `lib/serve-upload.ts` -> `og-*.test.ts`, `sw-template-contract.test.ts`, `sw-cache.test.ts`, `serve-upload.test.ts`.
- Migration/schema/privacy gates: `scripts/migrate.js`, `drizzle/meta/_journal.json`, `db/schema.ts`, `lib/data.ts` -> `migrate-reconcile-coverage.test.ts`, `migration-journal*.test.ts`, `privacy-fields.test.ts`, `search-route-privacy.test.ts`.
- UI/a11y gates: `components/**`, admin/public page groups -> `touch-target-audit.test.ts`, focus-visible scan tests, `nav-visual-check.spec.ts`, component behavior tests.

Validation run during review:

```text
npm test --workspace=apps/web -- --run auth-actions-behavior.test.ts failed-image-retry.test.ts retry-failed-image-auth.test.ts check-action-origin.test.ts check-public-route-rate-limit.test.ts
Result: 5 files passed, 87 tests passed.
```

Skip sweep:

- No `.only` tests found.
- Intentional skips: admin E2E credential gating in `apps/web/e2e/admin.spec.ts:7-12` and `apps/web/e2e/origin-guard.spec.ts:28-73`; CLIP integration/offline gates in `clip-semantic-integration.test.ts:30-31` and `clip-offline-load.test.ts:32-41`.

## Confirmed Issues

### C13-TE-01 - Auth behavior tests do not lock the no-auth-read-before-origin invariant, and `updatePassword` currently reads the session/user first

Severity: High
Confidence: High
Status: Confirmed coverage weakness with a currently failing invariant if asserted

Evidence:

- The generic action-origin scanner deliberately treats `getCurrentUser`, `getSession`, and `isAdmin` as pre-origin auth reads: `apps/web/scripts/check-action-origin.ts:228-232`.
- The scanner fails an action if those reads appear before the same-origin guard: `apps/web/scripts/check-action-origin.ts:315-320` and `apps/web/scripts/check-action-origin.ts:327-331`.
- `auth.ts` is excluded from that scanner by basename: `apps/web/scripts/check-action-origin.ts:13-19` and `apps/web/scripts/check-action-origin.ts:49`.
- `updatePassword` reads `currentUser` before `headers()` and `hasTrustedSameOrigin(...)`: `apps/web/src/app/actions/auth.ts:283-298`.
- The new behavior test covers hostile-origin `updatePassword`, but only asserts no Argon2 verify and no transaction; it does not assert that session/user DB reads are skipped: `apps/web/src/__tests__/auth-actions-behavior.test.ts:241-253`.
- The same test's mock chain shows `getCurrentUser()` can hit the mocked DB select queue: `apps/web/src/__tests__/auth-actions-behavior.test.ts:153-168`, and the hostile-origin case even seeds that queue at `apps/web/src/__tests__/auth-actions-behavior.test.ts:243`.

Concrete failure scenario:

A cross-origin password-change request carrying the victim's admin cookie reaches `updatePassword`. The action verifies the session and reads the admin user before applying the origin check. The current behavior test still passes because it only proves password verification and DB transaction are skipped. This creates false confidence versus the stricter scanner contract used for every non-auth mutating server action.

Suggested fix:

Add a behavior assertion to the hostile-origin `updatePassword` test that `verifySessionTokenMock` and `dbSelectMock` are not called. Write it first; it should fail on the current source. Then move the same-origin check ahead of `getCurrentUser()` in `updatePassword`, or create an explicit auth-action scanner/fixture that enforces the same no-pre-origin-auth-read ordering for this special file.

### C13-TE-02 - Failed-image retry recovery is still mostly protected by source-text snippets, not behavior

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `retryFailedImage` performs a multi-step recovery flow: admin/origin checks, failed-row selection, strict config snapshot, DB field clearing, queue-state cleanup, enqueue, and failure restoration: `apps/web/src/app/actions/images.ts:1162-1275`.
- The main retry suite explicitly says it is fixture/source inspection: `apps/web/src/__tests__/failed-image-retry.test.ts:4-9`.
- It asserts snippets rather than executed effects for snapshot rebuild, queue-state deletion, enqueue payload, and enqueue-rejection restoration: `apps/web/src/__tests__/failed-image-retry.test.ts:87-113`.
- The behavior suite covers only the auth/origin early exits: `apps/web/src/__tests__/retry-failed-image-auth.test.ts:138-160`.

Concrete failure scenario:

A refactor can keep the strings `processing_error: null`, `failed_at: null`, `enqueueImageProcessing`, and `processing_error: retryError` in the file while changing execution order, omitting `retryCounts.delete`, selecting the wrong failed row, writing a stale `processing_settings_json`, or returning success after an enqueue rejection. The source-contract tests stay green because they do not execute the state transition.

Suggested fix:

Add runtime tests with mocked DB select/update chains, `getGalleryConfigStrict`, `createProcessingSettingsSnapshot`, `serializeProcessingSettingsSnapshot`, `getProcessingQueueState`, and `enqueueImageProcessing`. Cover success, config failure, non-failed row, invalid id, and enqueue rejection. Keep the source test only for broad wiring contracts that are hard to observe behaviorally.

### C13-TE-03 - `nav-visual-check.spec.ts` records screenshots but never asserts visual baselines

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- The spec captures mobile collapsed, mobile expanded, and desktop screenshots: `apps/web/e2e/nav-visual-check.spec.ts:40-79`.
- It writes screenshots to `test-results`: `apps/web/e2e/nav-visual-check.spec.ts:51`, `apps/web/e2e/nav-visual-check.spec.ts:65`, and `apps/web/e2e/nav-visual-check.spec.ts:78`.
- There is no `toHaveScreenshot(...)` assertion in the file; the actual assertions are broad visibility/touch-target/overlap checks: `apps/web/e2e/nav-visual-check.spec.ts:24-37`.

Concrete failure scenario:

Spacing, contrast, active states, focus rings, disclosure affordances, or visual hierarchy can regress while all element geometry remains >=44 px and non-overlapping. CI still passes, and the newly captured screenshots are just artifacts.

Suggested fix:

Either convert the three captures to `expect(page).toHaveScreenshot(...)` or rename the spec as a manual artifact generator and add a separate baseline-backed visual regression spec. Mask dynamic regions if needed.

### C13-TE-04 - Production CLIP semantic-search coverage is skipped by default CI

Severity: Medium
Confidence: High
Status: Risk needing CI/manual validation

Evidence:

- Real semantic ranking tests run only when `CLIP_INTEGRATION=1`: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10` and `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`.
- Offline production-weight load tests require `CLIP_OFFLINE_LOAD=1` plus a seeded `CLIP_MODELS_ROOT`: `apps/web/src/__tests__/clip-offline-load.test.ts:15-21` and `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`.
- Default CI sets DB/site/admin env only and runs unit tests without CLIP env or model cache setup: `.github/workflows/quality.yml:27-80`.
- The production loader is the code path that sets `env.cacheDir`, disables remote models, loads the pinned model/tokenizer, and returns real text/image embeddings: `apps/web/src/lib/clip-model.ts:98-128` and `apps/web/src/lib/clip-model.ts:138-222`.

Concrete failure scenario:

A dependency update, model-layout drift, tokenizer issue, offline cache mismatch, or image preprocessing regression passes PR and push gates, then fails in production semantic search or CLIP backfill. CLAUDE.md documents production semantic search as live, so this is no longer an optional demo-only path.

Suggested fix:

Add a scheduled or label-triggered CI job that restores a cached seeded `CLIP_MODELS_ROOT` and runs `CLIP_INTEGRATION=1` plus `CLIP_OFFLINE_LOAD=1` suites. Keep it outside the fastest PR gate if artifact/runtime cost is too high, but make failures visible before deploy-sensitive work.

### C13-TE-05 - Expensive public GET route rate limiting is still a manual-audit boundary

Severity: Medium
Confidence: Medium
Status: Risk needing manual validation for future routes

Evidence:

- The public route scanner explicitly excludes GET handlers from its required rate-limit audit: `apps/web/scripts/check-public-route-rate-limit.ts:1-11`.
- Its mutating method set is only `POST`, `PUT`, `PATCH`, and `DELETE`: `apps/web/scripts/check-public-route-rate-limit.ts:36`.
- Current expensive public GET routes rely on bespoke coverage and source contracts instead:
  - Similar-image GET rate limit: `apps/web/src/app/api/search/similar/[id]/route.ts:60-95`, tested by `apps/web/src/__tests__/similar-route.test.ts` references.
  - Topic OG GET rate limit: `apps/web/src/app/api/og/route.tsx:33-62`, helper-level tested by `apps/web/src/__tests__/og-rate-limit.test.ts`.
  - Per-photo OG GET rate limit: `apps/web/src/app/api/og/photo/[id]/route.tsx:38-49`, source-tested by `apps/web/src/__tests__/og-photo-fallback.test.ts:40-71`.

Concrete failure scenario:

A future public `GET` route imports DB access, `ImageResponse`, Sharp, CLIP embedding, or another expensive helper but omits a rate-limit pre-increment. The lint gate will not inspect it, and unless the author remembers to add bespoke route tests, CI will pass.

Suggested fix:

Extend the scanner with an "expensive GET" mode. For public GET handlers that import or call known expensive dependencies (`db`, `ImageResponse`, Sharp, CLIP/search helpers, file generation), require a rate-limit pre-increment or `@public-no-rate-limit-required: <reason>`. Add fixtures for rate-limited GET, exempt cheap GET, and failing expensive GET.

## Likely Issues

### C13-TE-06 - Sitemap and robots metadata routes have no direct route-level regression tests

Severity: Low
Confidence: Medium
Status: Likely

Evidence:

- `sitemap()` builds localized home/topic/photo/feed entries, budgets image rows, and has a DB-failure fallback: `apps/web/src/app/sitemap.ts:24-118`.
- `robots()` preserves admin/API disallow rules and the sitemap URL: `apps/web/src/app/robots.ts:17-25`.
- Repo test search found references to the production files but no direct unit tests under `apps/web/src/__tests__` for `sitemap.ts` or `robots.ts`.

Concrete failure scenario:

A metadata refactor can silently drop localized topic URLs, per-topic feed entries, image URLs, the homepage-only fallback, `/api/` disallow, or the configured sitemap URL while typecheck/build still pass.

Suggested fix:

Add route-level tests that mock data/config: sitemap success includes home/topic/photo/root-feed/topic-feed entries; sitemap DB failure returns localized homepage fallback; robots preserves `/api/` and locale admin disallows plus `${BASE_URL}/sitemap.xml`.

## Coverage Risks / Manual Validation

### C13-TE-07 - No coverage-report script or threshold exists for a suite with many source-contract tests

Severity: Low
Confidence: High
Status: Confirmed tooling gap

Evidence:

- Root scripts expose lint, typecheck, unit, e2e, custom lint gates, and deploy, but no coverage script: `package.json:11-22`.
- App scripts run `vitest run` but no coverage command: `apps/web/package.json:8-26`.
- Vitest config sets include/exclude/timeouts but no coverage reporters or thresholds: `apps/web/vitest.config.ts:16-39`.
- CI runs `npm test` without coverage output: `.github/workflows/quality.yml:66-80`.
- The suite has 99 source-contract tests using `readFileSync`, so raw test count can rise while runtime branch coverage remains flat.

Concrete failure scenario:

A critical runtime branch in server actions, routes, or operational scripts loses behavior coverage, but the overall test count remains high due to source-text assertions. Reviewers have no changed-file coverage signal to catch the regression.

Suggested fix:

Start with a non-blocking coverage report for critical directories (`src/app/actions`, `src/app/api`, `src/lib`, `scripts`). Once exclusions stabilize, add modest changed-file or branch thresholds for security/operational paths rather than a repo-wide percentage target.

## Final Sweep

- No focused tests found.
- The C12 sanitize-admin null-on-rejected gap is closed: `apps/web/src/__tests__/sanitize-admin-string.test.ts:11-24` and `apps/web/src/__tests__/sanitize-admin-string.test.ts:59-73` assert `value` is null on Unicode/C0 rejection, matching `apps/web/src/lib/sanitize.ts:172-190`.
- The admin/API/action/public scanner fixtures now verify approved import sources and spoofed-helper negatives; the earlier fail-open helper-name issue is closed in the current tree.
- Existing privacy guard tests remain strong for public field selection and search enrichment: `privacy-fields.test.ts`, `search-route-privacy.test.ts`, and typecheck participate in the quality gate.
- The most important remaining test-quality theme is converting source-text contracts into runtime behavior tests when state transitions, side effects, or ordering matter.
