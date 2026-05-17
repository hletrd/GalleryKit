# Photographer Review R10 — Encoder / Delivery Pipeline

**Date:** 2026-05-16
**Scope:** Deep inspection of image encoding and delivery after R9 convergence.
**Reviewer angle:** Professional photographer — color fidelity, ICC embedding accuracy, encode quality, metadata preservation, pipeline robustness.
**Premise:** Photos arrive AFTER the photographer's editing. The encoder + viewer must deliver the photographer's intent accurately.

---

## Summary

R9 surfaced 2 MEDIUM + 3 LOW encoder/delivery findings. The R10 pass confirms **R9-M1 (backfill `color_pipeline_decision` refresh) is FIXED in current code** — the `ReprocessSignals` interface now includes `color_pipeline_decision` and `reprocessRow` recomputes it from freshly detected signals. The remaining pipeline reveals **2 HIGH + 4 MEDIUM + 5 LOW** new findings, plus **R9-M2 (ETag staleness) remains open**.

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH | 2 | R10-H1, R10-H2 |
| MEDIUM | 4 | R10-M1 (R9-M2 carryover), R10-M2, R10-M3, R10-M4 |
| LOW | 5 | R10-L1–R10-L5 |

---

## R9 Finding Closure Status

| R9 ID | Severity | Status | Evidence |
|-------|----------|--------|----------|
| R9-M1 | Backfill `color_pipeline_decision` refresh | **FIXED** | `backfill-color-pipeline.ts:66-75` — `ReprocessSignals` now includes `color_pipeline_decision`; lines 137-149 recompute it via `resolveColorPipelineDecision(signals.iccProfileName, signals)`. |
| R9-M2 | ETag staleness on settings change | **OPEN** | `serve-upload.ts:110-112` unchanged — `settingsHash` still reflects current global settings, not per-image encode settings. See R10-M1 below. |
| R9-L1 | `wide_gamut_max_source_pixels` in settingsHash | **OPEN / Acceptable** | Still present. One conditional GET per image; acceptable at personal-gallery scale. |
| R9-L2 | DCI-P3 rgb16 skip comment conflation | **OPEN / Documentation** | Comment at `process-image.ts:831-838` still conflates ICC-embedded and NCLX-only cases. |
| R9-L3 | Display P3 → rgb16 as intentional trade-off | **OPEN / By Design** | Conservative same-gamut rgb16 resize is still present. Document-only. |

---

## Detailed Findings

### R10-H1 [HIGH] — WI-15 downscale intermediate loses ICC profile; large wide-gamut sources may encode with shifted colors

**Files:** `apps/web/src/lib/process-image.ts:767-776`
**Confidence:** Confirmed by direct inspection + Sharp color pipeline behavior analysis
**Impact:** Photographers uploading wide-gamut sources larger than the `wide_gamut_max_source_pixels` cap (default 50 MP) get derivatives with incorrect color reproduction. The temporary intermediate file written by the downscale step carries no ICC profile, so the subsequent rgb16 pipeline may misinterpret pixel values.

**Evidence:**

```ts
// process-image.ts:770-773
const tmpPath = path.join(os.tmpdir(), `${path.basename(inputPath)}.${randomUUID().slice(0, 8)}.wi15.tmp`);
await sharp(inputPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true, autoOrient: true })
    .resize({ width: targetWidth, withoutEnlargement: true })
    .toFile(tmpPath);
```

The `.toFile(tmpPath)` writes a resized image without `.withIccProfile()`. The temporary file has NO embedded ICC profile. When `generateForFormat` (line 795) creates a fresh Sharp instance from `processingInputPath` (the tmpPath), Sharp/libvips has no ICC metadata and assumes sRGB for the pixel values.

Then at line 876:
```ts
await base
    .toColorspace(avifIcc)  // e.g., 'p3'
    .withIccProfile(avifIcc)
```

`.toColorspace('p3')` converts from the assumed source colorspace (sRGB, because no ICC is present) to P3. But the actual pixel values in the temporary file are in the SOURCE colorspace (e.g., Display P3, Adobe RGB, or ProPhoto). The result is a color shift — the encoder interprets P3 pixel values as sRGB and then "converts" them to P3, producing washed-out or hue-shifted output.

This only affects the downscale path (`basePixels > WIDE_GAMUT_MAX_SOURCE_PIXELS` AND `isWideGamutSource`). sRGB sources are unaffected (they are not wide-gamut and skip the rgb16 path). Sources below the pixel cap are unaffected (they use the original file which retains its ICC profile).

**Root cause:** The temporary intermediate file is treated as a throwaway resize step, but it becomes the input for the entire color pipeline. The ICC profile must survive the downscale step.

**Fix:** Preserve the ICC profile in the temporary file:

```ts
await sharp(inputPath, { limitInputPixels: maxInputPixels, failOn: 'error', sequentialRead: true, autoOrient: true })
    .resize({ width: targetWidth, withoutEnlargement: true })
    .withIccProfile(iccProfileName || 'srgb')
    .toFile(tmpPath);
```

Alternatively, avoid the temporary file entirely by passing the original path and a `resizeWidth` cap to `generateForFormat`, letting each format path handle its own resize. This eliminates the ICC-loss risk but requires refactoring the pipeline to accept a max-width constraint instead of a pre-downscaled file.

**Workaround until fix:** Increase `wide_gamut_max_source_pixels` above the pixel count of any uploaded image, disabling the downscale path entirely. Monitor memory usage to ensure the rgb16 pipeline does not OOM.

---

### R10-H2 [HIGH] — Permanently failed images invisible to admin; processing errors logged only to console

**Files:** `apps/web/src/lib/image-queue.ts:435-450`, `apps/web/src/lib/image-queue.ts:451-478`
**Confidence:** Confirmed by tracing error path
**Impact:** When an image fails processing after 3 retries, it is added to `permanentlyFailedIds` and excluded from future bootstrap scans. The image row in the database remains `processed = false` forever. The admin dashboard shows it as "pending" with no indication of failure. The photographer cannot retry, diagnose, or clean up failed uploads.

**Evidence:**

In `enqueueImageProcessing` (lines 435-450):
```ts
} catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Background processing failed for ${job.id}`, err);
    state.lastErrors.set(job.id, errorMsg);
    const retries = (state.retryCounts.get(job.id) || 0) + 1;
    if (retries < MAX_RETRIES) {
        // retry...
    }
    // ... permanently failed
    state.permanentlyFailedIds.add(job.id);
```

The `lastErrors` Map is in process memory and lost on restart. The `permanentlyFailedIds` Set is also in memory. Neither is persisted to the database. There is no `processing_error` or `failed_at` column in the `images` table schema.

The admin dashboard queries `images` with `processed = false`. A permanently failed image looks identical to a freshly uploaded image waiting in the queue.

**Fix:** Add `processing_error` (varchar or text) and `failed_at` (timestamp) columns to the `images` table. Update them when `MAX_RETRIES` is exceeded. Clear them on successful processing or when the admin manually retries. Surface the error in the admin dashboard with a "Retry" button.

Schema addition:
```ts
processing_error: varchar('processing_error', { length: 512 }),
failed_at: datetime('failed_at', { mode: 'string' }),
```

Update sites:
- `image-queue.ts:449` — set `processing_error` and `failed_at` before adding to `permanentlyFailedIds`
- `image-queue.ts:366-368` — clear `processing_error` and `failed_at` on successful `processed=true` update
- Admin dashboard — show failed images in a separate section with error text and retry action

---

### R10-M1 [MEDIUM] — ETag changes immediately on settings flip, but file bytes remain stale (R9-M2 carryover)

**Files:** `apps/web/src/lib/serve-upload.ts:110-112`, `apps/web/src/lib/settings-hash.ts:62-78`
**Confidence:** Confirmed by tracing ETag formula (unchanged since R9)
**Impact:** Admin changes a color-impacting setting (e.g., `wide_gamut_jpeg_chroma`). ETag changes immediately for all images. Clients revalidate, get `200 OK` with OLD bytes under NEW ETag. Photographer's color fix is invisible until backfill completes. Client downloads the image twice for one settings change.

**Evidence:**

```ts
// serve-upload.ts:110-112
const config = await getGalleryConfig();
const settingsHash = await getColorSettingsHash(config);
const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`;
```

`settingsHash` reflects current `GalleryConfig` values. It does NOT reflect the settings that produced the file on disk. `mtimeMs` only changes when backfill rewrites the file.

Sequence:
1. File encoded with `chroma=4:2:0`. ETag: `v6-T1-S1-hash(4:2:0)`.
2. Admin changes to `chroma=4:4:4`. ETag becomes `v6-T1-S1-hash(4:4:4)` → different → `200` with OLD bytes.
3. Client caches old bytes under new ETag.
4. Backfill rewrites file. mtime changes to T2. ETag: `v6-T2-S2-hash(4:4:4)` → different again → `200` with NEW bytes.
5. Client downloads twice, and had wrong colors in between.

**Fix options (unchanged from R9 recommendation):**

1. **Per-image `encode_settings_hash`** (schema + migration + encoder change): Store a hash of the actual settings used at encode time. Include this in ETag instead of live global hash.
2. **UI warning** (lightweight): Admin settings UI displays: "Changing this setting requires running the backfill script before existing images reflect the new encoding."
3. **Pipeline version bump on settings change** (heavyweight): Require a manual pipeline version bump (and deploy) for any settings change that affects encoded bytes. This forces cache invalidation only when files are actually re-encoded.

**Recommended:** Implement option 2 (UI warning) immediately. Schedule option 1 for next schema migration.

---

### R10-M2 [MEDIUM] — JPEG chroma subsampling decision uses source gamut, not target gamut

**Files:** `apps/web/src/lib/process-image.ts:917-923`
**Confidence:** Confirmed by code path analysis
**Impact:** When `force_srgb_derivatives=true`, wide-gamut sources are converted to sRGB but still receive the `wide_gamut_jpeg_chroma` setting (default 4:4:4) instead of the `sdr_jpeg_chroma` setting (default 4:2:0). A photographer who sets `sdr_jpeg_chroma=4:2:0` to save space on sRGB output gets 4:4:4 files for wide-gamut sources forced to sRGB.

**Evidence:**

```ts
// process-image.ts:740-744
const targetIcc = (isWideGamutSource && !forceSrgbDerivatives) ? 'p3' : 'srgb';
// ...
// process-image.ts:917-923
await base
    .toColorspace(targetIcc)
    .withIccProfile(targetIcc)
    .jpeg({
        quality: qualityJpeg,
        chromaSubsampling: isWideGamutSource ? effectiveChroma : effectiveSdrChroma,
    })
```

`isWideGamutSource` is based on the SOURCE ICC (line 737: `avifDecision === 'p3' || avifDecision === 'p3-from-wide'`). It is `true` regardless of `forceSrgbDerivatives`. So even when `targetIcc` is `'srgb'`, the chroma subsampling uses `effectiveChroma` (wide-gamut default 4:4:4).

The photographer's mental model: "I forced sRGB derivatives, so my JPEGs are sRGB and should use the SDR chroma setting." The actual behavior: "Your JPEGs are sRGB but still use the wide-gamut chroma setting."

**Fix:** Change the chroma decision to use `targetIcc` instead of `isWideGamutSource`:

```ts
chromaSubsampling: targetIcc === 'p3' ? effectiveChroma : effectiveSdrChroma,
```

This ensures sRGB-targeted JPEGs (whether from native sRGB sources or forced-sRGB wide-gamut sources) use the SDR chroma setting.

---

### R10-M3 [MEDIUM] — No copyright, artist, or image description extracted from EXIF/IPTC

**Files:** `apps/web/src/lib/process-image.ts:1053-1161` (`extractExifForDb`), `apps/web/src/db/schema.ts`
**Confidence:** Confirmed by inspection of extracted fields
**Impact:** Photographers who embed copyright notices, artist names, or image descriptions in their EXIF/IPTC metadata lose that information in the gallery. There is no `copyright`, `artist`, or `image_description` column in the schema. The photographer must manually re-enter titles and descriptions.

**Evidence:**

`extractExifForDb` extracts: capture_date, camera_model, lens_model, iso, f_number, exposure_time, focal_length, latitude, longitude, color_space, white_balance, metering_mode, exposure_compensation, exposure_program, flash.

Missing standard EXIF fields:
- `ImageDescription` (0x010E) — often contains the photographer's caption
- `Artist` (0x013B) — photographer name
- `Copyright` (0x8298) — copyright notice
- `UserComment` (0x9286) — additional notes
- `XPKeywords`, `XPSubject` — Windows Explorer metadata

The `extractExifForDb` function has `cleanMetadataString` (255-byte clamp) which could safely store these values. The schema would need new nullable varchar columns.

**Fix:** Add columns to `images` table and extract logic:

```ts
// schema.ts additions
exif_artist: varchar('exif_artist', { length: 255 }),
exif_copyright: varchar('exif_copyright', { length: 255 }),
exif_description: varchar('exif_description', { length: 255 }),
```

```ts
// extractExifForDb additions
camera_model: cleanString(imageParams.Model) || undefined,
exif_artist: cleanString(imageParams.Artist),
exif_copyright: cleanString(imageParams.Copyright),
exif_description: cleanString(imageParams.ImageDescription),
```

Surface `exif_description` as a default value when `title` is empty (with admin opt-in).

---

### R10-M4 [MEDIUM] — GPS strip modifies the "original" file in-place, violating preservation promise

**Files:** `apps/web/src/app/actions/images.ts:313-319`, `apps/web/src/lib/process-image.ts:1184-1209`
**Confidence:** Confirmed by code path
**Impact:** When `strip_gps_on_upload=true`, the original file at `data/uploads/original/` is rewritten by `stripGpsFromOriginal()`, which strips ALL EXIF metadata except orientation and ICC. The photographer's "preserved original" is no longer the original bytes they uploaded. Copyright, artist, and other metadata are silently removed from the preserved file.

**Evidence:**

```ts
// process-image.ts:1195-1197
await sharp(filePath)
    .withMetadata({ orientation, icc: meta.icc as string | undefined })
    .toFile(tmpPath);
```

The `.withMetadata({ orientation, icc })` call tells Sharp to keep ONLY orientation and ICC, stripping everything else. This includes GPS, copyright, artist, maker notes, and all other EXIF tags.

The documentation says "Originals are kept" and "Original saved to the private upload store." But `stripGpsOnUpload` silently rewrites the original with a stripped version.

**Fix options:**

1. **Preserve true original, strip GPS only from derivatives** (recommended): Do not modify the original file. Strip GPS only from the WebP/AVIF/JPEG derivatives (which already have no EXIF except ICC). The `withMetadata({ orientation, icc })` logic already runs during derivative encoding. Move the GPS strip to the derivative pipeline.

2. **Two originals**: Save both the true original and the GPS-stripped version. The download-original endpoint serves the stripped version. This doubles storage.

3. **Document the behavior**: Add a prominent warning in the admin UI: "When enabled, the preserved original file is rewritten with GPS and all non-ICC metadata removed."

**Recommended:** Option 1. The derivatives already strip everything except ICC. GPS is already not present in the public-facing files. The only leak vector is the download-original endpoint, which should serve a metadata-stripped copy on-the-fly rather than modifying the stored original.

---

### R10-L1 [LOW] — Quality settings not calibrated across formats; no perceptual equivalence guidance

**Files:** `apps/web/src/lib/gallery-config-shared.ts:86-89`
**Confidence:** By design, but lacks photographer guidance
**Impact:** The admin sees three quality sliders (WebP 90, AVIF 85, JPEG 90) with no explanation of how they relate. AVIF quality 85 typically produces higher visual quality than JPEG quality 90 due to superior compression. A photographer might set all three to 90 and wonder why AVIF files are 3x larger than necessary, or set AVIF to 70 and get worse quality than JPEG 90.

**Evidence:**

```ts
// gallery-config-shared.ts:86-89
image_quality_webp: '90',
image_quality_avif: '85',
image_quality_jpeg: '90',
```

Sharp's `quality` parameter maps to different encoder scales:
- WebP: libwebp quality (0-100), roughly matches JPEG quality at same value
- AVIF: libheif quality (0-100), significantly better compression than JPEG at same value
- JPEG: libjpeg quality (0-100), baseline for comparison

There is no UI text explaining that AVIF 85 is roughly equivalent to JPEG 95 in perceptual quality, or that effort 6 adds ~30% CPU for ~10% size reduction.

**Fix:** Add admin UI tooltip text:
- "AVIF quality 85 is roughly equivalent to JPEG 95 in visual quality due to superior compression."
- "AVIF effort 6 is a balanced setting. Higher effort = smaller files but slower encoding."
- "JPEG quality 90 with 4:2:0 chroma is suitable for web. Use 4:4:4 chroma for maximum fidelity."

---

### R10-L2 [LOW] — No 5K or 8K size variant for modern high-DPI displays

**Files:** `apps/web/src/lib/gallery-config-shared.ts:80`
**Confidence:** Feature gap
**Impact:** The default size ladder is 640, 1536, 2048, 4096. A 5K iMac (5120px) or 8K display (7680px) must use the 4096px variant or download the original. The 4096px variant is adequate for most displays but leaves a gap for ultra-high-resolution screens. The original is available for download but not served as a responsive variant.

**Evidence:**

```ts
const DEFAULT_IMAGE_SIZE_VALUES = [640, 1536, 2048, 4096] as const;
```

Modern display resolutions:
- 27" 5K iMac: 5120 x 2880
- 32" 8K monitor: 7680 x 4320
- iPhone 15 Pro Max viewport at 460 ppi: up to ~1290px logical, but physical pixels are higher

The gap between 4096 and "original" is unaddressed. For photographers showcasing on 5K/8K displays, the 4096px variant is visibly softer than the original.

**Fix:** Add 5120 and/or 7680 as configurable size options (up to `MAX_IMAGE_SIZE_COUNT = 8`). The admin can opt in to larger variants for galleries targeting high-DPI displays.

---

### R10-L3 [LOW] — Blur placeholder preserves source colorspace; brief color flash possible on P3 sources

**Files:** `apps/web/src/lib/process-image.ts:637-662`
**Confidence:** Theoretical; unconfirmed in practice
**Impact:** The blur placeholder is generated from the original image without colorspace conversion:

```ts
const blurBuffer = await image.clone()
    .resize(16, undefined, { fit: 'inside' })
    .blur(2)
    .jpeg({ quality: 40 })
    .toBuffer();
```

No `.toColorspace('srgb')` is applied. For P3 sources, the blur data URL contains P3 pixel values. When rendered as a CSS `background-image`, most browsers interpret data URIs as sRGB unless explicitly tagged. This could cause a brief color shift when the full P3-tagged image loads and replaces the placeholder.

**Mitigation:** The blur is 16px and heavily blurred, so any color difference is imperceptible in practice. This is a theoretical correctness issue.

**Fix:** Add `.toColorspace('srgb')` to the blur pipeline for consistent behavior across all sources:

```ts
const blurBuffer = await image.clone()
    .resize(16, undefined, { fit: 'inside' })
    .blur(2)
    .toColorspace('srgb')
    .jpeg({ quality: 40 })
    .toBuffer();
```

---

### R10-L4 [LOW] — `force_srgb_derivatives` name implies all formats, but AVIF remains gamut-preserved

**Files:** `apps/web/src/lib/gallery-config-shared.ts:106`, `apps/web/src/lib/process-image.ts:739-744`
**Confidence:** Documented behavior, but naming is confusing
**Impact:** The setting name `force_srgb_derivatives` suggests ALL derivatives (AVIF, WebP, JPEG) become sRGB. The actual behavior is: WebP and JPEG become sRGB; AVIF remains gamut-preserved. Admin confusion is possible.

**Evidence:**

```ts
// process-image.ts:739-744
const avifIcc = isWideGamutSource ? 'p3' : 'srgb';  // NOT affected by forceSrgbDerivatives
const targetIcc = (isWideGamutSource && !forceSrgbDerivatives) ? 'p3' : 'srgb';  // affects WebP/JPEG
```

The `CLAUDE.md` documents this explicitly: "When ON, WebP/JPEG are sRGB regardless of source. AVIF still gamut-preserved." But the setting name in the admin UI does not convey this.

**Fix:** Rename the admin UI label from "Force sRGB derivatives" to "Force sRGB on WebP/JPEG (AVIF remains gamut-preserved)" or add a subtitle explaining the AVIF exception.

---

### R10-L5 [LOW] — Partial encode failures during backfill can leave orphaned sized variants

**Files:** `apps/web/src/lib/process-image.ts:795-963`
**Confidence:** Confirmed by code path
**Impact:** If `generateForFormat` fails mid-way (e.g., during the 4096px encode after successfully writing 640/1536/2048px variants), the prior sizes remain on disk. The error propagates to `image-queue.ts` which verifies only base files. Sized variants from a partial run are orphaned.

**Evidence:**

`generateForFormat` writes sized variants in a loop. There is no cleanup of partial outputs on failure. The `try/finally` in `processImageFormats` (lines 966-988) only cleans up the downscaled intermediate (`processingInputPath`), not the output variants.

During backfill, these orphaned variants accumulate if errors are frequent. They are never referenced (because the image is not marked `processed=true`) but they consume disk space.

**Fix:** In `processImageFormats`, wrap the loop in a try/catch that deletes all output files for this format on failure:

```ts
try {
    for (const size of sortedSizes) {
        // ... generate ...
    }
} catch (err) {
    // Clean up partial outputs for this format
    for (const size of sortedSizes) {
        const sizedPath = path.join(dir, `${name}_${size}${ext}`);
        await fs.unlink(sizedPath).catch(() => {});
    }
    await fs.unlink(path.join(dir, baseFilename)).catch(() => {});
    throw err;
}
```

---

## Positive Observations

1. **10-bit AVIF probe is robust** — Promise singleton, 3 retries with exponential backoff, per-image fallback to 8-bit. The wide-gamut path properly gates 10-bit and fails safely.
2. **Per-format fresh Sharp instances** — Every parallel encode gets its own libvips context, eliminating cross-format contamination (R8-R8 fixed).
3. **Atomic rename for base filenames** — The `link`/`rename` fallback chain prevents 404s during concurrent reads/writes.
4. **NCLX precedence over ICC** — `color-detection.ts:359-363` correctly applies NCLX-derived values before falling back to ICC heuristics.
5. **DCI-P3 Bradford adaptation** — `toColorspace('p3')` handles the D63→D65 white-point shift when the source ICC is preserved.
6. **Settings hash uses validated values** — `settings-hash.ts:65-78` builds from resolved `GalleryConfig`, not raw DB strings (R8-R2 fixed).
7. **Blur data URL contract enforced end-to-end** — Producer wraps through `assertBlurDataUrl`, consumer validates with `isSafeBlurDataUrl`, tests lock the wiring.
8. **Advisory locks serialize concurrent operations** — Per-image processing claims, backfill serialization, and upload-contract changes are all properly locked.
9. **Conditional UPDATE prevents delete-while-processing races** — `WHERE processed = false` ensures the losing worker detects deletion.

---

## Encoder Correctness Matrix (Updated)

### ICC-Tagged Output by Format

| Source | AVIF ICC | AVIF Bit Depth | WebP ICC | JPEG ICC | JPEG Chroma | Resize Space | Notes |
|--------|----------|----------------|----------|----------|-------------|--------------|-------|
| sRGB | sRGB | 8-bit | sRGB | sRGB | 4:2:0 (SDR default) | gamma-8 | — |
| Display P3 / P3-D65 | P3 | 10-bit (if probe ok) | P3 | P3 | 4:4:4 (or SDR if forced) | rgb16 | See R10-L4 naming |
| DCI-P3 | P3 | 10-bit (if probe ok) | P3 | P3 | 4:4:4 (or SDR if forced) | gamma (DCI-P3) | Bradford D65 adaptation |
| Adobe RGB | P3 | 10-bit (if probe ok) | P3/sRGB | P3/sRGB | 4:4:4 (or SDR if forced) | rgb16 | See R10-M2 chroma |
| ProPhoto RGB | P3 | 10-bit (if probe ok) | P3/sRGB | P3/sRGB | 4:4:4 (or SDR if forced) | rgb16 | See R10-M2 chroma |
| Rec.2020 / BT.2020 | P3 | 10-bit (if probe ok) | P3/sRGB | P3/sRGB | 4:4:4 (or SDR if forced) | rgb16 | See R10-M2 chroma |
| Unknown / no ICC | sRGB | 8-bit | sRGB | sRGB | 4:2:0 | gamma-8 | — |
| >50MP wide-gamut | **SEE R10-H1** | **SEE R10-H1** | **SEE R10-H1** | **SEE R10-H1** | **SEE R10-H1** | **SEE R10-H1** | ICC lost on downscale |

### Delivery Honesty Checklist

| Scenario | Behavior | Correct? |
|----------|----------|----------|
| P3 browser + P3 display | P3-tagged AVIF delivered, P3 ICC applied | Yes |
| sRGB browser + P3 display | P3-tagged JPEG loaded, display clips to sRGB | Yes (expected) |
| Firefox + P3 display | AVIF delivered, P3 rendered | Yes (FF 124+ supports AVIF P3) |
| `forceSrgbDerivatives=true` | WebP/JPEG sRGB, AVIF P3 | Yes (documented) |
| HDR source + SDR delivery | Rejected at upload (default) or tone-mapped to SDR | Yes (honest) |
| Apple HDR gain map | SDR base delivered, gain map not transcoded | Yes (documented) |
| Custom monitor profile | ICC chromaticity detection rescues known gamuts | Yes |
| >50MP wide-gamut source | Downscaled before rgb16 pipeline | **See R10-H1** |

---

## Recommended Priority Order

| Rank | Finding | Effort | Impact |
|------|---------|--------|--------|
| 1 | R10-H1: WI-15 ICC preservation | Small (1 line) | Color accuracy for large wide-gamut sources |
| 2 | R10-H2: Failed image visibility | Medium (schema + UI) | Admin operational awareness |
| 3 | R10-M1: ETag staleness UI warning | Tiny (copy only) | Photographer confidence |
| 4 | R10-M2: Chroma subsampling target-based | Small (1 line) | Consistent with photographer intent |
| 5 | R10-M4: GPS strip modifies original | Medium (refactor strip logic) | Preserves "original" promise |
| 6 | R10-M3: EXIF copyright/artist | Small (schema + extract) | Metadata preservation |
| 7 | R10-M1 (long-term): Per-image encode hash | Medium (schema + migration) | Eliminates stale-color cache |
| 8+ | All LOW findings | Tiny–Small | Polish and documentation |

---

*End of R10 encoder/delivery review.*
