# Cycle 10 UI/UX Designer Reviewer

Date: 2026-07-18 KST  
Reviewed HEAD: `1e3646e3`  
Lane: repository-specific `ui-ux-designer-reviewer`

## Definition and evidence

This repository-specific lane was enumerated from `.context/reviews/ui-ux-designer-reviewer.md` and prior cycle provenance. It used the same live-browser evidence recorded in `designer.md`, with emphasis on information architecture, responsive composition, task flow, presentation fidelity, and perceived performance.

## UIUX-C10-01 — Image resource affordance is internally dishonest on source-limited photos

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**
- Regions: `apps/web/src/lib/image-url.ts:91-95`; `apps/web/src/lib/process-image.ts:1214-1234`; `apps/web/src/components/masonry-card.tsx:88-110`; timeline/year/shared grids; `apps/web/e2e/responsive-masonry.spec.ts:102-138`.

Responsive layout geometry is correct, but the resource-selection layer tells the browser that duplicate 1200 px bytes represent widths through 7680 px. The browser therefore cannot make an informed selection. On sparse large layouts, the resulting softness reads as a layout/image-quality failure even though the card dimensions and source file may be functioning exactly as coded.

Concrete failure: a one-photo grid expands to 1504 CSS px and the UI presents it as a hero image, but the chosen supposedly 4096w asset provides 1200 pixels. Fix the intrinsic-width contract, deduplicate actual widths, and add a decoded-pixel browser assertion. Consider capping sparse-card visual expansion if product design does not want to display source-limited images beyond their useful size, but truthful source descriptors are required regardless.

## UX matrix result

Public IA, named controls, search keyboard flow, focus restoration, 320 px reflow, EN/KO, dark/light themes, and offline fallback passed live inspection. No new empty/error/loading, touch-target, contrast, or RTL-current-locale finding was confirmed. Admin responsive and field-validation concerns already present in the carry-forward register were source-revalidated but not duplicated because their exit criteria did not fire.
