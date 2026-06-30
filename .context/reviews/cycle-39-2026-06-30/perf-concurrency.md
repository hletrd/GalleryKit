# Cycle 39 Performance / Concurrency Review

Scope: service-worker image caching, feed/sitemap hot paths, and backfill candidate scans at `addf64ac`.

## PERF-C39-01 - Service-worker image LRU metadata writes can race

Severity: medium.

Evidence:
- `apps/web/public/sw.template.js:100` reads the full metadata document with `getMeta()`.
- `apps/web/public/sw.template.js:130` writes the whole document back with `setMeta(entries)`.
- `apps/web/src/lib/sw-cache.ts:99` and `apps/web/src/lib/sw-cache.ts:144` mirror the same read/modify/write reference behavior.

Impact: concurrent cold image fetches can each read the same old metadata map and the last writer can drop earlier entries. The cache may contain all image bodies while metadata tracks only the final write, so the 50 MB cap can be under-enforced.

Recommendation: serialize metadata mutations in both the shipped service-worker template and the reference module, and add a concurrent write regression test.

## PERF-C39-02 - Service-worker cache writes buffer every image body for sizing

Severity: medium.

Evidence:
- `apps/web/public/sw.template.js:212-216` clones the network response, reads `blob()`, then writes another clone to cache.
- `apps/web/src/lib/serve-upload.ts` emits `Content-Length` for served upload derivatives.

Impact: cold gallery loads can temporarily hold many full derivative bodies in JS memory even when the response already has an authoritative size header.

Recommendation: use finite non-negative `Content-Length` when present and fall back to `blob()` only when needed.

## PERF-C39-03 - Feed and sitemap updated-time queries lack matching indexes

Severity: medium, deferred.

Evidence:
- `apps/web/src/lib/data.ts` has updated-time feed/sitemap queries around the `getAtomFeedItems`, `getSitemapEntries`, and archive paths.
- Current schema indexes do not directly cover every ordered updated-time access pattern.

Recommendation: defer to a migration-shaped cycle with EXPLAIN output and rollback notes.

## PERF-C39-04 - Backfill candidate/status scans lack a pipeline-version index

Severity: medium, deferred.

Evidence:
- `apps/web/src/lib/admin-backfill-runner.ts` and `apps/web/src/lib/admin-backfill.ts` filter candidates/status by image-processing pipeline state.
- Current schema does not include a dedicated pipeline-version index for those scans.

Recommendation: defer with the feed/sitemap index work because it changes schema and needs production-cardinality validation.
