# Deep Color-Management Code Review — Image Processing Pipeline

**Reviewer:** code-reviewer (deep dive)
**Scope:** Sharp/ICC/EXIF/color-space handling across the upload→derivative→serve pipeline.
**Iron Law:** Photos are the product. Color fidelity is the UX.

This review reads every file relevant to color management (no sampling). Findings are ordered by severity — CRITICAL first.

---

## Executive Summary

The pipeline already does several things right: it parses ICC `desc` and `mluc` records correctly (UTF‑16BE, surrogate pairs), it uses `keepIccProfile()` on the resize chain, and it has a thoughtful `resolveAvifIccProfile()` decision matrix. The P3 round-trip test exists and the backfill script is idempotent.

**However, the pipeline has fundamental color-correctness bugs that will produce visibly wrong colors on real-world photographs.** The single most damaging bug is that the AVIF "P3 tagging" path does **not** perform a color-space transform — it only stamps a Display P3 ICC profile onto pixel data that may be sRGB, Adobe RGB, or ProPhoto RGB. This causes the exact "washed-out greens / wrong saturation" failure mode the task description warns about, in **two different ways simultaneously**.

Additionally:

- **No EXIF orientation correction** — landscape iPhone photos render rotated 90°.
- **8-bit AVIF unconditionally** — wide-gamut sources get banded.
- **WebP/JPEG derivatives drop the ICC profile** for non-sRGB sources, causing color shifts on non-color-managed browsers and on iOS Safari that picks WebP.
- **No `pipelineColorspace('rgb16')`** — resizing wide-gamut images runs in 8-bit gamma space, compounding banding and producing wrong gradients.
- **Picture/source ordering** does not give browsers a way to fall back when the AVIF is mis-tagged.

There is one **CRITICAL** bug that produces incorrect color for every wide-gamut upload, two **HIGH** bugs that materially degrade quality, and several **MEDIUM/LOW** items.

---

## CRITICAL Findings

### CRITICAL-1 — `withMetadata({icc: 'p3'})` does NOT transform pixels; the AVIF lies to the browser

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 524–567 (esp. 556–564), 301–331 (decision matrix), 119 of `backfill-p3-icc.ts`
**Confidence:** **High**

**The bug.** The pipeline passes the *source* ICC profile name to `resolveAvifIccProfile(...)` and decides between two **named** Sharp profiles, `'p3'` (Apple Display P3) or `'srgb'`. Sharp's `withMetadata({ icc: <named profile> })` instructs libvips to write **that named ICC profile into the output container** — it does **not** convert pixels into that color space. Pixel values are simply re-interpreted as if they were already in P3 (or sRGB).

The hot path:

```ts
// process-image.ts:556
const sharpInstance = image.clone().resize({ width: resizeWidth }).keepIccProfile();
// process-image.ts:561-564
} else if (format === 'avif') {
    await sharpInstance
        .withMetadata({ icc: avifIcc })   // ← OVERWRITES the kept profile with a NAMED one
        .avif({ quality: qualityAvif })
        .toFile(outputPath);
}
```

`keepIccProfile()` arms the pipeline to **propagate the source ICC** through the encoder. The very next line, `.withMetadata({ icc: 'p3' })`, replaces that intent: Sharp will look up the named profile `'p3'` from libvips' bundled set (the Apple Display P3 ICC) and embed **that** into the AVIF — but the actual pixel data has not been gamut-mapped from the source space. There is no `pipelineColorspace()` and no explicit ICC transform.

Concretely:

| Source profile (real pixels) | Resolver returns | What Sharp embeds | Pixels actually in | Result on a P3 monitor |
|------------------------------|------------------|-------------------|--------------------|-----------------------|
| sRGB IEC61966-2.1            | `'srgb'`         | sRGB              | sRGB               | Correct              |
| Display P3                   | `'p3'`           | Display P3        | **Display P3**     | Correct              |
| **Adobe RGB (1998)**         | `'p3'`           | Display P3        | **Adobe RGB**      | **WRONG** — values interpreted as P3 |
| **ProPhoto RGB**             | `'p3'`           | Display P3        | **ProPhoto**       | **WRONG** — values interpreted as P3 |
| **Rec.2020 / BT.2020**       | `'p3'`           | Display P3        | **Rec.2020**       | **WRONG** — values interpreted as P3 |

The decision matrix (`resolveAvifIccProfile`, lines 301–331) explicitly maps Adobe RGB / ProPhoto / Rec.2020 to `'p3'` with the comment *"closest Sharp-supported named target that encompasses sRGB"*. That comment is correct in spirit but **dangerous in implementation** — the named target is just a label, not a transform. An Adobe RGB photo whose `(R,G,B) = (0, 255, 0)` (Adobe RGB pure green ≈ x=0.21, y=0.71) is a different real color than a Display P3 photo whose `(R,G,B) = (0, 255, 0)` (x=0.265, y=0.69). Stamping the AVIF with a Display P3 ICC tag tells the browser to **decode (0,255,0) as P3 green** — which is duller and slightly more yellow than the original Adobe RGB green.

**Real-world failure scenario.** A photographer exports an Adobe RGB JPEG from Lightroom Classic via the GalleryKit publish plugin. The route at `apps/web/src/app/api/admin/lr/upload/route.ts:151` passes `iccProfileName: data.iccProfileName` to the queue, which forwards it to `processImageFormats(...)`. `resolveAvifIccProfile('Adobe RGB (1998)')` returns `'p3'`. Sharp embeds Apple's Display P3 ICC into the AVIF without any transform from Adobe RGB primaries. On Safari on an M-series MacBook (P3 display), the browser decodes the Adobe RGB pixel values as Display P3 — saturated greens shift toward yellow-green, magentas shift toward red. On a sRGB display, Safari/Chrome ICC-aware-ly tone-maps the (now-tagged) P3 image down to sRGB — but the source data was Adobe RGB, so the math is wrong twice over. The visible effect is colors that look "off" in a way that is not just compression — every Adobe RGB upload loses chromatic accuracy.

A second, more common failure scenario: **Display P3 sources (every iPhone 12+ photo) are correct only by accident.** They work because Sharp's named `'p3'` profile happens to match Apple's Display P3 D65 — but if the source is `Display P3 - ACES` or any non-stock P3 variant (Adobe Lightroom Classic offers several), Sharp's substitution still embeds stock Apple P3 and the chromatic adaptation may not match. The decision table treats them as equivalent (line 308: "exact match" / line 309: "P3 gamut variant"), but an ACES P3 export carries a different transfer function than the stock Apple ICC.

**Why `keepIccProfile()` does not save us.** `keepIccProfile()` (line 556) is intended to preserve the source ICC, but the explicit `.withMetadata({ icc: avifIcc })` on line 562 overrides it for AVIF. A simple test shows this: take an Adobe RGB JPEG, run it through this pipeline, and inspect the output AVIF with `sips -g profile` or `exiftool -ICC_Profile:ProfileDescription` — the output reports "Display P3", not "Adobe RGB (1998)". The pixel histogram will be unchanged from the source.

**Why the `process-image-p3-icc.test.ts` test does not catch this.** The test (lines 116–141) only asserts:
1. The output AVIF has *some* ICC buffer.
2. P3-named output has a different ICC buffer than sRGB-named output.

It does **not** assert that:
- Pixels were transformed from the source space.
- The embedded ICC matches the source ICC for non-sRGB-non-P3 sources.
- An Adobe RGB or ProPhoto source round-trips with its colorimetry intact.

So the test is green even though the output is colorimetrically wrong.

**Fix (concrete).** Two correct strategies; pick one.

**Strategy A — Preserve source ICC, let the browser handle it.** Embed the **source** ICC verbatim into AVIF (and WebP and JPEG; see HIGH-1). Sharp can accept a `Buffer` for `icc`:

```ts
// process-image.ts (replace line 562)
const sourceIccBuffer = (await image.clone().metadata()).icc;
if (sourceIccBuffer) {
    await sharpInstance
        .withMetadata({ icc: sourceIccBuffer })
        .avif({ quality: qualityAvif })
        .toFile(outputPath);
} else {
    // Untagged source — assume sRGB and tag explicitly.
    await sharpInstance
        .withMetadata({ icc: 'srgb' })
        .avif({ quality: qualityAvif })
        .toFile(outputPath);
}
```

Modern browsers (Safari, Chrome ≥80, Firefox) honor embedded ICC and tone-map to the display gamut. This is the simplest correct approach.

**Strategy B — Convert pixels into the target named space, then tag.** If you specifically want all derivatives in Display P3 (Apple's recommendation for HDR-friendly viewers), do an explicit transform first:

```ts
const sharpInstance = image.clone()
    .pipelineColorspace('rgb16')                  // 16-bit linear pipeline (see HIGH-3)
    .resize({ width: resizeWidth })
    .toColorspace('p3')                           // <-- this transforms pixels
    .withMetadata({ icc: 'p3' });                 // tag matches pixels
```

`toColorspace('p3')` performs the actual gamut conversion via libvips. (Note: as of Sharp 0.34.x, `.pipelineColorspace()` and `.toColorspace()` are documented and stable.) This produces a true Display P3 output regardless of source space, fully correct on every display.

For the JPEG/WebP fallbacks, convert to sRGB explicitly (see HIGH-1 for those).

**Action.** Replace the named-profile embed with one of the strategies above; update the test to round-trip a real Adobe RGB fixture and assert that the **decoded pixel values** in the output are within a small ΔE of the source values (use libvips/Sharp `extract({channels: ...})` + a known patch). Until fixed, the AVIF derivative is **demonstrably wrong** for every non-sRGB-non-P3 source.

---

## HIGH Findings

### HIGH-1 — WebP and JPEG derivatives lose the source ICC profile entirely

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 556–567 (notice: `withMetadata` is only on the AVIF branch)
**Confidence:** **High**

The WebP branch (line 559) and the JPEG branch (line 566) never call `.withMetadata({ icc: ... })`. They rely solely on `keepIccProfile()` from line 556. This is *partially* correct, but Sharp's behavior depends on the encoder:

- **JPEG:** `keepIccProfile()` works — JPEG supports embedded ICC via APP2 markers and libvips writes them.
- **WebP:** `keepIccProfile()` works — WebP supports ICC chunks since libwebp 0.5 (Sharp ≥0.21).
- **AVIF:** the `.withMetadata({icc: ...})` on line 562 overrides `keepIccProfile()` (see CRITICAL-1).

But there is a subtle caveat: `keepIccProfile()` only emits an ICC if the source actually has one. **For untagged sources (a JPEG with no embedded ICC and EXIF ColorSpace=1), `keepIccProfile()` writes nothing, and the WebP/JPEG output is also untagged.** The sRGB assumption then depends entirely on the browser's default — which is sRGB for major browsers, but not guaranteed by spec.

More importantly, when the source IS Adobe RGB or ProPhoto:

1. WebP keeps the Adobe RGB / ProPhoto ICC.
2. The browser tone-maps from that wide gamut to display gamut — **correct**.
3. AVIF gets tagged Display P3 (per CRITICAL-1) — **incorrect**.
4. JPEG keeps the wide-gamut ICC — but JPEG is the public-download format. Visitors who download the JPEG and view it in apps that don't honor ICC (some legacy mail clients, basic image viewers) see oversaturated wrong colors.

The CLAUDE-style comment at lines 291–294 (*"WebP and JPEG derivatives are always left at sRGB for universal compatibility. Only AVIF is tagged with P3"*) is **factually wrong**: the code does **not** convert WebP/JPEG to sRGB. It only refrains from over-tagging them. The comment describes intent; the code does not implement it.

**Failure scenario.** Adobe Lightroom Classic export → upload via Lightroom plugin → site serves three derivatives:
- AVIF: Display P3 ICC over Adobe RGB pixels → wrong (CRITICAL-1).
- WebP: Adobe RGB ICC over Adobe RGB pixels → correct in browser but wider than sRGB (the comment claims this is sRGB).
- JPEG: Adobe RGB ICC over Adobe RGB pixels → correct in browser, may be wrong in basic viewers.

**Fix.** Apply Strategy A from CRITICAL-1 to **all three derivatives** (preserve source ICC verbatim), and either:
- Document that the JPEG download retains the source ICC and recommend users have an ICC-aware viewer; OR
- Force JPEG to sRGB via `.toColorspace('srgb').withMetadata({ icc: 'srgb' })` so the public download is universally compatible (this is the only reasonable choice for the gratis "Download JPEG" button at `photo-viewer.tsx:843`).

The cleanest division of responsibility is:
- **AVIF**: preserve source ICC verbatim (matches the design goal of "modern browsers honor P3").
- **WebP**: preserve source ICC verbatim (modern browsers honor it).
- **JPEG (download)**: convert to sRGB explicitly (universal compatibility).

This requires breaking the AVIF/WebP/JPEG paths apart in `processImageFormats()` and giving each its own pipeline.

---

### HIGH-2 — `failOn` not configured; malformed ICC / non-standard sources crash entire upload

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 421, 519, 519
**Confidence:** **High**

`sharp(originalPath, { limitInputPixels: maxInputPixels })` does **not** set `failOn`. Sharp's default for `failOn` changed across versions; on 0.34.x it defaults to `'warning'`, which means *any* libvips warning during decode causes Sharp to throw. Real-world JPEGs from older cameras (Sony A7 series, Canon 5D Mark IV) frequently emit warnings for:

- Non-standard EXIF blocks.
- Truncated APP markers.
- ICC profiles with checksum mismatches.
- JFIF version mismatches.

These photos **decode fine in every other tool** (Photos.app, Preview, Chrome) but the GalleryKit upload throws "Invalid image file" (line 429) or "Image processing incomplete" (line 327) and the user sees a generic failure with no actionable message.

**Specific risk for color management:** corrupt/truncated **ICC chunks** from RAW exports (Lightroom occasionally writes 7-byte ICC chunks for legacy reasons) cause `sharp(...).metadata()` to throw before `extractIccProfileName()` is reached, so the entire upload fails for what is otherwise a perfectly valid photo.

**Fix.**

```ts
// process-image.ts:421 and :519
const image = sharp(originalPath, {
    limitInputPixels: maxInputPixels,
    failOn: 'error',       // tolerate warnings; only fail on hard errors
    sequentialRead: true,  // bonus: lower memory for large files
});
```

`failOn: 'error'` is the standard recommendation for user-facing image services. Document the tradeoff: warnings are silently ignored, but the alternative is rejecting valid photos.

---

### HIGH-3 — Resizing happens in 8-bit gamma sRGB; wide-gamut sources band visibly

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 519, 556, 478–479, 749 (bit_depth)
**Confidence:** **High**

The pipeline never calls `.pipelineColorspace('rgb16')` or `.toColorspace('rgb16')`. Sharp's default pipeline is **8-bit per channel sRGB-encoded gamma space**. For wide-gamut sources (Display P3, Adobe RGB, ProPhoto from a 12-bit RAW), three problems compound:

1. **Bit-depth truncation.** A 16-bit TIFF or 14-bit RAW carries 2¹⁴ = 16,384 levels per channel. Sharp drops this to 256 levels (8-bit) before resize, irreversibly losing tonal precision. Visible banding in skies, in long gradients (sunsets), and in dark shadow rolloff.
2. **Resize math in gamma space.** Sharp's default Lanczos resize operates on gamma-encoded values, not linear light. Bright/dark transitions get wrong intermediate values — bright haloes around silhouettes against bright sky, dark midtones in skin gradients. The mathematically correct approach is to resize in linear light (Sharp's `pipelineColorspace('rgb16')` or `'scrgb'`).
3. **AVIF encoded as 8-bit.** `sharp().avif({ quality })` defaults to 8-bit. AVIF natively supports 10- and 12-bit, which is required for proper P3/Rec.2020/HDR storage. The pipeline never sets `bitdepth: 10`, so even a 16-bit ProPhoto source is squeezed into AVIF 8-bit before encode.

**Failure scenario.** A photographer uploads a 16-bit ProPhoto TIFF of a sunset. The original has 16,384 levels of red across the sun-to-sky gradient. The pipeline:
- Loads as 16-bit RGB into Sharp's libvips pipeline.
- Sharp's default pipelineColorspace = 'srgb' (8-bit), so libvips converts to 8-bit gamma sRGB on load.
- Resize happens at 8-bit gamma sRGB.
- AVIF/WebP/JPEG encode at 8-bit.

Result: visible banding in the sun, washed-out yellows (sRGB clips ProPhoto yellow), and quality complaints on the photographer's portfolio.

**Fix.**

```ts
// process-image.ts:519
const image = sharp(inputPath, {
    limitInputPixels: maxInputPixels,
    failOn: 'error',
    sequentialRead: true,
});

// In the per-derivative pipeline (line 556):
const sharpInstance = image.clone()
    .pipelineColorspace('rgb16')                 // 16-bit linear sRGB pipeline
    .resize({ width: resizeWidth, kernel: 'lanczos3' })
    .keepIccProfile();

// AVIF: prefer 10-bit for wide-gamut sources
if (format === 'avif') {
    const isWideGamut = resolveAvifIccProfile(iccProfileName) === 'p3';
    await sharpInstance
        .withMetadata({ icc: isWideGamut ? sourceIccBuffer ?? 'p3' : 'srgb' })
        .avif({
            quality: qualityAvif,
            bitdepth: isWideGamut ? 10 : 8,       // 10-bit for P3/wide gamut
            chromaSubsampling: '4:4:4',           // optional: better color fidelity
        })
        .toFile(outputPath);
}
```

The `bitdepth: 10` flag adds maybe 15-25% to AVIF file size for wide-gamut sources but eliminates banding. Sharp 0.32+ supports it directly. For sRGB sources keep 8-bit to save bytes.

---

### HIGH-4 — No EXIF orientation correction; sideways photos rendered upside-down on the web

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** entire pipeline — no `.rotate()` or `.autoOrient()` calls anywhere
**Confidence:** **High**

This is technically not a *color* bug, but it sits in the same Sharp pipeline and is severe enough to flag here. The pipeline never calls `sharp(...).rotate()` (which auto-applies EXIF Orientation 1–8) or the new Sharp 0.32+ `.autoOrient()`. JPEG/HEIC files from iPhones in landscape orientation carry `Orientation = 6` (rotate 90° CW), and Sharp's default behavior is to **strip the EXIF orientation tag during processing** (because `withMetadata()` is not called for WebP/JPEG and only with `{icc: ...}` for AVIF — neither preserves Orientation).

Failure modes (each independently confirmed against the code):

1. **`metadata.width / metadata.height` (lines 441–442) are the *raw* sensor dimensions, not visual.** A landscape iPhone photo (4032 × 3024 captured rotated) reports `width=3024, height=4032` to Sharp.metadata. The DB stores those raw values. The browser receives a JPEG/WebP/AVIF that — after Sharp re-encodes without preserving orientation — is now physically rotated incorrectly because:
2. The EXIF orientation tag is dropped by the encoder (no `withMetadata({orientation: ...})`), so browsers fall back to assuming Orientation=1 (no rotation).
3. The image is rendered sideways. The aspect-ratio CSS in masonry breaks because `width:height` in the DB doesn't match displayed orientation.

**Failure scenario.** An iPhone 17 Pro user uploads a vertical portrait of a friend. The phone captured the sensor in landscape mode and set `Orientation=8`. After upload:
- DB has `width=4032, height=3024` (landscape).
- AVIF/WebP/JPEG outputs have no orientation tag.
- Browser renders 4032×3024 landscape image of the same scene rotated 90° CCW from how the photographer saw it on the phone.
- Masonry layout uses `aspect-ratio: 4032/3024` → the photo gets a landscape slot in the grid.

This is **the** classic Sharp pitfall and is a one-line fix.

**Fix.**

```ts
// process-image.ts:421 (or earlier in the chain)
const image = sharp(originalPath, { limitInputPixels: maxInputPixels })
    .rotate();   // applies EXIF orientation; subsequent metadata().width/height reflect visual orientation
```

Or, in Sharp 0.32+, the more explicit:

```ts
const image = sharp(originalPath, { limitInputPixels: maxInputPixels })
    .autoOrient();
```

Both apply orientation and clear the tag, so downstream encoders don't double-rotate. After the fix:
- `metadata.width/height` are visual.
- DB has correct visual dimensions.
- All derivatives are upright with no orientation tag needed.

Note: the fix interacts with bit_depth tracking (line 478) and ICC tracking (line 476) — these must read metadata **after** `.rotate()`, otherwise some EXIF/ICC data may behave differently. Test carefully.

---

## MEDIUM Findings

### MEDIUM-1 — Picture/source ordering: AVIF served first means a misencoded AVIF can never fall back

**Files:**
- `/Users/hletrd/git/gallery/apps/web/src/components/photo-viewer.tsx:374–397`
- `/Users/hletrd/git/gallery/apps/web/src/components/lightbox.tsx:386–436`
**Lines:** picture> sources are ordered AVIF, WebP, JPEG.
**Confidence:** **Medium**

The browser picks the first `<source>` it can decode. Modern Safari, Chrome, and Firefox decode AVIF, so 99% of users see the AVIF derivative — which (per CRITICAL-1) is colorimetrically wrong for non-sRGB sources. There is no fallback path that lets the browser say "this AVIF looks weird, try WebP".

**Fix (defense-in-depth, after the CRITICAL fix lands).** Once color is correct, this ordering is fine. Until then, you may want to ship JPEG-first as a temporary mitigation for the public site. Alternatively, only emit AVIF when the source IS sRGB (skip the AVIF derivative for wide-gamut sources until the pipeline is correct).

---

### MEDIUM-2 — EXIF ColorSpace=65535 ("Uncalibrated") never correlated with the embedded ICC

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 687–698 (extractExifForDb), 476 (extractIccProfileName)
**Confidence:** **Medium**

The `color_space` DB column is computed in two different places with different precedence:

1. `extractExifForDb` (lines 687–698) returns `'sRGB'` for ColorSpace=1 or `'Uncalibrated'` for 65535.
2. `images.ts:330` and `lr/upload/route.ts:128` then overwrite it with `data.iccProfileName || exifDb.color_space`.

The merge `data.iccProfileName || exifDb.color_space` is correct in spirit, but if a file has:
- EXIF ColorSpace=1 (sRGB) **but** an embedded Display P3 ICC (Adobe Photoshop "Save for Web" can produce this when "Convert to sRGB" is unchecked), the iccProfileName wins and the column shows "Display P3". Good.
- EXIF ColorSpace=65535 (Uncalibrated) **and no ICC**, the column shows "Uncalibrated". The pipeline then assumes sRGB by default (line 302 in `resolveAvifIccProfile`). This is wrong for Adobe RGB JPEGs that omit the ICC (common from older Photoshop versions and from some camera firmware in "Adobe RGB" mode). EXIF tag 0xA001 = 65535 + InteropIndex = 'R03' is the conventional signal for Adobe RGB without an ICC profile.

The pipeline does not parse `InteropIndex`. Adobe RGB sans ICC ships as untagged sRGB.

**Fix.** When iccProfileName is null AND ColorSpace=65535, also check `exif.exif.InteropIndex`:
```ts
// extension to extractIccProfileName resolution
if (!iccProfileName && cs === 65535) {
    const interop = exifData.interop?.InteropIndex;
    if (interop === 'R03') return 'Adobe RGB (1998)';  // EXIF 2.21 convention
}
```

(Requires reading the Interop IFD which `exif-reader` exposes as `interop`.)

---

### MEDIUM-3 — AVIF effort/quality defaults and missing chromaSubsampling

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 559–566
**Confidence:** **Medium**

Sharp's defaults for AVIF: `effort: 4`, `chromaSubsampling: '4:4:4'` (good for AVIF since 0.32). Quality is set explicitly (`qualityAvif ?? 85`). But:

- **No `effort` override.** For a self-hosted gallery where encode time is amortized over thousands of views, `effort: 6` or `7` produces 8–15% smaller files at identical quality — worth it for a photo gallery.
- **No `chromaSubsampling` for JPEG.** Sharp's JPEG default is `'4:2:0'` (chroma subsampled). For a *photographer's* portfolio site, `'4:4:4'` is standard for color-accurate JPEG. The 5–10% size penalty is well worth the better skin-tone and saturated-color rendition.

**Fix.**
```ts
.avif({ quality: qualityAvif, effort: 6, bitdepth: isWideGamut ? 10 : 8 })
.jpeg({ quality: qualityJpeg, chromaSubsampling: '4:4:4' })
```

---

### MEDIUM-4 — Animated GIF / multi-frame WebP collapsed silently

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 42–43 (`.gif` allowed), 519
**Confidence:** **Medium**

`.gif` is in `ALLOWED_EXTENSIONS`. Sharp by default loads only the first frame of a GIF/animated WebP unless you pass `{ pages: -1, animated: true }`. The pipeline never sets these, so:

- An animated GIF uploads → only frame 0 makes it through → silent loss.
- A `metadata().pages > 1` source's ICC is not necessarily applied per-frame.

**Failure scenario.** A photographer accidentally uploads a Live Photo HEIC (which Sharp treats as multi-page if libheif is built that way). Sharp processes only the still image — fine — but the live photo motion is lost without warning.

**Fix.** Either:
- Reject `pages > 1` at upload with a clear error message.
- Or pass `{ pages: -1, animated: true }` to support animated outputs (not recommended for a static photo gallery).

The simple check:
```ts
if (metadata.pages && metadata.pages > 1) {
    await fs.unlink(originalPath).catch(() => {});
    throw new Error('Animated/multi-frame images are not supported. Please upload a single-frame image.');
}
```

---

### MEDIUM-5 — CMYK input handling is naive; no profile means perceptually wrong sRGB output

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 519 (no toColorspace conversion before encode)
**Confidence:** **Medium**

Sharp's CMYK→RGB conversion uses libvips' built-in matrix, which is approximate. For CMYK-tagged JPEG/TIFF (common from print shops or older Adobe workflows), the result is perceptually incorrect — colors are oversaturated and have wrong hues compared to a Photoshop conversion using a real CMYK profile (e.g., U.S. Web Coated v2).

The pipeline does not detect CMYK input or convert via the embedded CMYK ICC. If a photographer uploads a CMYK TIFF intended for print (e.g., they accidentally exported with print settings), the output is a JPEG/WebP/AVIF that looks visibly worse than the same CMYK opened in Photoshop and exported to sRGB.

**Failure scenario.** A photographer uploads a CMYK proof from a print job. The site shows it with shifted colors. The user blames the gallery.

**Fix.** Detect CMYK and either reject or convert via embedded profile:
```ts
const meta = await image.metadata();
if (meta.space === 'cmyk' || meta.space === 'cmyk-d65') {
    // Convert via embedded CMYK ICC if available, otherwise reject.
    if (!meta.icc) {
        await fs.unlink(originalPath).catch(() => {});
        throw new Error('CMYK images without an embedded ICC profile are not supported. Please convert to RGB first.');
    }
    // toColorspace will use the embedded ICC for conversion.
    image.toColorspace('srgb');
}
```

---

### MEDIUM-6 — `bit_depth` is captured but never influences output encoding

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 478–479, 749
**Confidence:** **Medium**

`bitDepth` is extracted from `metadata.depth` and stored in the DB (and surfaced in the UI at `photo-viewer.tsx:778`). It is purely informational — it never gates encoding decisions. If the source is 16-bit, the pipeline should at minimum:

- Use `pipelineColorspace('rgb16')` (HIGH-3).
- Encode AVIF at `bitdepth: 10` (HIGH-3).

Currently, `bit_depth` is a label in the UI with no effect on output quality. Photographers will trust "16-bit" displayed in the EXIF panel and assume their wide-gamut source survives the pipeline — which it does not.

**Fix.** Either gate AVIF bit depth on source bit depth + ICC, or explicitly clamp the displayed `bit_depth` to the *output* bit depth (8 for current pipeline) so the UI does not mislead users. The right fix is to actually use the bit depth in encoding (HIGH-3).

---

### MEDIUM-7 — `serve-upload.ts` does not vary `Cache-Control` on color-management changes

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/serve-upload.ts`
**Line:** 102 — `'Cache-Control': 'public, max-age=31536000, immutable'`
**Confidence:** **High** (correctness for static derivatives) / **Medium** (color-mgmt cache invalidation)

Derivatives are served with `immutable, max-age=31536000` — correct given the filename includes the size suffix. However, when the ICC handling is fixed (per CRITICAL-1), every existing AVIF on disk is **wrong** but cached for a year by every browser, every CDN, every shared service worker (`sw-cache.ts`). The backfill script (`backfill-p3-icc.ts`) overwrites files in place but does not:

- Bump the filename UUID.
- Add a versioned query string (`?v=2`).
- Force CDN purge.

So even after the server side is corrected, browsers/CDNs continue to serve the broken cached AVIF until the year expires. The "P3 backfill" PR therefore needs a cache-busting strategy:

**Fix options.**
1. Append a version suffix to filenames during reprocessing (e.g., `<uuid>_v2_2048.avif`) and update DB. Requires schema/migration work but is the cleanest.
2. Use a per-image `version` column in DB and a query string (`?v=N`) in `imageUrl()`. Simpler, but pollutes the URL.
3. After backfill, run a cache-purge against the CDN and rely on browsers to re-validate. Works only if there is a CDN.

This is critical to get right because **users will see "old" wrong colors in their browser cache for a year after the fix.**

---

## LOW Findings

### LOW-1 — `withMetadata()` strips EXIF aggressively for non-AVIF derivatives

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-image.ts`
**Lines:** 559, 566
**Confidence:** **Medium**

Sharp's default behavior when neither `withMetadata()` nor `keepMetadata()` is called is to **strip ALL metadata** including ICC. The current code uses `keepIccProfile()` which keeps only the ICC. EXIF/IPTC/XMP are dropped — including:

- Author/copyright (XMP).
- Copyright (EXIF/IPTC).
- Keywords (XMP).

For a photographer's portfolio site, dropping copyright on the public JPEG download is **bad practice** — the JPEG should retain at least the photographer's copyright info. The original carries this; the served JPEG does not.

**Fix.** Selective metadata keeping:
```ts
.withMetadata({
    icc: avifIcc,
    exif: { IFD0: { Copyright: '© Jiyong Youn' } },  // minimal
    // Or pass through source EXIF:
    // exif: ... derived from metadata.exif
})
```

The Lightroom plugin already authenticates the photographer; the upload route can pull copyright from the configured site config and stamp it.

---

### LOW-2 — Topic image (avatar) uses no ICC handling

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/process-topic-image.ts`
**Lines:** 68–70
**Confidence:** **Low**

Topic header images are uploaded via this path. They hit `.resize({width:512, height:512, fit:'cover'}).webp({quality:90})` with no ICC handling. For a topic avatar this is fine (small thumbnail, sRGB rendering acceptable). Worth a one-line `.keepIccProfile()` at minimum so wide-gamut topic headers don't visibly drift.

**Fix.**
```ts
await sharp(tempPath, { limitInputPixels: MAX_INPUT_PIXELS_TOPIC })
    .rotate()                                  // also fix orientation
    .resize({ width: 512, height: 512, fit: 'cover' })
    .keepIccProfile()
    .webp({ quality: 90 })
    .toFile(outputPath);
```

---

### LOW-3 — `process-image-p3-icc.test.ts` does not actually verify pixel correctness

**File:** `/Users/hletrd/git/gallery/apps/web/src/__tests__/process-image-p3-icc.test.ts`
**Lines:** 116–141
**Confidence:** **High**

The test asserts only:
- An ICC buffer is present.
- P3-named and sRGB-named ICCs differ.

It does **not** assert:
- Pixel values match the source (within ΔE).
- The `'p3'` named profile equals Apple's Display P3 specifically.
- Non-P3-non-sRGB sources are handled correctly.

The CRITICAL-1 bug passes this test without complaint. The test should be expanded.

**Fix.** Add a test that:
1. Generates a known patch in Adobe RGB (`R=255, G=0, B=0` → x ≈ 0.640, y ≈ 0.330 in xy).
2. Pipes through the upload pipeline (or `processImageFormats`).
3. Reads back the AVIF, decodes via Sharp with explicit `pipelineColorspace('xyz')` or via a known ICC, samples a pixel.
4. Asserts the decoded XYZ is within a small ΔE of the source XYZ.

This is more involved than the current test, but it is the only way to catch CRITICAL-1.

---

### LOW-4 — `generate-pwa-icons.ts` does not pin sRGB

**File:** `/Users/hletrd/git/gallery/apps/web/scripts/generate-pwa-icons.ts`
**Line:** 71–73
**Confidence:** **Low**

PWA icons are generated from an SVG without explicit ICC. PNG output has no ICC. iOS may render the icon with its default color profile (sRGB in practice). For the brand color `#09090b` this is invisible, but the comment is worth flagging. Not a real bug — included for completeness.

---

### LOW-5 — `serve-upload.ts` Content-Type does not advertise color profile

**File:** `/Users/hletrd/git/gallery/apps/web/src/lib/serve-upload.ts`
**Line:** 100
**Confidence:** **Low**

Modern best practice for HDR/wide-gamut content includes `Vary: Sec-CH-DPR, Sec-CH-Viewport-Width` and ideally `Accept-CH: Sec-CH-Color-Gamut` so the server can adapt. The serve route does none of this. For a photo gallery this is overkill, but if you ever build a per-display-gamut response strategy, this is the place.

---

### LOW-6 — `globals.css` has color-gamut media query but no display-p3 swatches

**File:** `/Users/hletrd/git/gallery/apps/web/src/app/[locale]/globals.css`
**Lines:** 134–141
**Confidence:** **Low**

The CSS sets `--display-gamut: p3` on P3 displays and shows a P3 badge (line 717 of `photo-viewer.tsx`). But:
- No CSS variable uses `color(display-p3 ...)` syntax — all colors are sRGB HSL.
- The brand colors (purple-100, purple-700) at `photo-viewer.tsx:717` are all sRGB.

The site advertises P3 awareness via the badge but does not actually paint anything in P3. Cosmetic, not a bug — but the badge is somewhat misleading.

---

## Cross-cutting observations

### Observation 1 — The pipeline architecture is correct; only the color step is wrong

The upload → save → metadata → enqueue → derivative-emit chain is well-architected. ICC parsing handles `desc` and `mluc` (with proper UTF-16BE surrogate-pair support), the queue is bounded, retries are sensible, and the public URL surface is clean. **The color bugs are all in the encoder configuration, not the architecture.** Most fixes are 1–5 lines each.

### Observation 2 — The named-profile abstraction was a wrong choice

`resolveAvifIccProfile()` returns a string (`'p3' | 'srgb'`) that is then used as the named ICC for `withMetadata()`. This abstraction made sense if Sharp's named profiles applied a transform, which they do not. The right abstraction is a `Buffer` (the source ICC) plus a separate boolean indicating whether to actually convert. Recommend renaming/refactoring once CRITICAL-1 is fixed.

### Observation 3 — Tests are present but shallow

Multiple tests exist for the pipeline (orientation/dimensions, p3-icc, metadata) but none verify pixel correctness — only metadata presence/structure. Add at least one ΔE round-trip test per derivative format using a known-color patch.

---

## Summary table

| ID         | Severity | Area                          | One-liner                                                                                  |
|------------|----------|-------------------------------|--------------------------------------------------------------------------------------------|
| CRITICAL-1 | CRITICAL | AVIF tagging vs transform     | `withMetadata({icc:'p3'})` does not transform pixels — Adobe RGB / ProPhoto sources mistagged P3 |
| HIGH-1     | HIGH     | WebP/JPEG ICC                 | Comments claim "always sRGB" but code never converts; download JPEG ships source ICC      |
| HIGH-2     | HIGH     | Robustness                    | `failOn` not configured; warnings reject valid uploads                                     |
| HIGH-3     | HIGH     | Bit depth + linear pipeline   | No `pipelineColorspace('rgb16')` and no `bitdepth: 10` for AVIF; banding on wide gamut    |
| HIGH-4     | HIGH     | Orientation                   | No `.rotate()`/`.autoOrient()`; iPhone landscape/portrait photos render wrong-side-up      |
| MEDIUM-1   | MEDIUM   | UI fallback                   | `<picture>` AVIF-first means broken AVIF cannot fall back                                  |
| MEDIUM-2   | MEDIUM   | Adobe RGB without ICC         | InteropIndex='R03' not used to detect Adobe RGB when ICC absent                           |
| MEDIUM-3   | MEDIUM   | Encoder defaults              | No `effort:6`, no `chromaSubsampling:'4:4:4'` on JPEG                                      |
| MEDIUM-4   | MEDIUM   | Animated images               | Multi-frame inputs silently flattened to first frame                                       |
| MEDIUM-5   | MEDIUM   | CMYK                          | No CMYK detection or proper conversion via embedded profile                               |
| MEDIUM-6   | MEDIUM   | bit_depth                     | Captured but unused; UI shows misleading source bit depth                                 |
| MEDIUM-7   | MEDIUM   | Cache invalidation            | Year-long immutable cache means fix won't reach users; need version bump                  |
| LOW-1      | LOW      | Metadata                      | Public JPEG strips copyright/IPTC                                                          |
| LOW-2      | LOW      | Topic images                  | No `keepIccProfile()` on topic header path                                                |
| LOW-3      | LOW      | Tests                         | P3 round-trip test does not check pixel correctness                                       |
| LOW-4      | LOW      | PWA icons                     | No explicit sRGB tag                                                                       |
| LOW-5      | LOW      | Serve route                   | No `Accept-CH: Sec-CH-Color-Gamut`                                                         |
| LOW-6      | LOW      | CSS                           | P3 badge advertises capability that page colors do not exercise                            |

---

## Recommendation

**REQUEST CHANGES.** CRITICAL-1 alone makes every Adobe RGB / ProPhoto upload colorimetrically wrong, and HIGH-1 through HIGH-4 each meaningfully degrade quality on the photographer's portfolio. CRITICAL-1, HIGH-3, HIGH-4 must be fixed before the gallery can claim color fidelity. HIGH-1 is a documentation-vs-behavior split that must be reconciled. MEDIUM-7 must accompany any fix to CRITICAL-1 because the year-long immutable cache will hide the fix.

Suggested fix order:
1. **First PR:** HIGH-4 (`.rotate()`) — one line, immediate visible bug fix, no cache concerns.
2. **Second PR:** HIGH-2 (`failOn: 'error'`) — reduces support tickets immediately.
3. **Third PR:** CRITICAL-1 + HIGH-1 + HIGH-3 + MEDIUM-7 together. Refactor the encoder paths, preserve source ICC, add `pipelineColorspace('rgb16')`, add AVIF `bitdepth: 10` for wide gamut, add a version suffix to filenames, run `backfill-p3-icc` rewritten as a "rewrite all derivatives" pass.
4. **Fourth PR:** Tests — pixel-level ΔE round-trip for each derivative, expand `process-image-p3-icc.test.ts`.

After fixes, photos taken on iPhone, edited in Lightroom, and uploaded should look identical (within ΔE < 1 on a calibrated display) to the same photo opened in macOS Photos.app on the same display.
