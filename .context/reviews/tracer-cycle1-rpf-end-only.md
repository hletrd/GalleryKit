# Tracer — Cycle 1 (RPF, end-only deploy mode)

## Causal Tracing of Key Flows

### Flow 1: photo page metadata redirect
1. Visitor hits `/en/old-slug` (non-canonical).
2. `[topic]/page.tsx:144` → `getTopicBySlugCached(topic)` returns topic data.
3. `topicData.slug !== topic` → enter redirect branch (line 151).
4. URL formed via `localizePath(locale, ...)` + `URLSearchParams`.
5. `redirect()` issues 307.
**Hypothesis check:** the redirect preserves the `tags` query param if any,
which is correct UX. URLSearchParams handles encoding correctly. No
injection vector reachable.

### Flow 2: Stripe checkout creation
1. Visitor POSTs `/api/checkout/[imageId]`.
2. `preIncrementCheckoutAttempt(ip)` → returns `true` if over budget.
3. If under budget, `parseInt(imageId)` → fetch image → tier check → price
   lookup → Stripe API call → return URL.
4. Each early-return path calls `rollbackCheckoutAttempt(ip)`.
**Hypothesis check:** rollback on every early-return is consistent with
Pattern 2 (rollback on infrastructure error / non-execution). Verified
manually that all six early-return paths roll back. Stripe API failure
also rolls back (line 142). No counter leakage.

### Flow 3: Stripe webhook entitlement creation
1. Stripe POSTs to `/api/stripe/webhook`.
2. `stripe-signature` header required.
3. `constructStripeEvent(payload, signature)` verifies signature.
4. On `checkout.session.completed`, validate metadata → allowlist tier →
   parse imageId → generate token → `INSERT ON DUPLICATE KEY UPDATE`.
5. Return `{ received: true }`.
**Hypothesis check:** Idempotency is correct (sessionId UNIQUE +
`onDuplicateKeyUpdate({ set: { sessionId } })` is a no-op match). PII
(customer email) is not logged at error level.

## Conclusion
The three high-value flows trace cleanly. No competing-hypothesis
ambiguity remains.
