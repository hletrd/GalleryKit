# Photographer Review R10 — UI/UX Audit

**Date:** 2026-05-16
**Reviewer:** UI/UX Photographer Perspective
**Scope:** Photo viewing experience, color metadata presentation, mobile UX, lightbox, histogram, download flow, admin settings, accessibility, thumbnail grid, share pages
**Premise:** Photos arrive AFTER the photographer's editing. The viewer must communicate photographer intent accurately to every visitor.

---

## R9 Closure Confirmation

All R9 findings are confirmed closed in current code:

| R9 ID | Severity | Status | Evidence |
|-------|----------|--------|----------|
| R9-R1 | CRITICAL | Fixed | `use-display-capability.ts:64-67` — Firefox defaults to `'srgb'`, canvas-P3 probe removed from display detection |
| R9-R2 | HIGH | Fixed | `en.json:340-341` — badge now reads "HDR-capable" / "HDR 지원" with SDR delivery aria-label |
| R9-R3 | HIGH | Documented | `use-display-capability.ts:104-105` — Firefox limitation documented in code comments |
| R9-H1 | HIGH | Fixed | `color-details-section.tsx:35-39` — strict allowlist `['display p3', 'p3-d65', 'dci-p3']` replaces substring match |
| R9-M1 | MED | Fixed | `color-detection.ts` — DCI-P3 returns `'gamma26'` (verified in `humanizeTransferFunction` at line 63) |
| R9-M3 | MED | Fixed | `color-details-section.tsx:299-303` — "(Clipped to P3)" badge for ProPhoto/Rec.2020 |
| R9-M4 | MED | Fixed | `backfill-color-pipeline.ts` — `colorPipelineDecision` recomputed in reprocessRow |
| R9-M6 | MED | Fixed | `color-details-section.tsx:331-336` — matrix coefficients row rendered |
| R9-M7 | MED | Fixed | `color-details-section.tsx:340-345` — EXIF color_space row rendered |
| R9-M8 | MED | Fixed | `lightbox-color-pip.tsx:158-173` — DCI-P3 Bradford tooltip replicated in lightbox |
| R9-M9 | MED | Fixed | `histogram.tsx:378-388` — desktop canvas 320x160 via resize listener |
| R9-L18 | LOW | Fixed | `histogram.tsx:450` — source indicator "Source: AVIF" / "Source: JPEG" |
| R9-L19 | LOW | Fixed | `histogram.tsx:347-354, 609-613` — key-type estimate (High-key/Low-key/Balanced) |
| R9-L20 | LOW | Fixed | `wide-gamut-hint.tsx:47` — interpolates `{gamut}` name into hint message |
| R9-L21 | LOW | Fixed | `lightbox-color-pip.tsx:196-207` — copy-to-clipboard button in expanded panel |

---

## Severity Summary

| Severity | Count | New in R10 |
|----------|-------|------------|
| CRITICAL | 0 | — |
| HIGH | 3 | R10-H1, R10-H2, R10-H3 |
| MEDIUM | 7 | R10-M1–R10-M7 |
| LOW | 8 | R10-L1–R10-L8 |

---

## HIGH

### R10-H1 — Masonry thumbnail grid gives zero indication of wide-gamut or HDR content

**Files:** `home-client.tsx:248-331` (masonry card rendering)
**Impact:** A photographer who has carefully curated a gallery with P3/HDR content has no visual way to communicate this to visitors before they click. Every photo looks identical in the grid regardless of color gamut, bit depth, or HDR status. Visitors must click into each photo individually to discover color metadata. This undermines the photographer's intent to showcase their technical craft.

**Root cause:** The `GalleryImage` type (line 58-71) carries no color fields, and the masonry card rendering uses only `filename_avif/webp/jpeg`, dimensions, title, and topic. No `color_primaries`, `is_hdr`, or `color_pipeline_decision` fields are passed through.

**Fix options:**
1. **Minimal:** Add a subtle color-indicator dot or border to masonry cards for wide-gamut/HDR images. A 4px bottom border in the P3 badge purple (`bg-purple-500`) for P3 sources, and an amber dot for HDR sources. Gate display on `data-display-gamut` / `data-force-show-color-chips` same as the viewer badges.
2. **Preferred:** Extend `GalleryImage` to include `color_primaries` and `is_hdr` (both are public-safe fields — not in `_PrivacySensitiveKeys`), then render a small chip in the card overlay (bottom-left, beside the title) for non-sRGB sources. Keep it subtle: `text-[10px] bg-purple-500/80 text-white px-1.5 py-0.5 rounded` — photographers want this visible, casual visitors won't be distracted.
3. **Admin-only:** If public exposure is undesirable, at least show gamut/HDR badges in the admin image manager grid so the photographer can audit their collection at a glance.

**Recommended:** Option 2 for public grid + Option 3 for admin grid. The `color_primaries` field is already public (not in `_PrivacySensitiveKeys`), and `is_hdr` is admin-only, so public grid should only show the gamut badge.

---

### R10-H2 — Photo viewer caps image height at 80vh, causing unnecessary letterboxing

**Files:** `photo-viewer.tsx:387, 413` (`max-h-[80vh]` on both `<img>` and `<picture>` children)
**Impact:** On a 27" 16:9 monitor viewing a 3:2 landscape photo, `max-h-[80vh]` leaves ~20% of vertical viewport unused while horizontal space is plentiful. The photo is shown smaller than it could be, reducing the impact of fine detail and tonal gradation the photographer worked to preserve. This is especially frustrating for wide-gamut photos where the visual impact of saturated colors depends on size.

**Root cause:** The `max-h-[80vh]` was likely added to ensure the toolbar and info sidebar remain visible, but it over-constrains the image. The grid layout already reserves space for the sidebar via `grid-cols-[1fr_350px]`, so the image container has bounded width. The height cap is redundant and counterproductive.

**Fix:** Remove `max-h-[80vh]` from the image elements. Instead, let the image container (`min-h-[40vh] md:min-h-[500px]`) drive the minimum size, and allow the image to fill available space naturally via `object-contain`. If the concern is toolbar visibility, the toolbar is already `sticky` on mobile landscape (see `globals.css:204-222`). On desktop, the toolbar is above the image grid row and doesn't overlap.

```tsx
// Before (photo-viewer.tsx:413):
className="w-full h-full object-contain max-h-[80vh] z-0 relative photo-viewer-image"

// After:
className="w-full h-full object-contain z-0 relative photo-viewer-image"
```

Verify that the `PhotoNavigation` arrow buttons (overlaying the image container at line 601-606) don't get pushed off-screen on very tall images. The container's `overflow-hidden` and flex centering should handle this.

---

### R10-H3 — Histogram key-type terminology is opaque to non-photographers

**Files:** `histogram.tsx:609-613` (key-type label rendering)
**Impact:** The histogram displays "High-key", "Low-key", or "Balanced" below the canvas. These are standard photography terms, but a casual visitor (or a client reviewing a proof gallery) may not understand them. "High-key" sounds like a positive judgment ("this photo is high quality") rather than a technical description of a bright, low-contrast image. This miscommunication undermines the photographer's intent to inform.

**Root cause:** The `estimateKeyType` function (lines 347-354) returns photographer jargon without contextual explanation.

**Fix:** Replace the bare label with a tooltip or parenthetical explanation. Use the existing i18n infrastructure:

```tsx
// In histogram.tsx, replace:
<div className="text-xs text-muted-foreground">
    {t(`viewer.keyType${estimateKeyType(histogramData)}`)}
</div>

// With:
<div className="text-xs text-muted-foreground">
    <span className="font-medium">{t('viewer.keyTypeLabel')}:</span>
    {' '}
    <Tooltip>
        <TooltipTrigger asChild>
            <button type="button" className="underline decoration-dotted">
                {t(`viewer.keyType${estimateKeyType(histogramData)}`)}
            </button>
        </TooltipTrigger>
        <TooltipContent>
            {t(`viewer.keyType${estimateKeyType(histogramData)}Tooltip`)}
        </TooltipContent>
    </Tooltip>
</div>
```

Add translation keys:
- `viewer.keyTypeLabel`: "Tonal character"
- `viewer.keyTypehigh-keyTooltip`: "Mostly bright tones with low contrast — typical of airy, optimistic moods"
- `viewer.keyTypelow-keyTooltip`: "Mostly dark tones with high contrast — typical of dramatic, moody moods"
- `viewer.keyTypebalancedTooltip`: "Even distribution of tones across the range"

Korean equivalents should avoid literal translation of "key" (키) which is meaningless in this context. Use "톤" (tone) or "밝기 분포" (brightness distribution).

---

## MEDIUM

### R10-M1 — No `image-rendering` optimization for scaled photos

**Files:** `photo-viewer.tsx:413` (`<img>` in picture element), `lightbox.tsx:434-456` (lightbox `<img>`)
**Impact:** When a high-resolution source is displayed at smaller sizes (e.g., a 4096px image shown in a 1200px container), browsers use their default scaling algorithm. Chrome/Firefox use bilinear; Safari uses a sharper Lanczos-like algorithm by default. The result is that the same photo looks softer in Chrome than Safari, especially for downscaled wide-gamut images where color edge sharpness matters.

**Root cause:** No `image-rendering` CSS property is set on any `<img>` element.

**Fix:** Add `image-rendering: high-quality` (standard CSS, supported by Safari 16.4+, Chrome 108+) as a progressive enhancement:

```css
/* globals.css */
.photo-viewer-image,
.lightbox-image {
  image-rendering: high-quality;
}
```

For broader compatibility, also include the legacy `-webkit-optimize-contrast` for older Safari:

```css
.photo-viewer-image,
.lightbox-image {
  image-rendering: -webkit-optimize-contrast;
  image-rendering: high-quality;
}
```

Note: Do NOT use `crisp-edges` (nearest-neighbor) — that produces pixelated edges on downscaled photos. `high-quality` is the correct photographer-friendly value.

---

### R10-M2 — Blur background + fading image create "double exposure" during transition

**Files:** `photo-viewer.tsx:174-183` (blurStyle memo), `photo-viewer.tsx:609-625` (AnimatePresence with blur background)
**Impact:** When navigating between photos, the `motion.div` has a `blurStyle` background-image AND contains the actual image which fades in with `opacity: 0 -> 1` over 0.2s. During those 200ms, the viewer sees BOTH the blurred preview AND the loading full-res image simultaneously — a "double exposure" effect where two versions of the photo are superimposed. This is visually jarring and looks unprofessional.

**Root cause:** The `blurStyle` is applied to the `motion.div` wrapper, not to a separate layer that gets hidden once the image loads. The blurDataUrl is a background-image on the same element that contains the fading-in `<picture>`.

**Fix:** Move the blur background to a separate inner `div` that fades OUT as the image fades IN. Use the `onLoad` event of the inner image to trigger the blur fade-out:

```tsx
// Suggested restructuring:
<motion.div key={image.id} ...>
    <div className="w-full h-full flex items-center justify-center relative">
        {/* Blur layer — fades out when image loads */}
        <div
            className={cn(
                "absolute inset-0 transition-opacity duration-300",
                imageLoaded ? "opacity-0" : "opacity-100"
            )}
            style={blurStyle}
        />
        {/* Actual image */}
        <ImageZoom className="w-full h-full flex items-center justify-center">
            <picture onLoad={() => setImageLoaded(true)}>
                {srcSetData}
            </picture>
        </ImageZoom>
    </div>
</motion.div>
```

This ensures the blur is only visible while the real image is loading, and the crossfade is clean rather than overlapping.

---

### R10-M3 — Inconsistent histogram ordering in mobile bottom sheet

**Files:** `info-bottom-sheet.tsx:299-382` (non-trivial color: histogram BEFORE EXIF), `info-bottom-sheet.tsx:518-601` (sRGB: histogram AFTER EXIF)
**Impact:** For wide-gamut/HDR photos, the mobile bottom sheet shows Histogram + Capture Date + Download BEFORE the EXIF grid. For sRGB photos, the EXIF grid comes first, then Histogram + Capture Date + Download after. A photographer browsing their gallery on mobile will experience inconsistent information ordering depending on each photo's color profile. This breaks muscle memory and spatial orientation.

**Root cause:** The `isNonTrivialColor` gate (line 166-170) conditionally reorders content to "surface color-relevant content first," but this creates two different layouts.

**Fix:** Standardize on a single ordering for all photos. The most photographer-friendly order is:
1. Title + tags + description
2. Color details accordion
3. Wide-gamut hint (if applicable)
4. EXIF grid
5. Histogram
6. Capture date
7. Download

This ordering puts the most distinctive/technical info (color, EXIF) before the generic (histogram, download), and is consistent regardless of gamut. Remove the conditional reordering and always use one layout.

---

### R10-M4 — Ken Burns slideshow zooms image beyond delivered resolution

**Files:** `lightbox.tsx:65-76` (`kenBurnsTransform`), `lightbox.tsx:446-456` (CSS animation with scale 1.08)
**Impact:** During slideshow mode, the Ken Burns animation scales the image to 1.08x (108%). If the browser is displaying a 1536px-wide JPEG on a 1920px viewport, the 1.08x zoom effectively requests ~1658px of content from a 1536px source. The browser must upscale, revealing pixelation and softness. For photographers who spent time on sharpness and detail, this cheapens the presentation.

**Root cause:** The `kenBurnsTransform` function hardcodes `scale(1.08)` without considering the actual display size vs. source resolution ratio.

**Fix:** Cap the Ken Burns scale based on the available source resolution vs. viewport size. Alternatively, reduce the zoom to a subtler 1.03x that won't exceed source resolution in typical configurations:

```ts
// In kenBurnsTransform:
// variant 0: zoom in from bottom-left, pan toward top-right
// Use 1.03 instead of 1.08 to avoid upscaling artifacts
return phase === 'start'
    ? 'scale(1) translate(0%, 0%)'
    : 'scale(1.03) translate(-1%, -1%)';
```

A 3% zoom is still perceptible as motion but won't trigger upscaling on most configurations. Alternatively, disable Ken Burns entirely when the source image is smaller than the viewport (calculate `image.width < window.innerWidth` or use the srcset sizes).

---

### R10-M5 — Wide-gamut hint amber-on-amber contrast may fail WCAG AA

**Files:** `wide-gamut-hint.tsx:46-48` (hint container styling)
**Impact:** The wide-gamut hint uses `bg-amber-50 text-amber-800` in light mode. The amber-50 background (#fffbeb) against amber-800 text (#92400e) has a contrast ratio of approximately 5.8:1, which passes WCAG AA (4.5:1) but is borderline. In dark mode, `dark:bg-amber-900/20 dark:text-amber-200` uses a very translucent background (20% opacity) over the card background, which may drop the effective contrast below 4.5:1 depending on the underlying card color.

**Root cause:** The amber color palette at low opacity (20%) in dark mode doesn't guarantee sufficient contrast.

**Fix:** Darken the light-mode background to `bg-amber-100` (contrast improves to ~7.1:1). In dark mode, either increase opacity to `/40` or use a solid `dark:bg-amber-900` background:

```tsx
<div className="mt-2 px-3 py-2 text-xs rounded bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900 dark:text-amber-100">
```

Verify with a contrast checker after implementation.

---

### R10-M6 — Download button label "Display P3 JPEG" implies 10-bit JPEG

**Files:** `photo-viewer.tsx:861` (`t('viewer.downloadP3Jpeg')` → "Download (Display P3 JPEG)"), `en.json:323`
**Impact:** A photographer downloading their wide-gamut photo sees "Display P3 JPEG" and may reasonably assume they're getting a 10-bit JPEG (since Display P3 at 10-bit is mentioned elsewhere in the UI as the AVIF delivery format). But JPEG is inherently 8-bit. The label should clarify that the JPEG is 8-bit P3, or avoid mentioning P3 for JPEG altogether since the JPEG delivery is P3-tagged but still 8-bit.

**Root cause:** The label `downloadP3Jpeg` (en.json:323) says "Download (Display P3 JPEG)" without bit depth qualification.

**Fix:** Change the label to explicitly include "8-bit":
- English: "Download (8-bit Display P3 JPEG)"
- Korean: "다운로드 (8비트 Display P3 JPEG)"

Or better, since the JPEG is technically P3-tagged via ICC profile but still 8-bit, use:
- "Download (P3-tagged 8-bit JPEG)"
- "다운로드 (P3 태그 8비트 JPEG)"

This removes ambiguity while being technically accurate.

---

### R10-M7 — Backfill warning shown for ALL settings changes, not just color/HDR

**Files:** `settings-client.tsx:108-114` (backfill warning banner), `settings-client.tsx:98-294` (Image Processing card)
**Impact:** The amber "Backfill required" banner appears whenever `hasExistingImages` is true, regardless of which setting the admin changes. A photographer adjusting the slideshow interval from 5s to 7s sees a warning about backfilling their entire gallery. This erodes trust — the admin learns to ignore the warning because it's often irrelevant, which means they may also miss it when it IS relevant (e.g., changing `avif_effort`).

**Root cause:** The backfill banner is gated only on `hasExistingImages`, not on whether any color/HDR-related fields have actually changed.

**Fix:** Track which fields in the current form differ from their initial values, and only show the backfill warning when a color/HDR-affected field is among the changes. The affected fields are: `force_srgb_derivatives`, `allow_hdr_ingest`, `force_show_color_chips`, `wide_gamut_jpeg_chroma`, `avif_effort`, `sdr_jpeg_chroma`, `wide_gamut_max_source_pixels`.

```tsx
const COLOR_HDR_FIELDS = [
    'force_srgb_derivatives',
    'allow_hdr_ingest',
    'force_show_color_chips',
    'wide_gamut_jpeg_chroma',
    'avif_effort',
    'sdr_jpeg_chroma',
    'wide_gamut_max_source_pixels',
];

const hasColorHdrChanges = Object.keys(changed).some(k => COLOR_HDR_FIELDS.includes(k));
// Show banner only when: hasExistingImages && hasColorHdrChanges
```

Also consider adding a per-field inline hint (small amber dot or icon) next to each color/HDR field that requires backfill, so the photographer knows WHICH specific change triggered the warning.

---

## LOW

### R10-L1 — Color details accordion clickable area is narrower than 44px height suggests

**Files:** `color-details-section.tsx:208-245` (accordion button row)
**Impact:** The accordion toggle button has `min-h-[44px]` (line 214), which satisfies the touch-target audit. But the button only wraps the chevron + "Color details" text, not the full width of the container. On mobile, a user tapping the right side of the accordion row (near the copy or info buttons) won't toggle the accordion — they'll hit those smaller buttons instead. The expected behavior (tapping anywhere on the row expands/collapses) is not met.

**Root cause:** The `<button>` element only wraps the chevron and label, not the full flex container.

**Fix:** Make the entire row a single clickable surface by wrapping the chevron + label in a flex-1 button that spans the available width:

```tsx
<div className="flex items-center gap-1">
    <button
        type="button"
        onClick={() => setShowColorDetails(!showColorDetails)}
        className="flex-1 flex items-center gap-2 text-sm font-medium ... min-h-[44px]"
    >
        <ChevronDown ... />
        {t('viewer.colorDetails')}
    </button>
    {/* Info and Copy buttons remain as siblings */}
</div>
```

This preserves the individual info/copy buttons while making the accordion label area properly tappable across its full width.

---

### R10-L2 — Copied JSON leaks internal pipeline version number

**Files:** `color-details-section.tsx:181-203` (`copyColorMetadata`), `lightbox-color-pip.tsx:65-87` (same)
**Impact:** The copied JSON includes `pipelineVersion: image.pipeline_version ?? null`. This is an internal encoder version number (currently 6) that has no meaning to a photographer sharing metadata with a client, a print lab, or a forum. It leaks implementation detail into an otherwise professional metadata export.

**Root cause:** The copy function serializes all available fields without filtering out internal/implementation fields.

**Fix:** Remove `pipelineVersion` from the copied JSON. Also consider filtering out `hasGainMap` for public viewers (it's admin-only in the UI, but the JSON copy from a public share page would include it). Keep the fields that are actually useful to a recipient: `iccProfileName`, `primaries`, `transfer`, `matrix`, `decision`, `isHdr`, `sourceBitDepth`.

```ts
const data = {
    iccProfileName: image.icc_profile_name ?? null,
    primaries: image.color_primaries ?? null,
    transfer: image.transfer_function ?? null,
    matrix: image.matrix_coefficients ?? null,
    decision: image.color_pipeline_decision ?? null,
    isHdr: image.is_hdr ?? null,
    sourceBitDepth: image.bit_depth ?? null,
};
```

---

### R10-L3 — Histogram mode button uses monospace font, clashes with UI

**Files:** `histogram.tsx:614-621` (mode cycle button)
**Impact:** The histogram mode cycle button uses `font-mono` for the mode label ("Luminance", "Color", "Red", etc.). The rest of the UI uses Pretendard/Inter (sans-serif). The monospace label looks technical and out of place in an otherwise clean, photography-focused interface. It draws unnecessary attention to what should be a subtle control.

**Root cause:** `className="... font-mono ..."` on the mode button.

**Fix:** Remove `font-mono` from the button className. The mode labels are human-readable text, not code or data.

---

### R10-L4 — "Color details" accordion label is generic for wide-gamut photos

**Files:** `color-details-section.tsx:217` (`{t('viewer.colorDetails')}`), `en.json:329`, `ko.json:329`
**Impact:** For every photo, the accordion says "Color details" (or "색상 정보"). For a wide-gamut Display P3 photo, this generic label hides the most interesting information. A photographer wants visitors to immediately recognize that THIS photo has special color properties without clicking.

**Root cause:** Static label regardless of content.

**Fix:** Dynamically label the accordion based on the photo's color properties:
- sRGB + no HDR: "Color details" (current)
- Display P3 / DCI-P3 / Adobe RGB / ProPhoto / Rec.2020: "Color: {gamut}" (e.g., "Color: Display P3")
- HDR: "Color: HDR"
- Wide-gamut + HDR: "Color: Display P3 HDR"

This makes the accordion itself an informative label. Implementation:

```tsx
const accordionLabel = (() => {
    if (isHdr) return t('viewer.colorDetailsHdr', { gamut: primariesHuman });
    if (image.color_primaries && image.color_primaries !== 'bt709') {
        return t('viewer.colorDetailsGamut', { gamut: primariesHuman });
    }
    return t('viewer.colorDetails');
})();
```

Add translation keys for the new labels. This is LOW because it's a polish improvement, not a functional defect.

---

### R10-L5 — Mobile bottom sheet peek state hides color metadata for wide-gamut photos

**Files:** `info-bottom-sheet.tsx:234-261` (peek content: title + camera + date only)
**Impact:** The mobile bottom sheet in "peek" state (140px visible) shows only the photo title, camera model, and capture date. For a wide-gamut or HDR photo, the color metadata (which the photographer considers a key differentiator) is completely hidden until the user expands the sheet. On a small phone screen, the peek state is the default — users may not realize there's more to see.

**Root cause:** Peek state is hardcoded to show only title/camera/date.

**Fix:** Add a subtle color indicator to the peek state for non-trivial color photos. A small chip beside the title or in the metadata row:

```tsx
{isNonTrivialColor && primariesHuman && (
    <span className="inline-flex items-center gap-1 text-xs text-purple-700 dark:text-purple-300">
        <span className="w-2 h-2 rounded-full bg-purple-500" />
        {primariesHuman}
    </span>
)}
```

This gives a hint that there's color information to explore, encouraging the user to expand the sheet.

---

### R10-L6 — Lightbox color pip doesn't show delivered bit depth or format info

**Files:** `lightbox-color-pip.tsx:136-213` (expanded panel)
**Impact:** The sidebar `ColorDetailsSection` shows "Delivered bit depth" (10-bit AVIF / 8-bit WebP/JPEG) and "Delivered formats" (chips for WebP, AVIF, JPEG). The lightbox expanded panel shows primaries, transfer, pipeline decision, and histogram — but omits the delivered bit depth and format chips. A photographer auditing in lightbox mode can't see the full delivery metadata without switching back to the sidebar.

**Root cause:** The lightbox panel was extracted before the delivered bit depth/format rows were added to the sidebar.

**Fix:** Add the delivered bit depth and format chips to the lightbox expanded panel, gated on the same conditions as the sidebar:

```tsx
{/* Delivered bit depth */}
{(image.color_pipeline_decision || image.color_primaries) && (
    <div className="flex justify-between gap-3">
        <span className="opacity-70">{t('viewer.deliveredBitDepth')}</span>
        <span className="font-medium">
            {isP3Pipeline(...)
                ? t('viewer.deliveredBitDepthP3')
                : t('viewer.deliveredBitDepthSrgb')}
        </span>
    </div>
)}
{/* Delivered formats chips */}
{(image.filename_webp || image.filename_avif || image.filename_jpeg) && (
    <div className="flex justify-between gap-3">
        <span className="opacity-70">{t('viewer.deliveredFormats')}</span>
        <span className="font-medium flex gap-1">...</span>
    </div>
)}
```

---

### R10-L7 — No `image-rendering` for thumbnail grid

**Files:** `home-client.tsx:288-296` (masonry grid `<img>`)
**Impact:** Same as R10-M1 but for thumbnails. The masonry grid uses `object-cover` to fill card bounds, which means images are almost always scaled down from their source. On high-DPI displays, default browser scaling can look soft. While less critical for thumbnails than the main viewer, photographers still want their gallery grid to look sharp and professional.

**Root cause:** No `image-rendering` CSS on masonry `<img>` elements.

**Fix:** Add `image-rendering: high-quality` to the masonry card image class. Alternatively, since `object-cover` + downscaling is the standard thumbnail pattern and most users won't scrutinize thumbnails at this level, this can be considered optional polish.

```css
/* globals.css */
.masonry-card img {
  image-rendering: -webkit-optimize-contrast;
  image-rendering: high-quality;
}
```

---

### R10-L8 — Masonry grid `object-cover` crops photographer's composition

**Files:** `home-client.tsx:293` (`object-cover` on masonry `<img>`)
**Impact:** The masonry grid uses `object-cover` to ensure every card is filled without letterboxing. This crops the image to fit the card's aspect ratio. For photos with important edge details (e.g., a landscape with a subject near the frame edge, a portrait with hair/detail near the top), the crop may cut off meaningful composition elements. Photographers who carefully framed their shots lose control over how the thumbnail represents their work.

**Root cause:** `object-cover` is the standard approach for masonry grids, but it's a trade-off between visual consistency and compositional fidelity.

**Fix:** This is an intentional design choice (consistent card sizes vs. uncropped previews). Two options:
1. **Keep as-is** — document the trade-off in code comments so future maintainers understand why `object-cover` was chosen.
2. **Use `object-contain` with a muted background** — show the full uncropped image with `object-contain` and a neutral background (`bg-muted`) for the letterboxed areas. This preserves composition but creates uneven card sizes within the masonry column, which may look messy.

Recommended: Keep `object-cover` but add a comment documenting the photographer-intent trade-off. This is LOW because it's a well-understood masonry grid pattern.

---

## Positive Observations

These are things done well that reinforce good photographer-centric UX patterns:

1. **Blur data URL as instant preview** (`photo-viewer.tsx:174-183`, `photo-viewer.tsx:617`) — The 16px blurred preview computed at upload time is used as a CSS `background-image` during the AnimatePresence transition. Visitors see an instant color-accurate preview while the AVIF/WebP/JPEG decodes. The `isSafeBlurDataUrl` validation at producer, write, and read time ensures the contract is enforced.

2. **Color details auto-open for non-trivial color** (`color-details-section.tsx:152-157`) — The accordion defaults to open when the photo is wide-gamut, HDR, or has a non-sRGB pipeline decision. This removes a click barrier for the photos where color metadata matters most.

3. **Gamut-aware download options** (`photo-viewer.tsx:855-898`) — Wide-gamut photos show a dropdown with both sRGB JPEG (universal compatibility) and P3 AVIF (best quality for modern browsers). Each option has a descriptive subtitle explaining the trade-off. This respects both the photographer's intent to preserve gamut AND the visitor's need for compatibility.

4. **Histogram desktop resolution scaling** (`histogram.tsx:378-388`) — The canvas scales from 240x120 on mobile to 320x160 on desktop, giving photographers more precision for tonal evaluation on larger screens.

5. **Wide-gamut hint names the source gamut** (`wide-gamut-hint.tsx:47`, `en.json:355`) — The hint now says "The full color gamut is available on Display P3 screens" instead of the generic "wide-gamut screens" from earlier cycles. This is specific and actionable.

6. **DCI-P3 tooltip in both sidebar and lightbox** (`color-details-section.tsx:310-325`, `lightbox-color-pip.tsx:158-173`) — The Bradford D50->D65 white-point adaptation note is consistently available in both viewing contexts.

7. **Force-show color chips admin toggle** (`settings-client.tsx:205-219`, `globals.css:180-181`) — Photographers can override display-gamut detection to always show P3/HDR badges, useful for demos on sRGB laptops.

8. **Touch target audit enforcement** — Every interactive element in the photo viewer, bottom sheet, and lightbox meets the 44px minimum. The touch-target test at `__tests__/touch-target-audit.test.ts` is a blocking gate that prevents regressions.

9. **Mobile-first bottom sheet with peek/expanded states** (`info-bottom-sheet.tsx:39-121`) — The three-state sheet (collapsed/peek/expanded) with velocity-aware swipe gestures is a polished mobile-native pattern. The safe-area-inset-bottom padding ensures the download button isn't clipped by the home indicator.

10. **Copy-to-clipboard in both contexts** — The JSON metadata export is available in both the sidebar Color Details accordion and the lightbox expanded panel. Photographers auditing their gallery can capture metadata without context-switching.

---

## Cross-File Integration Notes

### Photo viewer ↔ Lightbox consistency

The lightbox (`lightbox.tsx`) and photo viewer (`photo-viewer.tsx`) use different image rendering approaches:
- Photo viewer: `<picture>` with `<source type="image/avif">` + `<source type="image/webp">` + `<img>` inside `ImageZoom` wrapper
- Lightbox: `<picture>` with `<source>` tags + `<img>` directly, no zoom wrapper, with Ken Burns animation

Both correctly prefer AVIF for wide-gamut delivery. The lightbox lacks the `ImageZoom` interaction (click to zoom, pinch, pan), which is acceptable for a fullscreen presentation mode but means photographers can't inspect fine detail in lightbox. This is intentional per the design, but worth documenting: the lightbox is for presentation, the photo viewer is for inspection.

### Color pipeline decision visibility

The `color_pipeline_decision` field is admin-only (excluded from `publicSelectFields` in `data.ts`). Public visitors see `color_primaries`, `transfer_function` (wait — `transfer_function` is also in `_PrivacySensitiveKeys`). Let me verify:

From `CLAUDE.md`: "`transfer_function` — admin-only". From the `ImageDetail` type usage in `color-details-section.tsx:284-288`, the transfer function row is NOT gated on `isAdmin`. This means:
- `color_primaries` — public
- `transfer_function` — rendered unconditionally (line 284), but the field may be null for public queries
- `color_pipeline_decision` — admin-only, gated on `isAdmin`
- `matrix_coefficients` — admin-only, gated on `isAdmin`
- `color_space` — admin-only, gated on `isAdmin`
- `bit_depth` — public, rendered unconditionally

The current code is consistent with the privacy model. Public visitors see primaries and bit depth (useful for understanding the photo's technical character), but not the internal pipeline decision or matrix coefficients.

### Share pages

Shared group/link pages use the same `PhotoViewer` component with `isSharedView=true`. This means public visitors to a shared photo see:
- Color details accordion (auto-open for non-trivial color)
- Wide-gamut hint (if on sRGB display)
- Histogram (public)
- EXIF grid (public fields only — no GPS, no `filename_original`)
- No admin-only rows (pipeline decision, matrix, EXIF color space, downscaled flag)
- No download button (shared views don't have `downloadHref` rendered? Actually the download button is rendered if `image.filename_jpeg` exists and license tier is none — so shared views DO have download. Need to verify this is intentional.)

The shared page download button may need review for licensing implications — if a photographer shares a photo with a paid license tier, the shared page still shows the download button because the guard is `(!image.license_tier || image.license_tier === 'none')`, and shared pages don't have admin auth. This appears correct: shared pages respect the license tier setting.

---

## Recommendation

**COMMENT** — No CRITICAL or HIGH issues that block approval. The three HIGH findings (R10-H1, H2, H3) are all UX improvements that would meaningfully enhance the photographer experience but do not represent functional defects or security vulnerabilities.

**Priority order for fixes:**
1. R10-H2 (remove `max-h-[80vh]`) — smallest change, biggest visual impact
2. R10-H1 (gamut badge in masonry grid) — requires data layer change but high photographer value
3. R10-H3 (key-type tooltip) — copy/translation work only
4. R10-M7 (conditional backfill warning) — reduces admin confusion
5. R10-M6 (download label clarity) — single translation string change
6. R10-M3 (consistent bottom sheet ordering) — code cleanup
7. R10-M2 (blur crossfade) — visual polish
8. R10-M1, R10-M4, R10-M5, and all LOW items — iterative polish

---

*Review compiled from analysis of 12 core files + 4 supporting files + 2 translation files + 1 CSS file. Total lines reviewed: ~3,200.*
