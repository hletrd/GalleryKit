# Code Review Report — code-reviewer (Cycle 12)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.
Verification: All prior cycle fixes confirmed intact (AGG9R-01, AGG9R-02, AGG10-01, AGG10-02, AGG10-03, AGG11-01).

## Inventory reviewed

All primary source files in `apps/web/src/` (237 files): lib/ (38 files), components/ (30 files), app/ actions and routes (40+ files), db/ (3 files), __tests__/ (79+ files), config files. Focused on post-cycle-11 surface: audit-log gating consistency, sanitization pipeline, action-guard coverage.

## Verified fixes from prior cycles

All prior fixes confirmed intact:

1. AGG11-01 (`removeTagFromImage` audit log on no-op DELETE): FIXED — `tags.ts:254` gates on `deleteResult.affectedRows > 0`.
2. AGG10-01 (`addTagFromImage` audit log on no-op INSERT IGNORE): FIXED — `tags.ts:193` gates on `linkResult.affectedRows > 0`.
3. AGG10-02/AGG10-03 (`.length` documentation): FIXED — comments present in `validation.ts:22-24` and `validation.ts:99-103`.
4. AGG9R-01 (`countCodePoints` for varchar length checks): FIXED — used in topics, SEO, image metadata actions.
5. AGG9R-02 (`withAdminAuth` origin check): FIXED — `api-auth.ts:31-37` checks `hasTrustedSameOrigin`.

## New Findings

### C12-CR-01 (Low / Medium). `batchAddTags` audit log fires unconditionally after INSERT IGNORE — same class as AGG10-01/AGG11-01

- Location: `apps/web/src/app/actions/tags.ts:327`
- The `db.insert(imageTags).ignore().values(values)` at line 324 uses INSERT IGNORE. When all rows are duplicates (tag already linked to all images), `affectedRows === 0` and no tags were actually linked, but the audit log at line 327 fires unconditionally, logging `existingIds.size` as the count. The `batchUpdateImageTags` function (same file, line 414) correctly gates `added++` on `tagInsertResult.affectedRows > 0`, but `batchAddTags` does not gate its audit log.
- This is the same class of issue as AGG10-01 (addTagToImage, fixed cycle 10) and AGG11-01 (removeTagFromImage, fixed cycle 11), but the batch-add counterpart was missed.
- The `count` field in the audit metadata is `existingIds.size` (the number of candidate images), not the actual number of rows inserted. This means the audit trail is misleading when some or all INSERT IGNORE operations are no-ops.
- Severity is low because no data corruption occurs, but the audit trail is inaccurate.
- Suggested fix: Capture the `affectedRows` from the INSERT IGNORE result and gate the audit log on `affectedRows > 0`. Also change the `count` metadata to reflect actual rows inserted.

### C12-CR-02 (Low / Low). `updateTag` logs audit event even when UPDATE matched 0 rows (concurrent deletion)

- Location: `apps/web/src/app/actions/tags.ts:89`
- The `db.update(tags).set(...).where(...)` at line 82-84 returns `affectedRows === 0` when the tag was concurrently deleted. The code at line 85-86 checks `affectedRows === 0` and returns an error, so the audit log at line 89 only fires when `affectedRows > 0`. This is correctly gated — no issue. Listed for completeness to confirm the pattern was verified.

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items remain valid with no change in status. See aggregate for full list.
