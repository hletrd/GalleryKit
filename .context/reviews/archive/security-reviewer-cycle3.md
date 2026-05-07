# Security Reviewer — Cycle 3

## Review method

Security-focused review of all authentication, authorization, input validation,
output encoding, and session management surfaces. Focus on the recent i18n/search
refactor and any new attack surfaces. OWASP Top 10 lens applied.

---

## Findings

### No new security findings this cycle

The recent changes (commit fffe9df) are exclusively i18n key removals and status-type
simplification. These changes:

1. **Remove dead keys** — reducing attack surface, not expanding it
2. **Unify search status** — `'failed' | 'error'` → `'error'`, simplifying the status
   handling with no security impact
3. **Strengthen restore warning** — `db.restoreWarning` now includes irreversibility
   notice, improving user awareness before destructive action
4. **Normalize number formats** — adding thousands separators to user-facing messages,
   no security impact

All security-critical surfaces re-verified:
- Auth flow: Argon2, HMAC-SHA256, timingSafeEqual, dual rate-limit buckets — correct
- CSRF: requireSameOriginAdmin + withAdminAuth origin checks — correct
- Input validation: Unicode bidi/invisible char rejection, countCodePoints — correct
- Privacy: publicSelectFields compile-time guard, GPS exclusion — correct
- Upload: path traversal prevention, symlink rejection, UUID filenames — correct
- CSP: nonce-based script-src, frame-ancestors, base-uri — correct
- dangerouslySetInnerHTML: all 5 usages go through safeJsonLd — correct
- No eval(), no innerHTML, no window.open — correct

---

## Carry-forward deferred backlog (unchanged)

- A17-MED-02 / C14-LOW-06: CSP style-src 'unsafe-inline' in production
- D1-MED: No CSP header on API route responses
- D4-MED: CSP unsafe-inline
- All other items from prior deferred lists
