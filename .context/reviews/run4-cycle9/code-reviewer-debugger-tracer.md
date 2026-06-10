# Code-reviewer / Debugger / Tracer angle — Run-4 Cycle 9

Inventory: line-level regression review of every R4C8 fix commit —
6117168a (GPS strip, full 515-line `gps-exif-strip.ts` read + both
call-site orderings), 848bc593 (AVIF probe extraction →
`lib/avif-support.ts`), e94346a0 (preload single-fetch — effect body,
deps, cleanup, p/[id] hint removal), 7afd8522 (state-driven
`<picture>` fallback in lightbox + photo-viewer; histogram
`canvasDims` dep), 01a58f00 (explicit `bitdepth: 8` retry; oriented
WI-15 inputMeta; home-client dead-ref removal), 00fcd542 (docs).
Plus rotation reads: sw.template.js full, data-timeline.ts full,
on-this-day-widget full, optimistic-image full,
register-service-worker, map-loader/map-client data flow,
upload-tracker, build-sw, entrypoint.sh, histogram-worker.js.
Sweeps: unguarded JSON.parse (none — all three sites guarded),
radix-less parseInt (none), Math.random in prod code (none),
setInterval without unref (none).

## Findings

### COR-R4C9-01 (dup of SEC-R4C9-01) — ExtendedXMP GPS gap in the JPEG scrubber

`gps-exif-strip.ts:239-243`: the `else if` arm only recognizes the
standard XMP signature; extension segments are never token-tested.
Trace: `dropXmp` is the sole trigger for the rebuild pass at 253-273,
and only std-XMP can set it ⇒ ext-only GPS returns
`{stripped:false}` at 246-248 and the caller (process-image.ts:1509)
treats it as "no GPS present — leave byte-identical". Concrete repro
in the security angle file. Fix shape: widen the trigger; reuse the
existing drop pass (it already removes both signatures).

### Regression review of R4C8 commits — all sound, with traces

- **GPS strip call ordering**: `extractExifForDb` consumes the
  in-memory EXIF BEFORE the on-disk strip on both paths, so the tier-2
  re-encode (which strips ALL metadata) cannot lose capture
  date/camera columns. Verified images.ts:302/310 and lr
  route:310/326.
- **Tier-2 PNG re-encode**: `autoOrient` no-op on PNG, `keepIccProfile`
  retained, sharp strips eXIf by default ⇒ GPS gone, pixels lossless.
  Note (LOW, recorded as deferred candidate): an APNG would be
  flattened to its first frame, and a content/extension mismatch
  (PNG bytes named .jpg) routes to the q95 JPEG re-encode — both are
  self-inflicted upload edge cases; tier routing is by user-supplied
  extension (`getSafeExtension(file.name)`), magic-sniffed only for
  the JPEG fast path.
- **`stripGpsFromTiffRegion`**: endianness check ('II'/'MM' via
  Node 'ascii' decode masks high bytes, but the 42-magic check
  closes the false-positive window); GPS pointer in IFD0/IFD1 walked,
  GPS IFD entries + offset-referenced values zeroed THEN entry count
  zeroed — readers see an empty IFD; XMP TIFF tag (0x02bc) zeroed
  when token-matched. No EXIF-subIFD walk needed (GPS pointer lives
  in IFD0 per spec).
- **Picture fallback (7afd8522)**: state-driven source removal is the
  only shape where `src` participates in selection — correct; the
  per-photo reset effect re-arms on `image.id` change; the
  `jpegFallbackTriedRef` one-shot guard prevents error loops; the
  no-source fallback `<img>` keeps `onLoad={setImageLoaded}` so the
  blur crossfade still dismisses. Deps arrays updated correctly
  (`sizedSourcesFailed` added).
- **Histogram canvasDims dep (7afd8522)**: redraw from cached
  histogramData on re-attribute — cheap and correct.
- **Preload effect (e94346a0)**: `cancelled` flag checked inside the
  probe `.then`; cleanup removes appended links; else-if chain
  mirrors `<picture>` selection (avifSupported && baseAvif → avif;
  → webp; → jpeg). No double-append on re-entry (links array is
  per-effect-instance).
- **8-bit retry (01a58f00)**: explicit `bitdepth: 8` breaks the
  inherited `heifBitdepth: 10` merge — lockin test pins the literal.
- **WI-15 oriented gate (01a58f00)**: `autoOrient: true` on the
  inputMeta read makes height post-orientation, matching `baseWidth`'s
  provenance. Correct.

## Checked-OK (explicitly)

- `histogram-worker.js`: malformed message (short buffer) would
  produce NaN-keyed array writes but the only producer is
  histogram.tsx's own ImageData path — not reachable with hostile
  input (same-origin worker, no external postMessage surface).
- `OptimisticImage`: retry backoff capped (15 s), timer cleared on
  unmount, ref+state retry counters consistent, `?retry=` busts both
  SW (URL-keyed) and HTTP caches; serve-upload ignores query params.
- sw.template.js `isHtmlRoute` caches only `.ok` non-admin-rendered
  responses; opaque cross-origin responses excluded by `.ok === false`.
- `getTimelineYears` / `getTimelineImages` limit+1 truncation flag
  logic exact at the boundary (`rows.length > LIMIT`).
