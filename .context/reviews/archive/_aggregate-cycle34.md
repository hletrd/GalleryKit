# Aggregate Review — Cycle 34 (2026-04-19)

## Summary

Cycle 34 deep review of the full codebase found **2 new actionable issues** (1 MEDIUM, 1 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles. Prior C34-01/C34-02 from an earlier pass have been resolved.

## New Findings (Deduplicated)

### C34R2-01: `deleteTopicAlias` does not apply `stripControlChars` to alias parameter before validation [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/topics.ts` lines 278-297
- **Description**: `deleteTopicAlias(topicSlug, alias)` validates the `alias` parameter with `isValidTopicAlias(alias)` but does NOT apply `stripControlChars` before the validation check or DB lookup. This is inconsistent with `createTopicAlias` (line 243) which applies `stripControlChars(alias)` before `isValidTopicAlias()`. The `isValidTopicAlias` regex does reject whitespace and NUL via `\s` and `\x00`, but `stripControlChars` covers the full C0 range (0x00-0x1F, 0x7F) including non-whitespace C0 codes like ESC (0x1B) that the regex does not explicitly reject. The inconsistency between create and delete paths for the same entity is a code smell.
- **Fix**: Apply `stripControlChars(alias) ?? ''` before `isValidTopicAlias()`, matching the `createTopicAlias` pattern at line 243. Pass the sanitized alias to the DB query and audit log.

### C34R2-02: `createAdminUser` username not sanitized with `stripControlChars` before validation [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/actions/admin-users.ts` line 94
- **Description**: In `createAdminUser()`, the username is extracted from formData and validated with `!/^[a-zA-Z0-9_-]+$/.test(username)`. This regex already rejects control characters. However, every other user-facing text input in the codebase follows the pattern of `stripControlChars` before validation as defense in depth. The username field is the only text input that skips this preprocessing step. Adding `stripControlChars` would make the pattern consistent across all inputs.
- **Fix**: Apply `stripControlChars(username)` before the length and regex validation checks, matching the defense-in-depth pattern used everywhere else.

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
