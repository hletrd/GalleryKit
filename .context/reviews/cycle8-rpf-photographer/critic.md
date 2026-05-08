# Cycle 8 RPF — Critic Review

**Cycle:** 8/100
**Date:** 2026-05-08
**Reviewer angle:** critic — challenge the cycle-7 plan, audit completeness of consolidations, find skipped sites.
**Baseline HEAD:** `5682912c`.

## What I challenged

The cycle-7 plan claimed C7-A1 + C7-A2 fully closed the `isP3Pipeline` consolidation. I ran a wider audit:

```bash
grep -rn "startsWith('p3" apps/web/src --include='*.ts' --include='*.tsx'
```

Returns:
- `lib/process-image.ts:438` (`startsWith('p3-d65')`) — server-side ICC profile-name match, not enum predicate. Out of scope.
- `lib/color-pipeline-decisions.ts:64` (`startsWith('p3-from-')`) — inside the helper itself.
- `__tests__/...` test fixture references — not call sites.

**Zero non-helper, non-server, non-test inline `startsWith('p3')` literals remain.** Cycle-7's consolidation is genuinely complete.

I also walked the lock-test extension:
- `__tests__/is-p3-pipeline.test.ts` Part 2 — `consumerPaths` now contains 3 entries (info-bottom-sheet, photo-viewer, color-details-section), with 4 source-inspection assertions each (12 total).
- The `does NOT contain bare inline startsWith p3 literal` assertion (added by C7-A2) protects against the cycle-7-found regression class.

## Finding

**0 new findings.**

I considered the HDR triplication (`transfer_function === 'pq' || 'hlg'` at three client sites) — same DRY-style pattern that drove the cycle-6 P3 finding. Concluded:

1. It is an enum-equality, not a prefix predicate. No forward-compat hazard.
2. Cycle-7 reviewer explicitly classified it as a negative finding.
3. The framing prompt forbids inventing work: "DO NOT invent work. The convergence rule depends on honest reporting. If nothing remains, return zero."

I will not raise it as a finding because raising it would be exactly the kind of work-invention the framing forbids. If a future HDR enum extension lands (HDR10+, Dolby Vision), the analogous helper consolidation can be undertaken at that time, and the helper will provide actual value (matching the new transfer values without per-site code review).

## Process critique

The cycle-7 plan was complete. C7-A1, C7-A2, and C7-A3 all shipped in cycle 7. The lock-test extension covers the regression class. The plan-archival step (C7-A3) shipped plan-45 to `done/`.

The only outstanding doc-state item is **plan-46 itself** — it lives in `plans/` after cycle 7 closed. Cycle 7's plan implicitly scheduled plan-46 for archival in cycle 8 (the next cycle after all its work items shipped). C8-A1 is the doc-move.

## Verdict

**0 new findings.** The convergence trajectory (9 → 18 → 25 → 13 → 4 → 1 → 1 → **0**) reaches the honest-zero plateau. Cycle 8 ships one doc-archival commit only.
