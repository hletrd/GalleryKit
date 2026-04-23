# Security Review — Cycle 21

**Reviewer:** security-reviewer
**Date:** 2026-04-19

## Review Scope

Full repository scan focusing on OWASP top 10, secrets, unsafe patterns, auth/authz.

## Findings

### SEC-21-01: `uploadImages` disk space check (`statfs`) can be bypassed by concurrent uploads [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 93-101
- **Description:** The disk space pre-check uses `statfs` before the upload loop. Between the check and the actual file writes, other processes or concurrent upload requests could consume the remaining disk space. This is a TOCTOU issue, but the impact is limited — the upload would simply fail when `fs.writeFile` can't allocate space, and the error is caught.
- **Concrete failure scenario:** Two admins upload simultaneously. Both pass the 1GB free check. Their combined writes exceed the remaining space. One upload fails partway through, leaving a partial file. The partial file is cleaned up by the error handler.
- **Fix:** This is a low-priority TOCTOU that's inherent to filesystem operations. The existing error handling catches the failure case. No fix required unless disk space exhaustion is a common operational issue.

### SEC-21-02: Session cookie `Secure` flag depends on `x-forwarded-proto` header which can be spoofed [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/auth.ts` lines 172-174
- **Description:** The `requireSecureCookie` logic checks `x-forwarded-proto` header. In a deployment without a trusted reverse proxy that strips/overwrites this header, an attacker could send `x-forwarded-proto: https` over plain HTTP, causing the session cookie to be set with `Secure: true` but transmitted over an unencrypted connection. However, this is only exploitable if the app is directly exposed without a reverse proxy. The Docker deployment uses nginx, which should set this header. This is a deployment-dependent risk.
- **Concrete failure scenario:** App deployed behind a misconfigured reverse proxy that doesn't strip incoming `x-forwarded-proto`. Attacker sends request with `x-forwarded-proto: https` over HTTP. Cookie is set with `Secure` flag but sent over plaintext. Session token is intercepted.
- **Fix:** Document that the reverse proxy MUST strip/overwrite `x-forwarded-proto`. Consider adding a `TRUST_PROXY` env var that must be explicitly set to trust forwarded headers.
- **Status:** DEFERRED — deployment-dependent, not a code bug. Adding to deferred items with exit criterion: "when the app is deployed without a properly configured reverse proxy."

### SEC-21-03: Verified previous fixes — no regressions [INFO]
- **Description:** The upload tracker clamping (C20-01), `deleteAdminUser` no-op fix (C20-02), and `revokePhotoShareLink` race condition fix (C19-01) are all properly implemented and working as intended. The pre-increment TOCTOU fix pattern is consistently applied across login, password change, admin user creation, and share link creation. The privacy guard in `data.ts` correctly excludes latitude, longitude, filename_original, and user_filename from public queries.

## Summary
- 0 CRITICAL findings
- 1 MEDIUM finding (deployment-dependent, deferred)
- 1 LOW finding (TOCTOU on statfs, inherent limitation)
- 1 INFO finding
