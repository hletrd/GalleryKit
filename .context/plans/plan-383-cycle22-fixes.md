# Plan 383 — Cycle 22 Fixes

**Created:** 2026-04-30 (Cycle 22)
**Status:** Done

## C20-MED-01: BigInt coercion risk on `Number(result.insertId)` across all three sites

- **Source**: `apps/web/src/app/actions/sharing.ts:247`, `apps/web/src/app/actions/admin-users.ts:145`, `apps/web/src/app/actions/images.ts:336`
- **Severity/Confidence:** MEDIUM / MEDIUM
- **Cross-cycle history**: Previously flagged as C14-MED-03 / C30-04 / C36-02 / C8-01 / C19F-MED-02 (sharing.ts only). Cycle 20 review identified the same pattern in admin-users.ts and images.ts. All three sites share the same risk class.
- **Plan**: Add a safe `safeInsertId()` helper that validates `result.insertId` is within `Number.MAX_SAFE_INTEGER` before coercing with `Number()`. Use this helper at all three sites. If the insertId exceeds safe integer range, throw an error (this should never happen at personal-gallery scale).
- **Implementation**:
  1. Add `safeInsertId()` to `apps/web/src/lib/validation.ts` (or a new `db-utils.ts` if validation.ts is the wrong home)
  2. Update `sharing.ts:247` to use `safeInsertId(result.insertId)`
  3. Update `admin-users.ts:145` to use `safeInsertId(result.insertId)`
  4. Update `images.ts:336` to use `safeInsertId(result.insertId)`
  5. Add a test for `safeInsertId` with BigInt edge cases
- **Progress**: [x] implementation

## C20-LOW-02: `tag_concat` comma separator assumption in getImageByShareKey

- **Source**: `apps/web/src/lib/data.ts:891,913-918`
- **Severity/Confidence:** LOW / LOW
- **Plan**: Use an explicit `SEPARATOR '\x01'` in the GROUP_CONCAT call and split on `\x01` instead of comma. This makes the parsing robust against any future change to MySQL's default separator or tag slug format.
- **Progress**: [x] implementation

## Deferred Items (no change from plan 382)

All previously deferred items from plan 382 remain deferred with no change in status. No new deferred items from this cycle.
