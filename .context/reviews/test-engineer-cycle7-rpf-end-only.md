# Test-engineer — Cycle 7 RPF (end-only)

## Inventory

- `apps/web/src/__tests__/cycle3-rpf-source-contracts.test.ts`
- `apps/web/src/__tests__/cycle4-rpf-source-contracts.test.ts`
- `apps/web/src/__tests__/cycle5-rpf-source-contracts.test.ts`
- `apps/web/src/__tests__/cycle6-rpf-source-contracts.test.ts`

## Findings

### C7-RPF-TEST-01 — Cycle 7 source-contract tests needed

- File: `apps/web/src/__tests__/cycle7-rpf-source-contracts.test.ts` (new)
- Severity: **Low** | Confidence: **High**
- **What:** Cycle 7's structured-log conversions need source-contract tests
  to prevent silent reverts. Mirror the cycle-6 pattern.
- **Test for:**
  - C7-RPF-01: `console.error('Stripe checkout session creation failed', { ... })` with imageId key.
  - C7-RPF-02: `console.error('Stripe webhook signature verification failed', { ... })` structured.
  - C7-RPF-03: `console.error('Stripe webhook: failed to insert entitlement', { ... sessionId ... })` structured.
  - C7-RPF-04: `console.error('Stripe refund failed', { entitlementId, ... })` structured.
  - C7-RPF-05: `console.error('listEntitlements failed', { ... })` structured.
  - C7-RPF-06: absence of `customer_email: undefined` in checkout route.
  - Also: assert NO `'Stripe checkout session creation failed:'` (with trailing colon) survives — the legacy positional form's tell.
