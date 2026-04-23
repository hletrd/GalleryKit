# Aggregate Review -- Cycle 24 (2026-04-19)

**Source reviews:** Single-agent deep review (code-reviewer + security + perf + debugger + architect + verifier + test-engineer + critic + tracer + designer + document-specialist perspectives combined).

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

All findings from cycles 1-23 were re-verified. The following are **new** findings not previously identified or fixed.

### C24-04: `deleteTopic` logs audit event unconditionally when 0 rows deleted [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/topics.ts`, lines 200-213
- **Description**: Same pattern as C22-02 (fixed for `deleteTag`) and C23-03 (fixed for `deleteTopicAlias`). The `deleteTopic` function calls `tx.delete(topics)` inside a transaction but does not capture `affectedRows`. Concurrent deletion of the same topic creates a phantom audit log entry.
- **Fix**: Capture `affectedRows` from the `tx.delete()` result. Only log the audit event when `affectedRows > 0`.

### C24-05: `updateTag` does not apply `stripControlChars` to name input [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/tags.ts`, lines 41-78
- **Description**: The `name` parameter is user-facing input stored in the database. It goes through `isValidTagName()` validation but not `stripControlChars()`. Same class as C17-02/C17-03 (fixed for seo.ts/settings.ts) and C23-04 (fixed for topic labels). Control characters could cause MySQL truncation or display issues.
- **Fix**: Import `stripControlChars` from `@/lib/sanitize` and apply to `name` before validation.

---

## PREVIOUSLY FIXED -- Confirmed Resolved

All cycle 1-23 findings remain resolved. Additionally, initial C24-01 through C24-03 findings were already fixed in the codebase before this review cycle:

- C24-01 (`handleBulkDelete` uses `selectedIds` in filter): **RESOLVED** -- `const deletedIdSet = new Set(ids)` at image-manager.tsx line 136.
- C24-02 (Password form autoComplete): **RESOLVED** -- `autoComplete="current-password"` and `autoComplete="new-password"` present at password-form.tsx lines 68, 82, 98.
- C24-03 (Admin-user-manager delete loading state): **RESOLVED** -- `isDeleting` state with `disabled={isDeleting}` at admin-user-manager.tsx line 173.

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
- **2 LOW** findings (C24-04 through C24-05)
- **2 total** new findings
