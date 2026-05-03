# Code-Reviewer — Cycle 9 RPF (end-only)

## Method

Inventory of paid-content surface (download/checkout/webhook/refund/listEntitlements):
- `apps/web/src/app/api/download/[imageId]/route.ts`
- `apps/web/src/app/api/checkout/[imageId]/route.ts`
- `apps/web/src/app/api/stripe/webhook/route.ts`
- `apps/web/src/app/actions/sales.ts`

Cross-checked all `console.error/warn` lines on the Stripe + paid-asset
surface for log-shape consistency (positional vs structured-object form).

## Cycles 1–8 RPF carry-forward verification

| Plan | File | Status |
|------|------|--------|
| P262-03 (UPLOAD_DIR_ORIGINAL env) | download/route.ts:99 | INTACT |
| P262-04 (Content-Disposition extension sanitize) | download/route.ts:192-194 | INTACT |
| P262-05 (lstat/realpath BEFORE atomic claim) | download/route.ts:125-160 | INTACT |
| P262-11 (console.error on email + tier rejects) | webhook/route.ts:174,202 | INTACT |
| P264-06 (parallel realpath calls) | download/route.ts:136-139 | INTACT |
| P264-07 (StripeRateLimitError → network) | sales.ts:145 | INTACT |
| P266-03 (auth-error i18n) | sales.ts:115-117,139 | INTACT |
| P388-01 (Stripe Idempotency-Key on refund) | sales.ts:203-206 | INTACT |
| P388-03 (Stripe error mapping table doc) | sales.ts:88-112 | INTACT |
| P388-05 (non-Error throws BEFORE instanceof) | sales.ts:124-133 | INTACT |
| P390-01 (Idempotency-Key on Checkout) | checkout/route.ts:133-160 | INTACT |
| P390-02 (webhook structured-object log on insert-fail) | webhook/route.ts:322 | INTACT |
| P390-03 (no err.message across action boundary in refund) | sales.ts:221-232 | INTACT |
| P390-04 (warn on unknown Stripe error type) | sales.ts:153-159 | INTACT |
| P390-05 (cap=255 in oversized-email reject log) | webhook/route.ts:147 | INTACT |
| P392-01 (structured-object log on checkout-fail catch) | checkout/route.ts:167 | INTACT |
| P392-02/03 (webhook structured-object on sig-verify + insert-fail) | webhook/route.ts:72,322 | INTACT |
| P392-04 (structured-object on refund catch) | sales.ts:220 | INTACT |
| P392-05 (structured-object on listEntitlements catch) | sales.ts:72 | INTACT |
| P392-06 (drop dead customer_email key) | checkout/route.ts | INTACT |
| P394-01 (structured-object on download lstat/realpath catch) | download/route.ts:158 | INTACT |
| P394-02 (cycle 8 source-contract test) | __tests__/cycle8-rpf-source-contracts.test.ts | INTACT |

All cycles 1–8 RPF claims verified intact in current source.

## Findings — Cycle 9

### HIGH

(none)

### MEDIUM

(none)

### LOW

(none)

## Notes

The full Stripe + paid-asset surface is now consistent on the
structured-object log contract:
- `webhook/route.ts:72` — `'Stripe webhook signature verification failed', { ... }`
- `webhook/route.ts:322` — `'Stripe webhook: failed to insert entitlement', { ... }`
- `checkout/route.ts:167` — `'Stripe checkout session creation failed', { imageId, ip, err }`
- `sales.ts:72` — `'listEntitlements failed', { err }`
- `sales.ts:154` — `'Stripe refund: unrecognized error type', { ... }`
- `sales.ts:220` — `'Stripe refund failed', { entitlementId, err }`
- `download/route.ts:158` — `'Download lstat/realpath error', { entitlementId, err }`
- `download/route.ts:213` — `'Download stream error:', { entitlementId, code }`

Confidence: High. Zero new findings this cycle.
