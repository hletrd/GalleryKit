# UI/UX Review (R3) — Photographer & End-User Workflow

**Date:** 2026-05-08
**Premise:** photos arrive AFTER editing. The UI must surface the photographer's intent — gamut, dynamic range, color decisions — so the photographer can audit it and the visitor can appreciate it. **No edit / culling / scoring features.**
**Scope:** information architecture, accordion behavior, lightbox, mobile bottom sheet, histogram, download menus, photographer audit ergonomics, accessibility, internationalization.

---

## 0. The photographer's audit journey today

A photographer uploads a wide-gamut AdobeRGB photo. They want to verify:

1. The photo was correctly identified as AdobeRGB.
2. The encoder mapped it to P3 (the modern delivery target).
3. The delivered AVIF / WebP / JPEG embed P3 ICC.
4. The histogram reflects the wide-gamut source (not a sRGB-clipped read).
5. The download menu offers a P3-tagged JPEG.
6. The visitor on a P3 display sees the saturation; the visitor on a sRGB display sees the sRGB version with a hint that more is available.

**Today's experience:**

1. ✓ ICC name "Adobe RGB (1998)" appears in the EXIF panel headline. Good.
2. ⊘ Color decision "P3 (from Adobe RGB)" requires expanding the **collapsed-by-default** Color Details accordion. Friction.
3. ⊘ "Delivered: AVIF · WebP · JPEG (P3 8-bit, 10-bit AVIF)" — does not exist anywhere. Friction.
4. ✓ Histogram shows "(Adobe RGB)" gamut label and "(sRGB clipped)" indicator when applicable. Good. But (Firefox CF-HIGH-4) the canvas-P3 path is permanently false on Firefox.
5. ✓ Download menu shows split-button "Download (Display P3 JPEG)" with sub-options. Good.
6. ⊘ Visitor on sRGB display gets sRGB-clipped JPEG. **Zero hint** that more saturation exists. Photographer's intent silently degraded.

**Score:** 3/6 ✓ + 2/6 ⊘ (friction) + 1/6 ✗ (silent loss).

This review identifies the friction and silent-loss surfaces and proposes fixes.

---

## 1. Information architecture

### UX-HIGH-1 — Color Details accordion is collapsed by default

**Code:** `color-details-section.tsx:51-93`. The accordion `<button>` toggles `showColorDetails` from `false` (initial state).

**Photographer-intent impact:** the accordion contains:
- Color primaries / Color Space
- Transfer function
- Color pipeline decision (admin only)
- HDR badge

These are exactly the audit signals the photographer cares about most. Burying them behind an extra click ranks them BELOW "Camera: Sony α7 IV / Lens: 24-70mm / f/8 / ISO 100" — which the photographer almost certainly already knows from their own edit session.

**Fix shape:** open by default for any photo where:
- `image.color_primaries && image.color_primaries !== 'bt709'`, OR
- `image.is_hdr`, OR
- `image.color_pipeline_decision && image.color_pipeline_decision !== 'srgb' && image.color_pipeline_decision !== 'srgb-from-unknown'`.

i.e., open by default for any photo whose color path is non-trivial. sRGB → sRGB photos default to collapsed (no audit value).

```tsx
const isNonTrivialColor = (
  (image.color_primaries && image.color_primaries !== 'bt709') ||
  image.is_hdr ||
  (image.color_pipeline_decision && image.color_pipeline_decision !== 'srgb' && image.color_pipeline_decision !== 'srgb-from-unknown')
);
const [showColorDetails, setShowColorDetails] = useState(isNonTrivialColor);
```

**Severity:** **HIGH** for photographer audit; trivial for sRGB sources.

---

### UX-HIGH-2 — Lightbox / fullscreen has zero color metadata UI

**Code:** `lightbox.tsx:399-448`. The lightbox renders only the `<picture>` element (AVIF/WebP/JPEG) plus controls (close, slideshow, navigation). No EXIF panel, no HDR badge, no calibration tooltip.

**Photographer-intent impact:** the lightbox is when the photographer demos a photo to a client or reviews it at full resolution. EXACTLY when the color metadata matters most. The main viewer's sidebar is hidden behind the lightbox backdrop.

**Fix shape:**
- Add a small bottom-left pip (matches the existing `1 / 12` position indicator placement) showing a compact color summary: `P3 · 10-bit` or `HDR · PQ` or `sRGB`.
- Tap / click pip → slide-up panel with full color metadata + histogram.
- Fade in/out with controls visibility (`controlsVisible` ref).
- Forced-colors mode rules.
- Keyboard shortcut `c` to expand the panel.

**Severity:** **HIGH**.

---

### UX-HIGH-3 — Histogram has no clip / overexposure markers

Cross-reference: color-fidelity.md CF-MED-4.

**Code:** `histogram.tsx:166-234` `drawHistogram`. The canvas paints filled paths for each channel. No grid, no clip indicators, no percentile callout.

**Pro-grade histogram features the photographer expects:**
- 0/64/128/192/255 grid lines.
- Top blink (255 bin > threshold) — "highlights clipping."
- Bottom blink (0 bin > threshold) — "shadows crushing."
- Per-channel max overlay ("R: 99.5%, G: 100%, B: 87.3%").
- "% below black" / "% above white" labels.
- Optional: 99th / 1st percentile markers.

**Photographer-intent impact:** today's histogram is informational decoration. Photographer cannot verify exposure intent from it.

**Fix shape:** drawing additions in `drawHistogram`. No new data; canvas overlay only:

```ts
// After drawChannel calls:
// 1. Draw grid lines at 0/64/128/192/255 in low-contrast.
// 2. If bins[0] > h * 0.005 (>0.5% pixels at full black), draw red strip on left edge.
// 3. If bins[255] > h * 0.005 (>0.5% pixels at full white), draw red strip on right edge.
// 4. Below the canvas, render text:
//    "Below black: 0.0% · Above white: 1.2%"
```

**Severity:** **HIGH** for pro photographers; **MED** for general audience.

---

### UX-HIGH-4 — `(P3)` and `(HDR)` chips invisible on non-matching displays even for photographer demoing to client

**Code:** `globals.css:168-173`. Both chips gated on display capability.

**Photographer-intent impact:** photographer with a sRGB laptop demoes their P3 photos to a client → the `(P3)` chip is invisible because the laptop is sRGB. Photographer says "this is a P3 photo" but the audit UI doesn't agree. Same for HDR.

**Fix shape:** admin opt-in setting `force_show_color_chips` (default false). When true, the gate becomes:

```css
.gamut-p3-badge { display: none; }
@media (color-gamut: p3) { .gamut-p3-badge { display: inline-block; } }
:root[data-force-show-color-chips="true"] .gamut-p3-badge { display: inline-block; }
```

UI surface in admin settings. Photographers in demo mode flip it on.

**Severity:** **HIGH** for photographer demo workflow.

---

## 2. MED findings

### UX-MED-1 — `(P3)` chip duplicated across EXIF panel and Color Details accordion

**Code:** `photo-viewer.tsx:687-699` (EXIF panel ICC row with inline P3 chip), `color-details-section.tsx:99-115` (Color primaries row).

The EXIF panel ICC row appends a P3 chip when the ICC name contains 'p3'. The Color Details accordion separately renders the gamut info via `humanizeColorPrimaries`.

**Photographer-intent impact:** redundant. Two surfaces showing the same data with different code paths and slightly different presentation.

**Fix shape:** decide on a single home for the gamut chip. Recommendation: keep the EXIF panel ICC row as the headline (where the photographer's eye lands first). Remove the chip from the Color Details accordion's "Color primaries" row when it would duplicate (already partially done via `primariesMatchIcc` deduplication, but the chip vs. `humanizeColorPrimaries` text is a SEPARATE duplication).

**Severity:** MED.

---

### UX-MED-2 — Mobile bottom sheet expanded layout is multi-screen scroll

**Code:** `info-bottom-sheet.tsx:255-505`. The expanded sheet contains, in order:
1. Tags
2. Description
3. EXIF grid (16+ rows)
4. Color details accordion
5. Histogram (240×120)
6. Capture date / time
7. Download dropdown

On a 600 px tall iPhone SE viewport, this is 2-3 viewport heights of vertical scroll inside a sheet that is itself draggable (via `handleTouchMove` at line 73-78). Drag-while-scrolling can accidentally collapse the sheet.

**Photographer-intent impact:** mobile users (P3 + HDR audience) have to scroll a long sheet to find the color details. Easy to accidentally close the sheet.

**Fix shape:**
- Add a sticky tab bar at the top of the expanded sheet: `[EXIF] [Color] [Histogram] [Download]`.
- Tabs scroll-jump within the sheet.
- Or: prioritize the order — Color Details → Histogram → Download → EXIF (as a secondary, since photographer audience cares about color first).
- Or: make EXIF collapsed by default, color details open by default (matches UX-HIGH-1).

**Severity:** MED.

---

### UX-MED-3 — Korean translations missing for `transferFunction` row label and other color terms

**Code:** `messages/ko.json`. Spot check showed:
- `colorPrimaries: "색 재현 영역"` ✓
- `colorPipelineDecision: "색상 파이프라인"` ✓
- `transferFunction` — not found in the grep at line 313.
- `forceSrgbDerivativesHint` — not found.

**Photographer-intent impact:** Korean photographers see English fallback for "Transfer function" / `forceSrgbDerivativesHint`. Inconsistent.

**Fix shape:** add to `ko.json`:
```json
"transferFunction": "전달 함수",
"forceSrgbDerivativesHint": "활성화 시 WebP와 JPEG 변환본은 원본 색 공간과 무관하게 항상 sRGB로 인코딩됩니다. 레거시 임베더 또는 특정 클라이언트가 sRGB JPEG를 요구하는 경우에만 사용하세요. AVIF 변환본은 원본 색 영역을 유지합니다."
```

Phrasing: "전달 함수" is the literal translation. For non-pro audience, "감마 / HDR 표현 방식" is more descriptive but jargon-mismatch with the English. Recommend: keep literal in admin UI; humanize only for the public-facing badge labels.

**Severity:** MED (Korean photographers).

---

### UX-MED-4 — `primariesMatchIcc` deduplication uses string equality

**Code:** `color-details-section.tsx:60-61`:

```ts
const primariesHuman = humanizeColorPrimaries(image.color_primaries);
const iccName = image.icc_profile_name || '';
const primariesMatchIcc = primariesHuman && iccName && primariesHuman.toLowerCase() === iccName.toLowerCase();
```

For "Display P3" vs "Display P3 - ACES" or "P3-D65" (alias), `primariesHuman` is "Display P3" but `iccName` is something else. Equality fails; both render. Visual duplication for edge cases.

**Fix shape:** match on a normalized form:

```ts
function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
const primariesMatchIcc = primariesHuman && iccName &&
  normalizeForCompare(iccName).includes(normalizeForCompare(primariesHuman));
```

`normalizeForCompare("Display P3 - ACES").includes(normalizeForCompare("Display P3"))` → "displayp3aces".includes("displayp3") → true.

**Severity:** MED (edge cases; visible on test fixtures).

---

### UX-MED-5 — Download dropdown menu has no descriptive preview

**Code:** `photo-viewer.tsx:840-870`. Menu items: "Download sRGB JPEG", "Download Display P3 AVIF", "Download HDR AVIF" (the last one is a 404 landmine — see HW-CRIT-1).

For a non-pro visitor who knows they want a JPEG but has never heard of Display P3 vs sRGB, the menu is jargon-heavy.

**Fix shape:** add a one-line description below each menu label:

```
Download sRGB JPEG          Compatible with all browsers and apps
Download Display P3 JPEG    Wider color on supported displays (Apple, modern Android)
Download Display P3 AVIF    Smallest file, modern browsers only
```

i18n: each description is a separate translation key.

**Severity:** MED (general audience).

---

### UX-MED-6 — Sidebar layout: Color Details below EXIF + Histogram

**Code:** `photo-viewer.tsx:649-796`. Sidebar render order:
1. EXIF section header
2. EXIF grid (camera / lens / focal / aperture / shutter / ISO / **icc_profile_name** / dimensions / format / WB / metering / EC / EP / flash / **bit depth** / GPS)
3. Color Details accordion
4. Histogram
5. Capture date
6. Download

The headline "Color Space" lives inside the EXIF grid (item 2). The Color Details accordion is item 3. **The two color-related rows are split across two containers** with the EXIF grid bullet-points between.

**Photographer-intent impact:** photographer scans the sidebar top-to-bottom, lands on EXIF, finds "Color Space: Display P3", thinks they have everything. The richer Color Details accordion is below the fold (after 12+ EXIF rows).

**Fix shape:** information-architecture pass:
- Lift Color Details to position 2 (between EXIF section header and EXIF grid), or replace the EXIF panel "Color Space" row entirely with a richer Color Details surface that includes the ICC name + primaries + transfer function + decision in one block.
- Keep the histogram below.

**Severity:** MED.

---

### UX-MED-7 — `text-[10px]` on chips below WCAG 4.5:1 floor

Cross-reference: color-fidelity.md CF-MED-5.

**Code:**
- `photo-viewer.tsx:693` `text-[10px] font-semibold bg-purple-100 text-purple-700` — P3 chip.
- `info-bottom-sheet.tsx:333` same.
- `histogram.tsx:346` `text-xs` (12px) `opacity-60` for `(sRGB clipped)` indicator — opacity drops contrast below floor.

**Photographer-intent impact:** key audit signals are visually buried below WCAG legibility floor.

**Fix shape:**
- P3 chip: bump to `text-[11px] font-bold` with high-contrast palette.
- sRGB clipped indicator: drop `opacity-60`, use `text-amber-700 dark:text-amber-300` for visibility.

**Severity:** MED.

---

### UX-MED-8 — `display: inline-flex !important` on `.hdr-badge`

Cross-reference: hdr-workflow.md HW-MED-1.

**Severity:** MED.

---

## 3. LOW findings

### UX-LOW-1 — No keyboard shortcut for Color Details accordion

**Code:** `photo-viewer.tsx:315-336`. Bound: `i` (info pin), `f` (lightbox), `←`/`→` (nav).

**Fix shape:** bind `c` to toggle Color Details. Add to `viewer.shortcutsHint` translation.

**Severity:** LOW.

---

### UX-LOW-2 — No "Copy color metadata" affordance

For pro photographers writing support tickets / forum posts, a one-click copy of "Color Space: Display P3 / Pipeline: P3 (from Adobe RGB) / Transfer: sRGB / Bit Depth: 16-bit (delivered: 10-bit AVIF)" would be useful. Today the photographer has to manually copy each row.

**Fix shape:** small "copy" icon in the Color Details header. Click → JSON.stringify → clipboard.

**Severity:** LOW.

---

### UX-LOW-3 — No "Download original" button

The original is privately stored. Photographers may want it back (re-edit, re-export). Today the only download options are derivatives.

**Fix shape:** admin-only "Download original" item in the dropdown (gated on admin auth + audit-log on access).

**Severity:** LOW.

---

### UX-LOW-4 — No keyboard shortcut for histogram mode cycle

**Code:** `histogram.tsx:333-338` `cycleMode` is mouse / touch only.

**Fix shape:** bind `h` to cycle.

**Severity:** LOW.

---

### UX-LOW-5 — Histogram `bg-black/20` background prevents canvas readability on dark themes

**Code:** `histogram.tsx:360`:

```tsx
<div className="relative w-[240px] h-[120px] bg-black/20 rounded overflow-hidden">
```

On dark theme (.dark or .oled), the canvas is on a near-black background. The drawn channel paths use `#ef4444 / #22c55e / #3b82f6` colors which are still legible but the muted-foreground grid color from `drawHistogram` doesn't apply — the histogram has no grid.

**Fix shape:** if UX-HIGH-3 (clip indicators) is implemented, this becomes a non-issue.

**Severity:** LOW.

---

### UX-LOW-6 — Download dropdown for sRGB sources still shows the menu

**Code:** `photo-viewer.tsx:828-882`. The split-button menu is shown when `isWideGamutSource && avifDownloadHref`. For sRGB sources it falls through to the simple `Button asChild`. ✓ Good — already correct per plan-37 E2.

But `isWideGamutSource` checks `image.color_primaries in ('p3-d65', 'bt2020', 'adobergb', 'prophoto', 'dci-p3')`. For an unknown source (no ICC, no NCLX) the check is false, simple button shown. ✓.

**No issue.** Documented as correct.

---

### UX-LOW-7 — Mobile bottom sheet drag handle has no explicit "swipe down to close" hint

**Code:** `info-bottom-sheet.tsx:197-219`. The drag handle is a small 40px-wide pill. Swipe gestures work; the affordance is implicit.

**Fix shape:** small text label below the pill on first open: "Swipe down to close" (i18n). Dismiss after 3 sec / first interaction.

**Severity:** LOW.

---

### UX-LOW-8 — Color Details accordion `pl-6` indent doesn't match EXIF grid

**Code:** `color-details-section.tsx:95` `pl-6` indent on the disclosed grid.

**Photographer-intent impact:** visual mismatch with the unindented EXIF grid above.

**Fix shape:** drop `pl-6`; align with EXIF grid columns.

**Severity:** LOW.

---

### UX-LOW-9 — `chevron` rotation on accordion is the only "expanded" cue (besides aria-expanded)

**Code:** `color-details-section.tsx:76`. Visually the chevron rotates 180°. No height transition, no fade.

**Fix shape:** add a `transition-all` height-from-0 animation on the disclosed `<div>`. Smoother visual.

**Severity:** LOW.

---

## 4. Lightbox specifics

### UX-LB-1 — No EXIF panel even on 'i' key in lightbox

**Code:** `photo-viewer.tsx:315-336`. The `i` key handler:

```ts
} else if (e.key === 'i' || e.key === 'I') {
    const isLg = window.matchMedia('(min-width: 1024px)').matches;
    if (isLg) {
        setIsPinned(prev => !prev);  // toggle desktop sidebar
    } else {
        setShowBottomSheet(prev => !prev);  // toggle mobile sheet
    }
}
```

But: `useEffect(..., [showLightbox])` returns early when `showLightbox` is true (line 317). **The `i` key does nothing while the lightbox is open.**

**Photographer-intent impact:** photographer in lightbox cannot reach color metadata via keyboard.

**Fix shape:** in lightbox component, bind `i` to a slide-up info panel (per UX-HIGH-2) within the lightbox.

**Severity:** HIGH (combined with UX-HIGH-2).

---

### UX-LB-2 — Lightbox doesn't respect the photo's `color_primaries` / wide-gamut hint

**Code:** `lightbox.tsx:399-448`. The `<picture>` carries AVIF / WebP / JPEG. Browser picks one. The lightbox itself has no awareness of the gamut — no badge, no chip, no histogram.

**Fix shape:** combined with UX-HIGH-2 (color pip + slide-up panel). Lightbox color awareness ships together.

---

## 5. Mobile bottom sheet specifics

### UX-MS-1 — Color Details is rendered, but full mobile parity with desktop is partial

**Code:** `info-bottom-sheet.tsx:424` renders `<ColorDetailsSection image={image} isAdmin={isAdminProp} t={t} />` — same as desktop. ✓ Good (plan-37 B1 success).

**However:**
- Mobile bottom sheet's download dropdown (`info-bottom-sheet.tsx:471-490`) does NOT include the HDR menu item, while desktop does (`photo-viewer.tsx:859-869`).
- This is inconsistent. **Mobile is silently better-off** (since the HDR item is a 404 landmine — see HW-CRIT-1) but the inconsistency is the bigger issue.

**Fix shape:** delete the desktop HDR menu item (per HW-CRIT-1 / R3-C1 fix). Restores symmetry. When WI-09 ships, re-add to BOTH.

**Severity:** see HW-CRIT-1.

---

### UX-MS-2 — Bottom sheet drag handle and EXIF grid compete for the first touch

The drag handle is at the top of the sheet. Below it is the EXIF grid. On the iPhone SE viewport, the EXIF grid extends beyond the visible peek state. Swipe-up gesture starting in the EXIF area can be interpreted as either "expand sheet" or "scroll EXIF inside sheet."

**Code:** `info-bottom-sheet.tsx:197-219` (drag handle), `:255-505` (expanded scrollable content with `overflow-y: auto` at line 256).

When `sheetState === 'expanded'`, the inner `<div>` is `overflow-y: auto`. So:
- Swipe inside expanded content → scrolls inner content.
- Swipe on drag handle → resizes sheet.

**Photographer-intent impact:** functional today. But: dragging the drag handle requires precise targeting on a 40px × 28px pill near the top of a tall sheet. Mobile users may swipe on the EXIF area expecting to drag the sheet.

**Fix shape:** widen the touch target of the drag handle to the full sheet header (full-width chunk above EXIF). Visual indicator stays the small pill; touch zone is larger.

**Severity:** LOW.

---

## 6. Accessibility findings

### UX-A11Y-1 — HDR badge uses `role="img"` with `aria-label`

**Code:** `color-details-section.tsx:131-140`:

```tsx
<span
  className="hdr-badge …"
  aria-label={t('viewer.hdrBadgeAriaLabel')}
  title={t('viewer.hdrBadgeAriaLabel')}
  role="img"
>
  {t('viewer.hdrBadge')}
</span>
```

`role="img"` is correct (the visual badge is decorative-with-meaning). `aria-label` provides the announcement. ✓ Good.

But: `display: none` on non-HDR displays means screen readers also don't announce it. For a non-sighted user on a HDR-capable phone, this is fine. For a non-sighted user on a SDR-capable laptop, the HDR-tagged photo is silent on the HDR fact. Cross-reference with UX-HIGH-4: photographer demoing to a client may not want the visual chip but DOES want the SR announcement.

**Fix shape:** combined with UX-HIGH-4 admin opt-in. When `force_show_color_chips=true`, the badge `display` is unhidden AND the `aria-label` works for SR users on any display.

**Severity:** LOW.

---

### UX-A11Y-2 — Calibration tooltip is keyboard-reachable; trigger is sibling button (good)

**Code:** `color-details-section.tsx:79-92`. The Tooltip.Trigger wraps a `<button>` that is sibling to the accordion button. Both are keyboard-focusable. Aria-label on the calibration button is `viewer.calibrationTooltip`. ✓ Good (plan-37 B2 success).

**No issue.**

---

### UX-A11Y-3 — Forced-colors mode for `.hdr-badge` and `.gamut-p3-badge`

**Code:** `globals.css:175-185`. ✓ Good (plan-37 D3 success).

**No issue.**

---

### UX-A11Y-4 — Histogram canvas has `role="img"` + `aria-label`

**Code:** `histogram.tsx:366-373`:

```tsx
<canvas
  ref={canvasRef}
  width={240} height={120}
  className="w-full h-full"
  role="img"
  aria-label={t('aria.histogramLabel', { mode: modeLabels[mode] })}
/>
```

✓ Good. SR users hear "Color histogram, Luminance mode" or similar.

For UX-HIGH-3 (clip indicators), the aria-label should expand:
```ts
aria-label={t('aria.histogramLabel', {
  mode: modeLabels[mode],
  clipBlack: pctBelowBlack.toFixed(1),
  clipWhite: pctAboveWhite.toFixed(1),
})}
```

**Severity:** LOW.

---

## 7. Internationalization findings

### UX-I18N-1 — Korean translations missing or partial

See UX-MED-3 above. Specifically:
- `viewer.transferFunction` — verify presence.
- `settings.forceSrgbDerivativesHint` — verify presence.
- `viewer.calibrationTooltip` — verify Korean copy is photographer-friendly.
- `viewer.colorPipelineDecision` value humanizers — Korean labels for "P3 (from Adobe RGB)" etc.

**Fix shape:** Korean review pass on all color-related copy.

---

### UX-I18N-2 — `humanizeColorPrimaries` always returns English

**Code:** `color-details-section.tsx:8-18`. Hardcoded English strings. No locale parameter.

```ts
export function humanizeColorPrimaries(value: string | null | undefined): string {
    switch (value) {
        case 'bt709': return 'BT.709';
        case 'p3-d65': return 'Display P3';
        …
    }
}
```

**Photographer-intent impact:** Korean photographer sees "Display P3" / "Adobe RGB" in the Color Details accordion regardless of locale. These are technical terms with established Korean usage ("디스플레이 P3", "어도비 RGB") but for jargon-tolerant pro audience the English is fine.

**Fix shape:** thread `t` through `humanizeColorPrimaries` and add translation keys. Or accept the English-only convention for technical color terms.

**Severity:** LOW.

---

## 8. Recommended fixes (UI/UX track)

Numbered to align with the plan in `.context/plans/38-photographer-r3-followup.md`:

1. **UX-HIGH-1** → P3-25 Open Color Details by default for non-trivial color sources.
2. **UX-HIGH-2** → P3-16 (combined with HW-HIGH-4) Lightbox color pip + slide-up panel.
3. **UX-HIGH-3** → P3-9 (combined with CF-MED-4) Histogram clip indicators.
4. **UX-HIGH-4** → P3-26 Admin opt-in `force_show_color_chips`.
5. **UX-MED-1** → P3-27 Deduplicate `(P3)` chip across EXIF + Color Details.
6. **UX-MED-2** → P3-28 Mobile bottom sheet IA pass (sticky tabs / reorder).
7. **UX-MED-3** → P3-29 Korean translation pass for color terms.
8. **UX-MED-4** → P3-30 `primariesMatchIcc` normalization fix.
9. **UX-MED-5** → P3-31 Download dropdown menu descriptions.
10. **UX-MED-6** → P3-32 Sidebar layout — Color Details up.
11. **UX-MED-7** → P3-10 (combined with CF-MED-5) Chip contrast bump.
12. **UX-MED-8** → P3-17 Drop `!important` on `.hdr-badge`.
13. **UX-LOW-\*** → P3-33 Polish bundle (`c` shortcut, copy metadata, height transition, etc.).

---

## 9. What is correct (do not change)

- ColorDetailsSection extracted as a shared component; rendered in BOTH desktop sidebar and mobile bottom sheet. ✓ (plan-37 B1).
- Calibration tooltip is keyboard-reachable sibling button. ✓ (plan-37 B2).
- `aria-expanded` / `aria-controls` on accordion. ✓ (plan-37 D1).
- Forced-colors rules for badges. ✓ (plan-37 D3).
- Hidden HDR / P3 chips on non-matching displays. ✓ (correct given the audit honesty model).
- HDR `<picture> <source media="(dynamic-range: high)">` deletion. ✓ (plan-37 A4).
- Histogram cached AVIF probe at module scope. ✓ (plan-37 C1).
- HDR badge i18n labels (en + ko). ✓ (plan-37 D4).
- Touch targets at 44 px minimum across new color UI. ✓ (audited).

---

## 10. Out of scope (per task premise)

- Edit / culling / scoring features.
- Soft-proof / target-display preview.
- Comparison view between adjacent photos.
- Photo-bound calibration patches.
- 3D LUT preview.
- Print / proof workflow.
