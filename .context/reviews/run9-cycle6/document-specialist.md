# Document-Specialist Review — Run-9 Cycle-6

HEAD: ba3277da  
Reviewer: document-specialist  
Date: 2026-06-21

---

## 1. Key Files & Patterns Table (path existence)

Spot-checked all 20 cited paths. Every path exists at the stated location.

| Path | Status |
|---|---|
| `apps/web/src/app/actions/` | EXISTS |
| `apps/web/src/db/schema.ts` | EXISTS |
| `apps/web/src/lib/process-image.ts` | EXISTS |
| `apps/web/src/lib/color-detection.ts` | EXISTS |
| `apps/web/src/lib/color-primaries.ts` | EXISTS |
| `apps/web/src/lib/color-pipeline-decisions.ts` | EXISTS |
| `apps/web/src/lib/icc-extractor.ts` | EXISTS |
| `apps/web/src/lib/icc-chromaticity.ts` | EXISTS |
| `apps/web/src/lib/gain-map-detection.ts` | EXISTS |
| `apps/web/src/lib/use-display-capability.ts` | EXISTS |
| `apps/web/src/lib/settings-hash.ts` | EXISTS |
| `apps/web/src/lib/og-sanitize.ts` | EXISTS |
| `apps/web/src/app/api/og/photo/[id]/route.tsx` | EXISTS |
| `apps/web/src/lib/hdr-filenames.ts` | EXISTS |
| `apps/web/src/lib/data.ts` | EXISTS |
| `apps/web/src/proxy.ts` | EXISTS |
| `apps/web/src/lib/auth-rate-limit.ts` | EXISTS |
| `apps/web/src/app/[locale]/admin/db-actions.ts` | EXISTS |
| `apps/web/src/app/api/admin/db/download/route.ts` | EXISTS |
| `apps/web/src/site-config.json` | EXISTS |

**Verdict: 20/20 TRUE** — Confidence HIGH.

---

## 2. `images` Color/HDR Columns — Schema & Disposition

Evidence: `apps/web/src/db/schema.ts` (lines 45–116), `apps/web/src/lib/data.ts` (lines 204–417).

| Column | In schema.ts | Admin-only (omitted from public)? | CLAUDE.md claim | Match? |
|---|---|---|---|---|
| `color_space` | line 45 | YES (omitColorSpacePublic) | admin-only | TRUE |
| `icc_profile_name` | line 46 | YES (omitIccProfileNamePublic) | admin-only | TRUE |
| `bit_depth` | line 52 | YES (omitBitDepthPublic) | admin-only | TRUE |
| `color_pipeline_decision` | line 53 | YES (omitColorPipelineDecision) | admin-only | TRUE |
| `color_primaries` | line 64 | NOT omitted → public | public | TRUE |
| `transfer_function` | line 65 | YES (omitTransferFunction) | admin-only | TRUE |
| `matrix_coefficients` | line 66 | YES (omitMatrixCoefficients) | admin-only | TRUE |
| `is_hdr` | line 67 | YES (omitIsHdr) | admin-only | TRUE |
| `has_gain_map` | line 72 | YES (omitHasGainMap) | admin-only | TRUE |
| `avif_10bit` | line 110 | NOT omitted → public | "public-safe (R10-M4) … present in publicSelectFields" | TRUE |
| `pipeline_version` | line 77 | YES (omitPipelineVersionPublic) | admin-only | TRUE |
| `uploaded_by` | line 92 | YES (omitUploadedBy) | admin-only | TRUE |

All 12 column dispositions match exactly.

**Verdict: 12/12 TRUE** — Confidence HIGH.

---

## 3. `transfer_function` Enum / NCLX_TRANSFER_MAP

CLAUDE.md documents: `gamma22`, `gamma24`, `gamma26`, `gamma28`, `pq`, `hlg`, `linear`, `unknown`, `srgb`, `gamma18`.

Code (`color-detection.ts` line 25): `'srgb' | 'gamma22' | 'gamma18' | 'gamma24' | 'gamma26' | 'gamma28' | 'pq' | 'hlg' | 'linear' | 'unknown'` — exact match.

NCLX_TRANSFER_MAP (lines 177–211):
- 1='srgb', 4='gamma22', 5='gamma28', 6='gamma22', 7='gamma22', 8='linear', 11='srgb', 13='srgb', 14='gamma24', 15='gamma24', 16='pq', 17='gamma26', 18='hlg'

CLAUDE.md cited codes: 1=srgb, 4=gamma22(BT.470M), 5=gamma28(BT.470BG), 14/15=gamma24(BT.1886), 16=PQ, 17=gamma26, 18=HLG — all match. The doc explicitly says "full mapping in color-detection.ts" for the omitted codes (6,7,8,11), which is correct.

`gamma18` is ICC-heuristic only (line 99: `if … name.includes('gamma18')) return 'gamma18'`; ProPhoto path line 107). CLAUDE.md states "gamma18 comes only from ICC name heuristics (AGG-D3)" — TRUE.

**Verdict: TRUE** — Confidence HIGH.

---

## 4. NCLX Primaries Map

CLAUDE.md: "1=BT.709, 9=BT.2020, 11=DCI-P3, 12=Display P3"

Code (lines 170–174): `1: 'bt709', 9: 'bt2020', 11: 'dci-p3', 12: 'p3-d65'`

The label "Display P3" in CLAUDE.md for code 12 vs the enum value `'p3-d65'` is the pre-confirmed equivalence (same physical space, different label). Per the DO-NOT-RE-FILE instruction this is not a defect.

**Verdict: TRUE** — Confidence HIGH.

---

## 5. NCLX Matrix Map

CLAUDE.md: "0=identity, 1=BT.709, 8=YCgCo, 9=BT.2020-NCL, 10=BT.2020-CL"

Code (lines 214–220): `0: 'identity', 1: 'bt709', 8: 'ycgco', 9: 'bt2020-ncl', 10: 'bt2020-cl'`

Exact match (label casing difference 'YCgCo' vs 'ycgco' is cosmetic enum naming, not a factual error).

**Verdict: TRUE** — Confidence HIGH.

---

## 6. `APP_BACKUP_TABLES` vs Schema Tables (c5 restore fix claim)

CLAUDE.md: "APP_BACKUP_TABLES now covers all schema tables"

Schema tables (18): topics, topic_aliases, images, tags, image_tags, admin_settings, shared_groups, shared_group_images, admin_users, audit_log, sessions, admin_tokens, rate_limit_buckets, image_views, topic_views, shared_group_views, image_embeddings, smart_collections.

`APP_BACKUP_TABLES` (sql-restore-scan.ts lines 12–31, 18 entries): admin_settings, admin_tokens, admin_users, audit_log, image_embeddings, image_tags, image_views, images, rate_limit_buckets, sessions, shared_group_images, shared_group_views, shared_groups, smart_collections, tags, topic_aliases, topic_views, topics.

Both lists contain exactly 18 tables, and cross-checking confirms all schema table names appear in `APP_BACKUP_TABLES`. The invariant is additionally locked by `__tests__/sql-restore-scan.test.ts`.

**Verdict: TRUE** — Confidence HIGH.

---

## 7. Operational Claims

### 7a. Nginx body caps

CLAUDE.md: "2 MiB default, 64 KiB login, 250 MiB db restore, 216 MiB admin dashboard uploads, 216 MiB LR plugin route"

`nginx/default.conf` (lines 31, 58, 75, 92, 132): `2M`, `64K`, `250M`, `216M`, `216M` — exact match.

**Verdict: TRUE** — Confidence HIGH.

### 7b. Upload caps (upload-limits.ts)

CLAUDE.md: "200 MB per file; batch byte cap (`UPLOAD_MAX_TOTAL_BYTES`, default 2 GiB); batch file-count cap (`UPLOAD_MAX_FILES_PER_WINDOW`, default 100)"

`upload-limits.ts` lines 1–3: `DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024`, `DEFAULT_MAX_FILES_PER_WINDOW = 100`, `MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024`.

**Verdict: TRUE** — Confidence HIGH.

### 7c. Deploy auto-prune (`deploy.sh`)

CLAUDE.md claims `deploy.sh` runs container/image/builder/volume prune after `docker compose up`, then `df -h /`.

`deploy.sh` lines 52–56: exactly these four prune commands (all `|| true`) followed by `df -h /`. Volume prune uses `-f` only (no `-a`), matching the CLAUDE.md "anonymous/dangling volumes only" guarantee.

**Verdict: TRUE** — Confidence HIGH.

### 7d. Backfill sidecar command — tsx@4.21.0

CLAUDE.md hardcodes `npx --yes tsx@4.21.0` in the sidecar `--rm` command.

`apps/web/package.json` line 82: `"tsx": "^4.21.0"` — the pinned version in the command matches the project's locked lower-bound. Not a false claim; the pinning prevents version drift in the ephemeral sidecar.

**Verdict: TRUE** — Confidence HIGH.

---

## 8. Admin Tunable Defaults

CLAUDE.md table: `avif_effort=6`, `image_quality_webp=90`, `image_quality_avif=85`, `image_quality_jpeg=90`, `wide_gamut_max_source_pixels=50_000_000`, `wide_gamut_jpeg_chroma='4:4:4'`, `sdr_jpeg_chroma='4:2:0'`

`gallery-config-shared.ts` defaults (lines 92–124): `image_quality_webp: '90'`, `image_quality_avif: '85'`, `image_quality_jpeg: '90'`, `avif_effort: '6'`, `wide_gamut_max_source_pixels: '50000000'`, `wide_gamut_jpeg_chroma: '4:4:4'`, `sdr_jpeg_chroma: '4:2:0'`.

All seven defaults match exactly.

**Verdict: TRUE** — Confidence HIGH.

---

## 9. `IMAGE_PIPELINE_VERSION` Definition Location

CLAUDE.md: "DEFINED in `gallery-config-shared.ts:21` and re-exported here [process-image.ts]"

`gallery-config-shared.ts` line 21: `export const IMAGE_PIPELINE_VERSION = 7;` — correct line, correct value.
`process-image.ts` line 315: `export { IMAGE_PIPELINE_VERSION } from '@/lib/gallery-config-shared';` — re-export confirmed.

**Verdict: TRUE** — Confidence HIGH.

---

## 10. `COLOR_IMPACTING_KEYS` Count and `HASH_LENGTH`

CLAUDE.md: "9 `COLOR_IMPACTING_KEYS`" and "HASH_LENGTH is already 8 chars"

`settings-hash.ts` lines 42–53: array of 9 keys (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`).
`settings-hash.ts` line 68: `const HASH_LENGTH = 8;`

**Verdict: TRUE** — Confidence HIGH.

---

## 11. `cache()` Count

CLAUDE.md: "10 data-access functions" wrapped with `cache()`.

`data.ts` lines 1330, 1606–1619, 1660: `getSmartCollectionBySlugCached`, `getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSeoSettings` = exactly 10.

**Verdict: TRUE** — Confidence HIGH.

---

## 12. Advisory Lock Count

CLAUDE.md: "6 locks" — `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`.

`advisory-locks.ts`: all 6 constants confirmed (lines 19, 22, 25, 34, 41, 44).

**Verdict: TRUE** — Confidence HIGH.

---

## 13. OG Photo Cap

CLAUDE.md: "≤ `OG_PHOTO_MAX_BYTES` 1 MB"

`og-photo-fetch.ts` line 31: `export const OG_PHOTO_MAX_BYTES = 1024 * 1024;` — 1 MiB = 1,048,576 bytes. The doc says "1 MB" which is consistent with the informal usage (1 MiB); not a false claim.

**Verdict: TRUE** — Confidence HIGH.

---

## 14. `VIEW_RETENTION_DAYS` Default

CLAUDE.md: "default 395 days"

`view-retention.ts` lines 13–14: comment and line 29: `const DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000;`

**Verdict: TRUE** — Confidence HIGH.

---

## Summary

All 14 check groups passed. Zero false claims detected across:
- 20 file-path checks
- 12 schema column disposition checks
- NCLX transfer/primaries/matrix map checks
- APP_BACKUP_TABLES superset check (18 tables)
- 5 nginx body cap checks
- 3 upload limit checks
- 7 admin tunable default checks
- 2 deploy operational checks (auto-prune, tsx version)
- IMAGE_PIPELINE_VERSION definition/re-export
- COLOR_IMPACTING_KEYS=9, HASH_LENGTH=8
- cache()=10, locks=6
- OG_PHOTO_MAX_BYTES=1MB, VIEW_RETENTION_DAYS=395

**VERDICT: DOCS MATCH (14/14 checks) — ZERO false-doc DEFECTS**
