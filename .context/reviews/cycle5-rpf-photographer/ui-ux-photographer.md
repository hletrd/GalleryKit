# Cycle 5 RPF — UI-UX review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 5 of 100
**Master HEAD at review time:** `82b3dcfd`.
**Reviewer focus:** photographer audit ergonomics — sidebar IA, mobile bottom-sheet IA, lightbox pip IA, accordion behavior, HDR badge placement, keyboard shortcuts.

---

## Summary

Cycle 4 shipped C4-A1 (Color Space row dedup, P3-32 finish), C4-A2 (Source bit-depth co-located in Color Details accordion), and C4-A3 (lightbox HDR pip gate harmonization). The audit panel is now noticeably tighter.

Cycle 5 sweep surfaces:
- **One MED** new finding: lightbox color pip expanded panel duplicates the HDR badge (cross-angle with C5-COL-MED-1).
- **One MED** cosmetic: indentation / quoting drift in `info-bottom-sheet.tsx:207, 234, 487` — three lines use a leading tab character followed by spaces instead of the surrounding all-spaces convention. Easily missed.
- **Several LOW** carry-forwards from earlier cycles remain deferred per the plan-43 deferred set (C4-D8..C4-D11).

No CRIT, no HIGH photographer-UX issues this cycle.

---

## Findings

### MED

#### C5-UX-MED-1 — Lightbox color-pip expanded panel double-renders the HDR badge (cross-angle)

**Cross-angle:** same as **C5-COL-MED-1** / **C5-HDR-MED-1**.

**File:** `apps/web/src/components/lightbox.tsx:120-128, 150-161`.

See `color-fidelity.md#C5-COL-MED-1` for full spec.

---

#### C5-UX-MED-2 — Mixed indentation in `info-bottom-sheet.tsx`

**File:** `apps/web/src/components/info-bottom-sheet.tsx:207, 234, 487` (and a few other lines as a result of editor merge).

**Confidence:** HIGH.

**Photographer impact:** zero today (renders identically; ESLint passes). But the file mixes leading tab + spaces (`\t                    className=…`) on three lines with the surrounding all-spaces 4-indentation convention used everywhere else in the codebase. A future formatter run (Prettier with `useTabs: false`, repository default) will rewrite these and the resulting diff will obscure the meaningful change.

**Recommendation:** normalize to all-spaces 4-indentation. One commit, ~3 lines changed. Effort: XS.

---

### LOW

#### C5-UX-LOW-1 — `colorDetailsId` collision sidebar↔sheet (carry-forward C4-D8 / C3-D12)

**Recommendation:** keep deferred. Couples to C4-D12.

---

#### C5-UX-LOW-2 — Histogram clip threshold (0.5%) hardcoded (carry-forward C4-D9 / C3-D11 / P3-33 polish)

**Recommendation:** keep deferred.

---

#### C5-UX-LOW-3 — Histogram canvas size fixed `240x120`; not responsive (carry-forward C4-D10 / C3-D13 / R3-L7)

**Recommendation:** keep deferred. Couples to P3-33 polish bundle.

---

#### C5-UX-LOW-4 — `c` / `h` keyboard shortcuts dead on mobile bottom-sheet (carry-forward C4-D11 / C4-D12)

**Recommendation:** keep deferred. Couples to architectural refactor.

---

## Cross-references

- C5-UX-MED-1 ↔ C5-COL-MED-1 ↔ C5-HDR-MED-1 (cross-angle, three-way agreement).
- C5-UX-MED-2 — NEW finding not present in cycle 4.
- Plan-43 deferred set §3 — C4-D8..C4-D12 all carried forward.
