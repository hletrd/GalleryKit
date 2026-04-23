# Comprehensive Code Review — Cycle 16 (2026-04-19)

**Scope:** Full deep review of all core source files in `apps/web/src/`. Covers code quality, security, performance, correctness, and architecture.

---

## NEW FINDINGS

### C16-01: `rateLimitBuckets.bucket_start` uses `bigint({ mode: 'number' })` which silently truncates values above 2^53 [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/db/schema.ts` line 138
- **Description**: The `bucket_start` column in `rateLimitBuckets` is defined as `bigint("bucket_start", { mode: 'number' })`. MySQL BIGINT stores up to 2^63-1, but JavaScript's `Number` type can only safely represent integers up to 2^53-1 (`Number.MAX_SAFE_INTEGER`). The `getRateLimitBucketStart()` function in `rate-limit.ts` produces unix seconds aligned to a window boundary. Current unix seconds (2026) are ~1,775,000,000 — well within safe integer range. However, if a corrupted or malicious DB value above 2^53 were inserted, it would be silently truncated on read, potentially causing rate limit bypass (the `eq()` check would never match the truncated value, so the bucket would appear empty).
- **Fix**: Change to `bigint({ mode: 'bigint' })` and handle BigInt explicitly in `getRateLimitBucketStart()`, or — since bucket_start is always a unix seconds timestamp that will never exceed 2^31 in our lifetime — change the column to `int` which is simpler and correct for the actual data domain.
- **Confidence**: MEDIUM — practical risk is near-zero for normal operation, but the type mismatch is real and could cause subtle bugs if the DB is corrupted.

### C16-02: `db-actions.ts` env passthrough to child process includes `LANG` and `LC_ALL` which could leak locale info [LOW] [LOW confidence]
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 121, 314
- **Description**: The `env` option for `spawn('mysqldump', ...)` and `spawn('mysql', ...)` passes `LANG: process.env.LANG, LC_ALL: process.env.LC_ALL`. While this is needed for proper character encoding in the dump output, these values could leak the server's locale configuration to a compromised child process. This is already flagged as a deferred item (CR-38-05) but worth re-confirming as still present.
- **Fix**: Already deferred (CR-38-05). No new action needed this cycle.
- **Confidence**: LOW — this is informational and already tracked.

### C16-03: `flushGroupViewCounts` re-buffers failed increments individually via `bufferGroupViewCount()` which applies the capacity cap per call — O(n) overhead for large failures [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/lib/data.ts` lines 54-58
- **Description**: When a group's view count increment fails, the code re-buffers it by calling `bufferGroupViewCount(groupId)` in a loop `count` times. Each call checks `viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE` and conditionally drops. For a group with a large accumulated count (e.g., 500 failed increments), this results in 500 individual function calls, each checking the cap. This is O(n) in the count value.
- **Fix**: Replace the loop with a direct Map.set that adds the count in one operation: `viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count)`, with a single capacity check. If at capacity and the group isn't already in the buffer, drop the entire batch.
- **Confidence**: MEDIUM — the performance impact is limited since `count` is typically small, but the pattern is unnecessarily expensive.

### C16-04: `updateImageMetadata` does not sanitize `title` and `description` for null bytes or control characters [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 480-524
- **Description**: The `updateImageMetadata` function validates length (`title.length > 255`, `description.length > 5000`) and trims the values, but does not strip null bytes (`\0`) or other control characters. A null byte in a title could cause truncation in MySQL (which terminates strings at `\0` in some contexts) or cause display issues in the UI. Other actions like `createTopic` validate via `isValidSlug()` which restricts to alphanumeric, but image titles have no such restriction.
- **Fix**: Add a sanitization step that strips null bytes and control characters from `title` and `description` before storing: `title?.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') || null`.
- **Confidence**: MEDIUM — MySQL typically handles null bytes fine with Drizzle's parameterized queries, but they can cause display issues and are almost never intentional.

### C16-05: `exportImagesCsv` holds up to 50K DB rows in memory before converting to CSV [LOW] [LOW confidence]
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 37-86
- **Description**: The CSV export loads up to 50,000 rows into memory, then builds a `csvLines` array of the same size, then joins them. At peak, both arrays coexist briefly before `results` is cleared. This is already tracked as deferred (PERF-38-02) and the code does release `results` before joining. Worth re-confirming as still present.
- **Fix**: Already deferred (PERF-38-02). Streaming the CSV to a temp file would reduce peak memory.
- **Confidence**: LOW — already tracked.

### C16-06: `processImageFormats` creates a new Sharp instance per format via `image.clone()` but the base `image` is never explicitly finalized/released [LOW] [LOW confidence]
- **File**: `apps/web/src/lib/process-image.ts` lines 327-405
- **Description**: The function creates a `sharp(inputPath)` instance, then calls `image.clone().resize(...)` for each size and format. While `clone()` shares the input buffer, the base `image` instance is never explicitly cleaned up. Sharp instances hold file descriptors open until garbage collection. In the processing queue (concurrency 2), two concurrent jobs each open 3 format pipelines = 6 Sharp instances, each holding a file descriptor to the original file. This is typically fine but could cause fd exhaustion under extreme load.
- **Fix**: Consider calling `image.destroy()` (if available in the Sharp API) after all `clone()` operations complete, or rely on GC. This is informational — Sharp's internal lifecycle management typically handles this.
- **Confidence**: LOW — Sharp manages its own resources reasonably well.

### C16-07: `searchImages` in `data.ts` uses `notInArray` which can produce very large SQL for the tag-search fallback when the main query returns many results [LOW] [LOW confidence]
- **File**: `apps/web/src/lib/data.ts` lines 628-630
- **Description**: When the main search returns many results, `mainIds` is passed to `notInArray(images.id, mainIds)` for the tag-search fallback. If `effectiveLimit` is 100 and the main query returns 100 results, this generates `NOT IN (1, 2, 3, ..., 100)`. While Drizzle/MySQL handles this, it's not the most efficient approach for large exclusion sets. A temporary table or LEFT JOIN exclusion would scale better.
- **Fix**: Informational — the limit is capped at 100, so the SQL is bounded. No action needed unless the search limit is increased.
- **Confidence**: LOW — current limits make this acceptable.

### C16-08: `db-actions.ts` restore validates SQL header but the `containsDangerousSql` check can be bypassed by splitting dangerous statements across chunk boundaries [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 275-293
- **Description**: The restore function scans the SQL dump in 1MB chunks with 256 bytes of overlap. While the overlap helps, a carefully crafted SQL dump could split a dangerous keyword (e.g., `DROP TABLE`) across the chunk boundary such that neither chunk contains the full keyword. The 256-byte overlap mitigates this for keywords shorter than 256 bytes, but multi-line statements with comments or whitespace interleaved could evade detection.
- **Fix**: This is an inherent limitation of chunk-based scanning. The advisory lock and admin auth requirement make exploitation very unlikely. Consider documenting this limitation or increasing overlap to 1KB for better coverage.
- **Confidence**: MEDIUM — the 256-byte overlap covers most practical cases, but the theoretical bypass exists.

---

## PREVIOUSLY FIXED — Confirmed Still Resolved

All cycle 1-15 findings remain resolved. No regressions detected. Key items re-verified this cycle:

- C14-01 (processImageFormats atomic rename): Still uses `.tmp` file pattern. Confirmed fixed.
- C14-02 (findNearestImageSize empty array): Still returns largest default. Confirmed fixed.
- C14-03 (dirty field tracking in SEO/settings): Still uses `initialRef` comparison. Confirmed fixed.
- C14-04 (lightbox JPEG fallback): Still uses medium-sized variant. Confirmed fixed.
- C15-01 (bigint mode mismatch for original_file_size): Schema now uses `int('original_file_size')` — confirmed fixed.
- Download route security: regex + containment + symlink + admin auth — confirmed.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain with no change in status (see Plan 125 and cycle 15 deferred items):

- C6R2-F01 through C6R2-F14: Storage backend integration and related items (HIGH/LOW)
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: passwordChangeRateLimit shares LOGIN_RATE_LIMIT_MAX_KEYS cap
- C30-03 / C36-03: flushGroupViewCounts re-buffers without retry limit
- C30-04 / C36-02: createGroupShareLink insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: db-actions.ts env passthrough overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: uploadTracker uses insertion-order eviction, not LRU
- CR-38-06: photo-viewer.tsx Histogram null-safety
- PERF-38-02: exportImagesCsv loads up to 50K rows into memory
- ARCH-38-03: data.ts is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- UX-13-02: Upload dropzone uses native `<select>` inconsistent with shadcn Select
- C4-F02 / C6-F04: Admin checkboxes use native `<input>`
- C4-F03: isReservedTopicRouteSegment rarely used
- C4-F05: loadMoreImages offset cap may allow expensive tag queries
- C4-F06: processImageFormats creates 3 sharp instances (informational)
- C6-F03: Missing E2E tests for upload pipeline

---

## TOTALS

- **2 MEDIUM** findings (C16-01: bigint mode for bucket_start, C16-04: null bytes in image metadata, C16-08: SQL scan bypass)
- **5 LOW** findings (C16-02, C16-03, C16-05, C16-06, C16-07)
- **0 CRITICAL/HIGH** findings
- **8 total** new findings
