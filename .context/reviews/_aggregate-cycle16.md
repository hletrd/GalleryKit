# Aggregate Review — Cycle 16 (2026-04-19)

**Source reviews:** Comprehensive deep review of all key source files (single-reviewer cycle)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## NEW FINDINGS

### C16-01: `rateLimitBuckets.bucket_start` uses `bigint({ mode: 'number' })` — potential silent truncation [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/db/schema.ts` line 138
- **Description**: The `bucket_start` column uses `bigint({ mode: 'number' })`. While current unix-second values are well within safe integer range, a corrupted DB value above 2^53 would be silently truncated on read, potentially causing rate limit bypass. The same class of issue as C15-01 (which was fixed by changing `original_file_size` to `int`).
- **Fix**: Change column to `int` since bucket_start is always a unix-seconds timestamp that will never exceed 2^31 in our lifetime.

### C16-02: `db-actions.ts` env passthrough includes `LANG` and `LC_ALL` [LOW] [LOW confidence]
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 121, 314
- **Description**: Already tracked as deferred CR-38-05. No new action needed.

### C16-03: `flushGroupViewCounts` re-buffers failed increments individually — O(n) overhead [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/lib/data.ts` lines 54-58
- **Description**: Failed increments are re-buffered by calling `bufferGroupViewCount(groupId)` in a loop `count` times. Each call checks the capacity cap. Should be a single Map.set with the full count.
- **Fix**: Replace loop with `viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count)` with a single capacity check.

### C16-04: `updateImageMetadata` does not sanitize null bytes or control characters [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 480-524
- **Description**: Title and description are length-validated and trimmed but not stripped of null bytes (`\0`) or control characters. Null bytes can cause truncation in MySQL and display issues in the UI.
- **Fix**: Add sanitization: `title?.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') || null` and same for description.

### C16-05: `exportImagesCsv` holds up to 50K rows in memory [LOW] [LOW confidence]
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 37-86
- **Description**: Already tracked as deferred PERF-38-02. No new action needed.

### C16-06: Base Sharp instance in `processImageFormats` never explicitly released [LOW] [LOW confidence]
- **File**: `apps/web/src/lib/process-image.ts` lines 327-405
- **Description**: The base `sharp(inputPath)` instance is never explicitly cleaned up after `clone()` operations. Sharp manages its own resources, but file descriptors remain open until GC.
- **Fix**: Informational — no action needed.

### C16-07: `searchImages` uses `notInArray` with potentially large exclusion set [LOW] [LOW confidence]
- **File**: `apps/web/src/lib/data.ts` lines 628-630
- **Description**: When main search returns many results, `notInArray` generates large SQL. Bounded by limit of 100.
- **Fix**: Informational — no action needed at current limits.

### C16-08: SQL restore scan can be bypassed by splitting dangerous statements across chunk boundaries [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 275-293
- **Description**: The 256-byte overlap in chunk-based scanning could be bypassed by carefully crafted SQL dumps. The advisory lock and admin auth requirement make exploitation unlikely.
- **Fix**: Consider increasing overlap to 1KB or documenting this limitation.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-15 findings remain resolved. No regressions detected. Key items re-verified:
- C14-01 (processImageFormats atomic rename): Still uses `.tmp` file pattern. Confirmed fixed.
- C14-02 (findNearestImageSize empty array): Still returns largest default. Confirmed fixed.
- C14-03 (dirty field tracking in SEO/settings): Still uses `initialRef` comparison. Confirmed fixed.
- C14-04 (lightbox JPEG fallback): Still uses medium-sized variant. Confirmed fixed.
- C15-01 (bigint mode for original_file_size): Schema now uses `int('original_file_size')`. Confirmed fixed.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged (19+ items from cycles 5-15). See Plan 125 and cycle 15 deferred items for the full list.

---

## AGENT FAILURES

None — direct review completed successfully.

---

## TOTALS

- **3 MEDIUM** findings (C16-01, C16-04, C16-08)
- **5 LOW** findings (C16-02, C16-03, C16-05, C16-06, C16-07)
- **0 CRITICAL/HIGH** findings
- **8 total** new findings
