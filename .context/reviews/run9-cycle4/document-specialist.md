# Document Specialist Review — Run-9 Cycle-4

**Date:** 2026-06-21
**HEAD:** 094842a4 (same convergence-era source; docs-only delta since e1acaff1)
**Reviewer:** document-specialist
**Scope:** Systematic CLAUDE.md factual verification against current code — 10 mandated spot-checks + new-drift scan.

---

## Verdict: ZERO NEW DEFECTS — CONVERGENCE HOLDS

All 10 mandated spot-checks MATCH. No load-bearing doc claim is false against current code. No new drift introduced since run-8.

---

## Spot-Check Results (each: doc line + code line/file)

### 1. IMAGE_PIPELINE_VERSION = 7
- **CLAUDE.md (line ~64):** "`IMAGE_PIPELINE_VERSION` (currently 7) is DEFINED in `gallery-config-shared.ts:21` and re-exported here"
- **Code:** `gallery-config-shared.ts:21` → `export const IMAGE_PIPELINE_VERSION = 7;`
- **Re-export:** `process-image.ts:313-315` → `export { IMAGE_PIPELINE_VERSION } from '@/lib/gallery-config-shared';` (with a comment at :313 matching doc description)
- **Result: MATCH**

### 2. COLOR_IMPACTING_KEYS count = 9 and exact key list (settings-hash.ts:41-53)
- **CLAUDE.md:** "9 COLOR_IMPACTING_KEYS (`settings-hash.ts:41-53`)" — lists: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`
- **Code:** `settings-hash.ts:42-54` — exactly those 9 keys as `const COLOR_IMPACTING_KEYS = [...]`. File comment at :3 also says "9 settings".
- **Note:** Doc cites lines 41-53; actual array is lines 42-54. Off-by-one in line citation but the array content is correct and the doc parenthetical is informational only.
- **Result: MATCH** (line citation is approximate, not load-bearing)

### 3. HASH_LENGTH = 8
- **CLAUDE.md:** "the hash is already 8 chars — `HASH_LENGTH` in `settings-hash.ts`"
- **Code:** `settings-hash.ts:68` → `const HASH_LENGTH = 8;`
- **Result: MATCH**

### 4. VIEW_RETENTION_DAYS default = 395
- **CLAUDE.md:** "default 395 days / 13 months"
- **Code:** `view-retention.ts:29` → `const DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000;` with comment "13 months"
- **Result: MATCH**

### 5. Backfill concurrency cap math: max(1, floor((POOL_LIMIT − RESERVED − 1)/2)), RESERVED=max(3, ceil(POOL_LIMIT/2)), = 2 at pool 10
- **CLAUDE.md:** "`max(1, floor((POOL_CONNECTION_LIMIT − RESERVED − 1) / 2))` with `RESERVED = max(3, ceil(POOL_CONNECTION_LIMIT / 2))` — at the shipped pool of 10 this is **2**"
- **Code:**
  - `db/index.ts:23` → `export const POOL_CONNECTION_LIMIT = 10;`
  - `admin-backfill-runner.ts:105-106` → `BACKFILL_RESERVED_LIVE_CONNECTIONS = (poolLimit) => Math.max(3, Math.ceil(poolLimit / 2))`
  - `admin-backfill-runner.ts:129-141` → `resolveBackfillConcurrency`: `const reserved = BACKFILL_RESERVED_LIVE_CONNECTIONS(limit); const cap = Math.max(1, Math.floor((limit - reserved - 1) / 2));`
  - Comment at :122 confirms: "At LIMIT = 10, RESERVED = max(3, 5) = 5, so the cap is floor((10−5−1)/2) = floor(4/2) = 2"
- **Result: MATCH**

### 6. Advisory lock names (6 named locks)
- **CLAUDE.md (line ~356):** Lists `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`
- **Code:** `advisory-locks.ts` defines all five string constants:
  - `:19` → `LOCK_DB_RESTORE = 'gallerykit_db_restore'`
  - `:22` → `LOCK_UPLOAD_PROCESSING_CONTRACT = 'gallerykit_upload_processing_contract'`
  - `:25` → `LOCK_TOPIC_ROUTE_SEGMENTS = 'gallerykit_topic_route_segments'`
  - `:34` → `LOCK_ADMIN_DELETE = 'gallerykit_admin_delete'`
  - `:44` → `LOCK_COLOR_PIPELINE_BACKFILL = 'gallerykit_color_pipeline_backfill'`
  - `:40-41` → `getImageProcessingLockName = (jobId) => \`gallerykit:image-processing:${jobId}\``
- **Result: MATCH** (all 6 names correct, colon separator on the per-image lock confirmed)

### 7. React cache() count = 10 wrapped functions
- **CLAUDE.md:** "React `cache()` wraps 10 data-access functions … every `data.ts` export ending in `Cached` … plus `getSeoSettings`"
- **Code:** `data.ts` — exactly 10 `= cache(` calls:
  1. `:1330` `getSmartCollectionBySlugCached`
  2. `:1606` `getImageCached`
  3. `:1608` `getLatestImageForOgCached`
  4. `:1609` `getTopicBySlugCached`
  5. `:1610` `getTopicsCached`
  6. `:1611` `getTagsCached`
  7. `:1612` `getTopicsWithAliasesCached`
  8. `:1614` `getImageByShareKeyCached`
  9. `:1619` `getSharedGroupCached`
  10. `:1660` `getSeoSettings = cache(_getSeoSettings)`
- **Result: MATCH** (grep -c confirmed count = 10)

### 8. nginx body caps (2 MiB / 64 KiB / 250 MiB / 216 MiB / 216 MiB lr-upload)
- **CLAUDE.md:** "2 MiB by default, 64 KiB for login, 250 MiB for `/admin/db` restore, 216 MiB for admin dashboard uploads, and 216 MiB for the Lightroom Classic publish-plugin upload route `/api/admin/lr/upload`"
- **Code:** `nginx/default.conf`:
  - `:31` → `client_max_body_size 2M;` (global default)
  - `:58` → `location ~ ^(/[a-z]{2})?/admin$` → `client_max_body_size 64K;`
  - `:74-75` → `location ~ ^(/[a-z]{2})?/admin/db` → `client_max_body_size 250M;`
  - `:91-92` → `location ~ ^(/[a-z]{2})?/admin/dashboard` → `client_max_body_size 216M;`
  - `:131-132` → `location ^~ /api/admin/lr/upload` → `client_max_body_size 216M;`
- **Result: MATCH** (all 5 caps correct)

### 9. NCLX transfer/primaries/matrix maps vs CLAUDE.md table
- **CLAUDE.md claims:** primaries `1=BT.709`, `9=BT.2020`, `11=DCI-P3`, `12=Display P3`; transfer `5=gamma28`, `14/15→gamma24`, `16=PQ`, `17→gamma26`, `18=HLG`; matrix `0=identity`, `1=BT.709`, `8=YCgCo`, `9=BT.2020-NCL`, `10=BT.2020-CL`
- **Code:** `color-detection.ts`:
  - `NCLX_PRIMARIES_MAP` (`:170-174`): `1:'bt709'`, `9:'bt2020'`, `11:'dci-p3'`, `12:'p3-d65'`
  - `NCLX_TRANSFER_MAP` (`:177-212`): `5:'gamma28'`, `14:'gamma24'`, `15:'gamma24'`, `16:'pq'`, `17:'gamma26'`, `18:'hlg'`
  - `NCLX_MATRIX_MAP` (`:214-219`): `0:'identity'`, `1:'bt709'`, `8:'ycgco'`, `9:'bt2020-ncl'`, `10:'bt2020-cl'`
- **Note:** CLAUDE.md says primaries `12=Display P3`; code value is `'p3-d65'` (the internal enum label for Display P3/P3-D65). This is not a defect — `p3-d65` IS Display P3 (Display P3 uses the D65 white point); CLAUDE.md uses the human-readable name. The internal enum label distinction is cosmetic, not a false claim.
- **gamma28=code5, matrix8=YCgCo, gamma26=17, gamma24=14/15**: all MATCH exactly.
- **Result: MATCH**

### 10. Key Files & Patterns table — spot-check 6 paths
All confirmed to exist at expected absolute paths:
- `/apps/web/src/lib/color-pipeline-decisions.ts` — EXISTS
- `/apps/web/src/lib/icc-chromaticity.ts` — EXISTS
- `/apps/web/src/lib/gain-map-detection.ts` — EXISTS
- `/apps/web/src/lib/og-sanitize.ts` — EXISTS
- `/apps/web/src/lib/hdr-filenames.ts` — EXISTS
- `/apps/web/src/proxy.ts` — EXISTS
- `/apps/web/src/lib/settings-hash.ts` — EXISTS
- `/apps/web/src/lib/color-detection.ts` — EXISTS
- `/apps/web/src/lib/blur-data-url.ts` — EXISTS
- `/apps/web/src/lib/view-retention.ts` — EXISTS
- `/apps/web/src/lib/auth-rate-limit.ts` — EXISTS
- **Result: MATCH**

---

## New Drift Scan (since run-8)

**Scope of source changes since run-8 convergence (`f63af3b9`):** `scripts/backfill-cicp-recheck.ts` (onEmpty→onIdle), two new test files (`upload-tracker-state.test.ts`, `upload-processing-contract-lock.test.ts`), plus run-9 c3 fixes to `bulk-edit-dialog.tsx` (aria-label) and `upload-tracker-state.test.ts` (beforeAll clear). Zero production logic, schema, or config change.

- **bulk-edit-dialog**: CLAUDE.md does not mention `bulk-edit-dialog.tsx` by name. No doc claim to verify or drift.
- **cicp-recheck**: CLAUDE.md does not describe `backfill-cicp-recheck.ts` by name. No doc claim.
- **backfill columns**: CLAUDE.md lists 10 columns persisted on re-encode. Not changed since run-8.
- **No new advisory locks, no new COLOR_IMPACTING_KEYS, no new cache() calls, no schema migrations**: confirmed by zero production-source delta since `e1acaff1`.

**Result: zero new drift.**

---

## Summary

| Check | Result | Confidence |
|-------|--------|------------|
| IMAGE_PIPELINE_VERSION=7 | MATCH | HIGH |
| COLOR_IMPACTING_KEYS=9, exact list | MATCH | HIGH |
| HASH_LENGTH=8 | MATCH | HIGH |
| VIEW_RETENTION_DAYS=395 | MATCH | HIGH |
| Backfill cap math → 2 at pool 10 | MATCH | HIGH |
| Advisory lock names (6) | MATCH | HIGH |
| React cache() count=10 | MATCH | HIGH |
| nginx body caps (5 values) | MATCH | HIGH |
| NCLX transfer/primaries/matrix maps | MATCH | HIGH |
| Key file paths (11 spot-checked) | MATCH | HIGH |
| New drift scan | NONE FOUND | HIGH |

**Conclusion: ZERO NEW DEFECTS. CONVERGENCE CONFIRMED ON DOC AXIS.**
