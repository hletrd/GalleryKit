# Cycle 6 RPF — color-fidelity review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 6 of 100
**Master HEAD at review time:** `b93af71a` ("build(sw): bump service worker SW_VERSION to 3d8028ee").
**Reviewer focus:** color reproduction accuracy, ICC management, wide-gamut delivery, locale coverage of humanizers, fixture-test coverage of shipped photographer behaviors.

---

## Summary

Cycle 5 shipped C5-A1..C5-A5 cleanly: lightbox HDR pip dedup (C5-A1), HDR pip lock test (C5-A2), `COLOR_PIPELINE_DECISIONS` source-of-truth canonicalization (C5-A3), `info-bottom-sheet.tsx` indentation normalization (C5-A4), plan-43 archival (C5-A5). All four gates green at cycle-6 baseline (`eslint` exit 0; `vitest` 138 files / 1213 tests; `lint:api-auth`; `lint:action-origin`).

The cycle-6 sweep finds **one new MED finding** that has cross-angle agreement with `ui-ux-photographer.md`: the `startsWith('p3-from-')` predicate that decides between "Download (Display P3 JPEG)" and "Download JPEG" labels is duplicated literally three times across the gamut-aware download menu (`info-bottom-sheet.tsx:333`, `info-bottom-sheet.tsx:550`, `photo-viewer.tsx:847`). All three sites share identical business logic; none has a test lock; a fourth call site would be easy to miss.

No CRIT, no HIGH color-fidelity items.

---

## Findings

### MED

#### C6-COL-MED-1 — `color_pipeline_decision.startsWith('p3-from-')` triplicated across gamut-aware download sites

**File:**
- `apps/web/src/components/info-bottom-sheet.tsx:333` (mobile sheet, primary trigger).
- `apps/web/src/components/info-bottom-sheet.tsx:550` (mobile sheet, alternative layout / secondary path).
- `apps/web/src/components/photo-viewer.tsx:847` (desktop sidebar).

**Confidence:** HIGH.

**Photographer impact:** today the predicate works. All current `'p3-from-*'` enum values share the prefix (`'p3-from-displayp3'`, `'p3-from-dcip3'`, `'p3-from-adobergb'`, `'p3-from-prophoto'`, `'p3-from-rec2020'`), and the `srgb` / `srgb-from-unknown` values correctly fall through to the `'Download JPEG'` label. The current behavior is correct.

The risk is **call-site drift**:
1. When WI-09 (HDR encoder) ships, a new enum value such as `'p3-from-bt2100hlg'` or `'p3-from-bt2100pq'` would by accident cover correctly (still starts with `'p3-from-'`). But a contributor who introduces a non-`p3-from-`-prefixed P3-mapped enum (e.g. `'displayp3-passthrough'` for HDR-aware passthrough) would have to update three identical call sites, none of which have a test lock; missing one would silently downgrade the photographer-facing label from "Download (Display P3 JPEG)" to "Download JPEG" on either the desktop sidebar or the mobile bottom-sheet, depending on which site was missed.
2. Today the cycle-5 i18n test (`color-pipeline-decision-i18n.test.ts`) walks `COLOR_PIPELINE_DECISIONS` and checks each value translates non-empty in en + ko. **It does not check the call-site prefix predicate.** A future enum addition that breaks the prefix invariant would fail at runtime, not at test time.

**Recommendation:** extract a shared helper `isP3Pipeline(decision: ColorPipelineDecision | null | undefined): boolean` in `apps/web/src/lib/color-pipeline-decisions.ts`, replace the three call sites, and add a fixture test that walks `COLOR_PIPELINE_DECISIONS` asserting the helper returns the expected boolean for every enum value (lock the prefix invariant). Effort: S.

This is MED, not LOW, because:
- the decision is photographer-visible (label drift would be noticed by a wide-gamut photographer using both desktop + mobile);
- three sites with identical logic and zero shared helper is precisely the shape of bug that ships when only one site gets updated;
- the cycle-5 canonical enum module already exists — adding the helper there is a near-zero-cost extension that lifts the predicate onto the same source-of-truth surface.

**Cross-angle:** flagged independently in `ui-ux-photographer.md` (download-button label drift). Two-way cross-angle agreement.

---

### LOW

#### C6-COL-LOW-1 — `humanizeColorPipelineDecision` switch + `COLOR_PIPELINE_DECISIONS` const not exhaustively type-coupled

**File:** `apps/web/src/components/color-details-section.tsx:55-69`; `apps/web/src/lib/color-pipeline-decisions.ts:22-32`.

**Confidence:** LOW.

**Photographer impact:** zero today. The cycle-5 test at `__tests__/color-pipeline-decision-i18n.test.ts` walks `COLOR_PIPELINE_DECISIONS` and asserts every value translates to non-empty strings in en + ko, so a missing translation key fails the test. However, the `humanizeColorPipelineDecision` function still uses an inline `switch` over string literals rather than typing its parameter as `ColorPipelineDecision | null | undefined`. A typo in a future case statement (e.g. `case 'p3-from-displaypp3':` from a stray keystroke) would silently fall through to the default `''` empty string and render the locale fallback `t('viewer.colorUnknown')`.

**Recommendation:** keep deferred — the i18n test catches the photographer-visible failure mode. A type-narrow refactor would be S effort and is purely defensive. Couples to the C6-COL-MED-1 helper extraction; if cycle 6 ships C6-A1, the helper test will exercise the same enum-walking pattern and the cost of adding the type-narrow on `humanizeColorPipelineDecision` drops.

---

## Items deferred / carried forward

All cycle-5 carry-forwards persist (C5-D1..C5-D14). No new deferred LOWs beyond C6-COL-LOW-1.

---

## Cross-references

- C5-A3 / C5-COL-MED-2 (cycle 5 commit `c9ac9748`) — canonicalized the enum source of truth.
- C5-A1 / C5-COL-MED-1 (cycle 5 commit `7e8ee537`) — dropped the lightbox HDR pip panel-internal HDR row.
- `.context/reviews/ui-ux-r2/accessibility-responsive.md:124` — flagged the `aria-live` aspect of the dynamic label switch (`[A11Y-MED-10]`); does NOT cover the call-site duplication.
- C6-UX-MED-1 (cross-angle).
