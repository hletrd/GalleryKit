# Cycle 30 Verifier Review

Role: verifier  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `666b74f8` (`fix(cycle-29): harden review findings`)  
Date: 2026-06-30  
Scope: Prompt 1 of cycle 30/100. Review only; no fixes implemented.

## Inventory

Read before reviewing:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Current HEAD inventory:

- App/API surface: 8 API route files, 12 server-action files, localized public/admin page routes under `apps/web/src/app/[locale]`.
- Core libraries reviewed: restore maintenance, DB restore, rate limiting, data access, semantic search, CLIP backfill, health/live routes, image queue.
- Tests inventoried: 270+ Vitest files under `apps/web/src/__tests__` plus Playwright specs under `apps/web/e2e`.
- Recent HEAD focus: cycle-29 changes to rate-limit bucket indexing, public restore-maintenance metadata, health route behavior, public-route rate-limit scanner, map privacy tests, semantic search tests, and topic map publishing UI.

Validation evidence:

- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- src/__tests__/health-route.test.ts src/__tests__/map-privacy.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/semantic-search-route.test.ts` passed: 4 files, 79 tests.

## Confirmed Issues

### VER30-01: `/api/health` no longer matches the documented liveness-only default

- Severity: Medium
- Confidence: High
- Classification: Confirmed contract/documentation mismatch
- File/region: `apps/web/src/app/api/health/route.ts:7-20`; docs at `CLAUDE.md:99`, `CLAUDE.md:588`, `README.md:201`, `apps/web/README.md:50`.
- Evidence: The route returns `503` whenever `isRestoreMaintenanceActive()` is true, before checking `HEALTH_CHECK_DB`. The docs still say `/api/health` is liveness-only by default and only probes readiness when `HEALTH_CHECK_DB=true`.
- Failure scenario: An operator or monitor follows the documented contract and uses `/api/health` as a liveness-only endpoint. During an intentional DB restore, it reports unhealthy even when the process is alive. Docker's checked-in healthcheck uses `/api/live`, so the shipped container avoids restart loops, but external monitoring/load balancers can still act on the stale contract.
- Suggested fix: Either keep `/api/health` liveness-only unless `HEALTH_CHECK_DB=true`, or update docs/tests to define it as readiness/unavailable during restore and direct all liveness users to `/api/live`.

## Likely Issues

### VER30-02: Map privacy coverage still does not execute `getMapImages()`

- Severity: Medium
- Confidence: High
- Classification: Test-quality gap
- File/region: `apps/web/src/__tests__/map-privacy.test.ts:82-152`; production code at `apps/web/src/lib/data.ts:1660-1697`.
- Evidence: The test now source-checks that `getMapImages()` contains the topic join, `eq(topics.map_visible, true)`, GPS predicates, and marker limit. But the runtime guard tests at `map-privacy.test.ts:112-140` still use local fake rows and copied guard logic rather than importing/executing `getMapImages()`.
- Failure scenario: A refactor keeps the searched source strings but changes query composition or row handling in a way the production function no longer enforces, while the copied-logic tests still pass. The highest-risk result is GPS coordinates from non-opted-in topics reaching `/map`.
- Suggested fix: Add a behavior test around `getMapImages()` with a mocked Drizzle chain or a test DB fixture that returns mixed `topic_map_visible` rows and verifies the production function filters/throws. Keep the source contract as a secondary guard.

### VER30-03: Expensive public GET linting proves presence of a limiter, not dominance before work

- Severity: Medium
- Confidence: Medium
- Classification: Gate blind spot / future-risk
- File/region: `apps/web/scripts/check-public-route-rate-limit.ts:263-282`, `apps/web/scripts/check-public-route-rate-limit.ts:428-437`; tests at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:117-130`.
- Evidence: Mutating handlers use `bodyCallsRateLimitBeforeMutation(...)`, which checks ordering. Expensive GET handlers use `bodyCallsApprovedRateLimit(...)`, which only checks that an approved helper is called somewhere in the handler body. The current API routes put their limit before DB/CPU work, but the custom gate would pass a future expensive GET that calls the limiter after `db.select()`, `ImageResponse`, or embedding work.
- Failure scenario: A new public GET endpoint performs DB/Sharp/embedding work and then calls `preIncrement*` near the end. The route passes `lint:public-route-rate-limit` while allowing unmetered expensive work.
- Suggested fix: Reuse a dominance-style check for expensive GET handlers, or add fixture tests that fail when approved rate-limit helpers appear only after an expensive marker/mutation-like call.

## Risks Needing Manual Validation

- Real CLIP activation remains skipped by default CI. `clip-offline-load.test.ts:15-21` and `clip-semantic-integration.test.ts:8-31` are gated on seeded env vars; `.github/workflows/quality.yml:66-80` runs normal tests/build only.
- Browser matrix remains Chromium-only in CI. `apps/web/playwright.config.ts:72-77` defines only `chromium`, and `.github/workflows/quality.yml:72-77` installs only Chromium.
- `nav-visual-check.spec.ts:51`, `:65`, and `:78` write screenshots but use geometry assertions rather than `toHaveScreenshot(...)` baselines. This is useful smoke coverage, not visual diff coverage.

## Final Sweep

Rechecked current HEAD rather than previous cycle assumptions. Cycle-29 items that appear fixed in HEAD: rate-limit bucket `bucket_start` index exists in schema/migration/journal; semantic stub ranking now has a formula-distinguishing behavior test; public restore-maintenance metadata guards were added to DB-backed public metadata routes; similar-photos retry cache was reset on transient failures.

Skipped areas: no full `npm test`, `npm run typecheck`, `npm run build`, or Playwright run due review-only scope and time. No production/deploy commands were run. No product code was modified.
