# Test-Engineer Review - Cycle 7 Lane D

Date: 2026-07-07
HEAD reviewed: `cae5fbd9` (`fix(app): 🐛 fence restore and photo viewer races`)
Mode: read-only review; source was not modified. This artifact is the intended write.

## Inventory

Repository review surface inventoried before findings:
- Harness and gates: `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, lint scripts in `apps/web/scripts/check-*.ts`.
- Current counts: 257 non-test TS/TSX source files under `apps/web/src`, 340 Vitest test files under `apps/web/src/__tests__`, 9 Playwright specs, 79 app route/action/page files, 111 lib files, 29 scripts, 33 migration/meta files.
- Source behavior contracts reviewed: admin API auth, action origin, public route rate limits, LR upload, admin token actions/UI, upload/queue/backfill, privacy field guards, migration/reconcile tests, restore maintenance, semantic search/CLIP, public map/timeline/year/smart-collection pages, nav visual checks.
- Docs/claims reviewed: `AGENTS.md` quality gates/deploy/schema policy and `CLAUDE.md` architecture/security/upload/CLIP/runbook claims.

Fresh validation run:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run lint --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `npm test --workspace=apps/web` passed: 338 files passed, 2 skipped; 3132 tests passed, 4 skipped.

Not run:
- `npm run test:e2e --workspace=apps/web`: the configured local webServer path runs `npm run init` and `npm run e2e:seed`, and `seed-e2e.ts` deletes/replaces seeded DB rows/files; I treated that as outside this read-only lane.
- `npm run build --workspace=apps/web`: `prebuild` generates PWA/service-worker artifacts, so I did not run it in a source-read-only review.
- `npm run deploy`: production/external side effect.

## Findings

### TE-C7-01 - Coverage gate is still pass/fail only; no coverage ratchet protects new critical files

Severity: Medium
Confidence: High
Status: confirmed test adequacy gap
File/region: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`

Evidence: the unit gate is plain `vitest run` (`apps/web/package.json:13`). The Vitest config only includes/excludes tests and sets timeout (`apps/web/vitest.config.ts:16-39`); there is no coverage provider, threshold, or changed-file ratchet. The repo has broad tests, but the gate proves only that existing tests pass, not that new or changed route/action/lib branches are exercised.

Concrete failure scenario: a future critical helper or route branch can be added under `src/lib`, `src/app/actions`, or `src/app/api` with no executed test. Existing source-contract tests and unit suites still pass because no objective coverage threshold detects the untested branch.

Suggested fix: add a non-blocking `test:coverage` baseline first, then ratchet critical directories or changed files. Require either branch/line coverage for new critical code or an explicit waiver in review.

### TE-C7-02 - Public e2e has no positive coverage for map, timeline, year archive, or smart collections

Severity: Medium
Confidence: High
Status: confirmed coverage gap
File/region: `apps/web/e2e/public.spec.ts:4-153`, `apps/web/e2e/not-found-status.spec.ts:35-42`, `apps/web/scripts/seed-e2e.ts:36-67`, `apps/web/scripts/seed-e2e.ts:217-267`

Evidence: public e2e covers home/search/photo/share flows (`public.spec.ts:4-153`) and negative smart-collection/year cases (`not-found-status.spec.ts:35-42`). `rg` found no positive `page.goto('/map')`, `/timeline`, `/year/...`, or `/c/...` tests under `apps/web/e2e`. The e2e seed creates a topic, aliases, two images, tags, one photo share, and one group share (`seed-e2e.ts:36-67`, `217-267`), but no GPS coordinates and no `smartCollections` rows.

Behavior at risk is non-trivial: map filters GPS markers and renders `MapLoader` (`map/page.tsx:34-109`); timeline builds year navigation, grouped months, JSON-LD, and truncation notices (`timeline/page.tsx:61-225`); smart collections parse/compile stored JSON and feed `HomeClient` (`c/[slug]/page.tsx:84-164`); year pages render archive grids and JSON-LD (`year/[year]/page.tsx:76-225`).

Concrete failure scenario: a Leaflet loading regression, timeline JSON-LD/nonce drift, smart-collection query compilation error, or year archive rendering failure can ship with green e2e because only negative 404s or lower-level unit/source-contract tests touch these pages.

Suggested fix: seed one GPS image and one public smart collection selecting the existing `e2e` tag/topic, then add positive Playwright smokes for `/map`, `/timeline`, `/year/2025`, and `/c/<seeded-slug>`.

### TE-C7-03 - LR PAT upload still lacks one real auth-to-upload integration test

Severity: Medium
Confidence: High
Status: confirmed integration gap
File/region: `apps/web/src/app/api/admin/lr/upload/route.ts:84-92`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:44-47`, `apps/web/src/lib/api-auth.ts:72-90`, `apps/web/src/__tests__/api-auth-response-headers.test.ts:50-149`, `apps/web/src/__tests__/admin-tokens.test.ts:181-323`

Evidence: the production route is wrapped with `withAdminAuth` and reads the token context from the wrapper (`route.ts:84-92`). The route behavior test replaces `withAdminAuth` with identity (`lr-upload-route-behavior.test.ts:44-47`). Wrapper behavior is tested separately with mocked token verification (`api-auth-response-headers.test.ts:50-149`), and token verification/persistence is tested with mocked DB (`admin-tokens.test.ts:181-323`). No test connects a real `X-GalleryKit-Token`, scope enforcement, `markTokenUsed`, multipart parsing, image row insert, and queue enqueue in one request path.

Concrete failure scenario: a wrong header name/casing, wrapper context regression, `last_used_at` drift, wrong-scope fallthrough, or multipart route break can keep mocked unit tests green while real Lightroom publish clients fail.

Suggested fix: add a disposable-DB integration test or Playwright `request` smoke that creates an `lr:upload` token, POSTs multipart JPEG to `/api/admin/lr/upload` with `X-GalleryKit-Token`, asserts success/image row/uploaded actor/`last_used_at`/queue visibility, and asserts an `lr:read` token is rejected before handler work.

### TE-C7-04 - Admin token-management UI is mostly source-contract tested, not behavior tested

Severity: Low
Confidence: High
Status: confirmed coverage gap
File/region: `apps/web/e2e/admin.spec.ts:20-42`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-128`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:167-199`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:250-325`, `apps/web/src/__tests__/client-source-contracts.test.ts:170-222`, `apps/web/src/__tests__/lr-tokens-action.test.ts:16-64`

Evidence: admin e2e navigates categories, tags, users, password, and DB pages, but not `/admin/tokens` (`admin.spec.ts:20-42`). The token client has important one-shot/pending flows for create, copy/acknowledge, list, and revoke (`tokens-client.tsx:70-128`, `167-199`, `250-325`). Current UI guards are source-string assertions (`client-source-contracts.test.ts:170-222`) plus mocked server-action tests (`lr-tokens-action.test.ts:16-64`).

Concrete failure scenario: the dialog can fail to open, plaintext can be impossible to acknowledge, copy failure can leave state inconsistent, or revoke can target the wrong row while source strings and mocked action tests still pass.

Suggested fix: add an admin e2e or component test for create -> plaintext shown once -> acknowledge/copy -> list refresh -> revoke -> row removed.

### TE-C7-05 - Nav visual checks save artifacts but do not assert screenshots

Severity: Low
Confidence: High
Status: confirmed assertion weakness
File/region: `apps/web/e2e/nav-visual-check.spec.ts:6-37`, `apps/web/e2e/nav-visual-check.spec.ts:58`, `apps/web/e2e/nav-visual-check.spec.ts:72`, `apps/web/e2e/nav-visual-check.spec.ts:85`

Evidence: the nav e2e does useful metric assertions for 44 px target size and overlap (`nav-visual-check.spec.ts:6-37`), but the visual parts are raw `page.screenshot(...)` writes (`:58`, `:72`, `:85`). There is no `expect(...).toHaveScreenshot(...)`.

Concrete failure scenario: spacing, clipping, contrast, or visual hierarchy can regress while all metric assertions pass; the changed screenshots are artifacts only, not gate failures.

Suggested fix: either convert stable nav regions to `toHaveScreenshot` assertions with masks, or rename the test as a metrics smoke and add a separate visual snapshot gate.

### TE-C7-06 - CLIP activation tests are opt-in and one documents a native teardown flake

Severity: Low
Confidence: Medium
Status: confirmed manual-gate fragility
File/region: `apps/web/src/__tests__/clip-offline-load.test.ts:15-25`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`

Evidence: real CLIP offline load runs only when `CLIP_OFFLINE_LOAD=1` and seeded weights exist (`clip-offline-load.test.ts:15-25`, `32-41`). Semantic ranking runs only with `CLIP_INTEGRATION=1` (`clip-semantic-integration.test.ts:8-10`, `30-31`). The offline-load test documents that `onnxruntime-node` may abort during teardown after assertions (`clip-offline-load.test.ts:23-25`).

Concrete failure scenario: production semantic-search activation depends on a manual run that default CI skips; a native teardown abort can make the result noisy enough that operators either ignore a real failure or rerun until green.

Suggested fix: wrap the real CLIP activation proof in a child-process harness that classifies “assertions completed then known teardown abort” separately from assertion/model-load failure, and require recorded opt-in evidence when CLIP model paths, pinned revisions, Transformers, or semantic production activation changes.

## Final Sweep

Commonly missed areas checked:
- Gate scripts and their fixtures: API auth, action origin, public route rate limits, JS script checking.
- High-risk runtime paths: LR upload, browser upload/queue snapshots, retry/bootstrap/backfill, restore maintenance, admin token issuance/revoke, DB backup/restore, migration reconcile, privacy select fields.
- Public UX/runtime pages: home, photo, share/group, map, timeline, year archive, smart collection, feed/OG/search/similar routes.
- Test quality patterns: source-contract tests, mocked route tests, opt-in integration tests, e2e skip gates, visual artifact-only tests.
- Docs-test alignment: AGENTS/CLAUDE quality gates, CLIP activation runbook, migration/deploy claims.

No new production code defect was confirmed in this lane. The findings above are coverage, integration-proof, and flakiness risks that can allow future regressions through green local gates.
