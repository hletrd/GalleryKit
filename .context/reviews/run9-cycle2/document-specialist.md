# Document Specialist Review — Run-9 Cycle-2

**Date:** 2026-06-21
**Scope:** CLAUDE.md / AGENTS.md factual accuracy vs current code. Only production source changed since run-8 convergence (f63af3b9) are two new test files (TE-R9C1-01/02). No production logic changed.

## Verdict: 0 mismatches — docs accurate — convergence confirmed

---

## Claims Verified

### Version / pipeline constants
| Claim | File:Line | Result |
|-------|-----------|--------|
| `IMAGE_PIPELINE_VERSION = 7` defined in `gallery-config-shared.ts:21` | `gallery-config-shared.ts:21` | ✓ |
| `COLOR_IMPACTING_KEYS` = 9 keys | `settings-hash.ts:42-54` | ✓ (9 entries: wide_gamut_jpeg_chroma, sdr_jpeg_chroma, avif_effort, force_srgb_derivatives, wide_gamut_max_source_pixels, image_quality_webp, image_quality_avif, image_quality_jpeg, image_sizes) |
| `HASH_LENGTH = 8` | `settings-hash.ts:68` | ✓ |
| `VIEW_RETENTION_DAYS` default 395 days / 13 months | `view-retention.ts:29` | ✓ |
| `MAX_IMAGE_SIZE_COUNT = 8` (up to 8 sizes) | `gallery-config-shared.ts:127` | ✓ |
| Default sizes `[640, 1536, 2048, 4096, 5120, 7680]` | `gallery-config-shared.ts:85` | ✓ |
| `avif_effort` default `6` | `gallery-config-shared.ts:118` | ✓ |
| `wide_gamut_max_source_pixels` default `50000000` | `gallery-config-shared.ts:124` | ✓ |

### Advisory lock names (all verified present in `lib/advisory-locks.ts`)
- `gallerykit_db_restore` ✓ (line 19)
- `gallerykit_upload_processing_contract` ✓ (line 22)
- `gallerykit_topic_route_segments` ✓ (line 25)
- `gallerykit_admin_delete` ✓ (line 34)
- `gallerykit:image-processing:{jobId}` ✓ (line 41)
- `gallerykit_color_pipeline_backfill` ✓ (line 44)

### NCLX maps (`color-detection.ts`)
| Claim | Code | Result |
|-------|------|--------|
| primaries 1=BT.709, 9=BT.2020, 11=DCI-P3, 12=Display P3 | NCLX_PRIMARIES_MAP lines 171-174 | ✓ |
| transfer 1=srgb, 4=gamma22, 5=gamma28 (BT.470BG), 13=srgb, 14/15=gamma24, 16=pq, 17=gamma26, 18=hlg | NCLX_TRANSFER_MAP lines 177-212 | ✓ |
| matrix 0=identity, 1=bt709, 8=ycgco, 9=bt2020-ncl, 10=bt2020-cl | NCLX_MATRIX_MAP lines 214-219 | ✓ |

### Backfill column set
CLAUDE.md lists: `pipeline_version, icc_profile_name, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, color_pipeline_decision, was_downscaled, avif_10bit`
Code in `admin-backfill-runner.ts:556-567`: exact match ✓

### Concurrency env vars
- In-app: `ADMIN_BACKFILL_CONCURRENCY` (default 1), cap formula `max(1, floor((POOL_CONNECTION_LIMIT - RESERVED - 1) / 2))` with `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` → cap=2 at pool=10 | `admin-backfill-runner.ts:105-139` ✓
- Sidecar: `BACKFILL_CONCURRENCY` (default 2) uncapped | `scripts/backfill-color-pipeline.ts:359` ✓
- Pool: `POOL_CONNECTION_LIMIT = 10`, `queueLimit = 20`, `enableKeepAlive = true` | `db/index.ts:23,33,36` ✓

### Key file existence (Key Files table in CLAUDE.md)
All files checked exist at stated paths:
- `lib/og-sanitize.ts` ✓
- `lib/clip-paths.ts` ✓
- `lib/view-retention.ts` ✓
- `lib/color-detection.ts` ✓
- `lib/color-primaries.ts` ✓
- `lib/color-pipeline-decisions.ts` ✓
- `lib/icc-extractor.ts` ✓
- `lib/icc-chromaticity.ts` ✓
- `lib/gain-map-detection.ts` ✓
- `lib/use-display-capability.ts` ✓
- `lib/settings-hash.ts` ✓
- `lib/hdr-filenames.ts` ✓
- `lib/data.ts` ✓
- `src/proxy.ts` ✓
- `lib/auth-rate-limit.ts` ✓
- `app/[locale]/admin/db-actions.ts` ✓
- `app/api/admin/db/download/route.ts` ✓
- `src/site-config.json` ✓
- `app/api/og/photo/[id]/route.tsx` ✓

### sanitizeForOg import chain
CLAUDE.md says shared helper imported by both OG routes AND the JSON-LD photo page. Verified:
- `app/api/og/route.tsx` imports from `@/lib/og-sanitize` ✓
- `app/api/og/photo/[id]/route.tsx` imports from `@/lib/og-sanitize` ✓
- `app/[locale]/(public)/p/[id]/page.tsx` imports from `@/lib/og-sanitize` ✓

### cache() deduplication
CLAUDE.md claims "10 data-access functions". Code has exactly 10 `cache()` calls in `data.ts` ✓

### Upload limits
- `MAX_UPLOAD_FILE_BYTES = 200 MiB` | `upload-limits.ts:3` ✓
- `MAX_RESTORE_FILE_BYTES = 250 MiB` | `upload-limits.ts:4` ✓
- `UPLOAD_MAX_FILES_PER_WINDOW` default 100 | `upload-limits.ts:2,16` ✓
- `MAX_TOTAL_UPLOAD_BYTES` default 2 GiB | `upload-limits.ts:1,15` ✓

### Nginx body caps
- Default `2M` ✓ (line 31)
- Login page `64K` ✓ (line 58)
- `/admin/db` `250M` ✓ (line 75)
- `/admin/dashboard` `216M` ✓ (line 92)
- `/api/admin/lr/upload` `216M` ✓ (line 132)
- `/api/admin/` catch-all `2M` ✓ (line 149)

### icc-chromaticity thresholds
- HIGH_CONFIDENCE_TOLERANCE = 0.005 ✓ (`icc-chromaticity.ts:27`)
- MEDIUM_CONFIDENCE_TOLERANCE = 0.015 ✓ (`icc-chromaticity.ts:30`)

### Color field public/admin visibility
- `color_primaries`: present in `adminSelectFields`, not in the omit destructuring → in `publicSelectFieldCore` → PUBLIC ✓ (matches CLAUDE.md)
- `avif_10bit`: in `publicSelectFieldCore` (line 275), not in PrivacySensitiveKeys ✓ (matches CLAUDE.md "public-safe (R10-M4)")
- `is_hdr`, `has_gain_map`, `transfer_function`, `matrix_coefficients`, `pipeline_version`, `color_pipeline_decision`, `color_space`, `icc_profile_name`: all in PrivacySensitiveKeys (line 414) → admin-only ✓

### SW / PWA
- `HEAD_REVALIDATE_TIMEOUT_MS = 300` ms ✓ (`sw.template.js:38`)
- Image cache LRU cap 50 MB ✓ (`sw.template.js:31`)
- HTML offline cache TTL 24 h, 50-entry cap ✓ (`sw.template.js:32-33`)
- SW version stamp = `{git-short-sha}-p{IMAGE_PIPELINE_VERSION}` ✓ (`scripts/build-sw.ts:46`)

### HDR badge gating
CLAUDE.md: "gated on `isAdmin && isHdr` EXPLICITLY at the render point (AGG-M3)"
Code: `color-details-section.tsx:525` `{isAdmin && isHdr && (` ✓; `lightbox-color-pip.tsx:149` same ✓

### Semantic search
- Default `semantic_search_mode: 'disabled'` in `gallery-config-shared.ts:103` ✓
- `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env flag heals `'production'` to `'disabled'` without it | `gallery-config.ts:141` ✓
- `PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8'` | `clip-embeddings.ts:146` ✓
- Embedding: 512-dim × 4-byte float32 = 2048 bytes, MEDIUMBLOB | `clip-embeddings.ts:9,60` ✓

### New test files (TE-R9C1-01/02)
Both cover internal module behavior (`upload-tracker-state.ts`, `upload-processing-contract-lock.ts`) not described in CLAUDE.md at that level of detail. No CLAUDE.md update required — the advisory-lock and upload-contract-change serialization are already documented in the Race Condition Protections section.

---

## Summary

**0 mismatches.** All load-bearing factual claims in CLAUDE.md verified accurate against current code. No file paths, function names, env var names/defaults, schema columns, NCLX mappings, advisory-lock names, pool limits, nginx caps, or upload constants diverge from the code. Convergence confirmed.
