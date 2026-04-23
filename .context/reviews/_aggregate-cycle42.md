# Aggregate Review — Cycle 42 (2026-04-19)

## Summary

Cycle 42 deep review of the full codebase found **4 new actionable issues** (2 MEDIUM, 2 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## New Findings (Deduplicated)

### C42-01: `batchAddTags` does not apply `stripControlChars` to tag name before validation [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` lines 218-220
- **Description**: In `batchAddTags()`, `cleanName` is `tagName?.trim()` without `stripControlChars`, then validated with `isValidTagName(cleanName)`. This is the same bug pattern as C41-01/C41-02/C41-03 (fixed in cycle 41 for `updateTag`, `addTagToImage`, and `batchUpdateImageTags` add path). Control characters (tab, newline, CR) pass `isValidTagName` but get stored in the DB, causing display issues and inconsistent tag matching across operations that do strip control chars.
- **Fix**: Apply `stripControlChars(tagName?.trim() ?? '')` before `isValidTagName()`, matching the pattern in `addTagToImage` and `updateTag`.

### C42-04: `uploadImages` tag validation does not apply `stripControlChars` before `isValidTagName` [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/images.ts` line 65
- **Description**: In `uploadImages()`, tag names parsed from `tagsString` are validated with `isValidTagName(t)` after `.trim()` but without `stripControlChars`. Tags with embedded control characters pass validation and are stored in the DB. Same bug pattern as C41-01 through C42-01.
- **Fix**: Apply `stripControlChars(t.trim())` before `isValidTagName()` in the filter, and use the stripped value for tag entries.

### C42-02: `removeTagFromImage` does not apply `stripControlChars` to tag name lookup [LOW] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` lines 171-172
- **Description**: Lookup-only path uses `tagName?.trim()` without `stripControlChars`. If a tag was previously stored with control characters, a removal attempt using the same input would need to match the exact stored name. Applying `stripControlChars` ensures consistent matching behavior across all tag operations.
- **Fix**: Apply `stripControlChars(tagName?.trim() ?? '')` to `cleanName`.

### C42-03: `batchUpdateImageTags` remove path does not apply `stripControlChars` to tag names [LOW] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` line 342
- **Description**: The remove loop uses `name.trim()` without `stripControlChars`, while the add path (line 311) already uses it. Inconsistency between add and remove paths in the same function.
- **Fix**: Apply `stripControlChars(name.trim()) ?? ''` to `cleanName` in the remove path.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-41 remain deferred with no change in status. See `.context/reviews/_aggregate-cycle41.md` for the full list.

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

## Agent Failures

None — single-reviewer cycle completed successfully.
