# architect — cycle 5 RPF (end-only)

## Method

System-level review of the Stripe paid-download module after cycles 1-4.
Assess module boundaries, error-flow consistency, and operator UX.

## Findings

### ARCH-01 — Refund flow is missing an idempotency-key consistent with the rest of Stripe ops

- File: `apps/web/src/app/actions/sales.ts:150`
- Severity: **Low** | Confidence: **High**
- Best-practice for Stripe POSTs is to pass `Idempotency-Key`. The
  webhook side already idempotents via DB UNIQUE on sessionId. The
  refund side relies on Stripe to reject double-refunds with
  `charge_already_refunded`. Adding an idempotency key formalizes the
  Stripe-side guarantee and removes the dependency on Stripe-side state.
- **Recommendation:** add `{ idempotencyKey: \`refund-${entitlementId}\` }`.

### ARCH-02 — Inconsistent log-line shape across cycles

- Files: `apps/web/src/app/api/stripe/webhook/route.ts:216, 268`
- Severity: **Low** | Confidence: **High**
- All cycle 1-4 fixes use structured object loggers (`{ sessionId, ... }`).
  Two pre-existing legacy lines use template literal interpolation:
  - line 216: `\`Stripe webhook: idempotent skip — entitlement already exists session=${sessionId}\``
  - line 268: `\`Entitlement created: imageId=${imageId} tier=${tier} session=${sessionId}\``
- Mixed log shape costs more in log-shipper parsing & Datadog facet
  configuration. Convert both for consistency.
- **Recommendation:** convert to structured-object form.

### ARCH-03 — Refund error mapping conflates two distinct ops conditions ('auth' vs 'network')

- File: `apps/web/src/app/actions/sales.ts:115`
- Severity: **Low** | Confidence: **Medium**
- `StripeAuthenticationError` (key rotated/revoked, requires ops
  intervention) and `StripeConnectionError` (transient network, auto-
  resolves) both map to `'network'`. The user-facing toast is the
  same: "Stripe could not be reached. Try again shortly." This is
  WRONG for the auth case (retry won't help — the key is bad).
- **Recommendation:** split into a new `'auth-error'` RefundErrorCode
  with a separate localized message. The split allows ops to spot the
  rotation case immediately.

### ARCH-04 — Webhook lacks an `async_payment_succeeded` handler

- File: `apps/web/src/app/api/stripe/webhook/route.ts:69`
- Severity: **Informational** | Confidence: **High**
- ACH/OXXO async-paid sessions: cycle 1 webhook drops them at line 75
  (payment_status !== 'paid'). The customer has paid but no entitlement
  is recorded until Stripe sends `async_payment_succeeded`, which we do
  not handle. The session ALSO sends a `checkout.session.completed` with
  payment_status='paid' in some flows, but not all.
- **Existing comment** at line 68-69 acknowledges this as a future-cycle
  follow-up. Defer.

### ARCH-05 — Cycle 4 P264-02's image-tier cross-check uses warn-only; could be a metric

- File: `apps/web/src/app/api/stripe/webhook/route.ts:172-179`
- Severity: **Informational** | Confidence: **Low**
- The warn log is observable via log shipper but not as a histogram /
  counter. If tier-drift becomes common, ops would benefit from a metric
  (e.g. `stripe_webhook_tier_mismatch_total`). No metrics infra in repo
  currently, so this is a future-state consideration.

### ARCH-06 — `mapStripeRefundError` and `mapErrorCode` are nominally paired but live in separate files

- File: `apps/web/src/app/actions/sales.ts:103, apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:100`
- Severity: **Informational** | Confidence: **High**
- Server: server-side error → RefundErrorCode union.
- Client: RefundErrorCode → localized string.
- The `RefundErrorCode` union is exported from `sales.ts`; both sides
  use it. This is the right architecture. No defect.

### ARCH-07 — Source-contract tests in `cycle4-rpf-source-contracts.test.ts` are tight and well-organized

- File: `apps/web/src/__tests__/cycle4-rpf-source-contracts.test.ts`
- Severity: **Informational** | Confidence: **High**
- Each `it` directly references the cycle 4 plan ID (P264-XX). Future
  cycles benefit from the same naming. No action.

## Confidence summary

| Finding  | Severity | Confidence | Schedule |
|----------|----------|------------|----------|
| ARCH-01  | Low      | High       | This cycle |
| ARCH-02  | Low      | High       | This cycle |
| ARCH-03  | Low      | Medium     | This cycle |
| ARCH-04  | Info     | High       | Defer |
| ARCH-05  | Info     | Low        | Defer (no metrics infra) |
| ARCH-06  | Info     | High       | No action |
| ARCH-07  | Info     | High       | No action |
