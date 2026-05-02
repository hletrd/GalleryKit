# Security Reviewer — Cycle 3 Review

## Files Reviewed

All source files under `apps/web/src/lib/`, `apps/web/src/app/actions/`, `apps/web/src/app/api/`, `apps/web/src/proxy.ts`, and `apps/web/src/db/`.

## Findings

### C3-SR-01 [HIGH]. `load-more.tsx` — unhandled server action error may expose internal state

- **File+line**: `apps/web/src/components/load-more.tsx`
- **Issue**: When `loadMoreImages` server action re-throws an error (as fixed in cycle 2), the client-side code has no try/catch around the `startTransition` call. In Next.js, unhandled server action errors may leak stack traces or internal error messages in the React error overlay during development. More importantly, in production, the transition simply silently fails — the button remains clickable but does nothing, with no error feedback to the user.
- **Impact**: Denial of usability — user cannot load more images after a transient error. Not a direct security vulnerability, but the lack of error handling means the client cannot distinguish between "no more images" and "server error," potentially leading to repeated failed requests.
- **Confidence**: High
- **Fix**: Wrap the server action call in try/catch with a generic error message to the user. Log the error for monitoring.

### C3-SR-02 [MEDIUM]. `db-actions.ts` — backup download route uses cookie auth but no CSRF token

- **File+line**: `apps/web/src/app/api/admin/db/download/route.ts`
- **Issue**: The backup download route authenticates via `withAdminAuth` (cookie-based), but the download is triggered by a direct GET request. A cross-origin attacker cannot easily trigger this because: (1) the cookie is `httpOnly` and `sameSite: lax`, (2) the `withAdminAuth` wrapper checks same-origin headers. However, `sameSite: lax` allows GET requests from top-level navigations (e.g., clicking a link from another site). If an admin is logged in and clicks a malicious link that navigates to the download route, the browser sends the cookie and the admin's same-origin headers would fail (since the request is cross-origin), so `withAdminAuth` should reject it. The `withAdminAuth` wrapper uses `requireSameOriginAdmin` which checks the `Origin` header, so this is protected.
- **Impact**: Protected by `withAdminAuth` / `requireSameOriginAdmin`. Not exploitable as-is.
- **Confidence**: High (dismissed — not an issue)

### C3-SR-03 [MEDIUM]. `searchImages` — LIKE-based search without length normalization

- **File+line**: `apps/web/src/lib/data.ts:1020-1021`
- **Issue**: The `escaped` variable is built from `query.trim().replace(/[%_\\]/g, '\\$&')`. The `query` length is capped at 200 characters at line 1016, which is reasonable. However, the `searchTerm = '%${escaped}%'` pattern means the actual LIKE pattern is `%(up to 200 chars)%`. MySQL's LIKE performance degrades significantly for long patterns on large tables. The 200-char cap prevents this from being a practical issue at personal-gallery scale.
- **Impact**: No security impact. Performance concern covered by the existing 200-char cap.
- **Confidence**: High (dismissed — not a security issue)

### C3-SR-04 [MEDIUM]. `session.ts` — `verifySessionToken` does not verify the random portion format

- **File+line**: `apps/web/src/lib/session.ts:99-104`
- **Issue**: The session token is parsed with `token.split(':')` and expects exactly 3 parts: `timestamp:random:signature`. The `random` part is validated only implicitly by the HMAC signature check. If an attacker crafts a token with a malformed `random` portion (e.g., containing colons), the `split(':')` would produce more than 3 parts and the token would be rejected at line 101. However, if the `random` portion contains no colons, any string is accepted for that field. The signature check prevents forgery, so this is not a vulnerability.
- **Impact**: None — the HMAC signature check is the security boundary.
- **Confidence**: High (dismissed)

### C3-SR-05 [LOW]. `proxy.ts` — admin auth guard checks cookie but does not verify session validity in middleware

- **File+line**: `apps/web/src/proxy.ts`
- **Issue**: The middleware checks for the presence of the `admin_session` cookie and redirects to login if absent. It does NOT verify the session token's HMAC signature or expiry — that is deferred to the server action's `isAdmin()` call. This means a tampered or expired cookie passes the middleware redirect check but is caught at the action level. This is by design (defense in depth — middleware is a fast redirect, action is the authoritative check).
- **Impact**: None — defense in depth is maintained.
- **Confidence**: High (acknowledged as correct design)

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| HIGH | 1 | Error handling |
| MEDIUM | 0 | — |
| LOW | 1 | Acknowledged design |

**Verdict: FIX AND SHIP** — The `load-more.tsx` error handling gap overlaps with C3-CR-01 and should be fixed. No new security vulnerabilities found. The existing defense-in-depth layers (cookie httpOnly + sameSite, HMAC session tokens, same-origin checks, `withAdminAuth` wrapper) are working correctly.
