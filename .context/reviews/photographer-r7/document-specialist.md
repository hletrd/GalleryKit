# Photographer R7 — Document Specialist Review
## Color/HDR Pipeline Documentation & Comment Accuracy

**Reviewer:** document-specialist (Claude)
**Date:** 2026-05-12
**Scope:** `CLAUDE.md` color/HDR section, `process-image.ts` docstrings, `color-detection.ts` NCLX mappings, `icc-chromaticity.ts` comments, `messages/en.json` + `messages/ko.json` color terminology, TODO/FIXME/WI-reference audit.

---

## Executive Summary

The color/HDR pipeline documentation is **mostly accurate and well-maintained**. Two **high-confidence errors** in `CLAUDE.md` misrepresent actual encoder behavior (DCI-P3 AVIF bit depth, HDR badge gating). One **high-confidence Korean translation error** conflates "gamut" with "gamma" in three settings labels. One **high-confidence cross-reference error** points `color-detection.ts` readers to the wrong module for `extractIccProfileName`. No stale TODOs or unshipped WI references masquerading as implemented features were found.

| # | Finding | Confidence | Severity |
|---|---------|-----------|----------|
| 1 | `CLAUDE.md`: DCI-P3 AVIF documented as 8-bit; code produces 10-bit | **High** | Medium |
| 2 | `CLAUDE.md`: HDR badge claims `@media (dynamic-range: high)` gating; no such check exists | **High** | Medium |
| 3 | `messages/ko.json`: "Wide gamut" mistranslated as "wide gamma" in settings labels | **High** | Medium |
| 4 | `color-detection.ts`: Comment references `process-image.ts` for `extractIccProfileName`; actual source is `icc-extractor.ts` | **High** | Low |
| 5 | `icc-chromaticity.ts`: Module comment uses "delta-E" but metric is 2D Euclidean distance in xy space (delta-xy) | **Medium** | Low |
| 6 | `color-primaries.ts` / `color-pipeline-decisions.ts`: WI-09 comment loosely associates HDR delivery with Rec.2100 primaries; Rec.2100 uses BT.2020 primaries (already supported) | **Low** | Low |

---

## 1. CLAUDE.md Color/HDR Section

### 1.1 DCI-P3 AVIF Bit Depth — DOCUMENTATION ERROR
**Location:** `CLAUDE.md` encoder decision matrix table
**Confidence:** High

The table states:

| Source ICC | Decision | AVIF output | WebP / JPEG output |
|---|---|---|---|
| DCI-P3 | `p3-from-dcip3` | **P3 8-bit (Bradford D65)** | P3 8-bit (4:4:4) |

**Actual behavior in `process-image.ts`:**
- `resolveAvifIccProfile('dci-p3')` returns `'p3'` (line 509-510).
- `isWideGamutSource` is true for both `'p3'` and `'p3-from-wide'` (line 694).
- `wantHighBitdepth = isWideGamutSource && await canUseHighBitdepthAvif()` (line 815).
- DCI-P3 sources **do** receive 10-bit AVIF when the libheif probe passes.
- The DCI-P3 path skips `rgb16` (`needsRgb16 = isWideGamutSource && !isDciP3`), but the 10-bit gate is independent of `rgb16`.

**Fix:** Change the AVIF output cell for DCI-P3 from "P3 8-bit (Bradford D65)" to "P3 10-bit (Bradford D65, no rgb16)" or simply "P3 10-bit" to match the actual behavior.

### 1.2 HDR Badge `@media (dynamic-range: high)` Gating — DOCUMENTATION ERROR
**Location:** `CLAUDE.md` "HDR ingest" subsection
**Confidence:** High

`CLAUDE.md` states:
> "`is_hdr` / `transfer_function` / `matrix_coefficients` are **admin-only fields** so the public never sees an HDR badge whose bytes don't fulfill it."

This first clause is **correct**: `is_hdr` is in `_PrivacySensitiveKeys`, omitted from `publicSelectFields`, and the `color-details-section.tsx` computes `isHdr` from `image.transfer_function` (also admin-only). Public users never see the badge.

However, `CLAUDE.md` **also** states:
> "UI badge gates on this AND `@media (dynamic-range: high)`"

**Actual behavior in `color-details-section.tsx` (line 121, 329):**
```ts
const isHdr = image.transfer_function === 'pq' || image.transfer_function === 'hlg';
// ...
{isHdr && (
    <span className="hdr-badge ...">
```

There is **no `@media (dynamic-range: high)` check** anywhere in the badge rendering path. The badge is shown purely based on the admin-only `transfer_function` field being `'pq'` or `'hlg'`.

**Fix:** Remove the claim that the badge gates on `@media (dynamic-range: high)`. The honest description is: "The HDR badge is shown only in the admin Color Details audit panel because `transfer_function` (and therefore `is_hdr`) is admin-only."

### 1.3 WI-09 References — ACCURATE
**Confidence:** High

`CLAUDE.md` references WI-09 (HDR AVIF encoder via `avifenc` shell-out) as unshipped in multiple places. Cross-checked against code:
- `hdr-filenames.ts`: explicitly marked "Currently unused in UI" — correct.
- `gain-map-detection.ts`: "passing through (WI-09)" — correct, gain map is detected but not delivered.
- `color-detection.ts`: "until WI-09 wires the gain map through to delivery" — correct.
- `color-pipeline-decisions.ts`: "once WI-09 ships" — correct.

No WI-09 references falsely claim the feature is live.

### 1.4 Pipeline Version History — ACCURATE
**Confidence:** High

The version history table in `CLAUDE.md` and the inline `IMAGE_PIPELINE_VERSION` docstring in `process-image.ts` (lines 102-124) match each other and the actual code:
- v2: failOn/error, autoOrient, ETag, strict P3 detection — correct.
- v3: rgb16, 10-bit AVIF, 4:4:4 JPEG, effort:6 — correct.
- v4: DCI-P3 Bradford adaptation (WI-12) — shipped, correct.
- v5: 50 MP downscale (WI-15) + lazy 10-bit probe — shipped, correct.
- v6: tunable `wide_gamut_jpeg_chroma` + `avif_effort` — shipped, correct.

### 1.5 Encoder Decision Matrix (Non-DCI-P3) — ACCURATE
**Confidence:** High

The decision matrix for sRGB, Display P3, Adobe RGB, ProPhoto, and Rec.2020 matches the actual `resolveColorPipelineDecision` and `resolveAvifIccProfile` implementations. The `p3-from-wide` return value for wider-than-P3 gamuts is correctly documented.

---

## 2. `process-image.ts` Docstrings

### 2.1 `resolveColorPipelineDecision` Docstring — ACCURATE
**Confidence:** High

The decision matrix in the docstring (lines 408-420) matches the implementation. The `signals` fallback for NCLX-derived primaries (P3-11) is implemented but not shown in the table; this is acceptable because the table documents the ICC-name path.

### 2.2 `resolveAvifIccProfile` Docstring — ACCURATE
**Confidence:** High

The docstring correctly documents the `'p3-from-wide'` return value for Adobe RGB / ProPhoto / Rec.2020, and the `'p3'` return for true P3 families. The `signals` parameter fallback is implemented but not tabled — acceptable.

### 2.3 `processImageFormats` Inline Comments — ACCURATE
**Confidence:** High

The inline comments (lines 689-925) accurately describe the encode chain:
- `toColorspace` + `withIccProfile` ordering — correct.
- `pipelineColorspace('rgb16')` for wide-gamut — correct.
- DCI-P3 skipping rgb16 (WI-12) — correct.
- Fresh Sharp instance per format (WI-14) — correct.
- 10-bit AVIF gating via `canUseHighBitdepthAvif()` — correct.
- SDR JPEG chroma tunable (C2-A5) — correct.

No TODOs or FIXMEs were found in this file.

---

## 3. `color-detection.ts` NCLX Mappings

### 3.1 `NCLX_PRIMARIES_MAP` — ACCURATE
**Confidence:** High

| Code | Maps to | ITU-T H.273 Meaning | Verdict |
|------|---------|---------------------|---------|
| 1 | `'bt709'` | BT.709-5 / IEC 61966-2-1 (sRGB) primaries | Correct |
| 9 | `'bt2020'` | BT.2020 / Rec.2020 primaries | Correct |
| 11 | `'dci-p3'` | DCI-P3 (theater) primaries | Correct |
| 12 | `'p3-d65'` | Display P3 (D65 white point) primaries | Correct |

### 3.2 `NCLX_TRANSFER_MAP` — ACCURATE (with documented heuristics)
**Confidence:** High

| Code | Maps to | ITU-T H.273 Meaning | Verdict |
|------|---------|---------------------|---------|
| 1 | `'srgb'` | BT.709-5 transfer (same curve as sRGB for RGB) | Correct |
| 2 | `'gamma22'` | Image characteristics unknown / determined by application | Heuristic; comment notes "was wrongly mapped to 'pq'" |
| 6 | `'gamma22'` | BT.601-6 NTSC (gamma ~2.2) | Correct |
| 13 | `'srgb'` | IEC 61966-2-1 (sRGB) | Correct; comment notes "was wrongly mapped to 'pq'" |
| 14 | `'gamma22'` | BT.2020-1 10-bit (BT.1886, gamma ~2.4) | Closest available enum; comment notes "was wrongly mapped to 'hlg'" |
| 15 | `'gamma22'` | BT.2020-1 12-bit (same as 14) | Same rationale |
| 16 | `'pq'` | PQ / SMPTE ST 2084 | Correct; comment notes "was missing" |
| 18 | `'hlg'` | HLG / ARIB STD-B67 | Correct; comment notes "was wrongly mapped to 'gamma18'" |

The code value 17 (SMPTE 428) is not mapped — the pipeline does not encounter cinema DCDM transfer functions in photo ingest. The omission is acceptable.

### 3.3 `NCLX_MATRIX_MAP` — ACCURATE
**Confidence:** High

| Code | Maps to | ITU-T H.273 Meaning | Verdict |
|------|---------|---------------------|---------|
| 0 | `'identity'` | Identity (RGB direct) | Correct |
| 1 | `'bt709'` | BT.709-5 | Correct |
| 9 | `'bt2020-ncl'` | BT.2020 non-constant luminance | Correct |

### 3.4 Comment References Wrong File — DOCUMENTATION ERROR
**Location:** `color-detection.ts` line 277-278
**Confidence:** High

```ts
// Sharp's metadata().icc is a Buffer when present; try to extract a name
// by reusing the same bounds-checked parser used in process-image.ts.
```

`extractIccProfileName` is defined in **`icc-extractor.ts`**, not `process-image.ts`. `process-image.ts` re-exports it (`export { extractIccProfileName } from '@/lib/icc-extractor'`), but the parser itself lives in `icc-extractor.ts`.

**Fix:** Change "used in process-image.ts" to "used in icc-extractor.ts".

---

## 4. `icc-chromaticity.ts` Comments

### 4.1 Delta-E vs. Delta-xy Terminology — MINOR TERMINOLOGY ISSUE
**Location:** Module-level comment (line 1-21) and constant names
**Confidence:** Medium

The module docstring says:
> "compares against canonical gamut presets"
> "within delta-E <= 0.005 (high-confidence) or <= 0.015 (medium)"

But the actual metric is **2D Euclidean distance in xy chromaticity space** (delta-xy), not CIEDE2000 delta-E. The function docstring at line 145 correctly says "per-primary 2D Euclidean delta-xy", but the top-level module comment uses the less precise "delta-E" phrasing. The constant names (`HIGH_CONFIDENCE_TOLERANCE`, `MEDIUM_CONFIDENCE_TOLERANCE`) do not mention delta-E, so there is no naming inconsistency — only a comment terminology issue.

**Fix:** Change "delta-E" to "delta-xy" or "chromaticity distance" in the module header comment.

---

## 5. TODOs / FIXMEs / Unimplemented Features

**Result:** No active TODOs or FIXMEs were found in any color-related source file.

| File | WI References | Status |
|------|---------------|--------|
| `process-image.ts` | WI-12, WI-14, WI-15 | All shipped |
| `color-detection.ts` | WI-09 (gain map delivery), US-CM12 (HDR AVIF), US-CM05 (CICP) | US-CM05 shipped; WI-09/US-CM12 correctly deferred |
| `gain-map-detection.ts` | WI-09 | Correctly deferred |
| `hdr-filenames.ts` | WI-09 | Correctly deferred; file unused in production |
| `color-pipeline-decisions.ts` | WI-09 | Correctly deferred |
| `color-primaries.ts` | WI-09 | Correctly deferred |

All WI references are honest about shipment status. No "ghost features" are documented as live.

---

## 6. Pipeline Version History Comment

**Location:** `process-image.ts` lines 102-124
**Verdict:** Accurate

Each version bump is documented with the correct motivating change:
- v2: first versioned cut
- v3: rgb16, 10-bit AVIF, 4:4:4 JPEG, effort:6
- v4: DCI-P3 Bradford (WI-12)
- v5: 50 MP downscale (WI-15)
- v6: tunable encoder params (P3-20 / P3-21)

The comment "Skip 1 to mark the cutover from pre-fix bytes" is also correct — version 1 was never used.

---

## 7. Old File Names / Moved Functions

### 7.1 `hdr-filenames.ts` — ORPHANED BUT DOCUMENTED
**Confidence:** High

`hdr-filenames.ts` contains a single function `deriveHdrAvifFilename` that is **only imported by its test file** (`__tests__/hdr-filenames.test.ts`). It is not used in any production code path. The file's own header comment correctly states:
> "Currently unused in UI after P3-1 removed the HDR download menu item."

No action needed — the file is intentionally retained for WI-09.

### 7.2 Cross-Module Import Paths — ACCURATE
**Confidence:** High

All cross-references between color modules resolve correctly:
- `color-detection.ts` imports from `icc-extractor.ts`, `gain-map-detection.ts`, `icc-chromaticity.ts` — correct.
- `process-image.ts` imports from `color-detection.ts`, `icc-extractor.ts`, `color-pipeline-decisions.ts` — correct.
- `color-primaries.ts` is client-safe (no fs/sharp deps) — correct.
- `color-pipeline-decisions.ts` is client-safe — correct.

---

## 8. Messages Translation Accuracy

### 8.1 English (`messages/en.json`) — ACCURATE
**Confidence:** High

All color-related English strings are technically correct:
- "Color Space", "Color primaries", "Transfer function", "Color pipeline" — correct terminology.
- "Display P3 (from DCI-P3)", "P3 (from Adobe RGB; saturated greens may clip)" — accurate descriptions.
- "10-bit AVIF, 8-bit WebP/JPEG" — matches actual delivery.
- "Gain map", "Apple HDR gain map detected" — correct.

### 8.2 Korean (`messages/ko.json`) — TRANSLATION ERROR IN SETTINGS LABELS
**Confidence:** High

The upload warning correctly uses **"광색역"** (wide color gamut):
```json
"wideGamutDownscaleWarning": "광색역 이미지 {count}개가 50MP를 초과하여 처리 중 축소됩니다."
```

The viewer wide-gamut hint also correctly uses **"광색역"**:
```json
"wideGamutHint": "...Display P3 또는 광색역 디스플레이에서는 더 넓은 색역을 볼 수 있습니다."
```

**However, the settings labels use "와이드 감마" (wide gamma), which is incorrect:**

| Key | Current (Wrong) | Should Be |
|-----|-----------------|-----------|
| `settings.wideGamutJpegChroma` | "와이드 감마 JPEG 색도" | "광색역 JPEG 색도" |
| `settings.wideGamutJpegChromaHint` | "와이드 감마 JPEG 변환본의 색도 샘플링..." | "광색역 JPEG 변환본의 색도 샘플링..." |
| `settings.wideGamutMaxSourcePixels` | "와이드 감마 최대 원본 픽셀 수" | "광색역 최대 원본 픽셀 수" |
| `settings.wideGamutMaxSourcePixelsHint` | "이 값보다 큰 와이드 감마 원본은..." | "이 값보다 큰 광색역 원본은..." |

**"감마" (gamma)** refers to the transfer function (tonal response curve). **"색역" (gamut)** refers to the range of reproducible colors. These are distinct concepts in color science. Using "와이드 감마" for "wide gamut" is a mistranslation that will confuse Korean-speaking photographers who understand the technical distinction.

**Fix:** Replace all four instances of "와이드 감마" with "광색역" in `messages/ko.json`.

### 8.3 Korean Minor Inconsistency — "Download" Description
**Confidence:** Low

`viewer.downloadP3AvifDesc` in Korean:
```json
"downloadP3AvifDesc": "파일은 작고 색 영역은 넓습니다 — 최신 브라우저"
```

English: "Smaller file, wider gamut — modern browsers **only**"

The Korean omits "only" ("에서만" / "전용"). This is a minor omission; the dash implies the limitation, so it is acceptable.

### 8.4 Korean Pipeline Decision Labels — ACCURATE
**Confidence:** High

The pipeline decision translations accurately convey the English meanings:
- "P3 (Display P3 기반)" — "based on Display P3" — correct.
- "P3 (Adobe RGB 기반; 채도 높은 녹색 클리핑 가능)" — "saturated green clipping possible" — correct.
- "sRGB (알 수 없는 원본)" — "unknown source" — correct.

---

## 9. Schema Comments (`db/schema.ts`)

### 9.1 Sharp Version Reference — ACCURATE
**Confidence:** High

The schema comment (line 58) says "Sharp 0.34.5". Verified against `apps/web/package.json`:
```json
"sharp": "^0.34.5"
```

Match confirmed.

### 9.2 HDR Foundation Columns — ACCURATE
**Confidence:** High

The schema comments (lines 54-71) correctly describe the color/HDR columns as foundational for future HDR delivery (US-CM12), with the honest caveat that CICP signaling is not yet exposed by Sharp's encoder API. This matches the actual code state.

---

## 10. Privacy Field Separation

### 10.1 `_PrivacySensitiveKeys` — COMPLETE
**Confidence:** High

The compile-time guard in `data.ts` (line 339) includes all admin-only color fields:
- `color_pipeline_decision`
- `is_hdr`
- `has_gain_map`
- `transfer_function`
- `matrix_coefficients`

The `SENSITIVE_KEYS` fixture in `privacy-fields.test.ts` (line 5-22) matches exactly. No missing fields.

---

## Recommended Fixes (Priority Order)

1. **Fix `messages/ko.json`** — Replace "와이드 감마" with "광색역" in four settings strings. This is user-facing and technically incorrect.
2. **Fix `CLAUDE.md`** — Correct DCI-P3 AVIF output from "P3 8-bit" to "P3 10-bit" in the encoder matrix.
3. **Fix `CLAUDE.md`** — Remove the false claim that the HDR badge gates on `@media (dynamic-range: high)`.
4. **Fix `color-detection.ts` line 278** — Change "process-image.ts" to "icc-extractor.ts".
5. **Fix `icc-chromaticity.ts` line 1** — Change "delta-E" to "delta-xy" in the module header comment.
6. **Optional:** `color-primaries.ts` line 33 — Clarify that WI-09 is about HDR delivery (PQ/HLG), not about adding Rec.2100 primaries (which are already BT.2020 / code 9).
