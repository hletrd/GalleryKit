# Critic Review — Cycle 19

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

No new high-severity findings. Two low-severity observations about code organization and documentation consistency. All prior critic findings confirmed still fixed.

## Verified fixes from prior cycles

1. C15-CRIT-01 / C15-AGG-01 (deleteTopic redundant guard): FIXED.
2. C14-AGG-01 (audit.ts metadata truncation): FIXED.
3. C14-AGG-02 (deleteAdminUser raw SQL rationale): FIXED.
4. C16-CT-01 (image-queue.ts contradictory comment): FIXED.
5. C16-CT-02 (instrumentation.ts console.log): FIXED.
6. C18-MED-01 (searchImagesAction re-throw): FIXED.

## New Findings

### C19-CT-01 (Low / Medium): `getImageByShareKeyCached` wraps a function with side effects — cache() may silently suppress view-count increments

- **Source**: Direct code review of `apps/web/src/lib/data.ts:1231`
- **Cross-agent agreement**: same finding as C19-CR-01, C19-SR-01.
- From a critic's perspective, this is a design concern: `cache()` should only wrap pure functions or functions where side effects are idempotent. `getImageByShareKey` has a conditional side effect (`bufferGroupViewCount`) that is NOT idempotent — incrementing a view count twice is different from once. While the current call pattern avoids the issue, the API surface encourages misuse. A future developer may call `getImageByShareKeyCached(key, { incrementViewCount: true })` from two components in the same render and not realize only one view count is recorded.
- **Fix**: Either remove the `cache()` wrapper or rename the function to make the caveat explicit (e.g., `getImageByShareKeyCached_readOnly`).

### C19-CT-02 (Low / Low): Duplicated topic-slug validation regex in data.ts

- **Source**: Direct code review of `apps/web/src/lib/data.ts:404,441`
- **Cross-agent agreement**: same finding as C19-CR-03.
- `getImageCount` at line 404 and `buildImageConditions` at line 441 both have inline `/^[a-z0-9_-]+$/.test(topic) || topic.length > 100` instead of using the existing `isValidSlug()` from validation.ts. This violates DRY and could drift independently.
- **Fix**: Replace inline regex checks with `!isValidSlug(topic)`.

## Carry-forward (unchanged — existing deferred backlog)
- AGG6R-06: Restore lock complexity
- AGG6R-07: OG tag clamping
- AGG6R-09: Preamble repetition
