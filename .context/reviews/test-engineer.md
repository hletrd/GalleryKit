# Cycle 29 Test-Engineer Review

Role: test-engineer  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `b4fa1f64`  
Date: 2026-06-30  
Scope: Prompt 1 review only. No product code changes.

## Inventory

Read first, per instruction: `AGENTS.md` and `CLAUDE.md`.

Inventoried:

- Quality policy and architecture context: `AGENTS.md`, `CLAUDE.md`.
- CI and package gates: `.github/workflows/quality.yml`, root `package.json`, `apps/web/package.json`.
- Test configs: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`.
- Custom lint gates and fixtures: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, plus their `src/__tests__/check-*.test.ts` coverage.
- Unit tests: 274 Vitest files under `apps/web/src/__tests__/`.
- E2E tests and harness: 5 Playwright specs under `apps/web/e2e/`, `apps/web/e2e/helpers.ts`, `apps/web/scripts/run-e2e-server.mjs`, `apps/web/scripts/seed-e2e.ts`.
- App source: 516 TS/TSX files under `apps/web/src`; 12 App Router route handler files; 29 app scripts; Drizzle migrations and journal.
- Fixtures: CLIP image fixtures under `apps/web/src/__tests__/fixtures/clip/`, E2E JPEG fixtures under `apps/web/e2e/fixtures/`, translation fixtures in `apps/web/messages/`.

Fresh validation run:

```text
npm run lint:api-auth --workspace=apps/web                 PASS
npm run lint:action-origin --workspace=apps/web             PASS
npm run lint:public-route-rate-limit --workspace=apps/web   PASS
npm test --workspace=apps/web                               PASS
Vitest: 272 passed, 2 skipped test files; 2539 passed, 4 skipped tests
```

I did not run `npm run test:e2e --workspace=apps/web`: the local Playwright server path runs `scripts/seed-e2e.ts`, which deliberately deletes/recreates E2E rows and upload files in the configured disposable DB/filesystem. For this review-only prompt, I inspected the E2E coverage statically and treated browser-flow gaps as risks.

## Findings

### C29-TE-01 - `/map` GPS privacy query is not behavior-tested; the test reimplements the guard

Severity: High  
Confidence: High  
Status: Confirmed test-quality gap

Evidence:

- `getMapImages()` is the only public path that exposes latitude/longitude and depends on both SQL filtering and a runtime guard: `apps/web/src/lib/data.ts:1660-1696`.
- The `/map` page calls `getMapImages()` and passes marker data to the client: `apps/web/src/app/[locale]/(public)/map/page.tsx:37-56`.
- `apps/web/src/__tests__/map-privacy.test.ts:80-130` says it covers the `getMapImages` predicate, but it does not import or execute `getMapImages()`. It loops over local `fakeRows` and filters local `allTopics`, so the assertions would still pass if the real query dropped `eq(topics.map_visible, true)`, changed the join, removed `isNotNull(images.latitude)`, or stopped throwing on `topic_map_visible=false`.

Failure scenario:

A refactor changes `getMapImages()` from the current inner join and `topics.map_visible=true` predicate to a broader query, or accidentally removes the runtime guard. Public `/map` can expose GPS markers for hidden topics. The current test continues to pass because it tests a copied miniature of the intended logic, not the production query or function.

Suggested test/fix:

Add a behavior test that mocks `@/db`'s query chain and invokes `getMapImages()` directly. Assert the built query reaches `.innerJoin(topics, ...)`, includes `eq(topics.map_visible, true)`, includes both GPS `isNotNull` predicates, applies `MAP_MAX_MARKERS`, and throws when the mocked returned row has `topic_map_visible: false`. A higher-value integration version would seed one visible-topic GPS image and one hidden-topic GPS image in a disposable DB and assert only the visible marker returns.

### C29-TE-02 - Stub semantic ranking still lacks a dot-product-vs-cosine behavior lock

Severity: Medium  
Confidence: High  
Status: Confirmed test-quality gap

Evidence:

- The route deliberately chooses `dotProduct` only for production and `cosineSimilarity` for stub mode: `apps/web/src/app/api/search/semantic/route.ts:296-302`.
- The source-contract file admits the gap: `apps/web/src/__tests__/semantic-similarity-selector-contract.test.ts:17-22` says no behavioral test pins the selector.
- The happy-path semantic test uses identical uniform vectors: `apps/web/src/__tests__/semantic-search-route.test.ts:384-405`; dot product and cosine both produce the same winner.
- The newer ordering test still uses unit-length candidate vectors, so dot product and cosine produce the same order: `apps/web/src/__tests__/semantic-search-route.test.ts:408-471`.

Failure scenario:

A contributor simplifies the selector to unconditional `dotProduct` for performance. Stub-mode rankings become magnitude-biased and return the wrong photo order, but existing behavior tests can stay green because their vectors do not distinguish the two formulas. Only the regex source contract catches the exact current syntax.

Suggested test/fix:

Add a failing-first behavior test in `semantic-search-route.test.ts` with non-normalized stub vectors where cosine and dot product produce opposite rankings. Example: query `[1, 0]`, candidate A `[2, 0]`, candidate B `[1, 100]` or another pair selected so the wrong formula changes the first result. Assert stub mode returns the cosine winner. Keep the source contract as a secondary documentation guard.

### C29-TE-03 - Real CLIP activation tests are skipped by default CI

Severity: Medium  
Confidence: High  
Status: Confirmed coverage gap with operational constraints

Evidence:

- `clip-offline-load.test.ts` only runs when `CLIP_OFFLINE_LOAD=1` and a seeded `CLIP_MODELS_ROOT` exists: `apps/web/src/__tests__/clip-offline-load.test.ts:15-21`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`.
- `clip-semantic-integration.test.ts` only runs when `CLIP_INTEGRATION=1`: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`.
- CI runs plain `npm test` with no CLIP env or seeded model cache: `.github/workflows/quality.yml:27-37`, `.github/workflows/quality.yml:66-67`.
- The fresh unit run skipped exactly those two test files: 2 skipped files / 4 skipped tests.

Failure scenario:

A package update, model-path change, ONNX runtime issue, or `allowRemoteModels=false` regression breaks production CLIP loading. Normal PR CI, typecheck, build, and E2E stay green because the only tests that load the real encoder are skipped.

Suggested test/fix:

Add a scheduled or manually triggered CI job with a cached seeded model directory:

```text
CLIP_OFFLINE_LOAD=1 CLIP_INTEGRATION=1 CLIP_MODELS_ROOT=<cache> \
  npm test --workspace=apps/web -- \
  src/__tests__/clip-offline-load.test.ts \
  src/__tests__/clip-semantic-integration.test.ts
```

If model weights are too large for PR CI, make this a nightly or release-blocking workflow and document it as required evidence before enabling production semantic search.

### C29-TE-04 - Public GET rate-limit coverage relies on manual route-specific tests, not the gate

Severity: Medium  
Confidence: High  
Status: Confirmed gate blind spot / future risk

Evidence:

- The public route gate explicitly scans only `POST`, `PUT`, `PATCH`, and `DELETE`: `apps/web/scripts/check-public-route-rate-limit.ts:1-12`, `apps/web/scripts/check-public-route-rate-limit.ts:36`.
- GET-only route files are reported as OK with "no mutating handlers": `apps/web/scripts/check-public-route-rate-limit.ts:344-346`.
- The fresh gate output passed `api/og/photo/[id]`, `api/og`, and `api/search/similar/[id]` through that GET-only path.
- Current expensive GET routes do have bespoke rate-limit tests, for example OG at `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:47-74` and similar-image search at `apps/web/src/__tests__/similar-route.test.ts:236-244`.

Failure scenario:

A future public `GET` route performs DB, Sharp, `ImageResponse`, embedding, or filesystem work and ships without a limiter. `npm run lint:public-route-rate-limit` still passes it as "no mutating handlers" unless a reviewer manually notices and adds a bespoke test.

Suggested test/fix:

Add a second GET audit gate or extend the existing gate conservatively: public API `GET` handlers importing DB/data helpers, `ImageResponse`, Sharp, embedding helpers, OG helpers, or filesystem access must call an approved pre-increment limiter or carry a reasoned exemption. Add fixture tests proving a DB-backed GET without a limiter fails and `/api/health`/`/api/live` can be explicitly exempt.

### C29-TE-05 - E2E browser matrix is desktop Chromium only

Severity: Medium  
Confidence: High  
Status: Risk / manual-validation gap

Evidence:

- Playwright config defines one project, `chromium`, using `Desktop Chrome`: `apps/web/playwright.config.ts:72-77`.
- CI installs only Chromium: `.github/workflows/quality.yml:72-77`.
- The product has browser-sensitive display, color, HDR, service-worker, focus, and responsive behavior documented in `CLAUDE.md`; unit tests cover helpers, but no WebKit/mobile-engine smoke runs in CI.

Failure scenario:

A photo-viewer, picture-source, dialog focus, service-worker, or wide-gamut hint change works in Chromium but fails in Safari/WebKit, the most important engine for P3/HDR viewing. CI stays green.

Suggested test/fix:

Add a small serialized WebKit project for public smoke only: home, first photo, lightbox open/close, search dialog focus, and one display-capability/hint path with media features mocked where practical. Keep admin flows Chromium-only unless the suite gets isolated admin accounts per worker/project.

### C29-TE-06 - Important public pages have no browser smoke path

Severity: Low  
Confidence: High  
Status: Confirmed coverage gap

Evidence:

- E2E currently covers home/search/photo/share/nav/admin upload and topic creation: `apps/web/e2e/public.spec.ts:4-150`, `apps/web/e2e/test-fixes.spec.ts:16-75`, `apps/web/e2e/admin.spec.ts:14-174`.
- A final grep found no E2E mention of `/map`, `/timeline`, `/year/`, or `/c/`.
- Those pages are real public DB-backed routes: `apps/web/src/app/[locale]/(public)/map/page.tsx:29-100`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`, and `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`.
- Some logic is unit/source-contract covered, but that does not prove the production-built page renders, hydrates dynamic chunks, or preserves route metadata/accessibility in a browser.

Failure scenario:

A Next.js route, dynamic import, translation key, or hydration regression breaks `/map`, `/timeline`, `/year/2025`, or `/c/<slug>`. Unit/source-contract tests pass, and Chromium E2E never visits the route.

Suggested test/fix:

Seed one public smart collection, one GPS-visible map image, and timeline/year fixture dates in `seed-e2e.ts`, then add browser smoke tests that assert each route returns no Next error, renders one H1, and exposes its primary content. Keep assertions cheap; this is route viability coverage, not deep UI validation.

### C29-TE-07 - Nav "visual" tests write artifacts but do not assert baselines

Severity: Low  
Confidence: High  
Status: Confirmed test-quality gap

Evidence:

- `apps/web/e2e/nav-visual-check.spec.ts:40-79` checks visibility, 44 px target size, and overlap geometry.
- The same tests save screenshots at `apps/web/e2e/nav-visual-check.spec.ts:51`, `:65`, and `:78`.
- They never call `expect(page).toHaveScreenshot(...)` or compare committed baselines.

Failure scenario:

A CSS change keeps nav controls non-overlapping and at least 44 px, but clips an icon, breaks contrast, shifts spacing, or visually corrupts the expanded mobile menu. The test still passes; only an unreviewed artifact changes.

Suggested test/fix:

Either convert these to Playwright screenshot assertions with stable masks and thresholds, or rename/document them as artifact-only geometry smoke tests and assign visual review to a separate manual/visual gate.

## Confirmed Issues vs Risks

Confirmed test-quality gaps:

- C29-TE-01: `/map` privacy test exercises copied logic, not `getMapImages()`.
- C29-TE-02: semantic stub ranking has no formula-distinguishing behavior test.
- C29-TE-03: real CLIP activation suites are skipped by default CI.
- C29-TE-04: GET route rate-limit enforcement is outside the custom gate.
- C29-TE-06: `/map`, `/timeline`, `/year`, and `/c` have no E2E route smoke.
- C29-TE-07: nav visual screenshots are artifacts, not assertions.

Risks / manual-validation gaps:

- C29-TE-05: no WebKit/mobile-engine browser matrix.
- I did not run Playwright because the harness seeds and removes disposable test data; this is acceptable for Prompt 1 review but leaves browser status as static analysis plus CI configuration evidence.

## TDD Opportunities

- Write the `getMapImages()` behavior test before editing the map query again. It should fail if `topics.map_visible=true`, GPS `isNotNull` predicates, the marker cap, or the runtime guard disappear.
- Write the semantic cosine-vs-dot fixture before changing `route.ts` or CLIP similarity helpers.
- Add GET-route gate fixtures before expanding `check-public-route-rate-limit.ts`, so the new rule has clear pass/fail examples.
- Add route-smoke E2E fixtures before touching map/timeline/year/smart-collection pages, so hydration or translation failures become visible.

## Non-Findings

- No `test.only`, `describe.only`, or `it.only` markers found.
- Custom auth/action/rate-limit gates passed on the current tree.
- The security-critical admin API route gate covers both current admin API routes.
- Action-origin gate covers current server actions and reports intentional read-only/public exemptions.
- The unit suite is broad and currently green: 2539 passing tests.
- The two skipped unit files are the expected CLIP real-model suites.

## Final Missed-Issues Sweep

Sweep commands covered:

- File inventory for source, tests, routes, scripts, fixtures, messages, migrations.
- Searches for `.skip`, `.only`, `waitForTimeout`, `TODO`, `FIXME`, weak/source-contract patterns, route handler exports, server-action exports, and E2E route mentions.
- Manual reads of CI config, Playwright config, E2E specs, custom lint gates, semantic search route/tests, CLIP real-model tests, map route/data/tests, and nav visual checks.

Covered-file summary:

- Docs/context: `AGENTS.md`, `CLAUDE.md`.
- CI/config: `.github/workflows/quality.yml`, `apps/web/package.json`, root `package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`.
- Gates/scripts: `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, `run-e2e-server.mjs`, `seed-e2e.ts`.
- E2E: all 5 specs and helper file.
- Unit tests: all 274 top-level Vitest files inventoried; targeted deep reads for semantic, CLIP, map, route-rate-limit, smart-collection, timeline, and visual/nav tests.
- Source: all App Router route handlers, public page routes, server actions, key data/lib modules, map components, semantic routes, and rate-limit helpers.

No product code was changed. This review artifact is the only intentional file update.
