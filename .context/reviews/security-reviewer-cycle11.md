# Security Review — security-reviewer (Cycle 11)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high security findings.
- One low finding (audit-log integrity - same class as AGG10-01).
- All prior security fixes confirmed intact.

## Verified fixes from prior cycles

All prior security findings confirmed addressed:

1. AGG10-01 (addTagToImage audit on INSERT IGNORE no-op): FIXED - gated on affectedRows > 0.
2. AGG9R-02 (withAdminAuth origin check): FIXED - hasTrustedSameOrigin added centrally.
3. AGG10-02/AGG10-03 (.length documentation): FIXED - comments added.
4. C10R3-01/C10R3-02 (OG route validation): FIXED - isValidSlug/isValidTagName enforced.
5. C10R3-03 (deleteAdminUser affectedRows): FIXED - checks affectedRows === 0.

## New Findings

### C11-SEC-01 (Low / Medium). removeTagFromImage audit log fires on no-op DELETE - misleading audit trail

- Location: apps/web/src/app/actions/tags.ts:252
- The tag_remove audit event is logged unconditionally after the DELETE, even when deleteResult.affectedRows === 0. The code checks if the image still exists at lines 243-248 but does NOT gate the audit log on whether the deletion actually occurred.
- This is the same class as AGG10-01 (which was fixed for addTagToImage in cycle 10). A tag_remove event in the audit log that did not actually remove a tag is misleading for forensic analysis.
- Suggested fix: Wrap the audit log in if (deleteResult.affectedRows > 0).

## Carry-forward (unchanged - existing deferred backlog)

- D1-01 / D2-08 / D6-09 - CSP unsafe-inline hardening
- OC1-01 / D6-08 - historical example secrets in git history
