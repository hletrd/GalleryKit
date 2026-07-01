# Cycle 78 Performance/Concurrency Review

HEAD reviewed: `9286bef16f3401fb0d8c17f52de5c96804c04533`.

## Inventory

- Queue/DB pool: `apps/web/src/lib/image-queue.ts`.
- Restore/runtime: `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Browser and Lightroom upload paths: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Backfill: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Cache/ETag: `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`.
- UI responsiveness: `apps/web/src/components/load-more.tsx`, `apps/web/src/components/home-client.tsx`.
- Service worker image cache: `apps/web/public/sw.template.js`.

## Findings

No new non-deferred race, queue/background-work, restore/backfill/upload concurrency, DB pool pressure, cache/ETag freshness, deploy shutdown, or UI responsiveness defect was confirmed in this lane.

## Deferred Not Re-Raised

- Cycle 77 restore barrier for in-flight non-upload admin mutations remains deferred; no new evidence changes severity.
- Historical analytics shutdown durability remains deferred/approximate.
- Sidecar all-candidate materialization, updated-time/pipeline-version indexes, settings-only re-encode persistence, shared-view behavioral coverage, and SW 300ms cached-image HEAD latency remain covered by prior deferred records.
