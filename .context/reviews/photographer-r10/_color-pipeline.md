# Photographer Review R10 — Color Pipeline, HDR & Display Detection

**Date:** 2026-05-16
**Scope:** Deep review of color pipeline, HDR workflow, and display detection from photographer perspective. R9 findings have been implemented; this round focuses on what R9 missed and integration gaps between R9 features.
**Reviewer:** Color Pipeline + Display Detection cross-pass

---

## Severity Summary

| Severity | Count | New in R10 |
|----------|-------|------------|
| CRITICAL | 1 | R10-C1 |
| HIGH | 1 | R10-H1 |
| MEDIUM | 5 | R10-M1–M5 |
| LOW | 6 | R10-L1–L6 |

**R9 closure confirmation:** All 39 R9 findings (1 CRIT, 3 HIGH, 13 MED, 22 LOW) are verified closed in current code. R9-R1 (Firefox false positive), R9-H1 (ProPhoto badge), R9-R2 (HDR badge wording), R9-M1–M13, and all LOW findings are addressed.

---

## CRITICAL

### R10-C1 — `toColorspace('p3')` is not a documented libvips colorspace; pixel conversion path is unclear

**Files:** `apps/web/src/lib/process-image.ts:877`, `apps/web/src/lib/process-image.ts:856`, `apps/web/src/lib/process-image.ts:918`
**Impact:** The core wide-gamut encode chain calls `.toColorspace('p3')` for AVIF, WebP, and JPEG when the source is P3 or wider. Sharp's `toColorspace` delegates to libvips' `vips_colourspace`, whose documented values are: `srgb`, `rgb16`, `scrgb`, `cmyk`, `lab`, `xyz`, `b-w`. There is no `p3` value in the libvips `VipsInterpretation` enum. The fact that the round-trip tests pass suggests one of three things:

1. Sharp maps `'p3'` internally to a bundled Display P3 ICC profile + `rgb16` pipeline (best case)
2. libvips silently falls back to `srgb` when given an unknown colorspace name (worst case — wide-gamut pixels are converted to sRGB despite the `withIccProfile('p3')` tag)
3. The string reaches libavif which handles it as a CICP signal (unlikely — Sharp's AVIF encoder uses its own CICP logic)

The existing fixture tests at `__tests__/process-image-color-roundtrip.test.ts` verify that the OUTPUT file carries a P3 ICC profile, but they do NOT verify that the pixel values are actually in P3 gamut (only that the profile is present). A source with saturated P3-red (1.0, 0.0, 0.0 in P3 space) encoded through `.toColorspace('p3')` could end up as sRGB-red (1.0, 0.0, 0.0 in sRGB space) with a P3 ICC profile falsely attached — the profile would lie about the pixel values.

**Why this is CRITICAL:** If case (2) is true, every wide-gamut photo in the gallery is silently converted to sRGB pixels while carrying a P3 ICC profile. A P3-capable browser would interpret the sRGB pixel values as P3 coordinates, producing dramatically wrong colors (oversaturated reds, shifted hues). This undermines the entire photographer-intent premise of the product.

**Fix:** Add a fixture test that creates a synthetic Display-P3 source with a known out-of-sRGB-gamut color (e.g., P3 pure green: RGB(0, 255, 0) in P3 space, which is outside the sRGB triangle), runs it through `processImageFormats()`, and asserts that the decoded output pixel is NOT clamped to sRGB. If the decoded value is approximately (0, 255, 0) in P3 space, the conversion is working. If it's clipped to sRGB green (~(50, 255, 30) or similar), the `toColorspace('p3')` call is not performing actual gamut conversion.

Alternatively, verify the Sharp/libvips source to confirm how `'p3'` is handled in `toColorspace`. If it maps to `VIPS_INTERPRETATION_sRGB` or similar, the pipeline is broken.

---

## HIGH

### R10-H1 — Wide-gamut hint names the source gamut, not the delivery gamut, misleading visitors

**Files:** `apps/web/src/components/wide-gamut-hint.tsx:43`, `apps/web/src/components/color-details-section.tsx:373-386`, `apps/web/messages/en.json:355`, `apps/web/messages/ko.json:355`
**Impact:** For a Rec. 2020 source (which is delivered as P3-clipped), the hint says "The full color gamut is available on Rec. 2020 screens." But the delivery is P3 — a visitor with a Display P3 screen already sees everything there is to see. A Rec. 2020 screen would NOT show additional gamut because the delivery is capped at P3. The same issue exists for Adobe RGB and ProPhoto sources.

The `humanizeColorPrimaries(image.color_primaries)` returns the SOURCE primaries name ("Rec. 2020", "Adobe RGB", etc.), not the delivery gamut.

**Fix:** Change the hint to always say "Display P3" for all wide-gamut sources, because that is the actual delivery gamut ceiling:

```typescript
// In wide-gamut-hint.tsx
const deliveryGamut = isP3Pipeline(image.color_pipeline_decision) ? 'Display P3' : humanizeColorPrimaries(colorPrimaries);
```

Or update the i18n string to accept a second parameter for the delivery gamut:
```json
"wideGamutHint": "Your display shows the sRGB version of this photo. The full color gamut is available on {deliveryGamut} screens (source: {sourceGamut})."
```

---

## MEDIUM

### R10-M1 — `deliveredBitDepthP3` label doesn't account for forceSrgbDerivatives or 10-bit probe failure

**Files:** `apps/web/src/components/color-details-section.tsx:373-386`, `apps/web/messages/en.json:315`, `apps/web/messages/ko.json:315`
**Impact:** The `deliveredBitDepthP3` translation says "10-bit AVIF, 8-bit WebP/JPEG" but this is only true when:
1. The 10-bit AVIF probe succeeded (not guaranteed — falls back to 8-bit per image)
2. `forceSrgbDerivatives` is false (when true, WebP/JPEG are sRGB, not P3 8-bit)

When `forceSrgbDerivatives=true`, the WebP/JPEG derivatives are sRGB-tagged, but the label still says "8-bit WebP/JPEG" which implies P3 8-bit. The `forceSrgbDerivativesNote` below partially explains this, but the delivered bit depth row is misleading.

**Fix:** Make the delivered bit depth label conditional on `forceSrgbDerivatives`:

```typescript
// In color-details-section.tsx
const avifBitDepth = isP3Pipeline(decision) ? '10-bit' : '8-bit';
const webpJpegBitDepth = forceSrgbDerivatives ? '8-bit sRGB' : '8-bit P3';
// Or use separate i18n keys for the four combinations
```

### R10-M2 — Histogram luminance uses BT.709 coefficients for all primaries

**Files:** `apps/web/public/histogram-worker.js:25`
**Impact:** The histogram worker computes luminance using BT.709 coefficients (`0.2126 * R + 0.7152 * G + 0.0722 * B`) regardless of the image's actual color primaries. For P3 images decoded into a P3 canvas, the correct coefficients are P3-specific (`0.22897, 0.69174, 0.07929`). The difference is ~2–3% in luminance bins, which shifts the histogram peaks and can affect the `estimateKeyType` classification.

The code comment acknowledges this but dismisses it as "acceptable." For a photographer using the histogram as an audit tool, even small errors matter.

**Fix:** Pass the color primaries to the worker and select coefficients accordingly:

```javascript
// In histogram-worker.js
function getLuminanceCoefficients(primaries) {
    if (primaries === 'p3-d65' || primaries === 'dci-p3') {
        return { r: 0.22897, g: 0.69174, b: 0.07929 };
    }
    // BT.709 / sRGB default
    return { r: 0.2126, g: 0.7152, b: 0.0722 };
}
```

### R10-M3 — `estimateKeyType` threshold is arbitrary and can misclassify

**Files:** `apps/web/src/components/histogram.tsx:347-354`
**Impact:** The key-type estimate uses a simple mean-luminance threshold: >170 = high-key, <85 = low-key. This is naive. A true high-key image has most histogram mass concentrated in the highlights (right tail), not just a high mean. Consider:
- An image with 50% pure white and 50% pure black: mean = 127.5 → classified as "balanced" even though it's a high-contrast image
- An image with 70% mid-gray (128) and 30% highlights: mean ≈ 140 → classified as "balanced" even though it's mostly mid-tones
- An image with 90% light gray (200) and 10% shadows: mean = 189 → classified as "high-key" correctly, but so would an image with 50% white (255) and 50% medium gray (130): mean = 192.5

A photographer would expect key-type classification based on percentile analysis (e.g., 90th percentile > 230 for high-key, 10th percentile < 30 for low-key).

**Fix:** Replace mean-based threshold with percentile-based analysis:

```typescript
function estimateKeyType(data: HistogramData): 'high-key' | 'low-key' | 'balanced' {
    const total = data.l.reduce((sum, v) => sum + v, 0);
    if (total === 0) return 'balanced';

    // Compute cumulative distribution
    let cum = 0;
    const p10 = (() => { for (let i = 0; i < 256; i++) { cum += data.l[i]; if (cum / total >= 0.10) return i; } return 0; })();
    cum = 0;
    const p90 = (() => { for (let i = 0; i < 256; i++) { cum += data.l[i]; if (cum / total >= 0.90) return i; } return 255; })();

    if (p90 > 220 && p10 > 100) return 'high-key';      // mostly bright, little shadow
    if (p10 < 40 && p90 < 180) return 'low-key';        // mostly dark, little highlight
    return 'balanced';
}
```

### R10-M4 — NCLX transfer code 14/15 (BT.2020 10/12-bit SDR) mapped to 'gamma22' instead of closer approximation

**Files:** `apps/web/src/lib/color-detection.ts:185-186`
**Impact:** ITU-T H.273 values 14 and 15 represent BT.2020 10-bit and 12-bit SDR, which use a transfer function closer to gamma 2.4 (BT.1886) than gamma 2.2. The current mapping to 'gamma22' is an approximation that misrepresents the source mastering conditions for BT.2020 SDR content.

**Fix:** Add a new transfer function label `'gamma24'` or `'bt1886'` and map values 14/15 to it. Update `humanizeTransferFunction` and the i18n strings.

### R10-M5 — `color-gamut: p3` MQ in CSS fires on P3-capable browsers regardless of actual display

**Files:** `apps/web/src/app/[locale]/globals.css:171`
**Impact:** The `.gamut-p3-badge` CSS rule uses `@media (color-gamut: p3)` to show/hide the badge. On browsers that support this MQ (Chrome, Safari, Edge), the MQ matches when the BROWSER supports P3, not when the DISPLAY is P3. A user on an sRGB display with a P3-capable browser will see the badge. This is mitigated by the `data-display-gamut` attribute fallback (line 172-173), but the MQ alone is incorrect.

**Fix:** Remove the `@media (color-gamut: p3)` rule and rely solely on `data-display-gamut`. The `useDisplayCapability` hook already does layered detection and is more accurate than the raw MQ.

```css
/* Remove this line */
@media (color-gamut: p3) { .gamut-p3-badge { display: inline-block; } }

/* Keep only the data-display-gamut rules */
[data-display-gamut="p3"] .gamut-p3-badge,
[data-display-gamut="rec2020"] .gamut-p3-badge { display: inline-block; }
```

---

## LOW

### R10-L1 — No `image-rendering` CSS optimization on photo viewer images

**Files:** `apps/web/src/components/photo-viewer.tsx:413` (img className), `apps/web/src/components/lightbox.tsx:439` (img className), `apps/web/src/components/home-client.tsx:293` (masonry img className)
**Impact:** The photo viewer, lightbox, and masonry grid all use standard browser image rendering. Modern CSS offers `image-rendering: high-quality` (Safari 17.4+) and `image-rendering: crisp-edges` which can improve perceived sharpness when images are displayed at sizes different from their native resolution. This is particularly relevant for the masonry grid where thumbnails are displayed at smaller sizes than their native resolution.

**Fix:** Add `image-rendering: high-quality` to photo viewer and lightbox images, and `image-rendering: crisp-edges` to masonry thumbnails:

```css
.photo-viewer-image, .lightbox-image {
    image-rendering: high-quality;
}
.masonry-card img {
    image-rendering: crisp-edges;
}
```

### R10-L2 — Blur data URL is always sRGB regardless of source gamut

**Files:** `apps/web/src/lib/process-image.ts:637-659`, `apps/web/src/lib/blur-data-url.ts:33-37`
**Impact:** The `blur_data_url` (16x16 JPEG q40 preview) is always generated as sRGB. For wide-gamut sources, the instant preview shown while the full image loads is color-clipped to sRGB. This is acceptable for a tiny 16x16 blur but means the first visual impression is not color-accurate for wide-gamut photos.

**Fix:** Document this as a known limitation. Generating a P3 blur would require a P3 JPEG (which most browsers don't support) or an AVIF blur (which would be larger and slower to decode). The current sRGB blur is a pragmatic trade-off.

### R10-L3 — Masonry grid images lack explicit `decoding` hint

**Files:** `apps/web/src/components/home-client.tsx:288-296`
**Impact:** The masonry `<img>` elements have `loading="lazy"` or `loading="eager"` but no `decoding="async"` attribute. The photo viewer and lightbox both use `decoding="async"`. Adding this hint allows the browser to decode images off the main thread, improving scroll performance on the masonry grid.

**Fix:** Add `decoding="async"` to the masonry grid `<img>` element.

### R10-L4 — RAW file formats rejected without informative message

**Files:** `apps/web/src/lib/process-image.ts:158-161`
**Impact:** The `ALLOWED_EXTENSIONS` set does not include RAW formats (`.cr3`, `.nef`, `.arw`, `.dng`, `.raf`, `.orf`, `.pef`, `.rw2`). Photographers who try to upload RAW files get a generic "File extension not allowed" error without explanation. Sharp does not support RAW decoding natively, so this is by design, but the error message could be more helpful.

**Fix:** Add RAW extensions to `ALLOWED_EXTENSIONS` with a pre-flight check that rejects them with an informative message: "RAW files are not supported. Please export to JPEG, TIFF, or PNG before uploading."

### R10-L5 — Ken Burns animation in lightbox doesn't respect reduced-motion for transform

**Files:** `apps/web/src/components/lightbox.tsx:446-455`
**Impact:** When `prefers-reduced-motion: reduce` is enabled, the Ken Burns animation is disabled entirely (the image stays static). However, the CSS `transform` properties (`scale`, `translate`) are still applied if `isSlideshowActive` is true, even though the animation duration is not set. This could cause the image to be stuck in a transformed state.

**Fix:** Guard the transform style with `shouldReduceMotion`:

```typescript
style={
    isSlideshowActive && !shouldReduceMotion
        ? { animation: ..., transformOrigin: ..., '--kb-start': ..., '--kb-end': ... }
        : undefined
}
```

The current code already has this guard (line 447 checks `!shouldReducedMotion`), but verify the initial state when `shouldReduceMotion` is true and `isSlideshowActive` becomes true.

### R10-L6 — `wideGamutMaxSourcePixels` included in settings hash causes unnecessary cache invalidation

**Files:** `apps/web/src/lib/settings-hash.ts:35`
**Impact:** The `wide_gamut_max_source_pixels` setting is included in the ETag hash. This setting only affects NEW uploads (sources above the cap are downscaled before processing). Existing derivative files are NOT affected by this setting. Including it in the hash causes unnecessary cache invalidation for all images when an admin tweaks the memory cap, even though the file bytes haven't changed.

**Fix:** Remove `wide_gamut_max_source_pixels` from `COLOR_IMPACTING_KEYS` in `settings-hash.ts`. The setting affects processing behavior, not the bytes of already-encoded files.

---

## Positive Observations

1. **R9-R1 Firefox fix is solid:** The canvas-P3 probe has been completely removed from `useDisplayCapability`, defaulting Firefox to `'srgb'`. The `data-display-gamut` attribute on `<html>` correctly gates badge visibility for Firefox users.

2. **ICC round-trip tests are comprehensive:** The fixture tests at `__tests__/process-image-color-roundtrip.test.ts` verify P3→P3, Adobe→P3, ProPhoto→P3, Rec.2020→P3, and forceSrgbDerivatives behavior. The test coverage for color pipeline decisions is excellent.

3. **Histogram source indicator works correctly:** The `histogramSource` variable (R9-LOW) correctly shows "AVIF" when preferAvif is true and "JPEG" otherwise. The fallback chain (AVIF → sized JPEG → base JPEG) is robust and handles legacy photos gracefully.

4. **`was_downscaled` integration is clean:** The admin-only "Source downscaled" row in `ColorDetailsSection` correctly shows when WI-15 triggered, and the `wideGamutDownscaleWarning` upload message explains to photographers why their large wide-gamut sources were resized.

5. **DCI-P3 Bradford tooltip is present in both surfaces:** The lightbox color pip (R9-M8) now replicates the info button + tooltip pattern from the sidebar Color Details accordion, showing the Bradford D63→D65 white-point adaptation note.

6. **Backfill decision refresh is implemented:** R9-M4 is fixed — `backfill-color-pipeline.ts:137-149` recomputes `colorPipelineDecision` and includes it in the batch UPDATE.

7. **Matrix coefficients and EXIF color space surfaced:** R9-M6 and R9-M7 are fixed — admin-only rows show matrix coefficients (BT.709 / BT.2020 NCL / BT.2020 CL / Identity) and EXIF ColorSpace tag value.

8. **ProPhoto/Rec.2020 clip disclosure is honest:** R9-M3 is fixed — the "(clipped to P3)" badge appears next to the pipeline decision for ProPhoto and Rec.2020 sources.

---

## Cross-File Integration Assessment

| Feature | Components | Integration Status |
|---------|-----------|-------------------|
| `was_downscaled` | `process-image.ts` → `image-queue.ts` → `ColorDetailsSection` | **Good** — DB column written at queue completion, read in audit panel |
| Histogram source indicator | `histogram.tsx` → `photo-viewer.tsx` → `lightbox-color-pip.tsx` | **Good** — `histogramSource` shows AVIF/JPEG correctly |
| Key-type estimate | `histogram.tsx` → `histogram-worker.js` → i18n | **Acceptable** — naive mean threshold, but functional |
| `force_show_color_chips` | `globals.css` → `photo-viewer.tsx` → `useDisplayCapability` | **Good** — CSS override works, SSR default avoids flicker |
| ETag settings hash | `settings-hash.ts` → `serve-upload.ts` → `gallery-config.ts` | **Good** — hash recomputed from resolved config, 5s cache |
| HDR badge + honesty note | `color-details-section.tsx` → `lightbox-color-pip.tsx` → i18n | **Good** — badge says "HDR-capable", note says "Delivered as SDR" |
| Gain map detection → audit | `gain-map-detection.ts` → `color-detection.ts` → `ColorDetailsSection` | **Good** — flat boolean sufficient for current SDR-only delivery |

---

## Recommended Priority Order

| Rank | Finding | Effort | Why |
|------|---------|--------|-----|
| 1 | R10-C1 Verify `toColorspace('p3')` pixel conversion | M | CRITICAL — could undermine entire wide-gamut pipeline |
| 2 | R10-H1 Wide-gamut hint names source gamut | XS | Misleading visitor-facing copy |
| 3 | R10-M5 Remove raw `(color-gamut: p3)` MQ | XS | Badge shows on sRGB displays with P3-capable browsers |
| 4 | R10-M1 `deliveredBitDepthP3` label accuracy | XS | Misleading when forceSrgbDerivatives is ON |
| 5 | R10-M2 Histogram luminance coefficients | S | Audit tool accuracy |
| 6 | R10-M3 `estimateKeyType` percentile-based | S | Better photographer-facing classification |
| 7 | R10-M4 BT.2020 SDR transfer label | XS | Technical correctness |
| 8+ | All LOW findings | XS | Polish |

---

## Verdict

**REQUEST CHANGES** — R10-C1 is a CRITICAL finding that must be verified before the wide-gamut pipeline can be trusted. The existing round-trip tests prove ICC profiles are embedded, but they do NOT prove pixel values are actually converted to P3 gamut. A targeted fixture test with an out-of-sRGB-gamut color patch would resolve this uncertainty.

Once R10-C1 is verified (either confirmed working with evidence, or fixed if broken), the remaining findings are non-blocking improvements that can ship in subsequent iterations.
