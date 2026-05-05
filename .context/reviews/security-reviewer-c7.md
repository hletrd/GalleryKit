# Security Review — Cycle 7

## Summary

The codebase maintains a strong security posture with defense-in-depth patterns across auth, rate limiting, file serving, and input validation. Most prior-cycle security findings have been addressed. Two confirmed issues and one architectural gap remain.

---

## C7-SEC-01: `/api/og/photo/[id]/route.tsx` missing rate limiting — High Confidence

**File:** `apps/web/src/app/api/og/photo/[id]/route.tsx`
**Lines:** 30-181 (entire GET handler)

**Finding:** The per-photo OG image route performs CPU-intensive work (fetch image, base64 encode, render SVG via Satori/ImageResponse) but does NOT call `preIncrementOgAttempt()` or any other rate-limit helper. The `rate-limit.ts` module defines `ogRateLimit`, `preIncrementOgAttempt`, and `rollbackOgAttempt` (AGG8F-01 / plan-233), but these are only used in the main `/api/og/route.tsx` — NOT in the `/api/og/photo/[id]/route.tsx` sub-route.

**Failure scenario:** An attacker can request `/api/og/photo/1`, `/api/og/photo/2`, etc. in rapid succession to pin Node CPU at 100% per request (~200-400ms each), degrading the entire application. With no rate-limit gate, a single IP can generate unlimited OG images.

**Fix:** Add the same OG rate-limit pattern used in the main `/api/og/route.tsx`:
```typescript
import { preIncrementOgAttempt, rollbackOgAttempt, getClientIp } from '@/lib/rate-limit';
// At top of GET handler:
const ip = getClientIp(req.headers);
if (preIncrementOgAttempt(ip, Date.now())) {
    return new Response('Rate limited', { status: 429, headers: { 'Cache-Control': 'no-store' } });
}
// On early returns (invalid id, image not found), call rollbackOgAttempt(ip)
```

**Note:** The `check-public-route-rate-limit.ts` lint gate does NOT catch this because it only scans POST/PUT/PATCH/DELETE handlers, not GET. This is both a route bug and a lint-gap bug.

---

## C7-SEC-02: `withAdminAuth` wrapper omits Cache-Control on success responses — Medium Confidence

**File:** `apps/web/src/lib/api-auth.ts`
**Lines:** 100-104

**Finding:** The `withAdminAuth` wrapper sets `X-Content-Type-Options: nosniff` on successful responses, but does NOT set `Cache-Control: no-store`. The `NO_STORE_HEADERS` constant (lines 7-12) is only applied to error responses (401/403). Admin API routes like `/api/admin/db/download` return sensitive data (database backups) that should never be cached by browsers or intermediate CDNs.

**Failure scenario:** A reverse proxy or browser caches a successful admin API response. A subsequent request from a different session might receive the cached response without re-authentication.

**Fix:** In `withAdminAuth`, after `await handler(...args)`, add:
```typescript
if (!response.headers.has('Cache-Control')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
}
```

---

## C7-SEC-03: `check-public-route-rate-limit.ts` lint gate covers only mutating HTTP methods — Medium Confidence

**File:** `apps/web/src/scripts/check-public-route-rate-limit.ts`
**Lines:** 32, 74-110

**Finding:** The lint gate's `MUTATING_METHODS` set is `{POST, PUT, PATCH, DELETE}`. CPU-intensive GET routes like `/api/og/photo/[id]` and `/api/og` are exempt from the gate by design, even though they can be abused for DoS. The comment says the gate is for "mutating handlers," but the architectural gap means expensive GET surfaces are not audited.

**Fix options:**
1. Expand the gate to also cover GET handlers that perform expensive work (requires heuristic detection of `ImageResponse`, `fetch`, file reads, etc.).
2. Document the GET-exemption explicitly in the script header and require `@public-no-rate-limit-required: <reason>` on all GET routes that call expensive code.
3. Add a separate lint gate for "expensive GET routes."

Recommended: option 2 — require explicit opt-out for expensive GET routes.

---

## C7-SEC-04: `admin-tokens.ts` `verifyToken` DB lookup by hash lacks timing-safety — Low Confidence

**File:** `apps/web/src/lib/admin-tokens.ts`
**Lines:** 136-166

**Finding:** `verifyToken` hashes the presented token and queries `WHERE token_hash = ${presentedHash}`. The MySQL string comparison is NOT timing-safe. While the subsequent `tokenHashesEqual` uses `timingSafeEqual`, the DB query itself could leak via timing whether a hash prefix matches (especially with indexed lookups). For a 256-bit token, this is not exploitable in practice, but the defense-in-depth posture would be improved by:

1. Fetching ALL tokens (or a bucket of tokens) and doing the comparison in application code, OR
2. Adding a HMAC-based blinded lookup.

**Confidence:** Low — theoretical concern, not practically exploitable given the entropy.

---

## Commendations

- The `requireSameOriginAdmin()` defense-in-depth is consistently applied across all mutating server actions.
- The account-scoped rate limiting (per-username, not just per-IP) in `auth-rate-limit.ts` correctly prevents distributed brute-force.
- `stripGpsFromOriginal` (PP-BUG-3) correctly strips GPS EXIF from the on-disk original before the paid-download endpoint can leak it.
- The blur_data_url producer-side validation (`assertBlurDataUrl`) closes the symmetric defense between producer and consumer.
- The compile-time privacy guards (`_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`) in `data.ts` prevent accidental PII leakage.
