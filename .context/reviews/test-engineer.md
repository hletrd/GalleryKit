# Cycle 4 Test Engineer Review

I inventoried the 361-file Vitest surface, Playwright specs, scanner fixtures,
build/type scripts, and source areas changed since Cycle 3's review baseline.

## TEST-C4-01 — Masonry regression is browser-run but not geometry-sensitive

- Severity / confidence: **Medium / High**
- Status: **Confirmed coverage gap**
- Region: `apps/web/e2e/masonry-priority.spec.ts:20-32`
- Concrete miss: changing the masonry class/layout so index 0 is displaced, or
  changing column balancing so a later DOM card becomes the only top leader,
  does not affect `priorityIndices === [0]`; the test stays green without
  proving the user-visible invariant named by Cycle 3.
- Suggested regression: collect rectangles for all initially rendered cards;
  derive the minimum top edge and leader indices; assert index 0 belongs to the
  leader set, desktop leaders are non-contiguous/multiple, and explicit
  eager/high remains exactly index 0. Keep the request assertion.

## TEST-C4-02 — Release-state checks have no durable closure

- Severity / confidence: **Low / High**
- Status: **Confirmed documentation-test gap**
- Region: `.context/plans/cycle-3-2026-07-18-plan.md:45-65`
- Scenario: a later cycle repeats push/deploy work or reports it blocked because
  the durable ledger is left pending after success.
- Fix: archive the completed plan and update the index in this cycle.

## Final sweep

Focused source inspection found no fresh unsafe test suppression or passing
assertion converted to skip/xfail. Existing environment-dependent admin,
browser-matrix, zoom, and production-model validations remain in the carry-
forward register with their original exit criteria.
