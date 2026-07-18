# Cycle 4 Debugger Review

Inventory and causal tracing covered runtime routes/actions, background
lifecycle code, image processing, UI state, deploy scripts, and the changes
from Cycle 3's start HEAD through `01d39653`.

## DBG-C4-01 — Geometry regression can recur while the E2E remains green

- Severity / confidence: **Medium / High**
- Status: **Confirmed latent-regression surface**
- Region: `apps/web/e2e/masonry-priority.spec.ts:20-32`
- Causal chain: CSS owns column placement → source order no longer identifies
  every visual leader → Cycle 3 intentionally narrows explicit priority to
  index 0 → the regression test reads only source-order attributes → a future
  CSS/layout change can sever index 0 from the visible top edge without failing
  the test.
- Fix: bind the test to computed rectangles before checking the priority set.

## DBG-C4-02 — Recovery frontier points behind reality

- Severity / confidence: **Low / High**
- Status: **Confirmed operational-debugging defect**
- Region: `.context/plans/cycle-3-2026-07-18-plan.md:5,45-65`
- Scenario: after an interruption, an operator sees pending signed push/deploy
  despite signed remote equality and live behavior, and performs redundant
  terminal actions instead of starting from current HEAD.
- Fix: close/archive the ledger and record production smoke evidence.

## Competing hypotheses and sweep

The browser may still request in-viewport lazy images promptly; that does not
repair the missing geometry assertion, which concerns proof of priority
ownership rather than claiming a current LCP failure. No fresh runtime crash or
data-corruption path was confirmed in the final sweep.
