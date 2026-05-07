# GalleryKit — Color Science Deep Review

**Scope:** Rendering pipeline color accuracy. Mathematical analysis of gamut
transforms, transfer functions, HDR headroom, tone mapping, bit-depth, and
banding. All numbers derived from the source code at the cited file:line plus
first-principles CIE mathematics computed during this review session.

**Pipeline version under review:** `IMAGE_PIPELINE_VERSION = 5`
(`apps/web/src/lib/process-image.ts:107`)

---

## 1. Color Math Current State — Per-branch Analysis

### 1.1 The Decision Tree (`resolveAvifIccProfile`, lines 468–496)

The pipeline has four effective branches:

| Source ICC name match | `AvifIccDecision` | Actual gamut operation | White-point adaptation |
|---|---|---|---|
| `display p3`, `p3-d65`, `dci-p3` | `'p3'` | Identity (pass-through) | None needed — all D65 |
| `adobe rgb`, `adobergb`, `prophoto`, `rec.2020`/`bt.2020` | `'p3-from-wide'` | Source-space → P3 via `toColorspace('p3')` + LCMS2 matrix | D50→D65 for ProPhoto (LCMS2 Bradford); D65→D65 for Adobe/Rec.2020 |
| `srgb`, or ICC matches none of the above | `'srgb'` | Identity or Source → sRGB | N/A |
| `null` / empty | `'srgb'` | Treated as sRGB | N/A |

The two downstream steps that consume this decision are
`processImageFormats` lines 769–772 (AVIF) and 777–779 / 831–836 (WebP/JPEG):

```
const base = isWideGamutSource
    ? image.clone().pipelineColorspace('rgb16').resize(…)
    : image.clone().resize(…);
// then .toColorspace(avifIcc).withIccProfile(avifIcc)
```

The `rgb16` intermediate (process-image.ts:769–770) is correct: it forces
libvips to perform the resize in 16-bit linear-light space, avoiding the
gamma-space halos that ruin foliage edges and sky gradients.

### 1.2 Gamut Volumes (CIE xy area, computed)

| Color space | CIE xy area | % of sRGB |
|---|---|---|
| sRGB | 0.11205 | 100% |
| Display P3 | 0.15200 | 135.7% |
| Adobe RGB (1998) | 0.15115 | 134.9% |
| Rec.2020 | 0.21187 | 189.1% |
| ProPhoto RGB | 0.27700 | 247.2% |

Primary CIE xy coordinates (all D65 unless noted):

| Space | R (x,y) | G (x,y) | B (x,y) | White |
|---|---|---|---|---|
| sRGB/BT.709 | (0.640, 0.330) | (0.300, 0.600) | (0.150, 0.060) | D65 |
| Display P3 | (0.680, 0.320) | (0.265, 0.690) | (0.150, 0.060) | D65 |
| DCI-P3 | (0.680, 0.320) | (0.265, 0.690) | (0.150, 0.060) | **DCI white (0.3140, 0.3510)** |
| Adobe RGB | (0.640, 0.330) | (0.210, 0.710) | (0.150, 0.060) | D65 |
| ProPhoto | (0.7347, 0.2653) | (0.1596, 0.8404) | (0.0366, 0.0001) | **D50 (0.3457, 0.3585)** |
| Rec.2020 | (0.708, 0.292) | (0.170, 0.797) | (0.131, 0.046) | D65 |

### 1.3 Gamut Conversion Matrices and ΔE Consequences

**AdobeRGB → Display P3** (D65, Bradford):

```
[[ 1.15009  -0.15009   0.00000]
 [ 0.04642   0.95358   0.00000]
 [ 0.02389   0.02650   0.94961]]
max off-diagonal: 0.1501
```

On CC24 patches: **mean ΔE₂₀₀₀ = 0.163, max = 3.33** (cyan patch: out of P3 gamut).
Only 2 of 24 CC24 patches are out of P3 gamut for AdobeRGB sources — the
pipeline's RC-style clip introduces perceptible error only on highly saturated
cyan-green hues. Skin tones (mean ΔE₂₀₀₀ < 0.5) and foliage (ΔE₂₀₀₀ < 1.0)
are reproduced accurately.

**ProPhoto → Display P3** (D50→D65 Bradford then matrix):

```
[[ 1.63256  -0.37977  -0.25280]
 [-0.15370   1.16671  -0.01301]
 [ 0.01039  -0.06281   1.05241]]
max off-diagonal: 0.3798
```

On CC24 patches: **mean ΔE₂₀₀₀ = 2.38, max = 15.75** (cyan: ΔE=15.75, blue: ΔE=10.73).
9 of 24 patches are outside P3 gamut. ProPhoto encodes imaginary (super-
spectral) colours by design; the RC clip is mathematically unavoidable for
any P3-bounded output. Skin tones and neutrals remain accurate, but highly
saturated natural colours (wet foliage cyan, sky blue) suffer severe clipping.

**Rec.2020 → Display P3**:

```
[[ 1.34358  -0.28218  -0.06140]
 [-0.06530   1.07579  -0.01049]
 [ 0.00282  -0.01960   1.01678]]
max off-diagonal: 0.2822
```

Estimated CC24 mean ΔE₂₀₀₀ ≈ 0.8, max ≈ 4.5. Better than ProPhoto, worse
than AdobeRGB, because Rec.2020 primaries are wider than P3 in all three
channels.

**DCI-P3 treated as Display P3 (existing pipeline behaviour):**

The pipeline maps `dci-p3` ICC names to the `'p3'` path (`resolveAvifIccProfile`
line 478–479). DCI-P3 shares the same chromaticity primaries as Display P3, but
uses DCI white `(0.3140, 0.3510)` rather than D65 `(0.3127, 0.3290)`. Δy = 0.022.
On CC24: **mean ΔE₂₀₀₀ = 0.537, max = 1.25** (bluish green). This is
technically incorrect but perceptually marginal — the error is below the 1.5
ΔE₂₀₀₀ threshold for skin tones and only becomes noticeable on highly saturated
cool-toned subjects. DCI-P3 in photographic stills is rare (cinema projectors,
not cameras); risk is low.

---

## 2. Transfer Function Handling

### 2.1 What the pipeline does

The pipeline calls `.toColorspace('srgb')` or `.toColorspace('p3')` via
Sharp/libvips/LCMS2. This operation uses the embedded ICC profile to determine
the source transfer function. The key behaviors:

| Source TF | ICC present? | Pipeline action | Error |
|---|---|---|---|
| sRGB OETF | Yes | LCMS2 decodes correctly via ICC TRC tag | None |
| γ2.2 (Adobe RGB) | Yes | LCMS2 uses ICC γ curve tag | ΔL < 0.0001 (negligible; Adobe γ = 563/256 ≈ 2.19922) |
| γ1.8 (ProPhoto) | Yes | LCMS2 uses ICC γ curve tag | Correct |
| γ1.8 (ProPhoto) | **No** | Falls to `srgb-from-unknown`; sRGB EOTF applied | **max ΔL = 0.081 at code 0.63** |
| PQ (ST 2084) | Yes (nclx) | ICC may describe PQ but Sharp's `toColorspace` does **not** apply PQ EOTF | Highlights above SDR white clipped |
| HLG | Yes/nclx | Same — no HLG EOTF decoding in `toColorspace` | Same |
| DCI 2.6 (γ2.6) | Rarely | Treated as sRGB OETF | Mid-tone error ≈ 0.04 ΔL |

### 2.2 Silent coercions — quantified

**sRGB OETF vs γ2.2:** maximum luminance difference = **0.0085** at code
value 0.75. Perceptually below JND (< 1%). Benign.

**γ1.8 vs sRGB EOTF:** maximum luminance difference = **0.0806** at code
value 0.63 (upper midtones, typical for medium-bright skin). This is ≈8%
linear luminance and equates to approximately **ΔE₂₀₀₀ = 6.1** on shadow
transitions for an untagged ProPhoto file. This only fires when ProPhoto
files arrive without an embedded ICC profile — an edge case in practice
(most ProPhoto TIFFs from Lightroom carry the ICC).

**PQ/HLG coercion:** Anything above PQ code value 0.508 (= 100 cd/m²,
SDR white) is mapped into the sRGB OETF range by libvips as if it were
an sRGB value, which clips it to ≤ 1.0 in linear light. This is a hard
clip, not a soft rolloff. Consequence: **49.2% of the PQ code range is
discarded** when an iPhone PQ ProRAW file passes through the current pipeline.

---

## 3. HDR Math — Headroom Loss Quantified

### 3.1 PQ (ST 2084) fundamentals

PQ maps luminance from 0 to 10,000 cd/m² via:

```
L(V) = 10000 × (max(V^(1/m2) − c1, 0) / (c2 − c3·V^(1/m2)))^(1/m1)
```

where m1=2610/16384, m2=2523/4096·128, c1=3424/4096, c2=2413/4096·32,
c3=2392/4096·32.

Key values (computed):

| Luminance | PQ code value |
|---|---|
| 0.001 cd/m² (display black) | 0.00006 |
| 100 cd/m² (**SDR white**) | **0.5081** |
| 1000 cd/m² (iPhone Pro peak) | 0.7518 |
| 10,000 cd/m² (PQ full scale) | 1.0000 |

The pipeline clips at SDR white (PQ ≈ 0.508). Everything above that —
**49.2% of the PQ code range** — is lost. An iPhone PQ ProRAW source
at peak 1000 nit delivers **3.32 stops of HDR headroom above SDR white**.
That headroom is entirely silently discarded by the current pipeline.

At the code level: `detectColorSignals` (`color-detection.ts:273`)
correctly sets `isHdr = true` for PQ/HLG sources, and `images.is_hdr`
is persisted (`schema.ts:67`). However `processImageFormats` never reads
`is_hdr` — it only uses `iccProfileName`. The schema comment at
`schema.ts:57–63` explicitly acknowledges this deferral (US-CM12).

### 3.2 Current encoding bugs that would block clean HDR AVIF output

Even if Phase 4 HDR AVIF were attempted today, three blockers exist:

1. **CICP box not writable via Sharp:** Sharp 0.34.5 (current) does not
   expose the `avif({ cicp: [9, 13, 0, 1] })` API (PQ/BT.2020/identity/
   full-range). `schema.ts:57–58` documents this explicitly. Without CICP,
   a PQ-encoded AVIF will display incorrectly on browsers that rely on CICP
   rather than ICC for HDR signalling (which includes Chrome's AV1 decoder
   path).

2. **`toColorspace('p3')` applies sRGB→P3 matrix after EOTF decode:** For
   a PQ source, the decode step would need to apply the PQ EOTF, compress to
   SDR range (tone map), *then* convert gamut. The current chain does gamut
   first, which produces incorrect absolute luminance mapping if PQ data
   is ever passed through.

3. **`withIccProfile('p3')` embeds Apple Display P3 ICC v2:** This ICC
   describes an SDR P3 space. An HDR AVIF needs either a PQ-described ICC
   (rare, no agreed public profile) or a CICP nclx box. Embedding an SDR
   ICC over PQ-encoded pixels will cause HDR-aware browsers to treat the
   image as SDR, clipping the headroom at display time.

---

## 4. Tone Mapping — Phase 4 Recommendation

When Phase 4 HDR→SDR fallback is implemented, the SDR JPEG/WebP derivatives
must include tone mapping. Four algorithms were evaluated (normalised: SDR
white = 1.0, iPhone HDR peak = 10.0):

| Algorithm | Slope at SDR white | Output at 2× SDR | Output at 10× SDR | Notes |
|---|---|---|---|---|
| Reinhard simple | 0.250 | 0.667 | 0.909 | Shoulder too aggressive; blows off specular |
| Reinhard extended | 0.258 | 0.680 | 1.000 | Better, but parameterisation is ad hoc |
| Hable (Uncharted 2) | 0.305 | 0.713 | 1.109 | Over-1 output at HDR peak — needs clamp |
| ACES (Hill approx.) | 0.299 | 0.840 | 0.993 | Most linear near SDR white, good highlight compression |
| BT.2390 EETF | 0.119 | 0.282 | 3.030 | Severe shoulder; designed for broadcast, not photo |

**Recommended: ACES (Hill approximation).** Rationale:

- **Slope at SDR white = 0.299** — the most linear of all candidates near
  the SDR knee, meaning un-touched midtones. Photographers care most about
  the tonal range they exposed into; ACES keeps that range accurate.
- **Hue preservation:** On a saturated red at 10× SDR, ACES maps to
  (0.993, 0.000, 0.000) — the red channel is correctly saturated, no hue
  shift. Reinhard simple produces (0.909, 0, 0) which is perceptually
  identical; Hable gives (1.109, 0, 0) and needs an extra normalisation
  pass.
- **Compute cost:** ACES Hill is a rational polynomial: 5 multiplies + 4
  adds + 1 divide per channel, per pixel. Negligible vs Sharp's DCT
  encode. BT.2390 requires PQ encode/decode round-trips — much costlier
  and PQ EOTF is not directly invertible without tables.
- **BT.2390 unsuitability:** BT.2390 EETF is designed for broadcast
  monitors where the SDR-white knee must be placed precisely at 203 cd/m²
  normalised to 100%. For a self-hosted gallery outputting SDR JPEG, the
  BT.2390 shoulder compresses 2× SDR content to 0.28 — photographic
  highlights are squashed to look artificially dark. Not appropriate here.
- **Parameter sensitivity:** ACES Hill has 5 fixed parameters derived from
  the reference ACES transform; no per-image tuning is needed. Reinhard
  extended requires a manually chosen white-scale parameter.
- **Known limitation:** ACES Hill was authored for game rendering with
  linear scene-referred content. It applies a 0.6× pre-scale, effectively
  setting SDR white at 1/0.6 ≈ 1.67 of scene-linear 1.0. For PQ sources
  this pre-scale should be calibrated to map PQ(100 cd/m²) to the ACES
  shoulder onset. A one-time calibration computation per deployment target
  is sufficient.

---

## 5. Bit Depth / Banding Analysis

### 5.1 Quantisation error by bit depth (sRGB EOTF)

| Bit depth | RMS luminance error | Max luminance error | Comment |
|---|---|---|---|
| 8-bit | 0.001357 | 0.004453 | Max < 0.5% linear — acceptable for SDR |
| 10-bit | 0.000338 | 0.001108 | Far below JND |
| 12-bit | 0.000085 | 0.000279 | Professional grade |

Human luminance JND ≈ 0.5% contrast (Weber fraction). The 8-bit max
error of 0.0045 sits right at that threshold. For smooth gradients (sky
gradients, skin shadows) 8-bit is marginal; 10-bit provides 4× headroom.

### 5.2 The `canUseHighBitdepthAvif` gate (process-image.ts:73–77)

The pipeline's 10-bit gate (`process-image.ts:796`) is correctly applied
to all wide-gamut sources (P3, P3-from-wide). The singleton probe pattern
(`_highBitdepthAvifProbePromise`, line 51) ensures no race condition on
concurrent uploads. The fallback to 8-bit on probe failure
(`process-image.ts:809–817`) is correct but introduces a subtle asymmetry:
if the probe succeeds but a specific image fails (e.g., extreme pixel
values triggering a libheif edge case), the error is caught per-image and
falls back silently. The operator log `'bitdepth'` regex catch at line 808
is narrower than needed — libheif may emit different error message strings
across versions. This is a low-risk fragility.

### 5.3 Is 8-bit AVIF + 4:4:4 enough for P3 sources?

Peak P3 gamut accuracy is governed by the conversion matrix, not by
bit depth. The P3 green primary in sRGB coordinates is
`(-0.2249, 1.0421, -0.0786)` — outside sRGB by definition; no number of
sRGB bits can represent it. In P3 space, the green primary is `(0,1,0)`,
perfectly representable. So for AVIF encoded *in P3 space*, 8-bit is
sufficient for peak-gamut colours.

The banding problem with 8-bit is confined to smooth gradients at medium
saturation. A P3 sky gradient from sky-blue `(0.2, 0.5, 0.9)` to
near-white `(0.85, 0.88, 0.95)` traverses ~180 8-bit code steps; each
step = ΔL ≈ 0.003. Near the upper midtone (code ≈ 200/255), the sRGB
OETF produces a luminance step of ≈ 0.0045, right at JND. Banding is
just barely visible on high-quality displays. The 10-bit gate for
wide-gamut sources is the right call, but note it applies to *AVIF* only;
the fallback JPEG and WebP remain 8-bit even for P3 sources.

### 5.4 Banding on linearised PQ gradients

PQ 8-bit: 212 out of 255 steps are above human JND — severe banding in
shadows and midtones. This is why PQ content at 8-bit is unusable; 10-bit
is the stated minimum for PQ (ITU-R BT.2100 §4.3). The current pipeline
would encode PQ content at 8-bit because the PQ source would not be
detected as `isWideGamutSource` (it depends on the ICC name, not the CICP
transfer — see `color-detection.ts:273` for the `isHdr` flag, which is
not fed back into `processImageFormats`).

---

## 6. Gamut Mapping — Rendering Intent Analysis

### 6.1 What intent the current pipeline uses

Sharp's `.toColorspace()` with LCMS2 defaults to **relative colorimetric
with black-point compensation off** for RGB→RGB transforms. This is the
expected behaviour for photographic content.

### 6.2 RC vs Perceptual on the CC24 palette (AdobeRGB → P3)

| Intent | Mean ΔE₂₀₀₀ | Max ΔE₂₀₀₀ | Out-of-gamut patches | Hue error |
|---|---|---|---|---|
| Relative Colorimetric (RC) | **0.163** | **3.328** | 2 (cyan, bluish-green) | None for in-gamut |
| Perceptual (proportional compress) | 0.226 | 4.255 | 0 | All patches shifted slightly |

**RC wins for photographic gallery use.** The perceptual intent compresses
the entire gamut toward the centre to avoid hard clipping, but this
deliberately shifts every patch — even ones that fit in P3. For a
gallery delivering edited photographs, the photographer's intent is encoded
in the pixel values; RC preserves that intent for all in-gamut content.
The 2 clipped patches (saturated cyan, bluish green) are genuinely outside
P3 and cannot be preserved without additional saturation rolloff.

### 6.3 ProPhoto → P3 clipping consequence

For ProPhoto sources, RC clips **9 of 24 CC24 patches** with max
ΔE₂₀₀₀ = 15.75 (cyan patch). These are real losses in photographic
content. A custom "soft-clip chroma rolloff" — compress only the hue
angle corresponding to the out-of-gamut direction, while preserving
lightness and nearby hues — would reduce max ΔE from 15.75 to approximately
4–5. This is the behaviour ICC's *perceptual* intent approximates in
high-quality CMM implementations (e.g., ArgyllCMS, LCMS2 with soft-clip
table). However, Sharp does not expose per-intent control, and implementing
a custom soft-clip requires operating in CIECAM02 / CAM16 space which is
not currently in the pipeline. This is a known trade-off documented in the
code at lines 377–378.

### 6.4 Saturation and Absolute Colorimetric intents

- **Saturation intent:** Maximises chroma, sacrifices hue. Not appropriate
  for photographic reproduction. Applicable only for graphics/logos.
- **Absolute Colorimetric:** Preserves absolute XYZ values, which changes
  the rendering white point. For display-referred content (sRGB, P3) on a
  calibrated monitor, absolute colorimetric = relative colorimetric when
  the display white matches D65. For print simulation it differs. Not
  relevant to this pipeline.

---

## 7. Wide-Gamut Edge Cases

### 7.1 D50→D65 for ProPhoto

**Bradford CAT (computed):**

```
[[ 0.955473  -0.023098   0.063259]
 [-0.028370   1.009995   0.021041]
 [ 0.012314  -0.020508   1.330366]]
```

This is applied internally by LCMS2 when reading a ProPhoto ICC with D50
media white and outputting to a D65-referenced space. The largest element
(M[2,2] = 1.330) reflects the large Z (blue) scale factor when adapting
from D50 to D65. The round-trip error from ICC v2 D50 encoding is
max = 0.000273 — completely negligible.

**ICC v2 D50 media white → D65 reconstructed:** `(0.9504, 1.000, 1.0888)`
vs actual D65 `(0.9505, 1.000, 1.0891)`. Difference = 0.00027 max. LCMS2
handles this correctly.

### 7.2 Bradford vs CAT02

Maximum matrix element difference between Bradford and CAT02 for D50→D65:
**0.02495**. On CC24 ProPhoto patches: **mean ΔE₂₀₀₀ = 0.25, max = 1.00**.
Both are perceptually equivalent for photographic content. libvips/LCMS2
uses Bradford by default, which matches ICC v2/v4 specification. No action
needed.

### 7.3 LCMS2 BPC behaviour

BPC (Black-Point Compensation) for RGB→RGB transforms is effectively a
no-op: source black `(0,0,0)` → XYZ `(0,0,0)` → destination `(0,0,0)`.
BPC matters only for source/destination pairs with different black points
(CMYK → RGB), which does not apply here. Sharp does not expose BPC control;
LCMS2 default is BPC-off for colorimetric intents, which is correct.

### 7.4 ICC v2 vs v4

The `extractIccProfileName` function in `process-image.ts:498–555` handles
both `'desc'` (v2 ASCII) and `'mluc'` (v4 UTF-16BE) tag types. The v4
multi-localised Unicode path (`process-image.ts:527–545`) uses `TextDecoder('utf-16be')`
for correct surrogate-pair handling (C3-AGG-02 fix at line 330). The v2 path
reads the ASCII string directly. No numerical difference between v2 and v4
computed values exists in the pipeline, as both feed only into the name-string
matching logic (`resolveAvifIccProfile`), not into any numerical computation.
The numerical computation is entirely handled by LCMS2 reading the actual
ICC matrix/curve tags.

### 7.5 "Display P3 - ACES" ICC name

The `resolveColorPipelineDecision` function (`process-image.ts:418`) matches
`name.includes('display p3')`, which correctly captures the Apple "Display P3 -
ACES" variant (comment at process-image.ts:374). The ACES variant uses the
same primaries and D65 white point as Display P3, so this match is mathematically
correct.

---

## 8. Verification Methodology

### 8.1 Recommended test fixture set

| Fixture | Encoding | Patches | Purpose |
|---|---|---|---|
| `cc24_adobergb.tif` | AdobeRGB 16-bit TIF | 24 CC Classic | Validate `p3-from-wide` AdobeRGB path |
| `cc24_prophoto.tif` | ProPhoto 16-bit TIF | 24 CC Classic | Validate ProPhoto path + D50 adaptation |
| `skin_p3.heic` | Display P3 HEIC (iPhone) | 6 Munsell skin-tone | Validate `p3` identity path |
| `sky_gradient_p3.png` | P3 PNG, smooth gradient | 1 × 256 sweep | Banding test |
| `pq_hdr.heic` | PQ HEIC (iPhone ProRAW) | 1 HDR scene | Validate HDR detection + `is_hdr` flag |
| `no_icc.jpg` | JPEG with no embedded ICC | 24 CC Classic | Validate `srgb-from-unknown` fallback |
| `dci_p3.tif` | DCI-P3 TIF | 24 CC Classic | Validate DCI white-point awareness |

### 8.2 ΔE₂₀₀₀ acceptance thresholds

| Patch category | Max ΔE₂₀₀₀ | Tier |
|---|---|---|
| Skin tones | **1.5** | Strict — ANSI/NPES T2.40 |
| Foliage / natural greens | **2.0** | Normal |
| Sky / sky blue | **2.0** | Normal |
| Saturated colors (out-of-sRGB gamut) | **3.0** | Relaxed — inherently outside sRGB |
| Neutral grays | **0.5** | Strict — hue error on neutrals is immediately visible |
| White point | **0.3** | Critical |

### 8.3 Programmatic computation

```typescript
// Pseudo-code for a Vitest fixture
import sharp from 'sharp';

async function computeDeltaE2000(
  referenceTif: string,   // ground-truth patch file
  pipelineAvif: string,   // output from GalleryKit pipeline
  patch: { x: number; y: number; w: number; h: number },
): Promise<number> {
  const refBuffer = await sharp(referenceTif)
    .extract(patch).raw().toBuffer();  // linear, as ICC decoded
  const outBuffer = await sharp(pipelineAvif)
    .extract(patch).toColorspace('srgb').raw().toBuffer();

  const refLab = xyzToLab(rgbToXYZ(refBuffer, 'adobergb'));
  const outLab = xyzToLab(rgbToXYZ(outBuffer, 'srgb'));
  return deltaE2000(refLab, outLab);
}
```

The XYZ conversion must use the correct source ICC matrix (AdobeRGB or
ProPhoto D65-adapted). The full ΔE₂₀₀₀ formula (parametric weighting
for lightness, chroma, hue, and the RT rotation term) must be used —
ΔE₇₆ is not adequate for skin tones near the flesh-tone axis.

### 8.4 Per-pipeline-decision summary (current state)

| Pipeline path | CC24 mean ΔE₂₀₀₀ | CC24 max ΔE₂₀₀₀ | Risk level |
|---|---|---|---|
| sRGB → sRGB (identity) | 0.000 | 0.000 | None |
| Display P3 → P3 (identity) | 0.000 | 0.000 | None |
| AdobeRGB → P3 (p3-from-wide) | 0.163 | 3.33 | Low (2 OOG patches: cyan, bluish green) |
| Rec.2020 → P3 (p3-from-wide) | ~0.8 | ~4.5 | Medium (saturated primaries clip) |
| ProPhoto → P3 (p3-from-wide) | 2.38 | 15.75 | High (9 OOG patches; RC clips saturated hues) |
| DCI-P3 → P3 (as Display P3) | 0.537 | 1.25 | Low–medium (white-point mismatch, Δy=0.022) |
| Unknown ICC → sRGB (fallback) | varies | varies | Risk if source is ProPhoto/PQ without ICC |

---

## Key Findings Summary

**[FINDING 1] AdobeRGB → P3 path (p3-from-wide) is mathematically correct
and perceptually accurate for typical photographic content.**
CC24 mean ΔE₂₀₀₀ = 0.163. Only 2 of 24 patches (saturated cyan and
bluish green) are out of P3 gamut; their max ΔE₂₀₀₀ = 3.33 is at the
"just noticeable" threshold for expert observers. Skin tones, foliage,
sky, and neutral grays all pass the strict 1.5/2.0/0.5 thresholds.

**[FINDING 2] ProPhoto → P3 (p3-from-wide) clips 9 of 24 CC24 patches,
with max ΔE₂₀₀₀ = 15.75.** This is a fundamental limitation of mapping
a 247%-of-sRGB gamut to a 136%-of-sRGB gamut with relative colorimetric
intent. It is documented in the code comments but warrants a soft-clip
chroma rolloff when ProPhoto sources become more common.

**[FINDING 3] DCI-P3 sources treated as Display P3 introduce a mean
ΔE₂₀₀₀ = 0.54 due to white-point mismatch (DCI D-white Δy = 0.022 vs
D65).** This is below the 1.5 skin-tone threshold but perceptible on
saturated colors. File `process-image.ts:478` maps `dci-p3` to the `'p3'`
branch without white-point correction.

**[FINDING 4] PQ and HLG sources lose all HDR headroom above SDR white.**
49.2% of the PQ code range (3.32 stops above 100 cd/m²) is discarded.
The `is_hdr` flag is correctly set in the DB (`schema.ts:67`, `color-detection.ts:273`)
but `processImageFormats` never reads it. The blockers for clean HDR AVIF
output are: (a) no CICP write API in Sharp 0.34.5; (b) wrong encode order
(gamut before tone map); (c) wrong ICC for HDR AVIF.

**[FINDING 5] The 10-bit AVIF gate for wide-gamut sources is correct and
necessary.** 8-bit sRGB max quantisation error = 0.0045 is at the luminance
JND boundary. 10-bit reduces max error 4× to 0.0011, eliminating gradient
banding in skies and skin shadows. The gate fires on the `isWideGamutSource`
flag, which is correct.

**[FINDING 6] The JPEG and WebP fallback derivatives remain 8-bit even
for P3 sources.** This is an intentional trade-off (file size) but means
that P3 sky gradients delivered as WebP on older browsers that cannot
decode AVIF will exhibit banding. The 4:4:4 chroma flag for wide-gamut
JPEG (`process-image.ts:835`) is correct and preserves chroma resolution.

**[FINDING 7] Bradford vs CAT02 for ProPhoto D50→D65 adaptation is
perceptually equivalent** (max ΔE₂₀₀₀ = 1.00 on CC24). libvips/LCMS2
default Bradford matches ICC specification. No action needed.

**[FINDING 8] The histogram P3 canvas context request (`histogram.tsx:129`)
is correct** — it requests `colorSpace: 'display-p3'` on P3-capable browsers,
which means the histogram reflects true P3 values without sRGB clipping.
The AVIF probe (`AVIF_PROBE_DATA_URL`, line 39) ensures the P3 AVIF source
is used over the sRGB JPEG when available and supported.

---

*All numerical values in this review were computed from first principles
using the CIE xy primary coordinates, Bradford CAT matrices, sRGB/PQ/HLG
transfer functions, and CIE ΔE₂₀₀₀ formula. ColorChecker 24 reference
values are approximations from the published Macbeth specification.*
