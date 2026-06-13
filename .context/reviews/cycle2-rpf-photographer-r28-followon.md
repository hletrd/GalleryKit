# Cycle 2 RPF Review — Roll-Forward of R27/R28 Backlog

**Date:** 2026-05-20
**Loop iteration:** current review-plan-fix cycle 2 of 100
**Predecessor:** `.context/reviews/photographer-r27/`, `.context/reviews/photographer-r28/`, and the cycle 1 follow-on plans at `.context/plans/cycle1-rpf-photographer-r28-followon.md`.

## Posture

The orchestrator explicitly carried forward the R27 + R28 backlog into this cycle (see PROMPT 3 priority list in the cycle 2 prompt). The cycle 1 fan-out already produced 27+ findings with file:line citations, change sets, verification steps, and risk ratings. Re-running the multi-agent fan-out at this stage would duplicate findings that are already itemised, scoped, and implementation-ready.

Per the loop's progressive-convergence pattern, cycle 2 deliberately spends its budget on IMPLEMENTATION across the existing plan surface rather than a redundant second-pass review. The PROMPT 1 deliverable is this single aggregate roll-forward note; the plan deliverable (PROMPT 2) is the existing on-disk plan directories which already cover every open finding.

## Open backlog rolled into cycle 2

| ID | Phase | Severity | Source review |
|---|---|---|---|
| R27-CP-MED-1 | R27 Phase B | MED | `.context/reviews/photographer-r27/color-pipeline.md` |
| R27-CP-LOW-1 | R27 Phase B | LOW | `.context/reviews/photographer-r27/color-pipeline.md` |
| R28-CP-MED-1 | R28 Phase B | MED | `.context/reviews/photographer-r28/color-pipeline.md` |
| R28-CP-MED-2 | R28 Phase B | MED | `.context/reviews/photographer-r28/color-pipeline.md` |
| R27-HD-MED-1 | R27 Phase C | MED | `.context/reviews/photographer-r27/hdr-and-display.md` |
| R27-HD-LOW-1 | R27 Phase C | LOW | `.context/reviews/photographer-r27/hdr-and-display.md` |
| R27-UX-HIGH-1 | R27 Phase D | HIGH | `.context/reviews/photographer-r27/ui-ux.md` |
| R27-UX-MED-1 | R27 Phase D | MED | `.context/reviews/photographer-r27/ui-ux.md` |
| R27-UX-MED-2 | R27 Phase D | MED | `.context/reviews/photographer-r27/ui-ux.md` |
| R27-UX-MED-3 | R27 Phase D | MED | `.context/reviews/photographer-r27/ui-ux.md` |
| R27-UX-MED-4 | R27 Phase D | MED | `.context/reviews/photographer-r27/ui-ux.md` |
| R28-CP-LOW-1 | R28 Phase D | LOW | `.context/reviews/photographer-r28/color-pipeline.md` |
| R28-HD-LOW-1 | R28 Phase D | LOW | `.context/reviews/photographer-r28/hdr-and-display.md` |
| R28-UX-LOW-1 | R28 Phase D | LOW | `.context/reviews/photographer-r28/ui-ux.md` |
| R28-UX-LOW-2 | R28 Phase D | LOW | `.context/reviews/photographer-r28/ui-ux.md` |
| R27-UX-LOW-1 | R27 Phase E | LOW | `.context/reviews/photographer-r27/ui-ux.md` |

## Cycle 2 PROMPT 3 priority (per orchestrator backlog)

1. **R27 Phase B** — DCI-P3 chromaticity preset + verify-prof scanner gate
2. **R28 Phase B** — NCLX matrix verification + ICC chromaticity D50 handling
3. **R27 Phase C** — histogram label after AVIF 404 + HDR ingest toast copy
4. **R27 Phase D quick items** — accordion reset, mobile histogram reorder, analytics disclosure, copy-button feedback, top shared albums (if time)

## Deferred items

None deferred — every open finding has a plan and is in scope for this cycle's implementation pass per the orchestrator's priority list.

## AGENT FAILURES

None. No fan-out was performed this cycle; the cycle 1 review surface is the operative artifact.
