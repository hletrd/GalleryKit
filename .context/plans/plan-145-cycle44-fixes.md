# Plan — Cycle 44 Fixes

## Status: IN PROGRESS

## Findings to Address

### F1: C44-01 — Apply `stripControlChars` consistently to all user inputs [MEDIUM] [HIGH confidence]
**Flagged by:** 10 agent-findings across code-reviewer, security-reviewer, critic, verifier, tracer, debugger, architect

**Locations to fix:**
1. `apps/web/src/app/actions/auth.ts` line 70 — `login` username
2. `apps/web/src/app/actions/images.ts` line 58 — `uploadImages` topic slug
3. `apps/web/src/app/actions/topics.ts` line 99 — `updateTopic` currentSlug parameter
4. `apps/web/src/app/actions/topics.ts` line 189 — `deleteTopic` slug parameter

**Fix for each:** Apply `stripControlChars(value)` before validation/query.

**Implementation plan:**
1. auth.ts: `const username = stripControlChars(formData.get('username')?.toString() ?? '') ?? '';` (import already exists via `sanitize.ts` not imported — need to add import)
2. images.ts: `const topic = stripControlChars(formData.get('topic')?.toString() ?? '') ?? '';` (stripControlChars already imported)
3. topics.ts: `const currentSlug = stripControlChars(currentSlug_raw) ?? '';` — need to restructure since `currentSlug` is a function parameter, not from formData. Sanitize before the `isValidSlug` check.
4. topics.ts: `const slug = stripControlChars(slug_raw) ?? '';` — same approach for `deleteTopic`.

**Note:** For items 3 and 4, `currentSlug` and `slug` are function parameters (not form data). We should sanitize them at the top of each function before any validation.

### F2: S44-02 — Reorder strip-before-slice in `searchImagesAction` [LOW] [HIGH confidence]
**File:** `apps/web/src/app/actions/public.ts` line 94
**Current:** `stripControlChars(query.trim().slice(0, 200)) ?? ''`
**Fix:** `stripControlChars(query.trim())?.slice(0, 200) ?? ''`

### F3: TE44-01 — Add unit test for `stripControlChars` [LOW] [HIGH confidence]
**File:** New file `apps/web/src/__tests__/sanitize.test.ts`
**Test cases:**
- Normal string passes through unchanged
- Null bytes stripped
- Tab, newline, CR stripped
- DEL (0x7F) stripped
- Mixed C0 control characters stripped
- Empty string returns empty string
- null input returns null
- String of only control characters returns empty string

## Progress Tracking

- [x] F1.1: Fix auth.ts login username sanitization — commit 0000000600
- [x] F1.2: Fix images.ts topic slug sanitization — commit 000000013a
- [x] F1.3: Fix topics.ts updateTopic currentSlug sanitization — commit 00000008dc
- [x] F1.4: Fix topics.ts deleteTopic slug sanitization — same commit as F1.3
- [x] F2: Fix searchImagesAction strip-before-slice ordering — commit 0000000395
- [x] F3: Add sanitize.test.ts unit tests — commit 00000007c5
- [x] Run gates (eslint, next build, vitest) — all pass
- [x] Deploy — per-cycle-success
