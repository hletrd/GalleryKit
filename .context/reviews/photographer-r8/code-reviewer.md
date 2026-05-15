# Photographer Review R8 — Color/HDR Pipeline Deep Review

**Date:** 2026-05-12
**Scope:** Deep pass over the 9 core color/HDR pipeline files after R6 convergence (commits `29bf9812` through `a8a59b0d`).
**Reviewer angle:** Professional photographer — color fidelity, HDR workflow, color space management, display gamut detection, precision preservation, edge-case encoder behavior.
**Findings:** 0 CRITICAL, 0 HIGH, 4 MEDIUM, 3 LOW

---

## Summary

The color/HDR pipeline is mature and converged after 8 cycles of review-fix. R8 finds no CRITICAL or HIGH-severity color-fidelity issues. The 4 MEDIUM findings are NCLX mapping gaps that degrade audit-panel accuracy, a data-model inconsistency between stored pipeline decisions and runtime admin toggles, and a subtle encoder-path comment that doesn't generalize to NCLX-only sources. The 3 LOW findings are edge-case NCLX values and a documented heuristic limitation.

All color conversion paths (P3, Adobe RGB, ProPhoto, Rec.2020, DCI-P3) are handled correctly at the encoder level. The 10-bit AVIF gate, rgb16 pipeline, per-format fresh Sharp instances, atomic rename contract, and Bradford D65 adaptation for DCI-P3 are all sound. The pipeline delivers photographer intent accurately.

---

## Severity Distribution

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 4 | R8-M1, R8-M2, R8-M3, R8-M4 |
| LOW | 3 | R8-L1, R8-L2, R8-L3 |

---

## Per-Finding Detail

### R8-M1 [MEDIUM] — NCLX_TRANSFER_MAP omits ITU-T H.273 value 4 (Gamma 2.2)

**File:** `apps/web/src/lib/color-detection.ts:175`
**Line:**
```typescript
const NCLX_TRANSFER_MAP: Record<number, ColorSignals['transferFunction']> = {
    1: 'srgb',
    2: 'gamma22',
    6: 'gamma22',
    // ... value 4 is missing
```

**Photographer impact:** A photographer exports a HEIF/AVIF from a camera or editor (e.g., some Canon/Fuji firmware, or DaVinci Resolve still exports) that writes NCLX `transferCharacteristics = 4` ("Gamma 2.2 curve" per ITU-T H.273 Table 2). The upload pipeline falls through to `'unknown'` because 4 is unmapped. The Color Details accordion shows **Transfer: unknown** instead of the accurate **gamma22**. This undermines photographer trust in the audit panel — they see an unexplained gap in otherwise precise metadata.

The actual encoding behavior is unaffected (encoder uses Sharp's ICC-aware conversion, not our inferred label), and HDR detection remains correct (only PQ/HLG flip `is_hdr`). This is purely an audit-panel honesty issue.

**Confidence:** High — value 4 is explicitly defined in H.273 and is common in camera firmware.

**Fix:** Add `4: 'gamma22'` to `NCLX_TRANSFER_MAP` alongside the existing `2` and `6` entries.

---

### R8-M2 [MEDIUM] — NCLX_TRANSFER_MAP omits ITU-T H.273 values 5 and 7 (legacy broadcast gamma)

**File:** `apps/web/src/lib/color-detection.ts:175`
**Line:** Same map as R8-M1.

**Photographer impact:** ITU-T H.273 value 5 (BT.470 System M / NTSC, gamma ~2.2) and value 7 (SMPTE 240M, gamma ~2.2) appear in legacy broadcast and some professional video-frame extracts saved as HEIF/AVIF stills. These fall to `'unknown'` in the audit panel. Same impact as R8-M1: unexplained metadata gap.

**Confidence:** Medium — less common than value 4, but valid H.273 codes that map to the same gamma-2.2 family.

**Fix:** Add `5: 'gamma22', 7: 'gamma22'` to `NCLX_TRANSFER_MAP`.

**Note:** Values 9 (Log 100:1) and 10 (Log 316.1:1) are also missing. These are logarithmic cinema transfers (ARRI LogC, Sony S-Log) and are rare in still-image containers. The `ColorSignals['transferFunction']` type does not include a `'log'` value, so they must map to `'unknown'` until the enum is extended. This is acceptable.

---

### R8-M3 [MEDIUM] — Stored `colorPipelineDecision` does not reflect `forceSrgbDerivatives` admin toggle

**File:** `apps/web/src/lib/process-image.ts:641` (upload-time decision storage)
**File:** `apps/web/src/app/actions/images.ts` (DB insert)

**Line in process-image.ts:**
```typescript
const colorPipelineDecision = resolveColorPipelineDecision(iccProfileName, colorSignals);
```

This decision is written to `images.color_pipeline_decision` at upload time. It describes the **source gamut** (e.g., `p3-from-displayp3`), not the **effective output configuration**. When the admin toggles `forceSrgbDerivatives = true`, the actual WebP/JPEG derivatives are re-encoded as sRGB-tagged, but the DB row still reads `p3-from-displayp3`. The Color Details accordion and admin audit tables surface the stored decision, not the current effective one.

**Photographer impact:** An admin opens a photo's Color Details, sees "Decision: p3-from-displayp3", and downloads the JPEG. The JPEG is actually sRGB-tagged because `forceSrgbDerivatives` is ON. The photographer is misled about what they're receiving. This is especially confusing because the AVIF derivative is still P3-tagged (the toggle only affects WebP/JPEG), so the two formats have different gamuts for the same source.

**Confidence:** High — the toggle is explicitly documented to require backfill, but the DB-stored decision is never updated even after backfill. A backfill re-runs `processImageFormats` with the new settings, but `colorPipelineDecision` is computed in `saveOriginalAndGetMetadata`, which is **not** re-run during backfill. The backfill script only calls `processImageFormats`, not `saveOriginalAndGetMetadata`.

**Fix:** One of the following:
1. **Recommended:** Store `force_srgb_derivatives` state in the DB (or compute the effective decision at display time). The audit panel should show the effective decision, not the historical source-only decision.
2. **Alternative:** Add a display-time helper that recomputes the effective pipeline decision from stored `color_primaries` + current `forceSrgbDerivatives` setting. This avoids schema changes.
3. **Documentation-only:** Add an explicit note in the Color Details accordion when `forceSrgbDerivatives` is active, e.g., "WebP/JPEG forced to sRGB by admin setting; AVIF remains gamut-preserved."

---

### R8-M4 [MEDIUM] — DCI-P3 skip-rgb16 rationale in comment applies only to ICC-embedded sources

**File:** `apps/web/src/lib/process-image.ts:801-804`
**Lines:**
```typescript
// WI-12: DCI-P3 sources skip rgb16 pipeline so the source ICC profile
// (with DCI white point) is preserved for the toColorspace('p3') transform,
// which then does the correct Bradford adaptation to D65.
const needsRgb16 = isWideGamutSource && !isDciP3;
```

**Photographer impact:** For NCLX-only DCI-P3 sources (HEIF/AVIF with `colr` box primaries=11, no embedded ICC), there is **no source ICC profile to preserve**. Yet `needsRgb16` is still `false`, so the resize happens in gamma-encoded space rather than 16-bit linear. Gamma-space resize on wide-gamut images can introduce edge halos and desaturation at high-contrast boundaries. For DCI-P3 specifically, the effect is minimal because DCI-P3 and Display P3 share the same RGB primaries (only white point differs: D63 vs D65). But the comment's rationale is wrong for this case, and a future maintainer might copy this pattern to other gamuts where gamma-space resize would be more visible.

**Confidence:** Medium — the visual impact is subtle for DCI-P3 because the primaries are close to Display P3, but the comment is technically misleading.

**Fix:** Update the comment to acknowledge both cases:
```typescript
// WI-12: DCI-P3 sources skip rgb16. Rationale:
//   - ICC-embedded DCI-P3: preserving the source ICC lets toColorspace('p3')
//     perform the correct Bradford D63→D65 adaptation.
//   - NCLX-only DCI-P3: no ICC to preserve; rgb16 is skipped because the
//     primaries are identical to Display P3 (only white point differs),
//     so gamma-space resize artifacts are negligible.
```

Alternatively, investigate whether `pipelineColorspace('rgb16')` can safely be used for NCLX-only DCI-P3 sources. If Sharp/libvips correctly applies the NCLX-derived working profile for the linear conversion, rgb16 could be enabled for NCLX-only DCI-P3 without harm. This would require a round-trip test to verify.

---

### R8-L1 [LOW] — NCLX_MATRIX_MAP omits value 10 (BT.2020 constant luminance)

**File:** `apps/web/src/lib/color-detection.ts:188-192`
**Line:**
```typescript
const NCLX_MATRIX_MAP: Record<number, ColorSignals['matrixCoefficients']> = {
    0: 'identity',
    1: 'bt709',
    9: 'bt2020-ncl',
};
```

ITU-T H.273 value 10 is "BT.2020 constant luminance" (BT.2020-CL). This is used in some professional video pipelines. For still images, it is extremely rare. When present, `matrixCoefficients` falls to `'unknown'`. This has no impact on encoding (matrix coefficients only matter for YCbCr encoding, and the pipeline outputs RGB-derived AVIF/WebP/JPEG). The audit panel shows "Matrix: unknown," which is harmless.

**Fix:** Add `10: 'bt2020-ncl'` with a comment noting it is constant-luminance variant, or leave as-is.

---

### R8-L2 [LOW] — `gain-map-detection.ts` heuristic 2 could false-positive on non-HDR `tmap` items

**File:** `apps/web/src/lib/gain-map-detection.ts:274-280`
**Lines:**
```typescript
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

ISO 21496-1 defines `tmap` as a generic "tone map representation" item type. Future encoders could use `tmap` + `auxl` for non-HDR purposes (e.g., artistic tone mapping, SDR-to-HDR conversion without a gain map). The heuristic would flag such images as having an HDR gain map.

**Photographer impact:** A future non-HDR `tmap` image would be falsely flagged with `hasGainMap: true`. The admin audit panel would show a gain-map badge for an image that does not actually carry HDR data. This is a forward-compatibility concern, not a current bug.

**Confidence:** Low — no known non-HDR `tmap` usage exists in consumer photography today.

**Fix:** Document the limitation in the module-level comment. When a non-HDR `tmap` format emerges, tighten the heuristic to inspect the `tmap` item's content (e.g., check for ISO 21496-1 specific box structure) rather than relying solely on item type + `auxl` reference.

---

### R8-L3 [LOW] — `useDisplayCapability` SSR default is P3, which is defensible but not universally optimal

**File:** `apps/web/src/lib/use-display-capability.ts:37`
**Line:**
```typescript
const SERVER_DEFAULT: DisplayCapability = { colorGamut: 'p3', isHdr: false };
```

The SSR default of `'p3'` suppresses the `WideGamutHint` on first paint. For the ~60-70% of users on P3-capable Apple devices, this is correct (no flash of incorrect hint). For sRGB-display users, the hint appears after hydration. This is a known trade-off documented in the module comment.

However, global display statistics suggest that sRGB-only displays (Windows laptops, Android mid-range, most external monitors) still dominate the installed base. The P3 default optimizes for the Apple ecosystem, which may be the primary target for GalleryKit, but it means non-Apple sRGB users briefly see no hint.

**Fix:** No code change required — the trade-off is documented and defensible. If analytics show that the majority of visitors are on sRGB displays, consider flipping the default to `'srgb'` and accepting the P3-user flash. Alternatively, derive the default from `Accept-Language` or user-agent heuristics (e.g., macOS/iOS → P3, Windows/Android → sRGB), though this is fragile.

---

## Positive Observations

These patterns reinforce good color-fidelity practice and should be preserved in future refactors.

1. **Promise-singleton 10-bit AVIF probe** (`process-image.ts:60-86`): The `_probeHighBitdepthAvif` + `_highBitdepthAvifProbePromise` pattern correctly eliminates the race condition from prior cycles (PP-BUG-2). The per-image fallback catch (lines 848-862) is also correct — a probe-success followed by image-specific failure downgrades to 8-bit for that image only, without poisoning the process-wide gate.

2. **Per-format fresh Sharp instances on rgb16 path** (`process-image.ts:808-812`): WI-14's requirement to use a fresh `sharp()` per format is correctly implemented. The `image.clone()` path for non-rgb16 sources is safe because Sharp's `clone()` creates independent pipelines. No shared-state cross-format contamination.

3. **NCLX-wins-over-ICC precedence is correct and locked by test** (`color-detection.ts:352-356`, test at `color-detection.test.ts:253-282`): When an iPhone HDR HEIF carries both NCLX (Rec.2020/PQ) and a misleading ICC name ("Display P3"), the NCLX signal correctly drives `isHdr=true` and triggers the HDR rejection gate. The test prevents future regressions.

4. **Atomic rename contract for base filenames** (`process-image.ts:903-925`): The hard-link → rename fallback chain eliminates the brief window where a concurrent reader could 404 during derivative generation. The `fs.unlink(tmpPath)` cleanup in `finally` is correct.

5. **DCI-P3 Bradford adaptation is real** (`process-image.ts:801-804`): For ICC-embedded DCI-P3 sources, Sharp's `toColorspace('p3')` delegates to libvips/Little-CMS, which performs a Bradford CAT from D63 (0.314, 0.351) to D65 (0.3127, 0.3290). This is verified by the round-trip tests in `process-image-color-roundtrip.test.ts`.

6. **ICC chromaticity detection rescues opaque profile names** (`color-detection.ts:339-349`, `icc-chromaticity.ts`): Custom monitor profiles (Eizo, BenQ, X-Rite calibrations) with arbitrary description strings are correctly identified via `wtpt`/`rXYZ`/`gXYZ`/`bXYZ` tags. The high/medium/low confidence tier prevents false positives.

7. **ETag pipeline version + settings hash correctly invalidates caches** (`serve-upload.ts`, `settings-hash.ts`): Changing `IMAGE_PIPELINE_VERSION` or any color-impacting admin setting (`wide_gamut_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, etc.) busts the ETag, ensuring browsers re-fetch derivatives. The `settings-hash.test.ts` locks the `COLOR_IMPACTING_KEYS` set.

---

## Cross-Reference to Prior Reviews

| Finding | Prior related finding | Relationship |
|---------|----------------------|--------------|
| R8-M3 | R6-H1 (bootstrap NCLX) | Separate — R6-H1 was about queue restart; R8-M3 is about `forceSrgbDerivatives` vs stored decision |
| R8-M4 | WI-12 (DCI-P3 Bradford) | Extends — the existing comment is correct for ICC sources but misleading for NCLX-only sources |
| R8-L2 | R4-H1 (gain map detection) | Forward-compatibility note on the `tmap` heuristic |
| R8-L3 | R4-M1 (display capability) | Revisited — the P3 SSR default is still the right trade-off |

---

## Verdict

**APPROVE with comments.**

The color/HDR pipeline is converged and photographer-trustworthy. No CRITICAL or HIGH issues were found in the 9 reviewed files. The 4 MEDIUM findings are audit-panel accuracy and documentation gaps, not actual color conversion errors. The core encoder paths (rgb16 → P3 conversion, 10-bit AVIF, DCI-P3 Bradford adaptation, NCLX precedence, ICC chromaticity fallback) are all correct and well-tested.

Recommended next actions (in priority order):
1. Fix R8-M1 and R8-M2 (add missing NCLX transfer values) — trivial one-line changes.
2. Fix R8-M3 (stored decision vs `forceSrgbDerivatives` inconsistency) — requires either a display-time helper or a UI annotation.
3. Fix R8-M4 (update DCI-P3 comment) — trivial comment update.
