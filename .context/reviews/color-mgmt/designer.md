# Color Management Deep Review — ATIK.KR Photo Gallery

**Reviewer:** Designer agent  
**Date:** 2026-05-03  
**Scope:** End-to-end color fidelity from image ingestion through server-side processing, HTTP delivery, and browser rendering across every display surface in the gallery.

---

## Executive Summary

The codebase is more color-aware than most photo galleries at this scale. The AVIF ICC-profile selection logic (`resolveAvifIccProfile`) is genuinely thoughtful, `keepIccProfile()` is wired on every Sharp resize, and the CSS gamut-detection scaffolding exists. However, several gaps exist between the infrastructure and the actual rendered output: CSS color tokens are 100% sRGB HSL, the histogram canvas runs in default sRGB context, `fetchpriority="high"` is missing on the single-photo primary image, the photo-viewer container background leaks chromatic context around photos, WebP/JPEG ICC tags are stripped at encode time, and there is no `@media print` block anywhere in the stylesheet.

Each finding below cites the exact file and line, severity, confidence, a concrete failure scenario, and a precise fix.

---

## Finding 1 — CSS Color Tokens Are Entirely sRGB HSL

**Severity:** Medium  
**Confidence:** High (direct code inspection, no ambiguity)

### Location

`apps/web/src/app/[locale]/globals.css` lines 14–90  
`apps/web/tailwind.config.ts` lines 13–53

### Evidence

Every design-system token is expressed as bare HSL triplets consumed through the Tailwind bridge:

```css
/* globals.css:18 */
--background: 0 0% 100%;
--foreground: 240 10% 3.9%;

/* tailwind.config.ts:14 */
background: 'hsl(var(--background))',
```

`hsl()` with no color-space qualifier resolves to sRGB in every browser. On an Apple M-series MacBook with a P3 panel, a color like `hsl(240 10% 3.9%)` maps to the sRGB cube, leaving approximately 25 % of the panel's gamut unused for the UI chrome.

The CSS gamut-detection hook (`--display-gamut: srgb | p3`, `globals.css:135–136`) is set but nothing downstream reads it in CSS — it exists only as a CSS custom property that JavaScript could theoretically query, which nothing in the codebase currently does.

### Failure scenario

A visitor on a 2024 MacBook Pro (P3 display) or a Samsung Galaxy S24 Ultra (P3 OLED) views the gallery in dark mode. The background (`--background: 0 0% 0%` in `.oled`) renders as `rgb(0 0 0)` — that part is fine. However, every accent, badge, border, and UI card is expressed in the sRGB triangle. The P3-capable display renders these colors correctly but never reaches the wider gamut the hardware supports. More importantly, where the gallery renders a P3-tagged AVIF image alongside sRGB UI chrome, the visual juxtaposition between the browser's wide-gamut tone-mapped photo and the sRGB-clipped chrome creates a perceptible color discontinuity at the photo border.

### Fix

Add `oklch()` variants for the accent and primary tokens using `@supports (color: oklch(0 0 0))`:

```css
/* globals.css — add inside @layer base */
@supports (color: oklch(0 0 0)) {
  :root {
    --primary: oklch(16.5% 0.01 264);
    --primary-foreground: oklch(98% 0 0);
    --accent: oklch(95.5% 0.005 264);
    --ring: oklch(16.5% 0.01 264);
    --destructive: oklch(52% 0.19 27);
  }

  .dark {
    --primary: oklch(98% 0 0);
    --primary-foreground: oklch(16.5% 0.01 264);
    --accent: oklch(18% 0.005 264);
    --ring: oklch(77% 0.01 264);
    --destructive: oklch(38% 0.13 27);
  }

  .oled {
    --background: oklch(0% 0 0);
    --card: oklch(4% 0 0);
  }
}
```

`oklch()` is supported in all engines since Chrome 111, Firefox 113, Safari 15.4. The `@supports` guard keeps legacy browsers on the existing HSL values. This alone does not add P3-specific colors to the UI chrome, but it enables perceptually-uniform interpolation and opens the door to adding P3 accents in a follow-up by using `color(display-p3 r g b)` inside the same block.

---

## Finding 2 — `themeColor` Values Are sRGB Hex, Not P3

**Severity:** Low  
**Confidence:** High

### Location

`apps/web/src/app/[locale]/layout.tsx` lines 63–67

### Evidence

```typescript
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};
```

`#ffffff` and `#09090b` are sRGB hex literals. On iOS Safari and Chrome Android, the `theme-color` meta tag drives the browser chrome color (status bar, address bar). These hex values are sRGB, which is fine since browser chrome itself does not participate in P3 rendering in any current browser, but the dark value `#09090b` does not match the OLED theme's `--background: 0 0% 0%` (pure black). When a visitor is in OLED dark mode, the browser chrome renders `#09090b` (a very dark blue-black, approximately `oklch(3.2% 0.004 264)`) while the page canvas renders `#000000`. On an OLED display this creates a visible brightness/hue mismatch between the browser chrome and the page background.

### Failure scenario

A visitor using iOS Safari 17 on iPhone 15 Pro in OLED dark mode sees the status bar as slightly blue-black while the gallery canvas is pure black — a visible discontinuity in the letterbox area when viewing full-bleed photos.

### Fix

```typescript
themeColor: [
  { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  { media: '(prefers-color-scheme: dark)', color: '#000000' },
],
```

Use pure `#000000` for the dark theme-color to match the OLED background token. Alternatively, use two entries:

```typescript
themeColor: [
  { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  { media: '(prefers-color-scheme: dark) and (prefers-contrast: no-preference)', color: '#09090b' },
  { media: '(prefers-color-scheme: dark)', color: '#000000' },
],
```

---

## Finding 3 — `color-scheme` Is Declared at Viewport Level Only, Not in CSS

**Severity:** Low  
**Confidence:** High

### Location

`apps/web/src/app/[locale]/layout.tsx` line 62  
`apps/web/src/app/[locale]/globals.css` (absent)

### Evidence

`colorScheme: 'light dark'` in the `viewport` export causes Next.js to emit `<meta name="color-scheme" content="light dark">`. This is correct. However, the companion CSS declaration `color-scheme: light dark` on `:root` is absent from `globals.css`. The CSS `color-scheme` property on `:root` is what tells the browser's UA stylesheet which scheme to apply for form controls, scrollbars, and `canvas` default background — the meta tag alone does not cover the CSS context.

In practice, with Tailwind's `darkMode: ['class']` strategy, the background is always set explicitly via the `.dark` class, so the UA stylesheet fallback is rarely visible. But `<canvas>` default background, `<input>` placeholder color, and `<select>` appearance are still affected.

### Fix

```css
/* globals.css, inside @layer base */
:root { color-scheme: light; }
.dark, .oled { color-scheme: dark; }
```

---

## Finding 4 — Photo Viewer Primary Image Missing `fetchpriority="high"`

**Severity:** High  
**Confidence:** High

### Location

`apps/web/src/components/photo-viewer.tsx` lines 385–396

### Evidence

The `<picture>` fallback `<img>` element inside the photo viewer has:

```tsx
<img
  ...
  decoding="async"
  loading="eager"
/>
```

`loading="eager"` tells the browser not to lazy-load, but without `fetchpriority="high"` the image competes equally with all other resources for bandwidth at the same priority tier. `fetchpriority="high"` promotes the request to the browser's highest fetch-priority queue, which is essential for the single photo page's LCP candidate.

The Next.js `<Image>` fallback (used when no AVIF/WebP filenames exist, lines 360–370) does pass `priority` which Next.js translates to `fetchpriority="high"`, so that path is correct. Only the `<picture>` path (the common path when AVIF/WebP exist) is missing the attribute.

### Failure scenario

On a 4G connection, a visitor opens `/p/123`. The browser fetches JS bundles, CSS, fonts, and JSON at equal priority with the hero AVIF. The LCP fires 0.5–1.5 s later than it could because the image was not promoted. Google PageSpeed / Core Web Vitals flags this as an LCP opportunity.

### Fix

```tsx
<img
  src={jpegSrc}
  srcSet={jpegSrcSet}
  sizes={photoViewerSizes}
  alt={getAltText(image)}
  width={image.width}
  height={image.height}
  className="w-full h-full object-contain max-h-[80vh] z-0 relative photo-viewer-image"
  decoding="async"
  loading="eager"
  fetchPriority="high"   // add this
/>
```

React 18+ / Next.js 14+ forward `fetchPriority` to the DOM attribute correctly (camelCase in JSX, lowercase `fetchpriority` in HTML).

---

## Finding 5 — Photo Viewer Container Background Is Not Pure Black

**Severity:** Medium  
**Confidence:** High

### Location

`apps/web/src/components/photo-viewer.tsx` line 592

### Evidence

```tsx
<div className="relative flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl border p-2 overflow-hidden min-h-[40vh] md:min-h-[500px] group skeleton-shimmer">
```

In dark mode the container uses `bg-white/5` — 5% white over the background. With `.dark`'s `--background: 240 10% 3.9%` that resolves to approximately `rgba(255,255,255,0.05)` over `hsl(240 10% 3.9%)`, producing roughly `rgb(23,23,26)` — a dark blue-grey. With `.oled`'s `--background: 0 0% 0%`, it produces `rgb(12,12,12)` — still not pure black.

The photo sits inside this container with `p-2` padding (8 px) all sides. On an OLED display with a high-contrast P3 image, a non-black surround creates a visible "glowing" border around the photo that compresses perceived image contrast. The effect is most visible with dark-toned photos on OLED.

The **Lightbox** component (`apps/web/src/components/lightbox.tsx` line 373) correctly uses `bg-black` for the full-screen overlay — that surface is fine.

### Failure scenario

A visitor in OLED dark mode views a night-sky photo. The image's deep shadows occupy the full dynamic range and reach near-zero luminance. The 8 px surround at `rgb(12,12,12)` creates a visible bright halo. On a P3 display the effect is amplified because the browser renders the image with the full P3 shadow detail while the CSS surround is sRGB-clamped.

### Fix

Replace `bg-black/5 dark:bg-white/5` with conditional pure black in dark modes:

```tsx
className="relative flex items-center justify-center bg-black/5 dark:bg-black rounded-xl border dark:border-transparent p-2 overflow-hidden min-h-[40vh] md:min-h-[500px] group skeleton-shimmer"
```

Or use a CSS variable approach so all three themes are handled:

```css
/* globals.css */
:root { --photo-surround: hsl(0 0% 95%); }
.dark { --photo-surround: #000; }
.oled { --photo-surround: #000; }
```

```tsx
style={{ backgroundColor: 'var(--photo-surround)' }}
```

---

## Finding 6 — WebP and JPEG Derivatives Lose Source ICC Profile (Converted to sRGB)

**Severity:** High  
**Confidence:** High

### Location

`apps/web/src/lib/process-image.ts` lines 556–566

### Evidence

```typescript
const sharpInstance = image.clone().resize({ width: resizeWidth }).keepIccProfile();

if (format === 'webp') {
    await sharpInstance.webp({ quality: qualityWebp }).toFile(outputPath);
} else if (format === 'avif') {
    await sharpInstance
        .withMetadata({ icc: avifIcc })   // P3 ICC selectively embedded
        .avif({ quality: qualityAvif })
        .toFile(outputPath);
} else {
    await sharpInstance.jpeg({ quality: qualityJpeg }).toFile(outputPath);
}
```

`keepIccProfile()` preserves the ICC profile in Sharp's internal pipeline, but `.webp()` and `.jpeg()` without a `.withMetadata()` call strip the ICC profile from the output file. Only the AVIF path calls `.withMetadata({ icc: avifIcc })`.

The consequence:

- **WebP derivatives** are written without an ICC tag. Chrome and Safari treat untagged WebP as sRGB. If the source was P3 or AdobeRGB, the browser renders the WebP as sRGB, causing a noticeable hue/saturation shift.  
- **JPEG derivatives** have the same problem — the JPEG fallback path strips ICC. The JPEG is used as: (1) the photo viewer fallback, (2) the OG image source in the API route, (3) the histogram canvas source, (4) the blur placeholder base. All these surfaces are rendered with wrong gamut if the source was P3/AdobeRGB.

Additionally, `keepIccProfile()` on the Sharp pipeline without `.withMetadata()` at encode time is documented to be a no-op for WebP/JPEG output in Sharp 0.33+: the ICC is held internally but not written unless `.withMetadata()` is called.

### Failure scenario

A photographer uploads an AdobeRGB RAW-derived JPEG from Lightroom. The EXIF ColorSpace tag is 65535 (Uncalibrated), ICC profile name is `Adobe RGB (1998)`. `resolveAvifIccProfile` correctly returns `'p3'` for AVIF. But the WebP derivative is written without ICC — Safari reads it as sRGB, rendering greens as yellow-green and cyans as blue. The JPEG fallback is also untagged-sRGB. The photographer sees their carefully-graded image displayed with wrong colors on any device that renders WebP (i.e., every modern browser).

### Fix

Add `.withMetadata()` to both WebP and JPEG encode paths:

```typescript
// Resolve the sRGB ICC for WebP/JPEG (universal compatibility)
const webpJpegMeta = { icc: 'srgb' as const };

if (format === 'webp') {
    await sharpInstance.withMetadata(webpJpegMeta).webp({ quality: qualityWebp }).toFile(outputPath);
} else if (format === 'avif') {
    await sharpInstance
        .withMetadata({ icc: avifIcc })
        .avif({ quality: qualityAvif })
        .toFile(outputPath);
} else {
    await sharpInstance.withMetadata(webpJpegMeta).jpeg({ quality: qualityJpeg }).toFile(outputPath);
}
```

Sharp's `{ icc: 'srgb' }` embeds the compact sRGB ICC profile (approximately 3 KB). This converts the pixel values from the source gamut to sRGB at encode time and tags the output as sRGB, which is the correct behavior for wide-gamut → WebP/JPEG conversion: the browser can now trust the tag and render the image correctly.

For P3/AdobeRGB sources this means the WebP/JPEG will be gamut-mapped to sRGB — which is the right trade-off since WebP and JPEG are overwhelmingly viewed on sRGB-calibrated contexts and untagged files are silently clipped in unpredictable ways. The AVIF path, which supports P3 metadata, retains the wider gamut correctly.

---

## Finding 7 — Histogram Canvas Uses Default sRGB 2D Context

**Severity:** Medium  
**Confidence:** High

### Location

`apps/web/src/components/histogram.tsx` lines 103–132 (`computeHistogramAsync`), lines 134–201 (`drawHistogram`)

### Evidence

```typescript
// computeHistogramAsync (line 115)
const ctx = canvas.getContext('2d');

// drawHistogram (line 140)
const ctx = canvas.getContext('2d');
```

Both canvas contexts are created without a `colorSpace` option. The default is `'srgb'`. When the histogram draws a P3-tagged AVIF into this canvas to extract pixel values (`ctx.drawImage(imageEl, 0, 0, w, h)`), the browser composites the P3 image into the sRGB canvas — the pixel values extracted by `ctx.getImageData()` are the sRGB-converted values, not the original P3 values. This means the histogram displays the sRGB representation of a P3 photo, not the actual wide-gamut channel distribution.

For a photo shot in Display P3, reds and greens that extend beyond sRGB are clipped to the sRGB boundary before the histogram reads them, making the histogram appear to show clipped channels when the actual image data is not clipped. This misleads photographers reviewing their work.

Additionally, the source image loaded in `computeHistogramAsync` is a JPEG URL (from `photo-viewer.tsx` line 808: `image.filename_jpeg.replace(...)`), which after Finding 6's fix will be sRGB-tagged — so the histogram readings will be sRGB values regardless. This is self-consistent but still means P3 photos show a compressed histogram.

### Fix

Request a P3 canvas context when the display supports it:

```typescript
function computeHistogramAsync(imageEl: HTMLImageElement, worker: Worker, signal?: AbortSignal): Promise<HistogramData> {
    const canvas = document.createElement('canvas');
    const maxDim = 256;
    const scale = Math.min(maxDim / imageEl.naturalWidth, maxDim / imageEl.naturalHeight, 1);
    const w = Math.round(imageEl.naturalWidth * scale);
    const h = Math.round(imageEl.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;

    // Request P3 context on capable displays; fall back to sRGB
    const supportsP3 = window.matchMedia('(color-gamut: p3)').matches;
    const ctxOptions = supportsP3 ? { colorSpace: 'display-p3' as PredefinedColorSpace } : undefined;
    const ctx = canvas.getContext('2d', ctxOptions);
    // ...
}
```

The `drawHistogram` function's canvas context also needs the same treatment for consistent rendering, though its visual impact is lower since it renders color bars not photo content.

---

## Finding 8 — No `@media print` Styles

**Severity:** Low  
**Confidence:** High

### Location

`apps/web/src/app/[locale]/globals.css` (absent throughout)

### Evidence

There is no `@media print` block anywhere in the stylesheet. The practical consequences for a photo gallery:

1. The masonry grid's `columns-*` multi-column layout does not collapse to single-column for print, so photos may be clipped at page boundaries.
2. The skeleton shimmer animation (`@keyframes shimmer`, line 114) will attempt to print with a gradient overlay.
3. Navigation bars, back buttons, toolbars, and the info sidebar will all print, consuming paper and ink without adding value.
4. The `content-visibility: auto` CSS on `.masonry-card` (line 179) causes off-screen cards to not render in print output because the browser has not painted them.

### Fix

Add a minimal print block:

```css
@media print {
  /* Reset columns so images flow in a readable single column */
  .columns-1, .columns-2, .columns-3, .columns-4, .columns-5,
  [class*="sm:columns-"], [class*="md:columns-"], [class*="xl:columns-"], [class*="2xl:columns-"] {
    columns: 1 !important;
  }

  /* Force content-visibility off so all cards render */
  .masonry-card { content-visibility: visible !important; }

  /* Hide chrome that adds no value in print */
  nav, footer, .photo-viewer-toolbar, button, [role="navigation"] { display: none !important; }

  /* Prevent skeleton shimmer overlay from printing */
  .skeleton-shimmer::after { display: none !important; }

  /* Photos should fill the printed column */
  img { max-width: 100% !important; page-break-inside: avoid; }
}
```

---

## Finding 9 — No `forced-colors` Guard on Photo Overlays

**Severity:** Low  
**Confidence:** High

### Location

`apps/web/src/components/home-client.tsx` lines 263–274

### Evidence

```tsx
<div className="absolute inset-x-0 top-0 sm:hidden bg-gradient-to-b from-black/65 to-transparent p-3">
    <h3 className="text-white text-sm font-medium truncate">{displayTitle}</h3>
    <p className="text-white/80 text-xs truncate">...</p>
</div>
<div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/60 to-transparent p-4 sm:block sm:opacity-0 sm:group-hover:opacity-100 ...">
    <h3 className="text-white font-medium truncate">...</h3>
    <p className="text-white/80 text-xs truncate">...</p>
</div>
```

In Windows High Contrast Mode (forced-colors: active), the browser's user-agent stylesheet sets all colors to system palette values. `background-gradient` on the overlay is forced to a system color (typically black or ButtonFace), but text `color: white` is overridden to the system foreground color (typically HighlightText or ButtonText). The gradient disappears — forced to a flat solid — but because these overlays use `text-white` as a forced color, in some HC themes white text on a forced-dark-background is redundant, while in light HC themes the white text on the forced light overlay becomes unreadable (white on light).

Photos themselves are not affected by forced-colors (images are never recolored by the HC UA sheet). But text overlaid on photos using hardcoded `text-white` can lose legibility.

### Fix

```css
@media (forced-colors: active) {
  /* Text overlays on photos: use the system-palette foreground */
  .masonry-card h3,
  .masonry-card p {
    color: CanvasText;
    /* Provide a forced-color-aware background for legibility */
    background: Canvas;
    padding: 0.1em 0.25em;
    border-radius: 0.2em;
  }
  /* Suppress gradient overlays that interfere with HC rendering */
  .masonry-card .absolute { background: transparent !important; }
}
```

---

## Finding 10 — Skeleton Shimmer Uses sRGB `rgba(255,255,255,0.06)` Universally

**Severity:** Low  
**Confidence:** High

### Location

`apps/web/src/app/[locale]/globals.css` lines 124–133

### Evidence

```css
.skeleton-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.06) 50%, transparent 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  pointer-events: none;
}
```

The shimmer gradient is a hardcoded sRGB `rgba(255,255,255,0.06)` regardless of color scheme. In light mode the shimmer is barely visible (white on white with 6% opacity — correct intent). In dark mode the shimmer shows as a slightly lighter pulse (white at 6% over a dark background — also correct). However, in the `.oled` theme (pure black background), white at 6% produces `rgb(15,15,15)` — an imperceptibly dim shimmer. More critically, the shimmer color is hardcoded and not derived from any design token; it will not adapt if the color scheme changes.

### Fix

Replace the hardcoded color with a CSS custom property:

```css
:root { --shimmer-highlight: rgba(0,0,0,0.06); }
.dark { --shimmer-highlight: rgba(255,255,255,0.06); }
.oled { --shimmer-highlight: rgba(255,255,255,0.10); }  /* brighter for OLED contrast */

.skeleton-shimmer::after {
  background: linear-gradient(90deg, transparent 25%, var(--shimmer-highlight) 50%, transparent 75%);
}
```

---

## Finding 11 — OG Image Uses JPEG Source (sRGB), No Wide-Gamut Path

**Severity:** Low  
**Confidence:** High

### Location

`apps/web/src/app/api/og/photo/[id]/route.tsx` lines 65–76

### Evidence

```typescript
const jpegFilename = image.filename_jpeg.replace(/\.jpg$/i, `_${nearestSize}.jpg`);
const photoUrl = `${origin}/uploads/jpeg/${jpegFilename}`;
const photoRes = await fetch(photoUrl);
const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
const photoDataUrl = `data:image/jpeg;base64,${photoBuffer.toString('base64')}`;
```

The OG image route fetches the JPEG derivative (sRGB after the current pipeline, or ICC-stripped before the fix in Finding 6) and embeds it into the Satori/ImageResponse output. Satori renders in sRGB and produces a JPEG or PNG output. The OG image is always sRGB — which is correct for social sharing (Facebook, Twitter, LinkedIn all display OG images on sRGB-normalized surfaces). This is not a bug. However, if the JPEG source is ICC-stripped (Finding 6 unfixed), images from P3/AdobeRGB sources will have incorrect gamut in OG previews.

The `backgroundColor: '#09090b'` in the OG template is sRGB hex — appropriate for this context.

This finding is informational rather than actionable on its own; resolving Finding 6 will also fix the OG image gamut.

---

## Finding 12 — `prefers-reduced-transparency` Not Addressed

**Severity:** Low  
**Confidence:** Medium

### Location

`apps/web/src/app/[locale]/globals.css` (absent)  
`apps/web/src/components/home-client.tsx` lines 263–274

### Evidence

macOS "Reduce Transparency" system preference disables blur and transparency effects across the OS. In Safari 16+, the CSS `prefers-reduced-transparency` media query (`@media (prefers-reduced-transparency: reduce)`) is supported. The gallery uses:

- `backdrop-filter: blur(12px)` on the photo viewer toolbar (`globals.css:156`)
- `bg-black/65`, `bg-black/60` gradient overlays on masonry cards
- `bg-black/50` on lightbox control buttons

When `prefers-reduced-transparency` is active, browsers supporting it drop `backdrop-filter` automatically (Safari's UA sheet). But the `bg-black/65` transparency gradients on card overlays and the `bg-black/50` lightbox buttons are CSS-authored and not overridden. Users with Increase Contrast + Reduce Transparency enabled on macOS see these elements rendered by the browser as-is, which may look fine or may conflict with their system-level contrast adjustments.

### Fix

```css
@media (prefers-reduced-transparency: reduce) {
  /* Replace translucent overlays with solid equivalents */
  .photo-viewer-toolbar { background: hsl(var(--background)) !important; backdrop-filter: none !important; }

  /* Lightbox controls: increase opacity for clarity */
  [class*="bg-black/50"] { background-color: rgb(0 0 0 / 0.85) !important; }
}
```

---

## Summary Table

| # | Finding | File | Severity | Confidence |
|---|---------|------|----------|------------|
| 1 | All CSS tokens are sRGB HSL — no oklch/P3 tokens | globals.css:14–90, tailwind.config.ts | Medium | High |
| 2 | themeColor dark value `#09090b` mismatches OLED pure-black | layout.tsx:63–67 | Low | High |
| 3 | `color-scheme` absent from CSS `:root` | globals.css (absent) | Low | High |
| 4 | `fetchpriority="high"` missing on photo viewer `<img>` | photo-viewer.tsx:385–396 | **High** | High |
| 5 | Photo container background `bg-white/5` in dark mode — not black | photo-viewer.tsx:592 | Medium | High |
| 6 | WebP and JPEG derivatives do not embed ICC profile | process-image.ts:556–566 | **High** | High |
| 7 | Histogram canvas context is default sRGB | histogram.tsx:115, 140 | Medium | High |
| 8 | No `@media print` block | globals.css (absent) | Low | High |
| 9 | No `forced-colors` guard on text overlays | home-client.tsx:263–274 | Low | High |
| 10 | Skeleton shimmer color is hardcoded sRGB, not theme-aware | globals.css:124–133 | Low | High |
| 11 | OG image uses JPEG (sRGB) — informational | og/photo/route.tsx | Low | High |
| 12 | `prefers-reduced-transparency` not addressed | globals.css (absent) | Low | Medium |

---

## Prioritized Action Order

1. **Finding 6** (WebP/JPEG ICC strip) — a pipeline correctness bug. Every P3 or AdobeRGB upload served as WebP/JPEG is color-wrong right now. Fix is a one-line addition to `processImageFormats`. Impact is immediate and permanent for all future uploads; existing derivatives need a re-process pass.

2. **Finding 4** (`fetchpriority="high"`) — an LCP regression on every single photo page. One attribute addition.

3. **Finding 5** (photo container background) — perceptual quality on OLED. One Tailwind class change.

4. **Finding 1** (sRGB tokens) — architectural improvement. Use `@supports` to add oklch tokens without breaking anything.

5. **Finding 7** (histogram canvas color space) — correctness for P3 photos. Adds one `getContext` option.

6. **Findings 2, 3, 8, 9, 10, 12** — polish, accessibility, print support.
