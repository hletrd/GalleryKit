# tracer — cycle 5 RPF (end-only)

## Method

Trace the data flow: customer click → Stripe checkout → webhook → token
mint → /admin/sales render → refund click → Stripe refund → DB update.

## Findings

### TR-01 — Refund flow's network-error toast is identical for connection vs auth errors

- Path: refund click → `refundEntitlement` action → `mapStripeRefundError`
  → `'network'` errorCode → `mapErrorCode` → `t.refundErrorNetwork`
  → toast "Stripe could not be reached. Try again shortly."
- Conflated cases: `StripeConnectionError` (transient), `StripeAPIError`
  (server-side), `StripeAuthenticationError` (rotated key, requires ops
  intervention), `StripeRateLimitError` (rate limit, retry-after).
- **Failure scenario:** ops rotates STRIPE_SECRET_KEY but forgets to
  redeploy. Refunds fail with `StripeAuthenticationError`. Operator sees
  "try again shortly" → retries forever → support burden.
- **Fix:** add a separate `'auth-error'` RefundErrorCode + localized
  message ("Stripe authentication failed; please verify the API key in
  STRIPE_SECRET_KEY"). Keep `'network'` for true network errors.

### TR-02 — Refund without idempotency key + browser double-click → "already-refunded" toast on a successful refund

- Path: admin double-clicks confirm → two `refundEntitlement` requests in
  parallel → first succeeds → second sees `row.refunded === false`
  initially (read before first commit), then Stripe rejects with
  `charge_already_refunded` → second returns 'already-refunded' code
  → toast "This charge was already refunded." → operator confused.
- **Mitigation:** AlertDialogAction `disabled={refundingId !== null}`
  already guards against double-click at the button level. Race window
  is small but non-zero (re-render gap).
- **Fix:** add Stripe `Idempotency-Key` so even if two requests reach
  Stripe, the second is server-deduped to the first's refund.id and
  returns the same success.

### TR-03 — `console.info('Stripe webhook: idempotent skip — entitlement...')` uses string interpolation

- Path: Stripe retry after a transient failure → SELECT finds existing
  entitlement → idempotent-skip log → 200 OK.
- **Inconsistency:** all cycle 1-4 webhook log lines use structured
  object form `{ sessionId, ... }`. This legacy line uses template
  literal interpolation. Log shippers (Datadog, Loki) parse JSON better
  than free-form text.
- **Fix:** convert to `console.info('Stripe webhook: idempotent skip', { sessionId })`.

### TR-04 — `console.info('Entitlement created: ...')` uses string interpolation

- Path: first webhook delivery → INSERT succeeds → log line + optional
  manual-distribution log.
- **Inconsistency:** same as TR-03.
- **Fix:** convert to structured object form.

### TR-05 — `EMAIL_SHAPE` regex declared inside POST handler runs RegExp constructor per request

- Path: every webhook delivery → declares EMAIL_SHAPE → tests email.
- **Inconsistency:** `STORED_HASH_SHAPE` in `download-tokens.ts:46` is at
  module scope. EMAIL_SHAPE in webhook is at function scope.
- **Fix:** hoist EMAIL_SHAPE to module scope (consistency + microperf).

### TR-06 — `mapStripeRefundError` chain: instanceof Error narrows to Error, then casts to add `code` and `type`

- Path: refund error → `mapStripeRefundError(err)` → `instanceof Error`
  guard → `err as Error & { code?: string; type?: string }`.
- **Observation:** correct but the cast loses Stripe SDK type
  information. Could replace with `err instanceof Stripe.errors.StripeError`.
  Not a defect; matter of taste.
- No action.

## Confidence summary

| Finding  | Severity | Confidence | Schedule |
|----------|----------|------------|----------|
| TR-01    | Low      | High       | This cycle (rolled into ARCH-03) |
| TR-02    | Low      | High       | This cycle (rolled into ARCH-01) |
| TR-03    | Low      | High       | This cycle (rolled into ARCH-02) |
| TR-04    | Low      | High       | This cycle (rolled into ARCH-02) |
| TR-05    | Low      | High       | This cycle (rolled into PERF-05) |
| TR-06    | Info     | High       | No action |
