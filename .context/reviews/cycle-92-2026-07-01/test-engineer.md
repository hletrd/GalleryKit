# Cycle 92 Test-Engineer Review — 2026-07-01

## Scope and method

- Lane: `test-engineer` for cycle 92.
- Instructions read first: `AGENTS.md` and `CLAUDE.md`.
- Constraint honored: this review writes only this report file.
- `omx explore` was attempted first for repo inventory, but failed in this outside-tmux/restricted surface with `failed to initialize in-process app-server client: Operation not permitted`; I fell back to read-only local inspection.
- No test suite was executed because the request was coverage review/report-only and several normal gates generate build/test artifacts (`.next`, screenshots, Playwright output). Evidence below is from source/test/config inspection with exact file:line references.

## Inventory of the current test surface

### Blocking commands and configs

- Root scripts route all quality gates into `apps/web`: `lint`, `typecheck`, `test`, `test:e2e`, and the three custom lint gates (`package.json:11-22`).
- Web scripts define the gate entrypoints: `test` = `vitest run`, `test:e2e` = `env -u NO_COLOR npx playwright test`, security lint gates, and `typecheck:app`/`typecheck:scripts` (`apps/web/package.json:8-27`).
- Vitest discovers only `src/__tests__/**/*.test.{ts,tsx}` and excludes `.next/**`; it also aliases `server-only` to a test stub (`apps/web/vitest.config.ts:4-39`).
- Playwright runs one Chromium project, serially, with one worker (`apps/web/playwright.config.ts:48-86`).
- Typecheck includes test files through `**/*.ts` / `**/*.tsx` and excludes only `node_modules`, `scripts`, and `.next/dev` (`apps/web/tsconfig.typecheck.json:3-17`).
- CI runs lint, typecheck, custom lint gates, unit tests, DB init, Chromium Playwright, then build (`.github/workflows/quality.yml:54-80`).

### Test file inventory

Read-only inventory found:

- 304 Vitest unit/source-contract test files under `apps/web/src/__tests__/`.
- 5 Playwright specs under `apps/web/e2e/`: `admin.spec.ts`, `public.spec.ts`, `origin-guard.spec.ts`, `nav-visual-check.spec.ts`, `test-fixes.spec.ts`.
- 4 custom checker scripts under `apps/web/scripts/`: `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, `check-js-scripts.mjs`.
- Main source surface: `apps/web/src/app` 76 TS/TSX files, `components` 59, `lib` 106, `db` 3, `scripts` 28.

### High-value existing coverage

- Security lint gates have fixture tests and pure scanner exports: admin API auth (`apps/web/scripts/check-api-auth.ts:101-178`, `apps/web/src/__tests__/check-api-auth.test.ts`), server-action origin (`apps/web/scripts/check-action-origin.ts:63-113` and associated tests), and public-route rate limiting (`apps/web/scripts/check-public-route-rate-limit.ts:119-138` and associated tests).
- Privacy guard tests cover sensitive/public field symmetry (`apps/web/src/__tests__/privacy-fields.test.ts`).
- Touch target policy is a dedicated source scanner with extensive pattern coverage and fixture self-tests (`apps/web/src/__tests__/touch-target-audit.test.ts`), matching the 44 px policy in `CLAUDE.md`.
- Image/color/HDR, restore/backfill, rate limiting, migration journal monotonicity, and deployment script contracts all have multiple unit/source tests.

## Confirmed issues

### C92-TE-01 — `/api/health` is the only DB-backed route without an explicit Node runtime pin

- Severity: Medium
- Confidence: High
- Type: missing source-contract/regression test and likely hardening gap

Evidence:

- The health route imports the DB module (`apps/web/src/app/api/health/route.ts:1`) and can execute `db.execute(sql\`SELECT 1\`)` when `HEALTH_CHECK_DB=true` (`apps/web/src/app/api/health/route.ts:19-31`).
- The file declares `dynamic = 'force-dynamic'` (`apps/web/src/app/api/health/route.ts:5`) but has no `export const runtime = 'nodejs'` in the inspected file.
- Other Node-bound public/admin routes are explicitly pinned, e.g. semantic search documents the Node-only imports and exports `runtime = 'nodejs'` (`apps/web/src/app/api/search/semantic/route.ts:60-65`), similar search does the same (`apps/web/src/app/api/search/similar/[id]/route.ts:50-53`), LR upload does the same (`apps/web/src/app/api/admin/lr/upload/route.ts:76-82`), and backup download does the same (`apps/web/src/app/api/admin/db/download/route.ts:16-19`).
- Existing health tests assert behavior but not runtime pinning (`apps/web/src/__tests__/health-route.test.ts:21-70`).

Risk:

- Today this is mostly convention/hardening because App Router defaults to Node unless changed, but this repo has deliberately pinned other mysql2/Sharp/filesystem/rate-limit routes to avoid silent Edge-runtime drift. Health is the one confirmed outlier from the route-runtime sweep.

TDD opportunity:

- Add a small source-contract test that every `route.*` importing `@/db`, `mysql`, `sharp`, `fs`, `ImageResponse`, or `serveUploadFile` exports `runtime = 'nodejs'`; then pin `/api/health` if accepted.

---

### C92-TE-02 — Lightroom/PAT upload route still lacks route-level behavioral tests for success and main rejection paths

- Severity: Medium
- Confidence: High
- Type: missing regression test

Evidence:

- The route is a large token-authenticated multipart handler with quota, multipart-parse, metadata, topic, restore-maintenance, DB insert, queue, audit, and cleanup behavior (`apps/web/src/app/api/admin/lr/upload/route.ts:84-593`). Representative branches include content-length/quota gates (`apps/web/src/app/api/admin/lr/upload/route.ts:101-158`), multipart/file/topic validation (`apps/web/src/app/api/admin/lr/upload/route.ts:178-219`), and token context usage (`apps/web/src/app/api/admin/lr/upload/route.ts:86-91`).
- Existing LR tests explicitly state they are source-text contracts because the route is heavy to exercise (`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15`) and load the route as text (`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:22-25`).
- The same source-contract file checks many important invariants by regex/order only, e.g. auth wrapper scope (`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:63-66`), file-size-before-save (`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:304-310`), tracker settlement (`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:312-319`), and containment cleanup (`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:448-487`).
- No Playwright spec hits `/api/admin/lr/upload`; the E2E route literal inventory only hits `/api/admin/db/download` for admin API origin-guard coverage (`apps/web/e2e/origin-guard.spec.ts:39-72`).

Risk:

- Source-contract tests can prove a string/order shape, but they do not prove that a real `NextRequest` with `FormData` returns the expected JSON/status, settles quota exactly once, deletes originals on failure, or enqueues exactly the browser-parity processing snapshot.

TDD opportunity:

- Add route-level unit tests that mock `withAdminAuth`/DB/process-image/image-queue and call `POST` with synthetic `NextRequest` bodies for at least: successful PAT upload, missing file, invalid topic, HDR reject, post-save insert failure cleanup, and parsed-file over max size.

---

### C92-TE-03 — `OptimisticImage` retry/fallback state machine has no direct behavior test

- Severity: Medium
- Confidence: High
- Type: missing regression test / flaky-risk reducer

Evidence:

- `OptimisticImage` remounts on `src` changes (`apps/web/src/components/optimistic-image.tsx:13-16`) and carries non-trivial state: `imgSrc`, loading/error flags, `retryCount`, `retryCountRef`, and a retry timer (`apps/web/src/components/optimistic-image.tsx:18-28`).
- Error handling has multiple important branches: one-shot fallback source (`apps/web/src/components/optimistic-image.tsx:30-37`), local-upload vs remote retry caps (`apps/web/src/components/optimistic-image.tsx:39-42`), exponential retry query-string mutation (`apps/web/src/components/optimistic-image.tsx:43-49`), and final unavailable UI (`apps/web/src/components/optimistic-image.tsx:50-79`).
- It is used on public masonry cards (`apps/web/src/components/home-client.tsx:370-384`), admin image thumbnails (`apps/web/src/components/image-manager.tsx:473-479`), and the On This Day widget (`apps/web/src/components/on-this-day-widget.tsx:65-74`).
- Inventory search found production references but no direct `apps/web/src/__tests__` behavior test for `OptimisticImage`.

Risk:

- Retry/timer behavior can regress while static scans and most E2E smoke tests still pass, especially if a CDN derivative 404s or a legacy photo needs fallback behavior.

TDD opportunity:

- Add a tiny behavior harness (Playwright page-level fixture or a React/jsdom test harness if the repo adopts one) with fake timers for: fallbackSrc swap, local `/uploads/` retry cap of 1, remote retry cap of 5, query separator behavior, unmount timer cleanup, and final `imageUnavailable` status.

---

### C92-TE-04 — Admin E2E navigation does not smoke every first-class admin page

- Severity: Medium
- Confidence: High
- Type: coverage gap

Evidence:

- Admin navigation exposes Dashboard, Categories, Tags, SEO, Settings, Tokens, Password, Users, DB, and Analytics (`apps/web/src/components/admin-nav.tsx:15-25`).
- The main admin navigation E2E clicks Categories, Tags, Users, Password, and DB only (`apps/web/e2e/admin.spec.ts:20-43`). A separate GPS test clicks Settings (`apps/web/e2e/admin.spec.ts:73-80`).
- The E2E route literal sweep found no `/admin/seo`, `/admin/tokens`, or `/admin/analytics` navigation in `apps/web/e2e/*.spec.ts`.
- Tokens and analytics do have unit/source contracts, but not a hydrated admin-page smoke. Example tokens page/client exists (`apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx:11-24`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:22-45`).

Risk:

- Build/typecheck catch many failures, but not all runtime data/hydration/translation regressions on these protected pages. Tokens in particular are security/operator-facing and historically source-contract-heavy.

TDD opportunity:

- Extend `admin login and navigation workflows work` to iterate every `AdminNav` link and assert a low-cost page landmark/table/form/status for SEO, Settings, Tokens, Analytics, plus the existing pages.

---

### C92-TE-05 — Admin GPS-toggle E2E mutates a persistent setting without `try/finally` cleanup

- Severity: Medium
- Confidence: High
- Type: flaky-test / environment-pollution risk

Evidence:

- The settings test reads the initial `data-state` (`apps/web/e2e/admin.spec.ts:79-83`), clicks the GPS toggle (`apps/web/e2e/admin.spec.ts:89-92`), then clicks again to restore (`apps/web/e2e/admin.spec.ts:94-97`).
- The restoration is not inside a `finally`; if the assertion after the first click fails, or if the browser/page errors before the second click, the seeded DB can be left with the opposite `strip_gps_on_upload` setting.
- The test itself acknowledges the cleanup intent: “Flip it back so we don't leave the seeded environment mutated” (`apps/web/e2e/admin.spec.ts:94`).

Risk:

- A failed run can change later upload behavior in the same local/remote environment, producing non-obvious follow-on failures or local state drift.

TDD opportunity:

- Wrap the post-click assertions in `try/finally` and always restore when the first flip succeeds. Optionally verify the final state after cleanup.

---

### C92-TE-06 — No coverage instrumentation or threshold exists for the large unit suite

- Severity: Low
- Confidence: High
- Type: coverage-governance gap

Evidence:

- `npm test --workspace=apps/web` runs only `vitest run` (`apps/web/package.json:13`).
- Vitest config declares include/exclude and timeout, but no coverage provider, reporters, or thresholds (`apps/web/vitest.config.ts:16-39`).
- The repo has a very broad source surface (76 app files, 59 components, 106 lib files by inventory) and 304 test files, but no automated minimum line/branch/function threshold.

Risk:

- Reviewers can add or remove tests without a quantitative signal. Given the repo's reliance on source-contract tests, a coverage report would not replace review, but it would expose newly unexercised modules and branch-heavy helpers.

TDD opportunity:

- Add an opt-in `test:coverage` script first. If useful and stable, graduate to modest per-file or changed-file thresholds rather than one brittle global threshold.

## Likely issues / coverage gaps

### C92-TE-L1 — Public route E2E does not smoke map, timeline/year, smart collections, or ordinary topic pages

- Severity: Medium
- Confidence: Medium-High
- Type: likely missing E2E regression coverage

Evidence:

- Current public E2E covers home, search dialog, first photo/lightbox, heading hierarchy, 404, single-photo share, and shared-group navigation (`apps/web/e2e/public.spec.ts:4-153`).
- The route literal sweep found no Playwright navigation to `/map`, `/timeline`, `/year/...`, `/c/...`, or a normal topic page.
- These routes have real server/client work: map page loads map data/config and a dynamic client map (`apps/web/src/app/[locale]/(public)/map/page.tsx:42-91`), timeline loads years/config/SEO/CSP (`apps/web/src/app/[locale]/(public)/timeline/page.tsx:61-80`), year pages load grouped review images/config/SEO/CSP (`apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:74-103`), and smart collections parse/compile dynamic collection queries before rendering (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-123`).
- Map has source/data tests for thumbnail wiring and GPS visibility (`apps/web/src/__tests__/map-thumb-wiring.test.ts:34-84`, `apps/web/src/__tests__/map-get-images-behavior.test.ts:73-130`), but no browser smoke of the Leaflet chunk.

Risk:

- Source/data tests can miss missing chunks, CSS/runtime issues, route-level translations, dynamic import breakage, and real browser accessibility regressions.

TDD opportunity:

- Seed one public smart collection and at least one map-visible GPS photo in `seed-e2e.ts`; add low-cost E2E smoke for `/map`, `/timeline`, `/year/<seed-year>`, `/c/<seed-slug>`, and `/e2e-smoke`.

---

### C92-TE-L2 — PWA installability contracts stop short of manifest/static-icon/SW-registration parity

- Severity: Low
- Confidence: Medium-High
- Type: likely missing source-contract tests

Evidence:

- Manifest advertises dynamic `/icon`, `/apple-icon`, and generated static icons `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png` (`apps/web/src/app/manifest.ts:24-50`).
- The prebuild icon generator writes exactly those three static files (`apps/web/scripts/generate-pwa-icons.ts:61-75`).
- Dynamic icon routes define size/content-type and render `ImageResponse` (`apps/web/src/app/icon.tsx:4-13`, `apps/web/src/app/apple-icon.tsx:4-11`).
- Root layout renders service-worker registration (`apps/web/src/app/[locale]/layout.tsx:145`), and the registration component only registers in production with scope `/` (`apps/web/src/components/register-service-worker.tsx:13-20`).
- Existing SW tests focus on the service-worker template/cache semantics; the only test reference to `/icons/icon-192.png` is a cache-classification negative (`apps/web/src/__tests__/sw-cache.test.ts:107-109`).

Risk:

- A future manifest/icon/generator drift could hurt installability without failing unit tests. A future change could also drop or broaden SW registration without a direct test.

TDD opportunity:

- Add source-contract tests that manifest icon entries match generator output names/sizes, dynamic icon routes export expected `size`/`contentType`, and root layout still renders `RegisterServiceWorker` with production-only registration semantics.

---

### C92-TE-L3 — E2E upload cleanup is partial when the row never becomes visible

- Severity: Low
- Confidence: Medium
- Type: likely flaky-test / environment-pollution risk

Evidence:

- Upload E2E creates a unique filename (`apps/web/e2e/admin.spec.ts:135-143`) and defines the row locator (`apps/web/e2e/admin.spec.ts:146`).
- Cleanup runs in `finally`, but only if `uploadedRow.isVisible()` is true (`apps/web/e2e/admin.spec.ts:153-158`).
- If the upload succeeds server-side but the row assertion fails because the table/UI did not refresh or a locator changed, the created DB row/files can remain.

Risk:

- Low collision risk because the filename includes `Date.now()`, but local/remote E2E environments can accumulate uploaded rows/files after failed runs.

TDD opportunity:

- Add a helper cleanup path that can delete by unique `user_filename` through an authenticated API/action or direct disposable-DB helper, even when the row is not visible.

## Manual-validation risks

### C92-TE-M1 — Browser matrix is narrower than the product's color/HDR/browser-risk surface

- Severity: Medium
- Confidence: High
- Type: manual-validation risk

Evidence:

- Playwright config defines only one project: Desktop Chrome (`apps/web/playwright.config.ts:72-76`).
- The same config serializes all E2E through one worker (`apps/web/playwright.config.ts:50-59`).
- Display capability logic is explicitly browser-specific: `screen.colorGamut`, `matchMedia('(color-gamut: ...)')`, Firefox fallback, HDR media query, focus/visibility changes (`apps/web/src/lib/use-display-capability.ts:4-25`, `apps/web/src/lib/use-display-capability.ts:49-115`). Unit tests mock these APIs rather than running real browsers (`apps/web/src/__tests__/use-display-capability.test.ts:1-14`).

Risk:

- Safari/WebKit, Firefox, mobile viewport/browser chrome, and real HDR/P3 display behavior remain manual. This is acceptable for a self-hosted gallery if documented, but it should not be mistaken for automated browser-matrix proof.

TDD opportunity:

- Add a small non-blocking/manual Playwright project matrix (`webkit`, mobile Chromium, optionally Firefox) for nav/photo/lightbox/color-hint smoke, with clear opt-in if CI cost is too high.

---

### C92-TE-M2 — Visual checks capture screenshots but do not compare to baselines

- Severity: Low
- Confidence: High
- Type: manual-validation risk

Evidence:

- `nav-visual-check.spec.ts` asserts visible nav targets are at least 44x44 and non-overlapping (`apps/web/e2e/nav-visual-check.spec.ts:6-37`).
- The tests then write screenshots for collapsed mobile, expanded mobile, and desktop (`apps/web/e2e/nav-visual-check.spec.ts:51`, `apps/web/e2e/nav-visual-check.spec.ts:65`, `apps/web/e2e/nav-visual-check.spec.ts:78`).
- There is no `toHaveScreenshot` or baseline comparison in that spec.

Risk:

- Gross target/overlap regressions are covered, but spacing, visual hierarchy, color, and screenshot-diff regressions are manual.

TDD opportunity:

- If visual stability is desired, convert one or two high-value views to Playwright `toHaveScreenshot` baselines or keep the current artifact-only approach but label it as manual evidence.

---

### C92-TE-M3 — Real CLIP semantic/production activation tests are opt-in and skipped by default CI

- Severity: Medium
- Confidence: High
- Type: manual-validation risk

Evidence:

- Real semantic ranking test is gated by `CLIP_INTEGRATION=1`; default CI without model weights skips the suite (`apps/web/src/__tests__/clip-semantic-integration.test.ts:8-9`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`).
- Offline production load test is gated by `CLIP_OFFLINE_LOAD=1` and a pre-seeded `CLIP_MODELS_ROOT` (`apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`).
- CI env in the quality workflow does not set those CLIP flags or seed model weights (`.github/workflows/quality.yml:27-37`).

Risk:

- Default CI proves gates, stubs, limits, and source contracts, but not real model loading or semantic quality. This matches the operator-enabled CLIP model posture, but production activation still needs an explicit manual/periodic validation lane.

TDD opportunity:

- Add a scheduled/manual CI job with cached model weights, or a documented pre-deploy operator check that runs the two gated CLIP suites before enabling production semantic search.

## Final missed-issue sweep

Performed read-only sweeps after the initial findings pass:

1. `rg` for skipped/gated tests found only the known admin E2E skips and the two CLIP opt-in suites (`apps/web/e2e/admin.spec.ts:7-12`, `apps/web/e2e/origin-guard.spec.ts:29-77`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`, `apps/web/src/__tests__/clip-offline-load.test.ts:41`).
2. Route-runtime sweep over `apps/web/src/app/**/route.*` found exactly one Node-ish/DB route without `runtime = 'nodejs'`: `/api/health`.
3. E2E route-literal sweep confirmed no Playwright navigation to `/map`, `/timeline`, `/year/...`, `/c/...`, `/admin/seo`, `/admin/tokens`, `/admin/analytics`, or `/api/admin/lr/upload`.
4. Direct source-reference inventory flagged a small set of production files with no direct unit-test import; the only ones I considered materially risky are covered above (`OptimisticImage`, PWA registration/icons). Several others are intentionally trivial wrappers or indirectly/source-contract covered.
5. No destructive or write-producing validation commands were run; the only intended repository write is this report.

## Recommended next TDD queue

1. **P1:** Add route-runtime source-contract and pin `/api/health` to Node runtime if accepted.
2. **P1:** Add route-level mocked behavior tests for `/api/admin/lr/upload` main success/reject/cleanup paths.
3. **P1:** Make the admin GPS toggle E2E cleanup `try/finally` and expand admin nav smoke to SEO/Tokens/Analytics.
4. **P2:** Add behavior coverage for `OptimisticImage` retry/fallback state.
5. **P2:** Add E2E smokes for map/timeline/year/smart-collection/topic public routes.
6. **P3:** Add PWA manifest/icon/SW-registration source contracts.
7. **Manual/periodic:** Run CLIP real integration/offline-load tests and a small WebKit/mobile browser smoke before claiming production semantic/color-browser confidence.
