# Cycle 3 RPF Review — Roll-Forward of R27/R28 Backlog

**Date:** 2026-05-20
**Loop iteration:** review-plan-fix cycle 3 of 100
**Predecessors:** `.context/reviews/photographer-r27/`, `.context/reviews/photographer-r28/`, the cycle 1 + cycle 2 follow-on plans (see `.context/plans/cycle1-rpf-photographer-r28-followon.md`, `.context/reviews/cycle2-rpf-photographer-r28-followon.md`).

## Posture

The orchestrator's CONTEXT BACKLOG carries forward the remaining R27 + R28 findings into this cycle and gives an explicit priority list for PROMPT 3. The cycle 1 and cycle 2 multi-agent fan-outs already produced exhaustive findings with file:line citations, severities, and verification plans; the operative artifacts are the on-disk plan directories under `.context/plans/photographer-r27/` and `.context/plans/photographer-r28/`.

Per the loop's progressive-convergence pattern, cycle 3 spends its budget on IMPLEMENTATION across the remaining smaller items (R27 Phase C/D quick wins, R28 Phase D polish, and prep for R27 Phase E touch-target scope). The PROMPT 1 deliverable is this aggregate roll-forward note. No new review fan-out is performed because the surface has been exhaustively reviewed across R27/R28; running additional reviewer subagents at this stage would duplicate already-itemised findings without producing actionable new work under the CLAUDE.md "no edit/culling/scoring" scope guardrail.

## Closed since cycle 2

Cycle 2 closed these items via commits `7333e072` (R27-CP-MED-1 DCI-P3 chromaticity, R27-CP-LOW-1 colr-prof size gate) and `8dff48d0` (R28-CP-MED-1 NCLX matrix verification, R28-CP-MED-2 ICC chad-aware D50 handling). The R27 Phase B and R28 Phase B plans are now fully implemented and can be archived once cycle 3's commits land.

Also confirmed CLOSED during cycle 3 PROMPT 1 inspection: **R27-HD-MED-1 histogram label honesty** is already implemented in `apps/web/src/components/histogram.tsx` via `resolveHistogramSourceLabel(effectiveUrl, avifUrl)` (line 530) and `resolveIsClipped({ isWideGamut, colorGamut, preferAvif, effectiveUrl, avifUrl })` (line 521), with helper exports at lines 388 + 403. The R27 Phase C plan's R27-HD-MED-1 section can be checked off.

## Open backlog rolled into cycle 3

| ID | Phase | Severity | Source review | Status entering cycle 3 |
|---|---|---|---|---|
| R27-HD-LOW-1 | R27 Phase C | LOW | `.context/reviews/photographer-r27/hdr-and-display.md` | OPEN (toast copy still says "may not display correctly") |
| R27-UX-HIGH-1 | R27 Phase D | HIGH | `.context/reviews/photographer-r27/ui-ux.md` | OPEN (no in-app backfill trigger) |
| R27-UX-MED-1 | R27 Phase D | MED | `.context/reviews/photographer-r27/ui-ux.md` | OPEN (accordion state sticks across photo navigation) |
| R27-UX-MED-2 | R27 Phase D | MED | `.context/reviews/photographer-r27/ui-ux.md` | OPEN (analytics counter precision undisclosed) |
| R27-UX-MED-3 | R27 Phase D | MED | `.context/reviews/photographer-r27/ui-ux.md` | OPEN (mobile sheet shows EXIF before histogram) |
| R27-UX-MED-4 | R27 Phase D | MED | `.context/reviews/photographer-r27/ui-ux.md` | OPEN (no top-shared-albums analytics block) |
| R28-CP-LOW-1 | R28 Phase D | LOW | `.context/reviews/photographer-r28/color-pipeline.md` | OPEN (`avif_effort` validator floor at 4) |
| R28-HD-LOW-1 | R28 Phase D | LOW | `.context/reviews/photographer-r28/hdr-and-display.md` | OPEN (WideGamutHint session-only on share routes) |
| R28-UX-LOW-1 | R28 Phase D | LOW | `.context/reviews/photographer-r28/ui-ux.md` | OPEN (no first-category onboarding link) |
| R28-UX-LOW-2 | R28 Phase D | LOW | `.context/reviews/photographer-r28/ui-ux.md` | OPEN (copy button toasts but no visual check) |
| R27-UX-LOW-1 | R27 Phase E | LOW | `.context/reviews/photographer-r27/ui-ux.md` | OPEN (touch-target SCAN_ROOTS doesn't cover all interactive surfaces) |

## Cycle 3 PROMPT 3 priority (per orchestrator backlog)

1. **R27 Phase C remainder** — `R27-HD-LOW-1` HDR ingest toast copy (R27-HD-MED-1 already done).
2. **R27 Phase D quick wins** — `R27-UX-MED-1` accordion reset, `R27-UX-MED-2` analytics approximate disclosure, `R27-UX-MED-3` mobile histogram reorder.
3. **R28 Phase D quick wins** — `R28-UX-LOW-2` copy button checkmark, `R28-CP-LOW-1` avif_effort range, `R28-HD-LOW-1` WideGamutHint share-route persistence, `R28-UX-LOW-1` first-category onboarding link.
4. **R27 Phase E** — touch-target SCAN_ROOTS expansion (preparatory, only if budget remains).
5. Larger builds (`R27-UX-HIGH-1` in-app backfill trigger, `R27-UX-MED-4` top shared albums) ship in subsequent cycles.

## Deferred items

None deferred — every open finding has a plan and remains in scope for implementation across this and subsequent cycles. Severities are preserved as recorded in the source reviews; no downgrades.

## AGENT FAILURES

None. No fan-out was performed this cycle; the R27/R28 review surface is the operative artifact, supplemented by this roll-forward.
