# Comprehensive Code Review -- Cycle 23 (2026-04-19)

**Reviewer perspectives combined:** code-quality, security, performance, debugger, architect, verifier, test-engineer, critic, tracer, designer, document-specialist

---

## NEW FINDINGS

### C23-01: `handleBatchAddTag` in image-manager.tsx allows Enter key submission while `isAddingTag` is true [LOW] [HIGH confidence]
- **File**: `apps/web/src/components/image-manager.tsx`, lines 228-231
- **Description**: The `onKeyDown` handler for the batch-tag input fires `handleBatchAddTag()` on Enter press without checking `isAddingTag`. While `handleBatchAddTag()` itself checks `if (!tagInput.trim()) return;`, it does NOT check `isAddingTag` before setting it. Rapid Enter presses could fire multiple `batchAddTags` server actions concurrently.
- **Concrete failure scenario**: User types a tag name and presses Enter twice quickly. Two `batchAddTags` calls fire, potentially adding duplicate tag associations (though `INSERT IGNORE` prevents actual DB duplication, the user sees duplicate success toasts).
- **Fix**: Add `isAddingTag` guard to the `onKeyDown` handler: `if (!isAddingTag) handleBatchAddTag();`

### C23-02: `handleBulkDelete` in image-manager.tsx lacks loading state guard on `AlertDialogAction` [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/image-manager.tsx`, line 268
- **Description**: The bulk delete `AlertDialogAction` calls `handleBulkDelete` but does not disable the button during the operation. If `isBulkDeleting` is true, the button is not disabled (unlike the single-delete case which checks `deletingId === image.id`). The user could click "Delete" in the confirmation dialog multiple times.
- **Concrete failure scenario**: User clicks "Delete" in the bulk-delete confirmation dialog, and the server action takes a few seconds. User clicks "Delete" again. Two `handleBulkDelete` calls fire, both reading `selectedIds` and calling `deleteImages` twice.
- **Fix**: Add `disabled={isBulkDeleting}` to the bulk-delete `AlertDialogAction` and show loading text.

### C23-03: `deleteTopicAlias` logs audit event even when 0 rows deleted [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/topics.ts` lines 268-297
- **Description**: Same pattern as C22-02 (fixed for `deleteTag` and `deleteImage`). The `deleteTopicAlias` function calls `db.delete(topicAliases)` at line 282 but does not check `affectedRows`. If two admins delete the same alias concurrently, both calls succeed (one deletes 1 row, the other 0) and both log `topic_alias_delete` audit events, creating a misleading duplicate entry.
- **Concrete failure scenario**: Two admins delete the same topic alias simultaneously. Both `db.delete()` calls succeed. Both log audit events. One is a phantom log for a no-op delete.
- **Fix**: Capture `affectedRows` from the delete result. Only log the audit event when `affectedRows > 0`, matching the pattern used in `deleteTag` (tags.ts line 99) and `deleteImage` (images.ts line 362).

### C23-04: `createTopic` and `updateTopic` do not apply `stripControlChars` to label input [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/topics.ts` lines 36 (label from formData), 106 (label from formData)
- **Description**: The `label` field in `createTopic` and `updateTopic` is user-facing input stored in the database. It goes through a length check (`label.length > 100`) but is not sanitized with `stripControlChars()`. This is the same class of issue as C17-02/C17-03 (fixed for SEO and gallery settings). A label containing null bytes or control characters could cause MySQL truncation or display issues.
- **Concrete failure scenario**: Admin enters a topic label with embedded null bytes or control characters (e.g., via API or malformed form submission). The label is stored as-is, potentially causing truncation or garbled display in the admin UI and public pages.
- **Fix**: Import `stripControlChars` from `@/lib/sanitize` and apply it to the `label` value after trimming, before the length check. Same pattern as `updateSeoSettings` (seo.ts line 104).

### C23-05: `createTopicAlias` does not apply `stripControlChars` to alias input [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/topics.ts` line 226-266
- **Description**: Same as C23-04 but for the `alias` field in `createTopicAlias`. The alias validation (`isValidTopicAlias`) rejects some special characters but does not strip null bytes or control characters in the 0x01-0x08, 0x0B, 0x0C, 0x0E-0x1F, and 0x7F range. The regex in `isValidTopicAlias` only excludes `/\\\s?\x00#<>"'&` -- it allows those other control characters.
- **Concrete failure scenario**: An alias containing control characters (other than null byte 0x00 which is explicitly excluded by the `\x00` in the regex) could be stored and cause display issues.
- **Fix**: Apply `stripControlChars` to the alias value before validation. This provides defense-in-depth regardless of what the regex allows.

### C23-06: `db/page.tsx` restore dialog Cancel button uses `t('cancel')` instead of `t('imageManager.cancel')` [LOW] [LOW confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, line 191
- **Description**: The restore confirmation dialog Cancel button uses `t('cancel')` from the `db` namespace, while every other Cancel button in the admin area uses `t('imageManager.cancel')`. Both keys resolve to "Cancel", so there is no user-facing bug. This is a consistency concern: if a developer removes the `db.cancel` key thinking all Cancel buttons use `imageManager.cancel`, the restore dialog would show the raw key.
- **Fix**: Change to `t('imageManager.cancel')` for consistency, or document that the `db` namespace is intentionally self-contained.

---

## PREVIOUSLY FIXED -- Confirmed Resolved

All findings from cycles 1-22 remain resolved. Specifically verified this cycle:

- C22-02 (`deleteTag` audit on 0 rows): **RESOLVED** -- `affectedRows` check at tags.ts line 99.
- C20-01 (uploadTracker negative count): **RESOLVED** -- `Math.max(0, ...)` clamping at images.ts lines 288-289.
- C20-02 (deleteAdminUser no-op success): **RESOLVED** -- `USER_NOT_FOUND` guard at admin-users.ts lines 164-168.
- C17-01 (searchImagesAction in-memory rollback): **RESOLVED** -- empty catch block at public.ts line 83-87.
- C17-02/C17-03 (control character sanitization in seo.ts/settings.ts): **RESOLVED** -- `stripControlChars` imported and used in seo.ts line 104, settings.ts line 61.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged and are carried forward:

- C21-03: `x-forwarded-proto` spoofing risk (deployment-dependent)
- C22-03: `deleteGroupShareLink` stale key fetch (negligible impact)
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- StorageBackend integration items (C6R2-F01 through C6R2-F14)
- C15-02: `createPhotoShareLink` does not validate image ownership
- C4-F02 / C6-F04: Admin checkboxes use native `<input>`
- C4-F03: `isReservedTopicRouteSegment` rarely used
- C4-F05: `loadMoreImages` offset cap may allow expensive tag queries
- C4-F06: `processImageFormats` creates 3 sharp instances (informational)
- C6-F03: Missing E2E tests for upload pipeline

---

## TOTALS

- **0 CRITICAL** findings
- **0 MEDIUM** findings
- **6 LOW** findings (C23-01 through C23-06)
- **6 total** new findings
