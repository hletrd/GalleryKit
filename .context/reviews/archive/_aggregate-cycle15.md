# Aggregate Review — Cycle 15 (2026-04-19)

**Source reviews:** Deep multi-angle direct review of all key source files

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## NEW FINDINGS

### C15-01: `original_file_size` column is `bigint({ mode: 'number' })` which silently truncates values above 2^53 — potential data integrity mismatch [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/db/schema.ts` line 50
- **Description**: The `original_file_size` column is defined as `bigint('original_file_size', { mode: 'number' })`. MySQL BIGINT stores up to 2^63-1, but JavaScript's `Number` type can only represent integers up to 2^53-1 (Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991). Any DB value above 2^53 would be silently truncated when read into JS. While no real photo file exceeds 8 PB (the max upload is 200 MB), the mismatch between DB type and JS type means a corrupted or malicious DB value above 2^53 would be silently corrupted on read. The same class of issue applies to `Number(result.insertId)` in sharing.ts:192 and admin-users.ts:104 — if autoincrement IDs ever exceed 2^53, they'd be silently truncated (extremely unlikely but same pattern).
- **Fix**: Either (a) use `bigint({ mode: 'bigint' })` and handle BigInt explicitly in the few places it's read, or (b) change the column to `int` since `original_file_size` will never exceed 2^31-1 (2 GB) given the 200 MB upload cap. Option (b) is simpler and more correct given the actual constraints.
- **Confidence**: MEDIUM — the practical risk is near-zero given the 200 MB upload cap, but the type mismatch is real.

### C15-02: `createPhotoShareLink` does not validate that `imageId` corresponds to an image belonging to the requesting admin — any admin can share any image [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/sharing.ts` lines 56-133
- **Description**: The `createPhotoShareLink` action checks `isAdmin()` but does not verify any ownership of the image. In a multi-admin setup, any admin can create a share link for any image. This is by design in the current architecture (all admins have equal access to all images), so this is informational. However, if role-based access control is ever added, this would need to be revisited.
- **Fix**: No fix needed currently. Document this as an architectural note if multi-tenant access is ever planned.
- **Confidence**: LOW — this is by design in the current system.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-14 findings remain resolved. No regressions detected. Key items re-verified this cycle:

- C14-01 (processImageFormats unlink-before-link race): The atomic rename via `.tmp` file is now implemented at `process-image.ts:378-396`. Confirmed fixed.
- C14-02 (findNearestImageSize returns targetSize on empty): Now returns `DEFAULT_IMAGE_SIZES[DEFAULT_IMAGE_SIZES.length - 1]` at `gallery-config-shared.ts:95`. Confirmed fixed.
- C14-03 (seo-client.tsx and settings-client.tsx save all fields): Both now implement dirty-field tracking via `initialRef` comparison. Only changed fields are sent. Confirmed fixed.
- C14-04 (lightbox JPEG fallback uses base filename): Now uses a medium-sized JPEG variant at `lightbox.tsx:164`. Confirmed fixed.
- C15-01/C15-02/C15-03 (hardcoded English metadata strings from prior run): Confirmed fixed.
- Download route security: Confirmed — regex validation + containment check + symlink rejection + admin auth

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain with no change in status (19 items from cycles 5-14):

- C6R2-F01: Full StorageBackend integration (HIGH)
- C6R2-F03: Gallery config integration into processing pipeline (HIGH)
- C6R2-F04: Zero tests for StorageBackend (HIGH)
- C6R2-F10: serve-upload.ts local-only filesystem access (MEDIUM)
- C6R2-F11: S3 writeStream materializes entire file in memory (MEDIUM)
- C6R2-F12: statfs always checks local disk (MEDIUM)
- C6R2-F13: S3 deleteMany uses individual deletes (LOW)
- C6R2-F14: Zero tests for settings/SEO actions (LOW)
- C6R2-C05: Settings page lacks unsaved-changes protection (LOW)
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C4-F03: `isReservedTopicRouteSegment` rarely used
- C4-F05: `loadMoreImages` offset cap may allow expensive tag queries
- C4-F06: `processImageFormats` creates 3 sharp instances (informational)
- C6-F03: Missing E2E tests for upload pipeline

---

## AGENT FAILURES

None — direct review completed successfully.

---

## TOTALS

- **1 MEDIUM** finding (C15-01: bigint mode mismatch)
- **1 LOW** finding (C15-02: admin share scope — informational)
- **0 CRITICAL/HIGH** findings
- **2 total** new findings
