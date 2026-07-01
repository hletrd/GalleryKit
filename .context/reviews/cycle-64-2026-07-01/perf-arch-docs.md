# Cycle 64 Performance / Architecture / Deploy Docs Review

Reviewer: performance/architecture/deploy-docs lane
Date: 2026-07-01
Scope: read-only review.
Start HEAD: `efdbaf9a4971e8c59051fe422c8b44d6e9dd455f`

## Findings

No new actionable findings in this lane.

## Checked Areas

- Query/index fit: reviewed listing, feed, sitemap, analytics, map, search, semantic embedding, and shared-group query shapes against current indexes in `apps/web/src/db/schema.ts` and query callers in `apps/web/src/lib/data.ts` plus `apps/web/src/lib/analytics-data.ts`.
- Existing index gaps remain already deferred: `PERF-C39-03` feed/sitemap updated-time indexes and `PERF-C39-04` backfill pipeline-version indexes. No new severity evidence changed priority.
- Image/backfill concurrency: in-app queue and admin backfill both clamp concurrency against live DB pool headroom. Sidecar color backfill still uses bounded `BACKFILL_CONCURRENCY`; its all-candidates preload remains already-deferred `AGG-C38-08`.
- Service worker/cache contract: Cycle 63 comment fix is present in both template and generated worker (`apps/web/public/sw.template.js:455`, `apps/web/public/sw.js:455`). Normalized template/generated parity checked cleanly.
- Static derivative cache policy remains aligned across Next, route fallback, nginx, and docs.
- Deploy/Docker/nginx: deploy health-before-prune and safe prune order are preserved; Docker bind mounts match persistence docs; nginx upload/body caps and PAT route precedence remain documented and source-locked.
- Migration/reconcile fit: journal is current through `0028_rate_limit_bucket_start_idx`, and `reconcileLegacySchema()` mirrors the matching table/index state.
- Docs/code drift: reviewed `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, deploy scripts, Dockerfile, nginx config, service worker notes, and migration runbook. No new deploy-doc drift found beyond carry-forward items.

## Deferred Items Not Re-Raised

No new evidence changed severity or scheduling for `C61-06`, `C61-07`, `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, or `AGG-C38-08`.

## Validation

Read-only review only. No files were modified and no tests were run. Static evidence collected from source inspection plus `git rev-parse HEAD` and normalized `sw.template.js` / `sw.js` parity check.
