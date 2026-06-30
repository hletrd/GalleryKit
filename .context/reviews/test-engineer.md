# Cycle 30 Test-Engineer Review

Role: test-engineer  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `666b74f8`  
Date: 2026-06-30  
Scope: Prompt 1 review only. No product fixes implemented.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Inventoried current HEAD surfaces:

- Quality gates: root/app `package.json`, `.github/workflows/quality.yml`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`.
- Custom lint gates: `apps/web/scripts/check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, and their fixture suites.
- Unit tests: `apps/web/src/__tests__/` including privacy, migration, semantic search, route-rate-limit, touch-target, and source-contract tests.
- E2E tests and harness: `apps/web/e2e/*.spec.ts`, `apps/web/e2e/helpers.ts`, `apps/web/scripts/run-e2e-server.mjs`, `apps/web/scripts/seed-e2e.ts`.
- DB/migrations: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`.
- Public/app surfaces relevant to coverage: route handlers, map/timeline/year/smart-collection pages, semantic/similar search, CLIP model tests, nav visual tests.

Fresh validation:

```text
npm run lint:api-auth --workspace=apps/web                 PASS
npm run lint:action-origin --workspace=apps/web             PASS
npm run lint:public-route-rate-limit --workspace=apps/web   PASS

npm test --workspace=apps/web -- \
  map-privacy.test.ts semantic-search-route.test.ts \
  check-public-route-rate-limit.test.ts \
  migration-journal-monotonicity.test.ts migration-journal.test.ts \
  migrate-reconcile-coverage.test.ts

PASS: 6 files, 149 tests
```

I did not run full Playwright E2E because the local harness intentionally runs `seed-e2e.ts`, which deletes/recreates E2E rows and upload fixtures in the configured disposable DB/filesystem.

## Confirmed Issues

### C30-TE-01 - `/map` GPS privacy still lacks a behavior test of `getMapImages()`

Severity: High  
Confidence: High  
Status: Confirmed test-quality gap

Evidence:

- Production code exposing public GPS data is `getMapImages()` in `apps/web/src/lib/data.ts:1660-1697`.
- `/map` calls that function and serializes markers to the client in `apps/web/src/app/[locale]/(public)/map/page.tsx:41-60`.
- `apps/web/src/__tests__/map-privacy.test.ts:82-152` now source-checks the query text and uses fake rows for the runtime guard, but it still does not import or execute `getMapImages()`.

Failure scenario:

A refactor preserves the checked strings while changing execution shape, for example by moving the unsafe query into a helper, weakening the actual returned row mapping, or breaking the guard path. The source-contract test passes, while public `/map` can expose GPS markers for a hidden topic or skip the runtime leak guard.

Suggested fix:

Add a direct behavior test around `getMapImages()`. Either mock the `@/db` chain and assert the live function builds/consumes a hidden-topic row by throwing, or seed a disposable DB with one `map_visible=true` GPS image and one `map_visible=false` GPS image and assert only the visible marker is returned. Keep the current source contract as a secondary tripwire, not the only proof.

### C30-TE-02 - Real CLIP activation tests are skipped by default CI

Severity: Medium  
Confidence: High  
Status: Confirmed coverage gap with operational constraints

Evidence:

- `apps/web/src/__tests__/clip-offline-load.test.ts:15-41` runs only when `CLIP_OFFLINE_LOAD=1` and a seeded `CLIP_MODELS_ROOT` exists.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31` runs only when `CLIP_INTEGRATION=1`.
- CI runs plain `npm test` without seeded model weights or either flag in `.github/workflows/quality.yml:66-67`.
- The production runbook depends on the exact seeded-weight/offline-load path documented in `CLAUDE.md:500-559`.

Failure scenario:

A dependency update, model-manifest drift, ONNX runtime packaging issue, or path-resolution regression breaks production CLIP loading. Normal PR CI still passes because the only tests that load the real encoder are skipped.

Suggested fix:

Add a scheduled or release-blocking workflow with a cached seeded model directory:

```text
CLIP_OFFLINE_LOAD=1 CLIP_INTEGRATION=1 CLIP_MODELS_ROOT=<cache> \
  npm test --workspace=apps/web -- \
  src/__tests__/clip-offline-load.test.ts \
  src/__tests__/clip-semantic-integration.test.ts
```

If model weights are too large for PR CI, document this as required manual evidence before enabling production semantic search.

### C30-TE-03 - Important public pages have no browser smoke path

Severity: Medium  
Confidence: High  
Status: Confirmed coverage gap

Evidence:

- E2E covers home/search/photo/share/nav/admin upload/topic creation in `apps/web/e2e/public.spec.ts`, `test-fixes.spec.ts`, and `admin.spec.ts`.
- No E2E spec visits `/map`, `/timeline`, `/year/[year]`, or `/c/[slug]`; grep found only unit/source-contract tests for those surfaces.
- The pages are real dynamic public routes: `apps/web/src/app/[locale]/(public)/map/page.tsx:12-104`, `timeline/page.tsx:19`, `year/[year]/page.tsx:20`, `c/[slug]/page.tsx:17`.

Failure scenario:

A Next route, dynamic import, translation key, metadata path, or hydration regression breaks a public archive/map/smart-collection page. Unit/source-contract tests pass, and Chromium E2E never loads the route.

Suggested fix:

Extend `seed-e2e.ts` with one visible GPS marker and one public smart collection, then add cheap browser smokes for `/map`, `/timeline`, `/year/2025`, and `/c/<slug>` asserting no Next error, one H1, and primary content. Keep assertions shallow.

### C30-TE-04 - Nav "visual" tests save screenshots but do not compare baselines

Severity: Low  
Confidence: High  
Status: Confirmed test-quality gap

Evidence:

- `apps/web/e2e/nav-visual-check.spec.ts:40-79` asserts visibility, target size, and overlap geometry.
- It writes screenshots at `apps/web/e2e/nav-visual-check.spec.ts:51`, `:65`, and `:78`.
- It never calls `expect(page).toHaveScreenshot(...)` or compares committed baselines.

Failure scenario:

A CSS change keeps controls non-overlapping and at least 44 px, but clips icons, breaks contrast, shifts spacing, or corrupts the expanded mobile menu. The test passes; only an unreviewed artifact changes.

Suggested fix:

Either convert these to Playwright screenshot assertions with stable masks/thresholds, or rename/document them as artifact-only geometry smokes and assign actual visual comparison to a separate manual/visual gate.

## Risks Needing Manual Validation

### C30-TE-05 - E2E browser matrix is desktop Chromium only

Severity: Medium  
Confidence: High  
Status: Manual-validation risk

Evidence:

- Playwright config defines one project, `chromium`, using `Desktop Chrome`: `apps/web/playwright.config.ts:72-77`.
- CI installs only Chromium in `.github/workflows/quality.yml:72-77`.
- Color/HDR, dialog focus, service-worker, responsive nav, and photo-viewer behavior are browser-sensitive surfaces.

Failure scenario:

A Safari/WebKit-specific regression in picture source selection, P3/HDR detection, focus trapping, or mobile layout ships with green CI.

Suggested fix:

Add a small serialized WebKit public-smoke project: home, first photo, lightbox open/close, search dialog focus, and one display-capability/hint path with media features mocked where practical. Keep admin flows Chromium-only unless admin accounts are isolated by project.

## Likely Issues

No additional likely test defects were promoted beyond the confirmed gaps above. Two cycle-29 concerns are now fixed in current HEAD: expensive public GET route scanning exists and has fixture tests, and semantic stub ranking now has a formula-distinguishing behavior test.

## Non-Findings

- No `test.only`, `describe.only`, or `it.only` markers found.
- Custom auth/action/public-rate-limit gates passed on current HEAD.
- Expensive public GET scanning is active: `api/og`, per-photo OG, and similar-image GET routes passed via rate-limit-helper detection.
- Migration journal/reconcile tripwires passed; the known historical `when` inversion is documented and guarded against new stale entries.
- Semantic search route ordering now distinguishes cosine from dot product in `semantic-search-route.test.ts:408-475`.

## Final Sweep / Skipped Areas

Final sweep covered test configs, CI, route/gate tests, migration tests, CLIP gated suites, E2E harness, map/timeline/smart-collection coverage, and current docs tied to test gates. Full unit suite, full build/typecheck, and Playwright were not run in this Prompt 1 review; targeted tests and static inspection were used instead.
