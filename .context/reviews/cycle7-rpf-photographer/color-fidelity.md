# Cycle 7 RPF — Color-Fidelity Review (Photographer Perspective)

**Cycle:** 7/100
**Date:** 2026-05-08
**Reviewer angle:** color-fidelity (gamut, ICC, primaries, transfer-function fidelity).
**Baseline HEAD:** `9847c0dc`.
**Tooling:** ESLint exit 0; vitest 139 files / 1233 tests; `lint:api-auth` + `lint:action-origin` pass.

## File inventory walked

- `apps/web/src/lib/color-pipeline-decisions.ts` (canonical enum + `isP3Pipeline` helper, cycle 6)
- `apps/web/src/lib/color-primaries.ts` (`isWideGamutPrimary` helper)
- `apps/web/src/lib/process-image.ts` (Sharp pipeline, ICC profile detection, P3 mapping)
- `apps/web/src/lib/color-detection.ts` (HEIF/CICP transfer/primaries detection)
- `apps/web/src/components/color-details-section.tsx` (Color Details accordion grid)
- `apps/web/src/components/info-bottom-sheet.tsx` (mobile bottom-sheet color rows)
- `apps/web/src/components/photo-viewer.tsx` (desktop sidebar color rows)
- `apps/web/src/components/lightbox.tsx` (lightbox color pip panel)
- `apps/web/src/__tests__/is-p3-pipeline.test.ts` (cycle-6 lock test)
- `apps/web/src/__tests__/color-details-section-delivered.test.ts` (C4-A5 lock test)

## Findings

### C7-COL-MED-1 — Inline `startsWith('p3')` predicate at `color-details-section.tsx:230`

**Severity:** MED. **Confidence:** HIGH.

**File:line:** `apps/web/src/components/color-details-section.tsx:230`.

**Description:** The "Delivered bit depth" row distinguishes between "10-bit AVIF, 8-bit WebP/JPEG" (P3 pipeline) and "8-bit (all formats)" (sRGB pipeline) using:

```tsx
{image.color_pipeline_decision.startsWith('p3')
    ? t('viewer.deliveredBitDepthP3')
    : t('viewer.deliveredBitDepthSrgb')}
```

This is functionally equivalent to `isP3Pipeline(image.color_pipeline_decision)` (introduced in cycle 6, C6-A1) on every current enum value, because every value of `COLOR_PIPELINE_DECISIONS` that starts with `p3` also starts with `p3-from-`. However:

1. The two predicates have **different semantics**: `startsWith('p3')` matches any string starting with `p3` (including hypothetical future enum additions like `'p3-hdr'`, `'p3only'`, or even typo'd values). `isP3Pipeline` requires the full `p3-from-` prefix. The cycle-6 helper documents the contract: any value matching `p3-from-*` is treated as P3 delivery.
2. **C6-A1 missed this site.** The cycle-6 plan and lock test scoped consolidation to `info-bottom-sheet.tsx` (2 sites) and `photo-viewer.tsx` (1 site). This file is a fourth consumer of the same predicate and should also use the helper.
3. **The lock test for this row asserts the wrong predicate shape.** `color-details-section-delivered.test.ts:48` regex-locks the inline `startsWith('p3')` literal. A future contributor who fixes the implementation to use `isP3Pipeline(decision)` will see this test fail.

**Photographer impact:** today, none — every shipping enum value gives the same answer for both predicates. Forward-compat: when WI-09 ships HDR encoding, a hypothetical enum addition that starts with `p3` but not `p3-from-` would diverge. The bit-depth row would say "10-bit AVIF" while the gamut-aware download button on the same surface (which uses `isP3Pipeline`) would say "Download JPEG". The two labels describe the same delivery and must always agree.

**Recommended fix:**
1. Import `isP3Pipeline` in `color-details-section.tsx`.
2. Replace `image.color_pipeline_decision.startsWith('p3')` with `isP3Pipeline(image.color_pipeline_decision)`.
3. Update `color-details-section-delivered.test.ts:43-49` to lock the helper-call pattern instead of the inline literal.
4. Extend `__tests__/is-p3-pipeline.test.ts` Part 2 to also cover `color-details-section.tsx` (import lock + no-inline-literal lock).

## Negative findings (genuinely none)

- I walked `humanizeColorPipelineDecision` (`color-details-section.tsx:55-69`) — the cycle-5 i18n test already locks every enum value's en + ko translation, so the parameter being typed as `string | null | undefined` instead of `ColorPipelineDecision` is defensive-only (carry-forward C7-D15).
- I walked the `humanizeColorPrimaries` helper — Latinate convention is locked by `__tests__/humanize-color-primaries-latinate.test.ts` (C4-A8).
- I walked the gamut-aware download button label predicate at the three call sites consolidated in C6-A1 — all three import `isP3Pipeline` from `@/lib/color-pipeline-decisions` and the lock test passes.
- I walked the `process-image.ts:438, 441, 508, 702` ICC name-matching `startsWith('p3-d65')` / `startsWith('dci-p3')` predicates — these are server-side ICC profile-name string matching, NOT enum predicates over `color_pipeline_decision`. Out of scope for `isP3Pipeline`.
- I walked the `wide_gamut_jpeg_chroma` admin setting flow — locked end-to-end by cycle-5 tests; no drift.
- HDR transfer-function detection (`pq` / `hlg` from CICP) — locked by `parseCicpFromHeif` tests; carry-forward `full_range_flag` is admin-diagnostic only (C7-D1).

## Verdict

**1 MED, 0 HIGH, 0 CRIT.** The cycle-7 trajectory is sustained at 1 finding per cycle.
