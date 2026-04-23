# Aggregate Review -- Cycle 23 (2026-04-19)

**Source reviews:** Single-agent deep review (code-reviewer + security + perf + debugger + architect + verifier + test-engineer + critic + tracer + designer + document-specialist perspectives combined).

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

All findings from cycles 1-22 were re-verified. The following are **new** findings not previously identified or fixed.

### C23-01: `handleBatchAddTag` allows Enter key submission while `isAddingTag` is true [LOW] [HIGH confidence]
- **File**: `apps/web/src/components/image-manager.tsx`, lines 228-231
- **Description**: The `onKeyDown` handler fires `handleBatchAddTag()` on Enter without checking the `isAddingTag` loading state. Rapid Enter presses could fire multiple `batchAddTags` server actions concurrently. `INSERT IGNORE` prevents actual DB duplication, but the user may see duplicate success toasts.
- **Fix**: Add `if (!isAddingTag)` guard to the `onKeyDown` handler.

### C23-02: `handleBulkDelete` lacks loading state guard on `AlertDialogAction` [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/image-manager.tsx`, line 268
- **Description**: The bulk delete confirmation button is not disabled during `isBulkDeleting`. User could click "Delete" multiple times, firing multiple `deleteImages` calls. The server-side transaction prevents data corruption, but duplicate processing and audit events could result.
- **Fix**: Add `disabled={isBulkDeleting}` to the `AlertDialogAction`.

### C23-03: `deleteTopicAlias` logs audit event even when 0 rows deleted [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/topics.ts` lines 268-297
- **Description**: Same pattern as C22-02 (fixed for `deleteTag` and `deleteImage`). The `deleteTopicAlias` function calls `db.delete(topicAliases)` but does not check `affectedRows`. Concurrent deletion of the same alias creates a phantom audit log entry.
- **Fix**: Capture `affectedRows` from the delete result. Only log the audit event when `affectedRows > 0`.

### C23-04: `createTopic` and `updateTopic` do not apply `stripControlChars` to label input [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/topics.ts` lines 36, 106
- **Description**: The `label` field is user-facing input stored in the database. It goes through a length check but not `stripControlChars()`. Same class as C17-02/C17-03 (fixed for seo.ts/settings.ts). Control characters could cause MySQL truncation or display issues.
- **Fix**: Import `stripControlChars` from `@/lib/sanitize` and apply to `label` after trimming.

### C23-05: `createTopicAlias` does not apply `stripControlChars` to alias input [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/topics.ts` line 226-266
- **Description**: The `alias` field's validation regex (`isValidTopicAlias`) does not reject all control characters (0x01-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F are allowed by the regex). Applying `stripControlChars` provides defense-in-depth.
- **Fix**: Apply `stripControlChars` to the alias value before validation.

### C23-06: `db/page.tsx` restore dialog Cancel button uses inconsistent i18n key [LOW] [LOW confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, line 191
- **Description**: Uses `t('cancel')` from `db` namespace while all other admin Cancel buttons use `t('imageManager.cancel')`. Both resolve to "Cancel" so no user-facing bug, but inconsistency could cause a missing-key issue if one namespace is refactored.
- **Fix**: Change to `t('imageManager.cancel')` for consistency.

---

## PREVIOUSLY FIXED -- Confirmed Resolved

All cycle 1-22 findings remain resolved. No regressions detected this cycle.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged:

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

## AGENT FAILURES

None -- single-agent review completed successfully.

---

## TOTALS

- **0 CRITICAL** findings
- **0 MEDIUM** findings
- **6 LOW** findings (C23-01 through C23-06)
- **6 total** new findings
