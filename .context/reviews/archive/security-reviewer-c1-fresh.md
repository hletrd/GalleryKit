# Security Review -- Cycle 1 (Fresh)

**Reviewer**: security-reviewer (c1-fresh)
**Date**: 2026-05-04
**Scope**: OWASP top 10, auth/authz, secrets, unsafe patterns

---

## Assessment Summary

The codebase has strong security fundamentals. Auth uses Argon2, sessions are HMAC-SHA256 with constant-time comparison, rate limiting is implemented at multiple layers, and file uploads are well-hardened with path traversal prevention, symlink rejection, and UUID filenames. The GPS-stripping feature for paid downloads (PP-BUG-3) was recently fixed.

No critical or high-severity security findings were identified in this review cycle. The remaining items are low-severity observations.

---

## LOW FINDINGS

### SEC-LOW-01: Admin Download Button Serves JPEG Derivative Without Access Control
**File**: `apps/web/src/components/photo-viewer.tsx` line 224
**Confidence**: High | **Severity**: Low

The "Download JPEG" button links directly to `/uploads/jpeg/{filename}`, which is a public static file. This is by design -- JPEG derivatives are intended to be publicly accessible. However, for paid-tier photos, the download button is correctly hidden (line 844). The original file download is gated by the token-based endpoint at `/api/download/[imageId]`.

No issue here -- this is correctly implemented.

### SEC-LOW-02: Share Key Generation Uses Base56 with 10 Characters
**File**: `apps/web/src/lib/base56.ts`
**File**: `apps/web/src/app/actions/sharing.ts` line 19

Share keys are 10-character base56 strings. The keyspace is 56^10 = ~3.03 x 10^17, which provides ~58 bits of entropy. This is adequate for share links but could be brute-forced by a determined attacker with enough time and no rate limiting.

The rate limiting on share link creation (20/minute per IP) and the fact that share keys don't grant write access mitigate this. No action needed.

### SEC-LOW-03: CSP Nonce Implementation
**File**: `apps/web/src/lib/csp-nonce.ts`
**File**: `apps/web/src/lib/content-security-policy.ts`

CSP is implemented with nonce-based script allowlisting. This is the correct approach for Next.js applications. No issues found.

### SEC-LOW-04: Download Token Cleared After Use (Privacy)
**File**: `apps/web/src/app/api/download/[imageId]/route.ts` line 196

The `downloadTokenHash` is set to NULL after the atomic claim, preventing replay attacks even if the database is leaked. This is a good privacy practice.

---

## Overall Security Posture: STRONG

The codebase demonstrates defense-in-depth across all critical surfaces:
- Auth: Argon2 + constant-time comparison + rate limiting (IP + account)
- File uploads: UUID filenames + path traversal + symlink rejection + size limits
- SQL: Drizzle ORM parameterization + LIKE escape + advisory locks
- CSRF: requireSameOriginAdmin() on all mutating server actions
- Privacy: GPS stripping, compile-time guards on public select fields
- Headers: X-Content-Type-Options, CSP with nonces
- Session: httpOnly, secure, sameSite cookies with HMAC-SHA256