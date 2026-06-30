# Cycle 28 Architect Review

Date: 2026-06-30
Reviewer role: architect
Repository head reviewed: `e08e6a34`
Scope: repository-wide architecture/design review only. No fixes implemented.

## Inventory Examined First

I reviewed the repo from the architecture concerns requested: layering, ownership boundaries, coupling, runtime topology, mutable storage contracts, migration/reconcile design, queue/restore coordination, data/public privacy boundaries, frontend architecture, and deployment architecture.

Full tracked review corpus was enumerated before findings. The enumerated review list contained 880 tracked, text, review-relevant files after excluding generated build output, dependency folders, binary/media fixtures, and transient test artifacts. Generated assets and media are not architecture/control-surface sources and were intentionally excluded.

Documentation and review history examined:
- `AGENTS.md` from the prompt and project rules.
- `CLAUDE.md`, especially tech stack, runtime topology, mutable storage, migration/reconcile, restore, privacy, deploy, and operational sections.
- `.context/reviews/architect.md` previous-cycle report.
- `.context/reviews/_aggregate.md`.
- `.context/reviews/archive/_aggregate-cycle27.md`.
- `.context/plans/**` and `plan/**` were enumerated as historical planning context; the current architecture conclusions rely on the current source/config/docs plus the previous cycle aggregate/review summaries above.

Runtime and application source examined:
- `apps/web/src/app/**`: 77 tracked app-route/action/page/layout files, including admin DB actions, public pages, public actions, admin actions, upload API, search API, health/live API, proxy, providers, and layouts.
- `apps/web/src/lib/**`: 98 tracked library files, including data access, privacy field selection, image processing, upload paths, queue, restore maintenance, storage quarantine, rate limiting, auth/session, CSP, semantic search, settings, backup/restore helpers, and deployment-facing runtime helpers.
- `apps/web/src/components/**`: 58 tracked frontend component files, reviewed for client/server boundaries, public/admin ownership, data-shape expectations, and direct mutable-storage coupling.
- `apps/web/src/types/**`, `apps/web/src/i18n/**`, `apps/web/src/hooks/**`, and other tracked source support files included by the corpus enumeration.

Schema, migrations, scripts, deployment, and tests examined:
- `apps/web/src/db/schema.ts`.
- `apps/web/drizzle/**`: 31 tracked migration and metadata files, including `meta/_journal.json` and SQL migrations `0000` through `0027`.
- `apps/web/scripts/**`: 29 tracked operational scripts, including `migrate.js`, restore maintenance recovery scripts, entrypoint, seed/backfill utilities, and deploy-adjacent scripts.
- `scripts/deploy-remote.sh`.
- Deployment/config files: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, package manifests, tsconfig/eslint/vitest/playwright configs, and root workspace config.
- Tests: 273 tracked `apps/web/src/__tests__/**` files and 6 tracked `apps/web/e2e/**` files, reviewed for architectural tripwires and coverage of the contracts above.

Architecture hotspots read in detail:
- Restore and backup: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/scripts/restore-maintenance-recovery.ts`, `apps/web/scripts/restore-maintenance-recovery.mjs`.
- Queue/restore/shutdown: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/instrumentation.ts`, queue and restore tests.
- Upload/storage: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/storage/**`, upload/storage tests.
- Migration/reconcile: `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, migration journal and reconcile coverage tests.
- Privacy/public data: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, public search routes, timeline/map code, privacy/search/map tests.
- Frontend architecture: public/admin route trees, client components, gallery/detail/shared-group/topic/map pages, admin pages, providers, i18n, and client/server boundary tests.
- Deployment topology: Dockerfile, entrypoint, compose file, nginx config, deploy scripts, Next standalone config, CSP/proxy config, and CLAUDE deploy runbook.

## Findings

### C28-ARCH-01: Public analytics writes are outside the restore quiesce/drain contract

Severity: Medium
Confidence: Medium
Classification: Likely issue

Evidence:
- `apps/web/src/app/actions/public.ts:408-437` documents `recordPhotoView` as intentionally fire-and-forget and starts `db.insert(imageViews).values(...).catch(...)` without awaiting it.
- `apps/web/src/app/actions/public.ts:443-469` does the same for `topicViews`.
- `apps/web/src/app/actions/public.ts:475-504` does the same for `sharedGroupViews`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:491-495` prepares the restore window by flushing `flushBufferedSharedGroupViewCounts()` and quiescing `quiesceImageProcessingQueueForRestore()`, but it does not drain or pause the three public analytics insert promises.
- `apps/web/src/lib/image-queue.ts:1060-1088` shows the image queue has an explicit restore drain, including queue side effects. The public analytics path has no equivalent tracked side-effect set.
- `apps/web/src/instrumentation.ts:36-42` drains image processing and buffered shared-group counts on shutdown, but not the public view-event inserts.

Problem:
The restore design assumes mutable DB writers are stopped or drained before `runRestore` imports SQL. Image processing has a clear quiesce path, and shared-group count buffering has an explicit flush. Public analytics view-event inserts are a separate mutable writer class. The maintenance checks at `public.ts:418`, `public.ts:428`, `public.ts:451`, `public.ts:461`, `public.ts:480`, and `public.ts:497` reduce the race, but they do not close it: after the second check, each function can hand an untracked insert promise to the event loop while the restore action enters maintenance and starts importing.

Concrete failure scenario:
1. A public photo/detail/topic/shared page calls `void recordPhotoView(...)`, `void recordTopicView(...)`, or `void recordSharedGroupView(...)`.
2. The action passes validation and the second `isRestoreMaintenanceActive()` check.
3. Before the unawaited `db.insert(...Views)` finishes, an admin starts restore.
4. `restoreDatabase` begins durable maintenance and drains the image queue plus shared-group count buffer, but it has no handle for the in-flight analytics insert.
5. The analytics insert commits into a just-restored database, races with table truncate/drop/import state, or fails after restore logging has already moved on. Since errors are swallowed, operators may not notice that the restore boundary admitted a post-backup write.

Suggested fix:
Create a small analytics writer module with the same ownership pattern as queue side effects: track public view-event insert promises in a bounded `Set`, reject or no-op new analytics writes while restore maintenance is active, and expose `quiescePublicAnalyticsForRestore()` plus shutdown drain. Call that helper from `restoreDatabase` before `runRestore`, alongside `flushBufferedSharedGroupViewCounts()` and `quiesceImageProcessingQueueForRestore()`. Add a regression test that starts a delayed analytics insert, enters restore preparation, and proves restore preparation waits for or cancels the insert before import begins.

Notes:
Analytics can remain best-effort for page rendering. The missing contract is not that page rendering should await view events; it is that restore/shutdown need an authoritative drain for every background DB writer.

### C28-ARCH-02: Private original-upload directory mode is not enforced on normal runtime creation paths

Severity: Low
Confidence: High
Classification: Confirmed hardening gap with environment-dependent impact

Evidence:
- `apps/web/src/lib/upload-paths.ts:49-55` creates `UPLOAD_DIR_ORIGINAL`, `UPLOAD_DIR_WEBP`, `UPLOAD_DIR_AVIF`, and `UPLOAD_DIR_JPEG` with `fs.mkdir(dir, { recursive: true })`, using default process umask behavior.
- `apps/web/src/lib/process-image.ts:443-450` duplicates directory creation and also creates `UPLOAD_DIR_ORIGINAL` without an explicit mode or chmod.
- `apps/web/Dockerfile:132-135` creates `/app/data/uploads/original` but only applies ownership with `chown`; it does not set owner-only directory permissions.
- `apps/web/scripts/entrypoint.sh:16-24` ensures `/app/data/uploads/original` exists and is writable by `node`, but it does not tighten permissions.
- By contrast, `apps/web/scripts/migrate.js:77-82` explicitly creates and chmods the private original root to `0700` during legacy migration, and `apps/web/src/lib/process-image.ts:905-910` writes original files with `0600`.

Problem:
The design contract says originals live in a private data volume, outside the public web root. The file bytes are well protected by `0600` writes and by nginx blocking public `/uploads/original`. However, normal fresh-runtime and deploy paths do not enforce owner-only permissions on the original directory itself. On common umasks, a freshly created directory can be `0755`; on a multi-user host, shared volume, or sidecar container with host access, that can expose filename/ext/stat metadata and allow directory traversal/listing even though file reads remain blocked.

Concrete failure scenario:
1. A fresh host bind-mounts `./data` and starts the container before any legacy migration path tightens the directory mode.
2. Dockerfile or entrypoint creates `/app/data/uploads/original` with default directory permissions.
3. Original files are saved as random UUID filenames with `0600`, but the directory remains listable/traversable by non-owner principals on the same host namespace or an over-broad sidecar mount.
4. An operator or compromised low-privilege process cannot read file bytes, but can enumerate private-original inventory, extensions, counts, and timestamps, weakening the intended private-storage boundary.

Suggested fix:
Centralize upload-directory creation so derivative/public directories can remain normal web-readable directories while `UPLOAD_DIR_ORIGINAL` is always created and chmodded to `0700`. Use that helper from both `ensureUploadDirectories()` and `process-image`'s `ensureDirs()` path, or remove the duplicate creator. Tighten `/app/data/uploads/original` in `entrypoint.sh` and/or Dockerfile after `mkdir -p`. Add a source or unit test that asserts the original directory creation path includes `mode: 0o700` plus a chmod fallback, mirroring `migrate.js`.

Notes:
This is low severity because original file contents are created with `0600`, the public web path is blocked, and the primary risk is same-host metadata exposure. It is still an architecture gap because the private storage contract is currently enforced inconsistently across migration, runtime, and deploy layers.

## Verified Non-Findings And Architecture Notes

- SQL restore scanning is substantially hardened in `apps/web/src/lib/sql-restore-scan.ts`: backup-table allowlisting, schema-qualified write-target handling, dangerous temp-table patterns, comment stripping, and scan tests close the prior broad restore-injection class.
- Restore maintenance has a durable marker in `apps/web/src/lib/restore-maintenance-durable.ts` and the production Dockerfile copies the runnable `.mjs` recovery helper. `CLAUDE.md` documents that an external clear needs restart/redeploy because the JS helper cannot mutate another running process' in-memory state.
- Image processing queue restore coordination is explicit: `quiesceImageProcessingQueueForRestore()` pauses, clears queued jobs, waits for in-flight jobs, drains queue side effects, clears queue state, and forces post-restore bootstrap.
- Migration/reconcile design is intentionally idempotent. `apps/web/scripts/migrate.js` reconciles legacy/fresh schema, baselines every journal hash, and verifies postconditions. Tests cover journal monotonicity, schema/index mirrors, and removed-schema drops.
- Public/admin data privacy boundaries are strongly guarded. `publicSelectFields`, `publicMapSelectFields`, `searchEnrichmentSelectFields`, and timeline fields use explicit sensitive-key guards and matching tests. Search routes use the enrichment field set instead of ad hoc admin fields.
- The storage abstraction remains quarantined. Production upload paths still use `upload-paths`/`process-image`; scans found only tests importing `lib/storage`, and `storage-quarantine.test.ts` guards against wiring the incomplete abstraction into actions.
- Public API topology is narrow: admin routes use `withAdminAuth`, search routes are public but rate-limited/pre-incremented, and health/live routes are read-only.
- Deployment topology matches the documented single web container plus external MySQL model: Next standalone server, bind-mounted mutable stores, nginx fronting public assets/API, and deploy script health checks plus post-up pruning.

## Final Missed-Issues Sweep

Final sweep commands covered route auth/rate-limit shape, background DB writers, upload original storage modes, storage abstraction imports, privacy selector guards, migration/reconcile tripwires, restore queue drain, and deployment entrypoints. No additional architecture findings rose above the reporting threshold.

No relevant runtime source, schema/migration, deploy/config, test, or documentation control-surface file from the enumerated review corpus was intentionally skipped. Generated output, dependency folders, binary fixtures, and media assets were excluded as non-review-relevant artifacts.

## Summary

Finding count: 2

- Medium: 1 likely restore/analytics coordination issue.
- Low: 1 confirmed private-storage permission hardening gap.
