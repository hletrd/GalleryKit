# Designer / Perceived Performance Review — Cycle 3

**Date:** 2026-04-23
**Metrics targeted:** LCP (Largest Contentful Paint), CLS (Cumulative Layout Shift), INP (Interaction to Next Paint), FCP, blur-placeholder experience.
**Method:** Playwright perf.getEntriesByType('navigation'|'paint'), source inspection of image pipeline, srcSet/sizes verification.

## Live measurements (dev server, localhost loopback, cold cache)

| Metric | Value | Target | Notes |
|---|---|---|---|
| DOM Content Loaded | 74.8ms | N/A | Dev server (uncompressed) |
| Load event end | 78.7ms | N/A | Dev server |
| First Paint | 96ms | N/A | |
| First Contentful Paint | 96ms | <1.8s (good) | OK |
| Transfer size | 20,162 bytes | N/A | Dev (uncompressed) |
| Encoded body size | 19,862 bytes | N/A | Dev |

**Caveat:** dev server does not apply production optimizations (no code splitting tree-shake, no image optimization, no compression, no CDN). Production metrics will differ — but the relative architecture is sound.

## Architecture review

### LCP optimization

- **Above-fold image priority:** `home-client.tsx:272-274` — `loading={isAboveFold ? "eager" : "lazy"}`, `fetchPriority={isAboveFold ? "high" : "auto"}`. `isAboveFold = index < columnCount` (line 228) — smart column-aware determination.
- **Photo viewer main image:** `photo-viewer.tsx:213, 240` — `priority`, `loading="eager"`, `decoding="sync"` on the hero image. Good for LCP.
- **AVIF/WebP/JPEG negotiation:** Picture element with `<source type="image/avif">`, `<source type="image/webp">`, `<img>` JPEG fallback. Browser picks the smallest supported format.
- **Sized srcSet:** `imageUrl('/uploads/avif/{base}_{w}.avif') {w}w` — admin-configurable sizes, ensures no over-fetch for responsive viewports.

### CLS optimization

- **aspectRatio on cards:** `home-client.tsx:237` — `aspectRatio: '${image.width} / ${image.height}'` pre-reserves the grid slot before image loads.
- **containIntrinsicSize:** `containIntrinsicSize: 'auto ${rounded}px'` on masonry cards — allows content-visibility:auto to skip layout/paint for offscreen cards without layout shift when they come on-screen.
- **Width/height on `<img>`:** `width={image.width}` + `height={image.height}` on the img fallback — browser reserves space.
- **No known CLS sources** in the measured render.

### INP optimization

- **Back-to-top smooth scroll:** honors `prefers-reduced-motion` (home-client.tsx:341-342). Good.
- **Masonry reorder:** `useMemo` with `allImages, columnCount` keys (line 175). Only recomputes on change.
- **resize handler:** `requestAnimationFrame`-debounced (line 92-97). Prevents thrashing on window resize.
- **Mouse move on image zoom:** `image-zoom.tsx` — ref-based DOM manipulation, no React re-renders.
- **Histogram:** capped at 256×256 canvas to keep compute bounded.

### Prefetch behavior

- **Photo-to-photo prefetch:** `p/[id]/page.tsx:231-239` — hidden `<Link prefetch={true}>` tags for prev/next photos. Pre-loads the next page for instant navigation.
- **Link prefetching:** Next.js default `<Link>` behavior auto-prefetches visible links on hover in production (no config needed).

### Blur placeholder

- `home-client.tsx:288`: `blurDataURL="data:image/png;base64,iVBORw0K..."` — **this is a 1×1 transparent PNG**, not a real per-image blur. The field is effectively a no-op for perceived performance.
- Real per-image blur placeholders (e.g., a 16px thumbnail blurred) would give a more natural loading feel. This is a **carry-forward observation**; was noted in prior cycles but not scheduled.

### Font loading

- `globals.css:5-11`: `@font-face` with `font-display: swap` — FOUT but no FOIT. OK.
- Pretendard variable font loaded via `/fonts/PretendardVariable.woff2?v=1` with full weight range `45 920` — a single woff2 file, not a subset. At ~1-1.5 MB for full variable, this is not negligible but `swap` means text renders in fallback first.

### Scroll performance

- `content-visibility: auto` on masonry cards (`globals.css:152-154`) — offscreen cards skip layout/paint. Major win for long pages.
- `containIntrinsicSize` per-card prevents layout shift when cards enter viewport.
- Nav header uses `sticky top-0 backdrop-blur-xl` — requires re-composite on every scroll frame. Minor GPU cost; acceptable on modern hardware.

## Findings

### PERF-UX-01 — Blur placeholder is a no-op [LOW] [HIGH confidence] (carry-forward observation)
`home-client.tsx:288` — `blurDataURL` is a 1×1 transparent PNG. The perceived loading experience is no better than without the placeholder (cards show `bg-muted/20` until the image paints). A real per-image blur (generated at upload time in `process-image.ts`) would fill the card with a low-res preview that matches the final image's color palette.

This was already in scope for past cycles but never scheduled. Adding it now would require extending the image pipeline and DB schema (store `blur_data_url` column).

### PERF-UX-02 — Full Pretendard variable font served [LOW] [MEDIUM confidence] (carry-forward)
`globals.css:5-11` loads the full Pretendard variable. Subsetting to Latin + Korean Hangul blocks would cut size by ~50%. Already deferred in prior cycles (Python brotli dependency requirement). No action this cycle.

## Observations (healthy)

- Image pipeline uses parallel AVIF/WebP/JPEG conversion (4 sizes × 3 formats = 12 derivatives per image, via `Promise.all` with `sharp.clone()`). Admin-configurable sizes.
- ISR caching: photos cache 1 week, topic/home 1 hour, admin force-dynamic.
- React `cache()` wraps `getImage`, `getTopicBySlug`, `getTopicsWithAliases` for SSR dedup.
- `Promise.all` parallelizes independent DB queries in `getImage` (tags + prev + next).

## Totals

- **0 CRITICAL/HIGH/MEDIUM**
- **2 LOW carry-forwards** (PERF-UX-01, PERF-UX-02)
- **Healthy overall.** No new action needed this cycle.
