# Test-Engineer Review — Cycle 8 RPF (end-only)

## Inventory

Source-contract tests already exist for cycles 3, 4, 5, 7. Cycle 6
P390 fixes were covered by extending the cycle 4/5 contract tests.
Cycle 7 P392 fixes have a dedicated `cycle7-rpf-source-contracts.test.ts`
covering 6 / 6 fix shapes.

## Finding

#### C8-RPF-TEST-01 — Add cycle 8 source-contract test

- File: `apps/web/src/__tests__/cycle8-rpf-source-contracts.test.ts` (new)
- Severity: **Low** | Confidence: **High**
- **What:** lock the C8-RPF-CR-01 fix (download lstat/realpath catch
  log structured-object form with `entitlementId`) so it cannot
  silently regress.
- **Assertions:**
  - structured-object form on the lstat/realpath catch line, with
    `entitlementId: entitlement.id` field present;
  - legacy positional form `'Download lstat/realpath error:'` (with
    trailing colon and `err` as 2nd positional arg) absent.

## Carry-forward

C7-RPF-D05 (behavior tests for `mapStripeRefundError`) remains
deferred — requires exporting the function for unit tests.
