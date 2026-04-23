# Comprehensive Code Review — Cycle 9 Round 2 (2026-04-20)

**Scope:** Full codebase deep review after 8+ prior cycles of hardening. Focus on new issues, regressions, and previously missed problems.

## Summary

After thorough review of all server actions, data layer, auth, session management, image processing, rate limiting, sanitization, validation, and DB schema, **1 new actionable finding** was identified (LOW). No CRITICAL or HIGH findings. No MEDIUM findings. No regressions from prior cycles. The codebase is in strong shape after extensive prior hardening.

## New Findings

### C9R2-F01: `escapeCsvField` does not strip tab (0x09) — gap in C0 control cleanup for legacy data [LOW] [Medium confidence]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` line 23

**Description:** The `escapeCsvField` function strips control characters in the first regex, then replaces `\r\n` with spaces, and finally checks for formula injection characters. The first regex `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g` explicitly **excludes** `\x09` (tab) from the character range — it strips \x00-\x08 but skips \x09, then resumes at \x0B.

The second regex `/[\r\n]/g` replaces `\r` and `\n` with spaces but does not handle `\t`. So a tab character embedded in a legacy value (stored before `stripControlChars` was added) would survive into the CSV output.

The formula injection check `if (value.match(/^[=+\-@\t]/))` does check for tab as a leading character, but only at position 0 — a tab embedded elsewhere in the value is not stripped.

Impact is very low because:
1. CSV export uses double-quote wrapping which neutralizes most injection
2. Tabs in the middle of values are harmless in CSV
3. `stripControlChars` applied at input time already removes tabs from new data
4. This only affects legacy data stored before sanitization was enforced

**Fix:** Change the first regex from `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g` to `/[\x00-\x1F\x7F]/g` (strip all C0 controls uniformly), then handle `\r\n` replacement with spaces afterward. The `\r\n` step runs on the already-stripped string so it's a no-op for those characters, but keeping it is clearer. Alternatively, just add `\t` handling: `.replace(/\t/g, ' ')` after the \r\n replacement.

**Concrete failure scenario:** A legacy tag name like "photo\tgraph" (with an embedded tab) would be exported as-is to CSV. While the double-quote wrapping prevents formula injection, the tab could cause column misalignment in some strict CSV parsers.

## Verified Fixes (No Regressions)

All prior cycle fixes confirmed as still in place:

- C8-01 (password sanitization in `createAdminUser`) — confirmed in `admin-users.ts:100`
- C8-02 (password sanitization in `updatePassword`) — confirmed in `auth.ts:265-267`
- C8-03 (password sanitization in `login`) — confirmed in `auth.ts:74`
- C46-01/C46-02 (stripControlChars on tagsString/topic in uploadImages) — confirmed in `images.ts:57,62`
- C7R2-01 through C7R2-05 (control char rejection patterns) — confirmed across all action files
- Privacy field separation (publicSelectFields vs adminSelectFields) — confirmed in `data.ts:96-161`
- SQL restore scanner hardening — confirmed in `sql-restore-scan.ts`
- Rate limit pre-increment patterns — confirmed in `auth.ts`, `admin-users.ts`, `sharing.ts`, `public.ts`
- batchUpdateImageTags `affectedRows` check for removed count — confirmed in `tags.ts:378-379`

## Dismissed Prior Findings

- C9-F02 (batchUpdateImageTags removed count overcount): Already fixed — the code now checks `deleteResult.affectedRows > 0` before incrementing `removed`. False positive from stale review.
- C9-F01 (original_file_size BigInt precision): The actual schema uses `int('original_file_size')` (not bigint). MySQL INT maxes at ~2.1GB, well above 200MB upload cap. No issue.

## Actionable Findings Summary

| ID | Description | Severity | Confidence | File |
|----|------------|----------|------------|------|
| C9R2-F01 | `escapeCsvField` does not strip tab (0x09) — gap in C0 control cleanup for legacy data | LOW | Medium | `db-actions.ts:23` |

**Only 1 actionable finding this cycle**, and it is LOW severity / defense-in-depth.

## Deferred Carry-Forward

All previously deferred items from cycles 5-46 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>`
- C6-F03: No E2E test coverage for upload pipeline
- C7-F03: No test coverage for view count buffering system
- C7-F04: No test for search rate limit rollback logic
- C8-F01: deleteTopicAlias revalidation (no change needed, informational)
