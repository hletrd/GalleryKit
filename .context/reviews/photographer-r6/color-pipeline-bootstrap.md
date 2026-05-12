# R6 Color Pipeline Bootstrap Review

**Angle:** Color pipeline integrity across server restart
**Files reviewed:** `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/color-detection.ts`

---

## R6-H1 [HIGH] — Bootstrap queue drops NCLX color signals on server restart

### Evidence

The `bootstrapPendingImages` function in `image-queue.ts` queries:

```ts
const pendingImages = await db
    .select({
        id: images.id,
        filename_original: images.filename_original,
        filename_webp: images.filename_webp,
        filename_avif: images.filename_avif,
        filename_jpeg: images.filename_jpeg,
        width: images.width,
        topic: images.topic,
        capture_date: images.capture_date,
        camera_model: images.camera_model,
        icc_profile_name: images.icc_profile_name,
    })
    .from(images)
    .where(eq(images.processed, false));
```

Notice: `color_primaries` is NOT selected. `transfer_function`, `matrix_coefficients`, `is_hdr`, and `has_gain_map` are also missing.

The enqueue call:

```ts
for (const image of pendingImages) {
    enqueueImageProcessing({
        id: image.id,
        filenameOriginal: image.filename_original,
        filenameWebp: image.filename_webp,
        filenameAvif: image.filename_avif,
        filenameJpeg: image.filename_jpeg,
        width: image.width,
        topic: image.topic,
        captureDate: image.capture_date,
        cameraModel: image.camera_model,
        iccProfileName: image.icc_profile_name,
        // colorSignals is MISSING!
    });
}
```

In `processImageFormats`, `resolveColorPipelineDecision` and `resolveAvifIccProfile` both accept an optional `signals` parameter. When `signals` is undefined, they fall back to ICC-name-only resolution:

```ts
function resolveColorPipelineDecision(
    iccProfileName: string | null | undefined,
    signals?: Partial<ColorSignals>,
): ColorPipelineDecision {
    // ... checks signals first, then falls back to ICC name heuristic
}
```

For NCLX-only HEIF/AVIF sources, `icc_profile_name` is NULL and `signals` is the ONLY source of gamut information. With both missing, the decision becomes `srgb-from-unknown`.

### Impact

A photographer uploads a Display-P3 HEIF (NCLX `colourPrimaries = 12`). The upload succeeds, `color_primaries` is stored as `'p3-d65'`. The server restarts before processing completes. On restart, the bootstrap query loses `'p3-d65'`; the queue encodes the image as sRGB. The photographer's wide-gamut image is silently downgraded.

### Fix

Add all color columns to the bootstrap SELECT and reconstruct `ColorSignals`:

```ts
.select({
    // ... existing fields ...
    icc_profile_name: images.icc_profile_name,
    color_primaries: images.color_primaries,
    transfer_function: images.transfer_function,
    matrix_coefficients: images.matrix_coefficients,
    is_hdr: images.is_hdr,
    has_gain_map: images.has_gain_map,
})
```

Then in the enqueue loop:

```ts
enqueueImageProcessing({
    // ... existing fields ...
    iccProfileName: image.icc_profile_name,
    colorSignals: {
        iccProfileName: image.icc_profile_name,
        colorPrimaries: image.color_primaries ?? 'unknown',
        transferFunction: image.transfer_function ?? 'unknown',
        matrixCoefficients: image.matrix_coefficients ?? 'unknown',
        isHdr: image.is_hdr ?? false,
        hasGainMap: image.has_gain_map ?? false,
    },
});
```

The `ColorSignals` interface is already defined in `color-detection.ts` and `processImageFormats` already accepts it.

---

## R6-L2 [LOW] — Bootstrap query may use stale ICC profile name

### Evidence

Same bootstrap query as R6-H1. The `icc_profile_name` column is read at restart time, but it may have been updated since the row was first inserted. For example:

1. Image uploaded with a generic ICC name (e.g., "Eizo").
2. A later backfill or detection improvement updates `color_primaries` via ICC chromaticity (P4-A2) but does NOT update `icc_profile_name` (which is just the raw parsed name).
3. Server restarts. Bootstrap reads the old `icc_profile_name`.
4. `processImageFormats` uses the stale name for pipeline decision.

In practice this is LOW because `color_primaries` (when present) already overrides the ICC name in `processImageFormats` via the `signals` parameter. But when `colorSignals` is missing (R6-H1), the stale `icc_profile_name` becomes the sole source of truth.

### Fix

Same fix as R6-H1: bootstrap should read ALL color columns and pass the full `ColorSignals` object. The `colorPrimaries` field then takes precedence over `iccProfileName`.

---

## Photographer Impact Summary

| Scenario | Before fix | After fix |
|----------|-----------|-----------|
| NCLX-only HEIF/AVIF pending at restart | Silently downgraded to sRGB | Preserves NCLX gamut |
| ICC-name-only source pending at restart | Uses stale ICC name | Uses full `ColorSignals` with `colorPrimaries` precedence |
| Normal upload (no restart) | Correct | Unchanged |
