# Security Review — security-reviewer (Cycle 13)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high security findings.
- One low finding (audit-log integrity — same class as AGG10-01/AGG11-01/AGG12-01).
- All prior security fixes confirmed intact.

## Verified fixes from prior cycles

All prior security findings confirmed addressed:

1. AGG12-01 (`batchAddTags` audit on INSERT IGNORE no-ops): FIXED — gated on `affectedRows > 0`.
2. AGG11-01 (`removeTagFromImage` audit on no-op DELETE): FIXED — gated on `affectedRows > 0`.
3. AGG10-01 (`addTagToImage` audit on no-op INSERT IGNORE): FIXED — gated on `affectedRows > 0`.
4. AGG9R-02 (`withAdminAuth` origin check): FIXED — `hasTrustedSameOrigin` added centrally.
5. AGG9R-01 (`countCodePoints` for varchar length checks): FIXED — used in all relevant actions.
6. C8-AGG8R-01 (stateful `/g` regex in `sanitizeAdminString`): FIXED — uses `UNICODE_FORMAT_CHARS` (non-`/g`) for `.test()`.

## New Findings

### C13-SEC-01 (Low / Low). `batchUpdateImageTags` audit log fires when `added === 0 && removed === 0` — unnecessary audit noise

- Location: `apps/web/src/app/actions/tags.ts:452`
- The `tags_batch_update` audit event fires unconditionally after the transaction, even when no tags were actually added or removed. Unlike the prior AGG10/11/12 findings where the `count` metadata was misleading, here the metadata `{ added: 0, removed: 0 }` is technically accurate. The event is just unnecessary noise — a zero-effect audit event.
- Severity is Low because the metadata is accurate (no false positive count). The audit trail is not misleading, just noisy.
- Suggested fix: Gate the audit log on `added > 0 || removed > 0` for consistency with the rest of the tag action surface.

## Carry-forward (unchanged — existing deferred backlog)

- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- OC1-01 / D6-08 — historical example secrets in git history
