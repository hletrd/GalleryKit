# Cycle 63 Performance / Architecture / Deploy Docs Review

Reviewer: performance/architecture/deploy-docs lane
Date: 2026-07-01
Scope: read-only review of data access query shape, index/migration fit, image/backfill concurrency, service worker/static cache contracts, deploy scripts/docs, and docs/code drift. Start HEAD: `ecfda466`.

## Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-62-2026-07-01-plan.md`
- `.context/plans/cycle-62-2026-07-01-deferred.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-62-2026-07-01/perf-arch-docs.md`

## Inventory

Reviewed the current performance, concurrency, cache/service-worker, deploy, Docker, migration, schema, and architecture surfaces:

- Data/query/schema: `apps/web/src/lib/data.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`.
- Migrations/reconcile: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`.
- Image/backfill/concurrency: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- Cache/static/SW: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/next.config.ts`, `apps/web/src/__tests__/sw-template-contract.test.ts`.
- Deploy/docs: `package.json`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `README.md`, `apps/web/README.md`, `CLAUDE.md`, deploy/nginx/cache contract tests.

## Findings

### C63-PAD-01 - Service-worker comment claims deleted photo pages bypass offline HTML cache, but code and tests intentionally cache `/p/:id`

- Severity: Low
- Confidence: High
- File/line: `apps/web/public/sw.template.js:455`, `apps/web/public/sw.template.js:458`, `apps/web/public/sw.js:455`, `apps/web/public/sw.js:458`, `apps/web/src/__tests__/sw-template-contract.test.ts:113`, `apps/web/src/__tests__/sw-template-contract.test.ts:126`, `CLAUDE.md:422`.
- Evidence: the fetch-handler comment says revocable/public object pages bypass offline HTML cache because it can otherwise outlive "photo deletion" for `HTML_MAX_AGE_MS`; the classifier actually matches only `[csg]`, `/map`, and locale-prefixed equivalents, then falls through to `networkFirstHtml()` for `/p/:id`. The contract test explicitly asserts normal photo pages remain eligible (`/p/123`, `/ko/p/123`, `/en-US/p/123` all `false`). `CLAUDE.md` documents the same intended exclusion set and does not list `/p/:id`.
- Scenario: a future deploy/cache reviewer reads the shipped service-worker comment and assumes public photo pages are deletion-fresh under transport failure, while the enforced contract serves cached photo HTML offline for up to 24 hours. That can lead to wrong operational guidance or a mistaken "cleanup" that fights the Cycle 49/50 contract.
- Fix: make the contract unambiguous. Either narrow the SW comment to say photo pages are deliberately offline-cacheable and only share/smart/map pages bypass, or, if product policy now requires deleted photo pages to be deletion-fresh, add `/p/<id>` to `isRevocableShareHtmlRoute()`, regenerate `sw.js`, update `sw-template-contract.test.ts`, and document the loss of normal photo-page offline fallback. Based on Cycle 49/50 and current `CLAUDE.md`, the minimal fix is the comment-only clarification.

## Non-Findings / Checked Areas

- Current image listing, topic listing, smart collection, share group, search, map, feed, and sitemap query shapes were inspected against existing indexes. The updated-time feed/sitemap index gap remains the already-deferred `PERF-C39-03`; no new severity evidence or schedule change was found in this lane.
- Migration journal and reconcile coverage were inspected for the recent analytics, embedding, retention, and rate-limit indexes. `reconcileLegacySchema()` mirrors the committed index additions through `ensureIndex(...)`, and journal entries through `0028_rate_limit_bucket_start_idx` are present.
- In-app image processing and admin backfill both cap concurrency against the shared DB pool and use advisory locks for per-image/global backfill coordination. Sidecar color backfill still loads the candidate list before queueing work; that remains the already-deferred `AGG-C38-08` sidecar keyset-pagination item, not re-raised.
- Static derivative cache policy remains aligned across `next.config.ts`, `nginx/default.conf`, and `serve-upload.ts`: `public, max-age=3600, must-revalidate`, deliberately not `immutable`.
- Deploy docs and tests align with the current remote deploy wrapper, root `.env.deploy` fallback, runtime env permission checks, health-before-prune order, narrow bind mounts, and no automatic `docker volume prune -a`.

## Deferred Items Not Re-Raised

No new evidence changed severity or schedule for `C62-04`, `C61-06`, `C61-07`, `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, or `AGG-C38-08`.

## Validation

- Read-only review only; no source files were edited and no tests were run.
- Verified current HEAD is `ecfda466` and the worktree was clean before writing this artifact.
