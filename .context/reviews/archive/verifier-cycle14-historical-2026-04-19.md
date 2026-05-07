# Verifier — Cycle 14

## Review Scope

Evidence-based correctness check against stated behavior, invariants, and documented claims. All source files under `apps/web/src/` examined. Cross-file interactions analyzed. Findings from cycle 13 and earlier are excluded if already reported and unfixed (deferred items).

## New Findings

### VER-14-01: `deleteImageVariants` in image-queue cleanup uses default sizes, not configured sizes [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/lib/image-queue.ts` lines 217–221
- **Description:** When an image is deleted during processing (detected via `affectedRows === 0`), the cleanup code calls `deleteImageVariants` without passing the configured `imageSizes`, falling back to `DEFAULT_OUTPUT_SIZES` from `gallery-config-shared.ts`. However, the same file's processing path (line 180) correctly reads admin-configured sizes via `getGalleryConfig()`. If an admin has changed `image_sizes` from the defaults, the cleanup will only delete the default-sized variants, leaving admin-configured variant files orphaned on disk.
- **Evidence:** Compare line 180 (`imageSizes = config.imageSizes.length > 0 ? config.imageSizes : undefined`) with lines 218–220 (`deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp)` — no `sizes` argument, defaults to `DEFAULT_OUTPUT_SIZES`). The `deleteImage` action in `actions/images.ts` correctly passes configured sizes (line 350), but the queue cleanup does not.
- **Concrete mismatch:** If admin configured `image_sizes = [800, 1600, 3200]`, processing generates `_800`, `_1600`, `_3200` variants. On delete-during-processing, cleanup only removes `_640`, `_1536`, `_2048`, `_4096` variants — the actual files remain orphaned.
- **Suggested fix:** Pass the `imageSizes` variable (already resolved earlier in the same function at line 180) to the `deleteImageVariants` calls at lines 218–220.
- **Confidence:** HIGH

### VER-14-02: `selectFields` comment says "admin-facing queries" but `publicSelectFields` is an alias, not a subset [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/lib/data.ts` lines 87–134
- **Description:** The comment on line 87 states `selectFields` "is used by admin-facing queries" and "MUST NOT include latitude, longitude, filename_original, or user_filename." However, `publicSelectFields` (line 134) is defined as `const publicSelectFields = selectFields;` — an identical reference, not a restricted subset. The code comment implies `selectFields` contains more fields than `publicSelectFields`, but they are the same object. This is not a bug (the compile-time guard ensures no sensitive fields are in either), but the comment is misleading: it suggests a two-tier model that doesn't exist.
- **Evidence:** Line 134: `const publicSelectFields = selectFields;` — same reference. There is no admin-specific field set that includes `filename_original`, `user_filename`, `latitude`, or `longitude` anywhere in the codebase (grep for `adminSelectFields` returns zero results). The CLAUDE.md documents `adminSelectFields` as providing "full data only to authenticated admin routes," but no such variable exists.
- **Concrete mismatch:** CLAUDE.md states "`adminSelectFields` provides full data only to authenticated admin routes." No `adminSelectFields` export or definition exists. Admin routes that need full data (e.g., upload flow in `actions/images.ts`) select directly from the table rather than using a shared field set.
- **Suggested fix:** Either (a) create a true `adminSelectFields` that includes `filename_original`, `user_filename`, `latitude`, `longitude` for admin-only queries, or (b) update CLAUDE.md and the code comment to accurately reflect that `selectFields` is the only field set (used for both public and admin queries with sensitive fields excluded), and admin routes needing full data query the table directly.
- **Confidence:** MEDIUM

### VER-14-03: `processTopicImage` temp file not cleaned up on `sharp()` construction error [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/lib/process-topic-image.ts` lines 63–79
- **Description:** The function streams the upload to a temp file (`tmp-${id}`), then passes the temp file path to `sharp()`. If `sharp()` throws during construction (e.g., invalid image header), the catch block at line 76 does attempt `fs.unlink(tempPath)`. However, if `sharp(tempPath, ...)` throws synchronously *before* the `.resize().webp().toFile()` chain starts, the error propagates to the catch at line 76 correctly. The actual issue is subtler: if the `sharp(tempPath).resize().webp().toFile(outputPath)` pipeline succeeds for `toFile()` but the output file is empty or corrupt (e.g., Sharp writes a 0-byte file), the function returns `filename` as if it succeeded. Unlike `processImageFormats` in `process-image.ts` (which verifies non-zero output at lines 397–409), `processTopicImage` has no output verification.
- **Evidence:** Compare `process-image.ts` lines 397–409 (post-generation verification: `if (webpStats.size === 0) throw new Error(...)`) with `process-topic-image.ts` lines 70–73 (no verification after `toFile(outputPath)`).
- **Concrete mismatch:** A 0-byte `outputPath` file would be created on disk and its filename returned, leading to a broken topic image displayed in the UI with no error surfaced.
- **Suggested fix:** After `toFile(outputPath)`, stat the output file and throw if size is 0, matching the verification pattern in `processImageFormats`.
- **Confidence:** HIGH

### VER-14-04: `batchUpdateImageTags` remove path missing `isValidTagName` validation [MEDIUM] [MEDIUM confidence]
- **File:** `apps/web/src/app/actions/tags.ts` lines 331–338
- **Description:** In `batchUpdateImageTags`, the add-tag loop (lines 300–326) validates tag names with `isValidTagName(cleanName)` before processing. However, the remove-tag loop (lines 331–343) does not validate `cleanName` at all — it directly looks up the tag by name or slug. While `isValidTagName` is primarily about rejecting injection characters, the asymmetry means the remove path accepts tag names with `<`, `>`, `"`, `'`, `&`, null bytes, or commas — characters that `isValidTagName` explicitly rejects in the add path. These characters would fail to match any existing tag (since tags can only be created with valid names), so there's no security issue, but the inconsistency violates the stated validation invariant.
- **Evidence:** Lines 302–305 (add path: `if (!isValidTagName(cleanName)) { warnings.push(...); continue; }`) vs lines 331–333 (remove path: `const cleanName = name.trim(); if (!cleanName) continue;` — no `isValidTagName` check).
- **Concrete mismatch:** The add path rejects `tagName = "<script>"` with a warning. The remove path silently attempts to look up `<script>` in the database, wasting a query that can never match.
- **Suggested fix:** Add `isValidTagName` validation to the remove loop, matching the add loop's pattern, or add an early-continue for invalid names.
- **Confidence:** MEDIUM

### VER-14-05: `getTopicBySlug` caches alias lookups for non-ASCII slugs, bypassing the ASCII-fast-path optimization [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/lib/data.ts` lines 538–571, line 665
- **Description:** `getTopicBySlug` is wrapped with `cache()` (line 665). The function first checks if the slug matches `/^[a-z0-9_-]+$/i` (line 540) and, if so, queries the `topics` table directly. If that fails, it falls through to the alias check. For non-ASCII slugs (CJK, emoji), it skips the direct query and goes straight to the alias table. This is correct behavior. However, the function is cached per React request context. If called with both `"photos"` (ASCII, direct match) and `"사진"` (non-ASCII, alias match), the cache correctly deduplicates. The issue is that `getTopicBySlugCached` is used in public page routes where the slug comes from the URL path. For direct topic slugs, the cache is beneficial. But for alias lookups, the `JOIN` with `topicAliases` is always executed even when the same topic was already fetched via its direct slug — because `cache()` keys on the *input slug*, not the resolved topic. This is a performance observation, not a correctness bug.
- **Evidence:** Line 665: `export const getTopicBySlugCached = cache(getTopicBySlug);` — cache key is the `slug` parameter. Calling with `"photos"` and `"사진"` (which both resolve to the same topic) results in two cache entries and two DB queries.
- **Suggested fix:** Not a correctness issue. Could be optimized by caching on the resolved topic slug, but the current behavior is correct.
- **Confidence:** MEDIUM

### VER-14-06: `getImage` prev/next navigation assumes DESC sort but index ordering may differ for NULL capture_date [LOW] [HIGH confidence]
- **File:** `apps/web/src/lib/data.ts` lines 340–401
- **Description:** The `getImage` function implements prev/next navigation using a three-tier tuple comparison `(capture_date, created_at, id)` with DESC ordering, matching the gallery grid sort. The comment on lines 373–374 states: "When capture_date is NULL, FALSE is intentional: in MySQL DESC sort, NULLs sort last, so there are no 'older' images by capture_date." This is correct for the "next" (older) direction. However, for the "prev" (newer) direction, when `capture_date` is NULL, line 350 uses `sql`${images.capture_date} IS NOT NULL`` — meaning any image with a non-NULL `capture_date` is considered "newer." This is semantically correct (images with dates appear before those without in DESC order), but there's a subtle edge case: if multiple images have NULL `capture_date`, their ordering depends entirely on `(created_at, id)`. The prev query correctly handles this with the second and third OR branches. The logic is sound but complex enough that it warrants noting as a verified invariant rather than a finding.
- **Evidence:** Full analysis of the three-tier comparison confirms correctness for all NULL/non-NULL combinations.
- **Conclusion:** No bug. Verified as correct.

## Previously Deferred Items Verified

The following previously identified issues remain unfixed and are still present:

1. **VER-39-01**: `batchUpdateImageTags` remove path still uses slug-only lookup instead of name-first (same as reported in cycle 39). Confirmed still present in `tags.ts` lines 331–338.

2. **VER-39-02**: `info-bottom-sheet.tsx` GPS block now has the unreachable-GPS comment (lines 291–294), matching `photo-viewer.tsx`. This appears to have been fixed since cycle 39.

## Verified Invariants (No Issues Found)

- **Privacy guard**: `selectFields` / `publicSelectFields` correctly excludes `latitude`, `longitude`, `filename_original`, `user_filename`. Compile-time type guard at lines 139–148 is sound.
- **Path traversal prevention**: `serveUploadFile` validates segments with `SAFE_SEGMENT` regex, checks containment with `resolvedPath.startsWith(resolvedRoot)`, rejects symlinks, and restricts to `ALLOWED_UPLOAD_DIRS` (jpeg, webp, avif — original excluded).
- **Session token verification**: HMAC-SHA256 with `timingSafeEqual`, proper expiry checks, 24-hour max age, token hash stored in DB (not plaintext).
- **Rate limiting**: All action endpoints use pre-increment TOCTOU-safe pattern with both in-memory Map (fast path) and DB-backed (accuracy across restarts).
- **SQL injection prevention**: All DB queries use Drizzle ORM parameterized queries. `searchImages` properly escapes LIKE wildcards (`%_\\`).
- **CSV export injection**: `escapeCsvField` handles formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`).
- **DB restore safety**: Advisory lock prevents concurrent restores, file header validation, `containsDangerousSql` scan, `--one-database` flag, `MYSQL_PWD` env var (not CLI flag).
- **Image processing queue**: MySQL advisory locks prevent concurrent processing of the same job. Claim-check verifies row still exists before processing. Conditional UPDATE detects delete-during-processing.
- **Upload security**: UUID filenames (no user-controlled names on disk), `limitInputPixels` decompression bomb mitigation, file size checks.
- **Admin auth**: Every server action calls `isAdmin()` independently (defense in depth beyond middleware). Middleware only checks cookie format (quick reject); full crypto verification happens server-side.
