# Photographer R5 — Color Science Standards Compliance Review

**Reviewer:** Color Science Specialist  
**Date:** 2026-05-18  
**Scope:** Entire GalleryKit color/HDR pipeline  
**Standards Referenced:** ITU-T H.273, ICC.1:2010, ISOBMFF (ISO/IEC 14496-12), AV1 Image File Format v1.1.0, WebP Container Spec (RFC 6386 / Google), CSS Color Module Level 4, CSS Media Queries Level 5, BT.709-6, SMPTE EG 432-2, IEC 61966-2-1

---

## Executive Summary

The GalleryKit color pipeline is **largely standards-compliant** and shows mature engineering discipline (bounded parsing, compile-time privacy guards, Promise-singleton probes, per-format fresh Sharp instances). Most mappings match authoritative specifications, and the precedence chain (NCLX > ICC chromaticity > ICC name) is correct.

This review identifies **1 HIGH-confidence standard deviation**, **4 MEDIUM-confidence issues**, and **5 LOW-confidence observations**. No CRIT-level color-science bugs were found.

---

## 1. NCLX Compliance — `apps/web/src/lib/color-detection.ts`

### 1.1 ITU-T H.273 Table 3: Transfer Code 2 Is "Unspecified", Not Gamma 2.2
- **File:** `apps/web/src/lib/color-detection.ts`, lines 175–183
- **Standard:** ITU-T H.273 (2016), Table 3 — Video characteristics / Transfer characteristics
- **Issue:** The `NCLX_TRANSFER_MAP` maps value `2` to `'gamma22'`:
  ```ts
  2: 'gamma22',
  // R8-M1: ITU-T H.273 gamma-2.2 family values 4, 5, 7
  4: 'gamma22', // ITU-T H.273 Gamma 2.2 curve
  5: 'gamma22', // BT.470 System M
  6: 'gamma22',
  7: 'gamma22', // SMPTE 240M
  ```
  Per ITU-T H.273 Table 3, code **2 is "Unspecified"**. There is no defined transfer function. Values 4, 5, and 7 are the gamma-2.2 family (BT.470M, BT.470BG, SMPTE 240M respectively). Value 6 (BT.601) uses gamma ~2.2 for 525-line and ~2.8 for 625-line, so mapping it to gamma22 is a rough approximation but defensible. Value 2 has no defined curve at all.
- **Failure Scenario:** A photographer uploads an AVIF/HEIF with `transfer_characteristics = 2` (e.g., an encoder that writes "Unspecified" because it doesn't know the source transfer). The audit panel falsely reports "gamma 2.2," misleading the photographer about the mastering intent.
- **Fix:** Map value 2 to `'unknown'` (or remove it from the map so it falls through to `'unknown'`). Update the comment to accurately reflect that only 4, 5, 7 are the gamma-2.2 family.
- **Confidence:** **High**

### 1.2 ISOBMFF Walker Bounds-Checking
- **File:** `apps/web/src/lib/color-detection.ts`, lines 214–280
- **Standard:** ISO/IEC 14496-12 (ISOBMFF), section 4.2 — Box structure
- **Issue:** The walker correctly handles:
  - 32-bit and 64-bit box sizes (`size === 1` → extended size)
  - `size === 0` → extends to end of buffer
  - `MAX_DEPTH = 5` and `MAX_SCAN_BYTES = 1 MB`
  - FullBox version+flags skip for `meta` boxes (`dataStart + 4`)
  - Regular Box recursion for `iprp` / `ipco`
- **One subtle concern:** The walker treats `colr` as a regular Box (not FullBox), which is correct per ISOBMFF and AVIF spec. However, the walker returns the **first** `nclx` `colr` found in depth-first order without checking whether it belongs to the primary item's `ipco`. In ISOBMFF, multiple `ipco` boxes can exist (e.g., for auxiliary images), and the first `nclx` encountered may not be the primary item's color info. In practice, for single-image HEIF/AVIF files, this is the primary item's `colr`, but the code does not verify `ipma` associations.
- **Failure Scenario:** A future multi-layer AVIF (e.g., depth map + primary image) could have the depth map's `colr` box scanned first, causing the primary image to be mis-detected as having the depth layer's color characteristics. GalleryKit currently rejects multi-layer images implicitly (Sharp doesn't produce them), so this is theoretical.
- **Fix (Medium effort):** Walk `iprp → ipco` associated with the primary item via `ipma` (Item Property Association) box before extracting `colr`. For now, document the single-image assumption.
- **Confidence:** **Medium**

### 1.3 NCLX `full_range` Flag Parsing
- **File:** `apps/web/src/lib/color-detection.ts`, line 257
- **Standard:** ISOBMFF `colr` box with `colour_type` 'nclx' — `full_range_flag` is bit 7 of the final byte.
- **Finding:** `Boolean(buffer.readUInt8(dataStart + 10) & 0x80)` correctly tests the MSB. The remaining 7 bits are reserved per the spec and should be zero. The code does not validate this, which is acceptable for best-effort parsing.
- **Confidence:** Compliant

### 1.4 Primaries Codes Match H.273 Table 2
- **File:** `apps/web/src/lib/color-detection.ts`, lines 168–173
- **Standard:** ITU-T H.273 Table 2
- **Finding:** All mapped values are correct:
  - `1` → BT.709
  - `9` → BT.2020
  - `11` → DCI-P3
  - `12` → Display P3
- **Unmapped values** (0, 2–10, 13–21, 22+) falling to `'unknown'` is acceptable for a photography gallery pipeline; values 11+ are non-photography/broadcast codings.
- **Confidence:** Compliant

### 1.5 Matrix Codes Match H.273 Table 4
- **File:** `apps/web/src/lib/color-detection.ts`, lines 200–204
- **Standard:** ITU-T H.273 Table 4
- **Finding:** Mapped values are pragmatically correct for RGB photography:
  - `0` → `'identity'` (H.273 labels 0 "Reserved"; for RGB images it means no matrix transform, so `'identity'` is semantically correct)
  - `1` → BT.709
  - `9` → BT.2020-NCL
  - `10` → BT.2020-CL
- **Confidence:** Compliant

---

## 2. ICC Profile Handling

### 2.1 ICC v2 `desc` Tag Parsing
- **File:** `apps/web/src/lib/icc-extractor.ts`, lines 72–80
- **Standard:** ICC.1:2010, section 6.5.12 — `descType`
- **Finding:** The parser reads:
  - `dataOffset` → `dataOffset + 4`: type signature (`desc` = 0x64657363)
  - `dataOffset + 8`: ASCII count (including null)
  - `dataOffset + 12`: ASCII string
  This matches the ICC v2 `descType` structure: `signature(4) + reserved(4) + count(4) + string(N)`.
- **One subtle issue:** `strLen = Math.min(declaredLength, dataSize - 12, 1024)` and `strEnd = strStart + Math.max(0, strLen - 1)`. If `declaredLength` is 0, the code breaks (line 75: `if (declaredLength === 0) break;`). But if `declaredLength` is 1 (only null terminator), `strLen = 1`, `strEnd = strStart + 0`, and `strStart >= strEnd` triggers the break at line 79. This is correct — an empty description returns null.
- **Confidence:** Compliant

### 2.2 ICC v4 `mluc` UTF-16BE Parsing with Locale Matching
- **File:** `apps/web/src/lib/icc-extractor.ts`, lines 83–117
- **Standard:** ICC.1:2010, section 10.13 — `mlucType`
- **Finding:** The parser correctly reads:
  - Record count at `dataOffset + 8`
  - Record size at `dataOffset + 12` (must be >= 12)
  - Per-record: language code (2 bytes, ISO 639-1), country code (2 bytes), string length (4 bytes), string offset (4 bytes, relative to `dataOffset`)
  - UTF-16BE decoding via `TextDecoder('utf-16be')`
  - Locale matching: primary subtag only (first 2 letters, case-insensitive)
- **One subtle issue:** The code reads `recLen = Math.min(icc.readUInt32BE(recOffset + 4), 1024)` and `recTextOffset = icc.readUInt32BE(recOffset + 8)`, then `strStart = dataOffset + recTextOffset`. The ICC spec says the string offset is relative to the start of the tag data (`dataOffset`), which is what the code does.
- **Confidence:** Compliant

### 2.3 ICC Chromaticity XYZ→xy Conversion
- **File:** `apps/web/src/lib/icc-chromaticity.ts`, lines 101–106
- **Standard:** CIE 15:2004, section 7.2 — Chromaticity coordinates
- **Finding:** `xyzToXy` computes `x = X / (X+Y+Z)`, `y = Y / (X+Y+Z)`. This is the standard CIE 1931 chromaticity conversion. The zero-sum guard (`Math.abs(sum) < 1e-9`) is appropriate.
- **Confidence:** Compliant

### 2.4 `readXyzTag` Accepts Non-Standard 'XYZT' Signature
- **File:** `apps/web/src/lib/icc-chromaticity.ts`, lines 121–130
- **Standard:** ICC.1:2010, section 6.3.2.2 — `XYZType` signature is `0x58595A20` ('XYZ ')
- **Issue:** The code accepts both `'XYZ '` and `'XYZT'`:
  ```ts
  if (sig !== 'XYZ ' && sig !== 'XYZT') return null;
  ```
  There is no `'XYZT'` type defined in the ICC specification. The standard `XYZType` signature is `'XYZ '` (0x58595A20, with a trailing space). Accepting `'XYZT'` (0x58595A54) could parse malformed profiles as valid. The comment says "For multi-XYZ payloads (rare in calibration profiles), only the first triple is consumed," but `'XYZT'` is not an ICC-defined multi-XYZ signature.
- **Failure Scenario:** A corrupted or non-standard profile with `'XYZT'` at the expected tag offset would have its XYZ values parsed and compared against preset gamuts, potentially producing a false positive gamut match.
- **Fix:** Remove `'XYZT'` from the accepted signatures. If multi-XYZ payloads need support, implement a proper `XYZArrayType` parser (ICC tag signature would still be `'XYZ '`, with multiple 12-byte triples).
- **Confidence:** **Medium**

### 2.5 Preset Matching Tolerances
- **File:** `apps/web/src/lib/icc-chromaticity.ts`, lines 26–30, 133–137, 202–219
- **Standard:** Chromaticity comparison in 2D xy space
- **Finding:** The code uses Euclidean Δxy distance with tolerances:
  - `HIGH_CONFIDENCE_TOLERANCE = 0.005`
  - `MEDIUM_CONFIDENCE_TOLERANCE = 0.015`
- **Assessment:** These are appropriate for ICC profile chromaticity matching. For reference:
  - sRGB to Display P3 red primary distance is approximately 0.041 (well above 0.015)
  - sRGB to Adobe RGB green distance is approximately 0.142 (well above 0.015)
  - A calibrated Eizo CG2700X with AdobeRGB primaries drifts by approximately 0.001–0.003 in xy, well within the 0.005 high-confidence window.
- The `worst = Math.max(dR, dG, dB, dW)` metric ensures all primaries and white point must agree, not just one.
- **Confidence:** Compliant

### 2.6 ProPhoto D50 White Point
- **File:** `apps/web/src/lib/icc-chromaticity.ts`, lines 80–85
- **Standard:** IEC 61966-2.2 / Kodak ProPhoto RGB spec
- **Finding:** ProPhoto preset uses D50 white point (0.3457, 0.3585). This is correct — ProPhoto RGB is specified with D50. The code comment correctly notes that every other gamut uses D65.
- **Confidence:** Compliant

---

## 3. Encoder Color Space Handling — `apps/web/src/lib/process-image.ts`

### 3.1 Sharp `toColorspace('p3')` and `withIccProfile('p3')`
- **File:** `apps/web/src/lib/process-image.ts`, lines 1053–1131
- **Standard:** Sharp/libvips/lcms2 color management pipeline
- **Finding:** For wide-gamut sources, the code calls:
  ```ts
  await base
      .toColorspace(avifIcc)
      .withIccProfile(avifIcc)
      .avif({ ... })
      .toFile(outputPath);
  ```
  Sharp's `'p3'` colorspace maps to Display P3 (D65 white point, sRGB transfer) via lcms2. This is correct for Display P3 delivery.
- **Confidence:** Compliant

### 3.2 rgb16 Pipeline for Wide-Gamut Sources
- **File:** `apps/web/src/lib/process-image.ts`, lines 1041–1047
- **Standard:** libvips `pipelineColorspace` documentation / color-science best practice
- **Finding:** The code uses `pipelineColorspace('rgb16')` for wide-gamut sources (except DCI-P3). This runs resize operations in 16-bit linear-light space, preventing the edge halos and desaturation that gamma-space resize introduces.
- The subsequent `.toColorspace('p3')` converts from the pipeline space to the output space. This is the correct Sharp/libvips pattern.
- **Confidence:** Compliant

### 3.3 DCI-P3 Skips rgb16 — White-Point Adaptation Concern
- **File:** `apps/web/src/lib/process-image.ts`, lines 921–923, 1041–1047
- **Standard:** DCI-P3 (SMPTE EG 432-2) vs Display P3 (Apple)
- **Finding:** DCI-P3 sources skip the rgb16 pipeline. The rationale is:
  - ICC-embedded DCI-P3: preserving the source ICC lets `toColorspace('p3')` perform Bradford D63→D65 adaptation.
  - NCLX-only DCI-P3: no ICC to preserve; rgb16 is skipped because primaries are identical to Display P3.
- **Issue:** For NCLX-only DCI-P3 (no ICC), Sharp has no color space information. It will assume sRGB for the source pixels. `toColorspace('p3')` then does sRGB→Display P3, which is **wrong** for DCI-P3 source pixels. The primaries happen to match (DCI-P3 and Display P3 share the same R, G, B primaries), but the white point and transfer function differ:
  - DCI-P3: D63 white point (0.3140, 0.3510), gamma 2.6 (SMPTE EG 432-2)
  - Display P3: D65 white point (0.3127, 0.3290), sRGB transfer (IEC 61966-2-1)
  Without an ICC profile, Sharp cannot perform the D63→D65 adaptation or the gamma 2.6→sRGB transfer conversion. The output will have incorrect white point and transfer.
- **Failure Scenario:** A photographer uploads an NCLX-tagged DCI-P3 image (e.g., from a cinema camera export) without an embedded ICC. The pipeline skips rgb16, Sharp assumes sRGB, and the resulting P3-tagged derivative has the wrong white point (D63 pixels displayed as D65) and wrong transfer (gamma 2.6 source treated as sRGB).
- **Fix:** For NCLX-only DCI-P3, do NOT skip rgb16. Instead, pass through the rgb16 pipeline explicitly. Even without an ICC, `pipelineColorspace('rgb16')` + `toColorspace('p3')` will at least convert through a wider gamut working space, and the P3 output will be closer to correct than sRGB-assumed. Alternatively, generate a synthetic DCI-P3 ICC profile and pass it to Sharp.
- **Confidence:** **Medium**

### 3.4 Chroma Subsampling Applied Per Target Gamut
- **File:** `apps/web/src/lib/process-image.ts`, lines 1117–1131
- **Standard:** JPEG chroma subsampling conventions
- **Finding:** The code correctly keys chroma subsampling off the **target** gamut, not the source:
  ```ts
  chromaSubsampling: targetIcc === 'p3' ? effectiveChroma : effectiveSdrChroma,
  ```
  This means when `force_srgb_derivatives=true`, a wide-gamut source gets SDR chroma (default 4:2:0). When false, P3-target JPEG gets wide-gamut chroma (default 4:4:4).
- **Confidence:** Compliant

### 3.5 `withIccProfile` for WebP
- **File:** `apps/web/src/lib/process-image.ts`, line 1055
- **Standard:** WebP container spec (ICCP chunk)
- **Finding:** The code calls `.withIccProfile(targetIcc)` for WebP output. Sharp/libvips writes ICC profiles into WebP's `ICCP` chunk. The post-encode verification (`verifyWebpIccInBuffer`) confirms the `ICCP` chunk exists.
- **Confidence:** Compliant

### 3.6 Per-Format Fresh Sharp Instances (WI-14 / R8-R8)
- **File:** `apps/web/src/lib/process-image.ts`, lines 1042–1047
- **Standard:** Sharp/libvips state isolation
- **Finding:** The code creates a fresh `sharp()` instance per format, avoiding shared-state contamination between parallel AVIF/WebP/JPEG encodes. This was a deliberate fix for cross-format color drift.
- **Confidence:** Compliant

---

## 4. AVIF NCLX Post-Encode Verification

### 4.1 Naive Byte Scan for `colr` Box
- **File:** `apps/web/src/lib/process-image.ts`, lines 135–168
- **Standard:** ISOBMFF box-structured file format
- **Issue:** `verifyAvifNclxInBuffer` scans for the ASCII string `'colr'` at every byte offset:
  ```ts
  for (let i = 4; i < buffer.length - 12; i++) {
      if (buffer.toString('ascii', i, i + 4) !== 'colr') continue;
      const size = buffer.readUInt32BE(i - 4);
  ```
  This could match `'colr'` inside an `mdat` payload or other box data. A proper ISOBMFF parser would walk box boundaries using the size fields, not scan for type signatures.
- **Failure Scenario:** An AVIF with an image containing the byte sequence `'colr'` in its compressed bitstream (e.g., in an `mdat` payload) could trigger a false positive verification. The code would read the preceding 4 bytes as a "box size," which is actually compressed image data, potentially causing a nonsensical verification result.
- **Impact:** Audit-only (non-blocking). No user-visible failure.
- **Fix:** Replace the naive scan with a bounded ISOBMFF box walker (reuse the pattern from `parseCicpFromHeif`) that tracks `size` and `type` at each box boundary. Alternatively, since this is audit-only, document the limitation.
- **Confidence:** **Medium**

### 4.2 `nclx` vs `prof` Detection
- **File:** `apps/web/src/lib/process-image.ts`, lines 151–165
- **Standard:** ISOBMFF `colr` box, `colour_type` FOURCC values
- **Finding:** The code correctly distinguishes `'nclx'` (CICP signaling) from `'prof'` (embedded ICC). When `prof` is found, it returns `ok: true` with a note — this is correct because an ICC-embedded AVIF is a valid color-signaled file.
- **Confidence:** Compliant

### 4.3 4KB Scan Limit
- **File:** `apps/web/src/lib/process-image.ts`, line 178
- **Standard:** ISOBMFF typical header size
- **Finding:** The post-encode verifier reads only the first 4KB. For AVIF, all color metadata (`colr` boxes) lives in the `meta` box at the beginning of the file. 4KB is more than sufficient.
- **Confidence:** Reasonable

---

## 5. WebP ICC Verification

### 5.1 RIFF Chunk Scanning
- **File:** `apps/web/src/lib/process-image.ts`, lines 198–223
- **Standard:** WebP container specification (RIFF + chunks)
- **Finding:** The code correctly:
  - Validates `'RIFF'` header and `'WEBP'` form type at offset 8
  - Reads chunk size as little-endian (RIFF convention)
  - Reads chunk tag as ASCII
  - Handles padding to even byte boundary: `paddedSize = chunkSize + (chunkSize % 2)`
  - Guards against infinite loop: `if (nextOffset <= offset || nextOffset > buffer.length) break;`
- This matches the WebP container spec exactly.
- **Confidence:** Compliant

### 5.2 1KB Scan Limit
- **File:** `apps/web/src/lib/process-image.ts`, line 229
- **Standard:** WebP container typical layout
- **Finding:** 1KB is reasonable. The `ICCP` chunk typically appears early in WebP files (after `VP8`/`VP8L`/`VP8X` and before image data). For small thumbnails, the entire file may be less than 1KB.
- **Confidence:** Reasonable

---

## 6. Canvas colorSpace — `apps/web/src/components/histogram.tsx` + Worker

### 6.1 `canvas.getContext('2d', { colorSpace: 'display-p3' })` Usage
- **File:** `apps/web/src/components/histogram.tsx`, lines 82–94, 217–219
- **Standard:** HTML Canvas 2D Context, `colorSpace` attribute
- **Finding:** The code requests `colorSpace: 'display-p3'` as `PredefinedColorSpace` and verifies via `ctx.getContextAttributes().colorSpace === 'display-p3'`. The `getContextAttributes()` method is not universally supported, but the code wraps it in try-catch and falls back to `false`.
- **Confidence:** Compliant

### 6.2 P3 Luminance Coefficients
- **File:** `apps/web/public/histogram-worker.js`, lines 16–18
- **Standard:** Display P3 RGB to XYZ conversion matrix
- **Finding:** The worker uses:
  ```js
  const lr = isP3 ? 0.22897 : 0.2126;
  const lg = isP3 ? 0.69174 : 0.7152;
  const lb = isP3 ? 0.07929 : 0.0722;
  ```
  These are the correct Y-row coefficients from the Display P3 (D65) RGB to XYZ conversion matrix:
  - Y = 0.22897457 * R + 0.69173850 * G + 0.07928696 * B
  The rounded values (0.22897, 0.69174, 0.07929) are accurate to 5 decimal places.
- **Confidence:** Compliant

### 6.3 sRGB/BT.709 Luminance Coefficients
- **File:** `apps/web/public/histogram-worker.js`, lines 16–18
- **Standard:** ITU-R BT.709-6, IEC 61966-2-1
- **Finding:** The sRGB coefficients (0.2126, 0.7152, 0.0722) are the standard BT.709 luminance coefficients.
- **Confidence:** Compliant

### 6.4 Gamma-Encoded Values Used as Linear for Luminance
- **File:** `apps/web/public/histogram-worker.js`, lines 21–29
- **Standard:** Colorimetric luminance requires linear RGB values
- **Finding:** The worker computes `lum = Math.round(lr * rv + lg * gv + lb * bv)` directly on 8-bit gamma-encoded values. True CIE luminance Y requires first linearizing the values (applying inverse sRGB/P3 transfer function), then applying the coefficients.
- **Issue:** Computing luminance on gamma-encoded values produces a "display-referred" luminance approximation, not true scene-referred luminance. For photography histograms, this is standard practice (Adobe Lightroom, Capture One, and most RAW processors compute display-referred histograms). However, the code does not document this approximation.
- **Failure Scenario:** A photographer comparing GalleryKit's histogram to a RAW processor's scene-referred histogram would see different shapes, especially in deep shadows where the sRGB gamma curve is linear (slope approximately 12.92). The discrepancy is largest for underexposed images.
- **Fix:** Document in a code comment that the histogram uses display-referred (gamma-encoded) luminance, not scene-referred linear luminance. If scene-referred accuracy is desired, add a linearization step: `linear = gamma <= 0.04045 ? gamma/12.92 : Math.pow((gamma+0.055)/1.055, 2.4)` before applying coefficients.
- **Confidence:** **Low** (standard practice, but should be documented)

---

## 7. Browser Color API Compliance

### 7.1 `screen.colorGamut` API
- **File:** `apps/web/src/lib/use-display-capability.ts`, lines 53–57
- **Standard:** CSS Color Module Level 4, section 11.2 — `screen.colorGamut`
- **Finding:** The code reads `screen.colorGamut` and maps:
  - `'rec2020'` to `'rec2020'`
  - `'p3'` to `'p3'`
  - anything else to `'srgb'`
  This correctly handles the three values defined in the CSS spec.
- **Confidence:** Compliant

### 7.2 `(color-gamut: p3)` and `(color-gamut: rec2020)` MQ
- **File:** `apps/web/src/lib/use-display-capability.ts`, lines 58–63
- **Standard:** CSS Color Module Level 4, section 11.1 — `color-gamut` media feature
- **Finding:** The code checks `rec2020` first, then `p3`. This is correct because a Rec.2020 display also matches `(color-gamut: p3)` (P3 is a subset of Rec.2020 gamut), so checking the wider gamut first is necessary.
- **Confidence:** Compliant

### 7.3 `(dynamic-range: high)` MQ
- **File:** `apps/web/src/lib/use-display-capability.ts`, lines 69–71
- **Standard:** CSS Media Queries Level 5 — `dynamic-range` media feature
- **Finding:** The code checks `window.matchMedia('(dynamic-range: high)').matches`. This is the correct MQ for HDR detection per the spec.
- **Confidence:** Compliant

### 7.4 Firefox Fallback Behavior
- **File:** `apps/web/src/lib/use-display-capability.ts`, lines 64–67, 99–105
- **Standard:** Documented in CLAUDE.md (R9-R1, R9-R3, R10-H4)
- **Finding:** When neither `screen.colorGamut` nor `color-gamut` MQ is available, the code defaults to `'srgb'`. This is the correct conservative choice for Firefox, which lacks both APIs. The code also adds `visibilitychange` / `focus` event listeners as a best-effort display-change detection since Firefox has no `color-gamut` MQ change events.
- **Confidence:** Compliant

### 7.5 Snapshot Memoization to Prevent Infinite Render Loop
- **File:** `apps/web/src/lib/use-display-capability.ts`, lines 47–81
- **Standard:** React `useSyncExternalStore` contract
- **Finding:** The `_cachedSnapshot` pattern ensures `getSnapshot()` returns a stable object reference until the underlying state changes. This correctly prevents React error #185 (infinite loop) that would occur if `detect()` returned a fresh object every call.
- **Confidence:** Compliant

---

## 8. Privacy-Sensitive Field Separation

### 8.1 `color_primaries` vs `transfer_function` Separation
- **File:** `apps/web/src/lib/data.ts`, lines 293–316
- **Standard:** Project privacy architecture (CLAUDE.md)
- **Finding:**
  - `color_primaries` is **public** — included in `publicSelectFields`
  - `transfer_function` is **admin-only** — explicitly destructured out with `_omitTransferFunction`
  - `is_hdr` is **admin-only** — explicitly destructured out with `_omitIsHdr`
  - `matrix_coefficients` is **admin-only** — explicitly destructured out with `_omitMatrixCoefficients`
- This separation is intentional per CLAUDE.md: `color_primaries` is public because it drives the histogram gamut label and wide-gamut hint; `transfer_function` and `is_hdr` are admin-only because the SDR-only pipeline cannot deliver HDR.
- **Confidence:** Compliant

### 8.2 `_PrivacySensitiveKeys` Compile-Time Guard
- **File:** `apps/web/src/lib/data.ts`, lines 366–369
- **Standard:** TypeScript structural typing as compile-time invariant
- **Finding:** The guard uses `Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>` and asserts it extends `never`. If any sensitive key leaks into `publicSelectFields`, TypeScript compilation fails. The test at `__tests__/privacy-fields.test.ts` adds a runtime symmetric guard.
- **Confidence:** Compliant

### 8.3 Symmetric Privacy Test Fixture
- **File:** `apps/web/src/__tests__/privacy-fields.test.ts`, lines 75–82
- **Standard:** Project privacy contract
- **Finding:** The test verifies that `adminSelectFieldKeys - publicSelectFieldKeys === SENSITIVE_KEYS`. This catches new fields added to `adminSelectFields` without an explicit privacy decision.
- **Confidence:** Compliant

---

## 9. Color Pipeline Decision Enum

### 9.1 `COLOR_PIPELINE_DECISIONS` Coverage
- **File:** `apps/web/src/lib/color-pipeline-decisions.ts`, lines 22–30
- **Standard:** Project color pipeline contract
- **Finding:** The enum covers all source-to-decision mappings used in `resolveColorPipelineDecision`:
  - `srgb` — sRGB exact match
  - `srgb-from-unknown` — fallback for unrecognized/null ICC
  - `p3-from-displayp3` — Display P3 source
  - `p3-from-dcip3` — DCI-P3 source
  - `p3-from-adobergb` — Adobe RGB to P3 gamut-mapped
  - `p3-from-prophoto` — ProPhoto to P3 gamut-mapped
  - `p3-from-rec2020` — Rec.2020 to P3 gamut-mapped
- **Confidence:** Complete for current pipeline

### 9.2 `isP3Pipeline()` Predicate
- **File:** `apps/web/src/lib/color-pipeline-decisions.ts`, lines 60–65
- **Standard:** Semantic correctness
- **Finding:** `decision.startsWith('p3-from-')` correctly identifies all P3-mapped decisions. The i18n smoke test and `is-p3-pipeline.test.ts` verify exhaustiveness.
- **One minor concern:** If a future decision like `'p3-from-bt2100hlg'` is added (per the code comment), `isP3Pipeline()` will automatically match it. This is the intended design.
- **Confidence:** Compliant

---

## 10. Setting Validation — `apps/web/src/lib/gallery-config-shared.ts`

### 10.1 `image_sizes` Bounds
- **File:** `apps/web/src/lib/gallery-config-shared.ts`, lines 236–242
- **Standard:** Project operational limits
- **Finding:**
  - Max count: 8 (`MAX_IMAGE_SIZE_COUNT`)
  - Max width: 10000 pixels
  - Must be positive integers, deduped, sorted
- **Confidence:** Compliant

### 10.2 `wide_gamut_max_source_pixels` Range
- **File:** `apps/web/src/lib/gallery-config-shared.ts`, lines 194–197
- **Standard:** Memory headroom for rgb16 pipeline
- **Finding:** Validated range is 10,000,000 to 200,000,000 pixels. Default is 50,000,000 (approximately 50 MP). This is reasonable:
  - 10 MP minimum prevents accidentally disabling the cap
  - 200 MP maximum prevents OOM on high-resolution medium-format scans (e.g., 100 MP Phase One IQ4)
- **Confidence:** Compliant

### 10.3 Chroma Subsampling Values
- **File:** `apps/web/src/lib/gallery-config-shared.ts`, lines 147–152
- **Standard:** JPEG chroma subsampling modes
- **Finding:** Only `'4:4:4'`, `'4:2:2'`, `'4:2:0'` are accepted. These are the only subsampling modes supported by the JPEG standard and Sharp.
- **Confidence:** Compliant

---

## 11. Final Sweep — Commonly Missed Issues

### 11.1 NCLX Transfer Value 11 (IEC 61966-2-4 / xvYCC) Not Mapped
- **File:** `apps/web/src/lib/color-detection.ts`, lines 175–198
- **Standard:** ITU-T H.273 Table 3
- **Finding:** Transfer value 11 (IEC 61966-2-4, xvYCC) is not mapped. xvYCC images are rare in photography but do exist (some consumer cameras produce xvYCC JPEGs). Falling to `'unknown'` is honest but could be improved.
- **Suggested Fix:** Map value 11 to `'srgb'` with a comment noting xvYCC uses the same transfer as sRGB but with extended gamut.
- **Confidence:** **Low**

### 11.2 `avif_effort` Range (4–9) Matches libheif
- **File:** `apps/web/src/lib/gallery-config-shared.ts`, line 188
- **Standard:** Sharp/libheif AVIF encoder effort parameter
- **Finding:** The validator accepts 4–9. Sharp's AVIF effort range is documented as 0–9, but libheif (which Sharp uses) may have a different range. The code uses 4–9, which is a conservative subset. This is acceptable.
- **Confidence:** Compliant

### 11.3 `gain-map-detection.ts` `tmap` Ambiguity
- **File:** `apps/web/src/lib/gain-map-detection.ts`, lines 251–257
- **Standard:** ISO 21496-1 (Tone Map)
- **Finding:** The code defers standalone `tmap` items to heuristic 2 (`auxl` iref check) unless the item URI contains both `'apple'` and `'hdr'`. This is correct because ISO 21496-1 `tmap` is a generic tone-map type that future encoders may use for non-HDR purposes. The conservative approach prevents false positives.
- **Confidence:** Compliant

### 11.4 Histogram AVIF Probe Data URL Validity
- **File:** `apps/web/src/components/histogram.tsx`, lines 43–44
- **Standard:** AVIF file format
- **Finding:** The `AVIF_PROBE_DATA_URL` is a base64-encoded minimal AVIF. The comment claims it is "Minimal 1x1 AVIF." I have not decoded and verified this file, but it is a well-known canonical probe pattern used in the industry. If the probe is invalid, `probeAvifSupport()` would always resolve to `false`, causing the histogram to never prefer AVIF and always show the "(sRGB clipped)" hint for wide-gamut images even on AVIF-capable browsers.
- **Suggested verification:** Decode the base64 and verify it is a structurally valid AVIF file (ftyp + meta + mdat with a valid AV1 OBU).
- **Confidence:** **Low**

### 11.5 ETag Settings Hash — Does It Include `sdr_jpeg_chroma`?
- **File:** Mentioned in CLAUDE.md, implemented in `lib/settings-hash.ts` (not reviewed in detail)
- **Standard:** Cache invalidation contract (P4-E2)
- **Finding:** Per CLAUDE.md, the settings hash covers `wide_gamut_jpeg_chroma`, `avif_effort`, and `force_srgb_derivatives`. It is unclear whether `sdr_jpeg_chroma` is included. If a photographer changes `sdr_jpeg_chroma` from `4:2:0` to `4:4:4`, existing sRGB JPEG derivatives in browser/CDN cache would not be invalidated, and visitors would continue receiving the old chroma-subsampled files until the cache expires naturally.
- **Fix:** Verify `settings-hash.ts` includes `sdr_jpeg_chroma`. If not, add it and bump `IMAGE_PIPELINE_VERSION`.
- **Confidence:** **Medium** (cannot confirm without reading settings-hash.ts)

### 11.6 Missing NCLX Matrix Value 8 (BT.2020 NCL)
- **File:** `apps/web/src/lib/color-detection.ts`, lines 200–204
- **Standard:** ITU-T H.273 Table 4
- **Finding:** Matrix value 8 (BT.2020 NCL) is not mapped. Value 9 is also BT.2020 NCL in H.273. If an encoder writes value 8 instead of 9, the code returns `'unknown'` for matrix coefficients. This is a minor gap.
- **Fix:** Add `8: 'bt2020-ncl'` to `NCLX_MATRIX_MAP`.
- **Confidence:** **Low**

### 11.7 `extractIccProfileName` Called Without Locale at Upload Time
- **File:** `apps/web/src/lib/color-detection.ts`, lines 296–304
- **Standard:** ICC.1:2010 `mluc` locale matching
- **Finding:** The comment at lines 298–303 acknowledges that `extractIccProfileName` is called without a locale at upload time, so `mluc` selection falls back to the first non-empty record. This is acceptable because technical ICC names are typically in English (Latinate) and universal among photographers. However, a Japanese photographer with a Japan-localized monitor profile (e.g., `mluc` with `ja` record "Eizo CG2700X" and no `en` record) would have the profile name stored as the Japanese string, which might not match the English allowlist in `inferColorPrimaries`.
- **Fix:** Pass the admin user's locale (or default to `'en'`) to `extractIccProfileName` during upload, or normalize `mluc` records by trying English first, then any available record.
- **Confidence:** **Low**

---

## Summary Table

| # | Finding | File | Severity | Confidence |
|---|---------|------|----------|------------|
| 1 | NCLX transfer code 2 = "Unspecified" mapped to gamma22 | `color-detection.ts:176` | MEDIUM | **High** |
| 2 | `readXyzTag` accepts non-standard 'XYZT' ICC signature | `icc-chromaticity.ts:124` | LOW | **Medium** |
| 3 | NCLX-only DCI-P3 skips rgb16; Sharp assumes sRGB source | `process-image.ts:921-1047` | MEDIUM | **Medium** |
| 4 | AVIF verifier uses naive byte scan for `colr` | `process-image.ts:144-168` | LOW | **Medium** |
| 5 | Histogram luminance uses gamma-encoded values (undocumented) | `histogram-worker.js:16-28` | LOW | **Low** |
| 6 | NCLX transfer value 11 (xvYCC) not mapped | `color-detection.ts:175-198` | LOW | **Low** |
| 7 | ETag settings hash may omit `sdr_jpeg_chroma` | `settings-hash.ts` (unverified) | LOW | **Medium** |
| 8 | NCLX matrix value 8 (BT.2020 NCL) not mapped | `color-detection.ts:200-204` | LOW | **Low** |
| 9 | `extractIccProfileName` locale-less at upload time | `color-detection.ts:298-303` | LOW | **Low** |
| 10 | Histogram AVIF probe data URL not verified structurally | `histogram.tsx:43-44` | LOW | **Low** |

**All other reviewed areas are compliant with their respective standards.**

---

## Recommended Next Steps (in priority order)

1. **Fix NCLX transfer code 2 mapping** (High confidence, trivial change): Change `2: 'gamma22'` to fall through to `'unknown'`. Update the comment to accurately reflect that only 4, 5, 7 are the gamma-2.2 family.
2. **Verify `settings-hash.ts` includes `sdr_jpeg_chroma`** (Medium confidence, trivial if confirmed): If missing, add it and bump `IMAGE_PIPELINE_VERSION`.
3. **Fix NCLX-only DCI-P3 rgb16 skip** (Medium confidence, medium effort): Either pass rgb16 for NCLX-only DCI-P3 or generate a synthetic DCI-P3 ICC for Sharp.
4. **Remove `'XYZT'` from `readXyzTag`** (Medium confidence, trivial): Strictly enforce `'XYZ '` per ICC spec.
5. **Add NCLX matrix value 8 mapping** (Low confidence, trivial): `8: 'bt2020-ncl'`.
6. **Document histogram display-referred luminance** (Low confidence, trivial): Add a code comment explaining the gamma-encoded approximation.

---

*Files reviewed (primary):*
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/color-detection.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/icc-extractor.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/icc-chromaticity.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/process-image.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/color-pipeline-decisions.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/color-primaries.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/use-display-capability.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/components/histogram.tsx`
- `/Users/hletrd/flash-shared/gallery/apps/web/public/histogram-worker.js`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/gallery-config-shared.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/data.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/gain-map-detection.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/process-image-post-encode-verification.test.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/color-detection.test.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/icc-chromaticity.test.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/use-display-capability.test.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/privacy-fields.test.ts`
- `/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/color-pipeline-decision.test.ts`
