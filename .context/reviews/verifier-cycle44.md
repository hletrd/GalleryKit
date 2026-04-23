# Verifier — Cycle 44 (2026-04-20)

## Review Scope
Evidence-based correctness verification: validate stated behavior against actual code, check invariant preservation, and verify edge cases.

## Verified Behaviors

### V44-01: Privacy field separation — PASS
**Claim:** `publicSelectFields` omits latitude, longitude, filename_original, user_filename.
**Evidence:** `data.ts` lines 141-161 use destructuring with rest to omit these 4 fields. The compile-time `_privacyGuard` assertion ensures no sensitive keys exist in `publicSelectFields`. All public-facing queries (`getImagesLite`, `getImages`, `getImage`, `getImageByShareKey`, `getSharedGroup`, `searchImages`) use `publicSelectFields` or equivalent. **VERIFIED.**

### V44-02: Session token format validation — PASS
**Claim:** Middleware checks `token.split(':').length !== 3`; server actions verify cryptographically.
**Evidence:** `proxy.ts` line 40 does format check. `verifySessionToken` in `session.ts` lines 99-119 does full HMAC verification with `timingSafeEqual`. **VERIFIED.**

### V44-03: TOCTOU prevention in login rate limiting — PASS
**Claim:** Rate limit counter is pre-incremented before the expensive Argon2 verify.
**Evidence:** `auth.ts` lines 111-117 increment both in-memory and DB counters before `argon2.verify` at line 131. On success, counters are rolled back (lines 141-144). On failure, the pre-increment stands. **VERIFIED.**

### V44-04: Image deletion consistency — PASS
**Claim:** DB deletion and file cleanup are coordinated to handle race conditions.
**Evidence:** `deleteImage` (images.ts) uses a transaction for imageTags + images deletion (lines 355-359), then best-effort file cleanup. Queue state is updated to remove from enqueued set (line 351). `deleteImages` uses the same pattern with `inArray`. **VERIFIED.**

### V44-05: Upload tracker TOCTOU fix — PASS
**Claim:** Pre-increment prevents concurrent uploads from bypassing limits.
**Evidence:** `images.ts` lines 127-129 increment tracker before processing. Post-processing adjustment at lines 287-290 corrects for partial failures. **VERIFIED.**

## New Findings

### V44-06: `uploadImages` topic slug not sanitized before validation [LOW] [HIGH confidence]
**File:** `apps/web/src/app/actions/images.ts` line 58
**Description:** The topic value from form data is not passed through `stripControlChars` before `isValidSlug()` validation. While `isValidSlug` rejects control characters, this breaks the "sanitize before validate" invariant stated in code comments throughout the codebase.
**Consistency:** Matches CR44-01 and CC44-01.

## Verified as Fixed

- C43-01 (locale): Fixed with hardcoded `C.UTF-8`.
- CR43-02 (escapeCsvField): Fixed with control char stripping regex.
