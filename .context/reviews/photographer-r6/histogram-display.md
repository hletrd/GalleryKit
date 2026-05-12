# R6 Histogram Display Review

**Angle:** Histogram accuracy and photographer-facing display honesty
**Files reviewed:** `apps/web/src/components/histogram.tsx`, `apps/web/src/public/histogram-worker.js`, `apps/web/src/components/wide-gamut-hint.tsx`

---

## R6-M2 [MED] — Histogram requests P3 canvas context for sRGB images

### Evidence

In `histogram.tsx`, `computeHistogramAsync` (lines ~171–207):

```ts
async function computeHistogramAsync(
    url: string,
    mode: HistogramMode,
    signal: AbortSignal,
): Promise<HistogramData> {
    // ...
    const supportsCanvasP3 = getSupportsCanvasP3();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', {
        colorSpace: supportsCanvasP3 ? 'display-p3' : 'srgb',
    }) as CanvasRenderingContext2D | null;
    // ...
}
```

The `colorSpace` is chosen purely by `getSupportsCanvasP3()` (browser capability), NOT by the image's actual `color_primaries`. For an sRGB image (`color_primaries === 'bt709'`), the canvas is still created with `'display-p3'` on a P3-capable browser.

What happens then:
1. The browser loads the sRGB-tagged JPEG/WebP into a P3 canvas.
2. The browser gamut-maps sRGB pixels into P3 space (typically matrix multiplication + gamma adjustment).
3. The worker reads P3-space RGB values and computes luminance using BT.709 coefficients (`0.2126, 0.7152, 0.0722`).
4. The resulting histogram is subtly wrong — the gamut-mapped P3 primaries have different chromaticities than BT.709, so the luminance weights are no longer correct.

### Impact

On a P3 MacBook Pro viewing an sRGB image, the histogram shows shifted bins relative to what the photographer would see in Photoshop/Lightroom (which renders sRGB images in sRGB space, not gamut-mapped to P3). The shift is small but perceptible in the red and blue channels.

### Fix

Pass the image's `color_primaries` into `computeHistogramAsync` and gate the canvas colorSpace:

```ts
const isWideGamutImage = isWideGamutPrimary(image.color_primaries);
const targetColorSpace = supportsCanvasP3 && isWideGamutImage ? 'display-p3' : 'srgb';
```

Also pass `targetColorSpace` to the worker so it can select correct luminance coefficients. For P3 pixels, the worker should use P3 luminance weights (~`0.2289, 0.6917, 0.0794`) instead of BT.709.

---

## R6-L1 [LOW] — Histogram "(sRGB clipped)" label gates on wrong signal

### Evidence

In `histogram.tsx` (line ~404):

```ts
const isClipped = isWideGamut && avifSupported === false;
```

This is used to show the "(sRGB clipped)" label in the histogram panel. The label only appears when AVIF is NOT supported by the browser.

But the actual clipping condition is: the image is wide-gamut AND the display is sRGB. This is independent of whether the browser can decode AVIF. An sRGB-display Chrome user can decode AVIF just fine — the AVIF decoder outputs P3-gamut pixels, but the display physically cannot show them. The image IS clipped; the user just doesn't get the hint.

### Impact

Photographers demoing on an sRGB laptop (or Windows sRGB monitor) see no clipping indicator in the histogram, even though their wide-gamut images are being gamut-clipped by the display. They may incorrectly believe their images are being delivered in full gamut.

### Fix

Change the condition to use `colorGamut` from `useDisplayCapability`:

```ts
const { colorGamut } = useDisplayCapability();
const isClipped = isWideGamut && colorGamut === 'srgb';
```

This aligns with the `<WideGamutHint>` component's logic (which already uses `colorGamut === 'srgb'`).

---

## Photographer Impact Summary

| Scenario | Before fix | After fix |
|----------|-----------|-----------|
| sRGB image on P3 display | Histogram uses P3 canvas (slightly wrong bins) | Uses sRGB canvas (accurate) |
| Wide-gamut image on sRGB display with AVIF support | No "(sRGB clipped)" label | Label shown correctly |
| Wide-gamut image on sRGB display without AVIF | Label shown | Unchanged |
| Wide-gamut image on P3 display | Accurate P3 histogram | Unchanged |
