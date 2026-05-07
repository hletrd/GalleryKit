# Document-specialist — Cycle 7 RPF (end-only)

## Inventory

- Inline doc-blocks on Stripe surface
- Cycle citation comments (Cycle N RPF / PXXX-NN / CN-RPF-NN)

## Findings

### C7-RPF-DOC-01 — `customer_email: undefined` lacks intent comment

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:156`
- Severity: **Low** | Confidence: **Medium**
- **What:** The line `customer_email: undefined,` has no comment. Future
  maintainers will wonder if it's a security choice or unfinished scaffolding.
- **Fix:** Drop the line (preferred — Stripe SDK treats omitted and undefined
  identically) OR add a comment explaining the intent.

## Doc-code consistency verification

- `mapStripeRefundError` JSDoc table at `sales.ts:101-110` accurately
  reflects the implementation including cycle 5 P388-03 `'auth-error'`
  split.
- The cycle 6 P390-04 unknown-branch warn is mentioned in the inline
  comment at line 144-150 but not in the JSDoc table at the function head.
  Minor doc completeness gap (defer — at next sales-action doc pass).
