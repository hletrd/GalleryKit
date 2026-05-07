# Tracer — Cycle 7 RPF (end-only)

## Inventory

- Stripe error-path traces (checkout / webhook / refund / list)

## Findings

### C7-RPF-TR-01 — Trace gap: checkout failure → no imageId in log

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:165`
- Severity: **Low** | Confidence: **High**
- **Trace:**
  1. Customer clicks "Buy" → POST /api/checkout/123
  2. Stripe API outage → `stripe.checkout.sessions.create` throws
  3. Catch logs `'Stripe checkout session creation failed:' Error...`
  4. Operator sees error volume but cannot bucket by image without grepping
     surrounding context.
- **Fix:** Structured form with imageId in payload.

### C7-RPF-TR-02 — Trace gap: webhook insert failure → no sessionId in log

- File: `apps/web/src/app/api/stripe/webhook/route.ts:309`
- Severity: **Low** | Confidence: **High**
- **Trace:**
  1. Webhook fires → Drizzle insert fails (deadlock, FK violation, etc.)
  2. Catch logs `'Stripe webhook: failed to insert entitlement:' err`
  3. Stripe retries the webhook (we return 500). Each retry produces another
     log line with no sessionId. Operators cannot correlate.
- **Fix:** Structured form with sessionId, imageId, tier.

### C7-RPF-TR-03 — Trace gap: refund failure → no entitlementId

- File: `apps/web/src/app/actions/sales.ts:214`
- Severity: **Low** | Confidence: **High**
- **Trace:**
  1. Admin clicks Refund → action calls Stripe → Stripe returns error
  2. Catch logs `'Stripe refund failed:' err`
  3. Admin retries → error logged again, no entitlementId distinguishes.
- **Fix:** Structured form with entitlementId.
