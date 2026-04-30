# Plan — Cycle 18 Fixes

## Status: COMPLETE

## Findings Addressed

### C18-01: Share rate limit and user-create rate limit don't roll back in-memory counter when DB-backed check returns "limited"
- **Severity:** LOW / Confidence: MEDIUM
- **Files:** `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/admin-users.ts`
- **Implementation:** Added in-memory counter rollback when DB-backed check returns "limited", matching the pattern in `public.ts` `searchImagesAction`.
- **Progress:** [x] Complete — committed as `0000000b55b76c9cb0d2a7bd60596cca3def21ec`

### C18-02: `stripControlChars` does not strip `\x7F` (DEL character)
- **Severity:** LOW / Confidence: LOW
- **Files:** `apps/web/src/lib/sanitize.ts`
- **Implementation:** Extended the regex to include `\x7F`.
- **Progress:** [x] Complete — committed as `0000000840fe20cc50d0bf1c139c018f0261b70e`

### C18-03: `uploadImages` GPS stripping defaults to "keep" when DB is unavailable
- **Severity:** LOW / Confidence: MEDIUM
- **Files:** `apps/web/src/app/actions/images.ts`
- **Implementation:** Changed the catch block to strip GPS by default when config cannot be read.
- **Progress:** [x] Complete — committed as `00000008ffe002c3675b755954972c56ab324604`

## Deferred Items

None — all findings from this cycle have been implemented.
