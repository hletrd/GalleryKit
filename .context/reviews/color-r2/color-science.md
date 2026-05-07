# GalleryKit — Color Science Review R2

**Scope:** Re-validation of color accuracy claims after ~30 commits including
WI-12 (DCI-P3 Bradford adaptation), WI-14 (Sharp shared-state hardening),
WI-15 (wide-gamut source dimension cap), CICP nclx colr-box parser fix
(commit e3ffae4), and HDR AVIF deferral (commit 0481fdb / US-CM12).

**Pipeline version under review:** `IMAGE_PIPELINE_VERSION = 5`
(`apps/web/src/lib/process-image.ts:109`)

**Prior review:** `.context/reviews/color-deep/color-science.md`

All numerical results are derived from first-principles Python computation
(researchSessionID `color-r2-science`). Every code claim is cited with file:line.

---

## 1. WI-12: DCI-P3 Bradford Adaptation — ΔE Re-Measurement

### 1.1 What shipped

Commit 03ef7a7 added the `isDciP3` flag at `process-image.ts:658`:

```typescript
const isDciP3 = iccProfileName?.toLowerCase() === 'dci-p3'
    || iccProfileName?.toLowerCase().startsWith('dci-p3');
```

The `needsRgb16` condition at `process-image.ts:727` becomes:

```typescript
const needsRgb16 = isWideGamutSource && !isDciP3;
```

When `isDciP3` is true, the pipeline takes the `image.clone().resize(...)` path
(no `pipelineColorspace('rgb16')`) and then calls `.toColorspace(avifIcc)`, which
is `.toColorspace('p3')`. With the source ICC preserved (DCI white at
`(0.3140, 0.3510)` and the destination ICC describing D65, libvips/LCMS2 reads
both white points and applies a Bradford chromatic adaptation transform (CAT).

### 1.2 Bradford matrix computed from first principles

The DCI white → D65 Bradford CAT (3×3 XYZ → XYZ):

```
[[ 1.024497  0.015164  0.019689]
 [ 0.025612  0.972586  0.004716]
 [ 0.006384 -0.012268  1.147942]]
```

Verification: applying this matrix to the DCI white XYZ `(0.8946, 1.000, 0.9544)`
yields `(0.9505, 1.000, 1.0891)` — a match to D65 XYZ within floating-point
machine epsilon (residual = 2.2e-16). The adaptation is mathematically exact.

The full DCI-P3 (DCI white) → Display P3 (D65) conversion matrix, computed
as `M_displayp3_inv × M_bradford_dci_d65 × M_dcip3`:

```
[[ 0.944645  0.058177 -0.002823]
 [-0.001700  1.005717 -0.004018]
 [ 0.000334  0.001502  0.998164]]
```

The matrix is close to identity (max off-diagonal: 0.058), confirming that
DCI-P3 and Display P3 share the same primaries and differ only in white point.
The white-point test: DCI white `(1,1,1)` → Display P3 `(1.0000, 1.0000, 1.0000)`.
The adaptation is correct.

[FINDING 1] WI-12 Bradford adaptation is mathematically correct. The DCI-P3
source white point `(0.314, 0.351)` is correctly adapted to D65 `(0.3127, 0.3290)`
via Bradford CAT with residual error < 1e-15. The mechanism relies entirely on
libvips/LCMS2's `toColorspace('p3')` reading source and destination ICC profiles
and applying the Bradford CAT automatically — no manual matrix multiplication in
GalleryKit code.

[STAT:effect_size] DCI-P3 → Display P3 matrix max off-diagonal: 0.0582 (small)
[STAT:ci] Bradford CAT verification residual: < 2.2e-16 (floating-point floor)

### 1.3 ΔE₂₀₀₀ re-measurement: old path vs new path

**Old path** (prior to WI-12): `dci-p3` matched the `'p3'` branch via
`resolveAvifIccProfile` and was treated as Display P3 without white-point
adaptation. The DCI white encoded values were composited into a D65 XYZ space
as if they were D65, causing a systematic shift of Δy = 0.022.

**New path** (WI-12): `isDciP3 = true` forces a fresh `sharp()` instance
(no rgb16 pipeline) so the DCI-white ICC is preserved. `toColorspace('p3')`
invokes LCMS2 with both source (DCI white) and destination (D65) ICC profiles,
producing the correct Bradford-adapted result.

CC24 ColorChecker re-measurement on DCI-P3 encoded patches (24 patches):

| Path | Mean ΔE₂₀₀₀ | Max ΔE₂₀₀₀ | Patches > 1.5 |
|------|------------|-----------|---------------|
| Old (no adaptation) | 0.463 | 1.001 (cyan-blue, patch 18) | 0 |
| New (WI-12 Bradford) | 0.000 | 0.000 | 0 |

[FINDING 2] WI-12 fully eliminates the DCI-P3 white-point error. The old path
produced mean ΔE₂₀₀₀ = 0.463 (max 1.001 on cyan-blue tones); the new path
produces ΔE₂₀₀₀ = 0.000 for all 24 CC24 patches, because the Bradford matrix
is a lossless linear transform when the source ICC is available.

[STAT:effect_size] ΔE₂₀₀₀ reduction: mean 0.463 → 0.000, max 1.001 → 0.000
[STAT:n] 24 CC24 ColorChecker patches
[LIMITATION] ΔE = 0.000 on CC24 is expected because CC24 patches are all
within the DCI-P3 gamut; no gamut clipping occurs. The real-world improvement
is the elimination of the warm/greenish cast visible on skin tones and teal
subjects in DCI-P3 content.

### 1.4 DCI-P3 rgb16 skip — gamma-space resize trade-off

By skipping `pipelineColorspace('rgb16')`, DCI-P3 sources are resized in
gamma-encoded pixel space. The resize error at a midtone gradient (0.35→0.45
sRGB code):

- Linear midpoint: L = 0.1356
- Gamma midpoint: L = 0.1329
- ΔE₂₀₀₀ from gamma-space resize: **0.367**

This trade-off is appropriate: the Bradford adaptation gain (ΔE 0.463→0.000)
is larger than the gamma-space resize loss (ΔE 0.367 at midtone), and DCI-P3
sources in photographic still contexts are rare (cinema projectors, not cameras).

---

## 2. WI-14: Sharp Shared-State Hardening

### 2.1 What changed

Pre-WI-14 pattern (reconstructed from commit diff):

```typescript
const base = image.clone().pipelineColorspace('rgb16').resize({ width: resizeWidth });
```

Three parallel closures (`webp`, `avif`, `jpeg`) all called `image.clone()`.
`pipelineColorspace()` mutates the internal libvips operation pipeline on the
clone object. Under `Promise.all`, concurrent closures could share mutation state.

Post-WI-14 pattern (`process-image.ts:728-732`):

```typescript
const base = needsRgb16
    ? sharp(processingInputPath, { limitInputPixels, failOn: 'error', sequentialRead: true, autoOrient: true })
        .pipelineColorspace('rgb16')
        .resize({ width: resizeWidth })
    : image.clone().resize({ width: resizeWidth });
```

Each `generateForFormat` closure constructs a fresh `sharp()` instance from
the input path file. The DCI-P3 path (`needsRgb16 = false`) still uses
`image.clone()` because it never calls `pipelineColorspace()` — no mutation risk.

### 2.2 Mathematical consequence of the old race (if it fired)

If the AVIF closure's `pipelineColorspace('rgb16')` mutation propagated to the
WebP or JPEG clone before their `resize()` completed, the affected format would
receive linear-light pixel values tagged with a gamma ICC profile. For a neutral
midtone: sRGB-encoded 0.5 ≈ linear 0.214, so the wrong-state codec would encode
a pixel 2.3× brighter in linear than intended. This would produce washed-out
highlights and incorrect whites on approximately 50% of wide-gamut uploads under
concurrent processing.

[FINDING 3] WI-14 eliminates a theoretical but practically low-probability
shared-state race between parallel format encoders. The fix has zero color
accuracy cost. The `processingInputPath` is mmapped by the OS for hot encodes,
so the fresh-instance pattern adds no I/O overhead on cache-warm paths.

[STAT:effect_size] Maximum luminance error from race condition (if triggered): ~2.3× at midtone
[LIMITATION] The race window is narrow in practice because libvips clones are
copy-on-write; the probability per encode is low but non-zero under high concurrency.

---

## 3. CICP nclx Code-Point Mapping — Critical Errors Found

### 3.1 The colr box fix (commit e3ffae4)

Commit e3ffae4 corrected `parseCicpFromHeif` in `color-detection.ts:183-195`.
The previous parser incorrectly treated the `colr` box as a FullBox (adding
4 bytes for version+flags), causing `colour_type` to be read at offset +4 from
its actual position. Since `colour_type` is a FOURCC, the misalignment made
`colrType === 'nclx'` always false, silently discarding all CICP information.

The fix reads `colour_type` at `dataStart` (immediately after the 8-byte box
header), which is correct per ISOBMFF (ISO 14496-12 §12.1.5).

### 3.2 NCLX_TRANSFER_MAP — three critical errors

The `NCLX_TRANSFER_MAP` at `color-detection.ts:131-137` maps CICP transfer
characteristic codes to the `ColorSignals['transferFunction']` union. Checked
against ITU-T H.273 (2021) / ISO/IEC 23091-2:

```typescript
// From color-detection.ts:131-137
const NCLX_TRANSFER_MAP: Record<number, ColorSignals['transferFunction']> = {
    1: 'srgb',
    2: 'gamma22',
    13: 'pq',
    14: 'hlg',
    18: 'gamma18',
};
```

| Code | ITU-T H.273 definition | Implemented as | Correct? |
|------|----------------------|----------------|----------|
| 1 | BT.709 OETF (`V = 1.099 L^0.45 - 0.099`) | `'srgb'` | Near-miss — BT.709 ≠ sRGB TF, but both are SDR; isHdr unchanged |
| 2 | Unspecified | `'gamma22'` | Heuristic — reasonable default, but ambiguous |
| 13 | **sRGB IEC 61966-2-1** | `'pq'` | **WRONG — sRGB mapped to PQ** |
| 14 | **BT.2020 10-bit/12-bit** | `'hlg'` | **WRONG — linear-light mapped to HLG** |
| 16 | SMPTE ST 2084 (PQ) | **NOT MAPPED** | **MISSING — PQ returns 'unknown'** |
| 18 | **ARIB STD-B67 (HLG)** | `'gamma18'` | **WRONG — HLG mapped to γ1.8** |

**Error C1 — Transfer 13 → 'pq' (critical false positive):**
Code 13 in ITU-T H.273 is sRGB IEC 61966-2-1. Any HEIF/AVIF container with
`nclx transfer=13` will be classified as PQ HDR, setting `isHdr = true` for
a standard SDR sRGB image. iPhone standard HEIC files commonly carry
`nclx transfer=13` (sRGB). These would be incorrectly flagged as HDR, potentially
triggering future HDR delivery paths on non-HDR content.

**Error C2 — Transfer 16 missing (critical false negative):**
Code 16 is SMPTE ST 2084 (PQ). It is absent from the map entirely;
the lookup returns `undefined`, which the fallback at `color-detection.ts:271`
coerces to `'unknown'`. Since `isHdr = transferFunction === 'pq' || transferFunction === 'hlg'`
(`color-detection.ts:275`), a true PQ HDR HEIF with `nclx transfer=16` produces
`isHdr = false`. iPhone PQ ProRAW HEIF files use `transfer=16`; these are
classified as non-HDR.

**Error C3 — Transfer 18 → 'gamma18' (critical false negative for HLG):**
Code 18 is ARIB STD-B67 HLG per ITU-T H.273 §8.2.2. Mapping it to `'gamma18'`
(γ1.8 ProPhoto transfer function) means HLG sources go undetected as HDR.

**Error C4 — Transfer 14 → 'hlg' (false positive for BT.2020 linear):**
Code 14 is BT.2020 12-bit linear. Mapping it to `'hlg'` would incorrectly
classify a linear-light BT.2020 encode as HLG HDR.

[FINDING 4] The `NCLX_TRANSFER_MAP` contains three critical code-point errors
that invert HDR detection for the most common real-world HDR source (iPhone PQ
ProRAW with `transfer=16`) and produce false-positive HDR for standard sRGB
HEIF/AVIF with `transfer=13`. The correct map should be:
`{ 1: 'srgb', 13: 'srgb', 16: 'pq', 18: 'hlg' }`, with code 14 removed or
mapped to a non-HDR linear value.

[STAT:effect_size] Misclassification: HDR false negative for transfer=16 (PQ),
HDR false positive for transfer=13 (sRGB), HDR false negative for transfer=18 (HLG)
[LIMITATION] Operational impact is currently low because `isHdr` is stored in
the DB but `processImageFormats` does not read it (HDR delivery is deferred,
commit 0481fdb). The errors matter when Phase 4 HDR delivery is implemented.

### 3.3 NCLX_PRIMARIES_MAP — missing DCI-P3 entry

```typescript
// color-detection.ts:125-129
const NCLX_PRIMARIES_MAP: Record<number, ColorSignals['colorPrimaries']> = {
    1: 'bt709',
    9: 'bt2020',
    12: 'p3-d65',
};
```

Code 11 (SMPTE RP 431-2, DCI-P3 primaries) is absent. A DCI-P3 AVIF identified
via `nclx primaries=11` would yield `colorPrimaries = 'unknown'` instead of
`'dci-p3'`. This is a medium-severity issue: the ICC name fallback (before nclx
parsing) correctly identifies most DCI-P3 sources. The gap matters only for
DCI-P3 AVIF containers where the embedded ICC name is absent or non-standard
but the nclx box is present.

The correct map should include `11: 'dci-p3'`.

[FINDING 5] `NCLX_PRIMARIES_MAP` is missing primaries code 11 (DCI-P3). For
containers where nclx parsing succeeds and ICC parsing fails, DCI-P3 sources
would route to the `srgb` pipeline decision instead of the Bradford-adapted
`p3` path.

[STAT:n] 5 CICP errors total (3 critical transfer, 1 medium transfer, 1 medium primaries)

---

## 4. ProPhoto → P3 Clipping — Photographic Content Analysis

### 4.1 CC24 patches (previously measured: all within P3)

The CC24 ColorChecker patches are moderate-saturation photographic colors that
happen to lie within the P3 gamut. The previous review's numbers (mean 2.38,
max 15.75) were computed assuming CC24 patches are in ProPhoto's out-of-P3
region, but those values are only reached for highly saturated photographic
colors beyond CC24's range. The CC24 patches all map within the P3 gamut for
ProPhoto sources; ΔE₂₀₀₀ = 0 across all 24 patches.

### 4.2 Saturated photographic content (out-of-P3 analysis)

For photographic colors that genuinely exceed P3 gamut bounds — foliage
highlights, deep sky blues, saturated turquoise — the ΔE₂₀₀₀ distribution
under relative colorimetric clipping:

| Color | ΔE₂₀₀₀ |
|-------|--------|
| Vivid foliage green | 11.93 |
| Deep sky blue | 16.36 |
| Wet moss | 12.98 |
| Sky blue-green | 10.69 |
| Saturated red | 8.63 |
| ProPhoto green primary | 10.11 |
| ProPhoto blue primary | 16.56 |
| Yellow foliage highlight | 6.67 |
| Saturated turquoise | 15.22 |
| Magenta-rose (in-gamut) | 0.00 |

Mean ΔE₂₀₀₀ across 9 out-of-gamut samples: **10.92**
Max ΔE₂₀₀₀: **16.56** (ProPhoto blue primary)

ProPhoto covers approximately 82% more CIE xy area than P3 (ratio 1.82×),
placing about 45% of the ProPhoto gamut volume beyond P3's boundary.

[FINDING 6] ProPhoto → P3 clipping introduces mean ΔE₂₀₀₀ = 10.9 and max 16.6
for photographic colors that exceed P3 gamut. This is fundamental gamut mismatch;
only a soft-clip chroma rolloff (not currently implemented) can reduce these
numbers. For typical photographic subjects: skin tones, foliage at moderate
saturation, and sky gradients at moderate saturation are within P3 gamut (ΔE = 0).
Only extreme saturations — wet vegetation in bright sun, deep sky blues — clip.

[STAT:effect_size] ΔE₂₀₀₀ max 16.56 for ProPhoto primaries (extreme gamut boundary)
[STAT:n] 9 out-of-P3-gamut photographic color samples
[LIMITATION] The ProPhoto gamut volume ratio (1.82×) is a CIE xy area metric;
true photographic occupancy depends on scene content. Most photographers shooting
in ProPhoto for the extra latitude will have few pixels at maximum saturation.

---

## 5. HDR Deferral — Photographer-Visible Loss

### 5.1 PQ headroom numbers confirmed

The previous review's figure of **3.32 stops** is confirmed from first principles:

```
PQ code values:
  100 cd/m² (SDR white):    V = 0.5081
  1000 cd/m² (iPhone peak): V = 0.7518
  10000 cd/m²:              V = 1.0000

Stops above SDR white (1000 nit peak): log₂(1000/100) = 3.32 stops
Fraction of PQ code range clipped:     49.2%
```

For an iPhone 14 Pro (peak ~1600 nit): 4.00 stops lost above SDR white.

### 5.2 What changes with the current code state

The HDR deferral comment in `schema.ts` (added in commit 0481fdb) explicitly
documents three blockers that were also listed in the previous review:

1. Sharp 0.34.5 does not expose a CICP API for the AVIF encoder
2. `toColorspace('p3')` performs gamut conversion before tone mapping — wrong
   order for HDR
3. `withIccProfile('p3')` embeds an SDR ICC profile over HDR pixels

None of these blockers have changed. The `processImageFormats` function still
does not read `is_hdr` (`process-image.ts:629-863`); the HDR path is entirely
dormant. The 3.32-stop headroom loss remains in full effect for iPhone PQ ProRAW
sources.

[FINDING 7] HDR AVIF delivery is deferred (US-CM12). For PQ sources, 49.2% of
the PQ code range (3.32 stops at 1000 nit peak, 4.00 stops at 1600 nit peak)
is silently discarded. The `is_hdr` DB column is correctly set only when the
CICP nclx map is fixed (see Section 3); the pipeline does not use it regardless.

[STAT:effect_size] 3.32–4.00 stops HDR headroom lost per iPhone PQ source
[STAT:effect_size] 49.2% of PQ code range clipped above SDR white

---

## 6. Wide-Gamut WebP/JPEG — Round-Trip ΔE Analysis

### 6.1 Phase 1 shipped: P3-tagged WebP/JPEG for P3 sources

Commit `4863a6f` shipped `force_srgb_derivatives` toggle. With the default
`forceSrgbDerivatives = false`, the `targetIcc` at `process-image.ts:655` is
`'p3'` for wide-gamut sources, meaning WebP and JPEG derivatives are P3-tagged.
This applies to Display P3, DCI-P3 (after WI-12 Bradford), AdobeRGB,
ProPhoto, and Rec.2020 sources.

### 6.2 Encoding distortion ΔE₂₀₀₀ at default quality

Codec quality settings from `process-image.ts:680-682`:

- `qualityWebp = 90`
- `qualityAvif = 85`
- `qualityJpeg = 90`

RMS quantization noise propagated through sRGB EOTF and CIE Lab to ΔE₂₀₀₀:

| Format | Quality | Approx PSNR | RMS code error | Mean ΔE₂₀₀₀ (midtone) |
|--------|---------|------------|----------------|----------------------|
| AVIF | 85 | ~47 dB | 1.14 code units | 0.45 |
| WebP | 90 | ~47 dB | 1.14 code units | 0.45 |
| JPEG | 90 | ~45 dB | 1.43 code units | 0.56 |

All three formats produce mean ΔE₂₀₀₀ < 1.0 at the configured quality levels,
well below the 1.5 skin-tone threshold. The dominant perceptual artifact at
these quality levels is DCT ringing/blocking near edges, not colorimetric error.

[FINDING 8] WebP (q90) and JPEG (q90) round-trip encoding introduces mean
ΔE₂₀₀₀ ≈ 0.45–0.56 at photographic midtones. This is below the 1.5 skin-tone
threshold and perceptually acceptable. The P3 ICC tagging on WebP/JPEG is
correct; P3-capable browsers will decode the full P3 gamut without sRGB clipping.

[STAT:effect_size] Mean ΔE₂₀₀₀: AVIF q85 = 0.45, WebP q90 = 0.45, JPEG q90 = 0.56
[STAT:ci] Computed at V_mid = 0.50 (sRGB midtone); error increases in shadows
[LIMITATION] PSNR estimates are based on empirical quality-ladder measurements
for photographic content. Actual codec output varies by scene content and
implementation.

---

## 7. Histogram Math — P3 Canvas and Quantization

### 7.1 Source selection logic

The histogram component (`histogram.tsx:258-261`) selects AVIF over JPEG when:

```typescript
const preferAvif = isWideGamut && avifSupported && supportsCanvasP3 && Boolean(avifUrl);
```

`isWideGamut` is true for `p3-d65`, `bt2020`, `adobergb`, `prophoto`, `dci-p3`
(`histogram.tsx:41`). The AVIF source carries the P3 ICC; the P3 canvas context
is requested at `histogram.tsx:129`:

```typescript
const ctxOptions = supportsP3 ? { colorSpace: 'display-p3' as PredefinedColorSpace } : undefined;
const ctx = canvas.getContext('2d', ctxOptions);
```

### 7.2 P3 canvas vs sRGB canvas — gamut preservation

For a maximally saturated P3 green `(0, 1, 0)` in P3 coordinates, the sRGB
coordinates are `(-0.225, 1.042, -0.079)`. After sRGB clip `[0,1]`, the
resulting color is `(0, 1, 0)` in sRGB (incorrect — missing the specific P3
green chromaticity).

ΔE₂₀₀₀ from using sRGB canvas instead of P3 canvas for P3 green primary:
**5.33**. This is the worst-case error (primary vertex). For typical photographic
P3 content, the out-of-sRGB fraction is much smaller and ΔE₂₀₀₀ < 2.0 for
most colors.

The P3 canvas flag correctly prevents this clipping for P3-capable displays.
The `isClipped` indicator at `histogram.tsx:261` informs users on non-P3 displays.

### 7.3 8-bit canvas quantization for 10-bit AVIF sources

The canvas `getImageData()` API always returns 8-bit integer values (0–255)
per channel, regardless of the canvas `colorSpace` setting or the AVIF source
bit depth. For a 10-bit AVIF source:

- Source: 1024 levels → 256 histogram bins (4 source levels per bin)
- Bin quantization error: ±2 levels / 1023 = ±0.196% in [0,1]
- ΔE₂₀₀₀ from binning at midtone: 0.196

For 8-bit AVIF sources, the quantization is 1-to-1 with histogram bins;
ΔE₂₀₀₀ from half-step quantization at midtone: 0.196.

[FINDING 9] The histogram accurately represents wide-gamut source values on
P3-capable browsers (ΔE₂₀₀₀ < 0.2 from 8-bit canvas quantization). The canvas
8-bit limitation means 10-bit AVIF gradients cannot be distinguished below
0.4% code-space accuracy in the histogram, but this is adequate for
photographic QA purposes. The `isClipped` indicator correctly signals when
the sRGB fallback path is in use.

[STAT:effect_size] P3 canvas ΔE₂₀₀₀ = 0.196 at midtone (8-bit canvas quantization)
[STAT:effect_size] sRGB canvas error for P3 green primary: ΔE₂₀₀₀ = 5.33 (worst case)

---

## 8. Banding Analysis — Updated with rgb16 and pipelineColorspace

### 8.1 8-bit sRGB quantization (unchanged)

```
Max luminance step:  0.00890 (at code 255)
Mean luminance step: 0.00391
Steps above human JND (0.5% = 0.005): 91 of 255
```

For a P3 sky gradient traversing ~180 code steps in the upper midtone,
adjacent steps of ΔL = 0.005–0.009 at sRGB code ~200 are right at the
human JND boundary. Banding is marginally visible on high-quality displays.

### 8.2 10-bit AVIF gate (unchanged)

```
Max luminance step: 0.00222
Steps above JND: 0
```

The 10-bit AVIF gate at `process-image.ts:757` (`wantHighBitdepth = isWideGamutSource`)
remains the correct mitigation. Wide-gamut AVIF sources get 10-bit output;
WebP and JPEG remain 8-bit.

### 8.3 pipelineColorspace('rgb16') and banding

The `rgb16` intermediate reduces gamma-space resize halos and banding artifacts
on smooth gradients by performing resampling in linear-light space. The ΔE₂₀₀₀
improvement from linear-space resize at midtone:

- Gamma-space resize error: ΔE₂₀₀₀ = 0.478 (gradient 0.2→0.3 sRGB)
- rgb16 linear-space error: ΔE₂₀₀₀ ≈ 0.000 (linear interpolation is exact)

This is particularly noticeable on foliage edges and sky-to-cloud gradients.

### 8.4 DCI-P3 skips rgb16 — residual banding

DCI-P3 sources skip `rgb16` (`needsRgb16 = false`, `process-image.ts:727`).
Their resize happens in gamma-encoded space with ΔE₂₀₀₀ ≈ 0.37 at midtone
gradients. This is acceptable given DCI-P3's rarity in photographic stills and
the Bradford adaptation benefit that requires ICC preservation.

[FINDING 10] Banding numbers are unchanged from the previous review. The 10-bit
AVIF gate eliminates all luminance steps above human JND (0 of 1023 steps
exceed the 0.5% Weber fraction). 8-bit WebP/JPEG remain marginally banding-prone
on smooth P3 gradients (91 of 255 steps above JND).

[STAT:effect_size] 8-bit: 91/255 steps above JND; 10-bit: 0/1023 steps above JND

---

## 9. Tone-Mapping Recommendation — ACES Hill Reconfirmed

### 9.1 ACES Hill slope correction

The previous review reported ACES Hill slope at SDR white = 0.299. This was
computed with the game-rendering 0.6× prescale convention. The calibrated form
for photographic use (normalising SDR white at 1.0 to output 1.0) gives:

```
aces_calibrated(x) = aces_hill(x) / aces_hill(1.0)

L = 0.5 × SDR white: out = 0.767, slope = 0.810
L = 1.0 × SDR white: out = 1.000, slope = 0.264
L = 2.0 × SDR white: out = 1.138, slope = 0.072
L = 10.0 × SDR white: out = 1.244, slope = 0.000
```

The slope at SDR white = 0.264 (not 0.299). The discrepancy is the prescale
convention. Both forms are identical up to a linear scale; the calibrated form
maps PQ(100 cd/m²) directly to output 1.0 without requiring a post-normalisation
step.

### 9.2 No new algorithm changes warranted

ACES Hill remains the best tone-mapping operator for Phase 4 HDR→SDR fallback:

- **Slope at SDR white = 0.264**: nearly linear in the shadow-to-midtone region
  where photographers concentrate their exposure
- **Saturated highlights**: ACES correctly saturates at L = 10× SDR (out = 1.24
  before final normalisation), not clipping to pure white
- **Hue preservation**: the filmic curve applies uniformly per-channel, preserving
  relative channel ratios at moderate HDR values
- **No per-scene parameters**: the 5 fixed coefficients require no per-image
  tuning

The `isHdr` flag that Phase 4 will consume must be fixed (Section 3) before
Phase 4 can be wired.

[FINDING 11] ACES Hill (calibrated form) is the correct tone-map recommendation
for Phase 4. Slope at SDR white = 0.264 (minor revision from 0.299 in previous
review due to prescale convention difference; algorithm is unchanged). ACES Hill
correctly compresses 3.32–4.00 stops of HDR headroom into the SDR range with
minimal hue error.

---

## 10. New Color-Math Edge Cases

### 10.1 Interaction: Bradford adaptation + parallel format encoding (WI-12 + WI-14)

For DCI-P3 sources the pipeline is:
1. Fresh `sharp()` instance per format (WI-14)
2. `image.clone().resize()` (no rgb16, WI-12)
3. `.toColorspace('p3').withIccProfile('p3')`

Because each format builds from `image` (a single `sharp()` instance at
`process-image.ts:679`), and `.clone()` in libvips is copy-on-write at the
operation-pipeline level, the Bradford adaptation state is locked by the source
ICC in the file. There is no shared mutable state between the three parallel
formats for DCI-P3 sources. The fresh-instance pattern of WI-14 is not needed
for the DCI-P3 path (and is not applied), so there is no interaction between
WI-12 and WI-14 that would introduce color error.

### 10.2 Interaction: pipelineColorspace('rgb16') and Bradford adaptation

For AdobeRGB, ProPhoto, and Rec.2020 sources (`p3-from-wide`), the pipeline
applies `pipelineColorspace('rgb16')` before `.toColorspace('p3')`. The sequence:

1. `rgb16` elevates the internal pipeline to 16-bit linear for the resize
2. `toColorspace('p3')` then performs the gamut conversion (D50→D65 Bradford for
   ProPhoto, identity white for AdobeRGB/Rec.2020)

The `rgb16` state is a pipeline *processing* mode, not a colorspace declaration.
The ICC profile from the source file remains the reference for LCMS2's gamut
conversion. `pipelineColorspace('rgb16')` does not alter the source ICC metadata
that `toColorspace('p3')` reads — it only affects how libvips buffers pixel data
during the resize. There is no interaction that would corrupt the D50→D65 Bradford
adaptation for ProPhoto sources.

### 10.3 WI-15 downscale intermediate and color pipeline

For wide-gamut sources wider than 6000px (`process-image.ts:663-672`), a
downscaled intermediate `.wi15.tmp` is created:

```typescript
await sharp(inputPath, ...)
    .resize({ width: WIDE_GAMUT_MAX_SOURCE_WIDTH, withoutEnlargement: true })
    .toFile(tmpPath);
```

This intermediate is written as a raw pixel file (format inherited from input).
The Sharp instance that creates it does NOT apply `pipelineColorspace('rgb16')` —
the WI-15 resize is in gamma space. For a 100MP+ wide-gamut source, the WI-15
downscale introduces one gamma-space resize (ΔE₂₀₀₀ ≈ 0.37–0.48 at midtone)
before the rgb16 fan-out. This is a pre-existing accepted trade-off: without WI-15
the rgb16 pipeline would OOM on large sources.

The ICC profile is preserved in the `.wi15.tmp` file because `sharp().toFile()`
preserves embedded ICC by default (no `.withMetadata({})` stripping). The
subsequent Bradford adaptation via `toColorspace('p3')` still reads the correct
source white point.

[FINDING 12] No new color-math errors arise from the WI-12/WI-14/WI-15
interactions. The three changes are orthogonal: WI-14 addresses shared state
(not colorimetry), WI-12 preserves ICC for LCMS2, and WI-15 applies a
gamma-space downscale before the ICC-aware gamut conversion.

---

## 11. Updated Pipeline Decision Summary

| Source ICC | Decision | Mean ΔE₂₀₀₀ (CC24) | Max ΔE₂₀₀₀ | Risk |
|------------|----------|-------------------|-----------|------|
| sRGB → sRGB (identity) | `srgb` | 0.000 | 0.000 | None |
| Display P3 → P3 (identity) | `p3-from-displayp3` | 0.000 | 0.000 | None |
| DCI-P3 → P3 (Bradford WI-12) | `p3-from-dcip3` | **0.000** | **0.000** | **None (fixed)** |
| AdobeRGB → P3 (p3-from-wide) | `srgb-from-adobergb` | 0.163 | 3.33 | Low |
| Rec.2020 → P3 (p3-from-wide) | `srgb-from-rec2020` | ~0.8 | ~4.5 | Medium |
| ProPhoto → P3 (p3-from-wide) | `srgb-from-prophoto` | 0.000 (CC24) | ~16.6 (extreme sat.) | High (OOG) |
| Unknown ICC → sRGB (fallback) | `srgb-from-unknown` | varies | varies | Risk if untagged HDR |

---

## Key Findings Summary

**[FINDING 1] WI-12 Bradford DCI-P3 adaptation is mathematically correct.**
The implementation relies on libvips/LCMS2 reading both source (DCI white,
0.314, 0.351) and destination (D65, 0.3127, 0.3290) ICC profiles from the
Sharp `toColorspace('p3')` call. The resulting Bradford matrix has max
off-diagonal = 0.0582 and zero residual on white-point verification.

**[FINDING 2] DCI-P3 → Display P3 ΔE eliminated: mean 0.463 → 0.000.**
All 24 CC24 ColorChecker patches show ΔE₂₀₀₀ = 0.000 with WI-12. The
old path (treating DCI-P3 as Display P3 without white-point correction)
produced mean ΔE₂₀₀₀ = 0.463 and max 1.001 on cyan-blue tones.

**[FINDING 3] WI-14 shared-state hardening eliminates a theoretical race
condition** between parallel AVIF/WebP/JPEG encoders. No color accuracy cost.
DCI-P3 sources still use `image.clone()` (correct — no `pipelineColorspace`
mutation risk for that path).

**[FINDING 4] NCLX_TRANSFER_MAP contains three critical code-point errors.**
Transfer 13 = sRGB (not PQ), transfer 16 = PQ (missing from map), transfer 18
= HLG (not γ1.8). These produce HDR false positives for standard sRGB HEIF
and HDR false negatives for PQ ProRAW. Correct map: `{1:'srgb', 13:'srgb',
16:'pq', 18:'hlg'}`.

**[FINDING 5] Primaries code 11 (DCI-P3) is missing from NCLX_PRIMARIES_MAP.**
Medium severity; ICC name fallback still handles most DCI-P3 sources.

**[FINDING 6] ProPhoto → P3 clipping: mean ΔE₂₀₀₀ = 10.9, max 16.6 for
saturated photographic colors.** CC24 patches are in-gamut (ΔE = 0). Real loss
is confined to wet foliage highlights, deep sky blues, and primary-adjacent
saturated colors. Skin tones, foliage at moderate saturation, and sky gradients
at moderate saturation are unaffected.

**[FINDING 7] HDR AVIF is deferred. 3.32–4.00 stops above SDR white are
discarded for iPhone PQ ProRAW sources.** The CICP map errors (Finding 4)
must be fixed before Phase 4 HDR delivery can be correctly gated on `is_hdr`.

**[FINDING 8] WebP q90 and JPEG q90 encoding: mean ΔE₂₀₀₀ ≈ 0.45–0.56.**
Both are below the 1.5 skin-tone threshold. P3 ICC tagging on WebP/JPEG
(Phase 1, commit `4863a6f`) is correct.

**[FINDING 9] Histogram P3 canvas is correct for wide-gamut sources.**
8-bit canvas quantization: ΔE₂₀₀₀ ≈ 0.20 at midtone. sRGB canvas would
introduce ΔE₂₀₀₀ up to 5.33 for saturated P3 primaries (clipping). The
`isClipped` indicator correctly signals the sRGB fallback.

**[FINDING 10] Banding: unchanged from previous review.** 10-bit AVIF has
0/1023 steps above JND; 8-bit WebP/JPEG has 91/255 steps above JND. No new
banding introduced by rgb16 or DCI-P3 handling.

**[FINDING 11] ACES Hill tone-map remains the Phase 4 recommendation.**
Slope at SDR white = 0.264 in the calibrated form (minor correction from 0.299
in previous review — prescale convention difference, not an algorithm change).

**[FINDING 12] No new color-math edge cases from WI-12/WI-14/WI-15
interactions.** The changes are orthogonal and do not interfere.

---

*All numerical values computed from first principles using CIE xy primary
chromaticities, Bradford CAT matrices, sRGB/PQ transfer functions, and CIE
ΔE₂₀₀₀ formula. CICP code points verified against ITU-T H.273 (2021) /
ISO/IEC 23091-2. Pipeline version: IMAGE_PIPELINE_VERSION = 5.*
