# Cycle 29 Verifier Review

Role: verifier subagent  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `b4fa1f64`  
Date: 2026-06-30 18:17 KST  
Scope: Prompt 1 only: evidence-based correctness review. No product code modified.

## Process And Inventory

Read first, per task:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory performed with `rg` / `rg --files`:

- Docs/contracts: no `docs/contracts/` directory exists; `docs/superpowers/plans/2026-06-15-clip-semantic-search.md` and `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md` were inventoried.
- Repo contracts: `AGENTS.md`, `CLAUDE.md`, root/app package manifests, `.github/workflows/quality.yml`.
- Critical source: App Router public pages, public/admin API routes, server actions, `proxy.ts`, data access, rate limiting, restore maintenance, background DB writes, image queue, upload/image processing, semantic search, map/timeline data.
- Scripts and deploy config: `apps/web/scripts/*`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.
- Migrations/schema: `apps/web/src/db/schema.ts`, all `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`.
- Tests: all top-level `apps/web/src/__tests__/*.test.ts` files and all `apps/web/e2e/*.spec.ts` files were inventoried; targeted deep reads are listed in the covered-file summary.

Validation commands run:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- src/__tests__/map-privacy.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/semantic-similarity-selector-contract.test.ts src/__tests__/settings-hash.test.ts src/__tests__/migration-journal-monotonicity.test.ts` passed: 5 files, 55 tests.

## Confirmed Issues

### V29-MED-01: Rate-limit retention deletes by an unindexed leading column

Severity: Medium  
Confidence: High  
Classification: Confirmed correctness/operational issue

Evidence:

- `apps/web/src/db/schema.ts:212-219` defines `rate_limit_buckets` with only primary key `(ip, bucket_type, bucket_start)`.
- `apps/web/src/lib/rate-limit.ts:515-517` purges expired rows with `WHERE bucket_start < cutoff`.
- `apps/web/src/lib/image-queue.ts:1019-1024` runs `purgeOldBuckets()` at startup, and `apps/web/src/lib/image-queue.ts:1039-1047` repeats it hourly.
- `apps/web/drizzle/0001_sync_current_schema.sql:22-27` and `apps/web/scripts/migrate.js:525-530` mirror the table without a leading `bucket_start` index.

Failure scenario:

High public traffic, bot probes, login attempts, or semantic/search usage creates many distinct rate-limit rows. The hourly purge cannot efficiently use the `(ip, bucket_type, bucket_start)` primary key for a predicate on `bucket_start` alone, so MySQL may scan the whole table on the single writer. That can stall the same DB used for uploads, restore, public rendering, and rate-limit checks.

Fix:

Add a migration plus `reconcileLegacySchema` mirror for a retention index such as `INDEX idx_rate_limit_buckets_bucket_start (bucket_start)`. Consider chunking `purgeOldBuckets()` with bounded deletes, matching the audit/view retention style, so one hourly sweep cannot monopolize the writer.

### V29-MED-02: The map GPS privacy test copies guard logic instead of testing `getMapImages()`

Severity: Medium  
Confidence: High  
Classification: Confirmed test-quality gap

Evidence:

- `apps/web/src/lib/data.ts:1660-1697` states `getMapImages()` is the only public function exposing latitude/longitude, enforces `topics.map_visible = true`, requires non-null GPS fields, limits to `MAP_MAX_MARKERS`, and throws if a returned row has `topic_map_visible=false`.
- `apps/web/src/__tests__/map-privacy.test.ts:80-130` claims to test the predicate/guard, but it constructs local arrays and repeats the guard/filter logic. It never imports or executes `getMapImages()`.
- The targeted test command passed, but it would still pass if `getMapImages()` dropped the SQL `eq(topics.map_visible, true)`, the GPS `isNotNull(...)` predicates, the runtime guard, or the marker limit.

Failure scenario:

A future refactor accidentally changes `getMapImages()` to select GPS rows without the topic opt-in filter, or removes the runtime guard while keeping the field-set tests green. `/map` can expose coordinates from private topics, and the current "unit" predicate tests do not fail because they test copied logic rather than the production query.

Fix:

Add a real behavior test for `getMapImages()` with a mocked Drizzle chain or test DB fixture that returns mixed `topic_map_visible` rows and verifies the production function filters/throws. Keep the field-set tests, but make the query/guard test call the actual function.

### V29-MED-03: Semantic stub ranking is pinned by source text, not a formula-distinguishing behavior test

Severity: Medium  
Confidence: High  
Classification: Confirmed test-quality gap

Evidence:

- `apps/web/src/app/api/search/semantic/route.ts:296-302` intentionally selects `dotProduct` only for production and `cosineSimilarity` for stub mode.
- `apps/web/src/__tests__/semantic-similarity-selector-contract.test.ts:17-22` explicitly says no behavioral test pins the branch selector and that existing mocks would pass with the wrong formula.
- `apps/web/src/__tests__/semantic-search-route.test.ts:384-405` uses uniform embeddings; `apps/web/src/__tests__/semantic-search-route.test.ts:408-471` uses unit-length vectors. In both cases dot product and cosine produce the same ordering.

Failure scenario:

A contributor simplifies the route to unconditional `dotProduct`. Stub-mode rankings become magnitude-biased, but route behavior tests still pass because their vectors do not distinguish cosine from dot product. Only a regex source contract catches the exact current syntax.

Fix:

Add a route behavior test with non-normalized stub embeddings where cosine and dot product rank results differently, then assert the stub-mode result order. Keep the source contract only as a secondary invariant.

### V29-MED-04: Public GET rate-limit enforcement is outside the custom gate

Severity: Medium  
Confidence: High  
Classification: Confirmed gate blind spot / future-risk

Evidence:

- `apps/web/scripts/check-public-route-rate-limit.ts:1-12` and `:36` scan only mutating `POST`, `PUT`, `PATCH`, and `DELETE` handlers.
- The fresh gate output reported GET-only public API files as OK with "no mutating handlers", including `api/og/photo/[id]`, `api/og`, and `api/search/similar/[id]`.
- Current expensive GET routes have bespoke tests, for example OG behavior in `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts` and similar-image behavior in `apps/web/src/__tests__/similar-route.test.ts`; that is manual coverage, not a gate.

Failure scenario:

A future public `GET` route performs DB, Sharp, ImageResponse, filesystem, or embedding work and ships without a limiter. `npm run lint:public-route-rate-limit` still passes it as "no mutating handlers" unless a reviewer notices manually.

Fix:

Add a second GET audit gate, or extend the existing script conservatively: public API GET handlers importing DB/data helpers, `ImageResponse`, Sharp, embedding helpers, OG helpers, or filesystem access must call an approved limiter or carry a reasoned exemption. Add fixture tests for both failure and explicit-exemption cases.

## Likely Issues

### V29-LOW-01: Restore-maintenance guards do not cover DB-backed `generateMetadata()` paths

Severity: Low  
Confidence: Medium  
Classification: Likely issue

Evidence:

- Public page bodies short-circuit during restore maintenance, for example `apps/web/src/app/[locale]/(public)/map/page.tsx:29-33`, `timeline/page.tsx:57-66`, `year/[year]/page.tsx:70-84`, `page.tsx:151-156`, `p/[id]/page.tsx:126-137`, and `c/[slug]/page.tsx:80-85`.
- The same files run DB-backed metadata before those body guards: `map/page.tsx:14-19` calls `getSeoSettings()`, `timeline/page.tsx:20-25` calls `getSeoSettings()`, `year/[year]/page.tsx:21-32` calls `getSeoSettings()`, home metadata calls `getSeoSettings()` and `getLatestImageForOgCached()`, photo metadata calls `getSeoSettings()` and `getImageCached()`, and smart-collection metadata calls `getSmartCollectionBySlugCached()` plus `getSeoSettings()`.
- Restore preparation drains known mutable writers before import in `apps/web/src/app/[locale]/admin/db-actions.ts:492-503`, implying public DB work should degrade during the restore window.

Failure scenario:

An admin starts a restore. Public route bodies render the maintenance component, but Next still executes `generateMetadata()` and performs DB reads while tables are being dropped/imported. Users or crawlers can see 500s, incorrect not-found/noindex metadata, or noisy DB errors instead of consistent maintenance metadata.

Fix:

Introduce a shared metadata guard: when restore maintenance is active, return static noindex maintenance metadata without calling data accessors. Apply it to DB-backed public `generateMetadata()` functions and add a source or behavior test pairing page-body guards with metadata guards.

## Risks Needing Manual Validation

- Real CLIP activation is not proven by default CI. `clip-offline-load.test.ts:15-21` and `:32-41` skip unless `CLIP_OFFLINE_LOAD=1` and seeded `CLIP_MODELS_ROOT` exist; `clip-semantic-integration.test.ts:8-10` and `:30-31` skip unless `CLIP_INTEGRATION=1`. `.github/workflows/quality.yml:66-67` runs plain `npm test` with no seeded weights.
- E2E runs only one desktop Chromium project. `apps/web/playwright.config.ts:72-77` defines only `chromium`; `.github/workflows/quality.yml:72-77` installs only Chromium. Safari/WebKit-sensitive P3/HDR, service-worker, focus, and responsive behavior need separate smoke coverage.
- Public route browser smoke is incomplete. Final E2E grep found no browser visits for `/map`, `/timeline`, `/year/...`, or `/c/...`, even though those are DB-backed public pages with dynamic/client behavior.
- Nav "visual" E2E tests write screenshots but do not assert visual baselines. `apps/web/e2e/nav-visual-check.spec.ts:51`, `:65`, and `:78` call `page.screenshot(...)`, but no `toHaveScreenshot(...)` assertion exists.

## Non-Findings

- Public analytics restore drain is present in this tree. `recordPhotoView`, `recordTopicView`, and `recordSharedGroupView` now call `trackBackgroundDbWrite()` at `apps/web/src/app/actions/public.ts:430-436`, `:462-468`, and `:498-504`; restore drains it at `apps/web/src/app/[locale]/admin/db-actions.ts:493-497`.
- The private original upload directory is tightened in the deployed entrypoint: `apps/web/scripts/entrypoint.sh:16-20` creates `/app/data/uploads/original` and runs `chmod 700`.
- The security scanner gates passed on this tree: admin API auth, action origin, and public mutating route rate-limit.
- The targeted contract tests passed, including settings-hash and migration journal monotonicity.

## Final Missed-Issues Sweep

Sweep commands covered:

- `rg --files` over docs, source, scripts, migrations, tests, E2E, and deploy config.
- `rg` for auth wrappers, same-origin guards, rate-limit helpers/exemptions, restore maintenance, revalidate/metadata paths, privacy field sets, background write drains, CLIP env gates, and migration claims.
- `rg` for skipped tests, `.only`, screenshot artifacts, route coverage mentions, source-contract tests, and weak copied-logic patterns.
- `git status --short` before writing showed unrelated dirty review artifacts: `.context/reviews/architect.md`, `code-reviewer.md`, `perf-reviewer.md`, `security-reviewer.md`, and `test-engineer.md`. They were left untouched.

Covered-file summary:

- Docs/context: `AGENTS.md`, `CLAUDE.md`, `docs/superpowers/**`.
- Schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`.
- Gates/scripts/deploy: `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, `entrypoint.sh`, `deploy.sh`, `docker-compose.yml`, `nginx/default.conf`, `next.config.ts`, `.github/workflows/quality.yml`.
- Core source: public page routes, public/admin API routes, server actions, `data.ts`, `data-timeline.ts`, `rate-limit.ts`, `background-db-writes.ts`, `image-queue.ts`, semantic/similar routes, map components.
- Tests: targeted deep reads of map privacy, semantic route/selector, CLIP activation, settings hash, migration monotonicity, route-rate-limit, OG/similar rate-limit, E2E specs, and Playwright config.

No product code was modified. This review report is the only intentional file update by the verifier pass.
