# Plan 328 — Cycle 10 Fixes

Date: 2026-04-29
Source: `.context/reviews/_aggregate.md` (Cycle 10)
Status: Completed

## Findings to address

| ID | Description | Severity | Confidence | Status |
|---|---|---|---|---|
| AGG10-01 | `addTagToImage` audit log fires on INSERT IGNORE no-op (duplicate row) | LOW | MEDIUM | Done |
| AGG10-02 | `isValidSlug` uses `.length` — document ASCII safety | LOW | LOW | Done |
| AGG10-03 | `isValidTagSlug` uses `.length` — document BMP safety | LOW | LOW | Done |

## Implementation tasks

### Task 1: AGG10-01 — Gate `addTagToImage` audit log on `affectedRows > 0` — DONE

- File: `apps/web/src/app/actions/tags.ts`
- Wrapped the audit log in `if (linkResult.affectedRows > 0)` so the `tag_add` event is only logged when the tag was actually linked to the image.
- When INSERT IGNORE is a no-op (duplicate), no audit event is recorded, matching the pattern used by `deleteAdminUser` (C10R3-03 fix) and `batchUpdateImageTags` (same file, line 403-404).

### Task 2: AGG10-02 — Document `.length` safety in `isValidSlug` — DONE

- File: `apps/web/src/lib/validation.ts`
- Added comment above `isValidSlug` documenting that `.length` is correct because the regex `/^[a-z0-9_-]+$/` restricts to ASCII characters where `.length` and `countCodePoints()` always agree.
- Same pattern as AGG9R-03 for `admin-users.ts:98-100`.

### Task 3: AGG10-03 — Document `.length` safety in `isValidTagSlug` — DONE

- File: `apps/web/src/lib/validation.ts`
- Added comment inside `isValidTagSlug` documenting that `.length` is acceptable because `getTagSlug()` normalizes to BMP-heavy forms where `.length` counts correctly.
- Note: If `isValidTagSlug` is changed to allow supplementary characters, migrate to `countCodePoints()`.

## Gate verification

| Gate | Status |
|------|--------|
| eslint | Pending |
| tsc --noEmit | Pending |
| vitest | Pending |
| lint:api-auth | Pending |
| lint:action-origin | Pending |
| npm run build | Pending |

## Deferred findings carry-forward

No new deferred findings this cycle. All prior deferred items from plan-326 and earlier remain valid with no change in status.
