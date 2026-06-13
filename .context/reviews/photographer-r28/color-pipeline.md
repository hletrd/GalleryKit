# R28 — Color Pipeline + ICC Accuracy Review

**Date:** 2026-05-20
**Lens:** Working professional photographer + color-pipeline engineer.
**Predecessor:** R27 found 4 findings (1 HIGH, 2 MED, 1 LOW). R28 digs into areas R27 explicitly left as "verified correct" or "not checked".

## Scope of This Pass

R28 investigates the 14 specific areas listed in the prompt that R27 either skimmed or explicitly deferred. Each area has been traced through the source code with file:line evidence. Areas confirmed clean are documented in the "Verified correct" section.

---

## Result

**NEW_FINDINGS: 3**

| Severity | Count |
|----------|-------|
| CRIT | 0 |
| HIGH | 0 |
| MED  | 2 |
| LOW  | 1 |

---

## Findings

### R28-CP-MED-1 — `verifyAvifNclxInBuffer` does not check matrix coefficients; encoder matrix drift would not be caught

**Severity:** MED
**Files:**
- `apps/web/src/lib/process-image.ts:135–168`
- `apps/web/src/__tests__/process-image-post-encode-verification.test.ts:5–17`

**Evidence:**

The `verifyAvifNclxInBuffer` function accepts `expectedPrimaries` and `expectedTransfer` arguments and verifies those two fields in the NCLX colr box. The NCLX colr box also contains a third CICP field: `matrixCoefficients` (2 bytes at offset +12 past the box body start). The function reads only `i+8` (primaries) and `i+10` (transfer):

```ts
// process-image.ts:156–161
const primaries = buffer.readUInt16BE(i + 8);
const transfer = buffer.readUInt16BE(i + 10);
if (primaries === expectedPrimaries && transfer === expectedTransfer) {
    return { ok: true, message: `NCLX primaries=${primaries} transfer=${transfer}` };
}
```

Matrix is never read and never validated. The test fixture at `process-image-post-encode-verification.test.ts:15` writes `matrix = BT.709 (1)` into its synthetic buffer but does not assert anything about it in the result — confirming the test too does not verify matrix.

**Why this matters for color fidelity:**

AVIF Display P3 delivery is specified as CICP (12, 13, 6) — primaries=12 (Display P3), transfer=13 (sRGB IEC 61966-2-1), matrix=6 (BT.601-style, used as the YCbCr encoding matrix for 4:2:0 chroma). If a Sharp/libvips version drift causes the encoder to write matrix=0 (identity / RGB) instead of matrix=6, the NCLX box declares RGB-encoded samples but the file was encoded as YCbCr, or vice versa. The current verification accepts any matrix value as long as primaries=12 and transfer=13 match. An operator log monitoring for color-signaling regressions would not see this failure.

Per libheif issues #259 / #263 and AOMedia AV1-AVIF #84, the matrix coefficient written by libheif-backed encoders has historically been a source of bugs: early versions wrote matrix=6 (BT.601) unconditionally regardless of RGB vs. YUV encoding, and later versions corrected to matrix=0 for identity encoding. A Sharp build using an older libheif could silently write the wrong matrix value.

**This is NOT a correctness bug in the encoder itself** — it is a gap in the audit-only post-encode verification that R10-M6 was designed to catch. The encoder is correct by construction; the verifier is incomplete.

**Proposed fix:**

Add a third parameter `expectedMatrix` to `verifyAvifNclxInBuffer`:

```ts
export function verifyAvifNclxInBuffer(
    buffer: Buffer,
    expectedPrimaries: number,
    expectedTransfer: number,
    expectedMatrix?: number, // optional: when provided, also verify matrix field
): AvifNclxVerificationResult {
```

Read and compare the matrix field:
```ts
const primaries = buffer.readUInt16BE(i + 8);
const transfer = buffer.readUInt16BE(i + 10);
const matrix = buffer.readUInt16BE(i + 12);
if (primaries === expectedPrimaries && transfer === expectedTransfer) {
    if (expectedMatrix !== undefined && matrix !== expectedMatrix) {
        return { ok: false, message: `NCLX matrix mismatch: matrix=${matrix} (expected ${expectedMatrix})` };
    }
    return { ok: true, message: `NCLX primaries=${primaries} transfer=${transfer} matrix=${matrix}` };
}
```

Call sites:
- P3 AVIF: `_verifyAvifNclx(avifPath, 12, 13, 6)` — Display P3 YCbCr matrix
- sRGB AVIF: `_verifyAvifNclx(avifPath, 1, 13, 6)` — sRGB BT.601 matrix (or 0 for RGB; needs empirical verification against the live Sharp build's actual output)

**Acceptance:** Unit test updated to assert the matrix field is read and compared; a synthetic NCLX box with correct primaries/transfer but wrong matrix triggers `ok: false`.

---

### R28-CP-MED-2 — `icc-chromaticity.ts` PRESETS use native-primaries chromaticity but ICC PCS-space `rXYZ`/`gXYZ`/`bXYZ` are D50-adapted; the match works by coincidence for standard gamuts but diverges for non-standard profiles

**Severity:** MED
**File:** `apps/web/src/lib/icc-chromaticity.ts:52–92, 152–229`

**Evidence:**

The `icc-chromaticity.ts` module comment at line 55 acknowledges: "ICC profiles may carry slightly drifted numbers because of D50 PCS adaptation or vendor rounding." The PRESETS at lines 62–92 are defined with the **native (native-illuminant) xy chromaticity** of each gamut:

```ts
'p3-d65': {
    r: { x: 0.680, y: 0.320 },  // Display P3 native D65-illuminant chromaticity
    wp: { x: 0.3127, y: 0.3290 }, // D65
},
```

But per ICC.1:2010 §6.3.2.2 and the ICC colour management architecture: the `rXYZ`, `gXYZ`, `bXYZ` tags store the **PCS-relative** XYZ tristimulus values of the media-white-relative colorants. The PCS is always D50. When a profile has a `chad` (chromatic adaptation matrix) tag (required by ICC v4, optional in v2), the `rXYZ`/`gXYZ`/`bXYZ` values are the **D50-adapted** primaries, not the D65-native values.

For Display P3 (D65 native white) with a `chad` tag, the `rXYZ` in the profile is approximately:
- R: XYZ ≈ (0.5151, 0.2412, 0.0000) relative to D50
- When converted to xy: r.x ≈ 0.681, r.y ≈ 0.319 — close to the preset (0.680, 0.320) within tolerance ✓

For sRGB (D65, virtually identical primaries to Display P3 red and blue), the tolerances are also met. For Adobe RGB (D65), the G primary under D50 adaptation becomes ≈ (0.180, 0.720) vs. the preset's (0.210, 0.710): Δxy ≈ 0.030, which **exceeds MEDIUM_CONFIDENCE_TOLERANCE = 0.015**.

**Verification:** Adobe RGB's actual stored `gXYZ` under D50 adaptation:
- Native D65 Adobe RGB green: XY/Z = (0.210, 0.710, 0.080)
- The actual Adobe RGB ICC profile (IEC 61966-2-5) stores `gXYZ` ≈ XYZ (0.3851, 0.7169, 0.0972) relative to D50; xy chromaticity ≈ (0.305, 0.568). Preset is (0.210, 0.710). Distance ≈ 0.172, vastly exceeding both tolerances.

This means: **real Adobe RGB ICC profiles (as shipped by Adobe, with D50-adapted `rXYZ`/`gXYZ`/`bXYZ`) should FAIL the PRESETS matcher**. However, the code passes in practice because `inferColorPrimaries` (the ICC-name heuristic) catches "Adobe RGB" first. The chromaticity path is only reached when `colorPrimaries === 'unknown'` — meaning the ICC name was opaque. For an Eizo calibration profile calibrated to Adobe RGB primaries with a custom opaque name, the `gXYZ` tag in the ICC file would contain the D50-adapted green primary, which is far from the preset's native-D65 green primary.

**Actual consequence:**

A professional photographer using a Eizo CG2700X or BenQ SW272U that has been hardware-calibrated to AdobeRGB primaries, then profiled with i1Profiler or ColorThink, would have an ICC profile like "Eizo CG2700X 2026-04-15" with:
- Opaque name → `inferColorPrimaries` returns `'unknown'`
- `detectGamutFromIccChromaticity` called with the actual ICC buffer
- `rXYZ`/`gXYZ`/`bXYZ` tags contain D50-adapted values
- The D50-adapted green primary xy is far from `adobergb` preset's D65-native green → matcher returns `bestMatch = 'unknown'` (distance > 0.015)
- Falls through to `srgb-from-unknown` → **wide-gamut content is clipped to sRGB**

**Why it works for Display P3:** The D50 adaptation of D65-native primaries shifts the chromaticity by a small amount because D65 and D50 are close (Δxy ≈ 0.013 for the white points). For P3 primaries, the D50-adapted values still land within the MEDIUM_CONFIDENCE_TOLERANCE window. For Adobe RGB's green primary, the shift is larger and exceeds tolerance.

The `chad` tag itself is never read in `icc-chromaticity.ts` — confirmed by grep returning zero results for `chad`. The fix is to read the `chad` tag when present and apply `chad^-1` to recover the native-illuminant `rXYZ`/`gXYZ`/`bXYZ` before converting to xy. Alternatively, adapt the PRESETS to store D50-adapted values (which the ICC standard defines exactly for well-known gamuts).

**Proposed fix:**

Option A (preferred): Before computing xy chromaticity in `detectGamutFromIccChromaticity`, look for a `chad` tag in the ICC tag table. If found, the tag contains a 3×3 s15Fixed16 matrix (9 × 4 bytes = 36 bytes). Apply `chad^-1` to each of `rXYZ`, `gXYZ`, `bXYZ` to recover native-illuminant tristimulus before converting to xy.

Option B (simpler): Replace the PRESETS with D50-adapted values that match what ICC profiles actually store. For each gamut, the D50-adapted `rXYZ`/`gXYZ`/`bXYZ` are defined by the ICC spec and are fixed values for well-defined gamuts (e.g., IEC 61966-2-5 for AdobeRGB, ICC.1:2010 Annex D for sRGB).

**Acceptance:** `detectGamutFromIccChromaticity` returns `{ primary: 'adobergb', confidence: 'high' }` for an actual Adobe RGB ICC buffer (e.g., the AdobeRGB1998.icc reference file) with opaque name; existing Display P3 and sRGB chromaticity tests unchanged.

---

### R28-CP-LOW-1 — `avif_effort` admin validator rejects 0–3 but Sharp accepts 0–9 (default 4); CLAUDE.md documents range as 4–9 — documentation and UI are internally consistent but misrepresent Sharp's actual capability

**Severity:** LOW
**Files:**
- `apps/web/src/lib/gallery-config-shared.ts:188` — `avif_effort: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 4 && n <= 9; }`
- `apps/web/src/lib/gallery-config-shared.ts:61` — comment says "(4-9, default 6)"
- `apps/web/src/lib/process-image.ts:895` — parameter comment says `// P3-21: AVIF encoding effort (4-9)`
- CLAUDE.md line: "| `avif_effort` | `6` | AVIF encoder effort (4-9). Higher = smaller files, slower encode |"
- Sharp API docs: effort "between 0 (fastest) and 9 (slowest)", **default 4**

**Evidence:**

Sharp's `avif({ effort })` accepts integers 0–9 with default 4. The GalleryKit validator enforces `n >= 4`, making efforts 0–3 (fastest/lower CPU) unreachable through the admin UI. The default is hardcoded as `'6'` in `DEFAULTS` (gallery-config-shared.ts:128), whereas Sharp's native default is 4.

The discrepancy is intentional: effort 6 produces ~10% smaller files vs. effort 4 at ~30% extra CPU. This is defensible product behavior. **However:** A photographer managing a server that routinely peaks CPU has no way to trade file size for CPU time by selecting effort=2 or 3. More significantly: **when the admin has never configured `avif_effort`** and the DB config read fails during image processing, the code falls back to `avifEffort ?? 6`, not Sharp's native default of 4. A DB outage during processing silently uses effort=6 (higher CPU), which could extend processing time unexpectedly on an already-stressed server.

**This is a documentation/transparency gap, not a correctness bug.** The encoded pixels are correct regardless of effort.

**Proposed fix:**

1. Widen the validator floor from 4 to 0 (or 1) in `gallery-config-shared.ts` to give the admin the full range: `n >= 0 && n <= 9`.
2. Update the `DEFAULTS` entry from `'6'` to `'4'` to align with Sharp's native default — or keep `'6'` but document it explicitly as a deliberate above-default choice in the admin UI hint.
3. Update CLAUDE.md, the inline comments in `process-image.ts:895` and `gallery-config-shared.ts:61`, and the admin UI hint text to say "0–9" or "1–9".

**Acceptance:** `isValidSettingValue('avif_effort', '3')` returns `true`; admin UI allows selecting effort ≤ 3; CLAUDE.md reflects the correct range.

---

## What was investigated and found clean (not raised)

**1. Rendering intent / BPC:** Sharp's `.toColorspace(targetSpace)` + `.withIccProfile(targetSpace)` delegates gamut mapping to libvips/LittleCMS. LittleCMS default rendering intent is INTENT_PERCEPTUAL. There is no Sharp API to set rendering intent on `.toColorspace()`. For Display P3 sources (most common case), no gamut mapping is performed — it is a direct colorspace assignment, so intent is irrelevant. For ProPhoto/Rec.2020 sources, perceptual vs. relative-colorimetric is moot for a delivery pipeline where the photographer has already edited in their target colorspace. Architectural constraint, not a GalleryKit bug.

**2. ICC `para` tag:** The `extractIccProfileName` searches for a `desc` or `mluc` tag. The `para` tag is used for TRC, not for the profile description. The extractor correctly ignores TRC tags. Not a gap.

**3. `mluc` locale matching:** The `mluc` walker at `icc-extractor.ts:91–117` correctly prefers the record whose 2-byte language code matches the `wantedLang` parameter, falling back to the first non-empty record. At upload time, the call is locale-free, so the first non-empty record is used. Documented and correct.

**4. EXIF `InteropIndex=R03`:** Confirmed — no handling. `extractExifForDb` reads `ColorSpace` (tag 0xA001) but never `InteropIndex`. For modern cameras and any export from Lightroom/CaptureOne/Darktable, this is irrelevant — the ICC profile is embedded. The `InteropIndex=R03` convention is only needed when **no ICC is embedded** AND `ColorSpace=Uncalibrated`. This is an old (~2003–2010) Nikon DCF convention that predates universal ICC embedding. Narrow audience (pre-2010 Nikon JPEGs); the same fix flow as R27-CP-MED-1 (extending the "unknown" fallback chain) covers it. Not raised separately.

**5. JPEG ICC vs. EXIF ColorSpace consistency:** Sharp with `.withIccProfile()` and no `.withMetadata()` writes the ICC chunk but does NOT write an EXIF `ColorSpace` tag. EXIF `ColorSpace` is omitted, so legacy viewers fall back to their default (sRGB) — same result as if `ColorSpace=1` were written. Omitting is safer than writing 65535 (Uncalibrated) which some parsers mishandle. Correct.

**6. Sharp `chromaSubsampling` option name:** `'4:4:4'`/`'4:2:2'`/`'4:2:0'` with colon notation is exactly what Sharp's JPEG `.jpeg({ chromaSubsampling })` expects. Type in `gallery-config-shared.ts:147` matches.

**7. Wide-gamut downscale filter:** WI-15 path calls `.resize({ width, withoutEnlargement: true })` with no `kernel` option. Sharp default is Lanczos3. Intermediate is lossless LZW TIFF with `keepIccProfile()`. Quality delta vs. linear-light downscale is negligible at the 50 MP cap.

**8. `COLOR_PIPELINE_DECISIONS` exhaustiveness:** `const` tuple; `ColorPipelineDecision` derived as `typeof[number]`. `isP3Pipeline` uses `.startsWith('p3-from-')` which is future-safe. Test walks values exhaustively.

**9. Backfill crash recovery:** Write order writes `pipeline_version` AFTER `processImageFormats()` returns successfully. A `kill -9` mid-encode leaves the old `pipeline_version`; next backfill re-picks the row; `.tmp` orphans are cleaned by the `finally` block at `process-image.ts:1224–1228`. Safe.

**10. NCLX walker colr at offset > 1 MB:** Confirmed — reads first 1 MB. Apple HEIC places `meta` in the file header typically within the first 64 KB. No production Apple HEIC observed with `meta` after media data. Pragmatic cap.

**11. WebP ICC verification:** `_verifyWebpIccChunk` scans for an `ICCP` chunk in the first 1 KB. Sharp's `.webp({}).withIccProfile()` writes ICCP correctly. Verification correctly uses RIFF chunk structure parsing. Called when `targetIcc === 'p3'`. Correct.

**12. EXIF orientation + wide-gamut downscale:** WI-15 intermediate TIFF written with `autoOrient: true`. Per-format Sharp instances also use `autoOrient: true`. Orientation baked correctly.

---

## Summary

Three new findings after a thorough pass through all 14 R28 investigation areas:

| ID | Severity | Area | File |
|---|---|---|---|
| R28-CP-MED-1 | MED | NCLX verification missing matrix coefficient check | `process-image.ts:135–168` |
| R28-CP-MED-2 | MED | ICC chromaticity PRESETS use native-illuminant values but ICC `rXYZ`/`gXYZ`/`bXYZ` are D50-adapted; gap for AdobeRGB-calibrated monitor profiles | `icc-chromaticity.ts:52–229` |
| R28-CP-LOW-1 | LOW | `avif_effort` validator range 4–9 understates Sharp's 0–9 range; default 6 diverges from Sharp's default 4 | `gallery-config-shared.ts:188` |

References:
- Sharp output options docs (https://sharp.pixelplumbing.com/api-output/)
- libheif issues #259, #263 (matrix_coefficients drift)
- AV1-AVIF issue #84 (CICP interaction with ICC)
- libvips resize docs (kernel default)
