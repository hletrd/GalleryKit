# Architect — Cycle 7 RPF (end-only)

## Inventory

- Stripe surface: checkout / webhook / sales actions / download routes
- Logging contract: structured-object form vs legacy positional form

## Findings

### C7-RPF-ARCH-01 — Logging contract drift on Stripe surface

- Files: same five lines listed in code-reviewer CR-01..CR-05
- Severity: **Low** | Confidence: **High**
- **What:** Cycles 5-6 established a contract: all Stripe-surface log lines
  use `console.error('label', { sessionId, ...keys, err })` so log shippers
  (Datadog, Loki) can parse and slice by sessionId/imageId. Five lines remain
  in legacy positional form. This is an architectural drift — either the
  contract applies uniformly or it doesn't.
- **Fix:** Complete the contract by converting the five remaining lines.
  Verify by source-contract test (assert no `console.error\(['"][^,]*:'\s*,\s*err\b` pattern survives in the Stripe surface).

### C7-RPF-ARCH-02 — `customer_email: undefined` is unspecified scaffolding

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:156`
- Severity: **Low** | Confidence: **Medium**
- **What:** No design doc or comment explains why this key is set to
  `undefined`. Maintainers will wonder if there's a security reason or if
  the next phase is supposed to wire something in.
- **Fix:** Drop the key. If future work pre-populates customer_email, the
  diff will be more legible without a stale `: undefined` placeholder.

## Cycle 6 architectural verification

- Idempotency-key uniformity: both refund (cycle 5) and checkout (cycle 6)
  pass idempotencyKey. Architectural symmetry achieved.
- Structured logs: 12+ webhook log lines converted; 3 stragglers remain
  (CR-02 sig-verify, CR-03 insert-failure, plus CR-04/05 in sales).
