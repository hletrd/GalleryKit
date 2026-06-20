# Document-Specialist Review — Run 7 Cycle 6

**Date:** 2026-06-20
**HEAD:** e855e6ee (byte-identical to cycle-5 converged source)
**Scope:** (A) H.273 CICP spec cross-check of all NCLX maps; (B) CLAUDE.md doc-vs-code accuracy

---

## Part A — H.273 CICP Authoritative Cross-Check

### Authoritative Sources Used

- VapourSynth R74 resize documentation (mirrors H.273 normatively): https://www.vapoursynth.com/doc/functions/video/resize.html
- Wikipedia Coding-independent code points: https://en.wikipedia.org/wiki/Coding-independent_code_points
- FFmpeg / colour.science H.273 implementation references (primaries codes 11/12)
- WebSearch: H.273 Table 2 primaries codes 11 (SMPTE RP 431-2, DCI-P3) and 12 (SMPTE EG 432-1, P3-D65)

### NCLX_PRIMARIES_MAP cross-check (color-detection.ts lines 170–175)

| Code | Source maps to | H.273 Table 2 authoritative | Correct? |
|------|---------------|-----------------------------|----------|
| 1    | `'bt709'`     | BT.709 (Rec. ITU-R BT.709-6) | YES |
| 9    | `'bt2020'`    | BT.2020 (Rec. ITU-R BT.2020) | YES |
| 11   | `'dci-p3'`    | SMPTE RP 431-2 (DCI-P3, DCI white point ~6300 K) | YES |
| 12   | `'p3-d65'`    | SMPTE EG 432-1 (Display P3, D65 white point) | YES |

All 4 primaries entries correct.

### NCLX_TRANSFER_MAP cross-check (color-detection.ts lines 177–212)

| Code | Source maps to | H.273 Table 3 authoritative (VapourSynth/H.273) | Correct? |
|------|---------------|--------------------------------------------------|----------|
| 1    | `'srgb'`      | BT.709 transfer (same curve as sRGB for SDR; comment notes "practical SDR approximation") | YES (intentional approximation, well-documented) |
| 4    | `'gamma22'`   | BT.470-6 System M (NTSC, gamma ~2.2) | YES |
| 5    | `'gamma28'`   | BT.470-6 System B, G (PAL/SECAM, gamma ~2.8) | YES (AGG-R7C2-01 fix confirmed intact) |
| 6    | `'gamma22'`   | SMPTE 170M (functionally equivalent to BT.709/601) | YES |
| 7    | `'gamma22'`   | SMPTE ST 240 (approximated as gamma22) | YES |
| 8    | `'linear'`    | Linear transfer characteristic | YES |
| 11   | `'srgb'`      | IEC 61966-2-4 (xvYCC; uses BT.709 curve, approximated as 'srgb') | YES (comment acknowledges xvYCC ≠ IEC 61966-2-1, approximation documented) |
| 13   | `'srgb'`      | IEC 61966-2-1 (canonical sRGB) | YES |
| 14   | `'gamma24'`   | Rec. ITU-R BT.2020 10-bit (BT.1886 / gamma ~2.4) | YES (AGG-R7C3-01 fix confirmed intact) |
| 15   | `'gamma24'`   | Rec. ITU-R BT.2020 12-bit (same) | YES |
| 16   | `'pq'`        | SMPTE ST 2084 (PQ) | YES |
| 17   | `'gamma26'`   | SMPTE ST 428-1 (DCI-P3 gamma 2.6) | YES |
| 18   | `'hlg'`       | ARIB STD-B67 (HLG) | YES |

All 13 transfer entries correct. The three prior fixes are confirmed intact:
- Code 5 → `'gamma28'` (was wrongly absent/mislabelled; AGG-R7C2-01)
- Codes 14/15 → `'gamma24'` (was `'gamma22'`; AGG-R7C3-01)
- Code 8 → `'linear'` (confirmed present)

### NCLX_MATRIX_MAP cross-check (color-detection.ts lines 214–220)

| Code | Source maps to   | H.273 Table 4 authoritative (VapourSynth/H.273) | Correct? |
|------|-----------------|--------------------------------------------------|----------|
| 0    | `'identity'`    | Identity matrix (R'G'B' or XYZ) | YES |
| 1    | `'bt709'`       | BT.709 (KR=0.2126, KB=0.0722) | YES (prior fix confirmed intact) |
| 8    | `'ycgco'`       | YCgCo | YES (AGG-R7C1-01 fix confirmed intact: was wrongly `'bt2020-ncl'`) |
| 9    | `'bt2020-ncl'`  | BT.2020 non-constant luminance | YES |
| 10   | `'bt2020-cl'`   | BT.2020 constant luminance | YES |

All 5 matrix entries correct.

**PART A VERDICT: ZERO wrong mappings. All NCLX maps are correct per H.273 authoritative tables. All three prior fixes (matrix 8=YCgCo, transfer 5=gamma28, matrix 1=bt709) are confirmed present in source.**

---

## Part B — CLAUDE.md Doc-vs-Code Accuracy

### Claim 1: `IMAGE_PIPELINE_VERSION = 7`
- **Source:** `apps/web/src/lib/gallery-config-shared.ts` line 21: `export const IMAGE_PIPELINE_VERSION = 7;`
- **CLAUDE.md says:** "currently 7" — **CORRECT**

### Claim 2: `COLOR_IMPACTING_KEYS` = 9 keys
- **Source:** `apps/web/src/lib/settings-hash.ts` lines 42–54: exactly 9 entries (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`)
- **CLAUDE.md says:** "9 `COLOR_IMPACTING_KEYS`" — **CORRECT**

### Claim 3: Argon2id params (memoryCost=65536, timeCost=3, parallelism=4)
- **Source:** `apps/web/src/lib/password-hashing.ts` lines 11–14:
  ```
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  ```
- **CLAUDE.md says:** "Argon2id, memoryCost=65536 / 64 MiB, timeCost=3, parallelism=4" — **CORRECT**

### Claim 4: `VIEW_RETENTION_DAYS` default = 395 days
- **Source:** `apps/web/src/lib/view-retention.ts` line 29: `const DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000;`
- **CLAUDE.md says:** "default 395 days (13 months)" — **CORRECT**

### Claim 5: ETag format `W/"v${IMAGE_PIPELINE_VERSION}-..."`
- **Source:** `apps/web/src/lib/serve-upload.ts` line 215:
  ```
  const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`;
  ```
- **CLAUDE.md says:** `W/"v${IMAGE_PIPELINE_VERSION}-{mtimeMs}-{size}-{settingsHash}"` — **CORRECT**

### Claim 6: NCLX transfer code 5 = gamma28 (BT.470BG / PAL·SECAM gamma 2.8)
- **Source:** `color-detection.ts` line 186: `5: 'gamma28', // ITU-T H.273 Table 3 value 5 = BT.470BG...`
- **CLAUDE.md says:** "`5=gamma28 (BT.470BG / PAL·SECAM gamma 2.8 — AGG-R7C2-01)`" — **CORRECT**

### Claim 7: NCLX matrix code 8 = YCgCo
- **Source:** `color-detection.ts` line 217: `8: 'ycgco', // ITU-T H.273 Table 4 value 8 = YCgCo`
- **CLAUDE.md says:** "`8=YCgCo`" — **CORRECT**

### Claim 8: Stripe card-only pin + `async_payment_succeeded` gap
- **Source:** `apps/web/src/app/api/checkout/[imageId]/route.ts` line 207: `payment_method_types: ['card'],`
- **Source:** `apps/web/src/app/api/stripe/webhook/route.ts` lines 91–114: gates on `session.payment_status !== 'paid'`; `checkout.session.async_payment_succeeded` not handled — documented at line 99
- **CLAUDE.md says:** card-only pin in effect, `async_payment_succeeded` not yet handled — **CORRECT**

**PART B VERDICT: All 8 spot-checked CLAUDE.md claims match source exactly. Zero doc-code mismatches found.**

---

## Summary

**0 new actionable findings.**

- H.273 CICP spec cross-check: all 22 map entries (4 primaries + 13 transfer + 5 matrix) verified correct against VapourSynth/H.273 authoritative tables.
- Three prior run-7 fixes confirmed intact in source: matrix 8→YCgCo (AGG-R7C1-01), transfer 5→gamma28 (AGG-R7C2-01), matrix 1→bt709.
- CLAUDE.md spot-check: 8 dense factual claims verified correct against source.
- The NCLX map pin class is confirmed EXHAUSTED: no 4th spec error exists.
