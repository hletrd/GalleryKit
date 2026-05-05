# Cycle 18 — Security Reviewer Findings

Date: 2026-05-06
Scope: Full repository, post-cycle-17 fixes
Focus: OWASP Top 10, auth/authz, injection, secrets, unsafe patterns

## Verified Prior Fixes

- C17-SEC-01 / C17-SEC-03 (checkout idempotency collision): Addressed by 80a1956, but see C18-HIGH-01 for regression.
- C16-LOW-05 (stricter cookie validation): Still in place, verified correct.
- C17-LOW-02 (withAdminAuth duck typing): Still present, low risk.

---

## New Findings

### HIGH SEVERITY

**C18-HIGH-01: Stripe idempotency key non-determinism breaks deduplication, enables duplicate session creation**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:150-151`
- **Confidence:** HIGH
- **OWASP category:** A01:2021 – Broken Access Control (business logic flaw)
- **Problem:** The idempotency key includes `randomUUID()`, making it unique per request. Stripe creates a new Checkout session for every distinct key. A malicious or accidental double-click creates duplicate unpaid sessions. While no direct security exploit, this is a business-logic flaw that can lead to confused users, chargeback disputes, and false-positive payment monitoring alerts.
- **Suggested fix:** Hash the session cookie (or a fingerprint of IP + UA + imageId + minute) for deterministic per-user keys. If no session exists, accept that deduplication requires TRUST_PROXY to be configured.

---

### LOW SEVERITY

**C18-LOW-01: Service Worker cache key mismatch may allow unbounded growth**
- **File:** `apps/web/public/sw.template.js:94`
- **Confidence:** MEDIUM
- **Problem:** As noted by code-reviewer C18-MED-01, the cache key mismatch between `put(Request)` and `delete(string)` could allow the image cache to grow beyond the declared 50 MB limit. While browser quota eviction provides a safety net, this violates the application's stated cache policy and could exhaust device storage on long-lived sessions.
- **Suggested fix:** Use consistent Request-object keys for both put and delete operations.

**C18-LOW-02: Semantic search body size guard accepts empty Content-Length**
- **File:** `apps/web/src/app/api/search/semantic/route.ts:76-90`
- **Confidence:** LOW
- **Problem:** The `contentLengthNum > MAX_SEMANTIC_BODY_BYTES` check accepts `contentLength: 0` and missing Content-Length. While the JSON parse will catch empty bodies, an explicit `contentLengthNum < 0` guard would reject negative values (which are protocol-illegal but could be sent by a malicious client).
- **Suggested fix:** Add `contentLengthNum < 0` to the rejection condition.
