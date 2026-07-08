# Run-10 Cycle 33 Architect Review

Scope: architect lane review of module boundaries, data access, background jobs, migration/reconcile, and operational invariants. Source was inspected read-only; this file is the only artifact written.

Current HEAD observed: `959e45af docs(cycle32): 📝 align audit gate ledgers`.

## Inventory

- Runtime entrypoint: `apps/web/src/instrumentation.ts` starts durable restore marker sync, maintenance sweeps, image queue bootstrap, geoip prewarm, and the warn-only single-writer guard; shutdown drains image queue, maintenance sweeps, shared-group view buffers, tracked background DB writes, and the single-writer guard.
- Data access: `apps/web/src/db/index.ts` owns the MySQL pool and Drizzle binding; `apps/web/src/db/schema.ts` defines the schema; public/admin query shaping is concentrated in `apps/web/src/lib/data.ts`, with privacy guarded by typed public select fields and tests.
- Foreground admin mutations: `apps/web/src/app/actions/*` hold same-origin checks plus `acquireAdminMutationSlot()` unless explicitly read-only/exclusive. Restore is the exclusive side in `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Public writes: analytics actions in `apps/web/src/app/actions/public.ts` enqueue bounded tracked DB writes through `apps/web/src/lib/background-db-writes.ts`, which restore drains before import.
- Background jobs: image processing is `apps/web/src/lib/image-queue.ts`; in-app color backfill is `apps/web/src/lib/admin-backfill-runner.ts`; maintenance sweeps are `apps/web/src/lib/maintenance-scheduler.ts`; sidecar jobs live in `apps/web/scripts/backfill-*.ts`.
- Restore/runtime invariants: restore acquires DB restore, upload-processing, color-backfill, and semantic-backfill advisory locks before setting durable maintenance, then drains shared-group view counts, image queue, background DB writes, maintenance sweeps, and admin mutations before import.
- Migration/reconcile: `apps/web/scripts/migrate.js` keeps the current DDL mirror in `reconcileLegacySchema`, refuses DML-bearing baselines outside the explicit allowlist, splits true drift from above-cursor pending migrations, and post-checks every journal hash after Drizzle.

## Findings

### ARCH-C33-01 - Medium - Alt-text sidecar can write across a restore window

- Confidence: High
- Evidence:
  - `apps/web/scripts/backfill-alt-text.ts:56` checks the durable restore marker only at script start.
  - `apps/web/scripts/backfill-alt-text.ts:80`-`105` polls the marker before each batch/chunk.
  - `apps/web/scripts/backfill-alt-text.ts:115`-`117` then writes `images.alt_text_suggested` with no advisory lock or restore-drain participation.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:498`-`543` serializes restore against color and semantic backfills, but there is no equivalent alt-text backfill lock in `apps/web/src/lib/advisory-locks.ts:45`-`49` or restore acquisition.
- Scenario: an operator starts `npx tsx scripts/backfill-alt-text.ts --force`. The script passes `assertNoDurableRestoreMaintenanceForScript()` at line 104, begins generating a caption, and then restore starts in the web process. Restore acquires its existing locks, sets the durable marker, drains the known in-process writers, and imports the dump. Because this sidecar is neither holding a restore-visible advisory lock nor tracked by an in-process drain, its line 115 update can land after the marker flips and potentially after import begins/completes, reintroducing `alt_text_suggested` from the pre-restore database state into the restored database.
- Architectural impact: this violates the restore checklist contract documented in `apps/web/src/lib/restore-drain-checklist.ts:10`-`17`: every DB writer must either be drained or blocked before the import replaces tables. Marker polling narrows the race but does not close the check-to-write gap for a cross-process sidecar.
- Bounded fix: add a centralized `LOCK_ALT_TEXT_BACKFILL` advisory lock, have `backfill-alt-text.ts` acquire it for the full run, and have `restoreDatabase()` acquire/fail-fast on that lock alongside the color and semantic backfill locks before `beginDurableRestoreMaintenance()`. Add a source/behavior contract test mirroring `backfill-clip-embeddings-reembed.test.ts` so future DB-mutating sidecars must be restore-serialized, not just marker-polled.

## Non-Findings

- Migration/reconcile drift handling is current in source: pending-vs-drift split, DML-baseline refusal, and post-migration hash assertions are present in `apps/web/scripts/migrate.js`; no new migration/reconcile defect was confirmed.
- The restore mutation barrier for foreground admin actions is present and lint-enforced; I did not reopen older C77-style foreground mutation findings.
- Color and semantic sidecar backfills are restore-serialized by advisory locks; the confirmed gap is specific to the alt-text sidecar writer.
