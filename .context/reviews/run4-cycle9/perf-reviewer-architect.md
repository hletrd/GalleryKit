# Perf / Architect angle — Run-4 Cycle 9

Inventory: full read of `public/sw.template.js` (311 lines) +
`scripts/build-sw.ts` + `register-service-worker.tsx` +
`lib/serve-upload.ts` cache-header contract (the SW's upstream);
`components/on-this-day-widget.tsx` + `lib/data-timeline.ts` (full);
photo-viewer preload effect (R4C8 PERF-R4C8-03 regression review,
incl. cleanup + cancellation); `histogram-worker.js`;
`lib/image-queue.ts` gc interval (unref'd ✓); `upload-tracker.ts`;
entrypoint.sh.

## PERF-R4C9-02 — SW revalidate GET starts eagerly; documented 304 short-circuit does not exist

**Severity MED / Confidence High.**

`apps/web/public/sw.template.js:149` — `const revalidate =
fetch(request.clone())…` is created (and therefore STARTED) at
function entry, before the cache lookup branch. The R11-M1 comment at
lines 171-175 claims "A 304 short-circuits the revalidate body fetch
entirely" — false: by the time the HEAD probe resolves 304, the full
GET is already in flight and nothing aborts it (no AbortController).

Measured consequences per repeat image view (serve-upload sends
`Cache-Control: public, max-age=3600, must-revalidate` — NOT
immutable):

1. Within the 1 h HTTP-cache TTL the GET is satisfied from the browser
   HTTP cache, but the SW `.then` still runs `clone().blob()` +
   `cache.put` of identical bytes + a FULL meta JSON read-modify-write
   (`getMeta`/`setMeta` serialize the entire LRU map) — per image, per
   view. A 50-thumb gallery page fires 50 concurrent
   read-modify-write cycles on one meta document (the last-writer-wins
   drift run4-cycle1 noted as bounded is multiplied by this churn).
2. After the TTL, the eager GET goes to network as a conditional
   request — so every cached view costs HEAD + conditional GET, double
   roundtrips for zero freshness gain over the HEAD alone.

Fix: make revalidation lazy — wrap the fetch in a closure invoked only
when (a) there is no cached entry, (b) the ETag probe shows a
mismatch, or (c) no ETag / probe failure (true SWR background path).
On a 304, serve cached and only touch the LRU timestamp via
`recordAndEvict(url, cachedSize)`-style metadata update (no body
fetch, no cache.put). Keep `isSensitiveResponse` semantics unchanged.
Requires the standard SW_VERSION refresh on deploy (handled by the
prebuild stamp + repo's refresh-commit convention).

## PERF-R4C9-03 — OnThisDay home widget ships full-resolution JPEG for 48 px thumbnails

**Severity MED-LOW / Confidence High.**

`apps/web/src/components/on-this-day-widget.tsx:65` — each of up to 6
thumbnails uses `/uploads/jpeg/${filename_jpeg}` (the BASE derivative:
full processed resolution, typically 2-6 MB for 24-50 MP sources) in a
48×48 box. R20-M2 chose the base file because a server component has
no onError fallback and legacy/mid-backfill rows may lack sized
variants. But the repo already has a tested client component with
EXACTLY that fallback shape: `components/optimistic-image.tsx`
(`fallbackSrc` + one-shot swap + retry). Lazy-loading softens but does
not eliminate the cost (scroll to footer ⇒ up to ~15-30 MB on mobile).

Fix: render the thumbnail via a small client island using the smallest
configured size (`_<min(imageSizes)>.jpg`) with `fallbackSrc` = base
JPEG — correctness contract (R20-M2) preserved for legacy rows, ~50 KB
instead of multi-MB for current-pipeline rows. No privacy-field
changes needed.

## Architect notes (no findings)

- `avif-support.ts` Promise singleton extraction is the right
  layering: client-safe pure module, re-exported for back-compat;
  preload effect + histogram share one probe.
- Preload effect cancellation (`cancelled` flag + link removal in
  cleanup) is correct; no link leak when the probe resolves
  post-unmount.
- `data-timeline.ts` duplicating `tagNamesAgg` instead of importing
  from data.ts is intentional per its header ("Does NOT modify
  data.ts") with a stay-in-sync comment — acceptable; the
  compile-shape test for data.ts covers the canonical constant.
- `getYearInReviewImages` JS month grouping uses
  `new Date('YYYY-MM-DD HH:mm:ss')` (local parse) on a
  `mode:'string'` column and reads back with local `getMonth()` —
  round-trip consistent regardless of server TZ. Sound, if
  V8-specific; not scheduled.
- gc interval `unref?.()` present; queue-shutdown clears it.
- histogram-worker: 256-bucket arrays, single pass, P3/sRGB
  coefficient branch sums to 1.0; no copy beyond the structured-clone
  transfer. Sound.
