# Verifier Report — Cycle 20
Date: 2026-06-27  
HEAD: 9af705f4

---

## Authoritative Gate Baseline

| Gate | Status | Detail |
|------|--------|--------|
| ESLint (`lint`) | PASS (exit 0) | No errors |
| TypeScript (`typecheck`) | PASS (exit 0) | `typecheck:app` + `typecheck:scripts` — 0 errors |
| Vitest (`test`) | PASS (exit 0) | 236 files passed / 2 skipped; 2155 tests passed / 4 skipped |
| `lint:api-auth` | PASS (exit 0) | 2 files checked (db/download, lr/upload) — all OK |
| `lint:action-origin` | PASS (exit 0) | 41 exports checked — all mutating actions enforce same-origin |
| `lint:public-route-rate-limit` | PASS (exit 0) | 6 public route files checked — all OK or exempt |

All 6 gates green at HEAD 9af705f4.

---

## Behavioral Claim Verification

### Claim 1 — publicSelectFields omits every PII key named in _PrivacySensitiveKeys

**Stated in CLAUDE.md:** `publicSelectFields` is derived from `adminSelectFields` by omitting PII/internal fields. A compile-time guard (`_SensitiveKeysInPublic`) catches any leakage.

**Evidence:**
- `src/lib/data.ts:461` — `PrivacySensitiveKeys` union lists 20 keys: `latitude`, `longitude`, `filename_original`, `user_filename`, `processed`, `original_format`, `original_file_size`, `color_pipeline_decision`, `is_hdr`, `has_gain_map`, `was_downscaled`, `transfer_function`, `matrix_coefficients`, `bit_depth`, `uploaded_by`, `processing_error`, `failed_at`, `color_space`, `icc_profile_name`, `pipeline_version`.
- `src/lib/data.ts:363-393` — all 20 are explicitly destructured out of `adminSelectFields` before `publicSelectFieldCore` is formed. Confirmed by reading the omit list.
- `src/lib/data.ts:463-464` — `_SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>`. If any sensitive key survives into `publicSelectFields`, this becomes non-`never` and `_privacyGuard` fails to compile.
- `typecheck` exits 0 — therefore no sensitive key is in `publicSelectFields` at this HEAD.
- `avif_10bit` is NOT in the omit list (it is public-safe, R10-M4) and is present in `publicSelectFields`. This matches CLAUDE.md.

**Status: VERIFIED (high confidence)**

---

### Claim 2 — GPS ISOBMFF walk abort triggers re-encode (cycle-19 fix)

**Stated in CLAUDE.md:** lossless ISOBMFF scrub returns `null` on structural anomaly so `stripGpsFromOriginal` falls back to tier-2 re-encode.

**Evidence:**
- `src/lib/gps-exif-strip.ts:382-395` — `walkAborted` flag introduced with comment tagged R19C19 F2. Set to `true` in `walkChildren()` on any truncated 64-bit size, oversized box, or box running past its parent.
- `src/lib/gps-exif-strip.ts:456-463` — When walk completes with no Exif/XMP items found AND `walkAborted` is `true`, the function returns `null` (structural anomaly) instead of `{ buffer: input, stripped: false }` (clean "no GPS"). This is the critical fix — without it, an abort before reaching Exif items would report "file is clean" and leave GPS in place.
- `src/lib/process-image.ts:1636-1692` — `scrubbed = stripGpsFromIsobmffBuffer(input)`. When `scrubbed === null`, the `if (scrubbed)` branch is skipped and execution falls to tier-2 re-encode.
- For `.avif`: `pipeline.avif({ quality: 90 }).toFile(tmpPath)` — GPS is stripped via Sharp decode/re-encode.
- For `.heic/.heif`: the code logs `console.error('cannot strip GPS from structurally anomalous HEIC (no HEVC encoder); original retains GPS')` and returns — cannot re-encode, known limitation.

**Status: VERIFIED (high confidence)** — The R19C19 fix correctly returns `null` on abort, causing re-encode for AVIF. The HEIC limitation (cannot re-encode) is known and logged.

---

### Claim 3 — view-retention falls back to default on negative / non-finite VIEW_RETENTION_DAYS

**Stated in CLAUDE.md:** A negative / non-finite `VIEW_RETENTION_DAYS` falls back to the default (never a future cutoff).

**Evidence:**
- `src/lib/view-retention.ts:50` — `const retentionDays = Number(process.env.VIEW_RETENTION_DAYS ?? '')`. `Number('')` is `0`; `Number('abc')` is `NaN`; negative strings parse negative.
- `src/lib/view-retention.ts:51` — `return Number.isFinite(retentionDays) && retentionDays > 0 ? maxAgeMs : DEFAULT_VIEW_RETENTION_MS;`
- Guard catches: `NaN` (non-finite), `0` (not > 0), negative (not > 0), `Infinity` (non-finite). All fall back to `DEFAULT_VIEW_RETENTION_MS` (395 days).
- `src/lib/view-retention.ts:41` — same guard on the derived `maxAgeMs`: `Number.isFinite(maxAgeMs) && maxAgeMs > 0`. Belt-and-suspenders.

**Status: VERIFIED (high confidence)** — No path produces a future cutoff or zero cutoff.

---

### Claim 4 — settings-hash COLOR_IMPACTING_KEYS count = 9

**Stated in CLAUDE.md:** The hash covers all 9 `COLOR_IMPACTING_KEYS`.

**Evidence:**
- `src/lib/settings-hash.ts:45-64` — the array is:
  1. `wide_gamut_jpeg_chroma`
  2. `sdr_jpeg_chroma`
  3. `avif_effort`
  4. `force_srgb_derivatives`
  5. `wide_gamut_max_source_pixels`
  6. `image_quality_webp`
  7. `image_quality_avif`
  8. `image_quality_jpeg`
  9. `image_sizes`

Exactly 9 entries. Matches CLAUDE.md documentation precisely.

- `src/lib/settings-hash.ts:66-68` — `_ColorKeysAreSettingKeys` compile-time guard verifies every entry is a real `GallerySettingKey`. Passes `tsc` at exit 0.

**Status: VERIFIED (high confidence)**

---

### Claim 5 — OG home card points at /api/og/photo/<latestId> not the base JPEG

**Stated in CLAUDE.md:** "The HOME page `og:image` points HERE (`/api/og/photo/${latestId}`, AGG-R8-02) — NOT the base JPEG"

**Evidence:**
- `src/app/[locale]/(public)/page.tsx:93` — `const latestImage = await getLatestImageForOgCached(...)`
- `src/app/[locale]/(public)/page.tsx:118` — `url: absoluteImageUrl('/api/og/photo/${latestImage.id}', seo.url)`
- This is the default path. There is a branch at line 63: `if (seo.og_image_url)` which allows an admin-configured override URL — this is NOT documented as a base JPEG path; it is an explicit admin override. The CLAUDE.md claim about the default behavior is correct.
- The per-photo OG route (`src/app/api/og/photo/[id]/route.tsx:63`) calls `getImageCached(imageId)` and the comment at line 69 confirms it returns 404 for non-existent/unprocessed IDs — matching CLAUDE.md's SSRF hardening claim.

**Status: VERIFIED (high confidence)**

---

### Claim 6 — avif_10bit is public-safe and present in publicSelectFields (R10-M4)

**Stated in CLAUDE.md:** `avif_10bit` is public-safe (R10-M4), present in `publicSelectFields`.

**Evidence:**
- `src/lib/data.ts:314-317` — in `adminSelectFields`, with comment "R10-M4: delivered AVIF bit depth (10-bit vs 8-bit). Public-safe — describes the encoded output, not source PII or internal pipeline state."
- NOT in the destructured-omit list at lines 363-393 for `publicSelectFieldCore`.
- Therefore `avif_10bit` passes through to `publicSelectFields` via `...publicSelectFieldCore`.
- NOT listed in `PrivacySensitiveKeys` (line 461) — confirmed by reading the union.
- The compile-time privacy guard at line 463-464 passes `tsc` — consistent.

**Status: VERIFIED (high confidence)**

---

## Drift Check

No drift found between CLAUDE.md claims and code for the 6 verified claims. All behavioral assertions match the live source.

One nuance flagged (not a drift, an underdocumented edge):
- CLAUDE.md says "lossless byte-level GPS-IFD neutralization for HEIF-AVIF-HEIC" in the GPS strip description. For a *malformed/aborting* HEIC specifically, the lossless scrub fails AND the tier-2 re-encode cannot run (no HEVC encoder). CLAUDE.md mentions this limitation in the gps-exif-strip source comment context but the main privacy section does not call it out explicitly. **Not a code bug** — the error is logged and the DB columns are already nulled (derivatives served publicly have no GPS). Severity: LOW / documentation gap only.

---

## Verdict

**Status: PASS**  
**Confidence: high**  
**Blockers: 0**

All 6 gates clean at HEAD 9af705f4. All 6 behavioral claims verified against code with file:line evidence. No test/code mismatch found. No CLAUDE.md drift detected in checked surface area.

**Recommendation: APPROVE**
