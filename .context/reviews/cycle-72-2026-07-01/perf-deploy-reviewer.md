# Cycle 72 Performance / Deploy Review

Scope: read-only source review at HEAD `363dc1c9`; no files edited.

## Inventory

- Deploy/runtime: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/Dockerfile`, `docker-compose.yml`, `entrypoint.sh`, nginx config, Next config.
- Cache/image paths: service worker template/generated copy, upload serving headers, OG routes, per-photo OG fetch helper, image queue, upload routes, color and CLIP backfill sidecars.
- DB/migrations: schema indexes, latest Drizzle journal entries, recent migrations `0024`-`0028`.
- Recent perf/deploy deferred ledgers to avoid duplicate findings.

## Findings

### C72-03 - Temporary per-photo OG fallback redirects are cached as long-lived successes

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/app/api/og/photo/[id]/route.tsx:19`, `apps/web/src/app/api/og/photo/[id]/route.tsx:90`, `apps/web/src/app/api/og/photo/[id]/route.tsx:126`, `apps/web/src/app/api/og/photo/[id]/route.tsx:131`, `apps/web/src/app/api/og/photo/[id]/route.tsx:136`, `apps/web/src/app/api/og/photo/[id]/route.tsx:252`, `apps/web/src/app/api/og/photo/[id]/route.tsx:282`, `apps/web/src/app/api/og/photo/[id]/route.tsx:296`.
- Evidence: when all sized photo derivatives miss, the route returns a temporary `302` fallback using `OG_SUCCESS_CACHE_CONTROL` (`s-maxage=86400`) even though comments say crawlers should re-check later.
- Failure scenario: after `image_sizes` changes, restore, or backfill gaps, crawlers can cache the site-default fallback redirect for up to 24 hours and keep showing the wrong preview after the real derivative appears.
- Suggested fix: introduce a separate short/non-cacheable cache policy for temporary fallback redirects after derivative misses; keep the long success policy only for generated OG images.

## Final Sweep

Known SW and static derivative setting-change gotchas were not re-raised. Existing deferred index items remain carry-forward.
