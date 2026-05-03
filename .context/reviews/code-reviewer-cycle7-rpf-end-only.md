# Code-reviewer — Cycle 7 RPF (end-only)

## Inventory

- `apps/web/src/app/api/checkout/[imageId]/route.ts`
- `apps/web/src/app/api/stripe/webhook/route.ts`
- `apps/web/src/app/actions/sales.ts`
- `apps/web/src/app/api/download/[imageId]/route.ts`
- `apps/web/src/lib/download-tokens.ts`
- `apps/web/src/lib/stripe.ts`

## Findings

### C7-RPF-CR-01 — Checkout catch logs `err` positionally (legacy form)

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:165`
- Severity: **Low** | Confidence: **High**
- **What:** `console.error('Stripe checkout session creation failed:', err)` uses
  the legacy positional 2nd-arg pattern. All other recently refactored Stripe
  log lines in cycles 5-6 use structured-object form
  (`console.error('label', { sessionId, ... })`). The catch path here misses
  imageId/ip correlation keys; operators can't grep by `imageId`.
- **Failure scenario:** A Stripe outage spikes and operators try to slice the
  log volume by imageId or by ip to find which customer is affected. Free-text
  positional form forces them to regex inside the rendered error stack.
- **Fix:** Convert to
  `console.error('Stripe checkout session creation failed', { imageId: image.id, ip, err })`.

### C7-RPF-CR-02 — Webhook signature-verify error log positional

- File: `apps/web/src/app/api/stripe/webhook/route.ts:67`
- Severity: **Low** | Confidence: **High**
- **What:** `console.error('Stripe webhook signature verification failed:', err)`
  uses positional form. No correlation key (Stripe can include event id in
  signature header for some flows; we don't currently extract it, but the
  signature header itself can be partially logged for triage).
- **Fix:** Convert to
  `console.error('Stripe webhook signature verification failed', { err })`.

### C7-RPF-CR-03 — Webhook insert-failure log positional, missing sessionId

- File: `apps/web/src/app/api/stripe/webhook/route.ts:309`
- Severity: **Low** | Confidence: **High**
- **What:** `console.error('Stripe webhook: failed to insert entitlement:', err)`
  drops sessionId, imageId, tier — exactly the keys an operator needs to
  triage a DB error. Cycle 5/6 webhook log refactors converted siblings to
  structured form; this one was missed.
- **Fix:** Convert to
  `console.error('Stripe webhook: failed to insert entitlement', { sessionId, imageId, tier, err })`.

### C7-RPF-CR-04 — Refund catch log missing entitlementId

- File: `apps/web/src/app/actions/sales.ts:214`
- Severity: **Low** | Confidence: **High**
- **What:** `console.error('Stripe refund failed:', err)` is positional.
  Operators triaging a refund failure cannot link it to a specific
  entitlementId without grepping the timeline. The structured form makes
  the entitlement → error mapping explicit.
- **Fix:** Convert to
  `console.error('Stripe refund failed', { entitlementId, err })`.

### C7-RPF-CR-05 — listEntitlements log positional

- File: `apps/web/src/app/actions/sales.ts:70`
- Severity: **Low** | Confidence: **Medium**
- **What:** `console.error('listEntitlements failed:', err)` is positional. No
  correlation key applies (list is admin-only and untyped in args), but
  consistent structured-object shape across the action file is a maintenance
  signal.
- **Fix:** Convert to `console.error('listEntitlements failed', { err })`.

### C7-RPF-CR-06 — `customer_email: undefined` is dead-key noise

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:156`
- Severity: **Low** | Confidence: **Medium**
- **What:** Passing `customer_email: undefined` to
  `stripe.checkout.sessions.create` is identical to omitting the key
  (Stripe SDK strips undefined). The line reads as if it intentionally clears
  a value, suggesting future maintainers might think there's email
  pre-population logic to wire up. Drop the key.
- **Fix:** Delete the `customer_email: undefined` line.

## Cycle 6 carry-forward verification

- C6-RPF-01 idempotency-key on checkout — present (line 133, 160).
- C6-RPF-02 invalid-imageId structured log — present (line 206-209).
- C6-RPF-03 drop err.message — present (line 224).
- C6-RPF-04 unknown-branch warn — present (line 152-156).
- C6-RPF-05 cap=255 on oversized email — present (line 142).

All cycle 6 fixes verified intact.
