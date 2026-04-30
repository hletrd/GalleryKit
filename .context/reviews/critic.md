# Critic Review — Cycle 21

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

One new medium-severity finding about `searchImages` query length validation inconsistency. One low-severity observation about validation functions using `.length` for fields that allow non-ASCII input. All prior critic findings confirmed still fixed.

## Verified fixes from prior cycles

1. C15-CRIT-01 / C15-AGG-01 (deleteTopic redundant guard): FIXED.
2. C14-AGG-01 (audit.ts metadata truncation): FIXED.
3. C14-AGG-02 (deleteAdminUser raw SQL rationale): FIXED.
4. C16-CT-01 (image-queue.ts contradictory comment): FIXED.
5. C16-CT-02 (instrumentation.ts console.log): FIXED.
6. C18-MED-01 (searchImagesAction re-throw): FIXED.
7. C19-AGG-01 (cache caveat on getImageByShareKeyCached): DOCUMENTED.
8. C19-AGG-02 (duplicated topic-slug regex): FIXED.
9. C20-AGG-01 (password length countCodePoints): FIXED.
10. C20-AGG-02 (getTopicBySlug inline regex): FIXED.
11. C20-AGG-04/05 (tags.ts catch blocks): FIXED.

## New Findings

### C21-CT-01 (Medium / High): `searchImages` query length uses `.length` while caller uses `countCodePoints()` — inconsistent, and `slice(0, 200)` can split surrogate pairs

- **Source**: `apps/web/src/lib/data.ts:1082`, `apps/web/src/app/actions/public.ts:158,205`
- **Cross-agent agreement**: same finding as C21-CR-01, C21-SR-01.
- From a critic's perspective, this is the same class of inconsistency that was fixed in C20-AGG-01. The codebase has established the pattern of using `countCodePoints()` for all user-facing string length checks where the input may contain non-ASCII characters. Search queries can contain any Unicode. The `slice(0, 200)` in public.ts:205 is particularly problematic because it can split a surrogate pair, producing an invalid string that gets passed to the LIKE query. The fix for C20-AGG-01 should have been applied consistently to all `.length` usages on non-ASCII fields.
- **Fix**: Replace `query.length > 200` with `countCodePoints(query) > 200` in data.ts. Replace `sanitizedQuery.slice(0, 200)` with a code-point-aware truncation or remove the redundant slice (the caller already validates length).

### C21-CT-02 (Low / Medium): `isValidTopicAlias` and `isValidTagName` use `.length` for max-length checks on fields that explicitly allow CJK/emoji

- **Source**: `apps/web/src/lib/validation.ts:85,96`
- **Cross-agent agreement**: same finding as C21-CR-02, C21-CR-03.
- The codebase established the `countCodePoints()` pattern in C20-AGG-01 and applied it consistently to title, description, label, SEO fields, and passwords. The validation.ts functions were not updated, creating an inconsistency. A 128-emoji topic alias (128 code points, 256 UTF-16 code units) would be rejected by `alias.length <= 255` despite fitting in MySQL's varchar(255).
- **Fix**: Use `countCodePoints()` in both validation functions.

## Carry-forward (unchanged — existing deferred backlog)
- AGG6R-06: Restore lock complexity
- AGG6R-07: OG tag clamping
- AGG6R-09: Preamble repetition
