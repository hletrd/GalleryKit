# critic — cycle 5 RPF (end-only)

## Method

Adversarial reading. Question every cycle 1-4 fix. Ask: does the fix
actually fix the original failure mode? Does it introduce new ones?

## Findings

### CRIT-01 — P264-01 fix uses 255-slice but the slice happens AFTER `.trim()`

- File: `apps/web/src/app/api/stripe/webhook/route.ts:108`
- Severity: **Informational** | Confidence: **High**
- Order is `customerEmailRaw.trim().slice(0, 255).toLowerCase()`. This
  is correct: trim leading/trailing whitespace first, then slice to fit
  column. If the order were `.slice().trim()`, a 256-char-with-trailing-
  whitespace email would be sliced to 255 chars (potentially mid-content)
  and only THEN trimmed. Current order is right.
- No action.

### CRIT-02 — Webhook idempotent-skip via SELECT is correct, but the `console.info` log at line 216 is on a hot retry path

- File: `apps/web/src/app/api/stripe/webhook/route.ts:216`
- Severity: **Low** | Confidence: **Medium**
- A misconfigured Stripe webhook (or a bot replaying a captured payload)
  could deliver many duplicates of the same `checkout.session.completed`.
  Each duplicate logs a line to stdout. Volume is small in practice but
  it's the only handler-level log without rate-limit protection.
- **Failure scenario:** log shipper queue saturation under attack.
- **Fix (defer):** acceptable for now; Stripe signature verification at
  line 52 prevents arbitrary replay. The signature must be valid for the
  payload, so an attacker would need a captured-and-still-valid
  signature. Stripe signatures have a tolerance window. Risk bounded.

### CRIT-03 — The `Entitlement created` log at 268 includes session ID — sensitive to log shipper

- File: `apps/web/src/app/api/stripe/webhook/route.ts:268`
- Severity: **Informational** | Confidence: **High**
- Stripe session IDs are not secret; they're in URLs visible to the
  customer. Not PII. No action.

### CRIT-04 — Cycle 4 P264-09's `role="alert"` only fires when `t.errorLoad` is non-empty

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:176-183`
- Severity: **Informational** | Confidence: **High**
- The conditional `{t.errorLoad && (...)}` is correct: only render the
  alert when there's an error to announce. Correct semantics. No action.

### CRIT-05 — Cycle 4 P264-08 row-button-text fix correctly drops the rotation

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:237-260`
- Severity: **Informational** | Confidence: **High**
- The button text is pinned to `t.refundButton`; only `disabled` toggles
  on `refundingId === row.id`. The dialog action button still rotates
  via `t.refunding`. shadcn convention preserved. No action.

### CRIT-06 — `confirmTarget` state and `refundingId` state can drift

- File: `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:127-148`
- Severity: **Low** | Confidence: **Medium**
- Sequence of events:
  1. User clicks Refund → `setConfirmTarget(row)` (refundingId still null).
  2. User clicks Confirm → `handleRefund(row.id)` → `setRefundingId(id)`.
  3. Server completes → `finally` clears both `setRefundingId(null)` and
     `setConfirmTarget(null)`.
  4. If user closes dialog mid-flight via the Cancel button, `onOpenChange`
     fires → `setConfirmTarget(null)`. But `refundingId` is still set.
- **Failure scenario:** user closes dialog while refund is in-flight,
  then opens a different row's refund. The dialog opens with the new
  row's confirmTarget but the AlertDialogAction's `disabled={refundingId !== null}`
  is still true — confirm button is disabled until the first refund
  completes. Mild UX confusion.
- **Fix:** in the AlertDialog `onOpenChange` handler, only allow close if
  `refundingId === null`; or accept the existing UX (the in-flight
  refund's outcome will fire the toast and reset state).

### CRIT-07 — Webhook's tier-mismatch warn fires AFTER imageId-validation but BEFORE zero-amount gate

- File: `apps/web/src/app/api/stripe/webhook/route.ts:160-178, 189-195`
- Severity: **Informational** | Confidence: **High**
- Order is correct: validate imageId is positive integer, SELECT image
  to verify existence, warn-log on tier mismatch, then validate
  amount_total. Each gate is atomic; the warn-log doesn't gate behavior.
  No action.

### CRIT-08 — Refund-error mapping returns `'network'` for both `StripeAuthenticationError` and `StripeConnectionError`

- File: `apps/web/src/app/actions/sales.ts:109-115`
- Severity: **Low** | Confidence: **Medium**
- These are operationally distinct: `StripeAuthenticationError` means
  the API key is rotated/revoked (operator must rotate the env var);
  `StripeConnectionError` is a transient network problem (auto-resolves).
  Both being "network" obscures the diagnosis.
- **Failure scenario:** key rotated; operator sees "Stripe could not be
  reached. Try again shortly." → retries forever. Diagnosis delayed.
- **Fix (defer):** add a separate `RefundErrorCode` `'auth-error'` that
  surfaces a different toast ("Stripe authentication failed; check
  STRIPE_SECRET_KEY"). The `'network'` toast is appropriate only for
  transient network problems.

### CRIT-09 — `mapStripeRefundError` uses `instanceof Error` cast which loses Stripe SDK type information

- File: `apps/web/src/app/actions/sales.ts:103-117`
- Severity: **Informational** | Confidence: **High**
- The cast is necessary because TypeScript can't narrow `unknown` to
  Stripe SDK types without an instanceof check against `Stripe.errors.StripeError`.
  The current shape works but loses some type safety. No defect.

### CRIT-10 — Refund clears `downloadTokenHash` to null but does NOT update `expiresAt`

- File: `apps/web/src/app/actions/sales.ts:153-156`
- Severity: **Informational** | Confidence: **High**
- After refund, `downloadTokenHash` is null so any download attempt 404s
  at the entitlement-by-tokenHash lookup, AND the `refunded` flag at
  download route line 86-88 returns 410. Defense in depth. No action.

## Confidence summary

| Finding  | Severity | Confidence | Schedule |
|----------|----------|------------|----------|
| CRIT-01  | Info     | High       | No action |
| CRIT-02  | Low      | Medium     | Defer (bounded) |
| CRIT-03  | Info     | High       | No action |
| CRIT-04  | Info     | High       | No action |
| CRIT-05  | Info     | High       | No action |
| CRIT-06  | Low      | Medium     | Defer (UX cleanup) |
| CRIT-07  | Info     | High       | No action |
| CRIT-08  | Low      | Medium     | Defer (small UX gain) |
| CRIT-09  | Info     | High       | No action |
| CRIT-10  | Info     | High       | No action |
