# Aggregate Review — Cycle 33 (2026-04-19)

## Summary

Cycle 33 deep review of the full codebase found **1 new actionable issue** (1 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL, HIGH, or MEDIUM findings. No regressions from prior cycles. Prior C33-01/C33-02/C33-03 findings from an earlier pass have been resolved.

## New Findings (Deduplicated)

### C43-01: `removeTagFromImage` audit log uses raw `tagName` instead of sanitized `cleanName` [LOW] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` line 195
- **Description**: The `logAuditEvent` call in `removeTagFromImage` passes the raw `tagName` parameter to the audit log metadata: `{ tag: tagName }`. All other tag operations that log audit events use the sanitized name: `addTagToImage` uses `tagRecord.name` (DB-confirmed, line 155), `batchAddTags` uses `cleanName` (explicitly sanitized, line 265), and `updateTag` uses `trimmedName` (sanitized, line 73). If a user submits a tag name containing control characters, the raw unsanitized value is written to the audit log, creating an inconsistency between the audit record and the actual DB operation. Same bug class as C41/C42 tag sanitization fixes.
- **Fix**: Change `{ tag: tagName }` to `{ tag: cleanName }` at line 195.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-42 remain deferred with no change in status. See `.context/reviews/_aggregate-cycle42.md` for the full list.

Key deferred items still outstanding:
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C30-03 (data) / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- CR-39-02: `processImageFormats` unlink-before-link race window
