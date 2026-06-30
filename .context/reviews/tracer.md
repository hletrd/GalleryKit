# Tracer Review - Cycle 25

Review lane: `cycle-25 tracer`
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `4cb1258ba0b2cca689846a85423264edc2d96b90`
Mode: review-only. No commit or push was performed.

## Required Context

Read first, before tracing:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

## File Inventory

Tracked file inventory was built before the causal trace.

- Total tracked files: 2585.
- Largest tracked buckets:
  - `.context/reviews/archive/`: 954
  - `apps/web/src/__tests__/`: 269
  - `plan/`: 103
  - `apps/web/src/lib/`: 94
  - `plan/done/`: 75
  - `.context/plans/done/`: 56
  - `apps/web/src/components/`: 34
  - `apps/web/drizzle/`: 28
  - `.context/plans/`: 28
  - `apps/web/scripts/`: 27
- Trace surfaces reviewed for this report:
  - Upload, processing, and serving: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/next.config.ts`.
  - Public analytics and public reads: `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/view-retention.ts`, `apps/web/src/lib/rate-limit.ts`, public route files under `apps/web/src/app/api/`.
  - Auth/session/admin gates: `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`, `apps/web/src/lib/api-auth.ts`.
  - DB backup/restore/migrations: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/**`.
  - Semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/download-clip-models.ts`.
  - Backfill: `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/app/actions/admin-backfill.ts`.
  - Deploy: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/docker-compose.yml`, root deploy/env docs.

Validation commands run:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.

Full lint, typecheck, build, Vitest, and Playwright were not run. This was a static causal trace plus the three policy scanners above.

## Confirmed Findings

### TRC25-01 - Failed DB restore safety is process-local while cross-process locks are released

Severity: High
Confidence: High

Exact file/region:

- `apps/web/src/app/[locale]/admin/db-actions.ts:388-524`
- `apps/web/src/app/[locale]/admin/db-actions.ts:651-731`
- `apps/web/src/lib/restore-maintenance.ts:1-56`
- Cross-process sidecar examples that do not check restore maintenance: `apps/web/scripts/backfill-color-pipeline.ts:304-327`, `apps/web/scripts/backfill-clip-embeddings.ts:98-119`

Causal chain:

1. `restoreDatabase` acquires DB restore, upload-processing, color-backfill, and semantic-backfill advisory locks before import: `apps/web/src/app/[locale]/admin/db-actions.ts:388-445`.
2. It then calls `beginRestoreMaintenance`, which only sets process-local `globalThis` state: `apps/web/src/app/[locale]/admin/db-actions.ts:447-480`, `apps/web/src/lib/restore-maintenance.ts:1-56`.
3. If `mysql` import or post-restore migration fails, `runRestore` returns `keepMaintenance: true`: `apps/web/src/app/[locale]/admin/db-actions.ts:670-731`.
4. The outer `finally` correctly leaves process-local maintenance enabled when `keepMaintenance` is true, but still releases the DB restore, upload-processing, color-backfill, and semantic-backfill locks: `apps/web/src/app/[locale]/admin/db-actions.ts:496-524`.
5. Because the remaining maintenance state is only in memory, a web process restart clears it. Sidecar scripts never consult it. After lock release, those sidecars can also acquire their own locks.

Concrete failure scenario:

An admin uploads a restore dump that passes the SQL scanner but is truncated or fails midway after applying destructive dump statements such as allowed app-table drops/recreates. The restore action returns failure and keeps the current web process in maintenance. A deploy restart, crash restart, or manual container restart clears the in-memory flag. The restarted app begins accepting admin/public flows against a partially restored DB. Independently, a sidecar backfill can run after the locks are released and mutate image rows or embeddings on the partial schema/data set.

Suggested fix:

Persist restore maintenance outside the DB being restored, for example a host-mounted sentinel under `apps/web/data/restore-maintenance.json` or another durable store not overwritten by the import. Write it before invoking `mysql`, clear it only after successful import plus post-restore migrations, and have app startup, mutating actions, upload queue bootstrap, and sidecar backfill scripts check it. Keep advisory locks for concurrency, but do not rely on released locks or process-local memory as the durable failed-restore barrier. Add a regression test or integration harness that simulates a restore failure, restarts the app process, and proves uploads/backfills stay blocked until explicit recovery clears the sentinel.

## Refuted Hypotheses

- Upload quota claim leak after partial browser upload failure: refuted. `uploadImages` uses a single `settleClaim` closure and settles known post-claim failure exits, including topic lookup failure, save failure, DB insert failure, queue failure, and final success: `apps/web/src/app/actions/images.ts:191-627`.
- Original upload path traversal or public original exposure: refuted. Originals are under the private upload root, filenames are safe-checked, realpath containment and symlink rejection are enforced, and public serving is restricted to derivative/resource directories: `apps/web/src/lib/upload-paths.ts:12-184`, `apps/web/src/lib/serve-upload.ts:126-195`.
- Queue/delete race leaves orphaned processed files: refuted. The queue rechecks `processed=false`, performs a conditional update, and removes generated variants if the DB row was deleted or changed mid-process: `apps/web/src/lib/image-queue.ts:554-692`.
- Middleware cookie shape check is an auth bypass: refuted. The middleware only rejects obviously unauthenticated admin page requests; protected admin layout and admin API routes perform cryptographic/session authorization: `apps/web/src/proxy.ts:52-105`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:12-15`, `apps/web/src/lib/api-auth.ts:58-144`.
- Public analytics writes accept arbitrary target IDs: refuted. Photo, topic, and shared-group view actions validate IDs/keys and verify processed/non-expired target state before insert: `apps/web/src/app/actions/public.ts:370-460`.
- Public semantic search is enabled accidentally in production: refuted. `getGalleryConfig` heals production semantic mode to disabled unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, and the route checks mode before parsing/running embeddings: `apps/web/src/lib/gallery-config.ts:123-142`, `apps/web/src/app/api/search/semantic/route.ts:186-204`.
- Stub embeddings contaminate production semantic results: refuted. Semantic routes filter active rows by production model version; stub scoring is used only for stub mode: `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:132-180`.
- Sidecar color backfill races normal foreground processing for the same pending image: refuted for the current code path. Sidecar candidates require `processed=TRUE`, while foreground queue and retry operate on `processed=FALSE`; in-app backfill also has a per-image processing lock: `apps/web/scripts/backfill-color-pipeline.ts:337-348`, `apps/web/src/app/actions/images.ts:1228`, `apps/web/src/lib/admin-backfill-runner.ts:348-423`.
- Deploy prune removes live app data: refuted. Deploy runs `docker compose up -d --build` before pruning, persisted directories are bind-mounted, and volume prune is not run with `-a`: `apps/web/deploy.sh:28-59`, `apps/web/docker-compose.yml:1-28`.
- Admin API or mutating server action missing provenance/auth wrappers: refuted by scanners. `lint:api-auth`, `lint:action-origin`, and `lint:public-route-rate-limit` all passed.

## Residual Watchlist

- The app still has several documented process-local assumptions: upload tracker state, restore maintenance, queue state, in-memory public rate limits, and shared-group view buffering. This review files only the failed-restore durability issue because it has a concrete partial-restore corruption path. If future deployment becomes multi-writer, these assumptions need a broader durable coordination pass.
- Foreground image processing holds an advisory-lock DB connection across Sharp work in `apps/web/src/lib/image-queue.ts:446-815`. Cycle 24 already filed this as a pool-pressure risk. I did not re-file it as a new cycle-25 finding.

## Final Missed-Issue Sweep

Final sweep rechecked the requested competing flows: upload to process to serve, public analytics, auth/session, DB restore, semantic search, color and CLIP backfill, and deploy.

Missed-issue probes performed:

- Re-read the full restore path after the initial finding to verify whether any durable flag, boot-time check, or sidecar check existed. None was found.
- Rechecked upload cleanup, derivative serving, and original path containment after the restore finding to avoid overfitting on one subsystem.
- Rechecked semantic production gates and model-version filters after reading both public search routes and CLIP scripts.
- Rechecked backfill candidate predicates and affected-row cleanup for delete/race scenarios.
- Ran the three custom policy scanners for admin API auth, server-action origin checks, and public mutating route rate limits.

Scope limits:

- No production host, live DB, upload data, binary fixtures, screenshots, `.next`, or `node_modules` state was inspected.
- No source code was changed.
- No commit or push was performed.
