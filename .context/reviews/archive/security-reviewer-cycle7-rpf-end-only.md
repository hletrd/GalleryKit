# Security-reviewer — Cycle 7 RPF (end-only)

## Inventory

- `apps/web/src/app/api/stripe/webhook/route.ts`
- `apps/web/src/app/api/checkout/[imageId]/route.ts`
- `apps/web/src/app/api/download/[imageId]/route.ts`
- `apps/web/src/app/actions/sales.ts`
- `apps/web/src/lib/download-tokens.ts`
- `apps/web/src/lib/stripe.ts`

## Findings

### C7-RPF-SEC-01 — Stripe error stack in checkout log may include URL/headers

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:165`
- Severity: **Low** | Confidence: **Medium**
- **What:** `console.error('Stripe checkout session creation failed:', err)`
  prints the entire `err` Stripe object including `req` URL, `request_id`,
  and (for some Stripe SDK versions) the request body in `err.raw.request`.
  Customer email is not present in this code path (we set
  `customer_email: undefined`), so PII risk is low. But Stripe
  `request_id`s in retained logs make them queryable as transaction IDs;
  this is a Stripe-policy consideration. Structured form lets us pass
  `{ message: err.message, code: err.code, type: err.type }` only.
- **Fix:** Convert to
  `console.error('Stripe checkout session creation failed', { imageId: image.id, message: err instanceof Error ? err.message : String(err) })`.

### C7-RPF-SEC-02 — Webhook insert-failure log includes Drizzle error stack

- File: `apps/web/src/app/api/stripe/webhook/route.ts:309`
- Severity: **Low** | Confidence: **Medium**
- **What:** Drizzle's MySQL error object includes the full SQL statement on
  failure (driver-dependent). When the failure is on
  `INSERT INTO entitlements (..., customerEmail, ...)`, the log line could
  include the customer email value. Structured form allows redaction.
- **Fix:** Convert to a structured form that intentionally drops the raw err:
  `console.error('Stripe webhook: failed to insert entitlement', { sessionId, imageId, tier, errMessage: err instanceof Error ? err.message : String(err) })`.

### C7-RPF-SEC-03 — Refund catch log includes Stripe stack

- File: `apps/web/src/app/actions/sales.ts:214`
- Severity: **Low** | Confidence: **Medium**
- Parallels C7-RPF-SEC-01 for the refund POST. Same reasoning: convert to
  structured form, log only the safe-shape fields.

## Carry-forward verification (cycle 6)

- C6-RPF-03 (drop err.message from action return) verified at sales.ts:224
  — `error: 'Refund failed'` is a stable string, not `err.message`.
- C6-RPF-05 (cap=255 on oversized email reject) verified at webhook:142.

All cycle 6 security fixes intact.
