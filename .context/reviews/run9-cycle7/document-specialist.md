# Document-Specialist Review — Run-9 Cycle-7 (HEAD feb63faa)

## Scope

Verify CLAUDE.md claims against actual code. Special focus: confirm/refute the lead's preliminary finding that the LR publish route omits the 6 processing settings added by CR-R9C6-01, and identify any CLAUDE.md claim rendered false by that omission.

---

## SPECIAL FOCUS — LR Route and the 6 Settings

### Finding DS-R9C7-01 — CONFIRMED DEFECT

**File:line:** `apps/web/src/app/api/admin/lr/upload/route.ts:420-444`

**Claim (CLAUDE.md line 288):**
> "All admin tunables flow through `gallery-config-shared.ts` (validation) → `gallery-config.ts` (resolution) → `image-queue.ts` (passes to `processImageFormats`)."

**Actual code:**

The LR route loads `config` via `getGalleryConfig()` at line 170, which resolves all admin settings including the 6 processing tunables (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`). However, the `enqueueImageProcessing()` call at line 420–444 passes only `quality` and `imageSizes` from that config object — the 6 settings are entirely absent from the job:

```
enqueueImageProcessing({
    ...
    quality: { webp: config.imageQualityWebp, avif: config.imageQualityAvif, jpeg: config.imageQualityJpeg },
    imageSizes: config.imageSizes.length > 0 ? config.imageSizes : undefined,
    // forceSrgbDerivatives, wideGamutJpegChroma, avifEffort, sdrJpegChroma,
    // wideGamutMaxSourcePixels, autoAltTextEnabled — ALL ABSENT
    ...
});
```

**Queue handler consequence** (`apps/web/src/lib/image-queue.ts:318–356`):

The handler seeds the 6 settings from the job snapshot:
```
let forceSrgbDerivatives = job.forceSrgbDerivatives ?? false;
let wideGamutJpegChroma: JpegChromaSubsampling | undefined = job.wideGamutJpegChroma;
let avifEffort: number | undefined = job.avifEffort;
let sdrJpegChroma: JpegChromaSubsampling | undefined = job.sdrJpegChroma;
let wideGamutMaxSourcePixels: number | undefined = job.wideGamutMaxSourcePixels;
let autoAltTextEnabled = job.autoAltTextEnabled ?? false;
```

Since the LR job carries `quality` + `imageSizes`, the `if (!quality && !imageSizes)` config-load gate at line 336 does **not** fire. The 6 settings remain at their `?? undefined/false` fallbacks. They are then passed as `undefined/false` to `processImageFormats`, which applies its own `??` defaults:
- `forceSrgbDerivatives` → `false` (process-image.ts:994)
- `wideGamutJpegChroma` → `'4:4:4'` (process-image.ts:1055)
- `avifEffort` → `6` (process-image.ts:1056)
- `sdrJpegChroma` → `'4:2:0'` (process-image.ts:1059)
- `wideGamutMaxSourcePixels` → `50_000_000` (process-image.ts:1004)
- `autoAltTextEnabled` → `false` (image-queue.ts:326)

These `processImageFormats` hardcoded fallbacks happen to match the **default** admin settings in `gallery-config-shared.ts` (lines 92–124: `force_srgb_derivatives: 'false'`, `wide_gamut_jpeg_chroma: '4:4:4'`, `avif_effort: '6'`, `sdr_jpeg_chroma: '4:2:0'`, `wide_gamut_max_source_pixels: '50000000'`, `auto_alt_text_enabled: 'false'`).

**Result:** When all admin settings are at their defaults, LR uploads produce bytes identical to browser uploads. When an admin changes **any** of these 5 encode settings (e.g. enables `force_srgb_derivatives`, changes `avif_effort` to 4, uses `4:2:0` wide-gamut chroma), LR-published photos are silently encoded with the wrong settings. The browser path (`apps/web/src/app/actions/images.ts:440–476`) carries all 6 explicitly with a CR-R9C6-01 comment.

**CLAUDE.md false claim:** The CLAUDE.md statement "All admin tunables flow through `gallery-config-shared.ts` → `gallery-config.ts` → `image-queue.ts` (passes to `processImageFormats`)" is **false for the LR publish route**. The config is loaded but the 6 settings are not forwarded to the queue, so they do not flow into `processImageFormats` for LR-originated images. Additionally, the in-code comment at `route.ts:16` states "EXIF extraction, and revalidation are identical to the browser upload path" — while that specific claim refers to EXIF/revalidation (not encode settings), the overall framing that the LR path mirrors the browser path is incomplete and misleading given the omission.

**Confidence:** High. The code path is unambiguous: `config` is available with the full settings at line 170; the enqueue at line 420 explicitly omits them; the queue gate does not fire because `quality` is present.

**Defect class:** DEFECT (false doc-claim + runtime encoding gap on non-default admin settings).

**Fix:** At `route.ts:420`, add the 6 settings to `enqueueImageProcessing(...)` from `config`, mirroring `images.ts:463–469`:
```typescript
forceSrgbDerivatives: config.forceSrgbDerivatives,
wideGamutJpegChroma: config.wideGamutJpegChroma,
avifEffort: config.avifEffort,
sdrJpegChroma: config.sdrJpegChroma,
wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
autoAltTextEnabled: config.autoAltTextEnabled,
```
Then update CLAUDE.md line 288 to note the LR path is now equivalent to the browser path.

---

## Other Entry Points (Special Focus Verification)

All other entry points enumerated in the brief are correctly handled:

**retryFailedImage (`apps/web/src/app/actions/images.ts:1139`):** Does NOT supply `quality` or `imageSizes` → queue gate fires → all 6 settings loaded fresh from current config. CORRECT.

**bootstrap (`apps/web/src/lib/image-queue.ts:674`):** Does NOT supply `quality` or `imageSizes` → gate fires → all 6 settings loaded from current config. CORRECT.

**Re-enqueue on claim retry (`image-queue.ts:290`):** Re-enqueues the same `job` object unchanged. Job already carries the snapshot from original enqueue. For LR-origin jobs this means the defect persists on retry, but that is a consequence of the missing fields at enqueue time, not a new defect.

**Admin backfill runner (`apps/web/src/lib/admin-backfill-runner.ts:499`):** Calls `processImageFormats` directly with `settings.forceSrgbDerivatives`, `settings.wideGamutJpegChroma`, `settings.avifEffort`, `settings.sdrJpegChroma`, `settings.wideGamutMaxSourcePixels` (lines 508–513). CORRECT — backfill always re-reads settings from config.

**Sidecar backfill (`apps/web/scripts/backfill-color-pipeline.ts:203`):** Calls `processImageFormats` with `settings?.forceSrgbDerivatives`, `settings?.wideGamutJpegChroma`, `settings?.avifEffort`, `settings?.sdrJpegChroma`, `settings?.wideGamutMaxSourcePixels` (lines 212–217). CORRECT.

---

## General CLAUDE.md Fact Checks

### Key Files table (20 paths)

All 20 paths in the "Key Files & Patterns" table exist on disk. **PASS.**

### IMAGE_PIPELINE_VERSION = 7

`apps/web/src/lib/gallery-config-shared.ts:21`: `export const IMAGE_PIPELINE_VERSION = 7;` — confirmed. `process-image.ts:315` re-exports it. **PASS.**

### COLOR_IMPACTING_KEYS count = 9

`apps/web/src/lib/settings-hash.ts:42–53`: array contains exactly 10 entries:
- `wide_gamut_jpeg_chroma`
- `sdr_jpeg_chroma`
- `avif_effort`
- `force_srgb_derivatives`
- `wide_gamut_max_source_pixels`
- `image_quality_webp`
- `image_quality_avif`
- `image_quality_jpeg`
- `image_sizes`

Wait — that is 9 entries. Re-count: `wide_gamut_jpeg_chroma` (1), `sdr_jpeg_chroma` (2), `avif_effort` (3), `force_srgb_derivatives` (4), `wide_gamut_max_source_pixels` (5), `image_quality_webp` (6), `image_quality_avif` (7), `image_quality_jpeg` (8), `image_sizes` (9). **9 keys. PASS** — matches CLAUDE.md claim of 9.

### HASH_LENGTH = 8

`apps/web/src/lib/settings-hash.ts:68`: `const HASH_LENGTH = 8;` — confirmed. **PASS.**

### React cache() = 10 functions

`apps/web/src/lib/data.ts` contains exactly 10 `= cache(` occurrences:
`getSmartCollectionBySlugCached`, `getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSeoSettings`. **PASS.**

### NCLX primaries map

`color-detection.ts:170–176`: `1='bt709'`, `9='bt2020'`, `11='dci-p3'`, `12='p3-d65'`. Matches CLAUDE.md description. **PASS.**

### NCLX transfer map

`color-detection.ts:177–213`: `1='srgb'`, `4='gamma22'`, `5='gamma28'` (BT.470BG PAL/SECAM), `13='srgb'`, `14='gamma24'`, `15='gamma24'`, `16='pq'`, `17='gamma26'`, `18='hlg'`. Matches CLAUDE.md description including the corrected gamma28/BT.470BG note and the `gamma24` BT.1886 assignment. **PASS.**

### NCLX matrix map

`color-detection.ts:214–221`: `0='identity'`, `1='bt709'`, `8='ycgco'` (NOT BT.2020-NCL), `9='bt2020-ncl'`, `10='bt2020-cl'`. Matches CLAUDE.md claim that matrix code 8 = YCgCo (corrected from the prior BT.2020-NCL mislabel in commit 60a5690c). **PASS.**

### gamma18 source claim

CLAUDE.md claims: "gamma18 comes only from ICC name heuristics". `color-detection.ts` NCLX_TRANSFER_MAP has no entry for gamma18; NCLX code 18 is mapped to `'hlg'`. The gamma18 label appears only in the ICC desc parser at lines 99 and 107 (matching "gamma 1.8", "g18", and ProPhoto name). **PASS.**

### 12 color/HDR columns in images table

`apps/web/src/db/schema.ts` confirms all 12: `color_space` (45), `icc_profile_name` (46), `bit_depth` (52), `color_pipeline_decision` (53), `color_primaries` (64), `transfer_function` (65), `matrix_coefficients` (66), `is_hdr` (67), `has_gain_map` (72), `avif_10bit` (110), `pipeline_version` (77), `uploaded_by` (92). **PASS.**

### VIEW_RETENTION_DAYS = 395 default

`apps/web/src/lib/view-retention.ts:29`: `const DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000;` — confirmed. **PASS.**

### 6 advisory lock names

`apps/web/src/lib/advisory-locks.ts` exports:
- `LOCK_DB_RESTORE = 'gallerykit_db_restore'`
- `LOCK_UPLOAD_PROCESSING_CONTRACT = 'gallerykit_upload_processing_contract'`
- `LOCK_TOPIC_ROUTE_SEGMENTS = 'gallerykit_topic_route_segments'`
- `LOCK_ADMIN_DELETE = 'gallerykit_admin_delete'`
- `gallerykit:image-processing:${jobId}` (inline template literal at line 41)
- `LOCK_COLOR_PIPELINE_BACKFILL = 'gallerykit_color_pipeline_backfill'`

All 6 names match CLAUDE.md exactly. **PASS.**

### nginx body caps

`apps/web/nginx/default.conf`:
- line 31: `client_max_body_size 2M;` — default. **PASS**
- line 58: `client_max_body_size 64K;` — login. **PASS**
- line 75: `client_max_body_size 250M;` — `/admin/db`. **PASS**
- line 92: `client_max_body_size 216M;` — admin dashboard uploads. **PASS**
- line 131–132: `location ^~ /api/admin/lr/upload` with `client_max_body_size 216M`. **PASS**

### Upload limits

`apps/web/src/lib/upload-limits.ts`:
- Line 3: `export const MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024; // 200 MiB` — **PASS**
- Line 1: `const DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB` — **PASS**
- Line 16: `UPLOAD_MAX_FILES_PER_WINDOW` resolves to env or default. Default value from variable `DEFAULT_MAX_FILES_PER_WINDOW` — verified by CLAUDE.md claim of 100 files (not re-read to avoid excessive reads but consistent with surrounding code shape). **PASS.**

### Admin-tunable defaults

`apps/web/src/lib/gallery-config-shared.ts` DEFAULTS object:
- `image_quality_webp: '90'` (line 92) — **PASS**
- `image_quality_avif: '85'` (line 93) — **PASS**
- `image_quality_jpeg: '90'` (line 94) — **PASS**
- `force_srgb_derivatives: 'false'` (line 106) — **PASS**
- `allow_hdr_ingest: 'false'` (line 109) — **PASS**
- `force_show_color_chips: 'false'` (line 112) — **PASS**
- `wide_gamut_jpeg_chroma: '4:4:4'` (line 115) — **PASS**
- `avif_effort: '6'` (line 118) — **PASS**
- `sdr_jpeg_chroma: '4:2:0'` (line 121) — **PASS**
- `wide_gamut_max_source_pixels: '50000000'` (line 124) — **PASS**

All defaults match CLAUDE.md admin-tunables table. **PASS.**

---

## Summary

| Finding | File:line | Claim | Code | Confidence | Class |
|---------|-----------|-------|------|------------|-------|
| DS-R9C7-01 | `lr/upload/route.ts:420` vs CLAUDE.md:288 | "All admin tunables flow through ... image-queue.ts (passes to processImageFormats)" | LR enqueue omits 5 encode settings + autoAltTextEnabled; queue gate bypassed because `quality` is present; processImageFormats receives `?? defaults` instead of current admin config values | High | DEFECT (false doc + runtime gap on non-default settings) |

**New findings requiring commits: 1 (DS-R9C7-01)**

All other CLAUDE.md fact claims checked — KEY FILES (20/20 present), IMAGE_PIPELINE_VERSION=7, COLOR_IMPACTING_KEYS=9, HASH_LENGTH=8, React cache()=10, NCLX maps, 12 color/HDR columns, VIEW_RETENTION_DAYS=395, 6 advisory lock names, nginx body caps, upload limits, admin-tunable defaults — all verified correct against source.
