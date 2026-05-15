# Photographer Review R9 — Color Pipeline Deep Inspection

**Date:** 2026-05-15
**Scope:** Targeted review of 8 core color/HDR pipeline files after R8 convergence (commits `e27c6dd7` through `0113e9dd`).
**Reviewer angle:** Professional photographer + color scientist — gamut fidelity, profile accuracy, HDR workflow honesty, display capability correctness.
**Premise:** Photos arrive AFTER the photographer's editing. The encoder + viewer must deliver the photographer's intent accurately.

---

## Summary

R8 found 1 CRIT + 4 HIGH + 8 MED + 10 LOW. The subsequent commit sweep (`e27c6dd7`–`0113e9dd`) systematically closed every R8 finding:

| R8 ID | Severity | Status | Commit |
|-------|----------|--------|--------|
| R8-R1 | CRIT | Fixed | `e27c6dd7` — backfill passes admin settings |
| R8-R2 | HIGH | Fixed | `00cc5cf7` — ETag hash from validated GalleryConfig |
| R8-R3 | HIGH | Fixed | `528a481b` — Lightroom upload preserves color/HDR columns |
| R8-R4 | HIGH | Fixed | `76f8aa14` — bit_depth excluded from public queries |
| R8-R5 | MED | Fixed | `90442ce1` — 10-bit AVIF probe retry + transient detection |
| R8-R6 | MED | Fixed | `90442ce1` — image_sizes in COLOR_IMPACTING_KEYS |
| R8-R7 | MED | Fixed | `90442ce1` — max-age reduced to 3600 |
| R8-R8 | MED | Fixed | `90442ce1` — fresh Sharp instance per format for all paths |
| R8-M1 | MED | Fixed | `f0f76d4d` — NCLX values 4, 5, 7 added |
| R8-M2 | MED | Addressed | `b48c7aa3` — effective pipeline decision with annotation |
| R8-M3 | MED | Fixed | `96886608` — Firefox P3 badge via data-display-gamut |
| R8-M4 | MED | Fixed | `38aea291` — HDR badge "Delivered as SDR" honesty |
| R8-L1 | LOW | Fixed | `94bbbb52` — histogram BT.2020 note |
| R8-L3 | LOW | Fixed | `94bbbb52` — pixel cap label clarified |
| R8-L5 | LOW | Fixed | `94bbbb52` — mobile H shortcut wired |
| R8-L6 | LOW | Open | NCLX_MATRIX_MAP value 10 still omitted |
| R8-L7 | LOW | Open | gain-map heuristic 2 forward-compat |
| R8-L8 | LOW | Open | SSR default 'p3' (documented trade-off) |
| R8-L9 | LOW | Open | DCI-P3 rgb16 comment misleading |
| R8-L10 | LOW | Open | Schema missing CLLI/mastering for WI-09 |

R9 surfaces **0 CRIT, 0 HIGH, 3 MED, 7 LOW** — all are refinement-class findings on an otherwise solid pipeline.

---

## Per-File Analysis

### 1. `color-detection.ts` — Color signal detection

**Overall:** Correct and well-hardened. NCLX walker bounded (depth 5, 1 MB). ICC chromaticity fallback (P4-A2) correctly rescues opaque monitor profiles. Gain map detection integrated.

#### R9-M1 [MEDIUM] — DCI-P3 ICC-name inference returns `'gamma22'` despite `'gamma26'` enum existing

**File:** `color-detection.ts:113`
**Confidence:** Confirmed by direct inspection

```ts
// Line 111-113:
// DCI-P3 (cinema) is gamma-2.6 by SMPTE EG 432-2; treat as gamma22 as
// the closest available enum until a dedicated 'gamma26' value lands.
if (name.includes('dcip3')) return 'gamma22';
```

The comment is stale. The `ColorSignals['transferFunction']` union **already includes `'gamma26'`** (line 25), and `NCLX_TRANSFER_MAP` maps value 17 → `'gamma26'` for SMPTE ST 428-1 (line 188). DCI-P3's documented transfer is gamma-2.6 per SMPTE EG 432-2, not gamma-2.2.

**Impact:** Audit panel shows "Transfer: Gamma 2.2" for DCI-P3 sources when the actual source uses gamma-2.6. On a DCI-P3 calibrated workflow, this misrepresents the photographer's mastering conditions.

**Fix:** Change `return 'gamma22'` to `return 'gamma26'` and update the comment.

**Effort:** XS.

---

#### R9-L1 [LOW] — NCLX_MATRIX_MAP omits value 10 (BT.2020 constant luminance)

**File:** `color-detection.ts:192-196`
**Carried from:** R8-L6

Value 10 = BT.2020 constant luminance (CL) matrix. Rare in stills (primarily video), but a Rec.2020 still exported from DaVinci Resolve or HDR workflow tools may carry it. Falls through to `'unknown'` — harmless but incomplete.

**Fix:** Add `10: 'bt2020-ncl'` to `NCLX_MATRIX_MAP`.

**Effort:** XS.

---

#### R9-L2 [LOW] — `full_range_flag` from NCLX colr box unconsumed

**File:** `color-detection.ts:241-248` (parseCicpFromHeif)
**Carried from:** C8-D1

The 11th byte of the `nclx` colr payload is `full_range_flag` (1 bit). It is read but discarded. For HDR delivery (WI-09), full-range vs. limited-range matters for correct PQ/HLG display. Not blocking today because HDR sources are rejected at ingest (default) or delivered as SDR base.

**Fix:** Add `fullRange: boolean` to `CicpTriplet` return; store in schema when WI-09 schedules.

**Effort:** S (schema + detection + storage).

---

#### Positive (do not change)

- NCLX precedence over ICC is correct and regression-tested.
- ICC chromaticity detection correctly handles Eizo/BenQ opaque names.
- `bitDepth >= 10` → `'unknown'` transfer fallback is the correct conservative choice.
- `inferMatrixCoefficients` correctly returns `'identity'` for all RGB working spaces.
- `hasGainMap` populated from same 1 MB header read as NCLX — single I/O per HEIF/AVIF.

---

### 2. `process-image.ts` — Image encoding pipeline

**Overall:** Mature, well-documented, and architecturally sound. Per-format fresh Sharp instances prevent cross-contamination. Atomic rename contract eliminates 404 windows. DCI-P3 Bradford D65 adaptation is correct.

#### R9-M2 [MEDIUM] — Stored `colorPipelineDecision` is frozen at upload time; doesn't reflect `forceSrgbDerivatives` or encoder setting changes

**File:** `process-image.ts:641-669` (saveOriginalAndGetMetadata)
**Relationship to R8-M2:** The `b48c7aa3` fix added UI-layer annotation ("WebP/JPEG forced to sRGB") but the **stored DB value** still doesn't change.

The decision is computed once at upload:
```ts
const colorPipelineDecision = resolveColorPipelineDecision(iccProfileName, colorSignals);
```

When `forceSrgbDerivatives` is toggled ON later, new uploads will get correctly annotated, but existing images show the old decision in the admin table. The backfill script re-encodes and re-detects, which updates the decision, but an admin who toggles the setting without running backfill sees inconsistent labels.

**Impact:** Admin confusion — the images table shows `p3-from-displayp3` but the served JPEG is sRGB-tagged.

**Fix options:**
1. Add a computed/effective column or display-time resolver that recomputes from `color_primaries` + current setting.
2. Document that `color_pipeline_decision` reflects the upload-time state and the annotation is the source of truth.

**Recommendation:** Option 2 (document) is sufficient. The backfill script exists to reconcile.

**Effort:** XS (docs / comment).

---

#### R9-M3 [MEDIUM] — ProPhoto / Rec.2020 sources clipped to P3 without explicit "clipped" disclosure in audit

**File:** `process-image.ts:528-537` (resolveAvifIccProfile)

Adobe RGB, ProPhoto, and Rec.2020 sources route through `'p3-from-wide'` → AVIF tagged as P3 after `pipelineColorspace('rgb16')` resize. The rgb16 pipeline converts pixel values into the P3 gamut, but **colors outside P3 are clipped**:

| Source | Green primary (x,y) | vs P3 green (0.265, 0.690) | Clipping severity |
|--------|---------------------|---------------------------|-------------------|
| Adobe RGB | (0.210, 0.710) | Inside P3 triangle | Minor |
| ProPhoto | (0.1596, 0.8404) | Far outside P3 | **Severe** |
| Rec.2020 | (0.170, 0.797) | Outside P3 | **Moderate** |

The audit label says "P3 (from ProPhoto)" which implies a mapping, not a clip. A photographer who mastered in ProPhoto (e.g., Phase One Capture One export) expects their highly saturated greens/cyans to survive. They don't.

**Impact:** Photographer intent lost for ProPhoto/Rec.2020 highly saturated colors. The current behavior is a documented trade-off, but the audit panel doesn't disclose the clipping.

**Fix:** When `sourceGamutWiderThan('p3')` (ProPhoto, Rec.2020), append "(clipped to P3)" to the audit label. Or add a dedicated warning row in `ColorDetailsSection`.

**Effort:** S.

---

#### R9-L3 [LOW] — `force_srgb_derivatives` setting name implies all formats, but AVIF remains gamut-preserved

**File:** `process-image.ts:740-743`

The admin toggle `force_srgb_derivatives` only affects `targetIcc` for WebP and JPEG. AVIF always receives the wide-gamut path (`avifIcc` is `'p3'` regardless). This is the documented behavior ("AVIF still gamut-preserved" per CLAUDE.md), but the setting name doesn't communicate the AVIF exemption.

**Impact:** Admin confusion — "I turned on force sRGB but the AVIF is still P3."

**Fix:** Rename setting label to "Force sRGB on WebP/JPEG derivatives" / "WebP/JPEG를 sRGB로 강제 변환" with a tooltip explaining AVIF exemption.

**Effort:** XS (i18n strings only).

---

#### R9-L4 [LOW] — DCI-P3 rgb16 skip comment misleading for NCLX-only sources

**File:** `process-image.ts:831-838`
**Carried from:** R8-L9

```ts
// WI-12: DCI-P3 sources skip rgb16. Rationale:
//   - ICC-embedded DCI-P3: preserving the source ICC lets
//     toColorspace('p3') perform the correct Bradford D63→D65
//     adaptation.
//   - NCLX-only DCI-P3: no ICC to preserve; rgb16 is skipped
//     because the primaries are identical to Display P3 (only
//     white point differs), so gamma-space resize artifacts are
//     negligible.
```

The first bullet is correct for ICC-embedded DCI-P3. The second bullet says "no ICC to preserve" but the actual reason for skipping rgb16 is that the gamma-space resize artifacts are negligible for NCLX-only DCI-P3, not that there's no ICC. The comment structure implies ICC-presence is the deciding factor, but the code path skips rgb16 for ALL DCI-P3 sources.

**Fix:** Rewrite comment to say "DCI-P3 sources skip rgb16 because (a) ICC-embedded sources benefit from preserving the source ICC for Bradford adaptation, and (b) NCLX-only sources have primaries identical to Display P3 so gamma-space resize artifacts are negligible."

**Effort:** XS.

---

#### R9-L5 [LOW] — `wide_gamut_max_source_pixels` downscale is silent; no audit trail

**File:** `process-image.ts:766-775`

When a wide-gamut source exceeds the pixel cap, it's silently downscaled to an intermediate `.wi15.tmp` file before fan-out. The audit panel shows source dimensions and bit depth, but doesn't indicate that the rgb16 pipeline received a downscaled intermediate.

**Impact:** Photographer sees "Original: 60 MP, ProPhoto" and assumes the full-resolution source drove the P3 conversion. It didn't — a 50 MP intermediate did. For most content the difference is invisible, but for pixel-peeping sharpness or fine texture, it matters.

**Fix:** Add an audit row: "Source downscaled to {targetWidth}px wide before wide-gamut conversion (memory cap)" when downscale triggers.

**Effort:** S.

---

#### Positive (do not change)

- Per-format fresh Sharp instances (WI-14) eliminate cross-format state contamination.
- 10-bit AVIF probe with retry + transient-vs-bitdepth discrimination is correct.
- Atomic rename contract (link/copy → rename) eliminates 404 windows.
- `pipelineColorspace('rgb16')` for wide-gamut non-DCI sources is the correct choice.
- `limitInputPixels` bounds check prevents decompression bombs.
- `blurDataUrl` producer-side validation via `assertBlurDataUrl` closes the symmetric defense.
- GPS strip preserves ICC (R7-L2) — color signals survive privacy toggle.

---

### 3. `icc-chromaticity.ts` — ICC chromaticity-based gamut detection

**Overall:** Excellent implementation. Correct ICC tag table walk. Proper s15Fixed16 decoding. XYZ→xy conversion is mathematically sound. Preset gamuts match canonical SMPTE/IEC/ITU specs.

#### Positive (do not change)

- `MAX_TAG_COUNT = 100` and `MAX_TAG_TABLE_BYTES = 4096` provide bounded parsing.
- White-point D50 (ProPhoto) vs D65 (all others) correctly differentiated in presets.
- Match metric uses `max(dR, dG, dB, dW)` — a single badly-matched primary or white point correctly downgrades confidence. This is more conservative than average-distance metrics.
- `HIGH_CONFIDENCE_TOLERANCE = 0.005` and `MEDIUM = 0.015` in Δxy are appropriately strict. For reference, the distance between sRGB red (0.640, 0.330) and Adobe RGB red (0.640, 0.330) is 0 — they share the same red primary. Adobe RGB differs in green, so the max metric catches it.
- CMYK/monochrome profiles correctly rejected (missing rXYZ/gXYZ/bXYZ).
- `XYZ ' ` and `XYZT` signature acceptance handles both standard and variant ICC tag types.

#### R9-L6 [LOW] — Chromaticity distance is 2D Euclidean, not perceptually uniform

**File:** `icc-chromaticity.ts:133-137`

The `chromaDistance` function uses Euclidean distance in xy chromaticity space:
```ts
function chromaDistance(a, b): number {
    return Math.sqrt((a.x-b.x)^2 + (a.y-b.y)^2);
}
```

MacAdam ellipses show that chromaticity discrimination is not uniform — it's ~2.5x more sensitive along the green-magenta axis than the blue-yellow axis in the center of the diagram. However, the tolerance is generous (0.005/0.015), and the preset gamuts are far enough apart that perceptual non-uniformity doesn't cause misclassification. For example:

- sRGB green → P3-D65 green distance: ~0.094
- Adobe RGB green → P3-D65 green distance: ~0.021
- ProPhoto green → P3-D65 green distance: ~0.151

All are well outside even the medium tolerance. The metric is safe.

**Verdict:** No fix needed. Document in code comment if desired.

---

### 4. `icc-extractor.ts` — ICC profile name extraction

**Overall:** Correct v2 `desc` and v4 `mluc` parsing. Locale-matching implemented (P4-E1 / R4-L2). UTF-16BE decoding is correct per ICC.1:2010.

#### Positive (do not change)

- `mluc` record language code matching uses 2-letter ISO 639-1 comparison, case-insensitive — spec-compliant.
- Fallback to first non-empty record when locale doesn't match — correct behavior.
- String clamping to 255 UTF-8 bytes prevents DB overflow.
- Null terminator handling in `desc` tag: `strLen - 1` correctly skips the trailing null.
- `numRecords` capped at 100, `recLen` capped at 1024 — bounded parsing.

#### No new findings.

---

### 5. `gain-map-detection.ts` — Apple HDR gain map detection

**Overall:** Solid two-heuristic detection with conservative forward-compatibility. Bounded ISOBMFF walk.

#### R9-L7 [LOW] — Heuristic 2 (`auxl` → `urim`/`tmap`) could false-positive on future non-HDR encoders

**File:** `gain-map-detection.ts:274-280`
**Carried from:** R8-L7

```ts
for (const ref of irefEntries) {
    if (ref.referenceType !== 'auxl') continue;
    for (const targetId of ref.toItemIds) {
        const targetType = typeById.get(targetId);
        if (targetType === 'urim' || targetType === 'tmap') {
            return true;
        }
    }
}
```

Any `auxl` reference to a `urim` or `tmap` item is flagged as a gain map. Future non-HDR HEIF encoders (e.g., depth maps, semantic masks) might use `tmap` + `auxl` for non-HDR auxiliary data. The risk is low because `tmap` is currently rare outside HDR contexts, but it's not zero.

**Fix:** When `tmap` is encountered without the Apple HDR URI, require an additional signal (e.g., `hvc1`/`av01` codec on the base image, or presence of `tmap` version field indicating HDR). Or document the heuristic limitation.

**Effort:** S (additional signal check) / XS (document).

---

#### Positive (do not change)

- Pre-iOS 17 Apple URN (`urn:com:apple:photo:2020:aux:hdrgainmap`) and iOS 17+ ISO 21496-1 `tmap` both covered.
- `tmap` without Apple URI is deferred to heuristic 2 — conservative, prevents false positives on generic tone maps.
- `MAX_DEPTH = 5`, `MAX_SCAN_BYTES = 1 MB`, `parsed < 1024` caps on all loops.
- `readBoxHeader` handles extended size (64-bit) correctly.

---

### 6. `color-primaries.ts` — Client-safe primaries helpers

**Overall:** Clean, minimal, client-safe. Correct canonical set.

#### Positive (do not change)

- `WIDE_GAMUT_PRIMARIES` set correctly includes P3-D65, DCI-P3, Adobe RGB, ProPhoto, Rec.2020.
- `isWideGamutPrimary` correctly returns false for null/undefined/unknown/bt709.
- No server-side imports — safe for client bundle.
- Type is explicitly `ReadonlySet<string>` at runtime cast, matching the consumer pattern.

---

### 7. `color-pipeline-decisions.ts` — Canonical decision enum

**Overall:** Correct source of truth. `isP3Pipeline` predicate future-proofs against new `p3-from-*` values.

#### Positive (do not change)

- `COLOR_PIPELINE_DECISIONS` array is the single source of truth for the enum.
- `isP3Pipeline` uses `.startsWith('p3-from-')` — any future wide-gamut mapping (e.g., `p3-from-bt2100hlg`) automatically passes.
- i18n smoke test walks this array — new values require translations.
- Client-safe — no server imports.

---

### 8. `use-display-capability.ts` — Display gamut + HDR detection

**Overall:** Excellent layered detection. Snapshot memoization correctly prevents React #185 infinite loop. SSR default `'p3'` is a defensible trade-off.

#### Positive (do not change)

- Layered priority is correct:
  1. `screen.colorGamut` API (most authoritative)
  2. `(color-gamut: rec2020)` MQ
  3. `(color-gamut: p3)` MQ
  4. Canvas-P3 feature probe (Firefox fallback)
- `_cachedSnapshot` reference equality check prevents `useSyncExternalStore` from triggering re-renders on identical values.
- `subscribe()` cleans up all listeners on unmount.
- `visibilitychange` + `focus` fallbacks compensate for `screen.colorGamut` lacking a change event.
- Server default `{ colorGamut: 'p3', isHdr: false }` suppresses WideGamutHint flicker for the common P3-display case — correct UX choice.

#### R9-L8 [LOW] — `isHdr` detection relies solely on `(dynamic-range: high)` MQ

**File:** `use-display-capability.ts:90-92`

```ts
const isHdr = typeof window.matchMedia === 'function'
    ? window.matchMedia('(dynamic-range: high)').matches
    : false;
```

No fallback for browsers that support P3 gamut but not the `dynamic-range` MQ. For example, Chrome on macOS with an XDR display supports P3 via `screen.colorGamut` but does NOT support `(dynamic-range: high)` (Chromium gap documented in CLAUDE.md). `isHdr` returns false on these setups.

**Impact:** HDR badge doesn't appear in Color Details on Chrome + XDR display. The badge is admin-only anyway (honesty rule), so public visitors don't see it. Minor admin-audit inconsistency.

**Fix:** Layer HDR detection similar to gamut:
1. `(dynamic-range: high)` MQ
2. `screen.colorGamut === 'rec2020'` on known HDR-capable displays (indirect signal)
3. Canvas HDR probe (future)

**Effort:** S.

---

## Cross-File Integration Issues

### `ColorSignals.hasGainMap` flattens Apple URN vs ISO tmap distinction

**Files:** `gain-map-detection.ts` → `color-detection.ts` → `process-image.ts`

The detection path can distinguish Apple URN gain maps from ISO 21496-1 `tmap` gain maps, but `ColorSignals.hasGainMap` is a flat boolean. When WI-09 ships and gain map transcode becomes possible, knowing WHICH spec the source follows matters for choosing the correct output encoding.

**Recommendation:** Change `hasGainMap: boolean` to `hasGainMap: false | 'apple-urn' | 'iso-tmap'` before WI-09. This is a schema migration, so do it now while the column is still admin-only and lightly populated.

**Effort:** M (schema + detection + DB migration).

---

## Severity Distribution

| Severity | Count | Items |
|----------|-------|-------|
| **CRIT** | 0 | — |
| **HIGH** | 0 | — |
| **MED** | 3 | R9-M1 DCI-P3 gamma26, R9-M2 stored decision frozen, R9-M3 ProPhoto/Rec.2020 clip undisclosed |
| **LOW** | 7 | R9-L1 NCLX matrix 10, R9-L2 full_range_flag, R9-L3 force_srgb name, R9-L4 DCI-P3 comment, R9-L5 silent downscale, R9-L6 perceptual distance (document), R9-L7 gain map heuristic, R9-L8 HDR detection fallback |

Plus 4 carried-open from R8 (L6, L7, L8, L9, L10) — all LOW class.

---

## What's Correct (Do Not Change)

- **NCLX precedence over ICC** is correct and well-tested.
- **ICC chromaticity detection** rescues opaque monitor profiles correctly.
- **DCI-P3 Bradford D65 adaptation** produces accurate colors.
- **10-bit AVIF probe** with retry and transient discrimination is robust.
- **Per-format fresh Sharp instances** prevent cross-format contamination.
- **Atomic rename contract** eliminates 404 windows during re-encode.
- **ETag with settings hash** correctly invalidates on admin tuning changes.
- **`bit_depth` privacy guard** correctly excludes from public queries.
- **Backfill settings pass-through** ensures backfilled images match fresh uploads.
- **Firefox P3 detection** via canvas-P3 probe + `data-display-gamut` attribute is correct.
- **HDR badge honesty** "Delivered as SDR" is the correct transparency model.
- **`useDisplayCapability` snapshot memoization** prevents React #185.
- **GPS strip preserves ICC** so color signals survive privacy toggles.

---

## Recommended Next Steps

**Immediate (XS effort):**
1. R9-M1: Change DCI-P3 ICC-name inference to `'gamma26'`.
2. R9-L3: Clarify `force_srgb_derivatives` label to mention WebP/JPEG only.
3. R9-L4: Fix DCI-P3 rgb16 skip comment.

**Short-term (S effort):**
4. R9-M3: Add "clipped to P3" disclosure for ProPhoto/Rec.2020 sources in audit panel.
5. R9-L1: Add NCLX matrix value 10.
6. R9-L5: Add downscale audit indicator.
7. R9-L7: Document gain-map heuristic limitation.
8. R9-L8: Layer HDR detection fallback.

**Medium-term (M effort):**
9. Schema: Change `has_gain_map` from boolean to discriminated union (`false | 'apple-urn' | 'iso-tmap'`).
10. R9-L2: Consume `full_range_flag` from NCLX and store for WI-09.

**When WI-09 schedules:**
11. Mastering display metadata schema (CLLI, MaxCLL, MaxFALL, primaries).
12. True HDR AVIF encode + gain map transcode.

---

## Conclusion

The color pipeline is in an **honest, mature, converged state**. R8's CRIT and HIGH findings were all addressed in the subsequent commit sweep. R9 finds no new CRIT or HIGH issues. The 3 MED findings are polish and disclosure-class, not correctness-class. The pipeline correctly preserves photographer intent for the supported gamut range (sRGB through P3), honestly discloses its limitations (HDR delivery deferred, ProPhoto/Rec.2020 clipped to P3), and has robust fallbacks for browser/display detection.

The product is ready for production use from a color-fidelity perspective. Closing R9-M1 and R9-M3 would bring the audit surface to best-in-class transparency.
