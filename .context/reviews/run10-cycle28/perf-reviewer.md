# Run-10 Cycle 28 Performance Review

Lane: performance-reviewer  
Date: 2026-07-08  
HEAD reviewed: `55d5a03e`  
Scope: current HEAD only. I reviewed query/data-access hot paths, image processing/backfill/CLIP work, service worker/cache behavior, client UI responsiveness, concurrency/pool budgets, deploy/ops scripts, and expensive public routes. I did not duplicate known historical findings such as the documented background DB budget overlap or the existing semantic/map scale ceilings.

## Current Findings

### C28-PERF-01 - Thumbnail grids still use base JPEGs as the normal JPEG fallback

Severity: Medium  
Confidence: High

Code regions:
- `apps/web/src/components/grid-picture.tsx:31-49`
- `apps/web/src/components/masonry-card.tsx:89-115`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:257-278`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:216-237`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:220-241`
- `apps/web/src/components/grid-picture-fallback-boundary.tsx:18-26`
- Existing helper/precedent: `apps/web/src/lib/image-url.ts:72-95`, `apps/web/src/components/search.tsx:69-74`, `apps/web/src/components/map/map-client.tsx:54-72`

Problem:
`GridPicture` renders AVIF and WebP `source` candidates at grid-sized widths, but its `<img src>` and `data-fallback-src` both point at the base JPEG. The home masonry card, timeline grid, year grid, and shared-group grid all pass `/uploads/jpeg/${filename_jpeg}` as that `src`. Browsers that do not select AVIF/WebP, crawlers or embedded WebViews with those formats disabled, and any delegated image-error fallback path therefore download the full base JPEG for thumbnail slots. Other thumbnail surfaces already use the safer pattern: start with a sized JPEG derivative, then fall back once to the base JPEG only after the derivative fails.

Concrete failure scenario:
On a gallery first viewport with four above-the-fold grid cards, a JPEG-only client downloads four original/base JPEG derivatives instead of the 640/1536 px thumbnail candidates. For typical edited photos this can turn a sub-megabyte thumbnail viewport into tens of megabytes, increasing LCP bytes, decode time, and service-worker image-cache churn. Because `/uploads/jpeg/` is included in the service worker derivative cache, a few base JPEG fallbacks can also evict many useful thumbnail derivatives from the 50 MB LRU budget.

Suggested fix:
Extend `GridPicture` so the normal JPEG fallback can be a responsive, sized JPEG candidate. Use the existing `sizedImageSrcSet('/uploads/jpeg', filename_jpeg, imageSizes)` / `sizedImageUrl(...)` helpers, or add a JPEG `<source type="image/jpeg">` plus set `<img src>` to the nearest expected grid-sized JPEG. Keep the base JPEG URL as a separate recovery-only value for `GridPictureFallbackBoundary` after all sized candidates fail. Update the fallback contract tests to assert that grid JPEG selection starts with sized derivatives while the one-shot error recovery still reaches the base JPEG.

## Reviewed Areas With No New Finding Filed

- Query/data access: current page, photo, feed, admin-lite, OG, search, semantic, similar, sitemap, and map query paths were inspected. The semantic brute-force scan cap and map marker ceiling remain known scale limits from previous cycles, not new current-HEAD regressions.
- Image processing/backfill/CLIP: Sharp concurrency is bounded by format fan-out; image queue and admin backfill each cap worker counts; CLIP embedding scans use env/hard scan and top-K caps. The shared background budget overlap is already documented in `CLAUDE.md`/prior reviews, so I did not re-file it.
- Service worker/cache: image stale-while-revalidate has bounded HEAD probing and LRU metadata mutation serialization; HTML caching is backgrounded. The `/p/:id` offline-cache bypass is pinned by current tests as revocable-object behavior, so I did not treat the docs wording mismatch as an accidental performance regression.
- Client responsiveness: home masonry width bucketing, memoized cards, search debouncing/abort behavior, map marker thumbnail sizing, and load-more cursor pagination were inspected. No fresh responsiveness issue found beyond C28-PERF-01.
- Deploy/ops scripts: deploy health checks and Docker prune ordering are guarded so the live image/container survive cleanup; no new deploy-time performance regression found.
- Expensive public routes: OG endpoints, feeds, public load-more/search actions, semantic/similar routes, and analytics writes have current rate limiting, conditional requests where appropriate, or bounded background write concurrency. No new issue filed.
