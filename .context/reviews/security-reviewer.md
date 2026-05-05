# Security Review — Cycle 19

## Method

Focused on auth surfaces (session, login, password change, same-origin checks), rate-limiting consistency, public API route hardening, download token enforcement, Stripe webhook integrity, and service-worker cache isolation. Examined auth.ts, session.ts, rate-limit.ts, action-guards.ts, request-origin.ts, download route, checkout route, webhook route, and sw.js.

---

## Findings

### C19-SR-01 (MEDIUM): `check-public-route-rate-limit.ts` crashes in ESM — lint gate bypass

- **Source**: `apps/web/scripts/check-public-route-rate-limit.ts:179`
- **Issue**: Same as C19-CR-01. The `require.main === module` expression throws `ReferenceError` in ESM before the `typeof require === 'undefined'` guard is evaluated. If this file is ever loaded in an ESM context (e.g., future Node.js default, or a test runner configured for ESM), the lint gate script crashes on import instead of running. This means a CI pipeline that relies on this gate would fail to enforce public-route rate limiting.
- **Security impact**: A broken lint gate cannot catch future public API routes that miss rate limiting. This is a process-control failure, not an immediate vulnerability.
- **Fix**: Same as C19-CR-01: reorder the typeof check before `require.main` access.
- **Confidence**: High

### C19-SR-02 (LOW): `sw.js` caches 401/403 rejection but comment says "never cached"

- **Source**: `apps/web/public/sw.js:45-50`
- **Issue**: `isSensitiveResponse` returns `true` for 401/403 and `no-store`. The `staleWhileRevalidateImage` function returns the sensitive response at line 121 without caching it. However, in `networkFirstHtml`, `isSensitiveResponse` is checked at line 146, and if true, the response is returned without caching. The comment at line 8 says "401/403 responses: never cached" which is accurate for the current code paths.
- **However**, there is a subtle gap: the `staleWhileRevalidateImage` function at line 132 does `revalidate.catch(() => {}); return cached;` when a cached copy exists. If the revalidation returns 401 (e.g., admin changed permissions on the image), the background revalidation promise resolves with the 401 response, but it is NOT cached because of the `isSensitiveResponse` check. Good.
- **No active issue found here** — the 401/403 handling is correct.

### C19-SR-03 (LOW): `semantic/route.ts` same-origin check does not verify method

- **Source**: `apps/web/src/app/api/search/semantic/route.ts:66-68`
- **Issue**: The route exports only `POST` and has a same-origin check with `hasTrustedSameOrigin(request.headers)`. A cross-origin GET request to this endpoint would hit the Next.js default handler (405 Method Not Allowed) before the same-origin check, because there's no exported `GET`. But if Next.js ever changes this behavior or if a future refactor adds a `GET` handler, the same-origin check would apply to it too. This is a minor observation, not an active vulnerability.
- **Confidence**: Low (informational)

---

## Confirmed still secure

- Session tokens: HMAC-SHA256 with timingSafeEqual, 24h expiry, httpOnly secure lax cookies. Good.
- Login rate limiting: Dual-bucket (IP + account-scoped) with DB persistence. TOCTOU fix confirmed.
- Password change: Separate rate-limit map, Argon2 verify before hash update, session rotation in transaction.
- Download tokens: SHA-256 hash storage, single-use atomic claim, path traversal checks (lstat + realpath + startsWith), symlink rejection.
- Stripe webhook: Signature verification mandatory, idempotency on sessionId, tier allowlist, zero-amount rejection.
- Same-origin: `hasTrustedSameOrigin` with Origin/Referer/Host reconciliation, default-port stripping, proxy-aware protocol detection.
