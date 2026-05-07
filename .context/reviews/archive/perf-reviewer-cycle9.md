# Perf Reviewer — Cycle 9 (2026-04-25)

**HEAD:** `35a29c5`
**Scope:** Cycle 8 perf-relevant deltas (`/api/og` ETag + cache-control,
sitemap ISR, Permissions-Policy header bytes) and confirmation that no
known-deferred perf items regressed.

## Findings

**Status: zero new findings of MEDIUM or higher severity.**

### P9-POSITIVE-01 — OG route is now CDN-cacheable (improvement)
- **Citation:** `apps/web/src/app/api/og/route.tsx:17, 88, 190`
- **Effect:** social-share unfurls now hit the edge cache for an hour and
  benefit from `stale-while-revalidate=86400`. Combined with the ETag
  shortcut, repeated crawler hits skip the SVG/PNG pipeline entirely.

### P9-POSITIVE-02 — Sitemap is now ISR-cached (improvement)
- **Citation:** `apps/web/src/app/sitemap.ts:12`
- **Effect:** `getImageIdsForSitemap(...)` runs at most once per hour
  rather than per request. For a multi-thousand-image gallery this is a
  meaningful DB win.

### P9-INFO-01 — Permissions-Policy header is ~250 bytes (LOW / Low)
- **Citation:** `apps/web/next.config.ts:50` + nginx
- **Why noteworthy:** the new directive list adds ~200 bytes to every
  response header. With nginx gzip enabled (gzip_types includes the
  default text types but **not** headers — gzip operates on bodies), this
  cost is paid raw on every TLS handshake. Trivial impact at human
  request rates; documenting for completeness.
- **Action:** **DEFER**. The trade-off (privacy posture > 200 bytes) is
  clearly correct.

### P9-INFO-02 — OG ETag uses SHA-256 truncated to 32 hex chars (LOW / Low)
- **Citation:** `apps/web/src/app/api/og/route.tsx:75-78`
- **Effect:** 128-bit truncation of SHA-256. Birthday collision risk for
  a single OG cache key is ~2^-64 — astronomically safe. Fast hash; no
  perf concern.

## Carry-forward (deferred from prior cycles)

- AGG8F-15 — `getImagesLitePage` window function: still deferred.
- AGG8F-18 — view-count flush interval: still deferred.
- AGG8F-19 — JSON-LD on noindex: still scheduled in plan-238 (not yet
  implemented).

## Summary

The cycle-8 perf-relevant fixes deliver real wins and introduce no
regressions. No new MEDIUM/HIGH perf findings. Two INFO observations.
