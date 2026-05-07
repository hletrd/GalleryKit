# architect — Cycle 6 RPF (end-only)

## Method

Architectural-shape pass over Stripe Checkout/webhook/refund triangle,
download-token issuance, and admin sales surface.

## Findings

### ARCH-01 — Idempotency posture asymmetry: refund has Idempotency-Key, checkout does not
- **Files:** `apps/web/src/app/actions/sales.ts:187-190`,
  `apps/web/src/app/api/checkout/[imageId]/route.ts:123`
- **Severity:** Low | Confidence: High
- **What:** Cycle 5 P388-01 introduced an Idempotency-Key on
  `stripe.refunds.create`. The same Stripe-best-practice should apply to
  every Stripe POST mutation, but `stripe.checkout.sessions.create` was
  left without one. Architectural-shape inconsistency: half the surface
  is hardened, half isn't. Operators reading the cycle-5 diff would
  reasonably expect the checkout route to follow the same pattern in the
  next cycle.
- **Why this matters:** the symmetry is also a knowledge-transfer aid —
  a future contributor learning from one route's idempotency pattern
  has a 50% chance of reading the un-protected one and concluding "we
  don't bother."
- **Fix:** mirror the refund pattern in the checkout route. Use a
  bounded-window deterministic key
  (`checkout-${imageId}-${ip}-${Math.floor(Date.now() / 60_000)}`)
  so distinct legitimate buys at minute boundaries don't collapse.

### ARCH-02 — Webhook log shape: one outlier remains after cycle 5 P388-02
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:195`
- **Severity:** Low | Confidence: High
- **What:** Cycle 5 P388-02 converted the two known legacy log lines
  (idempotent skip, entitlement created) to structured-object form. One
  legacy survivor remains: line 195 logs `imageIdStr` positionally as
  the second argument. Architecturally, the webhook should have a
  uniform log shape across ALL of its info/warn/error lines. The fix
  is mechanical and aligns with the cycle-5 docstring intent.
- **Fix:** convert to
  `console.error('Stripe webhook: invalid imageId in metadata', { sessionId, imageIdStr })`.

### ARCH-03 — Refund return shape: `error` (string) and `errorCode` (enum) carry duplicate intent
- **File:** `apps/web/src/app/actions/sales.ts:147,201-205`
- **Severity:** Low | Confidence: Medium
- **What:** `refundEntitlement` returns
  `{ error?: string; errorCode?: RefundErrorCode; success?: true }`. The
  `error` field is `err.message` in the catch path, but the client only
  consumes `errorCode` (via `mapErrorCode`). The `error` field is
  effectively dead but un-typed-deprecated. Future devs will see it and
  build new client features against it, then quietly leak Stripe request
  IDs into UI toasts.
- **Why this matters:** API surface drift. The action's return type is
  the contract; ambiguous fields rot the contract.
- **Fix:** drop `error` from the action's return type entirely (the
  client-visible signal is `errorCode`). Update tests + types.

### ARCH-04 — `getStripe()` singleton key validation on first call only
- **File:** `apps/web/src/lib/stripe.ts:21-33`
- **Severity:** Informational | Confidence: High
- **What:** Lazy validation of `STRIPE_SECRET_KEY` is intentional (server
  starts in dev without paid images). Sound design. No fix.

### ARCH-05 — `apiVersion: '2026-04-22.dahlia'` pinned in stripe.ts
- **File:** `apps/web/src/lib/stripe.ts:28`
- **Severity:** Informational | Confidence: Low
- **What:** Stripe pins the SDK to a specific dated/named API version.
  Stripe's `dahlia` was published 2026-04-22; SDK version `^22.1.0` per
  package.json. Verifying via `context7` would confirm currency, but it
  is informational — the pin matches a real published Stripe version
  and the SDK supports it.
- **Status:** documentation/verification opportunity for next research
  cycle; not a defect.

## Cycle 1-5 architectural claims

- US-P54 idempotency posture (sessionId UNIQUE + SELECT-then-INSERT):
  intact.
- License tier allowlist single source: intact in `lib/license-tiers.ts`.
- Action-guard centralization (`requireSameOriginAdmin`): intact.
- Webhook signature verification at edge: intact.

All carry-forward architectural shapes hold.
