# Cycle 22 Architect Review

Role: architect
Reviewed HEAD: `8b795862079b0e5318242a09390b4cdff1dc2058`
Status: review-only; no fixes implemented.

## Inventory

Relevant files/categories inspected:

- Runtime topology and deploy boundary: `CLAUDE.md`, `AGENTS.md`, `README.md`, `apps/web/README.md`, `package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`.
- Data model and migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/0030_pending_file_deletions.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/sql-restore-scan.ts`.
- Mutation and restore boundaries: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/maintenance-scheduler.ts`.
- New Cycle 21 deletion-ledger path: `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/components/image-manager.tsx`, `apps/web/messages/{en,ko}.json`, `apps/web/src/__tests__/pending-file-deletions-source.test.ts`.
- Current planning/register docs: `.context/plans/README.md`, `.context/plans/cycle-21-2026-07-08-plan.md`, `.context/plans/cycle-21-2026-07-08-deferred.md`, `.context/plans/deferred-carry-forward.md`.

## Findings

### ARCH-C22-01 - Durable deleted-file ledger has no durable drain path

Severity: High
Confidence: High
Status: confirmed

Evidence:

- `apps/web/src/app/actions/images.ts:677-727` inserts a `pending_file_deletions` row before deleting a single image row, then calls `cleanupPendingFileDeletion()` only once in the same request.
- `apps/web/src/app/actions/images.ts:808-907` repeats the same pattern for batch deletes: insert ledger rows, delete image rows, run cleanup for the current batch only, and return success with `cleanupFailureCount`.
- `apps/web/src/lib/pending-file-deletions.ts:70-90` deletes the ledger row only on full cleanup success; on failure it increments `attempts` and stores `last_error`.
- `apps/web/src/lib/maintenance-scheduler.ts:34-45` runs session, revocation, rate-limit, audit, and view-retention maintenance only. It never selects or retries `pending_file_deletions`.
- Repo search found no other consumer of `cleanupPendingFileDeletion()` beyond the initiating delete actions and source-contract tests.

Failure scenario:

An admin deletes a photo while the upload filesystem has a transient NFS, permission, ENOSPC, or stale-handle failure. The DB row is gone and the admin receives success plus a warning, but the public derivative files can remain under `/uploads/{webp,avif,jpeg}`. The retained DB ledger row is not drained on the next hourly maintenance sweep, boot, deploy restart, or restore recovery, so known public files can stay reachable by direct URL indefinitely unless an operator manually reverse-engineers the table and helper.

Concrete fix:

Add a real drain for `pending_file_deletions`: a bounded maintenance task and/or explicit operator script that pages rows by `updated_at`, calls `cleanupPendingFileDeletion()`, applies backoff/max-attempt policy, and logs remaining failures. Add behavior tests with mocked filesystem + DB rows proving a failed delete is retried and removed after later success. Wire restore/deploy docs to the same command so the row is actionable, not just durable.

### ARCH-C22-02 - Pending deletion state is now part of restore/backup state but not part of restore recovery

Severity: Medium
Confidence: High
Status: confirmed risk

Evidence:

- `apps/web/src/lib/sql-restore-scan.ts:12-32` includes `pending_file_deletions` in `APP_BACKUP_TABLES`, so the app's own SQL backups/restores preserve the table.
- `apps/web/src/app/[locale]/admin/db-actions.ts:593-635` drains shared-group view buffers, image queue, background DB writes, maintenance sweeps, and foreground mutations before restore. It has no post-restore stage for stale pending deletion rows.
- `apps/web/src/app/[locale]/admin/db-actions.ts:654-670` clears restore maintenance and flushes pending session revocations after successful restore; no analogous flush exists for pending file deletions.
- `apps/web/src/lib/maintenance-scheduler.ts:34-45` also has no later retry path after restore resumes normal operation.

Failure scenario:

A backup taken while `pending_file_deletions` contains rows is later restored. Because database restore is explicitly row-only and does not roll back the filesystem, restored rows may describe files that still need deletion in the current host storage. The app preserves the rows but never consumes them, so restore can reintroduce "known dirty" cleanup state without any recovery action.

Concrete fix:

Once ARCH-C22-01 adds a drain, call or schedule it after successful restore maintenance clears, with the same restore-active guard used by session revocations. Document whether restored pending deletions are expected to be drained automatically or operator-triggered.

## Confirmed Healthy Invariants

- Migration mirror for the new table exists in all required places: schema (`apps/web/src/db/schema.ts:134-153`), SQL migration (`apps/web/drizzle/0030_pending_file_deletions.sql:1-19`), and reconcile (`apps/web/scripts/migrate.js:486-502`).
- The backfill-candidate index is represented in schema (`apps/web/src/db/schema.ts:127`), migration (`apps/web/drizzle/0030_pending_file_deletions.sql:19`), and reconcile (`apps/web/scripts/migrate.js:724`).
- The public nginx/app topology remains explicitly single-instance and edge-rate-limited by documented operator boundary (`CLAUDE.md:245-247`, `apps/web/nginx/default.conf:1-29`, `apps/web/docker-compose.yml:15-23`).
- Restore's mutation barrier and drain checklist are still centralized in `restoreDatabase()` (`apps/web/src/app/[locale]/admin/db-actions.ts:580-635`) rather than spread across actions.

## Missed-Issue Sweep

Checked for:

- Unmirrored Cycle 21 schema additions.
- New advisory-lock or restore-drain surfaces.
- New public route/deploy topology changes.
- New docs that present scale-out, S3/MinIO, Lightroom plugin, edit/cull/scoring, or semantic-search production mode as default-supported.
- New source-contract-only tests around Cycle 21 changes.

No additional confirmed architecture findings from that sweep.

## Uninspected Categories

- Live production host state: nginx applied config, `npm run deploy` transcript, Docker health logs, live smoke, MySQL row counts, pending deletion rows.
- Full runtime gates were not re-run for this review lane.
- Browser/visual behavior was not rechecked; this lane focused on architecture and docs/source consistency.
