# Security Reviewer — Cycle 1 Fresh Review

**Date**: 2026-05-05
**Scope**: OWASP Top 10, auth/authz, secrets, unsafe patterns, and security architecture.

---

## FINDINGS

### SEC-01: Service Worker serves stale HTML indefinitely (High)
**File**: `apps/web/public/sw.template.js`
**Lines**: 133-159

Cross-file finding with code-reviewer BUG-01. The `networkFirstHtml` function caches HTML responses without timestamping them. The `sw-cached-at` age check at line 148 is unreachable dead code because the header is never set during cache insertion (line 139).

**Security impact**: Cached HTML may contain CSRF tokens, nonces, or session-dependent content that becomes stale. Serving indefinite stale HTML could lead to broken admin pages post-deployment if JS bundles change names (hash-based filenames). A user with a stale HTML shell might load mismatched JS chunks, causing runtime errors or unexpected behavior.

**Fix**: Stamp `sw-cached-at` on cached HTML responses. See code-reviewer BUG-01 for patch.

---

### SEC-02: check-public-route-rate-limit.ts export-specifier blind spot (Medium)
**File**: `apps/web/scripts/check-public-route-rate-limit.ts`
**Lines**: 75-91

A new public API route using `export { handler as POST }` would bypass the lint gate. Since the gate is security-critical (ensures all public mutating endpoints have rate limiting), a false negative could ship an unmetered mutation surface.

**Confidence**: Medium — requires future code to use the export-specifier pattern, which is uncommon in Next.js App Router.

**Fix**: Add `ts.isExportDeclaration` traversal to the AST walker.

---

### SEC-03: Exempt tag substring match allows string-literal bypass (Low)
**File**: `apps/web/scripts/check-public-route-rate-limit.ts`
**Line**: 99

A developer could inadvertently (or maliciously) include `@public-no-rate-limit-required` in a string literal, causing the lint gate to exempt a file that lacks an actual comment-based exemption.

**Fix**: Match only within comment contexts.

---

## SECURITY POSTURE ASSESSMENT

| Area | Rating | Notes |
|------|--------|-------|
| Auth (Argon2id + sessions) | Excellent | Timing-safe verify, session fixation protection, password-change rotation |
| Rate limiting | Excellent | IP + account scoped, DB-backed with rollback patterns |
| Input validation | Excellent | Unicode format char rejection, path traversal prevention, symlink rejection |
| Upload security | Excellent | UUID filenames, Sharp limits, extension whitelist |
| CSRF/Same-origin | Excellent | `hasTrustedSameOrigin` on all mutating actions |
| CSP | Good | Nonce-based CSP in production, middleware-level injection |
| Service Worker | Fair | Missing cache expiry stamp is the only gap |

## VERDICT

The codebase maintains a strong security posture. No critical vulnerabilities were found. One high-severity reliability issue (SW cache expiry) has security-adjacent impact. Two lint-gate edge cases are preventive rather than active exploits.
