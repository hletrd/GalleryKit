# Debugger — Cycle 9 RPF (end-only)

## Method

Trace-walk of the paid-asset triage scenario:
- Operator sees 500 on /api/download/:id?token=dl_...
- Operator pulls log line, expects an `entitlementId` correlation key
- Operator joins on `entitlements.id` to recover sessionId, tier, image,
  customer email — all the facts needed to triage

## Findings — Cycle 9

### HIGH

(none)

### MEDIUM

(none)

### LOW

(none)

## Notes

The cycle 8 fix (`download/route.ts:158`) closed the last gap on the
paid-asset surface where a structured catch would have dropped
`entitlementId`. With the cycle 8 fix in place, every catch on the
download/refund/checkout/listEntitlements surface carries an audit-log
correlation key:

| Surface | Catch line | Correlation keys |
|---------|------------|------------------|
| download/route.ts:158 | lstat/realpath | entitlementId, err |
| download/route.ts:213 | stream-error | entitlementId, code |
| sales.ts:72 | listEntitlements | err |
| sales.ts:154 | refund unknown | name, type, code |
| sales.ts:220 | refund failed | entitlementId, err |
| checkout/route.ts:167 | checkout-fail | imageId, ip, err |
| webhook/route.ts:72 | sig-verify | signaturePresent, bodyLen |
| webhook/route.ts:322 | insert-fail | sessionId, imageId |

Each catch has a key that matches the scope of the failure. No drift.

Confidence: High. Zero new findings this cycle.
