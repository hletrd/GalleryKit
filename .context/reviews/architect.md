# Architect Review - Cycle 9

Review target: current `HEAD`, `2506c5f7acf56e253877e8d4a26f16ef697c3468`.

I read `AGENTS.md` and `CLAUDE.md` before inspecting the repository. This architect lane intentionally changed only this review artifact; source code and plans were not edited.

## Inventory Built Before Findings

Review-relevant inventory at current `HEAD`:

- Repo operating docs and authority: `AGENTS.md`, `CLAUDE.md`, root workspace package files, deploy policy, migration runbook, and `.context/reviews/**` conventions.
- Executable app surface: all 75 TypeScript/TSX files under `apps/web/src/app`, including public pages, admin pages, server actions, and API route handlers.
- Data/domain layer: all 95 TypeScript/TSX files under `apps/web/src/lib`, plus `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, and all schema consumers that select public/admin image fields.
- UI/client boundary: all component files under `apps/web/src/components`, reviewed for ownership boundaries where client components call server actions or render public/admin data.
- Schema, migrations, deploy, and generated artifacts: all `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, operational scripts under `apps/web/scripts/**`, `scripts/deploy-remote.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, service-worker template/build output, and config/typecheck/lint scripts.
- Tests/contracts: all 255 test files under `apps/web/src/__tests__`, with targeted reads of migration/reconcile, privacy fields, public route rate limiting, action-origin, upload/restore locks, image queue failures, generated service-worker contracts, semantic search, and restore scanner coverage.
- Total reviewed code/config artifact set for the current app/deploy/schema surface: 554 files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/nginx`, and `apps/web/public` with relevant source/config extensions.

I excluded generated `.next/`, `node_modules/`, binary screenshots/fixtures, secrets, and historical scratch material that does not define current behavior. The review was cross-file and not sampled: I traced upload -> queue -> derivative generation -> DB state -> public serving, restore/maintenance, analytics writes/retention, semantic-search backfill/querying, admin/public auth boundaries, deploy topology, migration baselining, and generated artifact contracts. Final missed-issue sweeps used repository-wide `rg` passes over auth/origin/rate-limit hooks, raw SQL/advisory locks, config fallbacks, migration/reconcile/index terms, process-local state, embedding/processing state, and generated-artifact drift.

## Confirmed Issues

### ARCH-C9-01 - Analytics retention deletes do not have a leftmost `viewed_at` index

Severity: Medium
Confidence: High
Status: Confirmed
Area: schema/migration design, retention topology, long-term operability

Evidence:

- `apps/web/src/lib/view-retention.ts:56-59` says retention deletes use the existing composite indexes for the range scan.
- The actual purge loop deletes each analytics table with only `WHERE viewed_at < cutoff LIMIT 5000` at `apps/web/src/lib/view-retention.ts:70-81`.
- `image_views` indexes begin with `image_id` or `bot`, not `viewed_at`, at `apps/web/src/db/schema.ts:231-235`.
- `topic_views` indexes begin with `topic` or `bot`, not `viewed_at`, at `apps/web/src/db/schema.ts:245-248`.
- `shared_group_views` indexes begin with `group_id` or `bot`, not `viewed_at`, at `apps/web/src/db/schema.ts:257-259`.
- The legacy/fresh-DB reconciler mirrors the same index set without any `viewed_at`-leading retention index at `apps/web/scripts/migrate.js:560-612`.
- The latest analytics top-view migration adds `bot, viewed_at, ...` indexes at `apps/web/drizzle/0026_analytics_top_view_indexes.sql:1-3`; those help bot-filtered top-view queries, but they still do not provide a leftmost `viewed_at` range for the retention query.

Why this is a problem:

Retention is the safety valve for anonymous analytics tables that public endpoints can grow indefinitely over time. MySQL cannot seek a `viewed_at`-only range through indexes whose first column is `image_id`, `topic`, `group_id`, or `bot` unless the query also constrains that first column. Chunking the delete to 5000 rows limits statement size, but it does not fix the access path; each chunk can still scan a large share of the table as the data grows.

Concrete failure scenario:

A long-running deployment accumulates millions of image/topic/shared-group view rows. When rows age past the 395-day retention window, the hourly maintenance sweep runs `DELETE ... WHERE viewed_at < cutoff LIMIT 5000` against tables that have no `viewed_at`-leading index. The single MySQL writer spends repeated chunks scanning analytics tables, contends with live public analytics inserts and reads, and turns the retention job from a disk-pressure mitigation into a periodic load spike.

Suggested fix:

Add explicit retention indexes with `viewed_at` as the leftmost column for all three event tables, for example `idx_image_views_viewed_at`, `idx_topic_views_viewed_at`, and `idx_shared_group_views_viewed_at`. Ship them through a new Drizzle migration, append the journal entry with a strictly increasing `when`, mirror them in `reconcileLegacySchema` via `ensureIndex`, and add/extend a test that asserts every retention delete predicate has a matching leftmost index. If avoiding new indexes is preferred, rewrite the purge to constrain existing leftmost columns deliberately, such as bot-partitioned deletes for the bot-first indexes, but that is more complex and still leaves topic/group/image key iteration to manage.

## Likely Issues

None beyond the confirmed issue above.

## Risks Needing Manual Validation

### ARCH-C9-RISK-01 - Horizontal scaling would break process-local coordination assumptions

Severity: Medium
Confidence: High
Status: Risk needing manual validation
Area: deploy topology, queue/restore ownership

Evidence:

- Restore maintenance is a process-local `globalThis` flag at `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Image processing queue ownership, enqueued IDs, retry maps, bootstrap cursor, and side effects are process-local state at `apps/web/src/lib/image-queue.ts:249-323`.
- Shared-group view count buffering is process-local at `apps/web/src/lib/data.ts:12-34`.
- Several public rate limits are in-memory maps, including OG/share/semantic buckets at `apps/web/src/lib/rate-limit.ts:68-89` and `apps/web/src/lib/rate-limit.ts:312-318`, while login/search use DB-backed state as the durable source.
- The documented deployment is a single web container on host networking at `apps/web/docker-compose.yml:11-21`.

Concrete failure scenario:

An operator scales the web app to two Node processes or two containers without moving these primitives to a shared coordinator. One process can enter restore maintenance while another still accepts uploads or drains the queue; duplicate image-processing jobs can run for the same pending row; buffered shared-group counts can be lost on one process; public in-memory rate limits become per-process instead of per-service. Current docs describe a single-instance topology, so this is not a current defect, but it is a hard architecture constraint.

Suggested fix:

Keep the one-web-instance deployment invariant explicit in operations docs and health checks. Before any horizontal scale-out, move restore maintenance state, queue claims/retries, public rate-limit buckets, and buffered counters to shared storage or a coordinator such as MySQL rows/advisory locks, Redis, or a dedicated worker queue. Add a startup assertion or deploy note if the runtime can detect multiple replicas.

### ARCH-C9-RISK-02 - Database restore does not validate filesystem snapshot consistency

Severity: Medium
Confidence: Medium
Status: Risk needing manual validation
Area: restore topology, data ownership

Evidence:

- Restore imports only the SQL dump into MySQL with `mysql --one-database` at `apps/web/src/app/[locale]/admin/db-actions.ts:514-520`, then runs post-restore migrations at `apps/web/src/app/[locale]/admin/db-actions.ts:553-560` and `apps/web/src/app/[locale]/admin/db-actions.ts:604-631`.
- Uploaded originals, derivatives, resources, and app data are persistent bind mounts at `apps/web/docker-compose.yml:23-27`, not part of the SQL restore path.
- The restore flow does quiesce upload/processing work and holds advisory locks at `apps/web/src/app/[locale]/admin/db-actions.ts:294-397`, so the issue is snapshot scope, not concurrent mutation.

Concrete failure scenario:

An operator restores a SQL dump from a different point in time than the `public/uploads` bind mount. The database can then reference original or derivative filenames that do not exist on disk, or disk can contain orphaned files no longer referenced by DB rows. Public image pages may 404 derivatives, processing retries may fail because originals are missing, and a rollback may appear successful until users hit missing media.

Suggested fix:

Treat database restore as one half of a restore runbook unless the operation is intentionally DB-only. Add an operator checklist or validation command that compares DB image filenames to bind-mounted files after restore, and document the required pairing between SQL dumps and filesystem snapshots. Longer term, add a non-mutating reconcile report for missing/orphaned originals and derivatives before allowing maintenance mode to exit.

### ARCH-C9-RISK-03 - Production semantic search depends on external operator alignment

Severity: Low
Confidence: Medium
Status: Risk needing manual validation
Area: config authority, generated/model artifacts

Evidence:

- Production semantic mode is intentionally gated by the DB setting plus `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` at `apps/web/src/lib/gallery-config.ts:123-141`.
- Runtime CLIP loading is offline-only and reads from `CLIP_MODELS_ROOT` with `env.allowRemoteModels = false` at `apps/web/src/lib/clip-model.ts:77-114`.
- The backfill script chooses stub vs production model version from flags and exits unless semantic mode is enabled or `--force` is passed at `apps/web/scripts/backfill-clip-embeddings.ts:77-100`.

Concrete failure scenario:

An operator enables the DB setting and env flag but has not seeded the expected model weights, or runs the backfill in stub mode while routes query the production model version. The production semantic routes stay gated and safe, but user-visible semantic search returns empty/error-like states until weights, env, DB setting, and embedding rows are aligned.

Suggested fix:

Keep this as an operational validation item: after deploy, verify `CLIP_MODELS_ROOT`, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, the DB setting, and a nonzero count of embeddings at `PRODUCTION_MODEL_VERSION`. A small admin diagnostics endpoint or script could make the current activation state explicit.

## False Positives / Already Fixed

### ARCH-C9-FP-01 - Upload config fail-open privacy path is fixed

Severity: High if regressed
Confidence: High
Status: Already fixed

Current evidence:

- Non-mutating reads still have a fallback reader at `apps/web/src/lib/gallery-config.ts:184-191`.
- Ingest/write paths now have strict config ownership via `getGalleryConfigStrict()` at `apps/web/src/lib/gallery-config.ts:194-200`.
- Browser uploads fail closed on strict config read failure at `apps/web/src/app/actions/images.ts:181-188`.
- Lightroom uploads fail closed on strict config read failure at `apps/web/src/app/api/admin/lr/upload/route.ts:241-251`.

This closes the old concern that upload privacy settings could silently fall back to defaults while the rest of the upload succeeded.

### ARCH-C9-FP-02 - Upload-time processing settings are now durable across restart

Severity: Medium if regressed
Confidence: High
Status: Already fixed

Current evidence:

- `processing_settings_json` is part of the image schema at `apps/web/src/db/schema.ts:106-108`.
- Browser uploads persist the serialized processing snapshot before enqueue at `apps/web/src/app/actions/images.ts:419`.
- Lightroom uploads persist the same snapshot at `apps/web/src/app/api/admin/lr/upload/route.ts:424`.
- Queue bootstrap selects and applies the snapshot at `apps/web/src/lib/image-queue.ts:838-881`.
- Successful processing clears the internal snapshot at `apps/web/src/lib/image-queue.ts:559`.

This closes the old concern that pending rows reconstructed after process restart would be processed under newer admin settings instead of the upload-time contract.

### ARCH-C9-FP-03 - Failed image retry state is no longer split only across DB and memory

Severity: Medium if regressed
Confidence: High
Status: Already fixed

Current evidence:

- Permanent failure diagnostics live in DB fields at `apps/web/src/db/schema.ts:101-108`.
- Bootstrap excludes rows with `processing_error` at `apps/web/src/lib/image-queue.ts:823-834`, preventing deploy-time infinite requeue loops.
- Admin retry requires the persisted failed state, captures a fresh strict processing snapshot, clears failure columns, and resets in-memory queue maps at `apps/web/src/app/actions/images.ts:1141-1210`.

This closes the old concern that deploy/restart would forget permanent failure state and automatically retry failed rows forever.

### ARCH-C9-FP-04 - Public/admin privacy field ownership is guarded

Severity: High if regressed
Confidence: High
Status: Already fixed / no current issue found

Current evidence:

- Admin field selection is explicitly full-surface at `apps/web/src/lib/data.ts:250-326`.
- Public selection is derived by omission and excludes sensitive/internal fields at `apps/web/src/lib/data.ts:367-407`.
- The map-specific public select is the only public latitude/longitude surface and is documented as requiring topic-level `map_visible` filtering at `apps/web/src/lib/data.ts:409-444`.
- Compile-time privacy guards cover `publicSelectFields` and `publicMapSelectFields` at `apps/web/src/lib/data.ts:458-488`.

I found no current architecture finding in the public/admin image-field boundary.

### ARCH-C9-FP-05 - Service worker generation drift is contract-tested

Severity: Low if regressed
Confidence: High
Status: Already fixed / no current issue found

Current evidence:

- `apps/web/scripts/build-sw.ts:49-56` generates `public/sw.js` from `public/sw.template.js` and stamps the version.
- The generated service worker is checked for the same bounded HEAD probe contract as the template at `apps/web/src/__tests__/sw-template-contract.test.ts:163-167`.
- Local `.omc` agent artifacts are ignored by both git and Docker at `.gitignore:16` and `.dockerignore:6`; `.context/reviews/**` remains intentionally tracked by `.gitignore:19-21`.

I did not find a current generated-artifact ownership defect.

## Final Missed-Issue Sweep

Final sweep performed:

- Re-checked public/admin selector ownership, compile-time privacy guards, and search-enrichment field mirrors.
- Re-checked admin API auth wrappers, mutating server-action same-origin guards, and public mutating route rate-limit contracts.
- Re-checked browser upload and Lightroom upload parity for strict config, GPS stripping, persisted processing snapshots, and enqueue parameters.
- Re-checked queue bootstrap, permanent failure state, admin retry, restore quiesce/resume, and advisory-lock session ownership.
- Re-checked DB restore scanner, restore maintenance flow, post-restore migration path, and filesystem-vs-DB restore boundary.
- Re-checked migration journal/reconcile coverage for current schema columns, indexes, and app tables.
- Re-checked analytics write/read/retention topology and confirmed only `ARCH-C9-01` remains actionable.
- Re-checked semantic search gates, offline model loading, backfill model-version ownership, and route enrichment privacy.
- Re-checked deploy persistence assumptions: bind mounts, host MySQL, one web instance, Nginx upload caps, remote deploy helper, Docker prune-after-up behavior, and generated service-worker output.

No source fixes were implemented in this architect lane. Full lint/typecheck/build/test gates were not run because this was a documentation-only architecture review, but the cited evidence was read from the current working tree.
