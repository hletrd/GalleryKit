# Perf-reviewer — Cycle 7 RPF (end-only)

## Inventory

- `apps/web/src/app/api/checkout/[imageId]/route.ts`
- `apps/web/src/app/api/stripe/webhook/route.ts`
- `apps/web/src/app/api/download/[imageId]/route.ts`
- `apps/web/src/app/actions/sales.ts`

## Findings

### C7-RPF-PERF-01 — `customer_email: undefined` is noise in JSON serialization

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:156`
- Severity: **Low** | Confidence: **Low**
- **What:** Passing `customer_email: undefined` to Stripe SDK costs one extra
  property iteration in the SDK's request serializer. Negligible, but the
  line is dead-code under maintenance review.
- **Fix:** Drop the line.

## Carry-forward (deferred items)

- C6-RPF-D01 (identity mapper in listEntitlements) — still cosmetic, defer.
- C6-RPF-D13 (`getTierPriceCents` memoize) — still low-traffic, defer.

No new perf issues found.
