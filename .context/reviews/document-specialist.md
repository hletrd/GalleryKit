# Documentation vs Code Consistency Review — GalleryKit
## Cycle 2 | HEAD: 8ccc8806 | Reviewer: document-specialist | Date: 2026-06-16

---

## CLAUDE.md Claim Checklist

| # | CLAUDE.md Claim | File / Line | Status | Notes |
|---|----------------|-------------|--------|-------|
| C1 | `IMAGE_PIPELINE_VERSION = 7` | `gallery-config-shared.ts:21` | MATCH | |
| C2 | Default image sizes: 640, 1536, 2048, 4096, 5120, 7680 | `gallery-config-shared.ts:90` | MATCH | |
| C3 | `QUEUE_CONCURRENCY` env var, default 1 | `image-queue.ts:167` | MATCH | |
| C4 | `avif_effort` default `6` | `gallery-config-shared.ts:128` | MATCH | |
| C5 | `force_srgb_derivatives` default `false` | `gallery-config-shared.ts:116` | MATCH | |
| C6 | `allow_hdr_ingest` default `false` | `gallery-config-shared.ts:119` | MATCH | |
| C7 | `force_show_color_chips` default `false` | `gallery-config-shared.ts:122` | MATCH | |
| C8 | `wide_gamut_jpeg_chroma` default `'4:4:4'` | `gallery-config-shared.ts:125` | MATCH | |
| C9 | `sdr_jpeg_chroma` default `'4:2:0'` | `gallery-config-shared.ts:131` | MATCH | |
| C10 | `wide_gamut_max_source_pixels` default `50_000_000` | `gallery-config-shared.ts:134` | MATCH | |
| C11 | Settings hash covers "all **9** COLOR_IMPACTING_KEYS" | `settings-hash.ts:37-49` | MATCH | CLAUDE.md correctly says 9; stale comment in serve-upload.ts still says 3 (see DOC-01) |
| C12 | `HASH_LENGTH = 8` in settings-hash.ts | `settings-hash.ts:51` | MATCH | |
| C13 | ETag: no `.slice(0,8)` at ETag site | `serve-upload.ts:201` | MATCH | hash already 8 chars |
| C14 | React cache() wraps **10** data-access functions | `data.ts:1332,1595-1649` | MATCH | CLAUDE.md (line 357) correctly says 10 |
| C15 | `getLatestImageForOgCached` listed as a cached export | `data.ts:1597` | MATCH | |
| C16 | tagNamesAgg used in getImagesLite, getImagesLitePage, getAdminImagesLite, getImages | `data.ts:734,783,833,899,923` | MATCH | |
| C17 | Argon2id: memoryCost=65536, timeCost=3, parallelism=4 | `password-hashing.ts:11-14` | MATCH | |
| C18 | `POOL_CONNECTION_LIMIT = 10` | `db/index.ts:23,31` | MATCH | |
| C19 | Backfill pool-budget cap = 2 at shipped pool of 10 | `admin-backfill-runner.ts:122` | MATCH | |
| C20 | In-app backfill env var: `ADMIN_BACKFILL_CONCURRENCY` | `admin-backfill-runner.ts:662` | MATCH | |
| C21 | Sidecar backfill env var: `BACKFILL_CONCURRENCY` default 2 | `backfill-color-pipeline.ts:329` | MATCH | |
| C22 | Advisory lock names match code | `advisory-locks.ts:19-44` | MATCH | |
| C23 | image_views indexes: (bot,viewed_at,country_code) and (bot,viewed_at,referrer_host) | `schema.ts:232-233` | MATCH | |
| C24 | SW_VERSION = git short-SHA + `-p{IMAGE_PIPELINE_VERSION}` | `public/sw.js:26` → `ec50158b-p7` | MATCH | |
| C25 | `public/sw.template.js` is the shipped SW source | `public/sw.template.js` exists | MATCH | |
| C26 | nginx: 2 MiB default, 64 KiB login, 250 MiB restore, 216 MiB upload | `nginx/default.conf:31,58,75,92` | MATCH | |
| C27 | Max upload: 200 MiB/file; 2 GiB batch; 100 files/window | `upload-limits.ts:1,3,16` | MATCH | |
| C28 | Backfill column set includes pipeline_version, icc_profile_name, …, was_downscaled, avif_10bit | `admin-backfill-runner.ts:559-568` | MATCH | |
| C29 | i18n: same key set in en.json and ko.json | Script comparison (839 keys each) | MATCH | Zero parity violations |
| C30 | NCLX colr box: max depth 5, max scan 1 MB | `color-detection.ts:214,328` | MATCH | |
| C31 | NCLX primaries 1=BT.709, 9=BT.2020, 11=DCI-P3, 12=Display P3 | `color-detection.ts:169-173` | MATCH | |
| C32 | NCLX transfer 14/15=BT.2020→gamma24, 16=PQ, 18=HLG | `color-detection.ts:195-199` | MATCH | |
| C33 | NCLX matrix 0=identity, 1=BT.709, 9=BT.2020-NCL | `color-detection.ts:202-209` | MATCH | 8=bt2020-ncl and 10=bt2020-cl also present but omitted from summary (acceptable since summary is non-exhaustive) |
| C34 | `transfer_function` column values include gamma22, gamma18 | `color-detection.ts:25` | MISMATCH | See DOC-02 |
| C35 | serve-upload route: "executes only for locale-prefixed URLs and files missing from public/" | `app/uploads/[...path]/route.ts` and `app/[locale]/(public)/uploads/[...path]/route.ts` | MISMATCH | See DOC-03 |
| C36 | Journal has non-monotonic `when` timestamps | `_journal.json` idx=7 when=1746144000000 < idx=6 when=1778304060000 | MATCH | Correctly documented as a known problem |
| C37 | `x-gk-admin-render: 1` header set in proxy.ts | `proxy.ts:129` | MATCH | |
| C38 | revalidate=0 on all public pages | `page.tsx` for home/photo/group/shared | MATCH | |
| C39 | Admin pages use `dynamic='force-dynamic'` | Admin page files checked | MATCH | |
| C40 | GPS strip: JPEG/TIFF/HEIF-AVIF-HEIC/WebP use lossless byte-level; PNG uses re-encode | `gps-exif-strip.ts` | MATCH | |
| C41 | `was_downscaled` and `avif_10bit` in schema | `schema.ts:75,112` | MATCH | |

---

## Mismatches (by severity)

### HIGH

**DOC-01: Stale comment in `serve-upload.ts` lists only 3 COLOR_IMPACTING_KEYS**

- **Doc location**: `apps/web/src/lib/serve-upload.ts:187-190` (inline comment)
- **Code location**: `apps/web/src/lib/settings-hash.ts:37-49`
- **Claimed** (comment): The hash covers `wide_gamut_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives` (3 keys).
- **Actual**: The hash covers 9 keys: those 3 plus `sdr_jpeg_chroma`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`.
- **Impact**: A developer reading the serve-upload comment would believe only 3 settings affect ETag invalidation. If they add a new color/quality setting to settings-hash.ts, the serve-upload comment would not prompt them to verify coverage. Misleading for maintainers auditing the cache-invalidation contract.
- **Correction**: Update the comment at serve-upload.ts lines 187-190 to say "…covers all 9 COLOR_IMPACTING_KEYS (see settings-hash.ts for the authoritative list)" and remove the inline key enumeration (which will always drift). The CLAUDE.md ETag section (line 263) is already correct (says "all 9").
- **Confidence**: High (comment text vs settings-hash.ts source of truth are unambiguous).

---

### MEDIUM

**DOC-02: `transfer_function` column description in images table omits `gamma24` and `gamma26`; lists `gamma18` which is a valid but rare ICC-only value**

- **Doc location**: `CLAUDE.md` line 135 (images color/HDR columns table, "transfer_function" row)
- **Code location**: `apps/web/src/lib/color-detection.ts:25` (ColorSignals type); NCLX_TRANSFER_MAP lines 195-198
- **Claimed**: `transfer_function | NCLX (PQ / HLG / sRGB / gamma22 / gamma18 / linear) | admin-only`
- **Actual**: The column can store any of: `'srgb' | 'gamma22' | 'gamma18' | 'gamma24' | 'gamma26' | 'pq' | 'hlg' | 'linear' | 'unknown'`. Specifically: `gamma24` (NCLX codes 14/15, BT.1886) and `gamma26` (NCLX code 17, DCI-P3 gamma 2.6) are both valid values emitted by the resolver for real-world HEIF/AVIF files. The source column indicates "NCLX" but `gamma18` is emitted only from ICC name heuristics (ProPhoto / gamma 1.8 ICC profiles), not from NCLX.
- **Impact**: An admin or downstream consumer inspecting the column doc would not expect `gamma24` or `gamma26` values in the DB, causing confusion when reviewing actual data from BT.2020 SDR or DCI-P3 exports. The NCLX section (line 232) does correctly list `14/15=BT.2020→gamma24`, so the two sections of CLAUDE.md are internally inconsistent.
- **Correction**: Change line 135 to: `NCLX (PQ / HLG / sRGB / gamma22 / gamma24 / gamma26 / gamma18 / linear / unknown)` and remove the misleading "(NCLX)" qualifier since `gamma18` only comes from ICC name heuristics.
- **Confidence**: High.

**DOC-03: `serve-upload` route description incorrectly says it handles only locale-prefixed URLs**

- **Doc location**: `CLAUDE.md` line 261
- **Code location**: `apps/web/src/app/uploads/[...path]/route.ts` and `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- **Claimed**: "The `app/uploads/[...path]` route (and therefore the serve-upload pipeline below) executes only for locale-prefixed `/{locale}/uploads/...` URLs and for files missing from `public/`."
- **Actual**: There are **two** route handlers both calling `serveUploadFile`: (1) `/app/uploads/[...path]/route.ts` — a non-locale-prefixed route; (2) `/app/[locale]/(public)/uploads/[...path]/route.ts` — the locale-prefixed route. The first route handles `/uploads/...` URLs directly (non-locale). The comment in `serve-upload.ts:110` correctly describes both: "Used by both /uploads/[...path] and /[locale]/uploads/[...path] routes."
- **Impact**: A developer reading CLAUDE.md would incorrectly believe non-locale `/uploads/...` paths are served purely by Next.js static file serving (no route handler). The non-locale handler is the primary route for Service Worker HEAD checks (as the R20-L1 comment at `app/uploads/[...path]/route.ts:22` explains). Mischaracterizing which handler executes could cause incorrect assumptions about ETag/caching behavior when debugging SW issues.
- **Correction**: Change line 261 to: "The `app/uploads/[...path]` route and its locale-prefixed twin `app/[locale]/(public)/uploads/[...path]` both delegate to `serveUploadFile`. They execute for `/{locale}/uploads/...` and `/uploads/...` URLs respectively (and as a fallback when a file is missing from `public/`)."
- **Confidence**: High.

**DOC-04: Stale comment in `serve-upload.ts` ETag block lists only 3 COLOR_IMPACTING_KEYS (same underlying fact as DOC-01 but separately actionable as a code comment fix)**

Already captured in DOC-01. No separate entry needed.

---

### LOW

**DOC-05: NCLX summary in CLAUDE.md omits undocumented but real NCLX matrix code 8**

- **Doc location**: `CLAUDE.md` line 232, NCLX matrix summary: `0=identity, 1=BT.709, 9=BT.2020-NCL`
- **Code location**: `color-detection.ts:205`: `8: 'bt2020-ncl'`; `color-detection.ts:209`: `10: 'bt2020-cl'`
- **Claimed**: matrix codes are 0, 1, and 9 only.
- **Actual**: Codes 8 (bt2020-ncl, same as 9) and 10 (bt2020-cl) are also mapped.
- **Impact**: Low — the CLAUDE.md says "full mapping in color-detection.ts NCLX_TRANSFER_MAP" as a pointer; this is in the shorter summary bullet. An operator using this summary to validate data would not expect `bt2020-cl` values in the column.
- **Correction**: Add codes 8 and 10 to the matrix summary line, or add a note "…plus 8=BT.2020-NCL (alias for 9) and 10=BT.2020-CL".
- **Confidence**: High.

**DOC-06: `images` table doc omits `avif_10bit` from the color/HDR column list**

- **Doc location**: `CLAUDE.md` "images color / HDR columns" table (lines ~126-142)
- **Code location**: `schema.ts:112`: `avif_10bit: boolean('avif_10bit')`; `admin-backfill-runner.ts:568`
- **Claimed**: The column table lists color_space, icc_profile_name, bit_depth, color_pipeline_decision, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, pipeline_version, uploaded_by — no `avif_10bit`.
- **Actual**: `avif_10bit` is a real column written by both upload and backfill paths (it records whether the AVIF was encoded at 10-bit). CLAUDE.md's backfill section (line 282) mentions it in passing ("pipeline_version, …, avif_10bit") but it is absent from the canonical column table.
- **Impact**: An admin or maintainer using the column table as a reference would not know `avif_10bit` exists. Low operational risk since `avif_10bit` is listed under the backfill section prose.
- **Correction**: Add a row for `avif_10bit | probe + libheif availability test | admin-only` to the images color/HDR columns table.
- **Confidence**: High.

**DOC-07: Journal `when` non-monotonicity at idx 7 is documented as a past issue but the journal itself still contains the non-monotonic values**

- **Doc location**: `CLAUDE.md` Migration & Schema-Drift Runbook (line ~315)
- **Code location**: `drizzle/meta/_journal.json` — idx=7 has `when=1746144000000` which is less than idx=6's `when=1778304060000`
- **Claimed**: CLAUDE.md correctly documents this as a known problem and explains the post-condition guard in migrate.js that catches it.
- **Status**: INFORMATIONAL — the documentation is accurate about the problem. No doc fix needed. Flagging for completeness.
- **Confidence**: High.

---

## i18n Key Parity Result

**Result: PASS — perfect parity.**

- `en.json`: 839 leaf keys
- `ko.json`: 839 leaf keys
- Keys only in EN: **0**
- Keys only in KO: **0**

The documented convention (same key set, value shape may differ; Korean omits ICU plural blocks) is correctly implemented. No violations found.

---

## Third-Party Claim Verification

### 1. Sharp `withMetadata()` behavior in 0.33+ (CLAUDE.md line ~1531)

**CLAUDE.md claims**: "In Sharp 0.33+ `withMetadata()` keeps most input metadata (EXIF/XMP/IPTC) including GPS coordinates; in Sharp 0.33+ this behaviour is explicit (R4C8 COR-R4C8-01)".

**Code**: `gps-exif-strip.ts` comment (lines 4-7) and `process-image.ts` comment (lines 1530-1533) both say the same.

**Verification**: Sharp's changelog and API docs for v0.33 confirm that `withMetadata()` retains all metadata by default; explicit stripping requires `withMetadata({ exif: {} })` or similar. The claim aligns with Sharp's documented behavior. Source: https://sharp.pixelplumbing.com/api-output#withmetadata (accessed 2026-06-16). **Status: MATCH / CORRECT.**

### 2. Drizzle migrator internals — MAX(created_at) cursor behavior

**CLAUDE.md claims**: The Drizzle MySQL migrator "decides whether to apply each journal entry by: `if (lastDbMigration.created_at < migration.folderMillis) apply`; it only checks MAX(created_at) — not per-entry hashes."

**Verification**: This is an internal behavior documented via the source path `drizzle-orm/mysql-core/dialect.cjs:62`. The migrate.js source comments (lines 629-636) confirm this is the observed behavior that caused the production incident. The claimed mitigation (post-condition assertion on hashes) is implemented in `migrate.js:709`. The file path mentioned in the comment (`drizzle-orm/mysql-core/dialect.cjs:62`) is marked "informational only, file/line drifts across drizzle-orm versions" — that caveat is present in CLAUDE.md. **Status: CORRECTLY CAVEATED, not a mismatch.**

### 3. `(color-gamut: p3)` Media Query support — Firefox 110+ claim

**CLAUDE.md claims**: "Firefox 110+ supports the `(color-gamut: p3)` MQ" and "Firefox ≤ 109: no color-gamut MQ support."

**Verification**: MDN and caniuse data confirm Firefox added `color-gamut` MQ support in version 110 (released Feb 2023). Source: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/color-gamut — Firefox: 110+. **Status: CORRECT.**

### 4. `screen.colorGamut` API — Firefox not supported claim

**CLAUDE.md claims**: "`screen.colorGamut` remains unsupported in Firefox across all versions."

**Verification**: `screen.colorGamut` is a non-standard API. MDN documents it as available in Chrome/Safari/Edge but not Firefox. Caniuse does not list Firefox support. **Status: CORRECT as of 2026-06-16.**

---

## Top 3 Most Important Doc Fixes

1. **DOC-01 (HIGH)** — `serve-upload.ts` ETag comment, lines 187-190: Update to remove the stale 3-key list and point to `settings-hash.ts` as the authoritative list. The comment directly contradicts the actual 9-key implementation and will mislead anyone auditing cache-invalidation coverage.

2. **DOC-03 (MEDIUM)** — `CLAUDE.md` line 261: Correct the serve-upload route description to reflect that **both** `/uploads/[...path]` (non-locale) and `/[locale]/uploads/[...path]` routes call `serveUploadFile`, not only the locale-prefixed one. The current wording implies the non-locale `/uploads/...` path is handled exclusively by Next.js static serving, which is wrong.

3. **DOC-02 (MEDIUM)** — `CLAUDE.md` line 135 `transfer_function` column entry: Add `gamma24` and `gamma26` to the value list. These are produced by real-world HEIF/AVIF files with NCLX codes 14/15/17 (BT.2020 10/12-bit SDR and DCI-P3). The omission creates an internal inconsistency between the column table (line 135) and the NCLX summary (line 232), which already correctly documents those codes.
