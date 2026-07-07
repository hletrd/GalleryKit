# Test-Engineer Review - Cycle 6 Prompt 1

Scope: read-only review for test coverage gaps, flaky tests, missing regression tests, inadequate e2e coverage, and TDD opportunities across `/Users/hletrd/flash-shared/gallery`. No source files were edited.

## Inventory

Docs and workflow:
- `AGENTS.md` / prompt context: quality gates are lint, auth/origin/rate-limit linters, typecheck, build, unit tests, and conditional e2e.
- `CLAUDE.md`: architecture, security, upload, CLIP, schema, and operational test expectations.
- Current HEAD: `d66fb08d` on `master`; pre-existing dirty review artifacts observed in `.context/reviews/critic.md`, `.context/reviews/perf-reviewer.md`, and `.context/reviews/verifier.md`.

Harness:
- Unit command is plain `vitest run` in `apps/web/package.json:13`; `vitest.config.ts` includes only `src/__tests__/**/*.test.{ts,tsx}` and has no coverage provider/thresholds in `apps/web/vitest.config.ts:16-39`.
- Playwright runs one serialized Chromium desktop project in `apps/web/playwright.config.ts:48-87`, specifically one `Desktop Chrome` project in `apps/web/playwright.config.ts:72-76`.
- Inventory count from the filesystem: 257 app TS/TSX source files outside tests, 344 files under `apps/web/src/__tests__`, and 9 e2e specs under `apps/web/e2e`.

Representative tested surfaces:
- Public e2e covers home/search/photo/share/404 flows in `apps/web/e2e/public.spec.ts:4-153` and `apps/web/e2e/not-found-status.spec.ts:14-90`.
- Admin e2e covers login, several navigation links, one GPS-toggle UI flip, topic create/delete, and browser upload in `apps/web/e2e/admin.spec.ts:11-165`.
- Origin e2e covers a concrete admin API cross-origin route in `apps/web/e2e/origin-guard.spec.ts:27-87`.
- Source-contract and unit suites cover many high-risk modules, including LR upload, smart collections, timeline, data privacy, queues, restore, rate limits, and CLIP.

## Findings

### TE-C6-01 - No coverage instrumentation or threshold catches untested critical files

Severity: Medium
Confidence: High

Evidence:
- The web unit script is only `vitest run`, with no `--coverage` or alternate coverage script in `apps/web/package.json:13-27`.
- The Vitest config limits discovery and timeout but defines no `coverage` block or threshold policy in `apps/web/vitest.config.ts:16-39`.
- The repo has broad file-count coverage by convention, but no objective line/branch/function coverage signal over the 257 non-test TS/TSX files inventoried from `apps/web/src`.

Failure scenario:
- A future change can remove the only behavioral test for a critical helper, or add a new untested route/action, and all gates still pass because the harness only checks that existing tests pass. This is most likely to hide gaps in large route/action files where source-contract tests assert strings rather than executed branches.

Concrete test/fix:
- Add a `test:coverage` script using Vitest coverage and start with scoped thresholds for critical directories such as `src/lib`, `src/app/actions`, and `src/app/api`.
- Begin with a ratcheting baseline rather than a disruptive all-repo threshold; require new or changed critical files to have branch coverage or an explicit review waiver.
- TDD opportunity: when fixing any future bug, first add a red regression test and verify coverage for the changed branch increases or stays above the ratchet.

### TE-C6-02 - Public route e2e misses positive map, timeline, year, and smart-collection flows

Severity: Medium
Confidence: High

Evidence:
- Public e2e positive flows visit `/`, search, `/p/[id]`, `/s/[key]`, and `/g/[key]` in `apps/web/e2e/public.spec.ts:4-153`; 404 status tests include invalid `/year` and missing `/c` only in `apps/web/e2e/not-found-status.spec.ts:35-42`.
- No e2e spec positively visits `/map`, `/timeline`, `/year/{year}`, or a public `/c/{slug}` smart collection; `rg` found no `page.goto('/map')`, `page.goto('/timeline')`, or positive `page.goto('/c/...')` calls under `apps/web/e2e`.
- The e2e seed creates a topic, two images, tags, a single share key, and one shared group in `apps/web/scripts/seed-e2e.ts:36-67` and `apps/web/scripts/seed-e2e.ts:217-267`; it does not seed `latitude`/`longitude` or `smartCollections`.
- The unexercised pages have real cross-file behavior: map filters GPS markers and renders `MapLoader` in `apps/web/src/app/[locale]/(public)/map/page.tsx:34-109`; timeline builds year navigation, JSON-LD, truncation notices, and image grids in `apps/web/src/app/[locale]/(public)/timeline/page.tsx:61-220`; smart collection parses stored JSON, compiles it, queries images, and renders `HomeClient` in `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`; year pages render archive sections and JSON-LD in `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:76-220`.

Failure scenario:
- A regression in Leaflet client loading, timeline metadata/JSON-LD nonce wiring, archive grid rendering, or smart-collection page composition can ship with green e2e because only unit/source-contract tests exercise pieces of those flows. A positive `/c/[slug]` 500 caused by query parsing or page composition would not be caught by the current missing-collection 404 test.

Concrete test/fix:
- Extend `seed-e2e.ts` with one GPS-enabled image and one public smart collection that selects the existing `e2e` tag or `e2e-smoke` topic.
- Add Playwright route smokes: `/map` shows the map region or GPS fallback list; `/timeline` shows `2025` and links to `/year/2025`; `/year/2025` renders month sections/photos; `/c/e2e-smart` renders the collection heading and seeded photo.
- TDD opportunity: write the e2e assertions first against the current seed, watch map/smart collection fail because fixtures are absent, then add the minimal seed rows.

### TE-C6-03 - Lightroom PAT upload lacks a real auth-to-upload integration test

Severity: Medium
Confidence: High

Evidence:
- `POST /api/admin/lr/upload` is the external publish-client route and is wrapped with `withAdminAuth` at `apps/web/src/app/api/admin/lr/upload/route.ts:84-85`; it resolves PAT/cookie actor identity in `apps/web/src/app/api/admin/lr/upload/route.ts:86-92` and then performs multipart parsing, quota claims, disk checks, save, DB insert, queue enqueue, audit, and revalidation across `apps/web/src/app/api/admin/lr/upload/route.ts:94-609`.
- The focused behavioral route test mocks `withAdminAuth` to identity in `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:44-47`, so it does not prove a real `X-GalleryKit-Token` reaches the route through the wrapper.
- The broader LR route tests are source-contract oriented and explicitly justify source text checks for the route in `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16`; they assert implementation strings and ordering across `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:38-172`.
- Wrapper behavior is tested separately with mocked token verification in `apps/web/src/__tests__/api-auth-response-headers.test.ts:50-149`, and token generation/verification is tested with mocked DB in `apps/web/src/__tests__/admin-tokens.test.ts:179-323`. No e2e/request test connects token creation, real wrapper scope enforcement, multipart upload, DB row creation, `last_used_at`, and queue-visible processing.

Failure scenario:
- A route integration break can preserve the wrapper source string and keep unit mocks green while real publish clients fail: wrong header name/casing, missing token context, scope drift, no `last_used_at`, malformed multipart handling after auth, or success response without image row/queue enqueue.

Concrete test/fix:
- Add a Playwright `request` or Vitest integration smoke against a seeded disposable DB: create an admin token with `lr:upload`, POST multipart JPEG to `/api/admin/lr/upload` with `X-GalleryKit-Token`, assert 200/201 body, image row `uploaded_by`, token `last_used_at`, and eventual processed state or queue enqueue.
- Also assert a valid `lr:read` token returns 401 without running the handler.
- TDD opportunity: first write the wrong-scope and success-path tests using the real wrapper; then add only the smallest fixture/helpers needed to keep the test deterministic.

### TE-C6-04 - Admin token-management UI is guarded mostly by source contracts, not e2e/component behavior

Severity: Low
Confidence: High

Evidence:
- Admin e2e navigation visits categories, tags, users, password, and DB pages in `apps/web/e2e/admin.spec.ts:20-42`; it does not visit `/admin/tokens`, create a token, copy/acknowledge the plaintext, refresh the list, or revoke a token.
- The token client holds important one-shot UI state: token creation starts at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-104`, copy acknowledgement at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:119-127`, list rendering/revoke entry at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:167-199`, and plaintext display at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:250-280`.
- Current UI regression guards for this page are source-contract checks in `apps/web/src/__tests__/client-source-contracts.test.ts:170-222`, not a browser/component interaction test.
- Action-level tests mock `createToken`, `revokeToken`, `listTokensForUser`, origin guard, and admin auth in `apps/web/src/__tests__/lr-tokens-action.test.ts:16-64`, so they do not prove the hydrated page uses those actions correctly.

Failure scenario:
- The page can regress in ways source text checks miss: dialog does not open, Enter handling bypasses the pending guard, plaintext modal cannot be acknowledged, copy failure leaves the modal stuck, token list retry does not clear an error, or revoke buttons target the wrong token label.

Concrete test/fix:
- Add one admin e2e test that opens `/admin/tokens`, creates a disposable token, verifies the plaintext dialog is shown once, acknowledges/copies it, sees the list row, revokes it, and verifies the row disappears.
- If full e2e mutation is too costly, add a client component test with mocked actions and clipboard for create/copy/revoke/pending flows.

### TE-C6-05 - Nav visual checks save screenshots but do not compare them

Severity: Low
Confidence: High

Evidence:
- `apps/web/e2e/nav-visual-check.spec.ts` computes target size and overlap metrics in `expectVisibleNavTargetsAreStable` at `apps/web/e2e/nav-visual-check.spec.ts:6-37`, which is useful.
- The same suite writes screenshots with `page.screenshot` at `apps/web/e2e/nav-visual-check.spec.ts:58`, `apps/web/e2e/nav-visual-check.spec.ts:72`, and `apps/web/e2e/nav-visual-check.spec.ts:85`.
- It never calls `expect(...).toHaveScreenshot(...)`, so color, spacing, clipping, topic-chip wrapping, and visual hierarchy regressions are artifacts only, not assertions.

Failure scenario:
- A nav layout can remain 44px and non-overlapping while visually degraded, clipped below the fold, low-contrast, or incorrectly themed. The test will pass and merely leave a changed screenshot in `test-results`.

Concrete test/fix:
- Convert these three shots to element-level `await expect(nav).toHaveScreenshot(...)` with stable masks/fonts, or rename the suite to a metrics smoke and add a separate snapshot test for the intended visual contract.

### TE-C6-06 - Opt-in CLIP integration tests still carry a native teardown flake risk

Severity: Low
Confidence: Medium

Evidence:
- The real semantic-ranking test is skipped unless `CLIP_INTEGRATION=1` in `apps/web/src/__tests__/clip-semantic-integration.test.ts:27-80`.
- The offline activation test is skipped unless `CLIP_OFFLINE_LOAD=1` and seeded weights exist in `apps/web/src/__tests__/clip-offline-load.test.ts:32-65`.
- That offline test documents a known native `onnxruntime-node` abort after assertions complete in `apps/web/src/__tests__/clip-offline-load.test.ts:23-25`.

Failure scenario:
- An operator can run the required activation proof, see assertions print expected dims/norm, and still get a worker abort/exit failure after inference. That makes the manual production-readiness gate noisy and risks either ignoring real failures or rerunning until green.

Concrete test/fix:
- Move the real offline-load proof into a child-process harness that treats "assertions completed, then known teardown abort" as a classified result, or isolate the native model session lifecycle if the provider exposes a deterministic cleanup API.
- Keep default CI skipped, but require recorded opt-in evidence whenever CLIP model paths, pinned revision, Transformers version, or production semantic-search activation changes.

## Final Sweep

Checked cross-file behavior and test depth across:
- Test harnesses and gates: `package.json`, `apps/web/package.json`, `vitest.config.ts`, `playwright.config.ts`.
- E2E setup and fixtures: `apps/web/e2e/*.spec.ts`, `apps/web/e2e/helpers.ts`, `apps/web/scripts/seed-e2e.ts`.
- Public route surfaces: home/search/photo/share, map, timeline, year archive, smart collections, 404 status/robots.
- Admin route/action surfaces: login, origin guard, settings, topics, tokens, LR upload.
- Regression-test style: behavioral tests, mocked route tests, source-contract tests, skipped integration tests, visual artifacts.

I did not run the full gate suite because this was a static review task with no source changes. The report itself was citation-checked against current files after writing.
