# Critic Review — Cycle 8 RPF (end-only)

## What was already cleaned in cycles 5/6/7

The cycle 5/6/7 fan-out comprehensively cleaned the **upstream** Stripe
surface: every catch inside the Stripe SDK perimeter (checkout session
create, webhook signature verify, webhook insert-entitlement, refund,
listEntitlements) now follows the structured-object log contract.
Cycle 7 RPF P392-07 added source-contract tests pinning the shape.

## What is left over

The **downstream** download route (`/api/download/[imageId]/route.ts`)
that consumes the Stripe-minted entitlement token has TWO catches:
- line 151: lstat/realpath — **positional** (legacy form)
- line 206: stream open — **structured** with `{ entitlementId, code }`

The intra-file inconsistency makes the audit chain incomplete.

## Finding

#### C8-RPF-CRIT-01 — Inconsistent log shape inside the same download route

- File: `apps/web/src/app/api/download/[imageId]/route.ts:151 vs 206`
- Severity: **Low** | Confidence: **High**
- **What:** within the same file, two adjacent catches use different
  log shapes. The reviewer cannot tell whether this is intentional
  (some semantic distinction) or accidental (line 206 was structured
  during cycle 4 P264-06's parallelization refactor, while line 151
  was overlooked). Either way, an unstated invariant is unstable.
- **Fix (this cycle):** unify the two catch logs on the structured form.

## Cross-agent agreement

Code-reviewer (C8-RPF-CR-01), architect (C8-RPF-ARCH-01), debugger
(C8-RPF-DBG-01), tracer (C8-RPF-TR-01) all converge on the same fix.
