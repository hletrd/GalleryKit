# Cycle 4 RPF — UI-UX (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 4 of 100
**Master HEAD at review time:** `ad981085`.
**Reviewer focus:** photographer audit ergonomics — sidebar IA, mobile bottom-sheet IA, lightbox pip, accordion default, locale mixing.

---

## Summary

Plan-38 / plan-42 UI/UX shipping is extensive:
- P3-15 (HDR badge gradient).
- P3-16 (lightbox color pip + slide-up panel).
- P3-17 (drop !important).
- P3-22 (delivered formats row).
- P3-25 (accordion default open for non-trivial color).
- P3-26 (`force_show_color_chips` admin opt-in + CSS overrides).
- P3-27 (P3 chip dedup — only inside Color Details accordion).
- P3-28 (mobile bottom-sheet conditional reorder for non-trivial sources).
- P3-29 (Korean translation pass for color terms).
- P3-30 (`primariesMatchIcc` normalization).
- P3-31 (download dropdown menu descriptions).
- C3-A2 (`humanizeTransferFunction` localized).
- C3-A3 (HDR badge in lightbox color pip).
- C3-A4 (Promise-singleton AVIF probe — no histogram flicker).

Cycle 4 sweep finds **one MED IA gap (Color Space row dedup, P3-32 not yet landed)** and a few LOW polish opportunities.

---

## Findings

### MED

#### C4-UX-MED-1 — Color Space row duplicated between EXIF grid and Color Details accordion

**File:** `apps/web/src/components/photo-viewer.tsx:709-714`; `apps/web/src/components/info-bottom-sheet.tsx:424-429`.

**Confidence:** HIGH.

**Photographer impact:** the photo-viewer sidebar shows ICC name in two places when accordion is auto-expanded (default for non-trivial sources). Mobile bottom sheet has the same issue. Visual redundancy for the most common photographer use case (wide-gamut photos).

P3-32 in plan-38 specified removal of the EXIF grid `Color Space` row. Plan-38 is otherwise fully shipped. This is a 12-line deletion across two files.

**Recommendation:** delete the `Color Space` row from both `photo-viewer.tsx` and `info-bottom-sheet.tsx`. Effort: XS. (Implement in cycle 4.)

This is a cross-angle finding — same as C4-COL-MED-1. Doubled high-signal.

---

#### C4-UX-MED-2 — Sidebar bit-depth row stays in EXIF grid; Color Details accordion shows "Source bit depth" indirectly via `image.bit_depth`

**File:** `apps/web/src/components/photo-viewer.tsx:769-774`; `apps/web/src/components/color-details-section.tsx:192-219`.

**Confidence:** MEDIUM.

**Photographer impact:** the EXIF grid has a `Source bit depth` row (P3-5 added the rename). The Color Details accordion has a `Delivered` row (P3-5) but no explicit `Source` row. So when the accordion is open the photographer sees:
- Color Details > Color Space + Primaries + Transfer + Decision + Delivered + DeliveredFormats + (HDR badge)
- EXIF > Camera, Lens, ..., Source bit depth, Format, ...

The split is reasonable (source = capture-side, delivered = pipeline-side). But a curious photographer comparing source bit depth to delivered bit depth needs to look in two panels. Adding a `Source bit depth` row inside the accordion (mirroring the EXIF grid label) co-locates the comparison.

**Recommendation:** in Color Details accordion, add a `Source` row when `image.bit_depth` is present. The row reads `{N}-bit` (en) / `{N}비트` (ko). Co-located beside the existing `Delivered` row makes the source-vs-delivered comparison instant. Effort: XS.

---

### LOW

#### C4-UX-LOW-1 — `colorDetailsId` collision sidebar↔sheet during breakpoint transition (carry-forward)

**File:** `apps/web/src/components/color-details-section.tsx:111` (carry-forward from C3-D12).

**Confidence:** HIGH.

**Recommendation:** keep deferred; carry-forward as `C4-D8`. Couples to the cycle-3 deferred `C3-D1` (refactor to hoist accordion state to PhotoViewer parent).

---

#### C4-UX-LOW-2 — Histogram clip threshold (0.5%) hardcoded

**File:** `apps/web/src/components/histogram.tsx:281,286-287` (carry-forward from C3-D11 / P3-33 polish bundle).

**Confidence:** MEDIUM.

**Recommendation:** keep deferred; carry-forward as `C4-D9`. Exit criterion: P3-33 polish bundle picked up.

---

#### C4-UX-LOW-3 — Histogram canvas size fixed `240x120`; not responsive (carry-forward)

**File:** `apps/web/src/components/histogram.tsx` (carry-forward from C3-D13 / P3-33 / R3-L7).

**Confidence:** HIGH.

**Recommendation:** keep deferred; carry-forward as `C4-D10`.

---

#### C4-UX-LOW-4 — `c` / `h` keyboard shortcuts dead on mobile bottom-sheet (carry-forward)

**File:** `apps/web/src/components/info-bottom-sheet.tsx`; `apps/web/src/components/photo-viewer.tsx:343-351, 668, 807`.

**Confidence:** HIGH.

**Recommendation:** keep deferred; carry-forward as `C4-D11`. Couples to architectural refactor `C3-D1`.

---

## Cross-references

- Plan-38 — fully shipped except P3-32 row dedup (cycle 4 implements) and P3-33 polish bundle (deferred).
- Plan-42 — fully shipped.
- Cycle-3 UI-UX review — `.context/reviews/cycle3-rpf-photographer/ui-ux-photographer.md`.
