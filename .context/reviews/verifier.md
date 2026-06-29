# Verifier Review - Cycle 9

Date: 2026-06-29
Role: verifier lane
Scope: current `HEAD` (`adb1ae67`) on `master`. Source code and plans were not edited.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, and the `code-review` skill instructions.

Review-relevant inventory was built across the requested contract surfaces, not by sampling:

- Repo/runbook controls: `AGENTS.md`, `CLAUDE.md`, root `package.json`, `apps/web/package.json`.
- Migration/schema surface: 27 SQL migrations, 27 journal entries, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, migration/reconcile tests.
- Privacy/select surface: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, map/search privacy tests, all public search routes.
- Auth/origin/rate-limit surface: 8 API route files, 13 action files plus `apps/web/src/app/[locale]/admin/db-actions.ts`, all three security lint scanners.
- Image/color/HDR surface: process-image/color detection/ICC/gain-map/settings hash/serve-upload/backfill/queue files and related tests.
- Queue/restore surface: image queue, admin backfill runner, sidecar backfill, DB restore, restore maintenance, upload tracker/contract lock.
- Service worker/generated artifacts: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, `apps/web/src/__tests__/sw-template-contract.test.ts`.
- Deploy/runbooks: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, deploy/nginx/site-config tests.
- i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`; both currently have 784 flattened keys and no parity gaps.

## Confirmed Issues

### F-001 - Committed generated service worker has a stale cache version

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `CLAUDE.md:407` states that `public/sw.template.js` is the shipped source and that `scripts/build-sw.ts` stamps `__SW_VERSION__` into `public/sw.js`; after editing the template, `sw.js` must be regenerated and committed.
- `apps/web/scripts/build-sw.ts:28-46` builds the version from `git rev-parse --short HEAD` plus `-p${IMAGE_PIPELINE_VERSION}`.
- Current `HEAD` is `adb1ae67`, and `npm run build --workspace=apps/web` regenerated `sw.js` as `adb1ae67-p7`.
- The committed `apps/web/public/sw.js:21-26` still contains `1e182969-p7`.
- `apps/web/src/__tests__/sw-template-contract.test.ts:163-167` checks generated SW logic parity for the bounded HEAD probe, but it does not check that the generated version stamp matches the current commit/pipeline version.

Concrete failure scenario:

A reviewer or CI run can pass `sw-template-contract` while `public/sw.js` is stamped for an older commit. Production `npm run build` regenerates the artifact, so the normal deploy path self-heals, but the repository artifact is still out of contract. Any path that serves or inspects committed `public/sw.js` without running `prebuild` can ship an older `SW_VERSION`, causing clients to keep the previous `gk-images-*`, `gk-html-*`, and `gk-meta-*` cache namespace instead of activating a cache version for the current commit.

Suggested fix:

Regenerate and commit `apps/web/public/sw.js` for `adb1ae67-p7`. Add a test or lint assertion that computes the expected `${git short SHA}-p${IMAGE_PIPELINE_VERSION}` and checks `public/sw.js` contains it, so stale generated artifacts cannot pass review.

## Likely Issues

None found.

## Risks Needing Manual Validation

### R-001 - Sitemap runtime regeneration after DB-unavailable build was not proven against MySQL

Severity: Low
Confidence: Medium
Status: Risk needing manual validation, not a confirmed bug

Evidence:

- `apps/web/src/app/sitemap.ts:24-55` intentionally catches build-time DB failures, emits a minimal homepage-only sitemap, and says ISR will replace it on the first runtime hit.
- The production build passed, but logged `ECONNREFUSED 127.0.0.1:3306` and `[sitemap] falling back to homepage-only sitemap` during static generation because no local MySQL was running.

Concrete failure scenario:

If production runtime ISR does not regenerate `/sitemap.xml` successfully after deploy, crawlers may see only the homepage/feed entries until the next successful runtime generation. The source comments describe this as intentional, but this verifier lane did not have a live MySQL instance to prove the first runtime hit replaces the fallback with topic/photo URLs.

Suggested validation:

After deploy, request `/sitemap.xml` with DB reachable and confirm topic/photo/feed URLs are present. If SEO freshness is considered critical, add a deploy smoke check or an integration test with MySQL for the sitemap route.

## False Positives / Already Fixed

- Migration contract: current journal has exactly one documented historical inversion at idx 7; entries from idx 18 onward exceed prior global maxima. `apps/web/scripts/migrate.js:170-183` hashes every SQL file, `apps/web/scripts/migrate.js:758-776` asserts every expected hash exists after Drizzle, and targeted migration tests passed.
- Privacy select fields: `apps/web/src/lib/data.ts:375-405` omits sensitive fields from public selects, `apps/web/src/lib/data.ts:472-487` guards public/map select leakage, and targeted privacy/search/map tests passed.
- Auth/origin/rate-limit lints: admin API routes are wrapped by `withAdminAuth`, mutating actions returned early on `requireSameOriginAdmin`, and mutating public POST routes used rate-limit helpers. All three architecture lints passed.
- Image/color/HDR pipeline: targeted tests for `process-image`, `color-detection`, `gain-map-detection`, `icc-chromaticity`, `use-display-capability`, settings hash, and serve-upload passed. HDR public honesty and P3/HDR UI paths were covered by current tests.
- Queue/restore behavior: targeted tests for image queue, admin backfill runner, sidecar backfill, restore maintenance, DB restore, upload tracker, advisory locks, deploy script, and nginx contract passed.
- Service worker logic parity: template/generated logic for bounded HEAD revalidation and admin-rendered HTML exclusion passed. The remaining issue is only the generated version stamp.
- i18n: message key parity is clean; English/Korean plural-shape asymmetry remains intentional per `CLAUDE.md:580`.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` -> passed.
- `npm run lint:action-origin --workspace=apps/web` -> passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed.
- `npm run lint --workspace=apps/web` -> passed.
- `npm run typecheck --workspace=apps/web` -> passed.
- `npm test --workspace=apps/web` -> 252 test files passed, 2 skipped; 2330 tests passed, 4 skipped.
- `npm run build --workspace=apps/web` -> passed; regenerated PWA icons and `sw.js`, then completed Next production build. The generated `sw.js` change was restored after recording F-001 so source artifacts stayed unchanged except this report.

Targeted tests also passed before the full suite:

- Migration/privacy/SW: 7 files, 105 tests.
- Auth/rate-limit scanner coverage: 7 files, 105 tests.
- Color/HDR/serve-upload: 23 files, 261 tests.
- Queue/restore/deploy: 27 files, 144 tests.
- i18n/sanitization/touch-target: 12 files, 149 tests.
- Secrets/client-boundary/storage/upload/deploy smoke tests: 11 files, 55 tests.

## Final Missed-Issue Sweep

Final sweeps covered:

- Migration journal file/tag parity, `when` ordering, reconcile coverage, dropped-table/column tripwires, and post-migration hash assertions.
- Sensitive fields across public/timeline/map/search select surfaces.
- Every API route export and server action export relevant to admin auth, same-origin enforcement, restore-maintenance checks, and rate limiting.
- Color/HDR source metadata, settings hashing, cache headers, derivative cleanup, backfill update races, queue quiesce/resume, and restore locks.
- Service worker cache strategy, generated artifact freshness, proxy admin marker, upload cache headers, deployment helper, compose mounts, nginx body-size ordering, health/live routes, i18n parity, tracked-secret scanner, and mandatory gates.

No other confirmed issues were found.
