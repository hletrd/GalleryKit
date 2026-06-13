# R27 — Color Pipeline + ICC Accuracy Review
**Date:** 2026-05-19
**Lens:** Working professional photographer; color-pipeline engineer.

## Result

**NEW_FINDINGS: 4**

---

### R27-CP-HIGH-1 — `color_space` and `icc_profile_name` publicly exposed; CLAUDE.md says admin-only; compile-time guard and test fixture do not cover them

**Severity:** HIGH
**Files:**
- `apps/web/src/lib/data.ts:215–216` — both fields present in `adminSelectFields`
- `apps/web/src/lib/data.ts:293–311` — `publicSelectFields` derivation does not destructure either out
- `apps/web/src/lib/data.ts:366` — `_PrivacySensitiveKeys` type union omits both
- `apps/web/src/__tests__/privacy-fields.test.ts:5–34` — `SENSITIVE_KEYS` array omits both
- CLAUDE.md table "images color / HDR columns (admin-only via `_PrivacySensitiveKeys` guard)": explicitly lists `color_space` (line 128) and `icc_profile_name` (line 129) as admin-only

**Photographer-visible symptom:** Any unauthenticated API caller reading a public photo endpoint receives the EXIF `ColorSpace` tag value and the ICC profile name string (which can be a custom Eizo/BenQ calibration name like "Eizo CG2700X 2026-05-01") in the JSON response, contrary to the admin-only policy stated in CLAUDE.md. Custom calibration names leak operating environment / monitor identity to the public, and the photographer's color-management workflow becomes a fingerprint surface.

**Technical detail:**

`adminSelectFields` at `data.ts:215–216` includes both `color_space: images.color_space` and `icc_profile_name: images.icc_profile_name`. The `publicSelectFields` derivation destructures out 14 fields (lines 293–311) — `color_pipeline_decision`, `is_hdr`, `has_gain_map`, `was_downscaled`, `transfer_function`, `matrix_coefficients`, `bit_depth`, `uploaded_by`, `processing_error`, `failed_at`, `latitude`, `longitude`, `filename_original`, `user_filename`, `original_format`, `original_file_size`, `processed` — but does not include `color_space` or `icc_profile_name`. Both pass through into `publicSelectFieldCore` and `publicSelectFields` unchanged.

The `_PrivacySensitiveKeys` type union at `data.ts:366` does not name either field, so the compile-time guard `_SensitiveKeysInPublic extends never` evaluates to `never` (passes) even with both fields present in `publicSelectFields`. The symmetric runtime fixture at `privacy-fields.test.ts:75–82` (the "admin-only keys form exactly the SENSITIVE_KEYS contract" test) would fail if these were added to `SENSITIVE_KEYS` without also removing them from `publicSelectFields`, so the fixture currently passes but is not preventing the leak.

Note: `color_primaries` is explicitly marked **public** in CLAUDE.md line 132 and correctly flows through. `avif_10bit` has an inline code comment (`data.ts:246–247`) documenting it as "public-safe"; that judgment is consistent with viewer usage. Only `color_space` and `icc_profile_name` are incorrectly classified.

**Proposed fix:**

1. Add to the `publicSelectFields` destructuring block (`data.ts` around line 300):
   ```ts
   color_space: _omitColorSpacePublic,
   icc_profile_name: _omitIccProfileNamePublic,
   ```
2. Add both to `_PrivacySensitiveKeys` union at `data.ts:366`.
3. Add both to `SENSITIVE_KEYS` array in `privacy-fields.test.ts`.

**Acceptance:** TypeScript build confirms `_privacyGuard` fires at compile time if either field is re-added to `publicSelectFields`; `npm test` confirms the symmetric fixture passes with both in `SENSITIVE_KEYS`.

---

### R27-CP-MED-1 — `dci-p3` absent from ICC chromaticity PRESETS; opaque DCI-P3 ICC profile on TIFF/JPEG falls to `srgb-from-unknown`

**Severity:** MED
**Files:**
- `apps/web/src/lib/icc-chromaticity.ts:32` — `GamutPrimary` type has no `dci-p3` variant
- `apps/web/src/lib/icc-chromaticity.ts:61–92` — PRESETS map contains `srgb`, `p3-d65`, `adobergb`, `prophoto`, `bt2020` — no `dci-p3`
- `apps/web/src/lib/color-detection.ts:357–368` — chromaticity fallback only upgrades `colorPrimaries` when it equals `'unknown'`
- `apps/web/src/lib/color-detection.ts:168–173` — NCLX primaries code 11 = `dci-p3` correctly handled for HEIF/AVIF

**Photographer-visible symptom:** A TIFF exported from DaVinci Resolve into a DCI-P3 working space, or shot on a DCI-P3-calibrated camera and exported as JPEG, whose ICC profile description is a custom calibration name (e.g., "Sony BVM-E251 Calibrated 2026-01") rather than a string containing "dcip3" — is processed as sRGB by the pipeline. The Bradford D63→D65 white-point adaptation is skipped; saturated cyan/magenta values drift toward the D65 white point; the admin audit panel shows `srgb-from-unknown` rather than `p3-from-dcip3`.

**Technical detail:**

The `GamutPrimary` type exported from `icc-chromaticity.ts` at line 32 does not include `dci-p3`. The PRESETS map at lines 61–92 has five entries: `srgb`, `p3-d65`, `adobergb`, `prophoto`, `bt2020`. There is no `dci-p3` preset.

DCI-P3 uses the D63 illuminant white point. Per SMPTE EG 432-2, the D63 white point xy chromaticity is approximately x=0.3140, y=0.3510. The closest PRESETS entry by white-point proximity is `p3-d65` at x=0.3127, y=0.3290. The Euclidean Δxy between these white points is sqrt((0.3140−0.3127)² + (0.3510−0.3290)²) ≈ 0.022. This exceeds `MEDIUM_CONFIDENCE_TOLERANCE = 0.015` (line 30), so the matcher returns `bestMatch = 'unknown'` for any DCI-P3 ICC profile regardless of how well the primaries themselves match.

When `detectColorSignals` reaches the chromaticity path at `color-detection.ts:357–368` for a DCI-P3 source with opaque name: `inferColorPrimaries` returns `'unknown'` (no "dcip3" string), `detectGamutFromIccChromaticity` returns `unknown` (white-point Δxy > tolerance), no NCLX is present on TIFF/JPEG. Result: `colorPrimaries = 'unknown'` → `resolveDecisionFromPrimaries` returns `'srgb-from-unknown'` → `isWideGamutSource = false` (DCI-P3 is not in the `'p3'` or `'p3-from-wide'` branches for unknown primaries) → processed as sRGB.

This gap does NOT affect HEIF/AVIF DCI-P3 sources: NCLX primaries code 11 maps to `'dci-p3'` at `color-detection.ts:171`, which takes full precedence. It also does not affect sources whose ICC name contains "dcip3" (Lightroom Classic, Capture One, standard Adobe profiles). It only affects TIFF/JPEG exports with custom-named DCI-P3 calibration profiles.

**Proposed fix:**

Add a `dci-p3` entry to the `PRESETS` map in `icc-chromaticity.ts` with the D63 white point:
```ts
'dci-p3': {
    r: { x: 0.680, y: 0.320 },
    g: { x: 0.265, y: 0.690 },
    b: { x: 0.150, y: 0.060 },
    wp: { x: 0.3140, y: 0.3510 },
},
```
Add `'dci-p3'` to the `GamutPrimary` type. The white-point difference between DCI-P3 (D63) and Display P3 (D65) is ~0.022 Δxy — well above both tolerance thresholds — so the two cannot be confused by the matcher. Add a fixture-style unit test covering a synthetic ICC buffer with D63 white point and DCI-P3 primaries.

**Acceptance:** `detectGamutFromIccChromaticity` returns `{ primary: 'dci-p3', confidence: 'high' }` for a synthetic DCI-P3 ICC buffer with D63 white point; Display-P3 fixture still returns `p3-d65`; no regressions in existing chromaticity tests.

---

### R27-CP-MED-2 — `pipeline_version` in schema but absent from both select sets; admin audit cannot surface it

**Severity:** MED
**Files:**
- `apps/web/src/db/schema.ts:77` — column present: `pipeline_version: int('pipeline_version')`
- `apps/web/src/lib/data.ts` — grep finds zero occurrences of `pipeline_version`; absent from both `adminSelectFields` and `publicSelectFields`
- CLAUDE.md line 137: listed as admin-only
- `.context/reviews/photographer-r5/_aggregate.md` R5-M6: asked for `pipeline_version` in copy-JSON, but prerequisite select was never done

**Photographer-visible symptom:** An admin looking at the Color Details panel for a photo uploaded two pipeline versions ago sees no indication of which pipeline version encoded it. The copy-to-clipboard JSON (R5-M6 target) cannot include `pipelineVersion` because the field is never fetched from the database. When the admin runs the backfill script and wants to confirm a specific photo was re-encoded to the current pipeline version, the only path is direct DB inspection.

**Technical detail:**

`pipeline_version` exists in the Drizzle schema at `schema.ts:77`. The backfill script writes it (`backfill-color-pipeline.ts:270`). CLAUDE.md documents it as admin-only. However, a grep for `pipeline_version` in `data.ts` returns no matches — the field is not in `adminSelectFields` and therefore not in any select issued by the ORM. The R5-M6 finding from the prior review identified `pipeline_version` as needed in the copy-JSON and the admin audit row, but the prerequisite step of adding it to `adminSelectFields` was never taken as part of the R5 implementation cycle.

**Proposed fix:**

Add `pipeline_version: images.pipeline_version` to `adminSelectFields` in `data.ts`. Add `'pipeline_version'` to `_PrivacySensitiveKeys` and `SENSITIVE_KEYS` (consistent with CLAUDE.md admin-only designation). Then the R5-M6 copy-JSON work (adding `pipelineVersion` to the clipboard payload in `color-details-section.tsx`) becomes unblocked.

**Acceptance:** `getImage()` and `getImageAdmin()` return `pipeline_version` for admin callers; `publicSelectFields` does not include it; privacy fixture confirms it in `SENSITIVE_KEYS`; TypeScript build passes.

---

### R27-CP-LOW-1 — `verifyAvifNclxInBuffer` `size > 64` gate makes `colr(prof)` branch unreachable; false log warnings for every sRGB AVIF upload

**Severity:** LOW
**Files:**
- `apps/web/src/lib/process-image.ts:132–133` — docstring claims `prof` ICC boxes are handled
- `apps/web/src/lib/process-image.ts:149` — `if (size < 12 || size > 64) continue;`
- `apps/web/src/lib/process-image.ts:163–165` — `if (colorType === 'prof')` branch — dead code for real ICC boxes
- `apps/web/src/lib/process-image.ts:1201–1202` — sRGB AVIF verification calls `_verifyAvifNclx(avifPath, 1, 13)`

**Photographer-visible symptom:** Every sRGB photo upload generates a `[verify-avif]` console warning "no NCLX colr box found." In a gallery with thousands of sRGB photos, the backfill and every fresh upload fills the operator log with false alarms that obscure real color-signaling failures from the rare wide-gamut encoder drift this verification was designed to catch.

**Technical detail:**

A real AVIF `colr(nclx)` box is exactly 19 bytes (8-byte ISOBMFF header + 4-byte colour_type FOURCC + 2+2+2+1 NCLX payload). A `colr(prof)` box embedding an ICC sRGB profile is 8-byte header + ICC profile size (the sRGB ICC IEC 61966-2-1 profile is ~3 KB); box size >> 64.

The byte-scanner at `process-image.ts:144–166` searches for the ASCII string `colr` then reads the preceding 4 bytes as the box size. At line 149, `if (size < 12 || size > 64) continue` skips any candidate where the box size exceeds 64 bytes. Since ICC-embedded `colr(prof)` boxes are thousands of bytes, they are always skipped. The `if (colorType === 'prof')` branch at lines 163–165 is therefore dead code for any real AVIF file produced by Sharp.

The P3 AVIF verification path at line 1200 (`_verifyAvifNclx(avifPath, 12, 13)`) is unaffected: Sharp writes NCLX (not ICC) for P3 AVIF, the NCLX box is 19 bytes, and `size <= 64` admits it correctly. The bug only affects the sRGB path at line 1202, where Sharp typically embeds ICC rather than writing NCLX.

This is audit-only: the actual encoding and ICC embedding are correct. The bug is in the verification scanner, not the encoder.

**Proposed fix:**

Restructure the scan to check `colorType` before applying the size gate, and apply a separate size bound only for the NCLX branch:

```ts
for (let i = 4; i < buffer.length - 16; i++) {
    if (buffer.toString('ascii', i, i + 4) !== 'colr') continue;
    const size = buffer.readUInt32BE(i - 4);
    if (size < 8) continue; // minimum valid box size
    const colorType = buffer.toString('ascii', i + 4, i + 8);
    if (colorType === 'nclx') {
        if (size > 64) continue; // NCLX is small; skip implausible sizes
        // ... existing NCLX primaries/transfer check
    }
    if (colorType === 'prof') {
        return { ok: true, message: 'ICC profile (prof) found instead of NCLX' };
    }
}
```

**Acceptance:** Unit test: a synthetic buffer containing a `colr(prof)` box with `size = 4096` returns `{ ok: true, message: 'ICC profile (prof) found instead of NCLX' }`; no `[verify-avif]` warning in logs for sRGB AVIF uploads; existing P3 AVIF unit tests unchanged.

---

## What remains correct (not re-raised)

- NCLX walker in `parseCicpFromHeif`: `size==1` largesize (64-bit), `size==0` (EOF), depth/scan bounds all handled correctly. Closed prior.
- NCLX primaries code 11 (DCI-P3), 12 (Display P3), 9 (BT.2020), 1 (BT.709) correctly mapped. Transfer codes 16 (PQ), 18 (HLG), 17 (DCI gamma 2.6), 14/15 (BT.2020 gamma 2.4) all correct. Code 2 (Unspecified) correctly omitted with comment.
- `fullRange` bit parsed correctly at bit 7 of the flag byte.
- DCI-P3 Bradford path: `isDciP3 = true` → `needsRgb16 = false` → libvips/LittleCMS performs ICC-to-ICC transform (DCI-P3 D63 → Display P3 D65) via the source embedded ICC profile. Correct.
- Adobe RGB / ProPhoto / Rec.2020 → P3: `pipelineColorspace('rgb16')` + `.toColorspace('p3')` + `.withIccProfile('p3')` delegates actual gamut mapping to libvips/LittleCMS using source ICC. Correct.
- WI-15 downscale writes lossless TIFF with `keepIccProfile()` at `process-image.ts:957`. ICC is preserved across the intermediate.
- `Promise.all` fan-out: each format gets a fresh `sharp(processingInputPath, …)` instance per loop iteration inside `generateForFormat` (confirmed at lines 1043–1047). No shared state between AVIF/WebP/JPEG.
- 10-bit AVIF probe: Promise singleton with retry/backoff and permanent-vs-transient error discrimination. Correct.
- Gain map detection: R5-M3 fix confirmed implemented — standalone `tmap` without Apple URI is deferred to auxl heuristic 2.
- `settings-hash.ts`: R5-H2 fix confirmed implemented and extended — covers 9 keys including `sdr_jpeg_chroma`, `wide_gamut_max_source_pixels`, image quality settings, and `image_sizes`.
- `ETag` size field: `stats.size` in `serve-upload.ts:122` is the file byte count from `lstat()` — not pixel dimensions. Naming is unambiguous in context.
- Backfill advisory lock: acquired before the `forceReencode` branch at `backfill-color-pipeline.ts:197`. Two `--force-reencode` runs serialize correctly.
- `color_primaries` is correctly classified as public (CLAUDE.md line 132, flowing through `publicSelectFields`). `avif_10bit` is intentionally public-safe per inline comment at `data.ts:246–247`.
- `_PrivacySensitiveKeys` guard and `SENSITIVE_KEYS` fixture correctly protect: `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `was_downscaled`, `color_pipeline_decision`, `bit_depth`, `uploaded_by`, `processing_error`, `failed_at`.

---

## R5 open items status

| Item | Status |
|---|---|
| R5-H2 settings-hash omissions | CLOSED — `settings-hash.ts` now covers 9 keys |
| R5-M3 tmap standalone heuristic | CLOSED — deferred to auxl check in gain-map-detection.ts |
| R5-M5 .wi15.tmp SIGTERM orphan | CLOSED — tmpPath now uses `os.tmpdir()` at process-image.ts:945 |
| R5-M6 pipeline_version in copy JSON | STILL OPEN — promoted to R27-CP-MED-2 |
