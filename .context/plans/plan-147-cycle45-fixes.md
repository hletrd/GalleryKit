# Plan — Cycle 45 Fixes

## Status: COMPLETE

## Findings to Address

### F1: C45-01 — Apply `stripControlChars` to `topicSlug` in `createTopicAlias` and `deleteTopicAlias` [MEDIUM] [HIGH confidence]

**Locations to fix:**
1. `apps/web/src/app/actions/topics.ts` line 233 — `createTopicAlias(topicSlug: string, alias: string)`
2. `apps/web/src/app/actions/topics.ts` line 278 — `deleteTopicAlias(topicSlug: string, alias: string)`

**Fix for each:** Add `const cleanTopicSlug = stripControlChars(topicSlug) ?? '';` at the top of each function, then use `cleanTopicSlug` in place of `topicSlug` for validation and all subsequent references (DB queries, audit logs, revalidation paths).

**Implementation plan:**
1. `createTopicAlias`: Add sanitization before `isValidSlug` check, use `cleanTopicSlug` in DB insert, audit log, and revalidation.
2. `deleteTopicAlias`: Add sanitization before `isValidSlug` check, use `cleanTopicSlug` in DB delete, audit log, and revalidation.

### F2: C45-02 — Apply `stripControlChars` to `slug` form field in `createTopic` [LOW] [HIGH confidence]

**File:** `apps/web/src/app/actions/topics.ts` line 38

**Fix:** Change `const slug = formData.get('slug')?.toString() ?? '';` to `const slug = stripControlChars(formData.get('slug')?.toString() ?? '') ?? '';` — same pattern as the `label` on the adjacent line.

### F3: C45-03 — Reorder sanitization before length validation in `updateImageMetadata` [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/images.ts` lines 502-522

**Fix:** Move `stripControlChars` calls (lines 521-522) to before the length checks (lines 512-518) so validation operates on sanitized values.

## Progress Tracking

- [x] F1.1: Fix `createTopicAlias` topicSlug sanitization — commit 000000082e
- [x] F1.2: Fix `deleteTopicAlias` topicSlug sanitization — commit 000000082e
- [x] F2: Fix `createTopic` slug sanitization — commit 000000082e
- [x] F3: Fix `updateImageMetadata` sanitization ordering — commit 000000082e
- [x] Run gates (eslint, next build, vitest) — all pass
- [x] Deploy — per-cycle-success
