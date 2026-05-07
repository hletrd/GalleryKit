# document-specialist — cycle 5 RPF (end-only)

## Method

Reviewed all docs in the Stripe paid-download path: README sections,
CLAUDE.md, .env.local.example, JSDoc comments. Verified cycle 1-4
documentation is intact.

## Findings

### DOC-01 — `Idempotency-Key` is best-practice for Stripe POST mutations; should be cited in JSDoc

- File: `apps/web/src/app/actions/sales.ts:119-166`
- Severity: **Low** | Confidence: **High**
- The `refundEntitlement` action's JSDoc does not mention idempotency.
  When ARCH-01 lands, the JSDoc should explain why the idempotency key
  is set to `refund-${entitlementId}` (deterministic, allows safe
  retries).
- **Fix (this cycle):** add JSDoc explaining the idempotency-key choice.

### DOC-02 — `LOG_PLAINTEXT_DOWNLOAD_TOKENS` retention warning is in `.env.local.example` (cycle 3+4 docs ✓)

- File: `apps/web/.env.local.example:74-87`
- Severity: **Informational** | Confidence: **High**
- All cycle 1-4 retention/security warnings present. No action.

### DOC-03 — README's "Paid downloads" section has been comprehensive since cycle 2

- File: `apps/web/README.md` (cycle 2 P260-15)
- Severity: **Informational** | Confidence: **High**
- Operator workflow documented; LOG_PLAINTEXT_DOWNLOAD_TOKENS lifecycle
  documented. No action.

### DOC-04 — `mapStripeRefundError` switch lacks a JSDoc list of error → code mapping

- File: `apps/web/src/app/actions/sales.ts:103-117`
- Severity: **Informational** | Confidence: **Medium**
- The function works correctly but a future contributor adding a new
  Stripe error type would benefit from a JSDoc table mapping types to
  codes. Not a defect; nice-to-have.
- **Fix (defer):** add JSDoc with the type→code mapping.

## Confidence summary

| Finding  | Severity | Confidence | Schedule |
|----------|----------|------------|----------|
| DOC-01   | Low      | High       | This cycle |
| DOC-02   | Info     | High       | No action |
| DOC-03   | Info     | High       | No action |
| DOC-04   | Info     | Medium     | Defer |
