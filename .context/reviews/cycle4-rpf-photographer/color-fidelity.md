# Cycle 4 RPF — color-fidelity review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 4 of 100
**Master HEAD at review time:** `ad981085` ("fix(build): split client-safe color primaries module").
**Reviewer focus:** color reproduction accuracy, ICC management, wide-gamut delivery, locale coverage of humanizers.

---

## Summary

Plan-38 has shipped a remarkable amount of color-fidelity surface area. P3-1 (HDR download landmine), P3-2 (HDR ingest reject + setting), P3-3 (admin-only HDR fields), P3-4 (audit-label clip acknowledgement), P3-5 (source/delivered bit depth), P3-6 (canvas-P3 runtime probe), P3-7 (DCI-P3 label), P3-8 (wide-gamut hint), P3-9 (histogram clip indicators), P3-10 (chip contrast), P3-11 (NCLX fallback), P3-15 (HDR badge gradient), P3-16 (lightbox color pip), P3-17 (drop !important), P3-22 (delivered formats), P3-25 (accordion default open), P3-26 (force_show_color_chips), P3-29 (Korean translations), P3-30 (primariesMatchIcc normalization) are all present in source.

Cycle 4 sweep finds no new CRIT or HIGH color-fidelity items. The residual MED items are either:
- Duplicate ICC / colorSpace rendering between the EXIF grid and the Color Details accordion (cosmetic dedup gap; functional but redundant).
- Test gaps for shipped behaviors that are not yet locked by fixture tests.
- An open `humanizeColorPipelineDecision` carry-forward where the i18n callback is in place but the fallback `t('viewer.colorUnknown')` returns the locale's "unknown" word for an unknown enum, which is acceptable but worth a smoke test.

No silent miscolor risk found in cycle 4 inspection.

---

## Findings

### MED

#### C4-COL-MED-1 — `viewer.colorSpace` row duplicated in EXIF grid and Color Details accordion

**File:** `apps/web/src/components/photo-viewer.tsx:709-714`; `apps/web/src/components/info-bottom-sheet.tsx:424-429`; `apps/web/src/components/color-details-section.tsx:147,161`.

**Confidence:** HIGH.

**Photographer impact:** the photo viewer sidebar shows the same ICC profile name in two places — once in the "Color Space" row of the EXIF grid (`viewer.colorSpace`) AND once inside the Color Details accordion when expanded. The accordion auto-opens for non-trivial color (P3-25), so for any wide-gamut photo the photographer sees the ICC name twice in adjacent rows. The mobile bottom sheet has the identical layout (P3-28 reorder still shows EXIF after Color Details for non-trivial sources and before for sRGB sources; either way both panels render the same `viewer.colorSpace` row).

P3-32 in the original R3 plan called for lifting Color Details up and **removing the Color Space row from the EXIF grid**. That removal has not landed.

**Recommendation:** drop the `viewer.colorSpace` row from both the photo-viewer sidebar EXIF grid (`photo-viewer.tsx:709-714`) and the mobile bottom sheet EXIF grid (`info-bottom-sheet.tsx:424-429`). The Color Details accordion is the canonical home for ICC + primaries + transfer + decision + delivered bit depth + delivered formats. Removing the duplicate row is a 12-line deletion.

**Rollback:** trivial — re-add the row.

---

#### C4-COL-MED-2 — `viewer.colorPipelineDecision` falls through to `viewer.colorUnknown` for unknown enums

**File:** `apps/web/src/components/color-details-section.tsx:189`.

**Confidence:** MEDIUM.

**Photographer impact:** `humanizeColorPipelineDecision(value, t)` returns `''` for any enum that doesn't match the hardcoded list. The consuming render uses `humanizeColorPipelineDecision(image.color_pipeline_decision, t) || t('viewer.colorUnknown')`. The fallback says "unknown" / "알 수 없음" which is correct UX, but masks pipeline-decision drift if a new decision value is added without updating the humanizer.

**Recommendation:** carry-forward as a smoke test that locks all current `color_pipeline_decision` enum values produce a non-empty humanized string in both en + ko. Effort: XS.

---

### LOW

#### C4-COL-LOW-1 — No vitest fixture for `deliveredBitDepth` / `deliveredFormats` rendering

**File:** `apps/web/src/components/color-details-section.tsx:192-219`; missing test.

**Confidence:** HIGH.

**Photographer impact:** P3-5 / P3-22 shipped without unit-test coverage. Refactoring the row could silently swap labels (e.g. switching `deliveredBitDepthSrgb` and `deliveredBitDepthP3` keys would not be caught by the existing test suite).

**Recommendation:** add a fixture-style test that mounts `ColorDetailsSection` for an sRGB photo and a P3 photo, asserts the correct `deliveredBitDepth*` and `deliveredFormats` row contents.

---

#### C4-COL-LOW-2 — `primariesMatchIcc` normalization not locked by test

**File:** `apps/web/src/components/color-details-section.tsx:71-78` (`normalizeForCompare`); missing test.

**Confidence:** HIGH.

**Photographer impact:** P3-30 normalizer regex strips `(...)` suffix, "ICC profile" suffix, "profile" suffix, then trims. A future regex tweak could regress the dedup behavior — "Display P3 - ACES" + primariesHuman "Display P3" matched today; tomorrow a developer could rewrite the regex and flip the behavior silently.

**Recommendation:** add a fixture test for `normalizeForCompare` covering: bare "Display P3", "Display P3 (ACES)", "Display P3 ICC Profile", "Display P3 Profile", and a non-matching "Adobe RGB". Assert `primariesMatchIcc` returns `true` for all match cases and `false` for the non-match.

---

#### C4-COL-LOW-3 — `colorPipelineDecision` enum keys not exhaustively tested

**File:** `apps/web/messages/en.json:334-340` + `ko.json:334-340`; `color-details-section.tsx:55-69`.

**Confidence:** MEDIUM.

**Photographer impact:** if a new enum like `'p3-from-bt2100hlg'` is added to `colorPipelineDecision` without updating the humanizer keyspace, the audit row shows the locale's "unknown" word silently.

**Recommendation:** add an enum-coverage test that walks all known `color_pipeline_decision` values and asserts non-empty translation in both locales.

---

#### C4-COL-LOW-4 — `humanizeColorPrimaries` Latinate convention not locked

**File:** `apps/web/src/components/color-details-section.tsx:9-27`; missing test.

**Confidence:** LOW.

**Photographer impact:** the inline docstring describes the Latinate-by-convention rule, but no unit test prevents a future contributor from converting one of the values (e.g. `'p3-d65': 'Display P3'`) to a translated version (e.g. `t('viewer.primariesDisplayP3')`). A test would lock the convention against drift.

**Recommendation:** add a fixture test asserting `humanizeColorPrimaries` returns the Latinate strings exactly. XS effort, prevents drift.

---

## Cross-references

- Plan-38 (predecessor) — most plan-38 items shipped. C4-COL-MED-1 is the open P3-32 carry-forward.
- Plan-42 (cycle-3 RPF) — fully shipped. Archive in cycle 4.
- Cycle-3 master review — `.context/reviews/cycle3-rpf-photographer/_aggregate.md`.

## Test gaps to add (combined)

1. `__tests__/color-details-section-delivered.test.tsx` — fixture-style render for sRGB and P3 photos.
2. `__tests__/color-details-primaries-match-icc.test.ts` — `normalizeForCompare` + `primariesMatchIcc` fixture.
3. `__tests__/color-pipeline-decision-i18n.test.ts` — enum-coverage smoke for both locales.
4. `__tests__/humanize-color-primaries.test.ts` — Latinate convention lock.

Total: 4 new fixture tests, ~80 lines combined.
