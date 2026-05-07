# Code Review Report — code-reviewer (Cycle 10)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.
Verification: All cycle 9 findings confirmed fixed. `lint:api-auth` OK. `lint:action-origin` OK.

## Inventory reviewed

All primary source files in `apps/web/src/` (237 files): lib/ (38 files), components/ (30 files), app/ actions and routes (40+ files), db/ (3 files), __tests__/ (79+ files), config files. Focused on post-cycle-9 surface: `api-auth.ts` (AGG9R-02 fix), `images.ts` (AGG9R-01 fix), `public.ts` (AGG9R-01 fix), `admin-users.ts` (AGG9R-03 fix), `og/route.tsx` (C10R3-01/C10R3-02 fixes from prior cycles).

## Verified fixes from cycle 9

All Cycle 9 findings confirmed FIXED:

1. C9-CR-01 (`.length` for tagsString): FIXED — `images.ts:139` now uses `countCodePoints(tagsString) > 1000`.
2. C9-CR-02 (username `.length`): FIXED — `admin-users.ts:98-100` now has comment documenting `.length` safety for ASCII-validated usernames.
3. C9-CR-03 (search query `.length`): FIXED — `public.ts:117` now uses `countCodePoints(sanitizedQuery) > 200`.

## Verified fixes from cycle 10 R3

1. C10R3-01 (OG route topic validation): FIXED — `og/route.tsx:32` now validates `topic` against `isValidSlug()`.
2. C10R3-02 (OG route tag validation): FIXED — `og/route.tsx:74` filters tags through `isValidTagName(t)`.
3. C10R3-03 (deleteAdminUser affectedRows): FIXED — `admin-users.ts:227-229` now checks `affectedRows === 0` and throws `USER_NOT_FOUND`.

## New Findings

### C10-CR-01 (Low / Low). `isValidSlug` length check uses `.length` — same class as AGG8R-02

- Location: `apps/web/src/lib/validation.ts:23`
- `isValidSlug` uses `slug.length <= 100` which counts UTF-16 code units. The slug regex (`/^[a-z0-9_-]+$/`) restricts to ASCII, so `.length` and `countCodePoints()` always agree. However, this is the same class of inconsistency that was flagged and fixed for topics/seo/admin-users.
- Severity is low because the ASCII regex makes `.length` correct.
- Suggested fix: Add a comment documenting that `.length` is safe because the regex restricts to ASCII (same pattern as AGG9R-03 for username), or switch to `countCodePoints` for uniformity.

### C10-CR-02 (Low / Low). `isValidTagSlug` length check uses `.length` — same class as AGG8R-02

- Location: `apps/web/src/lib/validation.ts:96`
- `isValidTagSlug` uses `slug.length <= 100`. The slug regex (`/^[\p{Letter}\p{Number}-]+$/u`) allows Unicode letters/numbers, so supplementary characters in tag slugs would be double-counted by `.length`. However, `getTagSlug()` normalizes to a hyphen-joined form from the tag name, and tag names are ASCII-adjacent (CJK characters are BMP, `.length` counts them as 1 each).
- Severity is low because supplementary characters in tag slugs are extremely rare.
- Suggested fix: Add comment documenting that `.length` is acceptable for BMP-heavy slug patterns, or switch to `countCodePoints` for uniformity.

### C10-CR-03 (Low / Medium). `addTagToImage` audit log fires even when `INSERT IGNORE` silently drops the row (FK violation or duplicate)

- Location: `apps/web/src/app/actions/tags.ts:191`
- When `db.insert(imageTags).ignore()` inserts a row that already exists (duplicate), `linkResult.affectedRows` is 0. The code then checks if the image still exists, but the audit log on line 191 fires unconditionally regardless of whether the link was actually inserted. This means the audit log records a `tag_add` event even when the tag was already linked to the image.
- This is the same class of issue as C10R3-03 (phantom audit log entries).
- Severity is low because the duplicate case is benign (no data corruption), but the audit trail is misleading.
- Suggested fix: Only log the audit event when `linkResult.affectedRows > 0` (or when the existing-image check reveals the image was deleted mid-flight).

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items remain valid with no change in status. See aggregate for full list.
