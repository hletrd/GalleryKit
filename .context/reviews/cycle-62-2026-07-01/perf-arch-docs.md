# Cycle 62 Performance / Architecture / Deploy Docs Review

Reviewer: performance/architect/deploy-docs lane
Date: 2026-07-01
Scope: read-only review subtask for the review-plan-fix workflow.

## Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-61-2026-07-01-plan.md`
- `.context/plans/cycle-61-2026-07-01-deferred.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-61-2026-07-01/_aggregate.md`

## Inventory

Reviewed the current performance, concurrency, cache/service-worker, deploy, Docker, migration, schema, and architecture surfaces:

- Deploy/docs: `package.json`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `AGENTS.md`, `CLAUDE.md`, `.context/plans/**`, `.context/reviews/_aggregate.md`.
- Migration/schema: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/__tests__/migration-journal.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.
- DB/query/perf: `apps/web/src/lib/data.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, `apps/web/src/lib/feed-conditional.ts`, semantic/similar search routes and CLIP helpers by targeted search.
- Concurrency/background work: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/view-retention.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, LR upload route, OG routes.
- Cache/service worker: `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/settings-hash.ts`, upload route handlers.

## Findings

### C62-PAD-01 - Cycle 61 ledger still marks commit/push/deploy as pending after the signed fix commit reached origin

- Severity: Medium
- Confidence: High for commit/push drift; Medium for deploy drift because I did not run `npm run deploy` or inspect remote deploy logs in this read-only lane.
- File/line: `.context/plans/cycle-61-2026-07-01-plan.md:47`, `.context/plans/cycle-61-2026-07-01-plan.md:54`, `.context/plans/cycle-61-2026-07-01-plan.md:55`, `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/README.md:12`.
- Evidence: `git show --show-signature HEAD` reports a good GPG signature on `0bf3371c fix(cycle-61): 🐛 guard restore-sensitive routes`, and `git rev-parse HEAD origin/master` returns the same commit (`0bf3371c327099be04c70a3a4e004810942a1cb2`). The Cycle 61 plan nevertheless leaves `Commit, pull --rebase, push` and `Deploy with npm run deploy` unchecked, while the plan index still calls Cycle 61 "active" and "scheduled".
- Problem: The review-plan-fix ledger is now stale in the same operationally important way Cycle 61 fixed for Cycle 60. Later cycles can waste review/implementation time rediscovering closed work or treating the deployed baseline as unknown.
- Scenario: Cycle 62 planning reads the plan index, sees Cycle 61 still active with commit/deploy unchecked, and schedules another ledger cleanup rather than using `0bf3371c` as the current origin baseline.
- Suggested fix: update Cycle 61 terminal progress with signed commit/origin evidence; record deploy evidence if the per-iteration deploy already ran, or explicitly mark deploy evidence missing and schedule the deploy/docs closure. Update `.context/plans/README.md` so Cycle 61 is no longer listed as the active current-cycle plan once Cycle 62 starts.

## Non-Findings / Checked Areas

- Cycle 61 restore-maintenance fixes are present in source: `/api/og` checks `isRestoreMaintenanceActive()` before rate-limit and DB work; `/api/og/photo/[id]` does the same before rate-limit and image/SEO/config work.
- LR upload now re-checks restore maintenance and acquires `acquireUploadProcessingContractLock()` before the topic `SELECT`, matching the Cycle 61 plan.
- Migration journal integrity now checks both directions: every journal tag has a SQL file, and every top-level `drizzle/*.sql` file is journaled. A local journal-vs-SQL diff was empty.
- Docker deploy safety matched the docs during this review: env-file permissions are checked before Compose, health is checked before prune, live data is bind-mounted, MySQL is host-local, and automatic `volume prune` omits `-a`.
- `apps/web/.env.local` is currently mode `0600`.

## Deferred Items Not Re-Raised

I did not re-raise the carried-forward deferred items without new severity evidence: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`, `C61-06`, and `C61-07`.

## Residual Risks

- No production `EXPLAIN`, load trace, browser trace, or remote deploy-log inspection was run in this read-only lane.
- Cache/service-worker review was source/static only; I did not run a browser SW freshness simulation.
