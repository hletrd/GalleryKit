# Document-Specialist Report — Run 7 Cycle 5

**Date:** 2026-06-20
**Scope:** PART A — NCLX CICP spec-accuracy re-sweep (4th consecutive cycle); PART B — CLAUDE.md doc-vs-code spot-check

---

## PART A — NCLX Map Spec-Accuracy Re-Sweep

### Reference Source

ITU-T H.273 CICP code points were verified against the VapourSynth documentation
(https://www.vapoursynth.com/doc/functions/video/resize.html), which implements
H.273 Tables 2–4 directly and is the most complete authoritative table available via
web lookup. Cross-referenced with libavif CICP wiki
(https://github.com/AOMediaCodec/libavif/wiki/CICP).

All maps are in `apps/web/src/lib/color-detection.ts` lines 170–220.

---

### NCLX_PRIMARIES_MAP (lines 170–175)

| Code | H.273 Name          | Code value in file  | Verdict |
|------|---------------------|---------------------|---------|
| 1    | BT.709              | `'bt709'`           | CORRECT |
| 9    | BT.2020             | `'bt2020'`          | CORRECT |
| 11   | DCI-P3 / ST 431-2   | `'dci-p3'`          | CORRECT |
| 12   | Display P3 / ST 432-1 | `'p3-d65'`        | CORRECT |

No errors found.

---

### NCLX_TRANSFER_MAP (lines 177–212)

| Code | H.273 Name (Table 3)         | File mapping    | Verdict  |
|------|------------------------------|-----------------|----------|
| 1    | BT.709-6                     | `'srgb'`        | CORRECT (BT.709 transfer ≈ sRGB; shared enum label) |
| 4    | BT.470M / NTSC 525-line gamma 2.2 | `'gamma22'` | CORRECT — verified code 4 = BT.470-6 System M, ~gamma 2.2 |
| 5    | BT.470BG / PAL·SECAM gamma 2.8   | `'gamma28'` | CORRECT — AGG-R7C2-01 fix intact |
| 6    | BT.601-7 (same curve as 709) | `'gamma22'`     | CORRECT |
| 7    | SMPTE ST 240                 | `'gamma22'`     | CORRECT (SMPTE 240M ≈ gamma 2.2) |
| 8    | Linear                       | `'linear'`      | CORRECT |
| 11   | IEC 61966-2-4 (xvYCC)        | `'srgb'`        | CORRECT (approximation; documented in code comment) |
| 13   | IEC 61966-2-1 (sRGB)         | `'srgb'`        | CORRECT — prior run's fix (was `'pq'`) intact |
| 14   | BT.2020 10-bit (BT.1886)     | `'gamma24'`     | CORRECT — prior run's fix intact |
| 15   | BT.2020 12-bit (BT.1886)     | `'gamma24'`     | CORRECT — prior run's fix intact |
| 16   | SMPTE ST 2084 (PQ)           | `'pq'`          | CORRECT |
| 17   | SMPTE ST 428-1 (DCI gamma 2.6) | `'gamma26'`  | CORRECT |
| 18   | ARIB STD-B67 (HLG)           | `'hlg'`         | CORRECT — prior run's fix intact |

**Code 4 comment (NF-R7C4-01 do-not-re-litigate):** Line 185 reads
`// ITU-T H.273 Gamma 2.2 curve (BT.470M, NTSC 525-line)`.
H.273 Table 3 code 4 = "ITU-R Rec. BT.470-6 System M (historical)", which is NTSC,
gamma 2.2. VERIFIED CORRECT for the 4th consecutive cycle. Not re-raised.

No 4th spec error found. All three prior-run fixes (code 5→gamma28, code 13→srgb,
codes 14/15→gamma24, code 18→hlg) are intact and verified correct against H.273.

---

### NCLX_MATRIX_MAP (lines 214–220)

| Code | H.273 Name (Table 4) | File mapping    | Verdict  |
|------|----------------------|-----------------|----------|
| 0    | Identity / RGB       | `'identity'`    | CORRECT  |
| 1    | BT.709               | `'bt709'`       | CORRECT  |
| 8    | YCgCo                | `'ycgco'`       | CORRECT — AGG-R7C1-01 fix (was `'bt2020-ncl'`) intact |
| 9    | BT.2020-NCL          | `'bt2020-ncl'`  | CORRECT  |
| 10   | BT.2020-CL           | `'bt2020-cl'`   | CORRECT  |

No errors found.

---

### PART A Summary

**No 4th spec error exists.** All NCLX map entries verified correct against ITU-T H.273.
The three run-7 spec fixes (matrix 8→ycgco, transfer 5→gamma28, transfer 13→srgb /
14/15→gamma24 / 18→hlg) are all intact. Convergence confirmed.

---

## PART B — CLAUDE.md Doc-vs-Code Spot-Check

### 1. IMAGE_PIPELINE_VERSION = 7

- **Claim:** `gallery-config-shared.ts:21`
- **Code:** `apps/web/src/lib/gallery-config-shared.ts` line 21: `export const IMAGE_PIPELINE_VERSION = 7;`
- **Verdict:** CORRECT. Line 21 exactly matches.

---

### 2. COLOR_IMPACTING_KEYS = 9 keys

- **Claim:** CLAUDE.md states "all 9 COLOR_IMPACTING_KEYS" and lists them as:
  `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`,
  `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`,
  `image_quality_jpeg`, `image_sizes`.
- **Code:** `apps/web/src/lib/settings-hash.ts` lines 42–54: array of exactly those 9 keys.
  File header (lines 1–13) also states "9 settings" explicitly.
- **Verdict:** CORRECT. Count and key names match.

---

### 3. Argon2id memoryCost=65536 / timeCost=3 / parallelism=4

- **Claim:** `apps/web/src/lib/password-hashing.ts`
- **Code:** Lines 11–14:
  ```
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  ```
- **Verdict:** CORRECT. All three values match exactly.

---

### 4. VIEW_RETENTION_DAYS default 395

- **Claim:** `apps/web/src/lib/view-retention.ts`
- **Code:** Line 29: `const DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000;`
- **Verdict:** CORRECT. Default is 395 days.

---

### 5. Firefox color-gamut bug 1626624 / always-false

- **Claim:** `use-display-capability.ts` — Firefox parses `(color-gamut: p3)` MQ since v110 but always returns false (bug 1626624); falls back to conservative `'srgb'`.
- **Code:** `apps/web/src/lib/use-display-capability.ts` lines 64–69:
  ```
  // R9-R1: Firefox parses the (color-gamut: p3) MQ syntax since v110, but
  // it ALWAYS returns false because Firefox does not implement wide-gamut
  // rendering (Mozilla bug 1626624, still open). So all Firefox versions
  // effectively fall through to the conservative 'srgb' default here.
  ```
  Lines 52–63 show the three-tier detection: `screen.colorGamut` → MQ → fallback `'srgb'`.
- **Verdict:** CORRECT. Code documents bug 1626624 and implements the conservative srgb fallback for all Firefox versions.

---

### 6. Sharp withMetadata GPS-retention warning

- **Claim:** CLAUDE.md: "Never use Sharp `withMetadata()` for stripping — `withMetadata()` keeps most input metadata (EXIF/XMP/IPTC) including GPS coordinates; in Sharp 0.33+ this behaviour is explicit (R4C8 COR-R4C8-01)"
- **Code:**
  - `apps/web/src/lib/gps-exif-strip.ts` lines 4–6: documents the reliance on `withMetadata({orientation, icc})` and states "Sharp 0.33+ KEEPS all input EXIF (it is the keep-metadata API)".
  - `apps/web/src/lib/process-image.ts` lines 1542–1543: same warning documented in process-image history note.
- **Verdict:** CORRECT. Both source files document the `withMetadata` GPS-retention problem with version attribution.

---

### 7. Stripe async_payment_succeeded not-yet-handled + card-only pin

- **Claim:**
  a. `checkout.session.async_payment_succeeded` is not yet handled.
  b. Checkout session is pinned to `payment_method_types: ['card']`.
- **Code:**
  - `apps/web/src/app/api/stripe/webhook/route.ts` lines 91–114: gates on `payment_status === 'paid'`; logs `'unpaid'` as a no-op; comment on line 99 explicitly states `checkout.session.async_payment_succeeded` is not yet handled.
  - `apps/web/src/app/api/checkout/[imageId]/route.ts` lines 196–207: card-only pin `payment_method_types: ['card']` with AGG-H1 comment.
- **Verdict:** CORRECT. Both claims match the code.

---

### 8. serve-upload ETag format + "9 COLOR_IMPACTING_KEYS" claim

- **Claim:** CLAUDE.md states ETag = `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` and that the hash covers 9 COLOR_IMPACTING_KEYS.
- **Code:**
  - `apps/web/src/lib/serve-upload.ts` line 215:
    `const etag = \`W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"\`;`
  - `apps/web/src/lib/settings-hash.ts` line 68: `const HASH_LENGTH = 8;`; 9-key array lines 42–54.
- **Verdict:** CORRECT. ETag format and 9-key count both match.

---

## Summary

**PART A:** No spec errors found. All three run-7 cycle-1/cycle-2 fixes are intact and verified against ITU-T H.273. No 4th error exists. Convergence is confirmed.

**PART B:** All 8 CLAUDE.md claims verified correct against the current code. No doc-code drift detected.

**New actionable findings: 0**
