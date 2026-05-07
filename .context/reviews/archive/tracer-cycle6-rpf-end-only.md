# tracer — Cycle 6 RPF (end-only)

## Method

Causal-chain pass over Stripe Checkout + webhook + refund flows. For
each, identify upstream → downstream signal degradation.

## Findings

### TR-01 — Checkout idempotency missing, parallel to cycle 5 refund fix
- **Causal chain:**
  - User clicks Buy → POST /api/checkout/[imageId]
  - Server: rate-limit → DB SELECT → Stripe.checkout.sessions.create
    (no idempotency key) → return URL
  - Browser double-click → second POST → second Stripe session
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:123`
- **Cross-agent:** matches code-reviewer CR-02, security-reviewer SEC-01,
  architect ARCH-01, debugger DBG-01.
- **Confidence:** High.
- **Severity:** Low.

### TR-02 — Webhook invalid-imageId log loses sessionId correlation key
- **Causal chain:**
  - Stripe Checkout misconfig → metadata.imageId="abc"
  - webhook signature verify passes (signature is on the whole event,
    not the metadata)
  - parseInt fails → `console.error('Stripe webhook: invalid imageId in
    metadata', imageIdStr)` — sessionId NOT in the structured object
  - operator search by sessionId → no match → blind triage
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:195`
- **Cross-agent:** matches code-reviewer CR-01, architect ARCH-02,
  debugger DBG-02.
- **Confidence:** High.
- **Severity:** Low.

### TR-03 — `error.message` from Stripe leaks into action return
- **Causal chain:**
  - Stripe API call fails with `err.message="stripe: rate-limited (request id req_xyz)"`
  - catch block returns `{ error: err.message, errorCode: 'network' }`
  - client `mapErrorCode(result.errorCode, t)` consumes `errorCode`,
    ignores `error`
  - latent: future `console.warn(result.error)` for debugging would
    leak `req_xyz` to client logs
- **File:** `apps/web/src/app/actions/sales.ts:201-205`
- **Cross-agent:** matches code-reviewer CR-03, security-reviewer SEC-05,
  architect ARCH-03, debugger DBG-04.
- **Confidence:** Medium.
- **Severity:** Low.

### TR-04 — `mapStripeRefundError` unknown branch swallows new Stripe types
- **Causal chain:**
  - Stripe ships new error type (e.g., `StripeIdempotencyError`)
  - mapping table returns 'unknown'
  - client toasts "Refund failed" (generic)
  - operator only sees the raw error via `console.error` at sales.ts:200
  - no proactive metric/warn → operator doesn't know the table needs
    updating until customers complain
- **File:** `apps/web/src/app/actions/sales.ts:144`
- **Cross-agent:** matches critic CRIT-03, debugger DBG-03.
- **Confidence:** Medium.
- **Severity:** Low.

### TR-05 — Webhook oversized-email reject log lacks `cap` self-documentation
- **Causal chain:**
  - email arrives length=1024
  - reject log `{ sessionId, length: 1024 }` — no cap mentioned
  - operator must consult source to know the threshold
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:133-140`
- **Cross-agent:** matches code-reviewer CR-04, debugger DBG-05.
- **Confidence:** Medium.
- **Severity:** Informational.

## Cycle 1-5 trace verification

- Refund retry trace (cycle 5 P388-01): idempotency-key prevents
  double-charge on retry. Verified.
- Async-paid webhook trace (cycle 3 P262-01): `unpaid` returns 200
  without minting token. Verified.
- AbortError trace (cycle 5 P388-05): handles non-Error throws BEFORE
  instanceof guard. Verified.

All cycle 1-5 traces hold.
