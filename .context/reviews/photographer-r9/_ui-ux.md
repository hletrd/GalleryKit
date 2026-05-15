# Photographer-Perspective UI/UX Review R9 — Color Metadata Display Surface

**Date:** 2026-05-15
**Reviewer perspective:** professional photographer, color-management aware.
**Scope:** 8 files — the complete user-facing color/HDR metadata display pipeline.
**Premise:** Photos arrive after the photographer's editing. The display must accurately surface what the pipeline detected, what it decided, and what it delivered — without false confidence or missing nuance.

---

## Executive Summary

The color metadata UI is **largely converged and honest** after 9 RPF cycles. The key components (`ColorDetailsSection`, `LightboxColorPip`, `Histogram`, `WideGamutHint`) all surface the right signals, the HDR delivery honesty notes are clear, and the Korean localization is accurate. However, a **false-positive P3 badge** on ProPhoto ICC profiles, a handful of missing technical fields, and minor histogram limitations remain.

| Severity | Count | Verdict |
|---|---|---|
| CRIT | 0 | No open critical issues |
| HIGH | 1 | ProPhoto incorrectly badge as P3 |
| MED | 4 | Missing matrix coefficients, DCI-P3 tooltip absent in lightbox, histogram resolution, missing `color_space` |
| LOW | 6 | Minor wording, consistency, and UX polish |

---

## 1. Per-Component Review

### 1.1 `color-details-section.tsx` — Color Details Accordion

**File:** `apps/web/src/components/color-details-section.tsx`

#### What's right
- **Default-open for non-trivial color** (`isNonTrivialColor`, line 124-128): auto-expands when the source is wide-gamut, HDR, or has a non-sRGB pipeline decision. Photographers don't have to hunt.
- **ICC vs primaries deduplication** (`primariesMatchIccName`, lines 106-112): When the ICC profile name and the NCLX-derived primaries resolve to the same gamut, the UI coalesces them into a single "Color Space" row instead of showing redundant "Color Space: Display P3" + "Color primaries: Display P3".
- **DCI-P3 Bradford tooltip** (lines 273-287): The info button next to "Display P3 (from DCI-P3)" explains the D50→D65 white-point adaptation via Bradford. This is exactly the kind of detail photographers need when auditing how their cinema-gamut source was transformed.
- **Source vs delivered bit depth co-location** (lines 297-323): Seeing "Source: 14-bit" right next to "Delivered: 10-bit AVIF, 8-bit WebP/JPEG" makes the pipeline loss instantly obvious.
- **Format chips with gamut annotation** (lines 325-343): WebP / AVIF / JPEG chips show `(sRGB)` or `(P3)` when `forceSrgbDerivatives` is active, preventing confusion about mixed gamuts per format.
- **Copy-to-clipboard JSON** (lines 153-175): Machine-parseable audit trail. Includes all fields a photographer would paste into a support ticket or forum post.
- **Honesty notes**: HDR "Delivered as SDR" (line 368-370) and gain map "Delivered as SDR base only" (line 384-386) are unambiguous.

#### HIGH: ProPhoto RGB falsely badge as P3

**Lines 226-228 and 240-242:**
```tsx
{iccName.toLowerCase().includes('p3') && (
    <span className="... gamut-p3-badge">P3</span>
)}
```

The substring match `includes('p3')` will fire on **"ProPhoto RGB"** because "ProPhoto" contains "p3" as a substring. ProPhoto RGB is NOT a P3 variant — its primaries are much wider than Display P3, and the pipeline decision for ProPhoto is `p3-from-prophoto` (delivered as P3 because the encoder clips to P3). Badgeing ProPhoto sources with a "P3" pill is misleading: it suggests the source *is* P3, when in fact the source is ProPhoto and the delivery is P3-with-potential-clipping.

**Fix:** Use the same normalized comparison as `primariesMatchIccName`, or check against an allowlist: `['display p3', 'dci-p3', 'p3-d65']`.

#### MED: `matrix_coefficients` never surfaced

The `images.matrix_coefficients` column stores NCLX matrix data (0=identity, 1=BT.709, 9=BT.2020-NCL). For Rec.2020 sources, photographers care whether the matrix is NCL vs CL (constant luminance). The value is in the database and included in the JSON copy payload, but never rendered in the accordion. Consider adding an admin-only "Matrix coefficients" row (analogous to `transfer_function`).

#### MED: EXIF `color_space` tag not surfaced

The `images.color_space` column holds the EXIF `ColorSpace` tag value (`'sRGB'` or `'Uncalibrated'`). This is the color space the camera claimed, separate from ICC profile name and separate from NCLX-derived primaries. For photographers debugging "why does my camera say sRGB but the ICC says Adobe RGB?", seeing this field is useful. It is currently admin-only via `_PrivacySensitiveKeys` but not rendered in the accordion at all.

#### LOW: `color_pipeline_decision` row hidden from public

The delivered bit depth row (lines 309-323) falls back to deriving a pipeline decision from `color_primaries` for public queries. This works, but it means public viewers see "Delivered: 10-bit AVIF, 8-bit WebP/JPEG" without seeing the pipeline decision label that explains *why* (e.g., "P3 (from Adobe RGB; saturated greens may clip)"). The public-facing delivery ceiling is visible but the provenance is not. This is by design (pipeline decision is admin-only), but photographers sharing their public gallery may want visitors to understand the source gamut, not just the delivery format.

#### TOUCH TARGETS
- Accordion button: `min-h-[44px]` ✓
- Info tooltip button: `min-h-[44px] min-w-[44px]` ✓
- Copy button: `min-h-[44px] min-w-[44px]` ✓
- DCI-P3 info button: `min-h-11 min-w-11` (44 px) ✓

---

### 1.2 `lightbox-color-pip.tsx` — Lightbox Color Chip

**File:** `apps/web/src/components/lightbox-color-pip.tsx`

#### What's right
- **Lazy histogram mounting** (lines 59-64, 129-139): The `Histogram` component is only mounted when the panel opens, so the worker spawn + pixel decode doesn't tax the 99% case where the user opens the lightbox without expanding the pip. Good performance hygiene.
- **Compact representation**: Shows primaries + transfer + HDR badge in a single chip. For quick audit during slideshow review, this is the right density.
- **Touch target**: `min-h-11` (44 px) on the chip button. ✓
- **Keyboard shortcut**: Bound to `C` in `photo-viewer.tsx` via `toggleRef`. ✓
- **HDR badge consistency**: Gates on `transfer_function === 'pq' || 'hlg'`, same as the sidebar accordion (lines 57). Harmonized across both entry points.

#### MED: DCI-P3 Bradford tooltip missing in lightbox panel

The lightbox pip's expanded panel (lines 105-147) shows primaries, transfer, and pipeline decision — but the DCI-P3 info tooltip (the Bradford adaptation rationale) present in `color-details-section.tsx:273-287` is **not replicated here**. A photographer reviewing in lightbox mode who sees "Display P3 (from DCI-P3)" has no way to learn that a Bradford adaptation occurred. The info button + tooltip pattern should be duplicated or the panel should link to the full audit view.

#### LOW: No copy-to-clipboard in lightbox pip

The sidebar accordion has a copy button that exports JSON color metadata. The lightbox pip does not. Photographers doing lightbox review who want to share metadata have to exit lightbox, open the sidebar, and use the copy button there. A small copy icon in the expanded panel would close the gap.

---

### 1.3 `histogram.tsx` — Histogram Component

**File:** `apps/web/src/components/histogram.tsx`

#### What's right
- **5 modes** (luminance, RGB overlay, R, G, B): Covers the standard photographer workflow. The RGB overlay mode uses shared normalization (line 267) so channel imbalances are visible.
- **Canvas-P3 context** for wide-gamut sources on P3 displays (lines 201-206): The histogram is computed in Display-P3 space when appropriate, not blindly in sRGB.
- **Clip detection** (lines 310-344): Red blink strips at left/right edges when ≥0.5% of pixels clip. RGB mode checks worst-case channel (max of r/g/b at 0 and 255) so per-channel clipping is visible.
- **Clip percentage labels** (lines 548-578): Shows "Below black: 2.3%" / "Above white: 0.8%" when threshold exceeded. Precise and useful.
- **AVIF → JPEG fallback chain** (lines 372-416): If the AVIF probe fails or the sized derivative 404s, falls through cleanly to base JPEG. No blank histograms.
- **Web Worker offload** (`histogram-worker.js`): O(n) computation doesn't block the main thread.
- **Grid at 0/64/128/192/255** (lines 295-306): Standard quarter-tone divisions.
- **Cycle mode button**: `min-h-11 min-w-11` (44 px). ✓
- **Collapse/expand button**: `min-h-11 min-w-11` (44 px). ✓

#### MED: Histogram canvas is small (240×120)

The histogram renders at 240×120 px (line 531, 538-540). For photographers evaluating tonal distribution, 120 px of vertical resolution is quite coarse — 1 px ≈ 2.1% of the height. Peaks that differ by <2% look the same. Consider doubling to 480×240 (or at least 320×160) on desktop viewports while keeping 240×120 for mobile.

#### LOW: No indication of which source image the histogram was computed from

The histogram loads a sized derivative (640 px JPEG or AVIF) and computes bins from that. It does not indicate whether the bins came from the sRGB JPEG, the P3 AVIF, or the base JPEG. The "(sRGB clipped)" / "(histogram rendered in P3)" hints partially address this, but there's no explicit "Source: _640.jpg" label. When a photographer sees unexpected clipping, they can't tell if it's real in the source or an artifact of the derivative.

#### LOW: Histogram doesn't show image statistics (mean, stddev, key)

Photographers often ask: "Is this high-key or low-key?" The histogram shows the shape but no summary statistics. Adding mean luminance, estimated standard deviation, or a "High-key / Low-key / Balanced" label would make the histogram more actionable.

---

### 1.4 `info-bottom-sheet.tsx` — Mobile Bottom Sheet

**File:** `apps/web/src/components/info-bottom-sheet.tsx`

#### What's right
- **Color-first ordering for non-trivial sources** (lines 299-381): On mobile, when a photo is wide-gamut or HDR, the histogram + capture date + download appear BEFORE the EXIF grid. This puts color-relevant content at the top of the scroll, where photographers looking for gamut info expect it. sRGB sources keep the traditional EXIF-first order.
- **Mirrors desktop sidebar**: Uses the same `ColorDetailsSection`, `WideGamutHint`, `Histogram` components. No drift between mobile and desktop experience.
- **Swipe gestures**: Peek → expanded → collapsed states with velocity-aware snap. Natural on mobile.
- **Safe-area padding**: `env(safe-area-inset-bottom)` prevents the download button from being obscured by the iOS home indicator.
- **Touch targets**: Drag handle `min-h-11`, close button `min-h-11 min-w-11`, download buttons `min-h-11`. ✓
- **Focus trap** with initial focus on drag handle. ✓

#### LOW: Bottom sheet doesn't expose the "Copy color metadata" button

The desktop sidebar accordion has a copy button for JSON color metadata. The mobile bottom sheet's `ColorDetailsSection` is rendered without a `toggleRef` prop (line 293), which is fine for the accordion toggle, but the copy button itself is part of `ColorDetailsSection` and IS rendered. Wait — actually `ColorDetailsSection` at line 293 does render the copy button because it has no conditional around it. So the copy button IS available on mobile. Let me re-check... Yes, the copy button is inside `ColorDetailsSection` and is not behind an `isAdmin` gate. Mobile users can copy color metadata. This is correct.

Actually, re-reading: the `ColorDetailsSection` renders the copy button unconditionally (line 208-216). The only conditional around it is `hasColorDetails` (line 140). So yes, mobile has copy. Good.

#### LOW: Histogram keyboard shortcut 'H' works on mobile?

In `photo-viewer.tsx`, the `H` key cycles histogram mode. On mobile (no physical keyboard), the histogram mode cycle button is the only way. That's fine. The `cycleModeRef` is propagated through to both desktop sidebar and mobile bottom sheet.

---

### 1.5 `photo-viewer.tsx` — Main Photo Viewer

**File:** `apps/web/src/components/photo-viewer.tsx`

#### What's right
- **`<picture>` element with AVIF → WebP → JPEG sources** (lines 396-418): Browser-native format selection. AVIF first for wide-gamut + modern browser.
- **Blur preview** (lines 174-183, 617): The 16 px blurred preview is rendered as `backgroundImage` on the motion div, giving photographers an instant color-accurate preview while the full image decodes.
- **`forceShowColorChips` support** (lines 301-306): Sets `data-force-show-color-chips` on `<html>` so CSS can override display-gamut gating. Useful for photographer demos.
- **`data-display-gamut` attribute** (lines 311-314): Enables CSS to show P3 badges on Firefox (which lacks `(color-gamut: p3)` MQ).
- **Gamut-aware download dropdown** (lines 853-898): Wide-gamut sources show a dropdown with "sRGB JPEG" and "P3 AVIF" options. Honest about compatibility.
- **Keyboard shortcuts**: `C` toggles color details, `H` cycles histogram mode, `I` toggles info, `F` toggles lightbox. Comprehensive.
- **All toolbar buttons**: `h-11` (44 px). ✓

#### LOW: Download label "Download (Display P3 JPEG)" is ambiguous

Line 861: When `isP3Pipeline` is true, the button says `t('viewer.downloadP3Jpeg')` which is "Download (Display P3 JPEG)". But the actual `downloadHref` is the same base JPEG regardless of gamut. For wide-gamut sources, the JPEG IS tagged with a Display P3 ICC profile, so the label is technically accurate. However, photographers may interpret "Display P3 JPEG" as "a JPEG in Display P3 color space" — which is true — but may not realize it's still 8-bit (the 10-bit is AVIF-only). The dropdown item descriptions (`downloadSrgbJpegDesc`, `downloadP3AvifDesc`) clarify this, but the trigger button label doesn't.

**Suggestion:** Change trigger label to "Download JPEG (P3-tagged, 8-bit)" or add a subtitle.

---

### 1.6 `wide-gamut-hint.tsx` — Wide-Gamut Display Hint

**File:** `apps/web/src/components/wide-gamut-hint.tsx`

#### What's right
- **SSR-safe hydration gate** (`mounted`, lines 25-34): Prevents the SSR→client flash where the hint would appear after hydration on an sRGB display. Clean UX.
- **Uses `useDisplayCapability`**, not raw `matchMedia` (line 37): Firefox 124+ on macOS P3 displays correctly resolves to P3 via the canvas-P3 probe fallback. No false-positive "your display is sRGB" on Firefox.
- **Honest message**: "Your display shows the sRGB version of this photo. The full color gamut is available on Display P3 / wide-gamut screens." Clear, non-judgmental, actionable.

#### LOW: Hint is generic — doesn't name the source gamut

The hint always says "the full color gamut" without naming what gamut the photo was mastered in. A photographer viewing a Rec.2020 source on an sRGB display might want to know "This photo was mastered in Rec.2020" specifically, not just "wide-gamut". Consider interpolating the actual primaries into the message: "This photo was captured in Display P3. Your screen shows the sRGB version."

---

## 2. Translation Review

### 2.1 English (`en.json`)

| Key | Assessment |
|---|---|
| `viewer.transferPq` | "PQ (ST 2084)" — correct SMPTE standard reference |
| `viewer.transferHlg` | "HLG" — standard ITU-R BT.2100 abbreviation |
| `viewer.transferSrgb` | "sRGB" — standard IEC 61966-2-1 |
| `viewer.transferGamma22` | "Gamma 2.2" — correct |
| `viewer.transferLinear` | "Linear" — correct |
| `viewer.colorPipelineP3FromDisplayP3` | "P3 (from Display P3)" — clear |
| `viewer.colorPipelineP3FromDcip3` | "Display P3 (from DCI-P3)" — correctly distinguishes source vs destination |
| `viewer.colorPipelineP3FromDcip3Tooltip` | "White point adapted from DCI white (0.314, 0.351) to D65 (0.3127, 0.3290) via Bradford chromatic adaptation." — **Precise and accurate**. The chromaticities are correct to 4 decimal places. |
| `viewer.colorPipelineP3FromAdobergb` | "P3 (from Adobe RGB; saturated greens may clip)" — **Honest about clipping**. Critical for photographers who know Adobe RGB greens exceed P3. |
| `viewer.colorPipelineP3FromProphoto` | "P3 (from ProPhoto; saturated cyans / greens may clip)" — **Honest about clipping** |
| `viewer.colorPipelineP3FromRec2020` | "P3 (from Rec. 2020; saturated cyans may clip)" — **Honest about clipping** |
| `viewer.deliveredBitDepthP3` | "10-bit AVIF, 8-bit WebP/JPEG" — Correct for current pipeline |
| `viewer.deliveredBitDepthSrgb` | "8-bit (all formats)" — Correct |
| `viewer.hdrDeliveredAsSdr` | "Delivered as SDR — HDR AVIF output is planned." — Honest about current limitation |
| `viewer.gainMapPresent` / `gainMapDeliveredAsSdr` | "Apple HDR gain map detected" / "Delivered as SDR base only — gain map not yet passed through." — Clear, honest |
| `viewer.wideGamutHint` | "Your display shows the sRGB version of this photo. The full color gamut is available on Display P3 / wide-gamut screens." — Good |
| `viewer.calibrationTooltip` | "Display calibration affects color accuracy..." — Professional, accurate |

**Verdict:** English translations are technically precise, use correct standard names, and are honest about pipeline limitations. No issues.

### 2.2 Korean (`ko.json`)

| Key | Assessment |
|---|---|
| `viewer.transferPq` | "PQ (ST 2084)" — Latinate standard name preserved, correct |
| `viewer.transferHlg` | "HLG" — preserved, correct |
| `viewer.transferSrgb` | "sRGB" — preserved, correct |
| `viewer.transferGamma22` | "감마 2.2" — natural Korean; "감마" is the standard term in Korean photo community |
| `viewer.transferGamma18` | "감마 1.8" — natural |
| `viewer.transferLinear` | "리니어" — standard Korean photo term |
| `viewer.transferGamma26` | "감마 2.6" — correct |
| `viewer.colorPrimaries` | "색 재현 영역" — accurate technical translation |
| `viewer.transferFunction` | "전달 함수" — standard Korean color-science term |
| `viewer.colorPipelineDecision` | "색상 파이프라인" — clear |
| `viewer.colorPipelineP3FromDcip3Tooltip` | "DCI 백색점(0.314, 0.351)에서 D65(0.3127, 0.3290)로 Bradford 색채 적응을 통해 변환되었습니다." — **Accurate and natural**. "백색점" and "색채 적응" are correct Korean color-management terms. |
| `viewer.deliveredBitDepthP3` | "10비트 AVIF, 8비트 WebP/JPEG" — correct |
| `viewer.deliveredBitDepthSrgb` | "8비트 (모든 포맷)" — correct |
| `viewer.hdrDeliveredAsSdr` | "SDR로 전달됨 — HDR AVIF 출력은 계획 중입니다." — Natural, honest |
| `viewer.gainMapPresent` | "Apple HDR 게인 맵 감지됨" — "게인 맵" is the accepted Korean term for gain map |
| `viewer.wideGamutHint` | "현재 디스플레이에서는 sRGB로 변환된 색이 표시됩니다. Display P3 또는 광색역 디스플레이에서는 더 넓은 색역을 볼 수 있습니다." — Natural and clear. "광색역" is the standard Korean term for wide-gamut. |
| `viewer.calibrationTooltip` | "디스플레이 캘리브레이션은 색상 정확도에 영향을 줍니다..." — "캘리브레이션" is natural in Korean photo community |
| `viewer.histogramSrgbPreview` | "sRGB 색역 미리보기" — adds "색역" (gamut) for clarity vs English "sRGB preview". Good localization choice. |
| `viewer.histogramRenderedInP3` | "(히스토그램은 Display-P3 색역으로 렌더링됨)" — Clear, adds "색역" for precision |

**Verdict:** Korean translations are accurate, use established Korean photo-community terminology, and add clarifying words (like "색역") where appropriate without changing meaning. No issues.

---

## 3. Missing Information Photographers Need

### 3.1 `matrix_coefficients` (NCLX)

Stored in DB, included in JSON copy payload, but never rendered in the UI. For Rec.2020 sources, matrix 9 (BT.2020-NCL) vs matrix 10 (BT.2020-CL) matters for how the image is interpreted. **Recommendation:** Add an admin-only "Matrix coefficients" row in `ColorDetailsSection`, using humanized labels: "BT.709", "BT.2020 (NCL)", "BT.2020 (CL)", "Identity".

### 3.2 EXIF `ColorSpace` tag

Stored in `images.color_space` (sRGB / Uncalibrated). This is the camera's declaration, separate from ICC and NCLX. **Recommendation:** Add an admin-only "EXIF color space" row for cross-checking against ICC/NCLX.

### 3.3 Original file format color space

The UI shows "Format: HEIC (4.2 MB)" but doesn't say what color space the original was in. A photographer uploading a ProPhoto TIFF wants to know the pipeline detected the source correctly. **Recommendation:** Surface the original format's detected color space in the admin view (or in the JSON copy).

### 3.4 Histogram source image indicator

Photographers can't tell if the histogram was computed from the AVIF (potentially 10-bit P3) or the JPEG (8-bit sRGB). **Recommendation:** Add a small subtitle: "Histogram from _640.avif" or "Histogram from _640.jpg (sRGB preview)".

---

## 4. Accessibility & Touch Target Summary

| Component | Element | Touch Target | Status |
|---|---|---|---|
| `ColorDetailsSection` | Accordion toggle | `min-h-[44px]` | Pass |
| `ColorDetailsSection` | Info tooltip button | `min-h-[44px] min-w-[44px]` | Pass |
| `ColorDetailsSection` | Copy metadata button | `min-h-[44px] min-w-[44px]` | Pass |
| `ColorDetailsSection` | DCI-P3 info button | `min-h-11 min-w-11` | Pass |
| `LightboxColorPip` | Chip button | `min-h-11` (44 px) | Pass |
| `Histogram` | Collapse/expand | `min-h-11 min-w-11` | Pass |
| `Histogram` | Cycle mode | `min-h-11 min-w-11` | Pass |
| `InfoBottomSheet` | Drag handle | `min-h-11` | Pass |
| `InfoBottomSheet` | Close button | `min-h-11 min-w-11` | Pass |
| `InfoBottomSheet` | Download buttons | `min-h-11` | Pass |
| `PhotoViewer` | Toolbar buttons | `h-11` (44 px) | Pass |

**All interactive elements meet the 44×44 px WCAG 2.5.5 / Apple HIG floor.**

---

## 5. Honesty & Clarity Assessment

| Claim | Honest? | Evidence |
|---|---|---|
| HDR badge shown | Yes | Gated on `transfer_function === 'pq' \|\| 'hlg'`; both fields admin-only |
| HDR delivery note | Yes | "Delivered as SDR — HDR AVIF output is planned." |
| Gain map detection | Yes | "Apple HDR gain map detected" + "Delivered as SDR base only" |
| Wide-gamut hint | Yes | Only on sRGB displays; uses layered `useDisplayCapability` (not just MQ) |
| P3 badge on ICC | **No** (ProPhoto false positive) | `includes('p3')` matches "ProPhoto" |
| Delivered bit depth | Yes | "10-bit AVIF, 8-bit WebP/JPEG" for P3 sources |
| DCI-P3 adaptation | Yes | Tooltip explains Bradford D50→D65 |
| Clipping warnings | Yes | Pipeline decisions warn "saturated greens may clip" etc. |
| Histogram gamut | Yes | "(sRGB preview)" / "(histogram rendered in P3)" shown |
| Download gamut | Yes | Dropdown separates sRGB JPEG vs P3 AVIF |

---

## 6. Recommendations (Prioritized)

### HIGH
1. **Fix ProPhoto P3 badge false positive** (`color-details-section.tsx:226-228, 240-242`): Replace `iccName.toLowerCase().includes('p3')` with a strict allowlist check (`['display p3', 'p3-d65', 'dci-p3']` after normalization). ProPhoto RGB must NOT show a P3 badge.

### MEDIUM
2. **Add `matrix_coefficients` to ColorDetailsSection** (admin-only): Humanize values from NCLX codes. Photographers with Rec.2020 sources need this.
3. **Add EXIF `color_space` to ColorDetailsSection** (admin-only): Cross-reference against ICC/NCLX for debugging camera declarations.
4. **Replicate DCI-P3 Bradford tooltip in LightboxColorPip**: The lightbox expanded panel should show the same info button + tooltip as the sidebar accordion.
5. **Increase histogram canvas resolution on desktop**: 240×120 is mobile-appropriate but coarse for desktop. Scale to 320×160 or 480×240 on larger viewports.

### LOW
6. **Add histogram source image label**: Show "From _640.avif" or "From _640.jpg" so photographers know what derivative the bins represent.
7. **Add histogram summary statistics**: Mean luminance and key-type estimate ("High-key / Balanced / Low-key") would make the histogram more actionable.
8. **Make `wideGamutHint` gamut-specific**: Interpolate the actual primaries name: "This photo was captured in Display P3. Your screen shows the sRGB version."
9. **Add copy-to-clipboard button to LightboxColorPip expanded panel**: For photographers reviewing in lightbox who want to share metadata.
10. **Clarify download button label**: "Download JPEG (P3-tagged, 8-bit)" instead of "Download (Display P3 JPEG)" to avoid implying 10-bit JPEG.
