# Verifier Review — verifier (Cycle 9)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Evidence-based correctness check

### Gate verification

| Gate | Status |
|------|--------|
| eslint | Running (background) |
| tsc --noEmit | Pending |
| vitest | Running (background) |
| lint:api-auth | PASS |
| lint:action-origin | PASS |

### Verified behavior

1. **sanitizeAdminString stateful regex fix (AGG8R-01)**: VERIFIED — `sanitize.ts:141` now uses `UNICODE_FORMAT_CHARS` (imported from `validation.ts`) for `.test()`, which is non-`/g`. The `UNICODE_FORMAT_CHARS_RE` (with `/g`) is still used for `.replace()` in `stripControlChars` at line 20. The import on line 5 confirms the correct source.

2. **countCodePoints adoption (AGG8R-02)**: VERIFIED — `topics.ts:107,207` and `seo.ts:97,100,103,106,109,115` all use `countCodePoints()`. The import is present in both files (`topics.ts:32`, `seo.ts:13`).

3. **sanitizeAdminString unit test (AGG8R-03)**: VERIFIED — `__tests__/sanitize-admin-string.test.ts` exists and covers the key scenarios including the stateful-regex regression test (calling the function twice on bidi-containing input).

4. **Privacy enforcement**: `publicSelectFields` still omits all sensitive fields. Compile-time guard `_SensitiveKeysInPublic` still enforces no leakage.

5. **Auth flow**: Login rate limiting still pre-increments before Argon2 verify. Password change validates form fields before consuming rate-limit attempts (C9R-RPL-01 fix from a prior cycle is still in place).

6. **Upload flow**: Full pipeline from FormData to DB insert to queue enqueue verified. `assertBlurDataUrl` contract enforced at both producer (`process-image.ts:407`) and consumer (`images.ts:308`).

### Verified fixes from prior cycles

1. C8-V-01 (stateful regex): VERIFIED — non-`/g` regex now used for `.test()`.
2. C8-V-02 (`.length` vs code points): VERIFIED — `countCodePoints()` used in topics/seo.

### New Findings

#### C9-V-01 (Low / Medium). `withAdminAuth` wrapper lacks origin verification — API route provenance posture weaker than server actions

- Location: `apps/web/src/lib/api-auth.ts:14-26`
- Verified that `withAdminAuth` only checks `isAdmin()` (session cookie) and does NOT call `hasTrustedSameOrigin()`. Every mutating server action uses `requireSameOriginAdmin()`, but API routes using `withAdminAuth` get no origin check.
- The only admin API route (`/api/admin/db/download/route.ts`) adds its own explicit `hasTrustedSameOriginWithOptions` check at line 27, which mitigates the issue for that specific route.
- However, a future admin API route added with only `withAdminAuth` would lack origin verification.
- Suggested fix: Add `hasTrustedSameOrigin` check to `withAdminAuth` wrapper.

#### C9-V-02 (Low / Low). Remaining `.length` usages for DoS bounds in `images.ts:139` and `public.ts:116` — inconsistent with `countCodePoints` adoption

- Location: `apps/web/src/app/actions/images.ts:139` and `apps/web/src/app/actions/public.ts:116`
- These are DoS-prevention bounds, not varchar boundaries. The security impact is nil (more restrictive, not less). Flagged for consistency only.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
- C4-CR-03/C5-CR-03/C6-V-01: NULL `capture_date` navigation integration test gap.
