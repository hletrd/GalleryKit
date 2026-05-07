# Code Reviewer — Cycle 44 (2026-04-20)

## Review Scope
Full codebase review of `apps/web/src/` — all server actions, data layer, middleware, image processing, and utility modules. Focus on logic bugs, edge cases, maintainability, and SOLID violations.

## New Findings

### CR44-01: `uploadImages` does not sanitize topic slug before DB insert [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/actions/images.ts` line 58
**Description:** The `topic` value from `formData.get('topic')` is validated with `isValidSlug()` (line 119), but the raw `topic` string (without `stripControlChars`) is used throughout — including the DB insert at line 164 (`topic` field). While `isValidSlug` rejects most control characters via its regex `/^[a-z0-9_-]+$/i`, this is inconsistent with the defense-in-depth pattern used everywhere else in the codebase (tags, labels, aliases all apply `stripControlChars` before validation). If `isValidSlug` were ever relaxed or a bypass found, control characters would reach the DB directly.
**Fix:** Apply `stripControlChars(topic)` before validation, matching the pattern in `createTopic`, `updateTopic`, `createTopicAlias`, etc.
**Failure scenario:** A future change to `isValidSlug` that allows CJK or broader characters (similar to `isValidTopicAlias`) could let control characters through.

### CR44-02: `updateImageMetadata` allows empty string title/description after sanitization [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/images.ts` lines 521-522
**Description:** After `stripControlChars` and `|| null` coercion, a title like `" \t\n"` (whitespace + control chars) becomes `null` via the `|| null` — this is correct. However, a title like `"  "` (pure spaces) passes `stripControlChars` (which only strips C0/DEL, not spaces) and then `trim()` was already applied, so `"  "` becomes `""` after trim, then `stripControlChars("")` returns `""`, then `|| null` makes it `null`. This is actually fine. Retracted — no issue.

### CR44-03: `flushGroupViewCounts` re-buffers failed increments without retry limit [LOW] [HIGH confidence]
**File:** `apps/web/src/lib/data.ts` lines 55-64
**Description:** When a `db.update` fails in `flushGroupViewCounts`, the failed count is re-buffered back into `viewCountBuffer`. If the DB is persistently down, each flush cycle will: (1) copy all entries to batch, (2) all fail, (3) re-buffer them. The `MAX_VIEW_COUNT_BUFFER_SIZE` cap (1000) prevents unbounded growth, but entries are never dropped — they just keep cycling. The `consecutiveFlushFailures` backoff slows the flush rate, but the buffer never drains during a persistent outage. This is a known deferred item (C30-03/C36-03) but noting it remains unaddressed.
**Status:** Already deferred in prior cycles.

### CR44-04: `createGroupShareLink` insertId validation uses `Number.isFinite` but doesn't guard against BigInt [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/sharing.ts` line 208
**Description:** `Number(result.insertId)` can produce unexpected results when MySQL returns `BigInt` for autoincrement IDs. `Number(BigInt(9007199254740993))` would silently lose precision. This is unlikely with current autoincrement values (would need >9 quadrillion rows) but the pattern is fragile. Same pattern exists in `uploadImages` line 186. This is a known deferred item (C30-04).
**Status:** Already deferred in prior cycles.

## Verified as Fixed (from prior cycles)

- C43-01 (LANG/LC_ALL locale in db-actions): **VERIFIED FIXED** — `LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'` hardcoded in both `dumpDatabase` (line 126) and `restoreDatabase` (line 339).
- CR43-02 (escapeCsvField control chars): **VERIFIED FIXED** — Line 23 now strips `[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]` before the existing logic.

## No Other New Issues Found

After thorough review of all server actions, data layer, middleware, session management, image processing queue, and utility modules, no additional new issues were identified beyond the one new finding (CR44-01) and the previously deferred items. The codebase is well-structured with consistent patterns.
