# Internal Formats Review (R3)

**Date:** 2026-05-08
**Premise:** photos arrive AFTER editing. Internal AVIF / WebP / JPEG variants must preserve the photographer's intent through every supported delivery path.
**Scope:** AVIF / WebP / JPEG bit-depth, ICC embedding, encoder paths, delivery format selection, browser format support, file-size trade-offs.

---

## 0. Format inventory

For every uploaded image (post-processing), the following derivatives are written:

```
public/uploads/avif/<uuid>_<size>.avif    (per imageSizes, e.g. 640, 1536, 2048, 4096)
public/uploads/avif/<uuid>.avif           (largest size, used as base)
public/uploads/webp/<uuid>_<size>.webp
public/uploads/webp/<uuid>.webp
public/uploads/jpeg/<uuid>_<size>.jpg
public/uploads/jpeg/<uuid>.jpg
data/uploads/original/<uuid>.<orig-ext>   (private — never served publicly)
```

`<size>` ladder is admin-configurable up to 8 sizes; default `[640, 1536, 2048, 4096]`.

`_hdr.avif` is **referenced** in the photo-viewer download menu but **never written**.

---

## 1. Encoder paths per format

### 1.1 AVIF

| Source | bit depth | colorspace | ICC tag | chroma |
|---|---|---|---|---|
| sRGB | 8-bit | sRGB | sRGB IEC61966-2.1 | 4:2:0 default |
| Display P3 / DCI-P3 / P3-D65 | 10-bit (probe) / 8-bit (fallback) | P3 | Apple Display P3 | 4:2:0 default |
| Adobe RGB / ProPhoto / Rec.2020 | 10-bit (probe) / 8-bit (fallback) | P3 (rgb16 → P3) | Apple Display P3 | 4:2:0 default |
| PQ HEIF (no ICC) | 8-bit (silent miscolor — see hdr-workflow.md HW-CRIT-2) | sRGB | sRGB | 4:2:0 default |
| Unknown / no ICC | 8-bit | sRGB | sRGB | 4:2:0 default |

`effort: 6`, `quality: 85` default.

### 1.2 WebP

| Source | bit depth | colorspace | ICC tag |
|---|---|---|---|
| sRGB | 8-bit | sRGB | sRGB |
| Display P3 / DCI-P3 / P3-D65 | 8-bit | P3 (rgb16 → P3 for non-DCI; clone+toColorspace for DCI) | Apple Display P3 |
| Adobe RGB / ProPhoto / Rec.2020 | 8-bit | P3 (rgb16 → P3) | Apple Display P3 |
| `force_srgb_derivatives=true` (any source) | 8-bit | sRGB | sRGB |
| PQ HEIF | 8-bit | sRGB | sRGB |

`quality: 90`. WebP does not support 10-bit.

### 1.3 JPEG

| Source | bit depth | colorspace | ICC tag | chroma subsampling |
|---|---|---|---|---|
| sRGB | 8-bit | sRGB | sRGB | Sharp default (4:2:0) |
| Display P3 / DCI-P3 | 8-bit | P3 | Apple Display P3 | **4:4:4** |
| Adobe RGB / ProPhoto / Rec.2020 | 8-bit | P3 | Apple Display P3 | **4:4:4** |
| `force_srgb_derivatives=true` (any source) | 8-bit | sRGB | sRGB | Sharp default |
| PQ HEIF | 8-bit | sRGB | sRGB | Sharp default |

`quality: 90`. 4:4:4 chroma for wide-gamut sources costs ~20-30% file size but preserves saturated hues that 4:2:0 would smear.

---

## 2. HIGH findings

### IF-HIGH-1 — `_hdr.avif` filename convention is hard-coded as a regex replace

**Code:** `photo-viewer.tsx:189`:

```ts
const hdrAvifFilename = image?.filename_avif ? image.filename_avif.replace(/\.avif$/i, '_hdr.avif') : null;
```

**Problems:**

1. The convention is duplicated wherever HDR variants are referenced (today: only photo-viewer download menu).
2. There is no helper / constant for "given a base AVIF filename, produce the HDR variant name."
3. When WI-09 ships and writes `_hdr.avif` files, the encoder-side filename construction MUST match this regex. A future filename-scheme change (e.g. `_hdr_<size>.avif` per-size variant) would have to find every replace site.

**Fix shape:** add a `lib/hdr-filenames.ts` helper:

```ts
export function deriveHdrAvifFilename(avifFilename: string): string {
  return avifFilename.replace(/\.avif$/i, '_hdr.avif');
}
```

Use everywhere. Single source of truth.

**Severity:** HIGH for maintainability when WI-09 lands; LOW today.

---

### IF-HIGH-2 — `withIccProfile('p3')` ships Apple's Display P3 ICC over a possibly-different source

**Code:** `process-image.ts:744-803`. Sharp's `.withIccProfile('p3')` resolves to a built-in Display P3 ICC profile (Apple's ColorSync version). For DCI-P3 sources, the white-point is shifted to D65 by `toColorspace('p3')`'s Bradford adaptation. The ICC tag is therefore Display P3 — accurate for the delivered pixels.

For Adobe RGB / ProPhoto / Rec.2020 sources, `pipelineColorspace('rgb16') → toColorspace('p3') → withIccProfile('p3')`. The pixels are gamut-mapped (relative-colorimetric clip) to P3; the ICC tag is Display P3. The audit decision label says "p3-from-{adobergb,prophoto,rec2020}".

For pure Display P3 source, no transform; ICC tag is Display P3. The audit label says "p3-from-displayp3".

**Concern:** the embedded ICC is always Apple's Display P3. There's no path to embed a "neutral" Display P3 ICC (e.g., `Display P3 D65` per SMPTE EG 432-1). This is a Sharp / libvips limitation. For most consumers (Safari, Chrome, Firefox) the Apple ICC works correctly — they read the chromaticities and tone-response and color-manage. For some specialized consumers (older photo-management apps, pro printers), the ICC name "Display P3" may be hard-coded as Apple-equivalent and they expect specific ICC v2 vs v4 differences.

**Photographer-intent impact:** marginal. Most consumers handle the Apple Display P3 ICC correctly.

**Fix shape:** none required for v1. Document the limitation. If a future use case demands a non-Apple Display P3 ICC, add a custom ICC payload via `withIccProfile(buffer)`.

**Severity:** LOW (informational).

---

## 3. MED findings

### IF-MED-1 — DCI-P3 `p3-from-dcip3` audit label vs. delivered-as-Display-P3

Cross-reference: color-fidelity.md CF-HIGH-5.

The label says "p3-from-dcip3" / "P3 (from DCI-P3)". The delivered ICC is Display P3 (D65). Photographer reads "from DCI-P3" and may believe the delivery is also DCI white-point. It isn't (it's correctly D65-adapted).

**Fix shape:** humanizer label rewrite:
- `'p3-from-dcip3'` → "Display P3 (D65, from DCI-P3 source)" — explicit.

**Severity:** MED (label-only).

---

### IF-MED-2 — JPEG `chromaSubsampling: '4:4:4'` for wide-gamut is hard-coded; no admin override

**Code:** `process-image.ts:798-803`:

```ts
.jpeg({
    quality: qualityJpeg,
    ...(isWideGamutSource ? { chromaSubsampling: '4:4:4' as const } : {}),
})
```

4:4:4 chroma for wide-gamut JPEG is the right default — preserves saturated hues. But the file-size cost is +20-30% vs 4:2:0. For an operator with bandwidth constraints (very large gallery, slow CDN) this is non-trivial.

**Fix shape:** admin setting `wide_gamut_jpeg_chroma` with values `'4:4:4' | '4:2:2' | '4:2:0'`, default `'4:4:4'`.

**Severity:** MED (operator flexibility).

---

### IF-MED-3 — `_cachedSupportsCanvasP3` MQ-based gate; fragile across browsers and sessions

Cross-reference: color-fidelity.md CF-HIGH-4.

**Code:** `histogram.tsx:55-57`. Module-evaluated, MQ-based. Firefox always false (Mozilla bug 1591455). External monitor swap mid-session not detected.

**Fix shape:** runtime canvas-P3 feature probe (see CF-HIGH-4 fix). Cache after first probe.

**Severity:** HIGH per color-fidelity track; MED here for the format-correctness angle (the bytes are correct; the histogram visualization is degraded for Firefox users).

---

### IF-MED-4 — AVIF `effort: 6` not admin-tunable

**Code:** `process-image.ts:769`:

```ts
.avif({
    quality: qualityAvif,
    effort: 6,
    ...(wantHighBitdepth ? { bitdepth: 10 } : {}),
})
```

`effort: 6` is reasonable middle-ground. Effort 4 is ~40% faster, ~5% larger; effort 9 is ~3× slower, ~5% smaller. For an operator with 10k photos backlog, effort 4 is meaningful throughput; for a small gallery effort 6 is fine.

**Fix shape:** admin setting `avif_effort` (4-9), default 6.

**Severity:** MED (operator flexibility).

---

### IF-MED-5 — No "delivered formats" surface in the EXIF panel

**Code:** none — surface does not exist.

The EXIF panel shows "Format: heif" (the original). It doesn't say "Delivered: AVIF, WebP, JPEG (sRGB)" or similar. For a photographer auditing their gallery, this is missing.

**Fix shape:** add a row to the Color Details accordion:

```
Delivered    AVIF (P3, 10-bit)   WebP (P3, 8-bit)   JPEG (P3, 8-bit, 4:4:4)
```

Or compactly:

```
Delivered    P3 AVIF · WebP · JPEG (10/8/8-bit)
```

**Severity:** MED (audit completeness).

---

## 4. LOW findings

### IF-LOW-1 — `IMAGE_PIPELINE_VERSION` history docstring stops at v3

**Code:** `process-image.ts:99-108`:

```
History:
   2 — first versioned cut: failOn:'error', autoOrient, ETag-based cache, …
   3 — perf + bit-depth tuning: pipelineColorspace('rgb16') for wide-gamut, …
```

Then `export const IMAGE_PIPELINE_VERSION = 5;`. v4 and v5 are undocumented in the changelog.

**Fix shape:** continue the history:
```
   4 — Phase 1: P3-tagged WebP/JPEG when source is wide-gamut (force_srgb_derivatives override).
   5 — Phase 2 + WI-12: AdobeRGB/ProPhoto/Rec.2020 → P3 via rgb16 pipeline; DCI-P3 → Display P3 D65 via Bradford.
```

**Severity:** LOW (docs hygiene).

---

### IF-LOW-2 — WebP / JPEG quality not differentiated for wide-gamut

`qualityWebp = 90`, `qualityJpeg = 90` regardless of source gamut. For a wide-gamut source delivered as 8-bit P3 JPEG, the quantization noise floor is higher than sRGB-into-sRGB. Photographer may perceive "same quality setting, slightly worse color." A higher default for wide-gamut (`qualityJpeg = 92` for wide-gamut, `90` for sRGB) would compensate.

**Fix shape:** quality-by-gamut admin setting bundle. Or auto-select.

**Severity:** LOW (visual delta minimal).

---

### IF-LOW-3 — JPEG `4:4:4` chroma applies even to `force_srgb_derivatives=true` sources

**Code:** `process-image.ts:801`:

```ts
...(isWideGamutSource ? { chromaSubsampling: '4:4:4' as const } : {}),
```

`isWideGamutSource` is true for any P3+ source even when `forceSrgbDerivatives=true`. The JPEG is sRGB-tagged but still 4:4:4 chroma. This is correct (the 4:4:4 reasoning is "the source has saturated hues; preserve them" — independent of target gamut). But it's an undocumented coupling.

**Fix shape:** none; document.

**Severity:** LOW.

---

### IF-LOW-4 — No JPEG XL output

JPEG XL has Safari 17+ support, Chrome 145+ behind a flag. For a gallery that wants to be future-proof, adding JPEG XL as a 4th derivative would let early-adopter visitors see the smallest possible file. Today's tier: AVIF → WebP → JPEG. Tomorrow: JXL → AVIF → WebP → JPEG.

**Fix shape:** out of scope for this iteration. Track as a follow-up.

**Severity:** LOW.

---

## 5. Browser × format support matrix

| Browser | OS | AVIF | WebP | JPEG | JPEG XL | 10-bit AVIF |
|---|---|---|---|---|---|---|
| Safari 17+ | macOS / iOS | ✓ | ✓ | ✓ | ✓ | ✓ |
| Chrome 122+ | macOS / Win / Linux | ✓ | ✓ | ✓ | flag | ✓ |
| Edge 122+ | Windows | ✓ | ✓ | ✓ | flag | ✓ |
| Firefox 124+ | macOS / Win / Linux | ✓ (Firefox 113+) | ✓ | ✓ | ✗ | ✓ |
| Chrome | Android 14+ | ✓ | ✓ | ✓ | flag | ✓ |
| Safari | iOS 16- | ✗ (16+) | ✓ | ✓ | ✗ | ✗ |
| IE / legacy | — | ✗ | ✗ | ✓ | ✗ | ✗ |

`<picture>` source order in the encoder ensures graceful degradation: AVIF first, WebP fallback, JPEG fallback. 10-bit AVIF is decoded transparently by all modern browsers (rendered with banding-free quality).

**Photographer-intent impact:** this matrix is correct and modern. The order is right. No change needed.

---

## 6. Encoder fan-out concurrency

**Code:** `process-image.ts:847-851`:

```ts
await Promise.all([
    generateForFormat('webp', UPLOAD_DIR_WEBP, filenameWebp),
    generateForFormat('avif', UPLOAD_DIR_AVIF, filenameAvif),
    generateForFormat('jpeg', UPLOAD_DIR_JPEG, filenameJpeg),
]);
```

Three formats fan out in parallel. Sharp's per-call libvips concurrency is divided by 3 (`maxConcurrency = Math.max(1, Math.floor((cpuCount - 1) / 3))`). For a 4-core machine: each format gets 1 thread; total threads = 3.

The wide-gamut path uses `pipelineColorspace('rgb16')` which doubles the per-image RAM footprint. For a 50 MP source: ~1.1 GB peak for the rgb16 path × 3 (one per format) = ~3.3 GB peak. Memory cap (`WIDE_GAMUT_MAX_SOURCE_PIXELS = 50_000_000`) downscales sources >50 MP first → cap reduces this to ~1.1 GB.

For 100 MP sources (Sony α7R V, GFX 100): the cap kicks in. 100 MP → downscaled to 50 MP (linear 70.7%) → ~1.1 GB peak.

**Photographer-intent impact:** the cap is necessary but transparent to the photographer. The downscale is performed in the rgb16 linear-light intermediate, then resized down to the per-size variants. **The largest delivered variant is therefore not 4096-wide for >50 MP sources; it's `4096 × sqrt(50M / orig_pixels)`** — possibly smaller. Photographer expects 4096-wide on their 100 MP source; gets ~3500-wide.

**Fix shape:** pre-compute the user-facing target size and warn at upload time if the cap kicks in: "This 100 MP source will be downsized to 50 MP for processing. The largest delivered variant will be ~3500 px wide instead of 4096 px."

**Severity:** MED (photographer transparency).

---

## 7. Recommended fixes (internal-formats track)

Numbered to align with the plan in `.context/plans/38-photographer-r3-followup.md`:

1. **IF-HIGH-1** → P3-19 Extract `_hdr.avif` filename helper.
2. **IF-MED-1** → P3-7 (combined with CF-HIGH-5) DCI-P3 audit label rewrite.
3. **IF-MED-2** → P3-20 Admin setting `wide_gamut_jpeg_chroma`.
4. **IF-MED-3** → P3-6 (combined with CF-HIGH-4) Replace canvas-P3 MQ with feature probe.
5. **IF-MED-4** → P3-21 Admin setting `avif_effort`.
6. **IF-MED-5** → P3-22 "Delivered formats" row in Color Details.
7. **IF-LOW-1** → P3-23 Pipeline version history docstring update.
8. **WI-15 cap warning** → P3-24 Upload-time warning when >50 MP cap kicks in.

---

## 8. Out of scope

- JPEG XL output (track as follow-up).
- AV1 video output.
- Custom ICC profile injection.
- Per-image quality / chroma override.
- HEIC output (no consumer demand).
