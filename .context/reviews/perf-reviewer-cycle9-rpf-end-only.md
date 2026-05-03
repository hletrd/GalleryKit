# Perf-Reviewer — Cycle 9 RPF (end-only)

## Method

Hot-path scan: download route (per-purchased-asset request), checkout
route (per-buy click), webhook (per-Stripe-event), sales-page list.

## Findings — Cycle 9

### HIGH

(none)

### MEDIUM

(none)

### LOW

(none)

## Notes

- Download route: lstat + parallel realpath round-trips (cycle 4
  P264-06). INTACT.
- Atomic single-use claim: one UPDATE round-trip; no transaction
  needed because the WHERE clause is the unique guard.
- listEntitlements: LIMIT 500, single leftJoin; bounded by admin-only
  access. The identity mapper at lines 55–67 is cosmetic and remains
  deferred (C8-RPF-D01).
- getTierPriceCents: one indexed lookup per checkout. Memoization
  remains deferred (C8-RPF-D13) bound by traffic.
- Service worker: regenerated on every cycle that ships a source change
  via `workbox-build`. No regressions observed.

Confidence: High. Zero new findings this cycle.
