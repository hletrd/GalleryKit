# Cycle 5 RPF — color-fidelity review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 5 of 100
**Master HEAD at review time:** `82b3dcfd` ("fix(test): narrow next-intl message table type for nested viewer keys").
**Reviewer focus:** color reproduction accuracy, ICC management, wide-gamut delivery, locale coverage of humanizers, fixture-test coverage of shipped photographer behaviors.

---

## Summary

Cycle 4 shipped the C4-A1..C4-A8 queue cleanly: P3-32 finish (Color Space row dedup), C4-A2 source-bit-depth co-location in Color Details, C4-A3 lightbox HDR pip gate harmonization, plus the four fixture tests (C4-A5..C4-A8) that lock the photographer behaviors. All gates green at cycle-5 baseline (`eslint` exit 0; `vitest` 137 files / 1207 tests; `lint:api-auth`; `lint:action-origin`).

Cycle 5 sweep finds **no new CRIT or HIGH color-fidelity items**. The residual findings are residual polish. **One MED is a previously-unflagged double-rendering of the HDR badge inside the expanded lightbox color pip panel**, two MED/LOW items concern test-coverage extensions, and one LOW concerns a dead-code helper (`hdr-filenames.ts`) carried for the future HDR encoder.

---

## Findings

### MED

#### C5-COL-MED-1 — Lightbox color-pip expanded panel double-renders the HDR badge

**File:** `apps/web/src/components/lightbox.tsx:120-128, 150-161`.

**Confidence:** HIGH.

**Photographer impact:** when a photographer opens the lightbox color pip on an HDR photo and clicks/taps the chip to expand the detail panel, the HDR badge renders TWICE for the same row:

1. Inline in the closed-pip button row (`<button>` line 106-129), as `… · {transfer} {HDR-badge}`
2. As a "label / value" row inside the expanded slide-up panel (line 150-161), with `<span>{t('viewer.hdrBadge')}</span>` as the label and `<span class=hdr-badge>HDR</span>` as the value.

Both renderings use the same gradient pill styling. The expanded panel already lists Primaries / Transfer / Pipeline as "label : value" rows; appending HDR as a fourth row alongside those is consistent with the panel's label-value pattern. But because the chip itself ALWAYS shows the HDR pill in the closed state, the expanded panel just repeats the same visual element for no information gain.

**Recommendation:** drop the panel-internal HDR row (lines 150-161). The chip already conveys the HDR signal; the expanded panel is for the secondary primaries / transfer / pipeline detail. This is a 12-line deletion with zero behavior change for photographers.

**Tests:** the C4-A3 commit at `d093cd23` confirms `transfer_function`-driven gating; no test currently asserts the expanded-panel HDR row is absent, so a `__tests__/lightbox-color-pip-hdr.test.ts` fixture-style scan over `lightbox.tsx` source would lock the dedup. Effort: XS.

---

#### C5-COL-MED-2 — `humanizeColorPipelineDecision` enum coverage test does NOT cover the resolver-side enum source

**File:** `apps/web/src/__tests__/color-pipeline-decision-i18n.test.ts` (added in C4-A7); `apps/web/src/lib/process-image.ts` (resolver).

**Confidence:** MEDIUM.

**Photographer impact:** the cycle-4 test walks each enum literal hardcoded in the test file (`['srgb', 'p3-from-displayp3', 'p3-from-dcip3', 'p3-from-adobergb', 'p3-from-prophoto', 'p3-from-rec2020', 'srgb-from-unknown']`) and asserts both en + ko translations exist. This locks the i18n KEY space against accidental deletion, but does NOT assert the test's enum list is exhaustive vs. the resolver's. If a future contributor adds a new pipeline decision (e.g. `'p3-from-bt2100hlg'` once HDR encoding lands) to `process-image.ts` without updating either the test or the locale tables, the resolver-side decision will silently humanize to `''` and render the locale fallback `t('viewer.colorUnknown')` ("unknown"/"알 수 없음").

**Recommendation:** export the canonical `ColorPipelineDecision` enum from a shared constants module (`apps/web/src/lib/color-pipeline-decisions.ts`), import it from BOTH the resolver and the i18n test, then walk it in the test instead of repeating the literal list. This makes the test exhaustively track the source of truth. Effort: S.

This is a deeper version of the C4-COL-MED-2 finding — cycle 4 added the test, cycle 5 ties the test to the source of truth.

---

### LOW

#### C5-COL-LOW-1 — `LightboxColorPip` is not extracted / not directly tested

**File:** `apps/web/src/components/lightbox.tsx:85-166`.

**Confidence:** HIGH.

**Photographer impact:** the `LightboxColorPip` function is declared at module scope inside `lightbox.tsx` but not exported. The C4-A3 cycle-4 commit (`d093cd23`) verified the gate change manually; no fixture test locks the `isHdr` derivation, the `hasData` short-circuit, or the badge-once-only invariant (C5-COL-MED-1 above).

**Recommendation:** add a fixture-style source-inspection test (matching `color-details-section-delivered.test.ts`) over `lightbox.tsx` that asserts:
1. `LightboxColorPip` gates HDR badge on `transfer_function === 'pq' || 'hlg'` (locks C4-A3).
2. `LightboxColorPip` short-circuits via `hasData` when no color signals are present.
3. The HDR badge appears exactly once when `isHdr=true` (locks C5-COL-MED-1).

Effort: XS-S.

---

#### C5-COL-LOW-2 — `humanizeColorPipelineDecision` for legacy `'p3-from-rec2020-hlg'` (HLG-tagged Rec.2020) renders the en `viewer.colorPipelineP3FromRec2020` → "From BT.2020" without the HLG callout

**File:** `apps/web/src/components/color-details-section.tsx:65`; `apps/web/messages/en.json:333-340`.

**Confidence:** LOW.

**Photographer impact:** the current `'p3-from-rec2020'` enum value is shared between SDR Rec.2020 sources and the (historical) HLG Rec.2020 sources flagged before P3-2 HDR rejection landed. The label says "From BT.2020" with no transfer-function callout. Photographers reviewing legacy `is_hdr=true` admin rows see the same audit string for SDR Rec.2020 and ex-HLG Rec.2020 photos.

**Recommendation:** keep deferred. Couples to C4-D2 (legacy `is_hdr=true` admin diagnostic surface) and the eventual P3-13 ICC TRC parsing plan. Add an explicit `'p3-from-rec2020-hlg'` enum value when WI-09 ships and re-process flow exists.

---

## Cross-references

- Plan-43 (cycle 4) — fully shipped (C4-A1..C4-A8 all landed).
- Cycle-4 reviews — `.context/reviews/cycle4-rpf-photographer/{color-fidelity,hdr-workflow,internal-formats,ui-ux-photographer,security-and-architecture}.md`.
- Cycle-3 reviews — `.context/reviews/cycle3-rpf-photographer/`.
- C4-COL-MED-2 (cycle 4) — superseded by C5-COL-MED-2 (deeper version).
- C5-COL-MED-1 — NEW finding not present in any prior cycle review.
