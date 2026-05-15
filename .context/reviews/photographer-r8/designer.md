# Photographer Review: Color/HDR UI/UX (R8)

**Reviewer persona:** Professional photographer, color-managed workflow, expects the viewer to communicate delivery honesty accurately.
**Date:** 2026-05-12
**Commit base:** `a8a59b0d`

---

## Executive Summary

The color-workflow UI is mature and largely honest. The delivery pipeline (source detection → encoder decision → per-format output) is accurately reflected in the viewer. Most findings are LOW severity edge cases or browser-capability gaps rather than correctness bugs. Two MEDIUM findings concern cross-browser badge visibility consistency.

| Severity | Count | Summary |
|----------|-------|---------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 2 | Firefox P3 badge gap; HDR badge missing delivery-honesty note |
| LOW | 6 | Histogram approximations, keyboard ref wiring, minor label clarity |

---

## 1. Honest Color Space Communication

### Finding 1.1 — `deliveredBitDepth` fallback for public queries is directionally correct
**File:** `apps/web/src/components/color-details-section.tsx`, lines 308–320
**Confidence:** HIGH
**Assessment:** PASS

The public query path cannot see `color_pipeline_decision` (admin-only per `_PrivacySensitiveKeys` guard in `data.ts`). The fallback logic:

```tsx
image.color_pipeline_decision
    ?? (image.color_primaries !== 'bt709' && image.color_primaries !== 'unknown'
        ? 'p3-from-displayp3'
        : 'srgb')
```

assumes `p3-from-displayp3` for any non-trivial primaries. Since `isP3Pipeline()` only checks `startsWith('p3-from-')`, and all wide-gamut deliveries are indeed P3-mapped (the encoder matrix has no sRGB fallback for wide-gamut sources), the resulting text "10-bit AVIF, 8-bit WebP/JPEG" is honest for all cases. The simplification is acceptable for public viewers who don't need pipeline provenance.

**Suggested improvement (LOW):** Consider using a more generic fallback label like `p3-from-wide-gamut` so the internal code doesn't falsely claim Display P3 provenance for Rec.2020 / ProPhoto / Adobe RGB sources in public queries. Not user-visible, but would make the code more self-documenting.

---

## 2. P3 Badge Visibility

### Finding 2.1 — P3 badge hidden on Firefox + P3 display (CSS MQ gap)
**File:** `apps/web/src/app/[locale]/globals.css`, lines 168–169
**File:** `apps/web/src/components/color-details-section.tsx`, lines 225–229, 239–243
**Confidence:** HIGH
**Severity:** MEDIUM

The `.gamut-p3-badge` visibility is gated purely on `@media (color-gamut: p3)`:

```css
.gamut-p3-badge { display: none; }
@media (color-gamut: p3) { .gamut-p3-badge { display: inline-block; } }
```

Firefox 124+ on macOS internal P3 displays **does not support** `(color-gamut: p3)` (Moz bug 1591455). However, the same Firefox configuration IS correctly detected by `useDisplayCapability` via canvas-P3 probe — the histogram requests a P3 canvas and the `WideGamutHint` correctly suppresses itself. The P3 badge alone is broken on Firefox.

**From a photographer's perspective:** I open my gallery in Firefox on my MacBook Pro (P3 display). The histogram shows "(P3)" and the wide-gamut hint is absent — both correct. But the ICC profile row lacks the purple "P3" chip that Safari/Chrome users see. This creates an inconsistent audit experience across browsers.

**Fix:** Add a JS-driven P3-badge visibility class that mirrors `useDisplayCapability`. The component already imports `useDisplayCapability` for other purposes; expose a `data-display-gamut` attribute on a container and use attribute selectors instead of (or in addition to) the MQ:

```css
.gamut-p3-badge { display: none; }
@media (color-gamut: p3) { .gamut-p3-badge { display: inline-block; } }
[data-display-gamut="p3"] .gamut-p3-badge,
[data-display-gamut="rec2020"] .gamut-p3-badge { display: inline-block; }
```

This preserves the MQ for browsers that support it while adding the Firefox fallback.

---

## 3. Histogram Accuracy

### Finding 3.1 — Luminance uses BT.709 coefficients for all primaries
**File:** `apps/web/public/histogram-worker.js`, line 25
**Confidence:** HIGH
**Severity:** LOW

The worker computes luminance as:

```js
const lum = Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv);
```

These are BT.709/sRGB coefficients. For P3 sources decoded into a Display-P3 canvas, P3 coefficients (0.22897/0.69174/0.07929) would be more accurate. The in-code comment (R7-L1) acknowledges this and calls the ~2–3% bin difference "acceptable for a compact histogram."

**From a photographer's perspective:** When I compare the GalleryKit histogram to Lightroom's, the luminance curve is slightly different for P3 images. For a quick audit, it's fine. For pixel-peeping, it's a minor discrepancy. The RGB overlay mode (`mode === 'rgb'`) mitigates this because photographers can verify per-channel distribution directly.

**Fix (optional):** Pass `colorPrimaries` to the worker and branch on `p3-d65`/`dci-p3`. Given the small delta, this is a nice-to-have, not a requirement.

### Finding 3.2 — Rec.2020 sources are histogrammed in Display-P3 canvas space
**File:** `apps/web/src/components/histogram.tsx`, lines 201–206
**Confidence:** HIGH
**Severity:** LOW

For Rec.2020 sources, `isWideGamutPrimary` returns true, so a Display-P3 canvas is requested. But Rec.2020 exceeds Display-P3 gamut. The histogram silently clips Rec.2020 colors to P3 bounds. The gamut label shows "(Rec.2020)" which is the source gamut, not the histogram rendering gamut.

**From a photographer's perspective:** I upload a Rec.2020 image and see "(Rec.2020)" on the histogram. I assume the histogram represents the full Rec.2020 data, but the canvas has already clipped to P3. This is a browser API limitation (canvas only supports sRGB and Display-P3), but the UI doesn't disclose it.

**Fix:** Append a subtle note when `colorPrimaries === 'bt2020'`, e.g. "(histogram rendered in Display-P3 space)" or similar, so the photographer knows the histogram is an approximation.

---

## 4. HDR Badge Honesty

### Finding 4.1 — HDR badge lacks "not yet delivered" clarification
**File:** `apps/web/src/components/color-details-section.tsx`, lines 340–351
**Confidence:** HIGH
**Severity:** MEDIUM

The HDR badge renders when `transfer_function === 'pq' || 'hlg'`. This is admin-only (good — the public never sees it). However, on an HDR-capable display where the badge IS visible, there is no accompanying text explaining that GalleryKit currently delivers the SDR base only.

**From a photographer's perspective:** I upload a PQ HDR image, open it on my HDR MacBook Pro, and see a glowing "HDR" badge. I might reasonably expect the image to be shown in HDR. But the delivery pipeline is SDR-only (WI-09 not shipped). The badge without context is misleading.

**Fix:** Add a tooltip or adjacent text to the HDR badge:

```tsx
{isHdr && (
    <div className="col-span-2 flex items-center gap-2">
        <span className="hdr-badge ...">{t('viewer.hdrBadge')}</span>
        <span className="text-xs text-muted-foreground italic">
            {t('viewer.hdrDeliveredAsSdr')}
        </span>
    </div>
)}
```

With translation: "Delivered as SDR — HDR AVIF output is planned."

This mirrors the gain map honesty pattern (`gainMapDeliveredAsSdr`) already established in the codebase.

### Finding 4.2 — HDR badge hidden on Chrome + HDR display (browser gap, not code bug)
**File:** `apps/web/src/app/[locale]/globals.css`, lines 172–173
**Confidence:** HIGH
**Severity:** LOW (documented limitation)

The badge uses `@media (dynamic-range: high)`. Chrome 122+ does not support this MQ (Chromium gap, per CLAUDE.md matrix). Edge and Safari do. This is a browser limitation, not a GalleryKit bug. The `useDisplayCapability` hook also relies on this MQ and has no Chrome HDR fallback.

**Recommendation:** Document this in the admin settings hint for `forceShowColorChips`: "Note: HDR badge visibility depends on browser support for `(dynamic-range: high)`. Chrome on HDR displays will not show the badge unless Force Show is enabled."

---

## 5. Color Metadata Labels

### Finding 5.1 — Labels are accurate and photographer-friendly
**Confidence:** HIGH
**Assessment:** PASS

The pipeline decision labels include clipping warnings which are genuinely useful:

- `"P3 (from Adobe RGB; saturated greens may clip)"`
- `"P3 (from ProPhoto; saturated cyans / greens may clip)"`
- `"P3 (from Rec. 2020; saturated cyans may clip)"`

These warnings help photographers understand why their wide-gamut source might look different after P3 mapping. The DCI-P3 tooltip (line 272–287 in color-details-section.tsx) explaining Bradford white-point adaptation is excellent — it answers the "why is my DCI-P3 labeled as Display P3?" question proactively.

### Finding 5.2 — Transfer function i18n is thorough
**File:** `apps/web/src/components/color-details-section.tsx`, lines 42–56
**Confidence:** HIGH
**Assessment:** PASS

Descriptive transfer names (Gamma 2.2, Gamma 1.8, Linear) are localized; Latinate technical names (PQ, HLG, sRGB) stay identical across locales. This matches the convention documented in the code comments and aligns with camera vendor documentation.

---

## 6. Wide-Gamut Hint Clarity

### Finding 6.1 — Hint is informative, non-alarming, and correctly gated
**File:** `apps/web/src/components/wide-gamut-hint.tsx`
**Confidence:** HIGH
**Assessment:** PASS

The hint text:

> "Your display shows the sRGB version of this photo. The full color gamut is available on Display P3 / wide-gamut screens."

is calm and factual. It doesn't blame the user or their display. The `mounted` gate (R5-H1) prevents SSR→client CLS flash. The `useDisplayCapability` hook correctly handles Firefox via canvas-P3 probe.

One minor observation: the hint uses the term "Display P3 / wide-gamut screens" which might suggest that ONLY Display P3 is the target, when in fact Rec.2020 and Adobe RGB sources also benefit from any non-sRGB display. However, Display P3 is the dominant consumer wide-gamut standard, so the wording is pragmatic.

---

## 7. Admin Settings Labels

### Finding 7.1 — Settings are clearly labeled with photographer-relevant tradeoffs
**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
**Confidence:** HIGH
**Assessment:** PASS

Each color-relevant setting has both a concise label and a detailed hint:

- **"Force sRGB on WebP and JPEG"** — explains downstream consumer use case; notes AVIF is unaffected.
- **"Allow HDR Ingest"** — clearly distinguishes PQ/HLG; explains rejection rationale.
- **"Wide-Gamut JPEG Chroma"** — explains 4:4:4 vs 4:2:0 tradeoff in terms photographers understand ("color bleeding in fine gradients").
- **"AVIF Encoding Effort"** — uses "smaller files / slower encoding" framing.
- **"Wide-Gamut Max Source Pixels"** — warns about memory usage with a concrete number.

### Finding 7.2 — `wideGamutMaxSourcePixels` label could be more descriptive
**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, line 271
**Confidence:** MEDIUM
**Severity:** LOW

The label "Wide-Gamut Max Source Pixels" / "광색역 최대 원본 픽셀 수" sounds like an output resolution cap. The hint clarifies it's a downscale threshold for the rgb16 pipeline, but the label itself is ambiguous.

**Fix:** Rename to "Wide-Gamut Source Downscale Threshold" / "광색역 원본 축소 임계값" to make it immediately clear this is a pre-processing memory guard, not a delivery size limit.

---

## 8. Lightbox Color Pip

### Finding 8.1 — Pip is compact, informative, and lazily loaded
**File:** `apps/web/src/components/lightbox-color-pip.tsx`
**Confidence:** HIGH
**Assessment:** PASS

The closed-state pip shows primaries + transfer + HDR badge in a single chip. The `min-h-11` touch target meets WCAG 2.5.5. The panel (open state) shows full metadata plus a histogram. The histogram is mounted only when the panel opens (P4-C1 / R4-M2), avoiding worker spawn on lightbox open.

### Finding 8.2 — Gain map info missing from lightbox pip
**File:** `apps/web/src/components/lightbox-color-pip.tsx`
**Confidence:** HIGH
**Severity:** LOW

The color details accordion shows the gain map row (`has_gain_map`) with "delivered as SDR base only" text. The lightbox pip does not. For admins reviewing Apple HDR photos in lightbox, this audit trail is broken.

**Fix:** Add the gain map row to the lightbox pip panel when `isAdmin && image.has_gain_map`, mirroring the accordion pattern.

---

## 9. Korean Translation Issues

### Finding 9.1 — Translations are technically accurate and professional
**File:** `apps/web/messages/ko.json`
**Confidence:** HIGH
**Assessment:** PASS

Reviewed all `viewer.*` and `settings.*` color-related keys. The translations use standard Korean technical terminology from display/color science:

| English | Korean | Assessment |
|---------|--------|------------|
| Color primaries | 색 재현 영역 | Standard term in Korean color science. Acceptable, though "색역" is more common in casual photography contexts. |
| Transfer function | 전달 함수 | Correct technical translation. |
| Color pipeline | 색상 파이프라인 | Correct. |
| Gain map | 게인 맵 | Correct; used in Korean iPhone photography communities. |
| Chroma subsampling | 색도 샘플링 | Correct; the label omits "subsampling" but the hint includes it. |
| Wide gamut | 광색역 | Standard Korean term. |

### Finding 9.2 — Minor: `histogramSrgbPreview` translation is slightly long
**File:** `apps/web/messages/ko.json`, line 295
**Confidence:** LOW
**Severity:** LOW

`"histogramSrgbPreview": "sRGB 색역 미리보기"` — this is 13 characters including spaces. In the histogram header (line 513 of histogram.tsx), it appends to the "Histogram (P3)" label. On narrow mobile screens, this could wrap. The English equivalent "sRGB preview" is shorter.

**Fix:** Consider `"sRGB 미리보기"` (9 chars) for brevity, or ensure the container has `white-space: nowrap` with `text-overflow: ellipsis`.

---

## 10. Touch Targets, Accessibility, Keyboard Navigation

### Finding 10.1 — All interactive color elements meet 44 px floor
**Confidence:** HIGH
**Assessment:** PASS

| Element | File | Line | Touch Target |
|---------|------|------|--------------|
| Color details toggle | color-details-section.tsx | 185 | `min-h-[44px]` |
| Calibration tooltip | color-details-section.tsx | 194 | `min-h-[44px] min-w-[44px]` |
| Copy metadata | color-details-section.tsx | 212 | `min-h-[44px] min-w-[44px]` |
| DCI-P3 info tooltip | color-details-section.tsx | 277 | `min-h-11 min-w-11` |
| Histogram collapse | histogram.tsx | 518 | `min-h-11 min-w-11` |
| Histogram mode cycle | histogram.tsx | 576 | `min-h-11 min-w-11` |
| Lightbox color pip | lightbox-color-pip.tsx | 84 | `min-h-11` |

### Finding 10.2 — Keyboard shortcuts for color UI are well-designed
**Confidence:** HIGH
**Assessment:** PASS

- `C` — toggles color details accordion (photo viewer) / color pip (lightbox)
- `H` — cycles histogram mode
- Both use `useImperativeHandle` (not direct ref mutation) for React 19 compatibility
- The keyboard handler guards against `isEditableTarget` so typing in inputs doesn't trigger shortcuts

### Finding 10.3 — Mobile bottom sheet histogram lacks `cycleModeRef` wiring
**File:** `apps/web/src/components/info-bottom-sheet.tsx`, lines 298–309 and 516–528
**File:** `apps/web/src/components/photo-viewer.tsx`, line 916
**Confidence:** HIGH
**Severity:** LOW

The `H` keyboard shortcut in `photo-viewer.tsx` calls `histogramCycleRef.current()`, but the ref is only wired to the desktop sidebar Histogram. The `InfoBottomSheet` component (mobile) receives the image and renders its own Histogram instances but never accepts or passes a `cycleModeRef`. A mobile user with a Bluetooth keyboard cannot cycle the histogram.

**Fix:** Add `cycleModeRef?: React.RefObject<(...)` to `InfoBottomSheetProps` and pass it to both Histogram instances inside the sheet.

### Finding 10.4 — ARIA labeling is comprehensive
**Confidence:** HIGH
**Assessment:** PASS

- Color details accordion: `aria-expanded`, `aria-controls`
- Histogram canvas: `role="img"`, `aria-label` with interpolated mode name
- Lightbox color pip: `aria-expanded`, `aria-label="Toggle color info"`
- Histogram collapse/expand: `aria-label` with expand/collapse text
- HDR badge: `role="img"`, `aria-label`
- The `forced-colors: active` media query in globals.css provides high-contrast adjustments for both badges and the lightbox pip.

---

## Appendix: Cross-Reference to Prior Review Cycles

Most findings from prior cycles are closed. This review validates:

- **C3-A2 / C3-COL-MED-1:** Transfer function i18n — still correct.
- **C4-A6:** ICC/primaries deduplication — still correct.
- **C4-A3 / C4-HDR-MED-2:** HDR gate on `transfer_function` — still correct.
- **P4-B1 / R4-M1:** `useDisplayCapability` replacing inline MQ — validated; Firefox P3 detection works.
- **P4-C1 / R4-M2:** Lazy histogram mount in lightbox pip — validated.
- **P4-C5 / R4-L2:** Lightbox pip `min-h-11` — validated.
- **P4-C6:** Copy color metadata JSON — validated.
- **R5-H1:** SSR mount gate on WideGamutHint — validated.
- **R5-H3:** RGB mode per-channel clip detection — validated.
- **R6-M2:** Canvas P3 context for wide-gamut histograms — validated.
- **R7-M7 / R7-M8:** Sized variant URLs + fallback chain — validated.

No regressions detected from prior cycles.
