# Cycle 78 Architect/Debugger/Tracer Review

HEAD reviewed: `9286bef16f3401fb0d8c17f52de5c96804c04533`.

## Inventory

- Fresh tracing on OG/feed cache freshness, color backfill row-deletion races, restore maintenance barriers, upload/action ordering, image queue state transitions, and migration reconciliation.
- Prior deferred baseline checked through Cycle 77 aggregate/deferred notes.

## Findings

No new confirmed findings in this lane.

## Trace Evidence

- Per-photo OG freshness now includes row freshness, sorted size config, color settings hash, pipeline version, title, and site title in the ETag path: `apps/web/src/app/api/og/photo/[id]/route.tsx`.
- CLI color backfill verifies zero-row updates against row existence before sidecar cleanup and bumps `updated_at` on both success and derivative-only re-encode paths: `apps/web/scripts/backfill-color-pipeline.ts`.
- Admin backfill runner mirrors the same live-row protection before deleting generated variants: `apps/web/src/lib/admin-backfill-runner.ts`.
- Upload paths fence restore maintenance before and after expensive work, then acquire the upload-processing contract lock before DB insert/enqueue: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Image queue claims per-image processing locks, confirms the row is still pending, writes processed state and pipeline version, and cleans variants only after a missed update: `apps/web/src/lib/image-queue.ts`.
- Restore flow holds DB, upload, color backfill, and semantic backfill locks before durable maintenance/import work: `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Migration reconciliation baselines journal hashes after schema reconciliation and asserts every committed journal hash is recorded: `apps/web/scripts/migrate.js`.

## Deferred Not Re-Raised

- `C77-ARCH-01` remains a known deferred architecture item: restore maintenance does not globally drain every already-started foreground non-upload admin mutation. Cycle 78 found no new causal evidence that changes its severity or failure mode.
