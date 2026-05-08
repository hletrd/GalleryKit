# Cycle 6 RPF — UI-UX review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 6 of 100
**Master HEAD at review time:** `b93af71a`.
**Reviewer focus:** photographer audit ergonomics — sidebar / bottom-sheet IA, lightbox pip IA, accordion behavior, HDR badge placement, gamut-aware download UX, keyboard shortcuts.

---

## Summary

Cycle 5 shipped C5-A1 (lightbox HDR pip dedup), C5-A4 (info-bottom-sheet indentation normalization). The visual audit panel is now consistently styled.

Cycle 6 sweep finds **one new MED finding** that has 2-way cross-angle agreement with `color-fidelity.md`: the gamut-aware download button label predicate is triplicated across three call sites with no shared helper and no test lock. **No CRIT, no HIGH photographer-UX issues this cycle.**

The cycle-5 deferred set (C5-D1..C5-D14) carries forward unchanged.

---

## Findings

### MED

#### C6-UX-MED-1 — Gamut-aware download label predicate triplicated (cross-angle)

**Cross-angle:** same finding as **C6-COL-MED-1**.

**File:**
- `apps/web/src/components/info-bottom-sheet.tsx:333` (mobile bottom sheet, primary path).
- `apps/web/src/components/info-bottom-sheet.tsx:550` (mobile bottom sheet, alternative layout path).
- `apps/web/src/components/photo-viewer.tsx:847` (desktop sidebar).

**Confidence:** HIGH.

**Photographer impact:** the desktop sidebar and the mobile bottom sheet are the two photographer-facing audit surfaces. The gamut-aware download dropdown trigger label switches between "Download (Display P3 JPEG)" and "Download JPEG" via `image.color_pipeline_decision?.startsWith('p3-from-')`. Today the predicate is identical at all three sites and the behavior is correct.

UX-side risk:
1. **Label drift between desktop and mobile** if a contributor updates only one site. The desktop sidebar would say "Display P3 JPEG" while mobile says "JPEG" (or vice versa), and a photographer auditing the same photo on both surfaces would see inconsistent gamut messaging.
2. **No test lock** — the cycle-5 source-inspection lock test (`lightbox-color-pip-hdr.test.ts`) is scoped to the lightbox pip; nothing audits the download-button call sites.
3. **Triple-site invariant is implicit** — a contributor adding a fourth site (e.g. a future "share with friend" download flow) has no shared helper to import; they're likely to copy-paste one of the existing sites and may copy the wrong one.

**Recommendation:** extract a shared `isP3Pipeline(decision)` helper into `apps/web/src/lib/color-pipeline-decisions.ts`, replace the three call sites, and lock the contract via fixture test. Same recommendation as C6-COL-MED-1. Effort: S.

See `color-fidelity.md#C6-COL-MED-1` for full spec.

---

### LOW

All cycle-5 LOWs (C5-UX-LOW-1..C5-UX-LOW-4) carry forward unchanged. No new LOWs.

---

## Cross-references

- C6-UX-MED-1 ↔ C6-COL-MED-1 (cross-angle, 2-way agreement).
- Plan-44 deferred set §3 — C5-D8..C5-D11 / C5-ARCH-MED-1 carry-forwards.
- C5-A1 / C5-A4 — cycle 5 UI commits all shipped.
