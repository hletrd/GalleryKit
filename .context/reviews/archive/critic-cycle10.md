# Critic Review — critic (Cycle 10)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No medium or high findings.
- One low finding about audit-log consistency.

## Verified fixes from prior cycles

All Cycle 9 critic findings confirmed addressed:

1. C9-CRIT-01 (`countCodePoints` inconsistency): FIXED — `images.ts` and `public.ts` now use `countCodePoints()`.
2. C9-CRIT-02 (`withAdminAuth` origin check): FIXED — `hasTrustedSameOrigin` added to wrapper.

## New Findings

### C10-CRIT-01 (Low / Low). `addTagToImage` logs `tag_add` audit event even when INSERT IGNORE is a no-op (duplicate row)

- Location: `apps/web/src/app/actions/tags.ts:191`
- The `db.insert(imageTags).ignore()` returns `affectedRows === 0` for duplicate rows, but the audit log fires unconditionally. `batchUpdateImageTags` (same file, line 403-404) correctly gates its counter on `affectedRows > 0`. The inconsistency means the audit log can show a `tag_add` event when nothing was actually added.
- Suggested fix: Move the audit log inside a conditional that checks `linkResult.affectedRows > 0` or the image-existence check result.

## Carry-forward (unchanged — existing deferred backlog)

- AGG6R-06: Restore lock complexity is correct but hard to simplify.
- AGG6R-07: OG tag clamping is cosmetic.
- AGG6R-09: Preamble repetition is intentional defense-in-depth.
