# Plan — Review-Plan-Fix Cycle 4 Fixes

## Status: COMPLETE

## Findings to Address

### F1: C4RPL-01 — Apply `stripControlChars` to `slug` form field in `updateTopic` [MEDIUM] [HIGH confidence]

**File:** `apps/web/src/app/actions/topics.ts` line 106

**Fix:** Change `const slug = formData.get('slug')?.toString() ?? '';` to `const slug = stripControlChars(formData.get('slug')?.toString() ?? '') ?? '';` — same pattern as the `label` on the adjacent line (105) and `createTopic` slug (line 38).

**Rationale:** In `createTopic` the slug is sanitized (line 38), but in `updateTopic` it is not (line 106). While `isValidSlug` rejects control characters, the defense-in-depth pattern is to sanitize first and validate second, ensuring the validated value matches the stored value. Without sanitization, the `slug` reaches `isValidSlug`, `isReservedTopicRouteSegment`, `topicRouteSegmentExists`, DB queries, and `revalidateLocalizedPaths` without being stripped.

## Progress Tracking

- [x] F1: Fix `updateTopic` slug sanitization — commit 000000012
- [x] Run gates (eslint, next build, vitest) — all pass (0 errors, 91/91 tests, build success)
- [x] Commit and push — pushed to master
- [x] Deploy — per-cycle-success
