# Photographer R11 — Single-Agent Comprehensive Pass

**Date:** 2026-05-17
**Reviewer:** Cycle agent (no subagents registered in this environment).
**Lens combined:** color-pipeline + encoder/delivery + UI/UX + browser/display + perf + test + critic.

This file is the single per-agent review for R11. See `_aggregate.md` for
the dedup + cross-agent rollup (no dedup performed because there is only
one agent's output).

## File inventory (review-relevant surfaces)

- Encoder / pipeline: `apps/web/src/lib/process-image.ts`,
  `apps/web/src/lib/color-detection.ts`,
  `apps/web/src/lib/color-pipeline-decisions.ts`,
  `apps/web/src/lib/icc-chromaticity.ts`,
  `apps/web/src/lib/icc-extractor.ts`,
  `apps/web/src/lib/gain-map-detection.ts`,
  `apps/web/scripts/backfill-color-pipeline.ts`.
- Delivery: `apps/web/src/lib/serve-upload.ts`,
  `apps/web/src/lib/settings-hash.ts`, `apps/web/public/sw.js`,
  `apps/web/scripts/build-sw.ts`.
- Viewer / UI: `apps/web/src/components/photo-viewer.tsx`,
  `apps/web/src/components/lightbox.tsx`,
  `apps/web/src/components/lightbox-color-pip.tsx`,
  `apps/web/src/components/color-details-section.tsx`,
  `apps/web/src/components/wide-gamut-hint.tsx`,
  `apps/web/src/components/histogram.tsx`,
  `apps/web/public/histogram-worker.js`,
  `apps/web/src/components/info-bottom-sheet.tsx`,
  `apps/web/src/components/home-client.tsx`,
  `apps/web/src/app/[locale]/globals.css`.
- Admin: `apps/web/src/components/settings-client.tsx`,
  `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Display detection: `apps/web/src/lib/use-display-capability.ts`,
  `apps/web/src/lib/color-primaries.ts`.

## Findings

All findings are inlined in `_aggregate.md` in their final form
(severity + rationale + fix). This single-agent file exists solely for
provenance per the cycle instructions ("keep the per-agent files
as-is").

### Quick recap

| ID | Severity | Surface |
|----|----------|---------|
| R11-H1 | HIGH | SW HEAD-probe per cached image |
| R11-H2 | HIGH | SW_VERSION drift / build contract |
| R11-M1 | MED | HEAD probe ignores 304 semantics |
| R11-M2 | MED | Photo viewer fixed `8rem` chrome guess |
| R11-M3 | MED | Histogram worker still BT.709 only (R10-M2 carry-over evidence) |
| R11-M4 | MED | `force_srgb_derivatives` label asymmetry |
| R11-L1 | LOW | `IMAGE_PIPELINE_VERSION` not bumped for cycle-1 encoder changes |
| R11-L2 | LOW | Histogram canvas ctx-option object allocation |
| R11-L3 | LOW | `image-rendering: high-quality` also needed on lightbox |
| R11-L4 | LOW | WI-15 path lacks fixture test (R10-H1 follow-up) |
| R11-L5 | LOW | R9/R10 closure table is informational, not test-guarded |

## R10 carry-over confirmation

Spot-checked R10 partially-implemented items:

- **R10-H1** (WI-15 ICC) — Confirmed `keepIccProfile()` is present at
  `process-image.ts:791`.
- **R10-H3** (SW ETag compare) — Confirmed `staleWhileRevalidateImage`
  has the HEAD-probe block at `sw.js:165-178`.
- **R10-H6** (height cap) — Confirmed both `max-h-[calc(100vh-8rem)]`
  occurrences in `photo-viewer.tsx`.
- **R10-M3** (target-gamut chroma) — Confirmed
  `chromaSubsampling: targetIcc === 'p3' ? effectiveChroma : effectiveSdrChroma`.
- **R10-M10** (CSS MQ removal) — Confirmed `gamut-p3-badge` rule no
  longer references `@media (color-gamut: p3)`.
- **R10-M13** (Ken Burns 1.03×) — Confirmed in CSS / lightbox.
- **R10-L9** (sRGB blur) — Confirmed
  `.toColorspace('srgb')` in blur pipeline.
- **R10-L17** (no font-mono on histogram mode button) — Confirmed.

All cycle-1 fixes are in place. The new R11 findings are additive.
