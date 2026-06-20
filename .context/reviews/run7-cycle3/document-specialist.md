# Document-Specialist Review — Run-7 Cycle-3

**Date:** 2026-06-19
**Agent:** document-specialist
**HEAD:** 1cdbb883 (latest after cycle-2 fix commits ae5e82cb + eff5d8d6 + doc commit 10108963)
**Role:** Doc/code mismatches AND code-claims vs external authoritative sources

---

## Scope Confirmed

- Matrix 8=YCgCo (AGG-R7C1-01) — FIXED in cycle-1 ✓
- Transfer 5=gamma28 (AGG-R7C2-01) — FIXED in cycle-2 ✓
- Firefox MQ doc (AGG-R7C1-02) — FIXED in cycle-2 ✓
- Histogram clip math (REJ-R7C2-01) — REFUTED; NOT re-filed ✓

---

## Authoritative Sources Consulted

1. **FFmpeg `libavutil/pixfmt.h`** — `https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavutil/pixfmt.h`
   — Full `AVCOL_PRI_*`, `AVCOL_TRC_*`, `AVCOL_SPC_*` enum tables; authoritative mirror of ITU-T H.273 Tables 2/3/4.

2. **FFmpeg vf_colorspace patch** — `https://patchwork.ffmpeg.org/patch/1228/`
   — Transfer coefficients for `AVCOL_TRC_IEC61966_2_4` (xvYCC, code 11): `{1.099, 0.018, 0.45, 4.5}` (BT.709, not sRGB).

3. **Wikipedia — XvYCC** — `https://en.wikipedia.org/wiki/XvYCC`
   — Confirms xvYCC (IEC 61966-2-4) uses BT.709 transfer extended to negative RGB values.

4. **OWASP Password Storage Cheat Sheet** — `https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html`
   — Confirmed five equivalent Argon2id profiles; minimum 19 MiB / 2 iterations / p=1.

5. **SMPTE ST 428-1 / DCI** — multiple search sources confirmed: code 17 = SMPTE ST 428-1 = gamma 2.6 (DCI cinema).

---

## Part 1: NCLX Mapping Tables Systematic Cross-Check

File: `apps/web/src/lib/color-detection.ts` (lines 160–215 after both fixes)

### NCLX_PRIMARIES_MAP

| Code | Code value | FFmpeg `AVCOL_PRI_*` | H.273 name | Verdict |
|------|-----------|---------------------|------------|---------|
| 1 | `'bt709'` | `AVCOL_PRI_BT709` | ITU-R BT.709 | CORRECT ✓ |
| 9 | `'bt2020'` | `AVCOL_PRI_BT2020` | ITU-R BT.2020 | CORRECT ✓ |
| 11 | `'dci-p3'` | `AVCOL_PRI_SMPTE431` | SMPTE ST 431-2 / DCI P3 | CORRECT ✓ |
| 12 | `'p3-d65'` | `AVCOL_PRI_SMPTE432` | SMPTE ST 432-1 / P3 D65 / Display P3 | CORRECT ✓ |

All four primaries mappings are correct.

### NCLX_TRANSFER_MAP

| Code | Code value | FFmpeg `AVCOL_TRC_*` | H.273 name / gamma | Verdict |
|------|-----------|---------------------|-------------------|---------|
| 1 | `'srgb'` | `AVCOL_TRC_BT709` | ITU-R BT.709 | Documented approximation; code comment + CLAUDE.md explicitly call it out. Not an error. ✓ |
| 4 | `'gamma22'` | `AVCOL_TRC_GAMMA22` | ITU-R BT.470M / gamma 2.2 | CORRECT ✓ |
| 5 | `'gamma28'` | `AVCOL_TRC_GAMMA28` | ITU-R BT.470BG / gamma 2.8 | CORRECT ✓ (cycle-2 fix) |
| 6 | `'gamma22'` | `AVCOL_TRC_SMPTE170M` | SMPTE 170M | Documented approximation; comment acknowledges no exact label. ✓ |
| 7 | `'gamma22'` | `AVCOL_TRC_SMPTE240M` | SMPTE 240M | Documented approximation; comment acknowledges. ✓ |
| 8 | `'linear'` | `AVCOL_TRC_LINEAR` | Linear | CORRECT ✓ |
| 11 | `'srgb'` | `AVCOL_TRC_IEC61966_2_4` | IEC 61966-2-4 (xvYCC) | COMMENT INACCURATE (LOW) — see finding below |
| 13 | `'srgb'` | `AVCOL_TRC_IEC61966_2_1` | IEC 61966-2-1 / sRGB | CORRECT ✓ |
| 14 | `'gamma24'` | `AVCOL_TRC_BT2020_10` | BT.2020 10-bit (BT.1886) | CORRECT ✓ |
| 15 | `'gamma24'` | `AVCOL_TRC_BT2020_12` | BT.2020 12-bit (BT.1886) | CORRECT ✓ |
| 16 | `'pq'` | `AVCOL_TRC_SMPTE2084` | SMPTE ST 2084 / PQ | CORRECT ✓ |
| 17 | `'gamma26'` | `AVCOL_TRC_SMPTE428` | SMPTE ST 428-1 / DCI gamma 2.6 | CORRECT ✓ |
| 18 | `'hlg'` | `AVCOL_TRC_ARIB_STD_B67` | ARIB STD-B67 / HLG | CORRECT ✓ |

### NCLX_MATRIX_MAP

| Code | Code value | FFmpeg `AVCOL_SPC_*` | H.273 name | Verdict |
|------|-----------|---------------------|------------|---------|
| 0 | `'identity'` | `AVCOL_SPC_RGB` | Identity / RGB | CORRECT ✓ |
| 1 | `'bt709'` | `AVCOL_SPC_BT709` | ITU-R BT.709 | CORRECT ✓ |
| 8 | `'ycgco'` | `AVCOL_SPC_YCGCO` | YCgCo | CORRECT ✓ (cycle-1 fix) |
| 9 | `'bt2020-ncl'` | `AVCOL_SPC_BT2020_NCL` | BT.2020 Non-Constant Luminance | CORRECT ✓ |
| 10 | `'bt2020-cl'` | `AVCOL_SPC_BT2020_CL` | BT.2020 Constant Luminance | CORRECT ✓ |

All five matrix mappings are correct.

---

## Part 2: Load-Bearing Doc Constants vs Code

### IMAGE_PIPELINE_VERSION

- CLAUDE.md: "currently 7"
- Code: `apps/web/src/lib/gallery-config-shared.ts:21` — `export const IMAGE_PIPELINE_VERSION = 7;`
- **MATCH ✓**

### COLOR_IMPACTING_KEYS count

- CLAUDE.md: "all **9** `COLOR_IMPACTING_KEYS`"
- Code: `apps/web/src/lib/settings-hash.ts:41-53` — exactly 9 keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`
- **MATCH ✓**

### Embedding byte size

- CLAUDE.md: "MEDIUMBLOB stores the raw 2048-byte float32 vector"
- Code: `apps/web/src/db/schema.ts:259` — "2048 bytes = 512 × 4-byte little-endian float32"
- **MATCH ✓**

### DB connection pool / queue

- CLAUDE.md: "Connection pool: 10 connections, queue limit 20"
- Code: `apps/web/src/db/index.ts` — `connectionLimit: 10`, `queueLimit: 20`
- **MATCH ✓**

### VIEW_RETENTION_DAYS

- CLAUDE.md: "395 days / 13 months"
- Code: `apps/web/src/lib/view-retention.ts` — `DEFAULT_VIEW_RETENTION_MS = 395 × 24 × 60 × 60 × 1000`
- **MATCH ✓**

### nginx body caps

- CLAUDE.md: "2 MiB default, 64 KiB login, 250 MiB DB restore, 216 MiB admin uploads, 216 MiB LR upload"
- Code: `apps/web/nginx/default.conf` — all five values confirmed present
- **MATCH ✓**

### Argon2id parameters vs OWASP

- CLAUDE.md: "memoryCost=65536 / 64 MiB, timeCost=3, parallelism=4 — exceeds OWASP minimums"
- Code: `apps/web/src/lib/password-hashing.ts:12-14` — exactly `memoryCost: 65_536`, `timeCost: 3`, `parallelism: 4`
- OWASP current minimums: 19 MiB / 2 iterations / parallelism 1 (source: OWASP Password Storage Cheat Sheet, confirmed 2026)
- 64 MiB > 19 MiB, timeCost 3 > 2, parallelism 4 > 1 — all exceed minimums
- **MATCH ✓**

### CLAUDE.md NCLX description (line 233)

- Text: "matrix `0=identity`, `1=BT.709`, `8=YCgCo`, `9=BT.2020-NCL`, `10=BT.2020-CL`" — correct post-cycle-1 fix ✓
- Text: "transfer `5=gamma28 (BT.470BG / PAL·SECAM gamma 2.8 — AGG-R7C2-01`" — correct post-cycle-2 fix ✓
- CLAUDE.md omits codes 6, 7, 8, 11 from the inline summary; it directs readers to the full NCLX_TRANSFER_MAP in color-detection.ts. The omission is intentional brevity, not an error. ✓

---

## Findings

### DOC-R7C3-01 — LOW — Code 11 comment "same transfer as sRGB" is technically inaccurate

**File:** `apps/web/src/lib/color-detection.ts:190`
**Current comment:** `// R5-M1: IEC 61966-2-4 (xvYCC) — same transfer as sRGB, extended gamut`

**Finding:** IEC 61966-2-4 (xvYCC) does NOT use the sRGB transfer function. It uses the **BT.709 transfer function** extended to negative RGB values (`{1.099, 0.018, 0.45, 4.5}` per FFmpeg vf_colorspace coefficients). The sRGB transfer function uses different coefficients (`{1.055, 0.0031308, 1/2.4, 12.92}`). The Wikipedia XvYCC article and the FFmpeg vf_colorspace patch both confirm xvYCC is aligned to BT.709, not sRGB.

**Affected code value:** NONE. The mapping `11 → 'srgb'` is internally consistent: NCLX code 1 (BT.709 itself) also maps to `'srgb'` as a documented approximation. Since xvYCC uses the BT.709 transfer, mapping it to the same `'srgb'` label as BT.709 is the correct decision — both are the BT.709 approximation. The `'srgb'` label in the enum means "approximate BT.709/sRGB SDR", not exactly "IEC 61966-2-1".

**What IS wrong:** Only the comment text. The comment says "same transfer as sRGB" when the correct explanation is "same transfer as BT.709 (code 1), which we approximate as 'srgb'; xvYCC extends BT.709 with negative-range values."

**Impact:** Admin Color Details panel display only. The `transferFunction` value for xvYCC files is `'srgb'`, which is functionally correct (same as code 1 / BT.709). No encoding decisions branch on `'srgb'` vs other values other than `'pq'`/`'hlg'`. No functional defect. Comment misleads future maintainers about WHY code 11 → 'srgb'.

**Authoritative source:** FFmpeg `vf_colorspace.c` patch at https://patchwork.ffmpeg.org/patch/1228/ (coefficients `{1.099, 0.018, 0.45, 4.5}` = BT.709, not sRGB); Wikipedia XvYCC (https://en.wikipedia.org/wiki/XvYCC) ("extends the standard BT.709 curve to accommodate negative R'G'B' inputs").

**Confidence:** HIGH

**Corrected comment:**
```typescript
11: 'srgb',    // IEC 61966-2-4 (xvYCC) — uses BT.709 transfer (same as code 1),
               // extended to negative RGB values for wider gamut; approximated as 'srgb'
               // (same as code 1/BT.709) since we have no distinct bt709-extended label
```

---

## Summary

**Zero new functional/mapping errors found.** All NCLX primaries (codes 1, 9, 11, 12), transfer (codes 1, 4, 5, 6, 7, 8, 11, 13, 14, 15, 16, 17, 18), and matrix (codes 0, 1, 8, 9, 10) mappings are correct against FFmpeg pixfmt.h / ITU-T H.273 — including both cycle-1 and cycle-2 fixes. All load-bearing documented constants match code.

One LOW finding: comment inaccuracy at `color-detection.ts:190` — the rationale for `11 → 'srgb'` should reference BT.709 (not sRGB) as the actual xvYCC transfer, clarifying that both BT.709 (code 1) and xvYCC (code 11) converge to the same `'srgb'` enum label. No code change required; comment only.

---

## Findings by Severity

| ID | Sev | Location | Issue |
|----|-----|----------|-------|
| DOC-R7C3-01 | LOW | `color-detection.ts:190` | Comment says "same transfer as sRGB" — xvYCC (code 11) uses BT.709 transfer, not sRGB. Mapping value `'srgb'` is correct; only the comment rationale is wrong. |

**NEW findings: 1 (LOW)**
**No MEDIUM or HIGH or CRITICAL findings.**
**All NCLX code mappings and documented constants verified correct.**
