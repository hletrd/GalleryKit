# Photographer Review R10 — Aggregate Findings

**Date:** 2026-05-16
**Scope:** Comprehensive review from professional photographer perspective after R9 convergence.
**Reviewers:** Color Pipeline, UI/UX, Encoder/Delivery, Browser/Display (4 parallel passes)
**Premise:** Photos arrive AFTER the photographer's editing. The encoder + viewer must deliver the photographer's intent accurately.

---

## Severity Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 1 | R10-C1 |
| HIGH | 6 | R10-H1–H6 |
| MEDIUM | 15 | R10-M1–M15 |
| LOW | 16 | R10-L1–L16 |

**Cross-agent agreement:**
- Histogram BT.709 coefficients on P3 sources: flagged by Color Pipeline (R10-M2) AND Browser/Display (R10-M3) — same root cause, same fix.
- ETag staleness on settings change: flagged by Encoder/Delivery (R10-M1) AND Browser/Display (R10-M4) — same root cause.
- `image-rendering` CSS: flagged by Color Pipeline (R10-L1) AND UI/UX (R10-M1) — same recommendation.
- Firefox P3-display UI misalignment: Browser/Display flags HIGH (R10-H2); Color Pipeline acknowledges in cross-file integration notes.

---

## CRITICAL

### R10-C1 — `toColorspace('p3')` is not a documented libvips colorspace; pixel conversion path is unclear

**Source:** Color Pipeline review (CRIT)
**Files:** `apps/web/src/lib/process-image.ts:877`, `:856`, `:918`
**Impact:** The core wide-gamut encode chain calls `.toColorspace('p3')` for AVIF, WebP, and JPEG when the source is P3 or wider. Sharp's `toColorspace` delegates to libvips' `vips_colourspace`, whose documented values are: `srgb`, `rgb16`, `scrgb`, `cmyk`, `lab`, `xyz`, `b-w`. There is no `p3` value in the libvips `VipsInterpretation` enum.

The existing fixture tests at `__tests__/process-image-color-roundtrip.test.ts` verify that the OUTPUT file carries a P3 ICC profile, but they do NOT verify that the pixel values are actually in P3 gamut. A source with saturated P3-green (outside sRGB triangle) could end up as sRGB pixels with a falsely-attached P3 ICC profile — the profile would lie about the pixel values, causing dramatically wrong colors on P3 displays.

**Fix:** Add a fixture test with a synthetic Display-P3 source containing a known out-of-sRGB-gamut color patch. Assert that decoded output pixels are NOT clamped to sRGB. If the decoded value is approximately the expected P3 value, the conversion is working. If clipped, the pipeline is broken.

**Verdict:** Must verify before the wide-gamut pipeline can be fully trusted.

---

## HIGH

### R10-H1 — WI-15 downscale intermediate loses ICC profile; large wide-gamut sources encode with shifted colors

**Source:** Encoder/Delivery review (HIGH)
**Files:** `apps/web/src/lib/process-image.ts:767-776`
**Impact:** When a wide-gamut source exceeds `wide_gamut_max_source_pixels` (default 50 MP), the temporary downscaled file is written without `.withIccProfile()`. The subsequent rgb16 pipeline reads this file and assumes sRGB, then "converts" from assumed-sRGB to P3 — producing washed-out or hue-shifted colors.

**Fix:** Add `.withIccProfile(iccProfileName || 'srgb')` before `.toFile(tmpPath)` on line 772. One-line fix, high impact.

---

### R10-H2 — Permanently failed images invisible to admin; errors logged only to console

**Source:** Encoder/Delivery review (HIGH)
**Files:** `apps/web/src/lib/image-queue.ts:435-478`
**Impact:** When an image fails after 3 retries, it's added to an in-memory `permanentlyFailedIds` Set. The DB row stays `processed=false` forever. Admin dashboard shows it as "pending" with no error indication. Error is lost on restart.

**Fix:** Add `processing_error` (varchar 512) and `failed_at` (timestamp) columns to `images` table. Persist errors to DB, surface in admin dashboard with retry button.

---

### R10-H3 — Service Worker caches image bytes without ETag comparison, extending stale-color window

**Source:** Browser/Display review (HIGH)
**Files:** `public/sw.js:135-166` (`staleWhileRevalidateImage`)
**Impact:** When admin changes a color-impacting setting, ETag changes immediately. The SW serves old cached bytes on the next visit (background revalidation updates cache for subsequent visit). Users see incorrect colors for one extra visit cycle. If backfill then changes file bytes, another cycle is added.

**Fix:** Compare `cached.headers.get('ETag')` with network response ETag before serving stale. If different, return network response instead of cached.

---

### R10-H4 — Firefox P3-display users see incorrect UI gamut signals (badges hidden, hint appears wrongly)

**Source:** Browser/Display review (HIGH)
**Files:** `use-display-capability.ts:64-67`, `wide-gamut-hint.tsx:39-48`, `globals.css:170-173`, `histogram.tsx:426-428`
**Impact:** Firefox lacks both `screen.colorGamut` and `(color-gamut: p3)` MQ support. R9 correctly defaulted Firefox to `'srgb'` to avoid false positives. But this means P3-display Firefox users see:
1. `WideGamutHint` incorrectly appearing ("Your display cannot show the full range")
2. P3 badges hidden via CSS
3. Histogram using sRGB canvas instead of P3

The actual AVIF image delivery IS correct — Firefox 113+ decodes P3 AVIF properly. This is purely UI misalignment that undermines photographer credibility.

**Fix options:**
- A: Make `WideGamutHint` dismissible so users can hide false positives
- B: Document limitation prominently in admin UI and CLAUDE.md
- C: Use canvas-P3 probe as weak signal for Firefox specifically (gated behind explicit uncertainty warning)

**Recommended:** Option A (dismissible hint) + Option B (documentation).

---

### R10-H5 — Masonry thumbnail grid gives zero indication of wide-gamut or HDR content

**Source:** UI/UX review (HIGH)
**Files:** `home-client.tsx:248-331`
**Impact:** Photographers who carefully curate P3/HDR content have no visual way to communicate this to visitors before they click. Every photo looks identical in the grid regardless of gamut, bit depth, or HDR status.

**Fix:** Extend `GalleryImage` to include `color_primaries` (already public-safe). Render a subtle chip/dot on masonry cards for non-sRGB sources. Keep it subtle: `text-[10px] bg-purple-500/80 text-white px-1.5 py-0.5 rounded`.

---

### R10-H6 — Photo viewer caps image height at 80vh, causing unnecessary letterboxing

**Source:** UI/UX review (HIGH)
**Files:** `photo-viewer.tsx:387, 413`
**Impact:** On a 27" monitor viewing a 3:2 landscape photo, `max-h-[80vh]` leaves ~20% of vertical viewport unused while horizontal space is plentiful. The photo is shown smaller than it could be, reducing impact of fine detail and tonal gradation.

**Fix:** Remove `max-h-[80vh]` from image elements. Let the container drive minimum size via `min-h-[40vh] md:min-h-[500px]`. Toolbar is already `sticky` on mobile; on desktop it's above the grid row and doesn't overlap.

---

## MEDIUM (15)

### R10-M1 — ETag changes immediately on settings flip, but file bytes remain stale (R9-M2 carryover)

**Source:** Encoder/Delivery + Browser/Display (agreement)
**Files:** `serve-upload.ts:110-112`, `settings-hash.ts:62-78`
**Impact:** Admin changes color setting → ETag changes for all images → clients revalidate → download SAME old bytes under NEW ETag → backfill rewrites → download AGAIN. Bandwidth waste proportional to gallery size × visitor count.

**Fix (short-term):** UI warning in admin settings: "Changing color/HDR settings requires running the backfill script before new encoding takes effect for existing images."
**Fix (long-term):** Per-image `encode_settings_hash` column; ETag reads per-image hash instead of global settings hash.

---

### R10-M2 — Histogram luminance uses BT.709 coefficients for all primaries (including P3)

**Source:** Color Pipeline + Browser/Display (agreement)
**Files:** `public/histogram-worker.js:21-25`, `histogram.tsx:203-206`
**Impact:** Histogram computes luminance with BT.709 coefficients (`0.2126, 0.7152, 0.0722`) regardless of actual color primaries. For P3 sources decoded into P3 canvas, correct coefficients are (`0.22897, 0.69174, 0.07929`). Systematic ~2–3% shift toward green, away from blue.

**Fix:** Pass canvas color space to worker, branch luminance formula:
```js
const lum = colorSpace === 'display-p3'
    ? Math.round(0.22897 * rv + 0.69174 * gv + 0.07929 * bv)
    : Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv);
```

---

### R10-M3 — JPEG chroma subsampling uses source gamut, not target gamut

**Source:** Encoder/Delivery review (MED)
**Files:** `apps/web/src/lib/process-image.ts:917-923`
**Impact:** When `force_srgb_derivatives=true`, wide-gamut sources are converted to sRGB but still receive `wide_gamut_jpeg_chroma` (4:4:4) instead of `sdr_jpeg_chroma` (4:2:0). Photographer who set `sdr_jpeg_chroma=4:2:0` gets 4:4:4 for forced-sRGB wide-gamut sources.

**Fix:** Change `isWideGamutSource ? effectiveChroma : effectiveSdrChroma` to `targetIcc === 'p3' ? effectiveChroma : effectiveSdrChroma`.

---

### R10-M4 — `deliveredBitDepthP3` label doesn't account for forceSrgbDerivatives or 10-bit probe failure

**Source:** Color Pipeline review (MED)
**Files:** `color-details-section.tsx:373-386`, `en.json:315`
**Impact:** Label says "10-bit AVIF, 8-bit WebP/JPEG" but when `forceSrgbDerivatives=true`, WebP/JPEG are sRGB (not P3 8-bit). Also doesn't reflect 10-bit probe failure fallback to 8-bit.

**Fix:** Make label conditional on actual delivery parameters, or split into four i18n keys for the combinations.

---

### R10-M5 — `estimateKeyType` uses naive mean-luminance threshold

**Source:** Color Pipeline review (MED)
**Files:** `histogram.tsx:347-354`
**Impact:** Mean-based threshold misclassifies images. A 50% white + 50% black image has mean 127.5 → "balanced" even though it's high-contrast. A percentile-based analysis (90th percentile > 220 for high-key, 10th percentile < 40 for low-key) would be more accurate.

**Fix:** Replace with percentile-based classification:
```ts
const p10 = percentile(data.l, 0.10);
const p90 = percentile(data.l, 0.90);
if (p90 > 220 && p10 > 100) return 'high-key';
if (p10 < 40 && p90 < 180) return 'low-key';
return 'balanced';
```

---

### R10-M6 — AVIF NCLX CICP signaling relies on Sharp/libheif implicit behavior, not explicitly verified

**Source:** Browser/Display review (MED)
**Files:** `process-image.ts:876-884`
**Impact:** GalleryKit encodes P3 AVIF via `.toColorspace('p3').withIccProfile('p3').avif(...)`. Whether libheif writes an NCLX `colr` box with CICP values (primaries=12, transfer=13, matrix=0) is an implementation detail. If libheif writes only ICC and omits NCLX, future browsers may not interpret the AVIF as P3.

**Fix:** Add post-encode verification that inspects first ~4KB of AVIF output for `nclx`-type `colr` box with expected CICP values. Audit-only check; log warning if absent.

---

### R10-M7 — WebP ICC profile embedding not verified

**Source:** Browser/Display review (MED)
**Files:** `process-image.ts:855-858`
**Impact:** `.withIccProfile('p3')` may not propagate through Sharp's WebP encoder. libwebp supports ICC via VP8X chunk, but only when VP8X is enabled. If ICC is missing, Chrome renders wide-gamut WebP in sRGB on P3 displays.

**Fix:** Post-encode verification: scan first 1KB of WebP for `ICCP` FourCC. Log warning if absent.

---

### R10-M8 — Wide-gamut hint names SOURCE gamut, not DELIVERY gamut

**Source:** Color Pipeline review (MED)
**Files:** `wide-gamut-hint.tsx:43`, `color-details-section.tsx:373-386`, `en.json:355`
**Impact:** For Rec.2020 source (delivered as P3-clipped), hint says "available on Rec.2020 screens." But delivery is capped at P3 — a Display P3 screen already sees everything. Same issue for Adobe RGB and ProPhoto.

**Fix:** Change hint to always name delivery gamut ceiling (Display P3 for all wide-gamut sources):
```json
"wideGamutHint": "Your display shows the sRGB version. The full color gamut is available on Display P3 screens (source: {sourceGamut})."
```

---

### R10-M9 — NCLX transfer code 14/15 (BT.2020 SDR) mapped to 'gamma22' instead of closer approximation

**Source:** Color Pipeline review (MED)
**Files:** `color-detection.ts:185-186`
**Impact:** ITU-T H.273 values 14/15 represent BT.2020 10/12-bit SDR, which uses transfer closer to gamma 2.4 (BT.1886) than gamma 2.2. Current mapping misrepresents mastering conditions.

**Fix:** Add `'gamma24'` or `'bt1886'` transfer function label. Map values 14/15 to it.

---

### R10-M10 — `color-gamut: p3` MQ in CSS fires on P3-capable browsers regardless of actual display

**Source:** Color Pipeline review (MED)
**Files:** `globals.css:171`
**Impact:** `.gamut-p3-badge` CSS uses `@media (color-gamut: p3)` which matches browser capability, not display gamut. sRGB display + P3-capable browser → badge shown incorrectly. Mitigated by `data-display-gamut` fallback but MQ alone is wrong.

**Fix:** Remove `@media (color-gamut: p3)` rule. Rely solely on `data-display-gamut` attribute from `useDisplayCapability`.

---

### R10-M11 — Blur + fade create "double exposure" during photo navigation

**Source:** UI/UX review (MED)
**Files:** `photo-viewer.tsx:174-183`, `photo-viewer.tsx:609-625`
**Impact:** During 200ms fade-in, both blurred preview AND loading full-res image are visible simultaneously — visually jarring.

**Fix:** Move blur background to separate inner `div` that fades OUT as image fades IN. Use `onLoad` to trigger blur fade-out.

---

### R10-M12 — Inconsistent histogram ordering in mobile bottom sheet

**Source:** UI/UX review (MED)
**Files:** `info-bottom-sheet.tsx:299-382`, `info-bottom-sheet.tsx:518-601`
**Impact:** For wide-gamut/HDR photos: histogram BEFORE EXIF. For sRGB: histogram AFTER EXIF. Inconsistent ordering breaks muscle memory.

**Fix:** Standardize on single ordering for all photos. Recommended: Title/tags → Color details → Wide-gamut hint → EXIF → Histogram → Capture date → Download.

---

### R10-M13 — Ken Burns slideshow zooms beyond delivered resolution

**Source:** UI/UX review (MED)
**Files:** `lightbox.tsx:65-76`, `lightbox.tsx:446-456`
**Impact:** `scale(1.08)` on slideshow can exceed source resolution, revealing pixelation.

**Fix:** Reduce zoom to `scale(1.03)` or cap based on available source vs viewport size.

---

### R10-M14 — Backfill warning shown for ALL settings changes, not just color/HDR

**Source:** UI/UX review (MED)
**Files:** `settings-client.tsx:108-114`
**Impact:** Changing slideshow interval from 5s to 7s triggers backfill warning. Admin learns to ignore it, missing warnings when they ARE relevant.

**Fix:** Track which fields changed. Only show warning when color/HDR-affected fields differ from initial values:
```ts
const COLOR_HDR_FIELDS = ['force_srgb_derivatives', 'allow_hdr_ingest', 'force_show_color_chips', 'wide_gamut_jpeg_chroma', 'avif_effort', 'sdr_jpeg_chroma', 'wide_gamut_max_source_pixels'];
```

---

### R10-M15 — Histogram key-type terminology is opaque to non-photographers

**Source:** UI/UX review (MED)
**Files:** `histogram.tsx:609-613`
**Impact:** "High-key", "Low-key", "Balanced" are standard photography terms but may confuse casual visitors. "High-key" sounds like a quality judgment.

**Fix:** Add tooltip explaining each term:
- "High-key": "Mostly bright tones with low contrast — typical of airy, optimistic moods"
- "Low-key": "Mostly dark tones with high contrast — typical of dramatic, moody moods"
- "Balanced": "Even distribution of tones across the range"

Korean: avoid literal translation of "key" (키). Use "톤" (tone) or "밝기 분포".

---

## LOW (16)

### Color Pipeline (6)

**R10-L1** — No `image-rendering` CSS optimization on photo viewer images. Add `image-rendering: high-quality` (Safari 17.4+, Chrome 108+) for sharper downscaled display. *Also flagged by UI/UX reviewer as R10-M1.*

**R10-L2** — Blur data URL always sRGB regardless of source gamut. Acceptable for 16px preview but first visual impression is color-clipped for wide-gamut photos. Document as known limitation.

**R10-L3** — Masonry grid images lack `decoding="async"`. Add to improve scroll performance.

**R10-L4** — RAW file formats rejected without informative message. Add `.cr3`, `.nef`, `.arw`, `.dng`, `.raf`, `.orf`, `.pef`, `.rw2` to `ALLOWED_EXTENSIONS` with pre-flight rejection: "RAW files are not supported. Please export to JPEG, TIFF, or PNG before uploading."

**R10-L5** — Ken Burns transform edge case with reduced-motion. Verify initial state when `shouldReduceMotion` is true and `isSlideshowActive` becomes true.

**R10-L6** — `wideGamutMaxSourcePixels` included in settings hash causes unnecessary cache invalidation. Remove from `COLOR_IMPACTING_KEYS` in `settings-hash.ts` — affects processing behavior of new uploads, not bytes of already-encoded files.

### Encoder/Delivery (5)

**R10-L7** — Quality settings not calibrated across formats; no perceptual equivalence guidance. AVIF 85 is higher visual quality than JPEG 90. Add admin UI tooltips explaining relative quality.

**R10-L8** — No 5K or 8K size variant. Default ladder: 640, 1536, 2048, 4096. Gap for 5K iMac (5120px) and 8K monitors (7680px). Add 5120/7680 as configurable options.

**R10-L9** — Blur placeholder preserves source colorspace; brief color flash possible on P3 sources. Add `.toColorspace('srgb')` to blur pipeline for consistency.

**R10-L10** — `force_srgb_derivatives` name implies all formats, but AVIF remains gamut-preserved. Rename admin UI label to "Force sRGB on WebP/JPEG (AVIF remains gamut-preserved)".

**R10-L11** — Partial encode failures during backfill can leave orphaned sized variants. Wrap size loop in try/catch that cleans up partial outputs on failure.

### Browser/Display (3)

**R10-L12** — SW cache purge only on deploy, not pipeline version bumps. Consider embedding `IMAGE_PIPELINE_VERSION` into `SW_VERSION`.

**R10-L13** — `photo-viewer.tsx` preloads JPEG for prev/next, not AVIF. Preload AVIF when available: `<link rel="preload" as="image" type="image/avif">`.

**R10-L14** — Missing test coverage for SW `staleWhileRevalidateImage` ETag logic. Extract to testable TS module.

### UI/UX (8)

**R10-L15** — Color details accordion clickable area narrower than 44px height suggests. Make full row tappable, not just chevron+label.

**R10-L16** — Copied JSON leaks internal pipeline version number. Remove `pipelineVersion` from copied JSON; filter internal fields.

**R10-L17** — Histogram mode button uses `font-mono`, clashes with UI. Remove monospace styling.

**R10-L18** — "Color details" accordion label is generic for wide-gamut photos. Dynamically label: "Color: Display P3", "Color: HDR", etc.

**R10-L19** — Mobile bottom sheet peek state hides color metadata for wide-gamut photos. Add subtle color indicator chip to peek state.

**R10-L20** — Lightbox color pip doesn't show delivered bit depth or format chips. Replicate sidebar rows in lightbox expanded panel.

**R10-L21** — Wide-gamut hint amber-on-amber contrast borderline in dark mode. Increase dark mode opacity to `/40` or use solid `dark:bg-amber-900`.

**R10-L22** — Download label "Display P3 JPEG" implies 10-bit. Change to "8-bit Display P3 JPEG" or "P3-tagged 8-bit JPEG".

**R10-L23** — Masonry `object-cover` crops photographer's composition. Intentional trade-off for consistent card sizes; document in code comments.

---

## Cross-File Integration Issues

### Gain map signal flattening

**Files:** `gain-map-detection.ts` → `color-detection.ts` → `process-image.ts`
**Issue:** `ColorSignals.hasGainMap` is a flat boolean. When WI-09 ships, knowing Apple URN vs ISO 21496-1 `tmap` matters for output encoding.
**Recommendation:** Change `hasGainMap: boolean` to `hasGainMap: false | 'apple-urn' | 'iso-tmap'` before WI-09. Schema migration required.

### Color pipeline ↔ UI consistency

**Files:** `process-image.ts` → `color-details-section.tsx` → `lightbox-color-pip.tsx` → `wide-gamut-hint.tsx`
**Issue:** R10-M8 (hint names source gamut) and R10-M4 (delivered bit depth label) both stem from the same root cause: UI conflates source properties with delivery properties. The pipeline decision (`p3-from-prophoto`) encodes both source and delivery, but UI surfaces need to be explicit about WHICH aspect they're showing.

**Recommendation:** Establish a naming convention in i18n keys: `sourceGamut`, `deliveryGamut`, `sourceBitDepth`, `deliveredBitDepth`.

### EXIF metadata loss

**Files:** `process-image.ts` (extractExifForDb) → `images.ts` (stripGpsFromOriginal)
**Issue:** R10-M3 (no copyright/artist extraction) + R10-M4 (GPS strip rewrites original) are two symptoms of the same problem: the original file preservation promise is violated. `stripGpsFromOriginal()` strips ALL EXIF except orientation and ICC, removing copyright, artist, and image description.

**Recommendation:** Do not modify the stored original. Strip GPS only from derivatives (which already have no EXIF except ICC). Download-original endpoint should serve a metadata-stripped copy on-the-fly.

---

## R9 Closure Confirmation

All R9 findings are confirmed closed in current code:

| R9 ID | Severity | Status |
|-------|----------|--------|
| R9-R1 | Firefox false positive | Fixed |
| R9-H1 | ProPhoto P3 badge | Fixed |
| R9-R2 | HDR badge wording | Fixed (says "HDR-capable") |
| R9-R3 | Firefox display-change docs | Fixed |
| R9-M1 | DCI-P3 gamma26 | Fixed |
| R9-M2 | Stored decision frozen | Documented (backfill reconciles) |
| R9-M3 | ProPhoto clip disclosure | Fixed |
| R9-M4 | Backfill decision refresh | Fixed |
| R9-M5 | ETag staleness warning | Fixed (UI warning implemented) |
| R9-M6 | Matrix coefficients UI | Fixed |
| R9-M7 | EXIF color_space UI | Fixed |
| R9-M8 | Lightbox DCI-P3 tooltip | Fixed |
| R9-M9 | Histogram desktop resolution | Fixed |
| R9-M10-13 | Browser/display docs | Fixed |
| R9-LOW | All 22 LOW findings | Fixed |

---

## Recommended Priority Order

| Rank | Finding | Effort | Why First |
|------|---------|--------|-----------|
| 1 | R10-C1 Verify `toColorspace('p3')` pixel conversion | M | CRITICAL — could undermine entire wide-gamut pipeline |
| 2 | R10-H1 WI-15 ICC preservation | XS (1 line) | Color accuracy for large wide-gamut sources |
| 3 | R10-H3 SW ETag comparison | M | Stale images persist beyond HTTP cache |
| 4 | R10-H2 Failed image visibility | M (schema + UI) | Admin operational awareness |
| 5 | R10-H6 Remove `max-h-[80vh]` | XS | Biggest visual impact for smallest change |
| 6 | R10-H4 Firefox UI signals | S | Photographer credibility |
| 7 | R10-H5 Masonry gamut badge | S | Data layer extension required |
| 8 | R10-M3 JPEG chroma target-based | XS (1 line) | Consistent with photographer intent |
| 9 | R10-M14 Conditional backfill warning | S | Reduces admin confusion |
| 10 | R10-M8 Wide-gamut hint delivery gamut | XS | Copy change only |
| 11 | R10-M11 Blur crossfade | S | Visual polish |
| 12 | R10-M2 Histogram P3 coefficients | XS | Technical correctness |
| 13 | R10-M5 Key-type percentile | S | Better classification |
| 14 | R10-M4 Delivered bit depth label | XS | Copy/conditional |
| 15 | R10-M12 Consistent bottom sheet | S | Code cleanup |
| 16 | R10-M13 Ken Burns scale cap | XS | Visual polish |
| 17 | R10-M9 BT.2020 transfer label | XS | Technical correctness |
| 18 | R10-M10 Remove raw CSS MQ | XS | CSS cleanup |
| 19 | R10-M6 AVIF NCLX verify | S | Future-proofing |
| 20 | R10-M7 WebP ICC verify | S | Fallback format correctness |
| 21+ | All LOW findings | XS–S | Polish and documentation |

---

## Verdict

**REQUEST CHANGES on R10-C1** — The CRITICAL finding about `toColorspace('p3')` pixel conversion MUST be verified with a fixture test before the wide-gamut pipeline can be fully trusted. The existing round-trip tests prove ICC profiles are embedded, but do NOT prove pixel values are actually converted to P3 gamut.

**All HIGH findings** are non-blocking but represent significant photographer-experience improvements. R10-H1 (WI-15 ICC loss) is a one-line fix with high color-accuracy impact. R10-H3 (SW ETag blindness) affects caching correctness. R10-H2 (failed image invisibility) is an operational gap.

**MEDIUM and LOW findings** are polish, documentation, and edge-case improvements. No scope reduction needed — all can be addressed in subsequent iterations.

*Aggregate compiled from 4 parallel reviewer reports. Total lines reviewed: ~12,000 across 40+ files.*
