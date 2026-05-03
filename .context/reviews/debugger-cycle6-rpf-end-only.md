# debugger — Cycle 6 RPF (end-only)

## Method

Failure-mode walking through Stripe Checkout + webhook + refund + admin
sales surfaces. For each failure mode, check what the user/operator
sees and whether the system recovers.

## Findings

### DBG-01 — Checkout double-click creates duplicate Stripe Checkout sessions
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:123`
- **Severity:** Low | Confidence: High
- **What:** No Stripe Idempotency-Key on `checkout.sessions.create`.
  Browser double-click → two Checkout sessions. User pays first;
  second goes pending. Operators reviewing pending sessions in the
  Stripe dashboard see false duplicates.
- **Recovery:** Stripe times out pending sessions (~24h), so eventually
  the second session disappears. But during that window, the operator
  has noise.
- **Fix:** add idempotency-key (matches cycle 5 refund pattern). See
  CR-02 / SEC-01 / ARCH-01.

### DBG-02 — Webhook log line for invalid imageId is hard to grep
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:195`
- **Severity:** Low | Confidence: High
- **What:** `console.error('Stripe webhook: invalid imageId in metadata', imageIdStr)`
  emits the imageIdStr as a positional arg. In a JSON log shipper, the
  imageIdStr lands as untagged text concatenated to the message string,
  not as a structured field. An operator searching by sessionId
  (the canonical Stripe correlation key) finds NOTHING — sessionId is
  not even on this log line. Triage cost goes from "search by sessionId"
  to "tail logs and eyeball the imageIdStr suffix."
- **Recovery:** none until the operator manually maps imageIdStr →
  sessionId via Stripe dashboard.
- **Fix:** convert to structured form with sessionId + imageIdStr.

### DBG-03 — `mapStripeRefundError` unknown branch silently absorbs new Stripe error types
- **File:** `apps/web/src/app/actions/sales.ts:144`
- **Severity:** Low | Confidence: Medium
- **What:** When Stripe introduces a new error type (e.g. a new
  `StripeIdempotencyError` for our cycle 5 idempotency-key fix when
  keys collide), the function returns 'unknown'. The user sees
  the generic toast. Operators see the raw error in `console.error` at
  line 200, but there's no proactive signal that the mapping table
  needs updating.
- **Recovery:** customer complaint → operator reads logs → adds new
  type. Slow.
- **Fix:** add a `console.warn('Stripe refund: unrecognized error type', { name, type, code })`
  inside the unknown branch. Simple ops-UX win.

### DBG-04 — Refund return shape exposes `err.message` to client
- **File:** `apps/web/src/app/actions/sales.ts:202`
- **Severity:** Low | Confidence: Medium
- **What:** The `error` field in the action's return type contains
  `err.message`, which can include Stripe request IDs. The client
  doesn't currently read it (uses `errorCode`), but the latent leak
  awaits a careless future change.
- **Fix:** drop the `error` field from the action's return type or
  set to a stable string.

### DBG-05 — Webhook oversized email reject log line lacks the cap
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:133-140`
- **Severity:** Informational | Confidence: Medium
- **What:** Operator sees `length: 1024` but not `cap: 255`. Fix is one
  line in the structured object.

## Recovery audit (carry-forward)

- Webhook insert failure → 500 → Stripe retries. Verified.
- Download token already used → 410. Verified.
- Refund already-refunded → 'already-refunded' code → localized toast.
  Verified.
- Network error during refund → 'network' code → "try again shortly".
  Verified.
- Stripe auth error → 'auth-error' code → "rotate API key" toast
  (cycle 5). Verified.

All recovery paths intact.
