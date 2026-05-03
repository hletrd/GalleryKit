# Critic — Cycle 7 RPF (end-only)

## Inventory

- All Stripe-related files plus log-consistency surface

## Findings

### C7-RPF-CRIT-01 — Inconsistent log shapes across Stripe surface (mid-refactor)

- Files:
  - `apps/web/src/app/api/checkout/[imageId]/route.ts:165` (positional)
  - `apps/web/src/app/api/stripe/webhook/route.ts:67,309` (positional)
  - `apps/web/src/app/actions/sales.ts:70,214` (positional)
- Severity: **Low** | Confidence: **High**
- **What:** Cycles 5+6 systematically converted webhook log lines to
  structured object form (`console.error('label', { sessionId, ... })`),
  but five legacy lines remain in positional 2nd-arg form. The codebase is
  half-refactored. Either complete the refactor or document that the catch
  paths intentionally use a different shape.
- **Fix:** Convert all five to structured object form (see code-reviewer
  CR-01..CR-05 for details).

### C7-RPF-CRIT-02 — `customer_email: undefined` reads as TODO scaffolding

- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:156`
- Severity: **Low** | Confidence: **Medium**
- **What:** Explicit `: undefined` looks intentional — like a placeholder for
  future code that pre-populates customer_email from an authenticated session.
  No comment explains the intent. Stripe SDK behavior is identical to
  omitting the key. Either remove it or add a comment.
- **Fix:** Drop the line OR add a `// intentional: leave email blank for
  Stripe Checkout to collect from buyer` comment.
