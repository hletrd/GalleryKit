# Test Engineer Review - Cycle 12

Date: 2026-06-29
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `d7fd0db296817e7322bb62b346a6b2c64904cec9`
Role: test-engineer
Scope: test coverage, flaky tests, missing regression locks, gate adequacy, fixture brittleness, and TDD opportunities. No fixes implemented.

## Inventory Built First

Review-relevant inventory was built before reading findings in detail.

- Source and route surface: 560 relevant files under `apps/web/src`, `apps/web/e2e`, `apps/web/scripts`, and `apps/web/drizzle`.
- Unit tests: 257 files under `apps/web/src/__tests__`.
- Playwright tests: 5 specs under `apps/web/e2e`.
- App routes/pages/actions: 76 app route/page files and 13 server-action files.
- API route files: 8.
- Shared libraries: 96 files under `apps/web/src/lib`.
- Components: 57 files under `apps/web/src/components`.
- Scripts and custom gates: 27 files under `apps/web/scripts`.
- Migrations: 32 SQL files plus Drizzle metadata.
- Source-contract style tests: 98 unit test files contain `readFileSync`, scanner fixtures, or similar source-text assertions.
- Skips found: no `.only`; conditional skips exist for admin/origin E2E env gating and CLIP integration/offline suites.

I examined the relevant files without sampling, including test configs, CI gates, custom lint scanners, E2E setup/seed scripts, server actions, public routes, privacy tests, image queue/retry tests, CLIP tests, sitemap/robots routes, service worker tests, and previously reported flake areas.

## Findings

### C12-TE-01 - Auth server actions are outside the action-origin scanner and rely on source-contract tests instead of behavior locks

Severity: High
Status: Confirmed
Confidence: High

Evidence:

- `apps/web/scripts/check-action-origin.ts:13-19` documents that `auth.ts` is excluded because auth actions have mixed public/admin behavior.
- `apps/web/scripts/check-action-origin.ts:49` hard-codes `EXCLUDED_ACTION_BASENAMES = new Set(['auth'])`.
- `apps/web/src/app/actions/auth.ts:91-95` guards `login` with `hasTrustedSameOrigin()`.
- `apps/web/src/app/actions/auth.ts:260-280` guards `logout`.
- `apps/web/src/app/actions/auth.ts:283-298` reads the current user in `updatePassword` before the same-origin check.
- `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:1-18`, `:25-103`, and `:106-139` assert ordering with source text and `indexOf`.
- `apps/web/src/__tests__/auth-rethrow.test.ts:1-15` and `:47-52` are also source-text checks.
- `apps/web/e2e/origin-guard.spec.ts:33-73` covers an admin API route, not these server actions.

Failure scenario:

A future auth refactor can remove, rename, or move the same-origin checks in `login`, `logout`, or `updatePassword`. The global action-origin scanner will not scan `auth.ts`; browser E2E exercises same-origin happy paths; the current tests mostly verify string ordering rather than the runtime side effects blocked on cross-origin calls. A CSRF regression in authentication or password mutation can pass the default gates.

Suggested fix/test:

Add behavior tests for auth actions with mocked `next/headers`, cookies, DB, `argon2`, rate-limit helpers, and redirects:

- Cross-origin `login` returns the auth-failed state before DB lookup, password hash verification, rate-limit increments, or cookie writes.
- Cross-origin `logout` redirects without deleting the session row or clearing cookies.
- Cross-origin `updatePassword` returns unauthorized and does not verify passwords, hash new passwords, update user rows, or mutate sessions.
- Keep one scanner/source-contract fixture if desired, but make runtime side effects the regression lock.

TDD opportunity:

Write the rejected cross-origin behavior tests first, then adjust the auth scanner exception or action structure only if the tests expose a concrete ordering issue.

### C12-TE-02 - Failed image retry recovery is mostly locked by source-text tests, not behavior tests

Severity: Medium
Status: Likely
Confidence: High

Evidence:

- `apps/web/src/app/actions/images.ts:1163-1275` implements `retryFailedImage`, including admin/origin validation, failed-image selection, strict config lookup, failure-field clearing, queue state cleanup, enqueue, and rollback when enqueue is rejected.
- `apps/web/src/__tests__/failed-image-retry.test.ts:1-9` states that the suite uses source inspection to guard the retry path.
- `apps/web/src/__tests__/failed-image-retry.test.ts:71-117` checks for snippets such as `processing_error: null`, `failed_at: null`, and `enqueueImageProcessing(... 'retry')`.
- `apps/web/src/__tests__/retry-failed-image-auth.test.ts:125-161` behavior-tests auth/origin early exits, but not the successful retry or enqueue-rejection recovery path.

Failure scenario:

The retry action can select the wrong image row, clear the wrong fields, fail to clear `queuedImageIds` / `processingImageIds`, enqueue with stale snapshot data, or fail to restore failure state when enqueue is rejected. The string-based tests can still pass as long as recognizable code fragments remain.

Suggested fix/test:

Add a runtime unit suite with mocked DB query/update chains, `getStrictImageProcessingConfig`, queue state, enqueue, and translations. Cover:

- Invalid ID and non-failed image outcomes.
- Config read failure preserves failed state.
- Successful retry clears `processing_error`, `failed_at`, `processing_started_at`, and queue state before enqueue.
- Enqueue rejection restores the failure fields and returns an error.
- The enqueue payload contains the intended image ID and `"retry"` reason.

### C12-TE-03 - Navigation visual check records screenshots but does not assert them

Severity: Medium
Status: Confirmed
Confidence: High

Evidence:

- `apps/web/e2e/nav-visual-check.spec.ts:40-79` captures desktop, tablet, and mobile navigation screenshots.
- `apps/web/e2e/nav-visual-check.spec.ts:51`, `:65`, and `:78` call `page.screenshot(...)`.
- The spec contains layout assertions, but no `expect(...).toHaveScreenshot(...)` baseline assertion.

Failure scenario:

A navigation visual regression can pass as long as the broad layout metrics still satisfy thresholds. The screenshots become overwritten artifacts rather than pass/fail evidence, so regressions in spacing, active-state contrast, menu rendering, or visual affordances may not block CI.

Suggested fix/test:

Convert this to Playwright visual assertions with stable baselines for desktop, tablet, and mobile navigation, masking any intentionally dynamic regions. If screenshots are only intended as manual artifacts, rename the spec or add a separate baseline-backed visual test so CI has an automated regression lock.

### C12-TE-04 - Production CLIP semantic-search coverage is skipped in default CI

Severity: Medium
Status: Risk
Confidence: High

Evidence:

- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-9` documents that the semantic integration suite is skipped by default.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31` skips unless `CLIP_INTEGRATION=1`.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:72-80` is the high-value real semantic ranking check.
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-20` documents the offline weight-loading requirements.
- `apps/web/src/__tests__/clip-offline-load.test.ts:32-41` skips unless `CLIP_OFFLINE_LOAD=1` and seeded weights are available.
- `.github/workflows/quality.yml:27-80` runs the default quality gates without setting `CLIP_INTEGRATION`, `CLIP_OFFLINE_LOAD`, or a seeded `CLIP_MODELS_ROOT`.
- `apps/web/src/lib/clip-model.ts:98-128` is the production offline-model loader; `:138-220` covers text/image embedding behavior.

Failure scenario:

A dependency update, tokenizer/model-layout change, normalization regression, or offline asset packaging issue can pass the default pull-request gate and fail only during production inference or backfill. This is especially important because CLAUDE.md documents CLIP semantic search as live production functionality.

Suggested fix/test:

Add a scheduled or label-triggered CI job that restores a cached seeded `CLIP_MODELS_ROOT` and runs both gated suites. Keep it outside the fastest PR gate if runtime or artifact size is too high, but make failures visible before deploy-sensitive work.

### C12-TE-05 - Public route rate-limit scanner ignores GET handlers even when they are expensive public endpoints

Severity: Medium
Status: Risk
Confidence: High

Evidence:

- `apps/web/scripts/check-public-route-rate-limit.ts:1-11` explicitly limits the scanner to public mutating handlers.
- `apps/web/scripts/check-public-route-rate-limit.ts:36` defines scanned methods as `POST`, `PUT`, `PATCH`, and `DELETE`.
- Existing expensive public GET routes currently carry manual limits:
  - `apps/web/src/app/api/search/similar/[id]/route.ts:60` exports `GET`; `:85-95` rate-limits it.
  - `apps/web/src/app/api/og/route.tsx:33` exports `GET`; `:46-62` rate-limits it.
  - `apps/web/src/app/api/og/photo/[id]/route.tsx:38` exports `GET`; `:44-49` rate-limits it.

Failure scenario:

A future public GET route can perform DB search, image generation, embedding work, or other expensive computation without a rate-limit pre-increment. The scanner will report success because it only inspects mutating methods, and the existing route-specific tests do not create a general guardrail for future expensive GET endpoints.

Suggested fix/test:

Extend the scanner with a GET-expensive-route mode. For public `GET` handlers that import or call DB access, `ImageResponse`, image processing, search, embedding, or other known expensive helpers, require a rate-limit pre-increment or an explicit `@public-no-rate-limit-required: <reason>` exemption. Add scanner fixtures for rate-limited GET, exempt GET, and failing expensive GET.

### C12-TE-06 - Sitemap and robots metadata routes lack route-level regression tests

Severity: Low
Status: Likely
Confidence: Medium

Evidence:

- `apps/web/src/app/sitemap.ts:24-118` builds localized sitemap entries from configured pages, topics, images, feed URLs, and a fallback path when DB access fails.
- `apps/web/src/app/robots.ts:17-25` declares public robots policy, API disallow rules, and sitemap URL.
- Repository test search found no direct unit tests for `sitemap.ts` or `robots.ts`.

Failure scenario:

A metadata refactor can silently drop topic URLs, localized feed URLs, image URLs, the DB-failure fallback, or the `/api/` robots disallow rule. Build/typecheck can still pass because the exported shapes remain valid.

Suggested fix/test:

Add route-level unit tests that mock config and data access:

- Sitemap success includes home, configured pages, localized topics, image URLs, and feed entries.
- Sitemap DB failure returns the documented homepage fallback instead of throwing.
- Robots output preserves `/api/` disallow and the configured sitemap URL.

### C12-TE-07 - No coverage report or threshold gate exists for a large mixed unit/source-contract suite

Severity: Low
Status: Confirmed
Confidence: High

Evidence:

- Root `package.json:11-22` has lint, typecheck, build, unit, and E2E scripts but no coverage script.
- `apps/web/package.json:8-26` has Vitest scripts but no coverage command.
- `apps/web/vitest.config.ts:16-39` configures environment, setup, aliases, timeout, and coverage exclusions indirectly through included files, but no coverage thresholds or reporters.
- `.github/workflows/quality.yml:54-80` runs `npm test --workspace=apps/web`, E2E, and build without coverage output.

Failure scenario:

Critical behavior can lose test coverage while the total test count remains high. This is amplified by the large number of source-contract tests, which can make the suite look comprehensive while leaving runtime branches unexecuted.

Suggested fix/test:

Start with a non-blocking coverage report on changed files or critical directories (`src/app/actions`, `src/app/api`, `src/lib/security`, `src/lib/data`, `src/lib/clip-*`). After stabilizing exclusions for generated/config files, add modest changed-file or branch thresholds for critical paths.

## Final Sweep

- No focused `.only` tests were found.
- Conditional skips are intentional but important: admin/origin E2E skips outside CI or without admin env, and CLIP suites skip unless explicitly enabled.
- The prior backup-download chmod flake appears addressed: `apps/web/src/__tests__/backup-download-route.test.ts:154-170` now mocks `createReadStream` failure deterministically instead of relying on filesystem permissions.
- `apps/web/scripts/run-e2e-server.mjs:75-78` runs `init`, `e2e:seed`, and `build` before the Playwright server, so E2E seed setup is part of the normal Playwright path.
- Privacy guard coverage remains strong for public search route field selection: `apps/web/src/__tests__/search-route-privacy.test.ts:42-65` scans the semantic and similar routes for PII columns.
- The biggest recurring test-shape issue is not test volume; it is source-text assertions standing in for behavior around security-sensitive and operational recovery paths.

## Summary

The suite is broad and has useful custom gates, but cycle 12 still has several places where the most important regressions are guarded indirectly. The highest-priority test work is to convert auth-origin and failed-image-retry protections from source-contract assertions into runtime behavior tests. After that, close the visual assertion gap, make production CLIP validation visible in CI, and expand rate-limit scanning to expensive public GET routes.
