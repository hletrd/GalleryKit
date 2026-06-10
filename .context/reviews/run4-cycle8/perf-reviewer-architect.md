# Run-4 Cycle 8 — perf-reviewer / architect angle

Inventory: photo-page delivery path end-to-end (p/[id]/page.tsx server
preload hints + photo-viewer.tsx client preload effect + lightbox +
serve-upload + SW interplay), live Chromium network-count experiment,
masonry/home-client render path, histogram worker pipeline, image-queue
concurrency model, process-image fan-out (sharp.concurrency division,
WI-15 gate), data.ts listing/cursor queries, gallery-config caching.

## Findings

### PERF-R4C8-03 — neighbor-image preloads multi-fetch on every photo page view; server and client preload layers overlap (MED-HIGH / Confidence: High — empirically proven)
Surfaces:
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:171-199,289-298` —
  server-rendered `<link rel="preload" as="image" fetchPriority="high">`
  for BOTH neighbors × up to THREE formats (JPEG always, plus AVIF and
  WebP when present) at a fixed `findNearestImageSize(sizes, 1536)`.
- `apps/web/src/components/photo-viewer.tsx:310-363` — client effect
  additionally appends responsive preloads (imagesrcset/imagesizes) for
  both neighbors: AVIF + WebP both emitted whenever both exist.

The `type` attribute on a preload link only gates **MIME support**, not
"will the `<picture>` actually use it". The R13-H1 comment's mechanism
claim ("browsers that CAN decode AVIF skip the WebP/JPEG tags because
their `<picture>` will pick AVIF") is incorrect — preload links carry no
knowledge of the picture's source-selection. Live Chromium (playwright,
fixture replicating the page-level hints): all three preloads
(`/photo_640.jpg`, `/photo_640.avif`, `/photo_640.webp`) are fetched.

Cost model on Chromium/Safari (AVIF-capable): per photo page view the
server hints fetch jpeg+avif+webp at ~1536 px for 2 neighbors (≈6 large
requests), the client effect fetches avif+webp responsive variants
(2-4 more when the viewport size differs from 1536), and exactly ONE of
these is consumed on navigation. Worst case several MB of wasted
transfer per view, all marked `fetchPriority="high"`, competing with
the CURRENT photo's own fetch for bandwidth — an LCP regression lever
on slow connections, and 3× the service-worker cache write volume.

Fix shape (single-fetch contract):
1. Remove the server-side neighbor preload hints from p/[id]/page.tsx
   entirely (they fire before the visitor has signaled any navigation
   intent, at a fixed size that usually mismatches the viewport).
2. Keep ONE preload layer: the client effect, emitting exactly ONE
   format per neighbor — AVIF when `getAvifSupportPromise()` resolves
   true (fixed this cycle in COR-R4C8-02), else WebP (universal), else
   JPEG. Keep imagesrcset/imagesizes so the browser picks the right
   width.
3. Lock with a source-contract test: page emits no neighbor preload
   links; viewer effect emits at most one format per neighbor.

### Supporting observation — prev/next full hydration cost (no action)
p/[id] fetches `getImageCached(prevId)` + `getImageCached(nextId)`
(each running its own adjacency subqueries) only to build preload
hints. Removing the server hints (above) also removes these two
queries per page view. Noted as a bonus of the fix, not a separate
finding.

## Verified-clean
- serve-upload settings-hash TTL + stale-while-revalidate (R4C3/R4C4
  lineage) intact; ETag/304 math unchanged; HEAD short-circuits body.
- Masonry above-the-fold eager/lazy split mirrors real column counts;
  `containIntrinsicSize` present; no layout-thrash listeners (rAF
  debounce).
- Histogram: canvas capped at 256 px; worker transfers the buffer
  (no copy); abort path cleans listeners. (The breakpoint-blank bug is
  filed in the code angle as COR-R4C8-04.)
- image-queue: PQueue concurrency 1 + sharp.concurrency divided by
  format fan-out (CM-LOW-10) still consistent; no unbounded state
  (retry maps pruned, failed-ID set capped).
- Cursor pagination keyset conditions use the composite index order
  (processed, capture_date, created_at) — no offset scans on the
  load-more path.
- WI-15 50 MP gate: the orientation-mixing defect is filed as
  COR-R4C8-07 (code angle); otherwise the downscale-to-TIFF
  intermediate + cleanup-in-finally is sound.

## Architecture notes
- The dual preload layers (server + client) violate the
  single-source-of-truth principle the repo applies elsewhere
  (e.g. MAX_UPLOAD_FILE_BYTES, tagNamesAgg); consolidating on the
  client layer also removes the only consumer that required
  `getImageCached` for neighbors.
- The picture-fallback defect (COR-R4C8-05, code angle) is the same
  class as R20-M1 already fixed on the masonry surfaces — the fix
  should converge the viewer/lightbox onto an equivalent guarantee
  (base JPEG always renderable) rather than a third pattern.
