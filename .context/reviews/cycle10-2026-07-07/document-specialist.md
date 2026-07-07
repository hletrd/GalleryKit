# Cycle 10 Document-Specialist Review - 2026-07-07

Reviewer: document-specialist persona
Repository: `/Users/hletrd/flash-shared/gallery`
Scope: README / CLAUDE / AGENTS / app README / deploy and schema runbooks / `.context` and wiki documentation checked against source and tests.
Mode: static review only. Application/source files were not edited.

## Inventory First

- Canonical project docs inspected: `README.md`, `CLAUDE.md`, `AGENTS.md`, `apps/web/README.md`.
- Runbook/reference docs inspected: `.omc/wiki/*.md`, `docs/superpowers/*`, `.context/plans/**/*`, `.context/reviews/**/*`. There is no `.context/docs/` directory in this checkout.
- Deploy truth inspected: root `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.
- Schema truth inspected: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`.
- Semantic-search truth inspected: `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, CLIP/embedding tests, semantic route/config tests.
- Regression/source tests inspected as documentation truth where applicable, especially `apps/web/src/__tests__/migrate-pending-migrations.test.ts` and `apps/web/src/__tests__/semantic-embedding-storage-contract.test.ts`.
- Historical review artifacts were searched for recurring mismatch patterns, but not treated as authoritative current behavior unless they contradicted active runbook-style docs.

## Findings

### DOC-C10-01 - Stale schema migration wiki says new SQL never runs on existing DBs

Severity: Medium
Confidence: High

Location:
- Stale doc: `.omc/wiki/schema-derived-list-drift-migration-reconcile-lesson.md:19-27`
- Canonical doc/source truth: `CLAUDE.md:446-450`, `apps/web/scripts/migrate.js:791-830`, `apps/web/scripts/migrate.js:889-947`, `apps/web/scripts/migrate.js:949-974`
- Regression truth: `apps/web/src/__tests__/migrate-pending-migrations.test.ts:1-16`, `apps/web/src/__tests__/migrate-pending-migrations.test.ts:97-111`

Mismatch:
The wiki lesson still states that on an already-provisioned DB this repo does not apply a new `apps/web/drizzle/NNNN_*.sql` migration through Drizzle; instead it claims `prepareLegacyDatabaseIfNeeded` always takes the `reconcileLegacySchema` plus `baselineAllJournalMigrations` path and records the new hash "without ever executing the .sql file's statements."

That is the old failure mode, not the current contract. The current migration runner distinguishes pending migrations from legacy drift. If a gallery-bearing DB is missing only entries strictly above the recorded `MAX(created_at)` cursor, `prepareLegacyDatabaseIfNeeded` returns without reconciling or baselining so Drizzle genuinely applies the pending SQL. Mixed drift baselines only true at/below-cursor drift and leaves the above-cursor tail unbaselined. `baselineAllJournalMigrations` also refuses to baseline above-cursor entries and refuses unexecuted DML-bearing entries except explicit legacy allowlist cases.

Failure scenario:
A contributor or operator follows the wiki instead of `CLAUDE.md` and assumes new migration SQL is dead on deployed databases. They may put operationally important DML into `reconcileLegacySchema`, manually baseline pending migrations, or diagnose a deploy under the false assumption that Drizzle will never execute pending `.sql`. That can recreate the exact silent-SQL-loss class the run-10 migration guard was added to prevent, or cause duplicate DDL/manual-baseline mistakes during a drift repair.

Concrete fix:
Rewrite Lesson 1 in `.omc/wiki/schema-derived-list-drift-migration-reconcile-lesson.md` to match the current pending-vs-drift split:

- Fresh or empty/poisoned migration-log bootstrap uses `reconcileLegacySchema` plus guarded per-entry baseline.
- Normal existing DBs with missing entries strictly above the cursor leave those entries unbaselined so Drizzle applies the committed `.sql`.
- Mixed drift baselines only at/below-cursor drift; the above-cursor tail is applied by Drizzle or fails loudly if mirrored DDL duplicates.
- Future DML must ride the Drizzle-apply path unless there is a deliberate, self-gated legacy reconcile mirror and allowlist entry.
- Link the lesson to `CLAUDE.md` "Migration & Schema-Drift Runbook" and `migrate-pending-migrations.test.ts`.

### DOC-C10-02 - Wiki pages overclaim that CLIP semantic search is live in production

Severity: Low
Confidence: High

Location:
- Overclaim: `.omc/wiki/clip-semantic-search-us-p51.md:13-17`
- Overclaim: `.omc/wiki/gallerykit-architecture-overview.md:30-33`
- Canonical doc/source truth: `README.md:47-48`, `apps/web/README.md:65-82`, `CLAUDE.md:160`, `apps/web/src/lib/gallery-config-shared.ts:108-120`, `apps/web/src/lib/gallery-config-shared.ts:223-228`, `apps/web/src/lib/gallery-config.ts:64-69`, `apps/web/src/lib/gallery-config.ts:123-126`

Mismatch:
Two wiki pages still describe CLIP semantic search as "LIVE in production." The canonical docs and source are more careful: semantic search is disabled by default, production mode is operator-enabled only, the Settings UI does not expose a one-click production toggle, and a stored `production` DB setting resolves back to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` is present. `CLAUDE.md` explicitly says the repository proves gates and runbook behavior, not the current live production row count, and instructs operators to verify the deployed host before treating semantic search as active.

Failure scenario:
An operator or future agent treats the wiki headline as live-state evidence, skips the activation/preflight checks, or misdiagnoses 503 semantic-search responses as a regression rather than an unactivated/default-disabled deployment. This is especially risky on fresh installs, where the code default is `semantic_search_mode: 'disabled'`, weights are not baked into the image, and production serving also requires matching real embeddings.

Concrete fix:
Remove "LIVE in production" from both wiki pages. Replace it with wording like "operator-enabled; may be live only after env opt-in, seeded weights, production backfill, DB mode, and deployed-host verification." Link to `apps/web/README.md` "Going live" and `CLAUDE.md` `image_embeddings` / CLIP runbook sections.

## Verified Aligned Areas

- Root deploy docs align with `scripts/deploy-remote.sh`: `.env.deploy` is optional at the repo root, fallback is `$HOME/.gallerykit-secrets/gallery-deploy.env`, and `DEPLOY_ENV_FILE` can override.
- Disk-hygiene docs align with `apps/web/deploy.sh`: prune happens after `docker compose up -d` and health checks, and `docker volume prune` is used without `-a`.
- Root/app semantic docs align with current source for default-disabled mode, env-gated production, offline weights, bounded newest-first scan, and one active embedding row per `image_id`.
- The old semantic-storage documentation mismatch from earlier review cycles appears fixed: active docs/tests now consistently describe `image_embeddings` as one active row per `image_id`, not one row per `(image_id, model_version)`.
- Site-config docs align with `apps/web/src/lib/site-config.ts` and `apps/web/next.config.ts`: config is build-time inlined and the runtime bind mount does not hot-reload client-visible values.
- Upload API docs align with current auth shape: PAT header, scoped tokens, admin route auth wrapper, nginx body-size carveout, and no bundled Lightroom Classic plugin.
- Paid-download / Stripe removal docs align with package/schema truth: no current Stripe dependency or paid entitlement surface was found in active source.
- Quality-gate docs align with `apps/web/package.json` scripts for lint, auth/origin/rate-limit lint checks, typecheck, build, unit tests, and e2e tests.

## Final Missed-Issues Sweep

Search passes covered migration terms (`baseline`, `reconcileLegacySchema`, `pending`, `journal when`, `DML`), semantic terms (`LIVE`, `production`, `CLIP`, `semantic_search_mode`, `image_embeddings`, `model_version`), deploy terms (`deploy`, `.env.deploy`, `prune`, `nginx`, `health`), removed/deferred product terms (`Stripe`, `paid`, `Lightroom plugin`, `S3`, `MinIO`), and security/ops terms (`advisory lock`, `single writer`, `same-origin`, `rate limit`).

I found two active documentation/source mismatches. Remaining review risk is limited to deployed-host state that cannot be proven from the repository alone: live DB rows, host nginx snippets outside the repo, seeded CLIP weights, and production environment variables were not inspected. No tests were run for this static documentation review; existing cycle-10 review artifacts report full code gates separately.
