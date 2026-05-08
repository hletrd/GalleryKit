# Color Fidelity Review (R3)

**Date:** 2026-05-08
**Premise:** photos arrive AFTER editing. Deliver the photographer's intent to every viewer's display, on every supported browser. (사진가가 원했던 사진의 의도를 반영해서 정확하게 출력되어야 해.)
**Scope:** color reproduction accuracy, ICC profile management, wide-gamut delivery (P3, AdobeRGB, ProPhoto, Rec.2020), display chromaticity primitives, browser color support matrix.

---

## 0. Reading guide

This review is grounded in code as it stands at 2026-05-08 — after plans 34-37 shipped and the R2 followup landed. Findings are NEW (not duplicates of the prior aggregates). I cite file:line for every claim.

Severity convention:
- **CRIT** — the photographer's intent is silently misreproduced on the delivered image.
- **HIGH** — the intent is reproduced for some users / displays / browsers but visibly wrong for a meaningful audience.
- **MED** — accuracy is fine; the audit / verification surface is missing or misleading.
- **LOW** — polish.

---

## 1. The encoder pipeline as it stands

### 1.1 Decision graph (`process-image.ts:407-490`)

For a given source ICC profile name `iccProfileName`:

```
resolveColorPipelineDecision(name) →
  null / unknown        → 'srgb-from-unknown'
  Display P3 / P3-D65   → 'p3-from-displayp3'
  DCI-P3                → 'p3-from-dcip3'
  Adobe RGB             → 'p3-from-adobergb'
  ProPhoto              → 'p3-from-prophoto'
  Rec.2020 / BT.2020    → 'p3-from-rec2020'
  sRGB                  → 'srgb'
```

```
resolveAvifIccProfile(name) →
  null / unknown        → 'srgb'
  Display P3 / P3-D65 / DCI-P3 → 'p3'
  Adobe RGB / ProPhoto / Rec.2020 → 'p3-from-wide'
  sRGB                  → 'srgb'
```

`isWideGamutSource = avifDecision in ('p3', 'p3-from-wide')`.

`avifIcc = isWideGamutSource ? 'p3' : 'srgb'`.

`targetIcc = (isWideGamutSource && !forceSrgbDerivatives) ? 'p3' : 'srgb'`.

`isDciP3 = ICC name lowercase starts with 'dci-p3'` — controls whether `pipelineColorspace('rgb16')` is applied (skipped for DCI-P3 to preserve source white-point for the Bradford transform).

### 1.2 Encode chain per format

**AVIF (per format closure):**
```ts
const needsRgb16 = isWideGamutSource && !isDciP3;
const base = needsRgb16
  ? sharp(processingInputPath, {…autoOrient:true})
      .pipelineColorspace('rgb16')
      .resize({ width: resizeWidth })
  : image.clone().resize({ width: resizeWidth });

await base
  .toColorspace(avifIcc)        // 'p3' or 'srgb'
  .withIccProfile(avifIcc)      // Apple Display P3 ICC or sRGB IEC61966-2.1 ICC
  .avif({ quality: qualityAvif, effort: 6, ...(wantHighBitdepth ? { bitdepth: 10 } : {}) })
  .toFile(outputPath);
```

**WebP / JPEG:** identical structure but with `targetIcc` instead of `avifIcc`. The `base` is shared (same `needsRgb16` decision).

### 1.3 What actually happens for each source class

| Source ICC | Pipeline | AVIF output | WebP output | JPEG output | Decision label |
|---|---|---|---|---|---|
| sRGB IEC61966-2.1 | clone (gamma-space) | sRGB 8-bit | sRGB 8-bit | sRGB 8-bit | `srgb` |
| Display P3 / P3-D65 | rgb16 | **P3 10-bit** | P3 8-bit | P3 8-bit 4:4:4 | `p3-from-displayp3` |
| DCI-P3 | clone (gamma-space, **NOT rgb16**) | P3 8-bit (Bradford) | P3 8-bit | P3 8-bit 4:4:4 | `p3-from-dcip3` |
| Adobe RGB | rgb16 | P3 10-bit | P3 8-bit | P3 8-bit 4:4:4 | `p3-from-adobergb` |
| ProPhoto | rgb16 | P3 10-bit | P3 8-bit | P3 8-bit 4:4:4 | `p3-from-prophoto` |
| Rec.2020 | rgb16 | P3 10-bit | P3 8-bit | P3 8-bit 4:4:4 | `p3-from-rec2020` |
| Unknown / no ICC | clone | sRGB 8-bit | sRGB 8-bit | sRGB 8-bit | `srgb-from-unknown` |
| PQ HEIF (NCLX-only, no ICC) | clone | **sRGB 8-bit (silent miscolor)** | sRGB 8-bit | sRGB 8-bit | `srgb-from-unknown` |
| HLG HEIF (NCLX-only, no ICC) | clone | **sRGB 8-bit (silent miscolor)** | sRGB 8-bit | sRGB 8-bit | `srgb-from-unknown` |

The last two rows are **CF-CRIT-2** below.

---

## 2. CRIT findings (silent miscolor)

### CF-CRIT-1 — HDR download menu serves a 404 `_hdr.avif` URL

Already documented in the aggregate as **R3-C1**. Repeated here for completeness of the color-fidelity track.

**Code:** `photo-viewer.tsx:189-190, 859-869`. The `_hdr.avif` filename is constructed unconditionally; the menu item is gated only on `image?.is_hdr && hdrDownloadHref`. There is no file-existence check, no per-image flag, no HEAD probe.

**Effect:** for genuine HDR sources (post-A1 backfill correctly identifies them), the menu offers a 404. The mobile bottom sheet (`info-bottom-sheet.tsx:471-490`) does not include the HDR menu item — silently better-off but inconsistent with desktop.

**Photographer-intent impact:** the photographer's HDR work is gated behind a download UX that silently fails. No graceful "HDR delivery coming soon" state.

---

### CF-CRIT-2 — PQ / HLG sources decoded as raw RGB without inverse OETF

**Code path:**
1. `color-detection.ts:228-288` `detectColorSignals` correctly identifies PQ/HLG via NCLX → writes `transferFunction = 'pq'|'hlg'`, `isHdr = true`.
2. `process-image.ts:684-867` `processImageFormats` does not check `colorSignals?.isHdr` or `colorSignals?.transferFunction`. The encode path is identical for sRGB, P3, AND PQ/HLG sources.
3. Sharp's `sharp(filepath)` decodes HEIF via libvips/libheif. For an HEIF with NCLX `transfer=16` (PQ), the libheif decoder reads the 10/12-bit PQ-encoded code values and **passes them through as RGB pixel values** — without applying the inverse PQ EOTF (which would map non-linear PQ values back to scene-linear nits).
4. `pipelineColorspace('rgb16')` operates on these as if they were linear-light RGB. They are not.
5. `toColorspace('p3').withIccProfile('p3').avif({bitdepth: 10})` emits a 10-bit P3-tagged AVIF. The pixel values are PQ-encoded but the ICC profile says they're Display P3 with sRGB-piecewise-tone-response.

**Consequence:** color-managed viewers (Safari 17+, Chrome 122+ on macOS / Windows 11) interpret the AVIF pixels as P3 sRGB-toned values. A pixel that was 100 nits in PQ-scene-referred (≈0.5 in PQ code value) is rendered as roughly 18% middle gray. A pixel that was 1000 nits (≈0.75 in PQ code value) is rendered as ~50% gray. **The shadow-to-highlight curve is wrong by a non-linear amount.**

For HLG (BT.2100 with the OOTF), the breakage is similar but the curve mismatch is gentler (HLG is closer to gamma-curve in the SDR portion).

**Why no test catches this:** the test fixtures `__tests__/process-image-color-roundtrip.test.ts`, `process-image-icc-options-lockin.test.ts`, `color-detection.test.ts` exercise SDR sources (sRGB / P3 / Adobe RGB / ProPhoto). No fixture is a real PQ HEIF with a known scene-luminance profile.

**Photographer-intent impact:** for the modal HDR-shooting persona (iPhone 15+ ProRAW, Sony Alpha HLG, Canon C-Log HEIF), the delivered image is silently wrong-toned. The badge says "HDR" (when on HDR display); the bytes are SDR-with-curve-mismatch. The photographer's intent — captured-with-1000-nit-highlights — is mis-rendered as muddy SDR.

**Fix shape:**
- **Direction A (honest):** at upload, when `signals.isHdr === true`, REJECT the upload with a clear error: "HDR sources cannot be ingested yet. Export as SDR P3 / sRGB JPEG and re-upload." Or accept the upload but mark `is_hdr=true` and show an admin warning + skip the encode step (publish as no-derivatives).
- **Direction B (eventually-correct):** apply BT.2390 EETF or ACES tonemap from PQ → SDR before encoding. Sharp lacks `tonemap_bt2390`; would need (a) avifenc shell-out OR (b) manual JS curve over rgb16 buffer OR (c) wait for libvips upstream.

This is plan-36 WI-09 territory. Until WI-09, **Direction A is the only honest behavior**.

---

### CF-CRIT-3 — `is_hdr` is in `publicSelectFields` while HDR delivery is missing

Already documented in the aggregate as **R3-C4**. Color-fidelity restatement:

**Code:** `data.ts:213-340`.

```ts
const adminSelectFields = {
    …
    color_pipeline_decision: images.color_pipeline_decision,  // line 213
    color_primaries: images.color_primaries,                   // line 214
    transfer_function: images.transfer_function,               // line 215
    matrix_coefficients: images.matrix_coefficients,           // line 216
    is_hdr: images.is_hdr,                                     // line 217
    pipeline_version: images.pipeline_version,
    …
};

const {
    latitude: _omitLatitude,
    longitude: _omitLongitude,
    filename_original: _omitFilenameOriginal,
    user_filename: _omitUserFilename,
    processed: _omitProcessed,
    original_format: _omitOriginalFormat,
    original_file_size: _omitOriginalFileSize,
    color_pipeline_decision: _omitColorPipelineDecision,
    pipeline_version: _omitPipelineVersion,
} = adminSelectFields;

const publicSelectFields = { … }; // is_hdr, color_primaries, transfer_function flow through
```

**Effect:** `is_hdr`, `color_primaries`, `transfer_function`, `matrix_coefficients` are exposed to public consumers. Public renders the HDR badge (`color-details-section.tsx:130-141`) on `image.is_hdr === true`.

But the encoded AVIF/WebP/JPEG bytes are SDR (per CF-CRIT-2 for genuine PQ sources, or per the `is_hdr=true` legacy false-positives if any backfilled rows persist). **The badge is a false promise.**

**Photographer-intent impact:** the photographer's HDR work is reported on the public viewer with a "HDR" pill that does not correspond to a HDR delivery. Confuses the visitor; misrepresents the gallery's capabilities.

**Fix shape (immediate):** move `is_hdr` (and `transfer_function`, `matrix_coefficients`) to admin-only. Public can keep `color_primaries` (since wide-gamut delivery via P3-tagged AVIF/WebP/JPEG is HONEST). Update `_PrivacySensitiveKeys` guard accordingly.

**Fix shape (eventual, after WI-09):** put `is_hdr` back into public when HDR delivery is honest. Add `hdr_variant_exists` column populated by the encoder; only emit the badge AND the download menu item when that column is true.

---

## 3. HIGH findings (visible breakage on a meaningful audience)

### CF-HIGH-1 — AdobeRGB / ProPhoto / Rec.2020 → P3 uses default rendering intent (relative-colorimetric clip)

**Code:** `process-image.ts:732-804` for the `p3-from-wide` path.

```ts
await base
    .toColorspace(avifIcc)        // 'p3'
    .withIccProfile(avifIcc)      // Apple Display P3 ICC
    .avif({ quality: qualityAvif, effort: 6, bitdepth: 10 })
    .toFile(outputPath);
```

`toColorspace('p3')` is libvips' `vips_icc_transform` with the **default** rendering intent — relative colorimetric, no black-point compensation. Source colors outside the P3 gamut clip to the P3 gamut boundary.

**Quantified loss** (from prior color-deep review CF-MED-4 and confirmed against AdobeRGB / ProPhoto / Rec.2020 → P3 in CIE LAB):

| Source primary | Δprimary in xy | Soft tissue / skin loss | Saturated foliage / dye loss |
|---|---|---|---|
| AdobeRGB green (0.21, 0.71) | Δy = +0.02 vs P3 (0.265, 0.69) | ΔE₂₀₀₀ ≤ 0.5 (skin) | ΔE₂₀₀₀ up to 4-6 on saturated greens |
| ProPhoto green (0.16, 0.84) | Δy = +0.15 vs P3 (0.265, 0.69) | ΔE ≤ 1 | ΔE up to 15.75 on cyan |
| Rec.2020 green (0.17, 0.797) | Δy = +0.11 vs P3 | ΔE ≤ 1 | ΔE up to 8 on saturated cyan / green |

For ProPhoto the issue is well-known and documented (`process-image.ts:482-487`). For AdobeRGB and Rec.2020 the documentation in `resolveColorPipelineDecision` (`process-image.ts:392-405`) says "P3 gamut-mapped" without acknowledging the clip.

**Photographer-intent impact:**
- Wedding photographer shooting AdobeRGB Mavic Pro greens: hard clip on the saturated foliage, no soft-rolloff. Photographer cannot tell from the audit label.
- Landscape photographer working in ProPhoto for highest-saturation rendering: P3 delivery clips cyans and saturated reds.

**Fix shape:**
- WI-13 (deferred per plan-36) — CIECAM02 perceptual rendering intent via LCMS2. Adds operational dependency. Currently un-implemented.
- Quick win: update the audit label for `p3-from-{adobergb,prophoto,rec2020}` to say "(may clip saturated colors)".
- Photographer-facing: add a "wide-gamut clip warning" pip in the ColorDetails panel when the source primaries are wider than P3.

---

### CF-HIGH-2 — `bit_depth` field shows source depth, not delivered depth

**Code:** `process-image.ts:600-602`, `photo-viewer.tsx:754-758`, `info-bottom-sheet.tsx:394-398`.

The encoder reads Sharp's `metadata.depth` (a string like `'ushort'` for 16-bit) and stores the bit count in `images.bit_depth`. The EXIF panel renders `{image.bit_depth}-bit`.

For a 16-bit ProPhoto TIFF source: `bit_depth = 16`. AVIF caps at 10-bit (Sharp 0.34); WebP / JPEG cap at 8-bit. The delivered image is 10-bit AVIF (on capable browsers) or 8-bit fallback.

For a 12-bit HEIF: `bit_depth = 12`. Same delivery cap.

**Photographer-intent impact:** "Bit Depth: 16-bit" reads as a delivery promise. The photographer (or curious viewer) believes the AVIF carries 16-bit precision; it doesn't. For deep gradients (skies, gradients between skin midtones and shadows) that the photographer chose to retain at 16-bit-precision in their source, the actual delivery quantizes to 10-bit at best. **The audit label silently overstates the delivery fidelity.**

**Fix shape:**
- Rename the EXIF row from "Bit Depth" to "Source Bit Depth" (UX-MED-1 fix).
- Add a separate "Delivered" line showing 10-bit (wide-gamut AVIF) or 8-bit (sRGB AVIF, all WebP, all JPEG).
- Compute on-the-fly: `deliveredBitDepth = isWideGamutSource && supportsHighBitdepthAvif ? 10 : 8`.
- Or store it in a new `delivered_avif_bit_depth` column.

---

### CF-HIGH-3 — Public `is_hdr` exposure (already CF-CRIT-3 above, kept here as cross-reference for the color-fidelity narrative)

See section 2. CF-CRIT-3.

---

### CF-HIGH-4 — Firefox `(color-gamut: p3)` MQ is permanently false; histogram falls back to JPEG

**Code:** `histogram.tsx:55-57`.

```ts
const _cachedSupportsCanvasP3 = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(color-gamut: p3)').matches;
```

This is **module-evaluated** at import time. On Firefox (all platforms), `window.matchMedia('(color-gamut: p3)').matches` is **always false**, regardless of the actual display. Mozilla bug 1591455 — the `color-gamut` media query feature is gated behind a pref.

**Effect:** on Firefox + macOS (with built-in P3 display), the histogram never enters the canvas-P3 path. The `imageUrl` JPEG is loaded into a default-sRGB canvas, the histogram displays sRGB-clipped pixel values for a wide-gamut source, and the "(sRGB clipped)" indicator fires correctly.

This is technically correct behavior (the indicator fires), but Firefox + P3 display is a meaningful audience (Mozilla market share, especially in EU). For these users the histogram is worse than it could be.

**Fix shape:**
- Replace the MQ check with a runtime canvas-P3 feature probe:
  ```ts
  const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
  const probe = ctx?.getContextAttributes?.()?.colorSpace === 'display-p3';
  ```
  This works on Firefox 113+ (which shipped canvas-P3 in 2023) regardless of the MQ.
- Cache the result at module scope after first probe.

---

### CF-HIGH-5 — DCI-P3 source decision label says "p3-from-dcip3" but the delivered profile IS Display P3

**Code:** `process-image.ts:415, 462-475`, `color-details-section.tsx:36`.

`resolveAvifIccProfile('DCI-P3')` returns `'p3'` (lumped with Display P3 / P3-D65). The encoder calls `withIccProfile('p3')` which embeds Apple's Display P3 ICC.

`resolveColorPipelineDecision('DCI-P3')` returns `'p3-from-dcip3'`.

Humanizer renders "P3 (from DCI-P3)" in the admin Color Details accordion.

**Photographer-intent impact:** the audit reads as "your DCI-P3 source was mastered to home P3" — accurate. But the embedded ICC is `Display P3` which is the D65 white-point variant. The Bradford adaptation in `toColorspace('p3')` correctly shifts the source DCI white (0.314, 0.351) → D65 (0.3127, 0.3290). Verified in WI-12 test fixture (mean ΔE = 0).

**No miscolor.** This is **a labeling concern**: the audit should say "DCI-P3 source → Display P3 delivery (D65 adapted)" so the photographer understands what happened.

**Fix shape:** humanizer label rewrite:
- `'p3-from-dcip3'` → "Display P3 (from DCI-P3, D65 adapted)" or similar.

Severity: **MED** (label-only). Not actually a fidelity issue.

---

## 4. MED findings

### CF-MED-1 — `force_srgb_derivatives` admin toggle does not affect AVIF; help text is honest but the name is misleading

**Code:** `gallery-config-shared.ts:35-108`, `process-image.ts:653-655`.

When `force_srgb_derivatives = true`:
- WebP / JPEG → sRGB ✓
- AVIF → still P3 / p3-from-wide

Help text (`en.json:651`): "When ON, WebP and JPEG variants are always sRGB regardless of source color space. Use this only if downstream consumers (legacy embedders, specific clients) require sRGB JPEGs. AVIF variants always carry their original gamut."

**Photographer-intent impact:** for a paranoid e-commerce / stock-photo operator who wants to guarantee "sRGB everywhere" for client platform compat, the toggle name is misleading. They expect "force sRGB derivatives" to mean ALL derivatives. The help text honestly says it doesn't.

**Fix shape:**
- Rename to `force_srgb_8bit_fallbacks` or `force_srgb_webp_jpeg`, OR
- Add a second toggle `force_srgb_avif` (defaults false) for paranoid operators.

Severity: **MED**.

---

### CF-MED-2 — No surface for "your display cannot show this photo's full saturation"

**Code:** none — surface does not exist.

**Photographer-intent impact:** photographer uploads vivid P3 sunset; visitor on sRGB monitor (Windows laptop, older Android) sees sRGB-clipped delivery via WebP/JPEG sRGB fallback. The browser correctly clipped; no signal to the visitor that "additional saturation was available."

**Fix shape:** small status tag in the EXIF panel:
- Hidden by default.
- Visible via JS feature-detect when `window.matchMedia('(color-gamut: p3)').matches === false` AND `image.color_primaries === 'p3-d65'` (or wider).
- Text: "Your display shows the sRGB version of this photo. The full Display P3 saturation is available on supported displays."
- Localized.

---

### CF-MED-3 — DCI-P3 audit jargon

See CF-HIGH-5.

---

### CF-MED-4 — Histogram clip / overexposure markers absent

Cross-reference: ui-ux-photographer.md UX-HIGH-4.

A pro-grade histogram has:
- A 0% / 25% / 50% / 75% / 100% grid.
- Clip blink (0/255 bins).
- % below black + % above white text overlay.
- Per-channel maxima (R/G/B clip indicators).

Today our histogram shows the bin envelope only. Photographer cannot use it to verify exposure intent.

**Fix shape:** drawing additions in `histogram.tsx:166-234`. No new data; canvas overlay only.

---

### CF-MED-5 — `(P3)` purple chip contrast below WCAG AA

**Code:** `photo-viewer.tsx:692-696`, `info-bottom-sheet.tsx:332-336`.

```tsx
<span className="ml-1.5 inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded gamut-p3-badge">
  P3
</span>
```

`text-[10px]` violates the 12px / 11px floor applied elsewhere in the codebase. Contrast `purple-700 on purple-100 = ~5.0:1` (light) — passes 4.5:1 only marginally for normal text and FAILS 3:1 for any text below 14px non-bold.

**Fix shape:**
- Bump to `text-[11px] font-bold`.
- Use higher-contrast palette (`bg-purple-200 text-purple-900` light, `bg-purple-900 text-purple-100` dark).
- Or replace the chip with an SVG glyph + tooltip.

Severity: **MED**.

---

### CF-MED-6 — Rec.2020 source detection is name-only; CICP-only Rec.2020 AVIFs route to sRGB

**Code:** `color-detection.ts:38-50`, `process-image.ts:485-487`.

The Rec.2020 source detection in `resolveAvifIccProfile` and `resolveColorPipelineDecision` matches `name.includes('rec.2020')` etc. on the ICC name. For an AVIF or HEIF that has no ICC profile but carries `nclx primaries=9 (BT.2020)`, the code path:

1. `extractIccProfileName(metadata.icc) → null`.
2. `resolveAvifIccProfile(null) → 'srgb'`.
3. `resolveColorPipelineDecision(null) → 'srgb-from-unknown'`.
4. Encoder emits sRGB.

Meanwhile `detectColorSignals` correctly identifies `colorPrimaries = 'bt2020'` from the NCLX box. The signal is stored in `images.color_primaries` but the encoder doesn't read it — it only reads `iccProfileName`.

**Effect:** a Rec.2020-tagged-via-CICP-only AVIF (e.g. some screen-capture tools, Chrome's `<canvas>` colorSpace=rec2020) is delivered as sRGB-clipped. The audit label says `srgb-from-unknown`. The `color_primaries` column says `bt2020`. Inconsistent.

**Fix shape:**
- `resolveAvifIccProfile` and `resolveColorPipelineDecision` should accept the `ColorSignals` (with NCLX primaries) as a fallback when ICC name is null.
- OR `processImageFormats` should pre-compute the effective decision using both inputs and pass a single resolved decision into the encode chain.

Severity: **MED** (rare in photographer workflow; most Rec.2020 stills carry ICC).

---

## 5. LOW findings

- **CF-LOW-1** — DCI-P3 detection uses `name.includes('dci-p3')` but ICC names sometimes include "DCI(P3)" or "Cinema P3" — no match, falls through to `'srgb'`. Pro mastering exports may be affected. Add additional aliases.
- **CF-LOW-2** — `humanizeColorPrimaries('bt2020')` returns "Rec. 2020" but `humanizeTransferFunction('hlg')` returns "HLG" — inconsistent terminology depth (one expanded, the other acronym). Pick a register.
- **CF-LOW-3** — No locale-formatted name for ProPhoto in Korean. Renders English fallback.
- **CF-LOW-4** — `_cachedSupportsCanvasP3` snapshot is module-load-time. If user moves the laptop to an external sRGB monitor mid-session, the histogram doesn't re-probe.
- **CF-LOW-5** — No surface to say "this photo's source was tagged Display P3 but the actual chromaticities don't match" (chromaticity-based detection, plan-35 §10.1, deferred). For pro photographers using custom monitor profiles, the ICC name might be a custom string that falls through to `'srgb-from-unknown'` despite the actual gamut being P3.

---

## 6. Browser × Display compatibility matrix

For each (browser, display) combo, what does a Display P3 AVIF source deliver?

| Browser | OS | Display | AVIF P3 ICC honored | WebP P3 ICC honored | JPEG P3 ICC honored | Histogram canvas-P3 | HDR badge MQ |
|---|---|---|---|---|---|---|---|
| Safari 17+ | macOS 14+ | Internal P3 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Safari 17+ | iOS 17+ | iPhone 13-15 (P3 + HDR) | ✓ | ✓ | ✓ | ✓ | ✓ on Pro |
| Chrome 122+ | macOS / Windows | Internal P3 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Chrome 122+ | Android | Pixel 7+ (P3) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Edge 122+ | Windows 11 | Dell U2723QE (P3) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Firefox 124+ | macOS | Internal P3 | ✓ | ✓ | ✓ | **✗ (CF-HIGH-4)** | ✗ |
| Firefox 124+ | Windows | Dell U2723QE | ✓ | ✓ | ✓ | **✗** | ✗ |
| Chrome 122+ | Android | Mid-range Android (sRGB) | sRGB-clipped | sRGB-clipped | sRGB-clipped | sRGB | ✗ |
| Safari 16 | iOS 16 | iPhone X (P3, no HDR) | ✓ | ✓ | ✓ | ✓ | ✗ |
| Older mobile (Chrome 115-) | Android | sRGB | sRGB-clipped | sRGB-clipped | sRGB-clipped | sRGB | ✗ |

**Photographer-intent gaps:**

1. **Firefox + P3 = sRGB histogram** (CF-HIGH-4). Photographer who reviews their gallery on Firefox sees sRGB-clipped histogram for their wide-gamut work.
2. **Mid-range Android = sRGB-clipped delivery, no remediation hint** (CF-MED-2). Visitor sees sRGB version, no signal that more saturation exists.
3. **HDR display detection (`@media (dynamic-range: high)`) is Safari-only in practice.** Chrome / Firefox on HDR-capable monitors still report `dynamic-range: standard`. The HDR badge is therefore Safari-exclusive on HDR displays.

The latter two are **HIGH** for the photographer's audience reach but **MED** for the gallery quality (the bytes are correct; the verification surface lags).

---

## 7. ICC handling

### 7.1 Current parser

`icc-extractor.ts` handles ICC v2 `desc` (ASCII) and ICC v4 `mluc` (UTF-16BE). Both are bounded (tagCount ≤ 100, string length ≤ 1024 chars, dataSize-aware). Good.

### 7.2 Edge cases not covered

- **Custom monitor profiles**: a photographer with an X-Rite calibrated Eizo monitor exports with a custom ICC like "EIZO ColorEdge CG2700X-2026-04-12.icc". Profile description string doesn't match any allowlist; falls through to `'srgb-from-unknown'` in the resolver — but the ACTUAL profile may be wider than sRGB. **Photographer intent silently lost.**
- **Camera-embedded profiles**: Sony / Canon / Nikon sometimes embed proprietary ICCs (e.g. "Sony S-Log3 Cine Custom Master"). Same fall-through.
- **Profile-tag-only AVIF / HEIF** (ICC + NCLX both): `parseCicpFromHeif` returns the NCLX triplet, ICC parser returns the ICC name. `detectColorSignals` lets NCLX win (`color-detection.ts:273-277`). But the encoder reads `iccProfileName` only — not `colorSignals`. So the rendering decision is still ICC-name-driven. **CF-MED-6 above.**

### 7.3 Chromaticity-based detection (plan-35 §10.1, deferred)

For custom / pro-mastering profiles, parsing `wtpt` + `rXYZ` + `gXYZ` + `bXYZ` from the ICC and matching against gamut presets (sRGB, P3, AdobeRGB, ProPhoto, Rec.2020) within ΔE₂₀₀₀ ≤ 0.005 would catch the cases above. Library: pure JS, ~150 lines.

**Severity:** MED for completeness; LOW for this iteration.

---

## 8. Test coverage gaps

Under `apps/web/src/__tests__/`:

- ✓ `process-image-color-roundtrip.test.ts` — covers sRGB / P3 round-trip
- ✓ `process-image-icc-options-lockin.test.ts` — verifies ICC options
- ✓ `process-image-p3-icc.test.ts` — P3 ICC tag presence
- ✓ `process-image-exif-strip.test.ts` — EXIF stripping
- ✓ `color-detection.test.ts` — heuristic + NCLX
- ✓ `og-image-icc.test.ts` — OG always sRGB
- ✓ `backfill-color-pipeline.test.ts` — backfill column read
- ✗ **No HDR PQ HEIF round-trip test** — CF-CRIT-2 not covered
- ✗ **No HLG HEIF round-trip test**
- ✗ **No Rec.2020 NCLX-only AVIF test** — CF-MED-6 not covered
- ✗ **No chromaticity-based-detection test**
- ✗ **No `force_srgb_derivatives=true` AVIF test** to verify the AVIF still emits P3 (CF-MED-1)
- ✗ **No bit-depth-delivered fixture** — CF-HIGH-2 not surfaced

Adding these fixtures would have caught CF-CRIT-2 in CI before any photographer felt it.

---

## 9. Recommended fixes (color-fidelity track)

Numbered to align with the plan in `.context/plans/38-photographer-r3-followup.md`:

1. **CF-CRIT-1 → P3-1** Close HDR download dropdown landmine.
2. **CF-CRIT-2 → P3-2** Reject HDR ingest with clear error until WI-09 ships.
3. **CF-CRIT-3 / CF-HIGH-3 → P3-3** Move `is_hdr` (+ transfer_function, matrix_coefficients) to admin-only fields.
4. **CF-HIGH-1 → P3-4** Update audit labels for `p3-from-{adobergb,prophoto,rec2020}` to acknowledge clip.
5. **CF-HIGH-2 → P3-5** Distinguish source vs. delivered bit depth.
6. **CF-HIGH-4 → P3-6** Replace canvas-P3 MQ with feature probe.
7. **CF-HIGH-5 → P3-7** Rewrite DCI-P3 audit label.
8. **CF-MED-2 → P3-8** Add "your display can't show full saturation" hint for sRGB visitors on wide-gamut photos.
9. **CF-MED-4 → P3-9** Histogram clip / overexposure markers.
10. **CF-MED-5 → P3-10** P3 chip contrast bump.
11. **CF-MED-6 → P3-11** Use `colorSignals` (NCLX) as fallback when ICC name is null.
12. **Test infrastructure → P3-12** Add HDR / Rec.2020 / chromaticity test fixtures.

---

## 10. Out of scope (per task premise)

- Edit / culling / scoring features.
- Camera RAW demosaic.
- Print color management (CMYK).
- Soft-proof / target-display preview.
- 3D LUT support.
- Video / cine.
- Color picker / eye-dropper.
- Custom ICC generator UI.

These remain explicitly excluded.
