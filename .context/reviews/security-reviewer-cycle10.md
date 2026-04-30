# Security Review — security-reviewer (Cycle 10)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high security findings.
- Two low findings (consistency / defense-in-depth).
- All prior security fixes confirmed intact.

## Verified fixes from prior cycles

All prior security findings confirmed addressed:

1. C9-SEC-01 (raw SQL in deleteAdminUser): Acknowledged — parameterized with `?` and input-validated. The `affectedRows` check from C10R3-03 is now also in place.
2. C9-SEC-02 (tagsString `.length`): FIXED — now uses `countCodePoints()`.
3. C9-SEC-03 (withAdminAuth origin check): FIXED — AGG9R-02 added `hasTrustedSameOrigin` to `withAdminAuth`.
4. C10R3-01 (OG route topic validation): FIXED — `isValidSlug()` now enforced.
5. C10R3-02 (OG route tag validation): FIXED — `isValidTagName()` now enforced.

## New Findings

### C10-SEC-01 (Low / Medium). `addTagToImage` audit log fires on no-op INSERT IGNORE (duplicate) — misleading audit trail

- Location: `apps/web/src/app/actions/tags.ts:191`
- The `db.insert(imageTags).ignore()` at line 176 silently drops duplicate rows (affectedRows = 0). The subsequent audit log on line 191 fires unconditionally, recording a `tag_add` event even when no tag was actually added. This is a minor audit integrity issue.
- The same pattern appears in `batchUpdateImageTags` (tags.ts:403-404), but that code correctly gates the `added++` counter on `affectedRows > 0`.
- Suggested fix: Gate the audit log on `linkResult.affectedRows > 0` or on the image-existence check result.

### C10-SEC-02 (Low / Low). `isValidSlug` and `isValidTagSlug` use `.length` for length bounds — consistency with `countCodePoints` adoption

- Location: `apps/web/src/lib/validation.ts:23,96`
- These validators use `.length` for length bounds. `isValidSlug` is ASCII-only (regex restricts to `[a-z0-9_-]`), so `.length` is safe. `isValidTagSlug` allows Unicode letters/numbers but BMP supplementary-free characters dominate in practice.
- Not a security issue — `.length` is more restrictive, not more permissive.
- Suggested fix: Add comments documenting safety, or adopt `countCodePoints` for uniformity.

## Carry-forward (unchanged — existing deferred backlog)

- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- OC1-01 / D6-08 — historical example secrets in git history
