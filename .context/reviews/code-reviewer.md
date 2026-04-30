# Code Review Report — code-reviewer (Cycle 13)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.
Verification: All prior cycle fixes confirmed intact (AGG9R-01, AGG9R-02, AGG10-01 through AGG12-01).

## Inventory reviewed

All primary source files in `apps/web/src/` (237 files): lib/ (38 files), components/ (30 files), app/ actions and routes (40+ files), db/ (3 files), __tests__/ (79+ files), config files. Focused on audit-log consistency, sanitization pipeline, action-guard coverage, and cross-file interaction patterns.

## Verified fixes from prior cycles

All prior fixes confirmed intact:

1. AGG12-01 (`batchAddTags` audit log gated on `affectedRows > 0`): FIXED — `tags.ts:329-332` correctly gates the `tags_batch_add` audit event and uses `batchInsertResult.affectedRows` as the `count` metadata.
2. AGG11-01 (`removeTagFromImage` audit log on no-op DELETE): FIXED — `tags.ts:254` gates on `deleteResult.affectedRows > 0`.
3. AGG10-01 (`addTagToImage` audit log on no-op INSERT IGNORE): FIXED — `tags.ts:193` gates on `linkResult.affectedRows > 0`.
4. AGG9R-01 (`countCodePoints` for DoS-prevention length bounds): FIXED — used in images.ts, topics.ts, seo.ts, public.ts.
5. AGG9R-02 (`withAdminAuth` origin check): FIXED — `api-auth.ts:31-37` checks `hasTrustedSameOrigin`.
6. AGG8R-01 (stateful `/g` regex in `sanitizeAdminString`): FIXED — uses `UNICODE_FORMAT_CHARS` (non-`/g`) for `.test()`.
7. AGG10-02/AGG10-03 (`.length` documentation): FIXED — comments present in `validation.ts`.

## New Findings

### C13-CR-01 (Low / Medium). `batchUpdateImageTags` audit log fires unconditionally after transaction — even when `added === 0 && removed === 0`

- Location: `apps/web/src/app/actions/tags.ts:452`
- The `tags_batch_update` audit event at line 452 fires unconditionally after the transaction completes successfully, even when no tags were actually added or removed (`added === 0 && removed === 0`). This can occur when all tag names were invalid, had slug collisions, or were already in the desired state (already linked / already unlinked).
- This is the same class of issue as AGG10-01 (fixed cycle 10 for `addTagToImage`), AGG11-01 (fixed cycle 11 for `removeTagFromImage`), and AGG12-01 (fixed cycle 12 for `batchAddTags`), but the `batchUpdateImageTags` counterpart was missed.
- The audit metadata `{ added, removed }` correctly reflects the zero counts, so the audit trail is not *misleading* in the same way as the prior findings. However, an audit event that records zero effective changes is noise — it indicates the action ran but had no effect, which could confuse forensic analysis.
- Severity is low because the metadata is accurate (no false positive count), but the event itself is unnecessary when no mutation occurred.
- Suggested fix: Gate the audit log on `added > 0 || removed > 0`.

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items remain valid with no change in status. See aggregate for full list.
