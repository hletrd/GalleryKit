# Code Review Report — code-reviewer (Cycle 11)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.
Verification: All cycle 10 findings confirmed fixed. `lint:api-auth` OK. `lint:action-origin` OK.

## Inventory reviewed

All primary source files in `apps/web/src/` (237 files): lib/ (38 files), components/ (30 files), app/ actions and routes (40+ files), db/ (3 files), __tests__/ (79+ files), config files. Focused on post-cycle-10 surface: `tags.ts` (AGG10-01 fix), `validation.ts` (AGG10-02/AGG10-03 fix), `admin-users.ts` (AGG10R-RPL-01 fix), `api-auth.ts` (AGG9R-02 fix). Deep review of all action files, data layer, session/auth, middleware, and sanitization pipeline.

## Verified fixes from cycle 10

All Cycle 10 findings confirmed FIXED:

1. AGG10-01 (`addTagToImage` audit log on INSERT IGNORE no-op): FIXED — `tags.ts:193` now gates the `tag_add` audit event on `linkResult.affectedRows > 0`.
2. AGG10-02 (`isValidSlug` uses `.length`): FIXED — `validation.ts:22-24` has comment documenting ASCII regex safety.
3. AGG10-03 (`isValidTagSlug` uses `.length`): FIXED — `validation.ts:99-103` has comment documenting BMP-normalized slug safety.

## New Findings

### C11-CR-01 (Low / Medium). `removeTagFromImage` audit log fires unconditionally — same class as AGG10-01 but on the remove path

- Location: `apps/web/src/app/actions/tags.ts:252`
- When `deleteResult.affectedRows === 0` (the tag was not linked to the image, so the DELETE was a no-op), the code at lines 242-248 checks if the image still exists but does NOT return early. The audit log at line 252 fires unconditionally, recording a `tag_remove` event even when nothing was actually removed.
- This is the exact same class of issue as AGG10-01 (fixed in cycle 10 for `addTagToImage`), but the remove counterpart was missed. The `batchUpdateImageTags` function (line 429) correctly gates `removed++` on `deleteResult.affectedRows > 0`, but the standalone `removeTagFromImage` does not gate its audit log.
- Severity is low because the no-op delete case is benign (no data corruption), but the audit trail is misleading.
- Suggested fix: Gate the audit log on `deleteResult.affectedRows > 0`, matching the AGG10-01 fix applied to `addTagToImage`.

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items remain valid with no change in status. See aggregate for full list.
