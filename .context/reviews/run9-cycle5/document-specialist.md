# Document Specialist Review — Run-9 Cycle-5

**HEAD:** e34c04cf  
**Date:** 2026-06-21  
**Spot-checks performed:** 15  

---

## Method

Claims in CLAUDE.md were grouped by type (counts, default values, file paths, code constants,
NCLX maps, function names, architecture facts) and the highest-entropy ones were verified
directly against source. "Highest entropy" means claims most likely to have drifted since
last written — numeric constants, enum mappings, and function names — rather than stable
narrative prose.

---

## Spot-Checks

### 1. IMAGE_PIPELINE_VERSION = 7
- **Source:** `gallery-config-shared.ts:21` — `export const IMAGE_PIPELINE_VERSION = 7;`
- **CLAUDE.md claim:** "currently 7, DEFINED in `gallery-config-shared.ts:21`"
- **Result:** MATCHES (line number and value both correct)

### 2. COLOR_IMPACTING_KEYS count = 9
- **Source:** `settings-hash.ts:42-54` — 9 entries: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`,
  `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`,
  `image_quality_avif`, `image_quality_jpeg`, `image_sizes`
- **CLAUDE.md claim:** "9 `COLOR_IMPACTING_KEYS`"
- **Result:** MATCHES

### 3. HASH_LENGTH = 8
- **Source:** `settings-hash.ts:68` — `const HASH_LENGTH = 8;`
- **CLAUDE.md claim:** "the hash is already 8 chars — `HASH_LENGTH` in `settings-hash.ts`"
- **Result:** MATCHES

### 4. VIEW_RETENTION_DAYS default = 395
- **Source:** `view-retention.ts:29` — `const DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000;`
- **CLAUDE.md claim:** "default 395 days / 13 months"
- **Result:** MATCHES

### 5. Pool connection limit = 10, queue limit = 20, keepalive enabled
- **Source:** `db/index.ts:23,31,33,36` — `POOL_CONNECTION_LIMIT = 10`, `connectionLimit: 10`,
  `queueLimit: 20`, `keepAliveInitialDelay: 30000`
- **CLAUDE.md claim:** "10 connections, queue limit 20, keepalive enabled"
- **Result:** MATCHES

### 6. Backfill concurrency cap = 2 at pool=10
- **Source:** `db/index.ts:16-20` comment + `admin-backfill-runner.ts:105,122` —
  `RESERVED = max(3, ceil(10/2)) = 5`, cap = `floor((10-5-1)/2) = 2`
- **CLAUDE.md claim:** "cap = 2 at pool of 10" with `RESERVED = max(3, ceil(POOL/2))`
- **Result:** MATCHES

### 7. Advisory lock names (6 names)
- **Source:** `advisory-locks.ts:19,22,25,34,41,44` —
  `gallerykit_db_restore`, `gallerykit_upload_processing_contract`,
  `gallerykit_topic_route_segments`, `gallerykit_admin_delete`,
  `gallerykit:image-processing:{jobId}` (dynamic), `gallerykit_color_pipeline_backfill`
- **CLAUDE.md claim:** Same 6 names listed
- **Result:** MATCHES

### 8. React cache() count = 10
- **Source:** `data.ts:1330,1606-1619,1660` — 10 `= cache(...)` calls:
  `getSmartCollectionBySlugCached`, `getImageCached`, `getLatestImageForOgCached`,
  `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`,
  `getImageByShareKeyCached`, `getSharedGroupCached`, `getSeoSettings`
- **CLAUDE.md claim:** "10 data-access functions … every `data.ts` export ending in `Cached` … plus `getSeoSettings`"
- **Result:** MATCHES

### 9. NCLX primaries map
- **Source:** `color-detection.ts:170-175` — `{1: 'bt709', 9: 'bt2020', 11: 'dci-p3', 12: 'p3-d65'}`
- **CLAUDE.md claim:** "`1=BT.709`, `9=BT.2020`, `11=DCI-P3`, `12=Display P3`"
- **Result:** MATCHES (12 maps to 'p3-d65' which is Display P3 — same as prior confirmed non-defect)

### 10. NCLX transfer map key entries
- **Source:** `color-detection.ts:185-211` — code 4='gamma22', 5='gamma28', 14='gamma24',
  15='gamma24', 16='pq', 17='gamma26', 18='hlg', 13='srgb'
- **CLAUDE.md claim:** "`4=gamma22`, `5=gamma28`, `14/15→gamma24`, `16=PQ`, `17→gamma26`, `18=HLG`;
  `13=sRGB IEC61966-2-1 is the canonical code`"
- **Result:** MATCHES (code 13 is mapped as 'srgb' at line 196)

### 11. NCLX matrix map
- **Source:** `color-detection.ts:214-219` — `{0:'identity', 1:'bt709', 8:'ycgco', 9:'bt2020-ncl', 10:'bt2020-cl'}`
- **CLAUDE.md claim:** "`0=identity`, `1=BT.709`, `8=YCgCo`, `9=BT.2020-NCL`, `10=BT.2020-CL`"
- **Result:** MATCHES

### 12. Admin settings defaults
- **Source:** `gallery-config-shared.ts:92-124` —
  `image_quality_webp='90'`, `image_quality_avif='85'`, `image_quality_jpeg='90'`,
  `avif_effort='6'`, `wide_gamut_max_source_pixels='50000000'`,
  `wide_gamut_jpeg_chroma='4:4:4'`, `sdr_jpeg_chroma='4:2:0'`,
  `force_srgb_derivatives='false'`, `allow_hdr_ingest='false'`, `force_show_color_chips='false'`
- **CLAUDE.md claim:** All of the above defaults
- **Result:** MATCHES

### 13. Key file paths (20 paths)
All 20 paths in the CLAUDE.md "Key Files & Patterns" table verified to exist on disk:
`actions/`, `db/schema.ts`, `lib/process-image.ts`, `lib/color-detection.ts`,
`lib/color-primaries.ts`, `lib/color-pipeline-decisions.ts`, `lib/icc-extractor.ts`,
`lib/icc-chromaticity.ts`, `lib/gain-map-detection.ts`, `lib/use-display-capability.ts`,
`lib/settings-hash.ts`, `lib/og-sanitize.ts`, `api/og/photo/[id]/route.tsx`,
`lib/hdr-filenames.ts`, `lib/data.ts`, `proxy.ts`, `lib/auth-rate-limit.ts`,
`[locale]/admin/db-actions.ts`, `api/admin/db/download/route.ts`, `site-config.json`
- **Result:** ALL EXIST

### 14. Nginx body size caps
- **Source:** `nginx/default.conf:31,58,75,92,132` —
  `2M` global, `64K` login, `250M` /admin/db, `216M` admin dashboard, `216M` LR upload
- **CLAUDE.md claim:** "2 MiB default, 64 KiB login, 250 MiB /admin/db, 216 MiB admin dashboard, 216 MiB LR upload"
- **Result:** MATCHES

### 15. ICC chromaticity ΔE thresholds
- **Source:** `icc-chromaticity.ts:27,30` — `HIGH_CONFIDENCE_TOLERANCE = 0.005`, `MEDIUM_CONFIDENCE_TOLERANCE = 0.015`
- **CLAUDE.md claim:** "ΔE ≤ 0.005 (high-confidence) or ≤ 0.015 (medium)"
- **Result:** MATCHES

---

## Additional Verifications (spot during traversal)

- **Argon2 params:** `memoryCost=65_536`, `timeCost=3`, `parallelism=4` — MATCHES CLAUDE.md
- **Blur placeholder size:** `resize(16, undefined, …)` — MATCHES "16px"
- **MAX_BLUR_DATA_URL_LENGTH = 4096** — MATCHES
- **HEAD_REVALIDATE_TIMEOUT_MS = 300** — MATCHES
- **SW 50 MB LRU image cap** (`MAX_IMAGE_BYTES = 50 * 1024 * 1024`) — MATCHES
- **SW HTML offline cache 50-entry cap** (`MAX_HTML_ENTRIES = 50`) — MATCHES
- **SW HTML TTL 24h** (`HTML_MAX_AGE_MS = 24 * 60 * 60 * 1000`) — MATCHES
- **Login rate limit:** 5 attempts / 15-min window (`LOGIN_MAX_ATTEMPTS=5`, `LOGIN_WINDOW_MS=15*60*1000`) — MATCHES
- **CLIP model:** `PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8'` — MATCHES
- **CLIP embedding:** `EMBEDDING_DIM=512`, `EMBEDDING_BYTES=512*4=2048` — MATCHES "2048-byte float32 vector"
- **DEFAULT_IMAGE_SIZES:** `[640, 1536, 2048, 4096, 5120, 7680]` (6 sizes) — MATCHES
- **QUEUE_CONCURRENCY default 1** (`Number(process.env.QUEUE_CONCURRENCY) || 1`) — MATCHES
- **ISOBMFF walker:** `MAX_DEPTH=5`, `MAX_SCAN_BYTES=1024*1024` — MATCHES "max box depth 5, max scan 1 MB"
- **OG_PHOTO_MAX_BYTES = 1024*1024** (1 MB, in `og-photo-fetch.ts:31`) — MATCHES
- **x-gk-admin-render header** (`proxy.ts:129`) — MATCHES
- **_SensitiveKeysInPublic** guard name (`data.ts:416`) — MATCHES CLAUDE.md
- **uploaded_by FK** `ON DELETE SET NULL` (`schema.ts:91-92`) — MATCHES

---

## Findings

**ZERO defects found.**

All 15 primary spot-checks and ~20 secondary verifications passed. Every concrete factual
claim examined — counts, default values, constant names, line numbers, enum mappings,
function names, file paths, and architectural facts — matches the source code exactly.

The codebase has converged. CLAUDE.md is accurate as of HEAD e34c04cf.

---

## Notes for future reviewers

- The backfill test fixture (`backfill-color-pipeline.test.ts:182-189`) lists 9 columns
  (the *signal-derived* set, excluding `pipeline_version`). CLAUDE.md lists 10 columns
  including `pipeline_version`. Both are correct: `pipeline_version` is updated in the
  same atomic UPDATE statement (sidecar `backfill-color-pipeline.ts:559`, in-app runner
  `admin-backfill-runner.ts:410`) but the test fixture only asserts on the signals subset.
  Not a defect.

- `original_width` and `original_height` are in `adminSelectFields` and are omitted only
  from `adminListSelectFields` (the lightweight admin grid query), NOT from
  `publicSelectFields`. These two columns ARE public. CLAUDE.md does not claim they are
  admin-only (they do not appear in the CLAUDE.md admin-only column table). Not a defect.
