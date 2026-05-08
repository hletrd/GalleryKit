# Cycle 7 RPF — UI/UX Photographer Review

**Cycle:** 7/100
**Date:** 2026-05-08
**Reviewer angle:** ui-ux from the photographer's perspective (audit-surface clarity, consistency across desktop sidebar / mobile bottom sheet / lightbox pip / accordion grid).
**Baseline HEAD:** `9847c0dc`.

## File inventory walked

- `apps/web/src/components/photo-viewer.tsx` — desktop sidebar.
- `apps/web/src/components/info-bottom-sheet.tsx` — mobile bottom sheet (primary + alt path).
- `apps/web/src/components/color-details-section.tsx` — Color Details accordion grid (used by both desktop + mobile).
- `apps/web/src/components/lightbox.tsx` — full-screen color pip panel.
- `apps/web/src/components/wide-gamut-hint.tsx` — wide-gamut hint pill.
- `apps/web/src/components/histogram.tsx` — histogram + gamut label.

## Findings

### C7-UX-MED-1 — Cross-surface label drift hazard for "Delivered bit depth" vs "Download (P3)"

**Severity:** MED. **Confidence:** HIGH.
**Cross-angle agreement:** color-fidelity (C7-COL-MED-1) and critic (C7-CRIT-MED-1).

**File:line:** `apps/web/src/components/color-details-section.tsx:230`.

**Description:** Two photographer-facing labels on the same surface (mobile bottom sheet and desktop sidebar both render `color-details-section.tsx`) describe the same underlying delivery:

| Label | Source | Predicate |
|---|---|---|
| "Download (Display P3 JPEG)" / "Download JPEG" | `info-bottom-sheet.tsx` + `photo-viewer.tsx` | `isP3Pipeline(decision)` (cycle 6) |
| "10-bit AVIF, 8-bit WebP/JPEG" / "8-bit (all formats)" | `color-details-section.tsx:230` | `decision.startsWith('p3')` (still inline) |

These labels currently always agree because every shipping enum value satisfies both predicates equivalently. But they have **different forward-compat behavior** under hypothetical enum extensions starting with `p3` but not `p3-from-`. A photographer reading these two labels expects them to encode the same fact about their delivery; they should be driven by the same predicate.

**Photographer impact (forward-compat only):** if WI-09 lands and a future enum value starts with `p3` but not `p3-from-`, the two labels diverge on the same surface for the same photo. The photographer would see "Download JPEG" + "10-bit AVIF, 8-bit WebP/JPEG" — internally inconsistent.

**Photographer impact (today):** none. Every shipping enum value gives the same answer for both predicates.

**Recommended fix:** consolidate onto `isP3Pipeline` (the cycle-6 helper) so all four call sites share one predicate.

## Negative findings

- The desktop sidebar Color Details accordion (`color-details-section.tsx`) is rendered identically inside `photo-viewer.tsx` and `info-bottom-sheet.tsx`. Cross-surface consistency for every other row (Source / Delivered / DeliveredFormats / HDR badge / pipeline decision admin row) is already locked by `color-details-section-delivered.test.ts` (C4-A5), `__tests__/lightbox-color-pip-hdr-gating.test.ts` (C5-A2), and `__tests__/info-bottom-sheet-color-rows.test.ts` (existing).
- Wide-gamut hint pill is a single-source-of-truth component (`wide-gamut-hint.tsx`) consumed by both desktop and mobile.
- HDR badge is rendered identically by `color-details-section.tsx:253` and the lightbox pip panel — gated on `image.transfer_function === 'pq' || 'hlg'`, locked by C5-A2.
- The "P3 download" button label text is i18n'd uniformly across en + ko, locked by `humanize-color-pipeline-decision-i18n.test.ts` (C4-A7).

## Verdict

**1 MED, 0 HIGH, 0 CRIT.** The MED is the same finding as C7-COL-MED-1 viewed through the ui-ux lens (cross-surface label consistency).
