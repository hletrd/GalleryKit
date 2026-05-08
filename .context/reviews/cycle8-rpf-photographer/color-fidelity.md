# Cycle 8 RPF — Color-Fidelity Review (Photographer Perspective)

**Cycle:** 8/100
**Date:** 2026-05-08
**Reviewer angle:** color-fidelity (gamut, ICC, primaries, transfer-function fidelity).
**Baseline HEAD:** `5682912c`.
**Tooling:** ESLint exit 0; vitest 139 files / 1239 tests; `lint:api-auth` + `lint:action-origin` pass.

## File inventory walked

- `apps/web/src/lib/color-pipeline-decisions.ts` (canonical enum + `isP3Pipeline` helper, cycle 6)
- `apps/web/src/lib/color-primaries.ts` (`isWideGamutPrimary` helper)
- `apps/web/src/lib/process-image.ts` (Sharp pipeline, ICC profile detection, P3 mapping)
- `apps/web/src/lib/color-detection.ts` (HEIF/CICP transfer/primaries detection)
- `apps/web/src/components/color-details-section.tsx` (Color Details accordion grid)
- `apps/web/src/components/info-bottom-sheet.tsx` (mobile bottom-sheet color rows)
- `apps/web/src/components/photo-viewer.tsx` (desktop sidebar color rows)
- `apps/web/src/components/lightbox.tsx` (lightbox color pip panel)
- `apps/web/src/__tests__/is-p3-pipeline.test.ts` (cycle-7-extended lock test, 3 consumer files locked)
- `apps/web/src/__tests__/color-details-section-delivered.test.ts` (cycle-7-updated to lock helper-call pattern)

## Findings

### **0 new findings.**

I deliberately walked every photographer-facing color path. The cycle-6 / cycle-7 `isP3Pipeline` consolidation fully closed all four call sites of the predicate. The lock test now covers `info-bottom-sheet.tsx` (2 sites), `photo-viewer.tsx` (1 site), and `color-details-section.tsx` (1 site) — every site is verified to import the helper, call it at least once, and not re-inline the predicate.

## Negative findings (positively confirmed unchanged)

- **`humanizeColorPipelineDecision` enum coverage** — locked by `color-pipeline-decision-i18n.test.ts` (C4-A7), still walks every value in `COLOR_PIPELINE_DECISIONS`.
- **`humanizeColorPrimaries` Latinate convention** — locked by `humanize-color-primaries-latinate.test.ts` (C4-A8).
- **`humanizeTransferFunction` i18n** — locked by `humanize-transfer-function-i18n.test.ts` (C4-A6).
- **HDR detection predicate `transfer_function === 'pq' || 'hlg'`** at three client sites: this is a 2-value enum-equality, not a `startsWith` prefix. There is no forward-compat hazard analogous to the cycle-6/7 P3 finding. The schema invariant `is_hdr === (transfer_function === 'pq' || 'hlg')` is documented at `lightbox.tsx:95` and locked for the lightbox by C5-A2 (`lightbox-color-pip-hdr-gating.test.ts`). I considered whether a `isHdrTransfer(image)` helper would be a maintainability win but concluded: (a) cycle 7 reviewer already classified this as a negative finding, (b) future HDR additions like HDR10+ or DolbyVision would need explicit code review at every site **and** require updating the helper anyway, (c) inventing the helper to "find work" violates the framing prompt's "DO NOT invent work" rule.
- **`humanizeColorPipelineDecision` parameter type** — still `string | null | undefined`, not `ColorPipelineDecision`. Carry-forward C8-D15 (cycle-7 deferred). Defensive-only; not actionable without a consolidation extension.
- **`process-image.ts:438, 441, 508, 702` ICC name-matching `startsWith('p3-d65')` / `startsWith('dci-p3')`** — server-side ICC profile-name string matching, NOT enum predicates over `color_pipeline_decision`. Out of scope for `isP3Pipeline`.
- **`wide_gamut_jpeg_chroma` admin setting flow** — locked end-to-end by cycle-5 tests; no drift.
- **CICP / HEIF transfer-function parsing** — locked by `parseCicpFromHeif` tests; carry-forward `full_range_flag` admin-diagnostic only (C8-D1).

## Verdict

**0 new findings.** The cycle-7 prediction "Cycle 8 should converge cleanly" is honored on the substance side: zero new color-fidelity findings. The single cycle-8 commit is plan-46 doc archival, not new work.
