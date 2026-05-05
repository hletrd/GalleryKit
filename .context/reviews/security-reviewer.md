# Cycle 17 Security Review — security-reviewer

Date: 2026-05-06
Scope: Full repository, post-cycle-16 state
Focus: OWASP Top 10, auth/authz, injection, secrets, unsafe patterns

## Findings

### MEDIUM SEVERITY

**C17-SEC-01: withAdminAuth duck-typed header extraction may bypass origin check**
- **File:** `apps/web/src/lib/api-auth.ts` (lines 53-58)
- **Confidence:** Medium
- **Problem:** The `headers` variable is resolved via duck typing: `(request && 'headers' in request && typeof request.headers?.get === 'function')`. If a malformed request object passes this check but doesn't actually have meaningful headers, `headers` could be truthy but empty, causing `hasTrustedSameOrigin` to receive an empty header store. The `hasTrustedSameOrigin` function in `request-origin.ts` would then fall through its checks and potentially return `false`, which is safe (deny-by-default). However, the duck typing is fragile.
- **Fix:** Type-narrow explicitly using `request instanceof NextRequest` or similar.

### LOW SEVERITY

**C17-SEC-02: download route Content-Type is application/octet-stream for all originals**
- **File:** `apps/web/src/app/api/download/[imageId]/route.ts` (line 241)
- **Confidence:** Low
- **Problem:** The download endpoint returns `Content-Type: application/octet-stream` for all original files, regardless of actual image format. While the `Content-Disposition: attachment` header forces a download, a browser might still sniff the content type. Combined with `X-Content-Type-Options: nosniff`, this is mostly mitigated, but serving the actual MIME type (e.g., `image/jpeg`, `image/heic`) would be cleaner.
- **Fix:** Map common extensions to MIME types for the Content-Type header.

**C17-SEC-03: checkout route idempotency key uses raw IP**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts` (line 147)
- **Confidence:** Low
- **Problem:** `const idempotencyKey = \`checkout-${image.id}-${ip}-${Math.floor(Date.now() / 60_000)}\`;` If `ip` is `'unknown'` (when TRUST_PROXY is not set), all users share the same idempotency key within a minute window. This means concurrent checkout attempts from different users for the same image within the same minute would be deduplicated by Stripe, causing one user to receive another's checkout session URL.
- **Fix:** Include a per-request nonce in the idempotency key, or use a session-derived identifier.

## Previously Deferred Security Items

- C16-HIGH-01 (SW metadata race): Deferred. Not a direct security issue but could allow cache budget exhaustion.
- C16-LOW-04 (SW caches non-image responses): Deferred. Could cache HTML as image if server misconfigured.

## Verdict

No new critical or high-severity security findings. The codebase maintains strong security posture with Argon2id, HMAC-SHA256 sessions, rate limiting, same-origin guards, path traversal prevention, and SQL parameterization throughout. The idempotency key collision is a corner case that only manifests in misconfigured deployments without TRUST_PROXY.
