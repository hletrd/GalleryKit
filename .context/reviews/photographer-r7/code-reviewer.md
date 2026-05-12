# Photographer Review R7 — Color/HDR Pipeline Code Review

**Reviewer:** Code Reviewer (photographer perspective)
**Date:** 2026-05-12
**Scope:** Color signal detection, encoder decisions, bootstrap preservation, histogram accuracy, display capability, ETag correctness, HDR/gain-map handling, race conditions
**Files Reviewed:** 12 source files + 4 supporting modules

---

## Executive Summary

**Verdict: REQUEST CHANGES**

The color/HDR pipeline is architecturally sound with strong safety measures (bounded ISOBMFF walking, per-format fresh Sharp instances, atomic rename, privacy field separation). However, **three MEDIUM-severity inconsistencies** in ICC-name matching and NCLX transfer mapping can cause incorrect color pipeline decisions or misleading audit labels for certain source profiles. One **MEDIUM UI gap** in the lightbox histogram omits the fallback URL that other surfaces provide. No CRITICAL or HIGH issues were found.

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH     | 0 |
| MEDIUM   | 4 |
| LOW      | 5 |

---

## MEDIUM Issues (must fix before next deploy)

### [MEDIUM-1] ICC profile name matching inconsistency: `.toLowerCase()` vs `normalizeName` causes P3 mis-detection

**Files:**
- `apps/web/src/lib/process-image.ts:440-460` (`resolveColorPipelineDecision`)
- `apps/web/src/lib/process-image.ts:506-528` (`resolveAvifIccProfile`)
- `apps/web/src/lib/process-image.ts:704` (`isDciP3` detection)

**Issue:** `color-detection.ts` uses `normalizeName()` (strips all non-alphanumeric characters, lowercases) to match ICC profile names in `inferColorPrimaries`. But `process-image.ts` uses raw `.toLowerCase()` in the three resolver functions above. This creates a mismatch for profile names that contain spaces, hyphens, or underscores in ways the raw matcher doesn't expect.

**Concrete failure scenarios:**

1. Profile named `"DisplayP3"` (no space — some camera vendors write it this way):
   - `inferColorPrimaries`: normalize → `"displayp3"` → matches `'p3-d65'` ✓
   - `resolveColorPipelineDecision`: `.toLowerCase()` → `"displayp3"` → `'display p3'` NOT in `'displayp3'` → falls through → returns `'srgb-from-unknown'` ✗
   - **Photographer impact:** A Display P3 photo is encoded as sRGB. Saturated reds and greens are silently clipped.

2. Profile named `"P3D65"` (no hyphen):
   - `inferColorPrimaries`: normalize → `"p3d65"` → does NOT match (no `'p3d65'` check in `inferColorPrimaries`) → `'unknown'`
   - `resolveColorPipelineDecision`: `.toLowerCase()` → `"p3d65"` → does NOT match `=== 'p3-d65'` or `startsWith('p3-d65')` → `'srgb-from-unknown'`
   - **Photographer impact:** Same — P3 photo treated as sRGB.

3. Profile named `"DCI_P3"` (underscore):
   - `isDciP3`: `'dci_p3'` does not match `'dci-p3'` → `isDciP3 = false`
   - `needsRgb16`: `true` (wide-gamut but not DCI-P3)
   - **Photographer impact:** DCI-P3 source goes through the rgb16 pipeline instead of preserving its source ICC for the Bradford D65 adaptation. White point may shift slightly.

**Fix:** Use `normalizeName` consistently in all three resolver sites, or at minimum add fallback patterns that match the normalized form:

```typescript
// In resolveColorPipelineDecision and resolveAvifIccProfile
const norm = normalizeName(iccProfileName); // import from color-detection.ts
if (norm.includes('displayp3') || norm.includes('p3d65')) { ... }
if (norm.includes('dcip3')) { ... }
```

**Confidence:** High

---

### [MEDIUM-2] NCLX transfer characteristic 17 (SMPTE ST 428-1) not mapped

**File:** `apps/web/src/lib/color-detection.ts:175-184` (`NCLX_TRANSFER_MAP`)

**Issue:** The NCLX transfer map does not include value `17`, which ITU-T H.273 defines as SMPTE ST 428-1 (the DCI-P3 cinema gamma 2.6 transfer). A HEIF/AVIF file with CICP transfer=17 gets `transferFunction = 'unknown'` from NCLX parsing.

**Concrete failure scenario:**
A cinema photographer exports a DCI-P3 + ST 428-1 source as AVIF. The container carries CICP `primaries=11, transfer=17`. The pipeline:
- `colorPrimaries = 'dci-p3'` (correct, from primaries 11)
- `transferFunction = 'unknown'` (bug — value 17 missing from map)
- `isHdr = false` (correct, since transfer is not 'pq' or 'hlg')
- Audit panel shows "Transfer: Unknown" instead of something meaningful

Meanwhile, the ICC-name path for the same profile would map DCI-P3 to `'gamma22'` (per line 112-113: "DCI-P3 (cinema) is gamma-2.6 by SMPTE EG 432-2; treat as gamma22"). This creates **inconsistent audit labels** between NCLX-only and ICC-named sources for the same underlying transfer.

**Fix:** Add `17: 'gamma22'` to `NCLX_TRANSFER_MAP` with a comment explaining it's DCI-P3 gamma 2.6 mapped to the closest available enum:

```typescript
const NCLX_TRANSFER_MAP: Record<number, ColorSignals['transferFunction']> = {
    // ... existing entries ...
    16: 'pq',      // PQ / SMPTE ST 2084
    17: 'gamma22', // SMPTE ST 428-1 (DCI-P3 gamma 2.6) — mapped to closest enum
    18: 'hlg',     // ARIB STD-B67
};
```

**Confidence:** High

---

### [MEDIUM-3] NCLX transfer characteristic 8 (linear) not mapped

**File:** `apps/web/src/lib/color-detection.ts:175-184` (`NCLX_TRANSFER_MAP`)

**Issue:** ITU-T H.273 value `8` is "Linear transfer characteristics". The `ColorSignals['transferFunction']` enum includes `'linear'`, but NCLX value 8 falls through to `'unknown'`.

**Concrete failure scenario:**
A photographer working with linear-light scientific or raw-processed imagery exports to AVIF with CICP `transfer=8`. The audit panel shows "Transfer: Unknown" instead of "Linear". More importantly, `inferTransferFunction` has a `'linear'` branch (line 98) that works for ICC-named profiles, but NCLX-linear sources get inconsistent treatment.

**Fix:** Add `8: 'linear'` to `NCLX_TRANSFER_MAP`.

```typescript
const NCLX_TRANSFER_MAP: Record<number, ColorSignals['transferFunction']> = {
    // ... existing entries ...
    8: 'linear',   // Linear transfer characteristics
    // ...
};
```

**Confidence:** High

---

### [MEDIUM-4] LightboxColorPip omits `fallbackImageUrl` for Histogram

**File:** `apps/web/src/components/lightbox-color-pip.tsx:125-134`

**Issue:** `photo-viewer.tsx` and `info-bottom-sheet.tsx` both pass `fallbackImageUrl` to `<Histogram>` (the base JPEG filename, guaranteed to exist per the encoder's atomic-rename contract). `LightboxColorPip` does not.

**Concrete failure scenario:**
A legacy photo was uploaded when `imageSizes` did not include 640 (or any size close to it). The lightbox histogram requests `_640.jpg`, gets a 404, and has no fallback. The histogram canvas stays blank. The user sees no histogram in the lightbox color pip, while the sidebar histogram (in photo-viewer) works fine because it falls back to the base JPEG.

**Fix:** Pass the base JPEG URL as `fallbackImageUrl`:

```tsx
// In LightboxColorPip, before the Histogram JSX:
const fallbackJpegUrl = image.filename_jpeg
    ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`)
    : undefined;

// In the Histogram component:
<Histogram
    imageUrl={histogramJpegUrl}
    avifUrl={histogramAvifUrl}
    fallbackImageUrl={fallbackJpegUrl}
    colorPrimaries={image.color_primaries}
    ...
/>
```

**Confidence:** High

---

## LOW Issues (consider fixing)

### [LOW-1] `wide_gamut_max_source_pixels` included in settings hash unnecessarily

**File:** `apps/web/src/lib/settings-hash.ts:29-35` (`COLOR_IMPACTING_KEYS`)

**Issue:** `wide_gamut_max_source_pixels` only affects the encoding of **new** wide-gamut images (it caps source dimensions before the rgb16 pipeline). Changing this setting does **not** alter the bytes of already-encoded derivatives on disk. Including it in the ETag hash causes a one-time revalidation cascade (all clients revalidate, get 304) even though the files are unchanged.

**Fix:** Remove `'wide_gamut_max_source_pixels'` from `COLOR_IMPACTING_KEYS`.

**Confidence:** Medium

---

### [LOW-2] Histogram worker uses BT.709 luminance coefficients for all color spaces

**File:** `apps/web/src/public/histogram-worker.js:21`

**Issue:** The worker computes luminance as `0.2126 * r + 0.7152 * g + 0.0722 * b`, which are the BT.709/sRGB coefficients. When the histogram canvas is configured with `colorSpace: 'display-p3'` and the browser returns P3-space pixel data (Chrome does; Safari may convert to sRGB), the luminance mode is slightly inaccurate because P3 has different primaries.

**Photographer impact:** The luminance histogram is a visual guide, not a measurement instrument. The error is small (~2-3% on highly saturated P3 colors) and acceptable for the intended use.

**Fix:** Document the limitation in a comment. A rigorous fix would require converting each pixel to XYZ using the actual primaries, then computing Y — too expensive for a 256-bin histogram worker.

**Confidence:** Medium

---

### [LOW-3] `hasGainMap` heuristic 2 can false-positive on non-HDR `urim`/`tmap` items

**File:** `apps/web/src/lib/gain-map-detection.ts:274-281`

**Issue:** Heuristic 2 returns `true` for any `auxl` iref that points to a `urim` or `tmap` item, without verifying the URI content. Future ISO standards or non-Apple encoders might use `urim` or `tmap` for non-HDR purposes.

**Photographer impact:** Low — `has_gain_map` is an **admin-only** field. A false positive means the admin audit panel shows "Gain map present" for a photo that doesn't have one. It does not affect public display or encoding.

**Fix:** Optional — in heuristic 2, also check that the referenced `urim` item's URI contains the Apple HDR URN. For `tmap`, require the Apple HDR URN or an `auxl` reference from the primary image. Given this is audit-only, accepting the current broad heuristic is reasonable.

**Confidence:** Medium

---

### [LOW-4] Missing NCLX primaries value 10 (SMPTE ST 428-1)

**File:** `apps/web/src/lib/color-detection.ts:168-173` (`NCLX_PRIMARIES_MAP`)

**Issue:** ITU-T H.273 value `10` is SMPTE ST 428-1 (the DCI-P3 XYZ encoding space used in digital cinema distribution). It is not mapped, so cinema-derived content with CICP primaries=10 shows `'unknown'`.

**Photographer impact:** Very low — ST 428-1 is a cinema distribution format, not a consumer camera output format.

**Fix:** Add `10: 'dci-p3'` to `NCLX_PRIMARIES_MAP` with a comment.

**Confidence:** Low

---

### [LOW-5] Redundant `dataSize >= 11` check in `parseCicpFromHeif`

**File:** `apps/web/src/lib/color-detection.ts:233-235`

**Issue:** The outer `if (dataSize >= 11)` at line 233 is redundant with the inner check at line 235. Both guard the same read. Harmless but adds noise.

**Fix:** Remove the outer check; keep the inner one.

```typescript
// Before:
if (dataSize >= 11) {
    const colourType = buffer.toString('ascii', dataStart, dataStart + 4);
    if (colourType === 'nclx' && dataSize >= 11) {

// After:
if (dataSize >= 11) {
    const colourType = buffer.toString('ascii', dataStart, dataStart + 4);
    if (colourType === 'nclx') {
```

**Confidence:** High

---

## Positive Observations

1. **Bounded ISOBMFF walker.** `parseCicpFromHeif` (color-detection.ts:199-263) caps depth at 5, scan at 1 MB, and rejects malformed boxes. The same bounded read is shared with gain-map detection, so HEIF/AVIF files are only opened once for all color probes.

2. **Per-format fresh Sharp instances.** `processImageFormats` (process-image.ts:787-790) creates a new `sharp()` per format on the rgb16 path, eliminating shared-state cross-format contamination (WI-14). This prevented a real bug where AVIF encode settings leaked into WebP/JPEG.

3. **Atomic rename with hard-link fallback.** The base-filename write (process-image.ts:881-903) uses `link` + `rename` for atomicity, with two fallback levels. The `finally` block cleans up temp files. This prevents 404s during concurrent reads.

4. **Bootstrap color signal preservation (R6-H1).** `image-queue.ts` selects `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, and `has_gain_map` from the DB during bootstrap and passes them through `colorSignals` to `processImageFormats`. NCLX-only sources (no ICC name) are correctly resolved via the `signals` fallback in `resolveAvifIccProfile`.

5. **`useSyncExternalStore` snapshot memoization.** `useDisplayCapability` (use-display-capability.ts:66-103) caches the last snapshot by value and returns the same object reference until the underlying state changes. This correctly prevents React error #185 infinite loops.

6. **Privacy field separation.** `data.ts` derives `publicSelectFields` from `adminSelectFields` via explicit destructured omissions. The compile-time `_SensitiveKeysInPublic` guard (line 340) enforces that no sensitive key leaks to public queries. `color_pipeline_decision`, `is_hdr`, `has_gain_map`, `transfer_function`, and `matrix_coefficients` are all correctly kept admin-only.

7. **ETag settings hash coverage.** `serve-upload.ts` (line 106-107) folds the 8-char settings hash into the ETag alongside pipeline version, mtime, and size. Combined with `must-revalidate`, this ensures that admin-configured encoder changes (e.g., `force_srgb_derivatives`) propagate to all cached clients after a backfill.

8. **HDR ingest gating.** Upload-time rejection of PQ/HLG sources when `allow_hdr_ingest=false` (images.ts:290-295) prevents photographers from accidentally uploading HDR content that the SDR-only pipeline would mishandle. The warning when `allow_hdr_ingest=true` (images.ts:299-301) honestly communicates the limitation.

9. **DCI-P3 white-point preservation.** The `isDciP3` skip of the rgb16 pipeline (process-image.ts:704, 785) preserves the source ICC with its DCI white point, allowing Sharp's `toColorspace('p3')` to perform the correct Bradford D50→D65 adaptation.

---

## Logic Correctness Checklist

| Area | Status | Notes |
|------|--------|-------|
| NCLX `colr` box parsing | Pass | Correct ISOBMFF walking, bounded depth/scan, handles extended sizes |
| ICC chromaticity matching | Pass | Reasonable tolerance (0.005/0.015), bounded tag table, XYZ→xy conversion |
| ICC name extraction | Pass | `desc` v2 and `mluc` v4 UTF-16BE with locale preference |
| Encoder decision matrix | Pass | Correct P3/wide/sRGB branching, `p3-from-wide` for Adobe/ProPhoto/Rec.2020 |
| AVIF 10-bit probe | Pass | Promise-singleton prevents races, per-image 8-bit fallback on failure |
| Bootstrap signal flow | Pass | Full color signals preserved from DB→queue→encoder |
| Histogram canvas colorSpace | Pass | P3 context requested only for wide-gamut + P3 display + canvas-P3 support |
| Display capability detection | Pass | Layered: screen.colorGamut → MQ → canvas-P3, snapshot-memoized |
| ETag construction | Pass | Pipeline version + mtime + size + settings hash |
| HDR ingest rejection | Pass | Gated by admin setting, warning on acceptance |
| Gain map detection | Pass | Two-heuristic OR covers pre-iOS 17 and iOS 17+ shapes |
| Privacy field separation | Pass | Admin-only fields correctly omitted from public queries |

---

## Recommendation

**REQUEST CHANGES**

Fix the four MEDIUM issues before the next deploy:

1. **MEDIUM-1** is the most impactful — it can cause incorrect color pipeline decisions for certain ICC profile name variants, leading to silent gamut clipping.
2. **MEDIUM-2 and MEDIUM-3** are one-line fixes that improve NCLX audit accuracy.
3. **MEDIUM-4** improves lightbox UX consistency with other histogram surfaces.

The five LOW issues are optional polish; LOW-2 and LOW-3 are acceptable limitations given the audit-only / visual-guide nature of the affected features.
