# Architect Review — Cycle 8 RPF (end-only)

## Architectural lens

The cycle 5/6/7 structured-object log contract is a **boundary contract**
on the Stripe-payment surface. Looking at the broader architecture, the
download route at `/api/download/[imageId]` is the **second half** of the
paid-content flow:

  Stripe Checkout → webhook → entitlement INSERT → token email → download

The download route consumes the entitlement token, so a complete audit
trail must include the download leg. Today the download route's TWO
catch sites are inconsistent with each other: the stream-error site on
line 206 follows the cycle 5/6/7 contract; the lstat/realpath catch on
line 151 still uses the legacy positional form.

## Finding

#### C8-RPF-ARCH-01 — Apply the cycle 5/6/7 log contract to the download route

- File: `apps/web/src/app/api/download/[imageId]/route.ts:151`
- Severity: **Low** | Confidence: **High**
- **Why this matters architecturally:** the structured-object log
  contract is not just a Stripe-surface convention; it is the
  observability invariant for the **paid-asset audit chain**. The
  webhook and refund logs use `entitlementId / sessionId / imageId`
  as correlation keys. The download route's stream-error catch uses
  `entitlementId / code` — but the lstat/realpath catch above it
  drops both keys, breaking the chain at the only point an operator
  can detect an asset-disappearance incident.
- **Fix (this cycle):** convert to structured-object form mirroring
  the existing stream-error log on line 206.

## Cross-agent agreement

Converges with code-reviewer (C8-RPF-CR-01), debugger (C8-RPF-DBG-01),
tracer (C8-RPF-TR-01), and critic (C8-RPF-CRIT-01).
