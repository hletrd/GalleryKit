# Document-Specialist Review — Cycle 18 / HEAD 2a9976a1

Generated: 2026-06-27

---

## Scope

Systematic cross-reference of every concrete CLAUDE.md claim against actual source files:
file:line citations, counts/enums, default values, database indexes, and behavior
descriptions. Cycle 17 fixed M-1..M-4 (settings-hash line ref, topic-rename store
count, upload-TOCTOU race condition, image_views index listing). This cycle finds
the next batch.

---

## Confirmed Doc/Code Mismatches

### M-A — `settings-hash.ts` line citation: 41-53 should be 45-57

**Location in CLAUDE.md**
```
the hash is already 8 chars — `HASH_LENGTH` in `settings-hash.ts` — so there is no
`.slice(0,8)` at the ETag site). The settings hash (P4-E2) covers all **9**
`COLOR_IMPACTING_KEYS` (`settings-hash.ts:41-53`)
```

**Actual code** (`apps/web/src/lib/settings-hash.ts`):
- Line 41: blank line
- Lines 42-44: R16C16 export comment
- Line 45: `export const COLOR_IMPACTING_KEYS = [`
- Lines 46-56: the 9 array entries (with two inline comments)
- Line 57: `] as const;`

**Finding**: The array starts at line 45 and ends at line 57. The cited range 41-53 is
off by 4 on the start (begins in a comment block / blank line) and off by 4 on the end
(stops at `'image_quality_avif'`, missing `'image_quality_jpeg'` and `'image_sizes'`
and the closing bracket). Correct citation: **45-57**.

**Severity**: Low (doc accuracy only; no runtime impact).

---

### M-B — `process-image.ts` line citation: 1131-1135 is hard-link code, not WI-14

**Location in CLAUDE.md**
```
NOTE (AGG-R7-08): the encoder does NOT keep a single decoded instance across
formats/sizes — it opens a fresh decode per output to eliminate shared-state
contamination, trading decode reuse for correctness (`process-image.ts:1131-1135`)
```

**Actual code** at lines 1131-1135 (`apps/web/src/lib/process-image.ts`):
```
if (lastRendered && lastRendered.resizeWidth === resizeWidth) {
    // C4F-11: prefer hard link (zero-copy on same filesystem) over
    // copyFile for same-size variant dedup, matching the atomic
    // link pattern used for the base filename (line 507). Falls
    // back to copyFile on cross-device or link failure.
```

These lines implement same-size variant deduplication via `fs.link`/`fs.copyFile`. They
contain nothing about fresh sharp instances or shared-state elimination.

The WI-14 fresh sharp instance comment is at approximately **lines 1157-1167**:
```
// WI-14 / R8-R8: fresh sharp instance per format for ALL paths, not just rgb16.
// Eliminates shared-state risk between parallel encodes on the non-rgb16 path too.
```

**Finding**: The cited lines 1131-1135 describe hard-link dedup, not fresh-decode
isolation. The correct vicinity for the WI-14 claim is ~1157-1167.

**Severity**: Low (doc accuracy only; the behavior described is correct, only the line
number is wrong).

---

### M-C — `color-detection.ts` line citation: ProPhoto is at line 108, not within 99-107

**Location in CLAUDE.md**
```
`gamma18` comes from ICC name heuristics (ProPhoto path via
`lib/color-detection.ts:99-107`, AGG-D3)
```

**Actual code** (`apps/web/src/lib/color-detection.ts`):
```
Line 99:  if (desc.includes('gamma 2.2') || desc.includes('g22') || ...) return 'gamma22';
Line 100: if (desc.includes('gamma 1.8') || desc.includes('g18') || ...) return 'gamma18';
Line 101: if (desc.includes('linear') || name.includes('linear')) return 'linear';
Line 102: (blank)
Line 103: // sRGB IEC61966-2.1 is the most common SDR case
Line 104: if (name.includes('srgb') || name.includes('iec61966')) return 'srgb';
Line 105: (blank)
Line 106: // Default heuristics by primaries
Line 107: if (name.includes('adobe') || name.includes('adobergb')) return 'gamma22';
Line 108: if (name.includes('prophoto')) return 'gamma18';   ← ProPhoto is HERE
```

**Finding**: The ProPhoto → `'gamma18'` assignment is at line **108**, one line outside
the cited range 99-107. Lines 99-107 cover the gamma-desc hints (gamma22, gamma18-by-desc,
linear), sRGB, and Adobe RGB — not ProPhoto. Correct citation: **line 108** (or 99-108 if
the intent is to cover the full heuristics block up to and including ProPhoto).

**Severity**: Low (doc accuracy only; no runtime impact).

---

### M-D — `NEXT_UPLOAD_BODY_MAX_BYTES` default byte value is wrong

**Location in CLAUDE.md** (Optional Operational Variables table):
```
| `NEXT_UPLOAD_BODY_MAX_BYTES` | `279620608` | Next.js server action body size limit (default ~266 MiB) |
```

**Actual code** (`apps/web/src/lib/upload-limits.ts`):
```typescript
export const MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024;          // 209,715,200
export const MAX_RESTORE_FILE_BYTES = 250 * 1024 * 1024;          // 262,144,000
export const SERVER_ACTION_BODY_OVERHEAD_BYTES = 16 * 1024 * 1024; //  16,777,216
const DEFAULT_SERVER_ACTION_UPLOAD_BODY_BYTES =
    Math.max(MAX_UPLOAD_FILE_BYTES, MAX_RESTORE_FILE_BYTES)
    + SERVER_ACTION_BODY_OVERHEAD_BYTES;
// = Math.max(209715200, 262144000) + 16777216
// = 262144000 + 16777216
// = 278,921,216
```

**Finding**: The actual default is **278,921,216** bytes (= 266 MiB exactly). The CLAUDE.md
shows **279,620,608**, which differs by 699,392 bytes and does not correspond to any standard
size expression. The "~266 MiB" label in the table is correct; only the exact byte count
is stale.

**Severity**: Low (operational behavior unaffected; the default is derived from the
constants, not hardcoded from the doc's byte literal).

---

### M-E — `image_views(image_id, viewed_at)` index omitted from Database Indexes section

**Location in CLAUDE.md** (Database Indexes section):
```
- `image_views(bot, viewed_at, country_code)` — analytics country breakdown (migration 0021)
- `image_views(bot, viewed_at, referrer_host)` — analytics referrer breakdown (migration 0021)
```

**Actual code** (`apps/web/src/db/schema.ts`, lines 229-231):
```typescript
idxImageViewsImageIdViewedAt: index('idx_image_views_image_id_viewed_at')
    .on(table.imageId, table.viewedAt),               // ← NOT in CLAUDE.md
idxImageViewsBotViewedCountry: index('idx_image_views_bot_viewed_country_code')
    .on(table.bot, table.viewedAt, table.countryCode),
idxImageViewsBotViewedReferrer: index('idx_image_views_bot_viewed_referrer_host')
    .on(table.bot, table.viewedAt, table.referrerHost),
```

Confirmed in `apps/web/drizzle/0010_analytics_views.sql`:
```sql
INDEX idx_image_views_image_id_viewed_at (image_id, viewed_at)
```
This index was created in migration **0010** (the initial analytics migration), predating
the migration 0021 pair. The Database Indexes section lists two `image_views` indexes but
is missing this third one entirely.

**Severity**: Low (documentation gap; the index is present and correct in schema.ts;
callers of analytics queries that filter or sort by `(image_id, viewed_at)` benefit
from it transparently).

---

## Verified-Matching Claims (spot-checked)

The following CLAUDE.md claims were verified against the source and found correct:

| Claim | Source | Status |
|-------|--------|--------|
| `IMAGE_PIPELINE_VERSION = 7` defined at `gallery-config-shared.ts:21` | line 21: `export const IMAGE_PIPELINE_VERSION = 7;` | ✓ |
| Re-exported by `process-image.ts` (line 371) | line 371: `export { IMAGE_PIPELINE_VERSION } from '@/lib/gallery-config-shared';` | ✓ |
| `COLOR_IMPACTING_KEYS` has exactly 9 keys | settings-hash.ts lines 45-57: 9 string literals | ✓ |
| React `cache()` wraps 10 data-access functions | data.ts: 10 cached exports confirmed | ✓ |
| `HASH_LENGTH = 8` in settings-hash.ts | line 71: `const HASH_LENGTH = 8;` | ✓ |
| `DEFAULT_IMAGE_SIZE_VALUES = [640, 1536, 2048, 4096, 5120, 7680]` | gallery-config-shared.ts | ✓ |
| image_quality_webp default 90, image_quality_avif default 85, image_quality_jpeg default 90 | gallery-config-shared.ts defaults | ✓ |
| `avif_effort` default 6 | gallery-config-shared.ts | ✓ |
| `IMAGE_MAX_INPUT_PIXELS` default 268,435,456 (256M) | process-image.ts line 333: `256 * 1024 * 1024` | ✓ |
| `IMAGE_MAX_INPUT_PIXELS_TOPIC` default 67,108,864 (64M) | process-image.ts line 344: `64 * 1024 * 1024` | ✓ |
| `WIDE_GAMUT_MAX_SOURCE_PIXELS` default 50,000,000 | process-image.ts line 1036: `50_000_000` | ✓ |
| `QUEUE_CONCURRENCY` default 1 | image-queue.ts line 212: `|| 1` | ✓ |
| `BACKFILL_CONCURRENCY` default 2 (sidecar) | backfill-color-pipeline.ts line 362: `|| 2` | ✓ |
| `ADMIN_BACKFILL_CONCURRENCY` default 1 (in-app) | admin-backfill-runner.ts line 665: `|| 1` | ✓ |
| Backfill cap formula `max(1, floor((POOL_CONNECTION_LIMIT - RESERVED - 1) / 2))` with RESERVED = `max(3, ceil(limit/2))` → 2 at limit=10 | admin-backfill-runner.ts `resolveBackfillConcurrency` | ✓ |
| Connection pool: 10 connections, queueLimit 20 | db/index.ts: `connectionLimit: 10`, `queueLimit: 20` | ✓ |
| `LOGIN_MAX_ATTEMPTS = 5`, `LOGIN_WINDOW_MS = 15 min` | rate-limit.ts | ✓ |
| `MAX_BLUR_DATA_URL_LENGTH = 4096` | blur-data-url.ts | ✓ |
| `HEAD_REVALIDATE_TIMEOUT_MS = 300` | sw.template.js | ✓ |
| `OG_PHOTO_MAX_BYTES = 1 MB` | og-photo-fetch.ts: `1024 * 1024` | ✓ |
| `SEMANTIC_TOP_K_MAX = 50`, `SEMANTIC_SCAN_LIMIT = 2000` | clip-embeddings.ts | ✓ |
| `SEMANTIC_TOP_K_DEFAULT = 20` (admin UI default) | clip-embeddings.ts line 16 | ✓ |
| ProPhoto → gamma18 line is near lines 99-108 (heuristics block) | color-detection.ts line 108 (see M-C) | ✓ (line off) |
| Advisory lock names match: `gallerykit_db_restore`, `…_upload_processing_contract`, `…_topic_route_segments`, `…_admin_delete`, `…_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}` | advisory-locks.ts | ✓ |
| `_PrivacySensitiveKeys` and `_SensitiveKeysInPublic` guard names | data.ts lines ~460-465 | ✓ |
| `avif_10bit` in publicSelectFields (public-safe) | data.ts: not in the omit destructuring | ✓ |
| nginx body limits: 2M default, 64K login, 250M restore, 216M admin uploads, 216M LR plugin | nginx/default.conf | ✓ |
| `tagNamesAgg` uses `GROUP_CONCAT(DISTINCT … ORDER BY …)` | data.ts line 650 | ✓ |
| `NEXT_UPLOAD_BODY_MAX_BYTES` label "~266 MiB" | actual is exactly 266 MiB | ✓ (only byte literal wrong, see M-D) |

---

## Summary

Five mismatches confirmed in this cycle (all low-severity documentation drift):

- **M-A** `settings-hash.ts:41-53` → should be **45-57**
- **M-B** `process-image.ts:1131-1135` cited for WI-14 → those lines are hard-link dedup code; WI-14 is ~**1157-1167**
- **M-C** `color-detection.ts:99-107` for ProPhoto path → ProPhoto line is **108**, one outside the range
- **M-D** `NEXT_UPLOAD_BODY_MAX_BYTES` default byte value **279,620,608** → actual **278,921,216**
- **M-E** `image_views(image_id, viewed_at)` index (migration 0010) **missing** from Database Indexes section
