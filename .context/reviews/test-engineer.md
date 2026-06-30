# Cycle 32 Test-Engineer Review

Role: test-engineer
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `3d174c96`
Date: 2026-06-30
Scope: repo-wide review for missing, weak, flaky, overfitted, or misleading tests. No product code changed.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Built file inventory before source inspection:

- Total tracked files from `rg --files`: 816.
- Main app files under `apps/web`: 627.
- Vitest files under `apps/web/src/__tests__`: 276.
- Playwright specs under `apps/web/e2e`: 5.
- Critical surfaces inventoried: `apps/web/src/app/api/**/route.*`, `apps/web/src/app/actions/**`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/**`, `apps/web/src/db/schema.ts`, `apps/web/scripts/**`, `apps/web/drizzle/**`, Docker/deploy/nginx config, `.github/workflows/quality.yml`, and existing `.context/reviews` / `.context/plans` history.

## Findings

### TE32-01 - Schema reconcile is still protected by source tripwires, not a structural database diff

- Severity: High
- Confidence: High
- Source/test regions: `apps/web/scripts/migrate.js:317-713`, `apps/web/scripts/migrate.js:759-819`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-102`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:124-172`; `.github/workflows/quality.yml:69-80`.
- Evidence: `prepareLegacyDatabaseIfNeeded()` makes `reconcileLegacySchema()` the fresh/legacy bootstrap path and then baselines every journal hash before Drizzle runs. The tests explicitly describe themselves as a source tripwire and say they cannot verify types/defaults; they mostly assert that table, column, and index names appear in `migrate.js`.
- Untested failure scenario: a migration adds or changes a column/index/FK and `migrate.js` mentions the name but uses the wrong type, nullability, default, index column order, or FK action. Vitest passes, `npm run init` can pass, and `__drizzle_migrations` can be fully baselined, while the real MySQL schema diverges from `src/db/schema.ts`. The next production-only write or query can fail later with `ER_BAD_FIELD_ERROR`, wrong defaults, missing cascade behavior, or a silent performance regression.
- Recommended test: after CI `npm run init --workspace=apps/web`, run an information_schema comparison against the Drizzle schema/migration expectations for tables, columns, nullability/defaults, indexes, and FKs. Keep the current source tripwires as fast preflight checks.

### TE32-02 - Restore/backup state machine is mostly asserted by source-order tests

- Severity: High
- Confidence: Medium
- Source/test regions: `apps/web/src/app/[locale]/admin/db-actions.ts:365-565`, `apps/web/src/app/[locale]/admin/db-actions.ts:570-761`, `apps/web/src/app/[locale]/admin/db-actions.ts:781-820`; `apps/web/src/__tests__/db-restore.test.ts:42-77`; `apps/web/src/__tests__/restore-upload-lock.test.ts:8-120`.
- Evidence: restore holds multiple advisory locks, enters durable maintenance, quiesces queues, streams an uploaded SQL file into `mysql`, then runs `node scripts/migrate.js`. Current tests mainly read the source and assert string ordering, not the behavior of `restoreDatabase()` under child-process close/error/stdin/error/migration-failure paths.
- Untested failure scenario: a refactor preserves the searched strings but changes control flow so a `mysql` nonzero exit, post-restore migration failure, stream error, or partial maintenance-prep failure clears maintenance too early, forgets to resume the image queue, leaves an upload/backfill/restore lock held, or reports success after a failed import. These are exactly the destructive admin paths where source-order checks are easiest to overfit.
- Recommended test: add executable unit tests with mocked `connection.getConnection()`, `spawn`, file streams, restore-maintenance helpers, queue quiesce/resume, and upload-contract locks. Assert returned result, `keepMaintenance`, release calls, temp cleanup, audit/revalidation, and queue resume for each failure branch.

### TE32-03 - Production CLIP activation is still outside default CI

- Severity: Medium
- Confidence: High
- Source/test regions: `apps/web/src/lib/clip-model.ts:197-258`, `apps/web/src/app/api/search/semantic/route.ts:247-365`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`; `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`; `apps/web/src/__tests__/semantic-route-production.test.ts:3-16`; `.github/workflows/quality.yml:66-80`.
- Evidence: real CLIP tests skip unless `CLIP_INTEGRATION=1` or `CLIP_OFFLINE_LOAD=1` plus seeded weights are present. The production semantic route test mocks both `getGalleryConfig()` and `embedTextReal()`. The cycle-29 deferred plan already tracks this as `D29-09`.
- Untested failure scenario: a Transformers.js, ONNX runtime, model revision, seeded directory layout, or Korean semantic-ranking drift breaks the real offline encoder while CI remains green. Production mode can then return 503, fail first inference, or serve low-quality rankings even though mocked route tests pass.
- Recommended test: add a scheduled/manual CI job with cached seeded weights that runs `clip-offline-load.test.ts` and `clip-semantic-integration.test.ts`, at least before dependency/model upgrades and before production semantic-search activation.

### TE32-04 - Deploy/nginx safety checks are string contracts, not parser/runtime checks

- Severity: Medium
- Confidence: High
- Source/test regions: `apps/web/deploy.sh:1-85`, `apps/web/nginx/default.conf:21-203`; `apps/web/src/__tests__/deploy-script-contract.test.ts:21-127`, `apps/web/src/__tests__/nginx-config.test.ts:12-70`; `.github/workflows/quality.yml:54-80`.
- Evidence: the deploy and nginx tests assert substrings/order for prune-after-health, no `volume prune -a`, bind mounts, body caps, and proxy headers. CI does not run `bash -n apps/web/deploy.sh`, `docker compose config`, or `nginx -t` against the checked-in template.
- Untested failure scenario: a shell syntax error, invalid compose interpolation, or invalid nginx directive/regex can pass the substring tests and fail only at deploy time. For this repo, deploy failure is high-cost because `npm run deploy` is per-iteration policy and the auto-prune/health ordering is an operational invariant.
- Recommended test: add cheap syntax/config gates: `bash -n apps/web/deploy.sh scripts/deploy-remote.sh`, `docker compose --env-file apps/web/.env.local.example -f apps/web/docker-compose.yml config` with safe placeholder env, and `nginx -t` in a container mounting `apps/web/nginx/default.conf`.

## Non-Findings

- The admin API, server-action origin, and public-route rate-limit gates are stronger than plain grep: their scanner tests cover aliases, spoofed imports, dead branches, ordering, local helper hiding, and catch/finally expensive work in the public route scanner.
- Map GPS privacy is not just source-only now: `apps/web/src/__tests__/map-get-images-behavior.test.ts` exercises `getMapImages()` with a mocked Drizzle chain and asserts the map-visible/GPS predicates plus runtime guard.
- CI does run authenticated admin E2E: `.github/workflows/quality.yml` provides `E2E_ADMIN_PASSWORD`, initializes MySQL, and then runs Playwright. Local runs may skip admin specs, but the CI gate does not.

## Final Sweep

Final sweep covered test inventory, route/action scanner fixtures, privacy selectors, map behavior tests, migration/journal/reconcile tests, restore/backup tests, deploy/nginx tests, CLIP tests, Playwright gating, CI workflow, existing review/plan history, and focused/skipped markers. I did not run the full gate suite because this was a review-only lane; no source code was edited.
