# Run-9 Cycle-5 Debugger Analysis

**HEAD:** e34c04cf  
**Date:** 2026-06-21  
**Scope:** Re-spot-check all previously adjudicated modules + first-time deep examination of sql-restore-scan.ts, process-image.ts, image-queue.ts, serve-upload.ts, blur-data-url.ts, exif-datetime.ts, validation.ts, rate-limit.ts, bounded-map.ts

---

## 1. Re-Spot-Check: Previously Adjudicated BENIGN Modules

All protections verified intact at HEAD.

### gps-exif-strip.ts
- `MAX_IFD_CHAIN = 8`, `MAX_IFD_ENTRIES = 1024` — unchanged
- `visited` Set prevents IFD cycles: `if (visited.has(ifdAbs)) return null`
- TIFF value size: `typeSize * valueCount` stays in float64 range (max 8 × 0xFFFFFFFF ≈ 34B); `inBounds` catches the result since it compares against `buf.length` (≤ 200 MB upload cap)
- ISOBMFF: `itemCount > 4096` and `extentCount > 64` caps in place
- **Status: BENIGN**

### icc-extractor.ts
- `tagCount = Math.min(icc.readUInt32BE(128), 100)` — cap present
- `strLen = Math.min(declaredLength, dataSize - 12, 1024)` — triple-min cap
- `numRecords = Math.min(icc.readUInt32BE(dataOffset + 8), 100)` — cap
- `recordSize < 12` → break prevents zero-stride loop
- Wrapped in try/catch
- **Status: BENIGN**

### icc-chromaticity.ts
- `MAX_TAG_COUNT = 100`, `MAX_TAG_TABLE_BYTES = 4096` — present
- `invert3x3`: `Math.abs(det) < 1e-12` → null guard — present
- All XYZ/chad tag size guards intact
- `Number.isFinite` checks on all reads
- **Status: BENIGN**

### gain-map-detection.ts
- `MAX_DEPTH = 5`, `MAX_SCAN_BYTES = 1024 * 1024` — present
- `parsed < 1024` caps on iinf/iref entries — present
- 64-bit size `BigInt(Number.MAX_SAFE_INTEGER)` guard — present
- Wrapped in try/catch
- **Status: BENIGN**

### color-detection.ts
- NCLX walker: `MAX_DEPTH = 5`, `MAX_SCAN_BYTES = 1024 * 1024` — present
- 1 MB header buffer read; only `bytesRead` bytes decoded
- NCLX code 2 ("Unspecified") absent from all maps — does not clobber ICC-derived values
- ICC chromaticity applied only when `colorPrimaries === 'unknown'`
- **Status: BENIGN**

---

## 2. First-Time Deep Examination

### sql-restore-scan.ts

**DEFECT FOUND — MED confidence — OPERATIONAL DEFECT**

#### Description

`APP_BACKUP_TABLES` (line 2–15) is the allowlist for `DROP TABLE IF EXISTS` statements in uploaded backup files. It contains the 12 tables that existed when the scanner was written (last updated 2026-04-30). Six tables were added to the schema after that date (all on 2026-05-03):

- `admin_tokens` (migration 0006)
- `smart_collections` (migration 0009)
- `image_views` (migration 0010)
- `topic_views` (migration 0010)
- `shared_group_views` (migration 0010)
- `image_embeddings` (migration 0012)

**Root cause:** `APP_BACKUP_TABLES` in `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/sql-restore-scan.ts:2–15` was never updated when these six tables were added.

#### Trigger / reproduction

A `mysqldump` of the current production database emits `DROP TABLE IF EXISTS \`admin_tokens\`;` (and five similar lines for the other missing tables) because mysqldump's default `--add-drop-table` is on. When an admin uploads this backup for restore via the admin dashboard, `containsDangerousSql()` is called on each 1 MB chunk. The `ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN` regex does NOT match `admin_tokens` (it is not in the allowlist), so the text passes through to the `\bDROP\s+TABLE\b/i` pattern check, which fires — causing the restore to be rejected with `disallowedSql`.

Confirmed by simulation:
```
BLOCKED "DROP TABLE IF EXISTS `admin_tokens`;"
BLOCKED "DROP TABLE IF EXISTS `image_views`;"
BLOCKED "DROP TABLE IF EXISTS `topic_views`;"
BLOCKED "DROP TABLE IF EXISTS `shared_group_views`;"
BLOCKED "DROP TABLE IF EXISTS `image_embeddings`;"
BLOCKED "DROP TABLE IF EXISTS `smart_collections`;"
ALLOWED "DROP TABLE IF EXISTS `images`;"  (allowlisted — correct)
```

#### Reachability

Directly reachable from the admin DB restore flow:
- `apps/web/src/app/[locale]/admin/db-actions.ts:424–426` — calls `appendSqlScanChunk` + `containsDangerousSql` on every 1 MB chunk of the uploaded file.

An admin attempting to restore a production backup (which is the entire point of the feature) gets a `disallowedSql` error and the restore is silently aborted. The backup file is deleted (`unlink(tempPath)`). No data corruption — but the restore feature is broken for any backup taken from the current schema.

#### Classification

- **DEFECT** (not POLISH): the feature is non-functional for its primary use case — restoring a backup of the current production database.
- Severity: **MED** — affects operational recoverability, but no security boundary is broken. An attacker cannot exploit this (the scanner rejects more than intended, not less).

#### Minimal fix

Add the six missing tables to `APP_BACKUP_TABLES` at `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/sql-restore-scan.ts:2–15`:

```typescript
const APP_BACKUP_TABLES = [
    'admin_settings',
    'admin_users',
    'admin_tokens',        // added migration 0006
    'audit_log',
    'image_embeddings',    // added migration 0012
    'image_tags',
    'image_views',         // added migration 0010
    'images',
    'rate_limit_buckets',
    'sessions',
    'shared_group_images',
    'shared_groups',
    'shared_group_views',  // added migration 0010
    'smart_collections',   // added migration 0009
    'tags',
    'topic_aliases',
    'topic_views',         // added migration 0010
    'topics',
] as const;
```

Lines changed: 6 insertions, 0 deletions. No logic change — purely an allowlist extension.

**Verification:** After fix, run the existing test:
```
containsDangerousSql('DROP TABLE IF EXISTS `admin_tokens`;') === false
```
And all six new table names, plus confirm the existing `unknown_table` test still returns `true`.

#### Similar pattern risk

`APP_BACKUP_TABLES` is a static list with no compile-time guard linking it to the Drizzle schema. The same gap will reopen the next time a table is added. Consider adding a test that imports both `APP_BACKUP_TABLES` (exported, or tested via the pattern) and `schema.ts` table names and asserts they are a superset — similar to the `SENSITIVE_KEYS` fixture in `privacy-fields.test.ts`.

---

### process-image.ts (1650 lines — hottest path)

All critical safety controls verified intact:
- `limitInputPixels` passed on every `sharp(...)` constructor call (lines 835, 1019, 1035, 1123, 1126, 1608)
- `failOn: 'error'` on every instance — truncated/corrupt files rejected
- `sequentialRead: true` — prevents seeking on non-seekable streams
- `autoOrient: true` — prevents orientation-based OOM
- `WIDE_GAMUT_MAX_SOURCE_PIXELS` (default 50M) caps rgb16 fan-out OOM risk
- `canUseHighBitdepthAvif()` is a Promise singleton (no race) — retry distinguishes permanent vs transient failures
- `isTransientError` + `isBitdepthRejection` separation correct
- `verifyAvifNclxInBuffer` is audit-only, never throws to pipeline
- **Status: BENIGN**

### image-queue.ts

All error handling and retry maps verified:
- `MAX_RETRY_MAP_SIZE = 10000`, `MAX_PERMANENTLY_FAILED_IDS = 1000` — caps present
- `pruneRetryMaps` collects-then-deletes (correct pattern, no modification-during-iteration)
- `MAX_RETRIES = 3`, `MAX_CLAIM_RETRIES = 10` — bounded
- Delete-during-processing race guard: conditional UPDATE checks `affectedRows`
- Orphan file cleanup via `deleteImageVariants` on `0` affectedRows
- **Status: BENIGN**

### serve-upload.ts

All path traversal protections verified:
- `ALLOWED_UPLOAD_DIRS = new Set(['jpeg', 'webp', 'avif'])` — whitelist
- `SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/` — rejects path separators
- `MAX_SEGMENT_LENGTH = 255`
- `lstat()` + `isSymbolicLink()` check before read
- `realpath()` + `startsWith(resolvedRoot + sep)` containment check
- `createReadStream(resolvedPath)` — reads the realpath, not original (closes TOCTOU)
- AbortSignal wiring for fd cleanup on client abort
- DIR_EXTENSION_MAP: mismatched extension/directory rejected (400)
- **Status: BENIGN**

### blur-data-url.ts

- `isSafeBlurDataUrl`: allows only `data:image/{jpeg,png,webp};base64,` prefixes
- `MAX_BLUR_DATA_URL_LENGTH = 4096` — caps SSR payload
- Throttled rejection log (bounded LRU 256 keys) prevents stderr flood on poisoned DB restore
- **Status: BENIGN**

### exif-datetime.ts

- Regex `^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$` — strict anchored match
- Range checks: year 1900–2100, month 1–12, day 1–31, hour 0–23, min/sec 0–59
- Constructive validation: `Date.UTC(...)` round-trip check catches invalid combinations (e.g. Feb 30)
- `timeZone: 'UTC'` prevents locale-dependent formatting
- **Status: BENIGN**

### validation.ts

- `UNICODE_FORMAT_CHARS` derived once, not `/g` flagged — no `lastIndex` state pollution on `.test()` calls
- `UNICODE_FORMAT_CHARS_GLOBAL` is a freshly constructed `new RegExp(source, 'g')` — isolated from the test-only pattern, correct
- `safeInsertId`: BigInt overflow checked before coercion; negative/non-finite number caught
- `isValidTopicAlias`: uses `countCodePoints()` for CJK/emoji length (not `.length`)
- **Status: BENIGN**

### rate-limit.ts

- `getClientIp`: `TRUST_PROXY` guard prevents X-Forwarded-For spoofing in untrusted deploys
- `xForwardedFor.length <= 512` — prevents arbitrarily long header DoS
- `normalizeIp`: bracketed IPv6 + IPv4-with-port parsing correct; `isIP()` validates output
- `getRateLimitBucketStart`: uses `Math.floor` consistently; non-finite `windowMs` would produce NaN but callers use hardcoded constants
- `decrementRateLimit`: uses `GREATEST(count - 1, 0)` to prevent underflow, then deletes zero rows in transaction
- **Status: BENIGN**

### bounded-map.ts

- `prune()`: collects expired keys before deleting (correct — avoids mutation-during-iteration)
- Hard cap eviction: collects excess keys before deleting
- `createResetAtBoundedMap`: `entry.resetAt <= now` (correct: expired when reset time has passed)
- `createWindowBoundedMap`: `now - entry.lastAttempt > windowMs` (correct)
- **Status: BENIGN**

---

## Summary

| Module | Status | Finding |
|--------|--------|---------|
| gps-exif-strip.ts | BENIGN | All protections intact at HEAD |
| icc-extractor.ts | BENIGN | All caps and bounds intact |
| icc-chromaticity.ts | BENIGN | invert3x3 guard, finite checks intact |
| gain-map-detection.ts | BENIGN | MAX_DEPTH/MAX_SCAN intact, try/catch |
| color-detection.ts | BENIGN | All walker caps intact |
| sql-restore-scan.ts | **DEFECT** | APP_BACKUP_TABLES missing 6 tables added post-2026-04-30; DB restore breaks for current schema backups |
| process-image.ts | BENIGN | limitInputPixels, failOn, singleton probe all intact |
| image-queue.ts | BENIGN | Retry caps, orphan cleanup, delete-race guard intact |
| serve-upload.ts | BENIGN | Path traversal, symlink, TOCTOU all guarded |
| blur-data-url.ts | BENIGN | Prefix whitelist + length cap intact |
| exif-datetime.ts | BENIGN | Strict regex + constructive Date validation |
| validation.ts | BENIGN | No /g on test(), countCodePoints for unicode, safeInsertId guards |
| rate-limit.ts | BENIGN | TRUST_PROXY guard, header length cap, GREATEST underflow guard |
| bounded-map.ts | BENIGN | Correct collect-then-delete, hard cap eviction |

**VERDICT: one actionable DEFECT — `APP_BACKUP_TABLES` in `sql-restore-scan.ts:2-15` is missing 6 tables added since 2026-04-30; restoring a current-schema production backup is erroneously blocked by the DROP TABLE scanner.**
