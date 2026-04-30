# Security Review — security-reviewer (Cycle 12)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high security findings.
- One low finding (audit-log integrity — same class as AGG10-01/AGG11-01).
- All prior security fixes confirmed intact.

## Verified fixes from prior cycles

All prior security findings confirmed addressed:

1. AGG11-01 (`removeTagFromImage` audit on no-op DELETE): FIXED — gated on `affectedRows > 0`.
2. AGG10-01 (`addTagFromImage` audit on no-op INSERT IGNORE): FIXED — gated on `affectedRows > 0`.
3. AGG9R-02 (`withAdminAuth` origin check): FIXED — `hasTrustedSameOrigin` added centrally.
4. AGG9R-01 (`countCodePoints` for varchar length checks): FIXED — used in all relevant actions.
5. AGG10-02/AGG10-03 (`.length` documentation): FIXED — comments added.
6. C8-AGG8R-01 (stateful `/g` regex in `sanitizeAdminString`): FIXED — uses `UNICODE_FORMAT_CHARS` (non-`/g`) for `.test()`.
7. `csv-escape.ts` formula injection + bidi/zero-width stripping: Confirmed intact.

## New Findings

### C12-SEC-01 (Low / Medium). `batchAddTags` audit log fires on INSERT IGNORE no-ops — misleading audit trail

- Location: `apps/web/src/app/actions/tags.ts:327`
- The `tags_batch_add` audit event is logged unconditionally after `db.insert(imageTags).ignore().values(values)` at line 324. When INSERT IGNORE is a no-op (all rows are duplicates), `affectedRows === 0` but the audit log still fires with `count: existingIds.size`. The standalone `addTagToImage` (AGG10-01, fixed) and `removeTagFromImage` (AGG11-01, fixed) both gate their audit logs on `affectedRows > 0`, but the batch counterpart does not.
- This is the same class as AGG10-01/AGG11-01 but for the batch-add path. A `tags_batch_add` event that did not actually link any tags is misleading for forensic analysis.
- Suggested fix: Capture `affectedRows` from the INSERT IGNORE result and gate the audit log on `affectedRows > 0`. Also use the actual affected count in the audit metadata.

## Carry-forward (unchanged — existing deferred backlog)

- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- OC1-01 / D6-08 — historical example secrets in git history
