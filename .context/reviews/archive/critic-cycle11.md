# Critic Review — critic (Cycle 11)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No medium or high findings.
- One low finding about audit-log consistency (same class as cycle 10 fix).

## Verified fixes from prior cycles

All Cycle 10 critic findings confirmed addressed:

1. C10-CRIT-01 (`addTagToImage` audit on no-op INSERT IGNORE): FIXED — gated on `affectedRows > 0`.

## New Findings

### C11-CRIT-01 (Low / Medium). `removeTagFromImage` logs `tag_remove` audit event even when DELETE affected 0 rows (tag was not linked)

- Location: `apps/web/src/app/actions/tags.ts:252`
- The `db.delete(imageTags)` at line 236 returns `affectedRows === 0` when the tag was not linked to the image. The code at lines 242-248 checks if the image still exists but does NOT return early or gate the audit log. The audit log at line 252 fires unconditionally. `batchUpdateImageTags` (same file, line 429) correctly gates `removed++` on `deleteResult.affectedRows > 0`. The inconsistency means the audit log can show a `tag_remove` event when nothing was actually removed.
- This is the exact same class of issue as AGG10-01 / C10-CRIT-01 (fixed for `addTagToImage` in cycle 10), but the remove counterpart was missed.
- Suggested fix: Move the audit log inside a conditional that checks `deleteResult.affectedRows > 0`.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-06: Restore lock complexity is correct but hard to simplify.
- AGG6R-07: OG tag clamping is cosmetic.
- AGG6R-09: Preamble repetition is intentional defense-in-depth.
