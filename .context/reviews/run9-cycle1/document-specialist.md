# Document-Specialist Review — RUN-9 Cycle-1

**HEAD:** d3858cfc  
**Scope:** Doc-code mismatch audit of CLAUDE.md technical claims against actual source.

---

## Spot-Check Results

### 1. IMAGE_PIPELINE_VERSION = 7

**VERIFIED.** `gallery-config-shared.ts:21` reads `export const IMAGE_PIPELINE_VERSION = 7;`  
CLAUDE.md claim is accurate.

---

### 2. COLOR_IMPACTING_KEYS count = 9, HASH_LENGTH = 8

**VERIFIED.** `settings-hash.ts:42-54` defines exactly 9 keys:
`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`,
`wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`,
`image_quality_jpeg`, `image_sizes`.

`settings-hash.ts:68` reads `const HASH_LENGTH = 8;`

CLAUDE.md claim is accurate.

---

### 3. The 9 COLOR_IMPACTING_KEYS names match CLAUDE.md list

**VERIFIED.** CLAUDE.md (ETag section) lists the same 9 keys in the same groupings.
No drift detected.

---

### 4. SW_VERSION stamp format: `<git-short-SHA>-p{IMAGE_PIPELINE_VERSION}`

**VERIFIED.** `scripts/build-sw.ts:46` produces `` `${getCommitOrTimestamp()}-p${IMAGE_PIPELINE_VERSION}` ``.
`public/sw.js:26` shows `const SW_VERSION = 'ea372e41-p7';` — matching the documented format.
CLAUDE.md claim is accurate.

---

### 5. NCLX code mappings vs color-detection.ts

All checked against `color-detection.ts:170-220`:

| Claim | Code | Value | Status |
|---|---|---|---|
| primaries 1=BT.709 | NCLX_PRIMARIES_MAP[1]='bt709' | ✓ | VERIFIED |
| primaries 9=BT.2020 | NCLX_PRIMARIES_MAP[9]='bt2020' | ✓ | VERIFIED |
| primaries 11=DCI-P3 | NCLX_PRIMARIES_MAP[11]='dci-p3' | ✓ | VERIFIED |
| primaries 12=Display P3 | NCLX_PRIMARIES_MAP[12]='p3-d65' | ✓ | VERIFIED |
| transfer code 5 = gamma28 / BT.470BG / PAL·SECAM (NOT System M) | NCLX_TRANSFER_MAP[5]='gamma28' | ✓ | VERIFIED |
| matrix code 8 = YCgCo | NCLX_MATRIX_MAP[8]='ycgco' | ✓ | VERIFIED |
| matrix code 9 = BT.2020-NCL | NCLX_MATRIX_MAP[9]='bt2020-ncl' | ✓ | VERIFIED |
| transfer 14/15 = gamma24 (BT.1886) | NCLX_TRANSFER_MAP[14/15]='gamma24' | ✓ | VERIFIED |
| transfer 16 = PQ | NCLX_TRANSFER_MAP[16]='pq' | ✓ | VERIFIED |
| transfer 17 = gamma26 (DCI-P3) | NCLX_TRANSFER_MAP[17]='gamma26' | ✓ | VERIFIED |
| transfer 18 = HLG | NCLX_TRANSFER_MAP[18]='hlg' | ✓ | VERIFIED |

CLAUDE.md NCLX description section is accurate.

---

### 6. Advisory lock name list

CLAUDE.md lists in the Race Condition section and the advisory-lock-scope note:
`gallerykit_db_restore`, `gallerykit_upload_processing_contract`,
`gallerykit_topic_route_segments`, `gallerykit_admin_delete`,
`gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`.

Actual `advisory-locks.ts` exports:
- `LOCK_DB_RESTORE = 'gallerykit_db_restore'` ✓
- `LOCK_UPLOAD_PROCESSING_CONTRACT = 'gallerykit_upload_processing_contract'` ✓
- `LOCK_TOPIC_ROUTE_SEGMENTS = 'gallerykit_topic_route_segments'` ✓
- `LOCK_ADMIN_DELETE = 'gallerykit_admin_delete'` ✓
- `LOCK_COLOR_PIPELINE_BACKFILL = 'gallerykit_color_pipeline_backfill'` ✓
- `getImageProcessingLockName = (jobId) => \`gallerykit:image-processing:${jobId}\`` ✓

**VERIFIED.** All six lock names are correct and complete.

---

### 7. Backfill column set (both paths)

CLAUDE.md claims both the sidecar and in-app runner persist the same column set:
`pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`,
`matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`,
`was_downscaled`, `avif_10bit`.

**Sidecar (`backfill-color-pipeline.ts:409-419`, `flushBatch`):** UPDATE sets all 10 columns. ✓

**In-app (`admin-backfill-runner.ts:559-568`):** UPDATE sets all 10 columns. ✓

**VERIFIED.** Both paths write the same 10-column set documented in CLAUDE.md.

---

### 8. Paid-download / Stripe / license_tier / entitlements mentions on-disk

Grep of `.ts`/`.tsx` source files finds NO live references to Stripe, paid-download
functionality, or `license_tier` in production code. The only occurrences are:
- `__tests__/free-download-contract.test.ts` — a regression test asserting those
  symbols do NOT exist in the download components (expected guardian).
- `__tests__/migrate-reconcile-coverage.test.ts` — a test asserting reconcile drops
  the old `entitlements` table and `images.license_tier` column (expected guardian).

CLAUDE.md contains no mentions of paid-download/Stripe/entitlements/license_tier.
**VERIFIED CLEAN.**

---

### 9. VIEW_RETENTION_DAYS default = 395 days

**VERIFIED.** `view-retention.ts:29` reads:
`const DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000;`  
CLAUDE.md claim is accurate.

---

### 10. Upload caps

CLAUDE.md claims: 200 MB per file, default 2 GiB total, 100 files per window.

`upload-limits.ts:1-2`:
- `DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024` (2 GiB) ✓
- `DEFAULT_MAX_FILES_PER_WINDOW = 100` ✓

Per-file cap: referenced as `UPLOAD_MAX_FILE_BYTES (200 MB)` in images.ts comment at line 374.
**VERIFIED.**

---

### 11. Nginx body caps

CLAUDE.md claims: 2 MiB default, 64 KiB login, 250 MiB `/admin/db`, 216 MiB dashboard uploads,
216 MiB `/api/admin/lr/upload`, 2 MiB generic `/api/admin/` catch-all.

`nginx/default.conf` actual values:
- Global default: `client_max_body_size 2M` ✓
- Login (`/admin$`): `64K` ✓
- `/admin/db`: `250M` ✓
- `/admin/dashboard`: `216M` ✓
- `/api/admin/lr/upload` (`^~`): `216M` ✓
- `/api/admin/` catch-all: `2M` ✓

**VERIFIED.**

---

## New Findings

**ZERO new doc-code mismatches found.**

Every spot-checked technical claim in CLAUDE.md matches the actual code exactly:
IMAGE_PIPELINE_VERSION, COLOR_IMPACTING_KEYS count and membership, HASH_LENGTH,
SW_VERSION stamp format, all NCLX code mappings, all advisory lock names,
backfill column set for both paths, absence of paid-download artefacts,
VIEW_RETENTION_DAYS default, upload caps, and nginx body limits all match.

---

## External-Fact Notes (non-blocking)

- CLAUDE.md references Mozilla bug 1626624 (Firefox color-gamut always-false) and states
  "still open." This is a time-sensitive external claim that cannot be verified without
  a live caniuse/MDN check. It does not affect any code correctness; noted for awareness only.
- The browser/OS/display matrix table cites `caniuse mdn-css_at-rules_media_color-gamut
  (verified 2026-06-12)` — recently checked, low staleness risk.

---

## Summary for Aggregate

**Verdict: CONVERGED.** No new doc-code drift found in this cycle. All 11 spot-checks pass.
