# Cycle 69 Performance / Concurrency Review

Start HEAD: `87e2b98db76e90985299e37ad90cf2faad12c5c4`.

## Inventory

- Required context: `AGENTS.md`, `CLAUDE.md`, latest aggregate, Cycle 68 artifacts.
- Reviewed image queue, admin/sidecar backfill, semantic search side effects, service worker cache, public route limits, DB query hot paths, and deploy/runtime scripts.

## Findings

### PERF69-01 - Same-ETag `HEAD 200` still starts a full image body revalidation

- Severity/confidence: Low / Medium.
- File/line: `apps/web/public/sw.template.js:335`, `apps/web/public/sw.template.js:343`, `apps/web/public/sw.template.js:351`, `apps/web/public/sw.js:335`, `apps/web/src/__tests__/sw-template-contract.test.ts:224`.
- Evidence: when the HEAD probe returns `200 OK` with the same ETag, the service worker sets `cacheVerifiedByProbe = true` but falls through to the generic stale-while-revalidate path, which calls `startRevalidate()` and performs a full GET.
- Failure scenario: an intermediary responds to conditional HEAD with `200` and unchanged ETag for warm masonry tiles; every tile returns cached bytes but still transfers and rewrites the image body in the background.
- Fix direction: treat `networkEtag === cachedEtag` like the 304 branch: refresh the cached timestamp, touch metadata, and return cached without a body GET. Regenerate `public/sw.js` and add a source contract.

## Not Re-Raised

Previously deferred sidecar materialization, semantic web-process catch-up caps, feed/sitemap indexes, backfill indexes, and sidecar keyset pagination did not gain new scheduling evidence in this pass.
