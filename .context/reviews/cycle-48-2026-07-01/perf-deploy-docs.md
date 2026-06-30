# Cycle 48 Performance / Deploy / Docs Drift Review

Reviewed HEAD: `9d0dc208`.

## Reviewed Inventory

- Repo instructions: `AGENTS.md`, `CLAUDE.md`.
- Prior baseline: `.context/reviews/cycle-47-2026-07-01/_aggregate.md`, `perf-deploy.md`, `.context/plans/cycle-47-2026-07-01-plan.md`, `.context/plans/cycle-47-2026-07-01-deferred.md`.
- Deploy/runtime: `package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `.dockerignore`.
- SW/cache: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/__tests__/sw-template-contract.test.ts`.
- DB/query/index/migrations: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`.
- Image/backfill cost paths: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Docs drift: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `.context/plans/README.md`.

Prior deferred items not re-raised: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`.

## Findings

### C48-PD-01 - Current HEAD deploy closure needs a Cycle 48 ledger entry

- Severity: Low
- Confidence: High
- Citations: `AGENTS.md:17`, `package.json:22`, `.context/plans/cycle-47-2026-07-01-plan.md:51`, `.dockerignore:4`, `.dockerignore:25`
- Problem: Project policy says `npm run deploy` runs after every commit pushed to `master`, and the root deploy script is wired at `package.json:22`. The latest committed deploy evidence records source commit `d30694c8`, while current HEAD is the later docs commit `9d0dc208`. The changed files are `.context` markdown, which are excluded from Docker context by `.dockerignore`, so runtime blast radius is low, but committed cycle history should explicitly record the invocation's start condition that `9d0dc208` was the current deployed `master` HEAD.
- Failure scenario: a future review or operator uses committed plan state as the deploy baseline and assumes the Cycle 47 source commit is the only deployed closure evidence. That recreates the deploy/docs drift class Cycle 47 just closed, even though this instance is docs-only and Docker-ignored.
- Suggested fix: record the Cycle 48 start evidence for `9d0dc208`, commit the Cycle 48 review/plan artifacts, then run the normal per-cycle `npm run deploy` after the pushed Cycle 48 commit.

## No New Runtime Findings

No new non-deferred findings found in performance, DB query/index fit, image memory/CPU costs, service-worker/cache behavior, Docker runtime config, migration reconcile/runbook, or operational scripts. The inspected issues in feed/sitemap freshness indexes, backfill pipeline-version indexes, public LIKE scans, timeline non-sargable predicates, map scale, and sidecar keyset/backfill behavior remain covered by prior deferred items and were not escalated by new evidence in this pass.

## Final Sweep Note

Read-only review completed. No tests were run in this lane because it was inspection-only.
