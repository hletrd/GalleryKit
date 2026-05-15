# Photographer Review R9 — Aggregate Findings

**Date:** 2026-05-15
**Scope:** Comprehensive review from professional photographer perspective after R8 convergence.
**Reviewers:** Color Pipeline, UI/UX, Encoder/Delivery, Browser/Display (4 parallel passes)
**Premise:** Photos arrive AFTER the photographer's editing. The encoder + viewer must deliver the photographer's intent accurately.

---

## Severity Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 1 | R9-R1 |
| HIGH | 3 | R9-R2, R9-R3, R9-H1 |
| MEDIUM | 13 | R9-M1–R9-M13 |
| LOW | 22 | R9-L1–R9-L22 |

**Cross-agent agreement:** R9-R1 flagged by browser-display reviewer (CRIT) and acknowledged by UI/UX reviewer as undermining badge credibility. R9-H1 flagged by UI/UX reviewer (HIGH) and acknowledged by color-pipeline reviewer (R9-M3, same root cause: ProPhoto substring match). R9-R2/R9-M4 share root cause: `dynamic-range: high` MQ semantics.

---

## CRITICAL

### R9-R1 — Firefox canvas-P3 probe is NOT display-gated; systematic false positive on sRGB displays

**Source:** Browser/Display review (CRIT)
**Files:** `use-display-capability.ts:82-84`, `wide-gamut-hint.tsx:40`, `color-details-section.tsx:226-228`
**Impact:** Firefox users on sRGB displays get `colorGamut: 'p3'` from the hook. This:
1. Suppresses `WideGamutHint` — sRGB Firefox users never learn their display is clipping colors
2. Shows P3 badge incorrectly — undermines badge credibility for photographers
3. Affects ~3-4% of desktop traffic (higher in photography demographics)

**Root cause:** `probeCanvasP3()` checks if `canvas.getContext('2d', { colorSpace: 'display-p3' })` succeeds. In Firefox 113+, this always succeeds regardless of physical display gamut — it's an API-capability signal, not a display-capability signal.

**Fix:** Default Firefox to `'srgb'` unconditionally in `useDisplayCapability`. Remove canvas-P3 probe from display-gamut detection path. Keep the probe in `histogram.tsx` for canvas rendering mode selection (correct purpose there).

---

## HIGH

### R9-R2 — `(dynamic-range: high)` reports hardware capability, not active HDR state

**Source:** Browser/Display review (HIGH)
**Files:** `use-display-capability.ts:90-92`, `color-details-section.tsx:355-371`, `lightbox-color-pip.tsx:95-103`
**Impact:** HDR badge shown when viewer is not experiencing HDR content. Safari XDR users with HDR disabled in Settings, Edge Auto HDR users, and Chrome Android SDR-panel users all see the badge.

**Fix:** Change badge label from "HDR" to "HDR-capable display" or "HDR source (SDR delivery)" to align with MQ semantics. The honesty note (R8-M4) partially mitigates but the badge wording itself is misleading.

### R9-R3 — No instant display-change detection on Firefox

**Source:** Browser/Display review (HIGH)
**Files:** `use-display-capability.ts:105-130`
**Impact:** Firefox users dragging browser between P3 and sRGB monitors retain stale state until focus/visibilitychange. No web-platform API exists for this on Firefox.

**Fix:** Document the limitation in code comments and `CLAUDE.md`. No code fix possible without platform API.

### R9-H1 — ProPhoto RGB falsely badges as P3 (`includes('p3')` substring match)

**Source:** UI/UX review (HIGH)
**Files:** `color-details-section.tsx:226-228`, `color-details-section.tsx:240-242`
**Impact:** ProPhoto RGB sources (much wider gamut than P3) show a "P3" pill. This is misleading — ProPhoto greens/cyans exceed P3 and are clipped by the encoder. The badge suggests the source IS P3 when it's actually ProPhoto→P3-with-clipping.

**Fix:** Replace substring match with strict allowlist: `['display p3', 'p3-d65', 'dci-p3']` after normalization.

---

## MEDIUM (13)

### R9-M1 — DCI-P3 ICC-name inference returns `'gamma22'` instead of `'gamma26'`

**Source:** Color Pipeline review (MED)
**Files:** `color-detection.ts:111-113`
**Impact:** Audit panel shows "Transfer: Gamma 2.2" for DCI-P3 sources when the actual source uses gamma-2.6 per SMPTE EG 432-2. Misrepresents photographer's mastering conditions.
**Fix:** Change `return 'gamma22'` to `return 'gamma26'`. Update comment.

### R9-M2 — Stored `colorPipelineDecision` frozen at upload time

**Source:** Color Pipeline review (MED)
**Files:** `process-image.ts:641-669`
**Impact:** When `forceSrgbDerivatives` is toggled, existing images show old decision labels. Admin confusion — table shows `p3-from-displayp3` but served JPEG is sRGB-tagged.
**Fix:** Document that `color_pipeline_decision` reflects upload-time state; backfill reconciles.

### R9-M3 — ProPhoto/Rec.2020 sources clipped to P3 without explicit disclosure

**Source:** Color Pipeline review (MED)
**Files:** `process-image.ts:528-537`
**Impact:** Photographer who mastered in ProPhoto expects saturated greens/cyans to survive. They don't — clipped to P3 without audit disclosure.
**Fix:** Append "(clipped to P3)" to audit label for ProPhoto/Rec.2020 sources, or add a dedicated warning row.

### R9-M4 — Backfill omits `color_pipeline_decision` refresh

**Source:** Encoder/Delivery review (MED)
**Files:** `backfill-color-pipeline.ts:253-272`
**Impact:** Backfill re-encodes and re-detects signals but does NOT update `color_pipeline_decision`. If resolver semantics change, the stored label becomes a lie.
**Fix:** Recompute `colorPipelineDecision` in `reprocessRow`, add to `ReprocessSignals`, include in batch UPDATE.

### R9-M5 — ETag changes immediately on settings flip, but file bytes remain stale until backfill

**Source:** Encoder/Delivery review (MED)
**Files:** `serve-upload.ts:110-112`, `settings-hash.ts:62-78`
**Impact:** Admin changes setting → ETag changes → clients cache stale bytes under new ETag. Photographer's color fix invisible until backfill completes. Client downloads image twice for one settings change.
**Fix options:** (1) Store per-image `encode_settings_hash` (schema + migration), (2) Document in admin UI with warning.
**Recommended:** UI warning now + per-image hash in next schema migration.

### R9-M6 — `matrix_coefficients` never surfaced in UI

**Source:** UI/UX review (MED)
**Files:** `color-details-section.tsx`
**Impact:** Rec.2020 photographers need to know NCL vs CL matrix. Value is in DB, included in JSON copy, but never rendered.
**Fix:** Add admin-only "Matrix coefficients" row with humanized labels.

### R9-M7 — EXIF `color_space` tag not surfaced

**Source:** UI/UX review (MED)
**Files:** `color-details-section.tsx`
**Impact:** Camera declares sRGB in EXIF but ICC says Adobe RGB — photographer can't debug this mismatch.
**Fix:** Add admin-only "EXIF color space" row.

### R9-M8 — DCI-P3 Bradford tooltip missing in lightbox panel

**Source:** UI/UX review (MED)
**Files:** `lightbox-color-pip.tsx:105-147`
**Impact:** Photographer reviewing in lightbox sees "Display P3 (from DCI-P3)" with no explanation of Bradford adaptation.
**Fix:** Replicate info button + tooltip pattern from `color-details-section.tsx:273-287`.

### R9-M9 — Histogram canvas 240×120 coarse for desktop

**Source:** UI/UX review (MED)
**Files:** `histogram.tsx`
**Impact:** 1 px ≈ 2.1% of height. Peaks differing by <2% look identical. Too coarse for tonal evaluation.
**Fix:** Scale to 320×160 or 480×240 on desktop viewports; keep 240×120 for mobile.

### R9-M10 — `screen.colorGamut` change events absent (drag-between-monitors on Chrome/Safari/Edge)

**Source:** Browser/Display review (MED)
**Files:** `use-display-capability.ts:120-128`
**Impact:** No live update when dragging window between monitors of different gamuts. MQ compensates on most browsers but `screen.colorGamut` takes priority and may lag.
**Fix:** Document limitation; consider `requestAnimationFrame` delay on MQ change to allow `screen.colorGamut` update.

### R9-M11 — Firefox bug 1591455 reference incorrect

**Source:** Browser/Display review (MED)
**Files:** `CLAUDE.md` (line referencing bug 1591455)
**Impact:** Bug 1591455 is about devtools performance settings, not color-gamut MQ. Developers following reference are misled.
**Fix:** Remove incorrect bug number. Replace with generic note about Firefox MQ gap.

### R9-M12 — Dual-monitor macOS ambiguity

**Source:** Browser/Display review (MED)
**Files:** `use-display-capability.ts:68-103`
**Impact:** Window spanning P3 + sRGB displays: `screen.colorGamut` reports primary display, leaving other half incorrect.
**Fix:** No web-platform API for per-display gamut. Document limitation.

### R9-M13 — Chrome Android `dynamic-range: high` false positive on SDR panels

**Source:** Browser/Display review (MED)
**Files:** `use-display-capability.ts:90-92`
**Impact:** HDR badge on Android devices with HDR-decode SoCs but SDR panels.
**Fix:** Same as R9-R2 — badge wording change covers both.

---

## LOW (22)

### Color Pipeline (7)

**R9-L1** — `NCLX_MATRIX_MAP` omits value 10 (BT.2020 CL). Rare in stills but possible from DaVinci Resolve. Falls through to `'unknown'`.
**R9-L2** — `full_range_flag` from NCLX colr box unconsumed. Read but discarded. Matters for HDR delivery (WI-09).
**R9-L3** — `force_srgb_derivatives` name implies all formats, but AVIF remains gamut-preserved. Admin confusion.
**R9-L4** — DCI-P3 rgb16 skip comment conflates ICC-embedded and NCLX-only cases. Documentation inaccuracy.
**R9-L5** — Silent downscale at `wide_gamut_max_source_pixels` has no audit trail. Photographer assumes full-res source drove conversion.
**R9-L6** — Chromaticity distance in `icc-chromaticity.ts` is 2D Euclidean, not perceptually uniform. Safe given generous tolerance and well-separated gamuts. Document-only.
**R9-L7** — Gain map heuristic 2 (`auxl` → `urim`/`tmap`) could false-positive on future non-HDR encoders.
**R9-L8** — `isHdr` detection lacks fallback beyond `(dynamic-range: high)` MQ. Chrome on XDR returns false. Admin-only field, minor impact.

### Encoder/Delivery (3)

**R9-L9** — `wide_gamut_max_source_pixels` in `settingsHash` causes unnecessary cache invalidation for images below threshold.
**R9-L10** — DCI-P3 rgb16 skip comment conflation (same as R9-L4, cross-review confirmation).
**R9-L11** — Display P3 sources unnecessarily enter rgb16 pipeline, doubling peak RAM. Same-gamut resize is visually acceptable in gamma space. Intentional conservative trade-off.

### Browser/Display (6)

**R9-L12** — `SERVER_DEFAULT` edge case for no-JS clients / bots. SSR default `'p3'` may show P3 badges to crawlers.
**R9-L13** — `forced-colors` badge distinction reduced in Windows High Contrast Mode. Border vs background may be subtle.
**R9-L14** — `rec2020`→P3 delivery honesty in histogram. Rec.2020 colors outside P3 triangle are clipped — minor omission.
**R9-L15** — Test coverage gap for display-change simulation in `use-display-capability.test.ts`.
**R9-L16** — Subscription cleanup on unsupported MQs. Try/catch likely unnecessary as of 2026 — all browsers return valid MQL.
**R9-L17** — Canvas-P3 naming confusion: `probeCanvasP3` in `use-display-capability.ts` (display detection, wrong purpose) vs `getSupportsCanvasP3` in `histogram.tsx` (rendering mode, correct purpose).

### UI/UX (8)

**R9-L18** — Histogram source derivative indicator missing. Photographer can't tell if bins came from AVIF or JPEG.
**R9-L19** — Histogram doesn't show summary statistics (mean, stddev, key type).
**R9-L20** — `wideGamutHint` is generic — doesn't name the source gamut ("Display P3" vs just "wide-gamut").
**R9-L21** — No copy-to-clipboard button in `LightboxColorPip` expanded panel.
**R9-L22** — Download label "Download (Display P3 JPEG)" ambiguous — may imply 10-bit JPEG.
**R9-L23** — `color_pipeline_decision` row hidden from public (by design, but photographers sharing galleries may want visitors to see provenance).
**R9-L24** — Mobile bottom sheet copy button verified present — no issue.
**R9-L25** — Histogram keyboard shortcut 'H' on mobile is moot (no physical keyboard) — acceptable.

---

## Cross-File Integration Issues

### Gain map signal flattening

**Files:** `gain-map-detection.ts` → `color-detection.ts` → `process-image.ts`
**Issue:** `ColorSignals.hasGainMap` is a flat boolean. Detection can distinguish Apple URN vs ISO 21496-1 `tmap`, but the distinction is lost. When WI-09 ships, knowing WHICH spec matters for output encoding.
**Recommendation:** Change `hasGainMap: boolean` to `hasGainMap: false | 'apple-urn' | 'iso-tmap'` before WI-09. Schema migration, medium effort.

---

## R8 Closure Confirmation

All R8 findings are confirmed closed in current code:

| R8 ID | Severity | Status |
|-------|----------|--------|
| R8-CRIT | Backfill settings pass-through | Fixed |
| R8-H1 | ETag validated GalleryConfig | Fixed |
| R8-H2 | Lightroom color signal preservation | Fixed |
| R8-H3 | `bit_depth` privacy boundary | Fixed |
| R8-M1 | NCLX transfer codes 4, 5, 7 | Fixed |
| R8-M2 | `forceSrgbDerivatives` UI annotation | Fixed |
| R8-M3 | Firefox P3 badge via `data-display-gamut` | Fixed |
| R8-M4 | HDR "Delivered as SDR" honesty | Fixed |
| R8-LOW | Histogram note, label clarity, lightbox gain map, keyboard ref, DCI-P3 comment | Fixed |
| R8-TEST | All 9 test coverage gaps | Fixed |

---

## Recommended Priority Order

| Rank | Finding | Effort | Why First |
|------|---------|--------|-----------|
| 1 | R9-R1 Firefox false positive | S | CRIT — undermines trust for ~3-4% of users |
| 2 | R9-H1 ProPhoto P3 badge | XS | HIGH — false confidence, trivial fix |
| 3 | R9-R2 HDR badge wording | XS | HIGH — semantic accuracy, trivial fix |
| 4 | R9-M1 DCI-P3 gamma26 | XS | MED — misrepresents mastering conditions |
| 5 | R9-M4 Backfill decision refresh | S | MED — audit trail accuracy |
| 6 | R9-M5 ETag staleness warning | S | MED — prevents photographer confusion |
| 7 | R9-M3 ProPhoto clip disclosure | S | MED — photographer intent transparency |
| 8 | R9-M6 Matrix coefficients UI | S | MED — technical completeness |
| 9 | R9-M7 EXIF color_space UI | S | MED — debugging aid |
| 10 | R9-M8 Lightbox DCI-P3 tooltip | XS | MED — consistency |
| 11 | R9-M9 Histogram desktop resolution | S | MED — usability |
| 12 | R9-M11 Firefox bug ref | XS | MED — documentation correctness |
| 13+ | All LOW findings | XS–S | Polish and documentation |

---

*Aggregate compiled from 4 parallel reviewer reports. Total lines reviewed: ~2,800 across 8 core files + 4 supporting files.*
