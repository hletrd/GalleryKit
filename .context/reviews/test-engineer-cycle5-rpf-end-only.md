# test-engineer — cycle 5 RPF (end-only)

## Method

Reviewed test gate: `npm test` reports 109 files / 964 tests passing.
Read cycle 4 source-contract tests (`cycle4-rpf-source-contracts.test.ts`).
Looked for behavior coverage gaps for the cycle 5 candidate fixes.

## Gates baseline

- `npm run lint`: clean
- `npm run typecheck`: clean
- `npm run lint:api-auth`: clean
- `npm run lint:action-origin`: clean
- `npm test`: 964 tests across 109 files passing
- `npm run test:e2e`: not exercised this cycle (env DB unavailable —
  pre-existing pattern; documented under deferred)

## Findings

### TEST-01 — Cycle 5 fixes need source-contract tests

- Severity: **Low** | Confidence: **High**
- The cycle 5 fixes (refund idempotency key, structured-log conversion,
  hoisted regex, optional auth-error split) need source-text guards so a
  future revert is caught.
- **Fix:** add `cycle5-rpf-source-contracts.test.ts` covering the new
  shapes: `idempotencyKey: \`refund-${entitlementId}\`` is present;
  `EMAIL_SHAPE` declared at module scope (not inside POST handler);
  legacy stdout lines now use object-form `console.info(...)`.

### TEST-02 — `mapStripeRefundError` lacks behavior tests

- File: `apps/web/src/app/actions/sales.ts:103-117`
- Severity: **Low** | Confidence: **High**
- Cycle 4 added source-contract test for the `StripeAuthenticationError →
  network` shape but no behavior test verifying the function actually
  returns `'network'` for input `{ type: 'StripeAuthenticationError' }`.
  Currently the function is non-exported. Could be exported for testing
  or the test could re-implement the same regex on the source.
- **Fix (defer):** export `mapStripeRefundError` and add behavior tests
  for all 7 RefundErrorCode values + each Stripe error type.

### TEST-03 — Idempotency key format is testable as a source-contract

- Severity: **Low** | Confidence: **High**
- The format `\`refund-${entitlementId}\`` is stable. Source-contract
  test will catch regression.

### TEST-04 — `apps/web/src/__tests__/refund-clears-download-token.test.ts` already covers the refund→hash-null path

- File: `apps/web/src/__tests__/refund-clears-download-token.test.ts`
- Severity: **Informational** | Confidence: **High**
- Existing source-contract for the refund flow's downloadTokenHash null-set.
  No regression risk on cycle 5 changes. No action.

## Confidence summary

| Finding  | Severity | Confidence | Schedule |
|----------|----------|------------|----------|
| TEST-01  | Low      | High       | This cycle |
| TEST-02  | Low      | High       | Defer |
| TEST-03  | Low      | High       | This cycle (rolled into TEST-01) |
| TEST-04  | Info     | High       | No action |
