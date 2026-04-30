# Critic Review — critic (Cycle 12)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No medium or high findings.
- One low finding about audit-log consistency (same class as cycle 10/11 fixes, but on the batch path).

## Verified fixes from prior cycles

All prior critic findings confirmed addressed:

1. AGG11-01 / C11-CRIT-01 (`removeTagFromImage` audit on no-op DELETE): FIXED — gated on `affectedRows > 0`.
2. AGG10-01 / C10-CRIT-01 (`addTagFromImage` audit on no-op INSERT IGNORE): FIXED — gated on `affectedRows > 0`.

## New Findings

### C12-CRIT-01 (Low / Medium). `batchAddTags` logs `tags_batch_add` audit event even when INSERT IGNORE affected 0 rows (all duplicates)

- Location: `apps/web/src/app/actions/tags.ts:327`
- The `db.insert(imageTags).ignore().values(values)` at line 324 returns `affectedRows === 0` when all rows are duplicates. The audit log at line 327 fires unconditionally with `count: existingIds.size`. `batchUpdateImageTags` (same file, line 414) correctly gates `added++` on `tagInsertResult.affectedRows > 0`, but `batchAddTags` does not gate its audit log.
- This is the exact same class of issue as AGG10-01 / C10-CRIT-01 (fixed for `addTagFromImage` in cycle 10) and AGG11-01 / C11-CRIT-01 (fixed for `removeTagFromImage` in cycle 11), but the batch-add counterpart was missed.
- Suggested fix: Capture the result's `affectedRows` and gate the audit log on `affectedRows > 0`. Update the `count` metadata to reflect actual rows inserted.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-06: Restore lock complexity is correct but hard to simplify.
- AGG6R-07: OG tag clamping is cosmetic.
- AGG6R-09: Preamble repetition is intentional defense-in-depth.
