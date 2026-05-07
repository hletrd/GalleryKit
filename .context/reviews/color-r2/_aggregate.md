# Color-Deep Review R2 — Aggregate

**Date:** 2026-05-07
**Predecessor aggregate:** `.context/reviews/color-deep/_aggregate.md` (the R1 review).
**Companion plan:** `.context/plans/37-color-r2-followup.md`.
**State of the codebase:** ~30 commits since R1 landed, ~4,800 lines added/modified. Plan-36 work items WI-01 through WI-15 are largely shipped (HDR encoder WI-09 deferred via feature flag).
**Premise:** photos uploaded AFTER editing. No edit/scoring features.

---

## Per-angle reviews (three, parallel)

| Angle | File | Length | Verdict |
|---|---|---|---|
| Code correctness | `code-correctness.md` | 256 lines | **REQUEST CHANGES** — 2 HIGH, 1 MED, 2 LOW; all WI-01..WI-15 verified landed correctly |
| Color science | `color-science.md` | 712 lines | **WI-12 Bradford CORRECT**; new CRIT findings on NCLX maps |
| Photographer workflow | `photographer-workflow.md` | 341 lines | Several persona improvements; **decision-label bug undermines the audit** |

---

## What WORKED — verified across reviewers

- **WI-01 colr-box parser fix** is correct (code-reviewer + science).
- **WI-02 ICC consolidation** to `icc-extractor.ts` landed correctly (code-reviewer).
- **WI-03 color_space pollution fix** correctly stores EXIF tag in `color_space`, ICC name in `icc_profile_name`, UI displays ICC (code-reviewer + workflow).
- **WI-04 OG sRGB ICC** landed correctly. Cross-platform iMessage/Slack/Discord previews are now consistent (workflow + code-reviewer).
- **WI-05 admin Color Details panel** rendered, gated behind isAdmin (code-reviewer + workflow). Not yet on mobile bottom-sheet — see C3 below.
- **WI-06 histogram AVIF source switch** logic correct, fallback to JPEG with "(sRGB clipped)" indicator (code-reviewer + perf-reviewer).
- **WI-07 download dynamic label** wired but **broken for AdobeRGB / ProPhoto / Rec.2020** sources — see C1 below.
- **WI-08 `<picture> media="(dynamic-range: high)"`** rendered behind `HDR_FEATURE_ENABLED` flag (workflow + perf-reviewer); flag is currently `false` so no production 404s today.
- **WI-10 dead CSS removal** verified (code-reviewer).
- **WI-12 DCI-P3 Bradford** is **mathematically correct** — color-science quantified: ΔE₂₀₀₀ mean 0.000, max 0.000 on CC24 (down from mean 0.463, max 1.001). Source ICC preserved through the pipeline; LCMS2 Bradford applies cleanly.
- **WI-14 Sharp shared-state hardening** genuinely resolves the CD-HIGH-2 race (code-reviewer; closes the original concern).
- **WI-15 memory cap** lands but is **width-only, not pixel-count** — see C8.
- **CD-CRIT-1 HDR encoder cleanly deferred** — no half-baked HDR encode paths emitting malformed AVIFs. The deferral path is honest.
- **HDR headroom loss unchanged at 3.32 stops** (1000-nit displays) / 4.00 stops (iPhone 15 Pro 1600-nit peak) — confirmed by science.
- **WebP q90 / JPEG q90 encoding distortion**: mean ΔE₂₀₀₀ 0.45 / 0.56 — well below the 1.5 skin-tone threshold (color-science).
- **ACES Hill remains the recommended HDR→SDR tone-map** for when WI-09 lands (color-science re-confirmed).

---

## Convergent findings (≥2 reviewers agree)

### C1 ✓ ✓ ✓ — Decision-label / humanizer / download-label triple bug

**Reviewers:** code-correctness (N-01), photographer-workflow (Persona B / C analysis), with hint from photographer-workflow on the wedding/portrait persona.

**Code:**
- `process-image.ts:384-386` — `resolveColorPipelineDecision` returns `'srgb-from-adobergb'` / `'srgb-from-prophoto'` / `'srgb-from-rec2020'`.
- `process-image.ts` `resolveAvifIccProfile` (the encoder) returns `'p3'` for these same sources (Phase 2 path).
- `photo-viewer.tsx:74-76` — `humanizeColorPipelineDecision` matches `'p3-from-adobergb'` / `'p3-from-prophoto'` / `'p3-from-rec2020'`.
- `photo-viewer.tsx:947` — download-label gate uses `decision.startsWith('p3-from-')`.

**Effect:** triple-cascade label bug for AdobeRGB / ProPhoto / Rec.2020 sources:
1. **Admin Color Details panel** shows an empty string because the humanizer never matches `srgb-from-*` for those values.
2. **Download button label** says "Download JPEG" instead of "Download (Display P3 JPEG)" because the gate fails.
3. **Photographer audit story is broken**: the panel says "sRGB (from Adobe RGB)" while the file is P3-tagged. Photographer cannot trust the audit.

**Severity:** **CRIT**. Single fix (rename the resolver outputs to `p3-from-*` for these three sources, since the encoder actually produces P3) closes all three symptoms simultaneously.

---

### C2 ✓ ✓ — NCLX transfer/primaries maps wrong

**Reviewers:** code-correctness (N-03 + N-05), color-science (independent finding).

**Code:** `apps/web/src/lib/color-detection.ts:131-137`.

**Errors against ITU-T H.273:**
- Transfer code **13** mapped to `'pq'` — actually it's sRGB IEC 61966-2-1. **False-positive HDR for every iPhone HEIC** (iPhone HEIC default uses transfer=13).
- Transfer code **16** missing from map (actual PQ / SMPTE ST 2084) — returns `'unknown'` for genuine PQ ProRAW. **False-negative HDR for HDR sources**.
- Transfer code **18** mapped to `'gamma18'` — actually it's ARIB STD-B67 HLG. **False-negative for HLG sources**.
- Primaries code **11** (SMPTE RP 431-2 DCI-P3) missing from map. AVIF containers with `nclx primaries=11` but no ICC route to sRGB pipeline instead of Bradford-adapted P3 path.

**Effect today:** dormant — the encoder doesn't read `is_hdr` (HDR encoder is deferred), so the misclassification doesn't bite delivery. But:
- Every iPhone HEIC with transfer=13 today is flagged `is_hdr = true` in the DB (false-positive). When WI-09 lands, every iPhone HEIC would route through HDR encode incorrectly.
- The HDR badge in the EXIF panel currently shows for sources that aren't actually HDR. Color-science confirmed `100% misclassification rate for PQ ProRAW and standard sRGB HEIC`.

**Severity:** **CRIT** even before WI-09 lands, because the HDR badge is mis-shown today and the DB column is populated with garbage. WI-09 cannot land safely until this is fixed.

**Correct map:** `{1: 'srgb', 13: 'srgb', 16: 'pq', 18: 'hlg'}` for transfer; add `11: 'dci-p3'` to primaries.

---

### C3 ✓ ✓ — Mobile bottom-sheet missing all color UI

**Reviewers:** UI/UX visual (UX-CRIT-2 in their numbering), UI/UX a11y (RESP-MED-1).

**Code:** `apps/web/src/components/info-bottom-sheet.tsx:241` — only renders the canonical EXIF block; missing color details accordion, HDR badge, gamut-aware download dropdown, calibration tooltip.

**Effect:** iPhone 15 Pro users (the modal P3 + HDR audience) cannot see any of the new color metadata for their own photos. The audit story (C1 above) is doubly broken on mobile because mobile users can't see the panel at all.

**Severity:** **HIGH**. The audience most affected by wide-gamut color is most likely to be on mobile.

---

### C4 ✓ ✓ — HDR `<source>` ungated risk

**Reviewers:** UI/UX visual (UX-CRIT-1), UI/UX performance (PERF-CRIT-1).

**Code:** `photo-viewer.tsx:413`, `lightbox.tsx:418`, `home-client.tsx:282-289`. The `<source media="(dynamic-range: high)">` element is gated by `NEXT_PUBLIC_HDR_FEATURE_FLAG` only, not by per-image `hdrExists`. The download menu's HDR option already uses an `hdrExists` HEAD probe for gating.

**Effect today:** flag is `false` in production, so no 404s. **If flag enabled before WI-09 lands**, every HDR-flagged photo (and given C2's false-positive, that's every iPhone HEIC) would 404 the HDR variant. Per `<picture>` spec, the browser falls straight to the JPEG `<img>` and skips AVIF/WebP entirely. Estimated waste: 200-800 KB per nav (perf-reviewer quantified).

**SW HDR bypass** at `sw.js:42-46` skips caching but doesn't `event.respondWith` — so 404s are not negative-cached and repeat per nav.

**Severity:** **HIGH**. Pre-launch landmine. The fix is to gate the `<source>` on the same `hdrExists` probe used for the download menu, not just the flag.

---

### C5 ✓ — Backfill script reads wrong column

**Reviewers:** code-correctness (N-02), implicit in workflow.

**Code:** `apps/web/scripts/backfill-color-pipeline.ts:81` reads `row.color_space` and passes it as the `iccProfileName` parameter to `processImageFormats`.

**Effect:** post-WI-03, `color_space` holds EXIF tag values (`'sRGB'`, `'Uncalibrated'`), not ICC descriptions. For backfilled rows, `resolveAvifIccProfile` falls through to `'srgb'` default, **producing sRGB-clipped derivatives for P3 / Adobe RGB / ProPhoto sources during the backfill**. This is a silent corruption that affects re-encoded photos.

**Severity:** **CRIT**. Anyone running the backfill script today gets sRGB-clipped derivatives for their entire wide-gamut library.

**Fix:** read `icc_profile_name` instead.

---

### C6 ✓ — Histogram AVIF probe runs every mount → double-fetch

**Reviewers:** UI/UX performance (PERF-MED).

**Code:** `histogram.tsx:247-252`. The feature-detect for canvas-P3 + AVIF runs on every Histogram mount, so first render uses JPEG, then probe completes and source swaps to AVIF.

**Effect:** double-fetch ~200-400 KB per photo navigation for wide-gamut images. Repeated on every photo nav.

**Severity:** **MED**. Cache the probe result at module scope or in a context provider.

---

### C7 ✓ — HEAD probe for HDR variant fires every nav

**Reviewers:** UI/UX performance (PERF-MED), UI/UX visual (mentioned obliquely).

**Code:** `photo-viewer.tsx:230-240`. The HEAD probe for `_hdr.avif` existence fires on every photo nav.

**Effect:** every HDR-flagged photo (including the false-positive iPhone HEICs from C2) hits a 404 HEAD on every navigation. SW bypass means no negative caching.

**Severity:** **MED**. Cache the result for the photo's lifetime in the viewer; or move the gate to server-side rendering by including `hdr_variant_exists` in the image row.

---

### C8 ✓ — WI-15 memory cap is width-only, not pixel-count

**Reviewers:** UI/UX performance (PERF-MED).

**Code:** `process-image.ts:660-672`.

**Effect:** a 5999×16000 source (96 MP) bypasses the cap because width is below threshold but pixel count is huge. Estimated peak heap: ~575 MB. Real OOM risk on 1 GB containers.

**Severity:** **MED**. Switch the cap to pixel-count or both.

---

### C9 ✓ — Calibration tooltip invisible to keyboard / screen-reader

**Reviewers:** UI/UX visual (UX-CRIT-5), UI/UX a11y (A11Y-MED-12).

**Code:** `photo-viewer.tsx:847-851`. Tooltip trigger is a `<span>` nested inside an accordion `<button>`. The span isn't focusable, so Radix's `aria-describedby` link never wires. Tap on mobile fires the accordion toggle, not the tooltip.

**Effect:** keyboard-only and screen-reader users have no way to read the calibration explanation. Touch users can't access it either.

**Severity:** **HIGH**. Make the trigger a proper `<button>` or use a focusable `<span tabindex="0">` with explicit aria-describedby.

---

### C10 ✓ — Color details accordion missing aria-expanded / aria-controls

**Reviewers:** UI/UX a11y (A11Y-MED-3).

**Code:** `photo-viewer.tsx:840-857`. Disclosure state encoded only in chevron rotation.

**Severity:** **MED**.

---

### C11 — `color_pipeline_decision` leaks to public select

**Reviewers:** UI/UX performance (PERF-MED), implicit in workflow review.

**Code:** `data.ts:213-217`. Field is admin-only at the rendering layer but flows through `publicSelectFields` to all visitors.

**Effect:** marginal information leak (technical metadata about encoding choices visible via API). Negligible per-byte cost but architectural smell.

**Severity:** **LOW**. Move to admin-only select field.

---

## Severity-rated summary

| Severity | Count | Items |
|---|---|---|
| CRIT | 3 | C1 (decision/humanizer mismatch), C2 (NCLX maps wrong), C5 (backfill wrong column) |
| HIGH | 3 | C3 (mobile color UI gap), C4 (HDR source ungated), C9 (calibration tooltip a11y) |
| MED | 5 | C6 (histogram double-fetch), C7 (HDR HEAD per-nav), C8 (memory cap width-only), C10 (accordion aria), and from individual reviews: focus-visible inheritance on raw buttons, forced-colors gap on HDR badge / color details, dead landscape-tablet CSS rule |
| LOW | 2 | C11 (`color_pipeline_decision` in publicSelectFields), HDR filename convention inconsistency (won't bite until WI-09) |

---

## Key non-convergent findings

These were each flagged by one reviewer but warrant the plan:

- **N-04 HDR filename convention inconsistency** — download link uses `<uuid>_hdr.avif`, srcSet uses `<uuid>_hdr_<size>.avif`. Latent until WI-09 ships.
- **HDR badge has no expansion text or i18n description** (a11y) — announces only "HDR" with no SR description.
- **Raw `<button>` doesn't inherit improved focus-visible** from the `Button` component (a11y) — color details accordion, histogram collapse triangle.
- **HDR badge / color details miss `@media (forced-colors: active)`** rules (a11y).
- **Orientation-aware landscape tablet CSS is dead code** at `globals.css:193-197` (a11y).
- **Three independent rgb16 pipelines run parallel** — peak ~360 MB heap for wide-gamut 6000-wide intermediate (perf).

---

## What is correct (do not change)

- WI-01 through WI-15 implementations (with the C1 / C2 / C5 / C8 caveats listed).
- WI-12 Bradford DCI-P3 white-point adaptation: mathematically correct, mean ΔE₂₀₀₀ 0.000 on CC24.
- WI-02 single source of truth for `extractIccProfileName` in `icc-extractor.ts`.
- WI-04 OG image sRGB ICC tagging — cross-platform consistent.
- ACES Hill tone-mapping recommendation for the HDR encoder when WI-09 lands.
- AVIF q85 / WebP q90 / JPEG q90 quality settings — under the perceptual threshold.
- The HDR encoder deferral pattern: `HDR_FEATURE_ENABLED` flag, no half-baked code paths.

---

## Recommended next steps

The companion plan `.context/plans/37-color-r2-followup.md` orders work as:

1. **C2** NCLX transfer + primaries map fix. **CRIT and a prerequisite for any further HDR work** — also fixes the false-positive HDR-badge surfaced today.
2. **C5** backfill script `icc_profile_name` fix. **CRIT and time-sensitive** — anyone running the script today corrupts their library.
3. **C1** decision label rename `srgb-from-*` → `p3-from-*` for the three Phase 2 sources. Single change closes admin panel + download label.
4. **C4** gate HDR `<source>` on `hdrExists` probe (server-side or feature flag deepening).
5. **C3** mirror color UI into the mobile bottom sheet.
6. **C9** make calibration tooltip trigger keyboard / SR accessible.
7. **C6, C7** cache the AVIF probe + HDR HEAD probe.
8. **C8** WI-15 memory cap → pixel-count not width.
9. **C10, focus-visible, forced-colors, dead CSS** UI/A11Y polish.
10. **C11** narrow `color_pipeline_decision` to adminSelectFields.

Items 1-4 are the critical path. Items 5-7 are HIGH-impact UX. Items 8-10 are MED polish.
