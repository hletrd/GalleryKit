# Critic Review — Cycle 22

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

All C21 findings have been fixed. One new low-severity finding about `isValidTagSlug` remaining on `.length` while sibling validators were migrated to `countCodePoints()`. The codebase is in good shape — all previously identified `countCodePoints` inconsistencies have been addressed. The remaining finding is a consistency gap, not a correctness bug.

## Verified fixes from prior cycles

1. C21-AGG-01 (searchImages countCodePoints): FIXED.
2. C21-AGG-02 (isValidTopicAlias countCodePoints): FIXED.
3. C21-AGG-03 (isValidTagName countCodePoints): FIXED.
4. C20-AGG-01 (password length countCodePoints): FIXED.
5. C20-AGG-02 (getTopicBySlug inline regex): FIXED.
6. C20-AGG-03 (updateImageMetadata redundant updated_at): FIXED.
7. C20-AGG-04/05 (tags.ts catch blocks): FIXED.
8. C18-MED-01 (searchImagesAction re-throw): FIXED.
9. C16-MED-01 (loadMoreImages DB counter sync): FIXED.
10. C19-AGG-01 (cache caveat on getImageByShareKeyCached): DOCUMENTED.
11. C19-AGG-02 (duplicated topic-slug regex): FIXED.

## New Findings

### C22-CT-01 (Low / Medium): `isValidTagSlug` uses `.length <= 100` while sibling validators `isValidTopicAlias` and `isValidTagName` were migrated to `countCodePoints()` in C21 — consistency gap

- **Source**: `apps/web/src/lib/validation.ts:116`
- **Cross-agent agreement**: same finding as C22-CR-01.
- From a critic's perspective: the C21 fixes established the `countCodePoints()` pattern for all validation functions that accept non-ASCII characters. `isValidTagSlug` was explicitly excluded with a comment (AGG10-03) stating that `.length` is acceptable because `getTagSlug()` normalizes to BMP-heavy forms. However, the regex `/^[\p{Letter}\p{Number}-]+$/u` explicitly allows supplementary characters — the comment says "if `isValidTagSlug` is changed to allow supplementary characters, migrate to `countCodePoints()`" but the regex already does allow them. This is a code-comment inconsistency that should be resolved: either migrate to `countCodePoints()` for consistency, or tighten the regex to BMP-only and update the comment.
- **Fix**: Migrate to `countCodePoints(slug) <= 100` for consistency, or change the comment to explicitly document why `.length` is safe despite the `\p{Letter}` regex (e.g., "getTagSlug() always produces BMP output, so supplementary characters cannot appear in practice").
- **Confidence**: Medium

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-06: Restore lock complexity
- AGG6R-07: OG tag clamping
- AGG6R-09: Preamble repetition
