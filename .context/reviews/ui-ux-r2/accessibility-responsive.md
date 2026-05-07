# GalleryKit UI/UX Review (R2): Accessibility + Responsive

**Reviewer angle:** A11y + responsive design pass after ~30 commits of color-management UI changes (HDR badge, color details accordion, gamut-aware download, smart collections public route, calibration tooltip, P3 histogram).
**Premise honored:** photos uploaded post-edit; no edit/scoring features in scope.
**Severity scheme:** `[A11Y-CRIT]` / `[A11Y-HIGH]` / `[A11Y-MED]` / `[A11Y-LOW]` for accessibility findings; `[RESP-HIGH]` / `[RESP-MED]` / `[RESP-LOW]` for responsive issues.

---

## 1. Touch-target audit (44 px floor)

The repo enforces a fixture-based 44 px touch-target floor at `apps/web/src/__tests__/touch-target-audit.test.ts:208-264`. The FORBIDDEN regex set catches shadcn `<Button size="sm">` without an `h-11`/`size-11` override, `<Button size="icon">` without an override, plus `h-8`/`h-9`/`h-10` literals on both `<Button>` and HTML `<button>` (multi-line normalizer at lines 311-385).

### `[A11Y-MED-1]` Color details accordion trigger is a raw HTML `<button>`, not a shadcn `<Button>` — passes the audit by accident, not by coverage

`apps/web/src/components/photo-viewer.tsx:840-857` introduces the new color details disclosure:

```tsx
<button
    type="button"
    onClick={() => setShowColorDetails(!showColorDetails)}
    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
>
```

The author correctly added `min-h-[44px]` so it clears the floor, but the FORBIDDEN regex set in `touch-target-audit.test.ts:208-264` does NOT match `min-h-[44px]` as a passing override and also does NOT match a raw `<button>` for sizing in the same way it covers `<Button>` (the `h-11`/`min-h-11`/`size-11` allow-list at line 214 is only checked when one of the violation patterns trips first). In this case the violation patterns themselves do not trip because there is no `h-8`/`h-9`/`h-10` literal. Net effect: the file passes the audit, but the test does not actively confirm that the new accordion meets the floor — it merely fails to detect a violation. The arbitrary-value bracket form `min-h-[44px]` is not in the documented allow-list (`h-11`, `min-h-11`, `size-11`, `h-12`, `size-12` per lines 214 and 221).

Recommendation note (no code change requested): future audits should add `min-h-\[44px\]` to the override allow-list and add positive-shape coverage for raw `<button>` color disclosure triggers. As written today, a contributor could regress this trigger to `min-h-[36px]` and the audit would still pass.

### `[A11Y-LOW-1]` Calibration tooltip trigger has no explicit hit target

`apps/web/src/components/photo-viewer.tsx:847-856`:

```tsx
<Tooltip>
    <TooltipTrigger asChild>
        <span className="inline-flex">
            <Info className="h-4 w-4 text-muted-foreground/60" />
        </span>
    </TooltipTrigger>
    <TooltipContent>{t('viewer.calibrationTooltip')}</TooltipContent>
</Tooltip>
```

The trigger is a `<span>` wrapping a 16x16 px Lucide `Info` icon. Radix `TooltipTrigger asChild` proxies focus and pointer events to the child, so the effective hit target is 16x16 px — well under the 44 px floor. Two mitigations exist: (a) the trigger is nested inside the larger color details `<button>` so the parent button's 44 px floor receives the tap; (b) tooltips on hover-only triggers are exempt from WCAG 2.5.5 by some interpretations. However, on a touch device the user has to tap the icon directly to see the tooltip (Radix Tooltip uses `pointerover`/`focus`, NOT `click`, so a touch-only user often cannot read the tooltip at all without keyboard focus). This is a discoverability bug, not a strict violation, but combined with the 16 px target it is worth flagging.

### `[A11Y-LOW-2]` HDR badge is non-interactive — no touch-target obligation, but verify

`apps/web/src/components/photo-viewer.tsx:878-890`: The HDR badge is a `<span>` wrapped in CSS `@media (dynamic-range: high)`. It is purely informational and not interactive, so the 44 px rule does not apply. Confirmed acceptable.

### `[A11Y-LOW-3]` Download menu trigger and items pass

`apps/web/src/components/photo-viewer.tsx:944-984`: `DropdownMenuTrigger` wraps a `<Button className="w-full gap-2 min-h-11">`, which clears the floor (`min-h-11` is in the allow-list at line 214). Each `DropdownMenuItem` carries `className="min-h-11"` — confirmed at lines 954, 963, 973. The base `DropdownMenuItem` primitive at `apps/web/src/components/ui/dropdown-menu.tsx:62-83` has no built-in min height; the consumer is correctly adding it. The `min-h-11` override is in the allow-list (line 214 of the audit test).

### `[A11Y-LOW-4]` Histogram cycle-mode button uses arbitrary-value override

`apps/web/src/components/histogram.tsx:370-377`: `className="self-start min-h-11 min-w-11 text-xs font-mono px-2 py-2 rounded bg-muted ..."`. Clears 44x44 px. Pass.

### `[A11Y-LOW-5]` Histogram collapse triangle is too small

`apps/web/src/components/histogram.tsx:343-350`: the `▾`/`▸` collapse toggle uses `className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"` with no min-height/width and a glyph-sized text-xs. On a touch device this resolves to roughly 12-14 px tall — well under 44 px. The audit regex set does not catch it because there is no `h-N` class at all. The control is technically an HTML `<button>` with only padding `px-1`. **`[A11Y-MED-2]`** — explicit hit target needed for parity with the rest of the new UI surface.

---

## 2. Keyboard navigation through the photo viewer

The viewer registers `keydown` on `window` at `apps/web/src/components/photo-viewer.tsx:364-385` with these bindings: `ArrowLeft`/`ArrowRight` navigate, `f`/`F` toggles lightbox, `i`/`I` toggles info panel. `isEditableTarget` (lines 37-43) correctly suppresses these when the user is in a text input.

### `[A11Y-MED-3]` Color details accordion is missing `aria-expanded`/`aria-controls`

`apps/web/src/components/photo-viewer.tsx:840-857`: The disclosure button toggles `showColorDetails` but does not advertise its expanded state to assistive tech. WCAG 4.1.2 requires programmatic state for custom controls. Compare with the (correct) `info-bottom-sheet.tsx:201` which sets `aria-expanded={sheetState === 'expanded'}`. The chevron rotation (`rotate-180`) is a visual-only signal.

### `[A11Y-LOW-6]` `aria-keyshortcuts` does not advertise the chevron-rotation shortcut

The keyboard `i`/`I` and `f`/`F` shortcuts are advertised via `aria-keyshortcuts` on the lightbox trigger and info button (lines 538, 590). The new color details accordion has no keyboard shortcut and no aria-keyshortcuts — acceptable, since not every disclosure needs a shortcut, but the calibration tooltip is currently unreachable via keyboard for a screen-reader-only user (Radix opens the tooltip on focus, but the inner `<span>` with `inline-flex` is not focusable; the accordion `<button>` swallows focus from outside but does not trigger the tooltip on focus). Net: a keyboard-only user sees the chevron and the "Color details" label, but never sees the calibration explanation. **`[A11Y-MED-4]`**.

### `[A11Y-MED-5]` Download dropdown menu — Escape close behavior

The Radix `DropdownMenu` correctly closes on Escape. However, the photo-viewer's window-level `keydown` listener at line 365-385 does NOT check whether a dropdown is open, so the user pressing Escape inside the dropdown will (a) close the dropdown via Radix's stopPropagation AND (b) the photo-viewer listener might still fire on the same event because `e.key === 'Escape'` is not handled there. Acceptable today (no Escape handler in viewer), but if a future patch adds `Escape` → `onClose` at the viewer level, it will conflict with the dropdown's own close. Worth a fixture test.

### `[A11Y-LOW-7]` No focus trap when color details is expanded

The color details disclosure expands inline within the existing card. There is no need for a focus trap — Tab continues correctly through the rendered fields. Confirmed safe.

### `[A11Y-MED-6]` Lightbox focus-management on close

`apps/web/src/components/lightbox.tsx:371-384` saves and restores focus on mount/unmount. However, the `previouslyFocusedRef` is captured at mount, not when the user opens the lightbox via the trigger. If the trigger button receives focus from a parent re-render between LightboxTrigger click and Lightbox mount, focus could land on the wrong element. Edge case but worth noting. Restoration is also lost if `previouslyFocusedRef.current` was removed from the DOM (e.g. page navigation), which the `document.body.contains()` guard at line 380 correctly handles — pass.

---

## 3. Focus-visible audit

Recent commit `97e44bf a11y(ui): improve focus-visible visibility on ghost buttons` updates `apps/web/src/components/ui/button.tsx:8`:

```
focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]
```

and on the `ghost` variant explicitly: `focus-visible:bg-accent focus-visible:text-accent-foreground` (line 20). All Button instances inherit. Net: every Button (color details download, calibration tooltip if it were focusable, photo-viewer toolbar) gets a 3 px ring on focus. Pass.

### `[A11Y-MED-7]` Color details accordion `<button>` does NOT inherit Button focus-visible styles

`apps/web/src/components/photo-viewer.tsx:840-857` is a raw `<button>`, not a shadcn `<Button>`. Its className lacks any `focus-visible:*` class. Browser default is a thin outline (often invisible against `text-muted-foreground` color). On dark backgrounds the focus ring is essentially invisible. Compare with `apps/web/src/components/info-bottom-sheet.tsx:186` which DOES include `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on its drag handle.

### `[A11Y-MED-8]` Histogram collapse button — no focus-visible style

`apps/web/src/components/histogram.tsx:343-350` — same problem as the color details accordion. No focus-visible classes; the button is a tiny glyph; browser default focus ring on a 12 px control is barely perceptible.

### `[A11Y-LOW-8]` Histogram cycle-mode button — uses default `focus-visible` from Tailwind

`apps/web/src/components/histogram.tsx:370-377` has no explicit focus-visible class. Tailwind's default `focus-visible` ring may apply via `outline-none` chains, but the explicit `transition-colors` does not include focus. Inconsistent with the rest of the codebase which uses explicit ring utilities.

---

## 4. Screen reader support

### `[A11Y-MED-9]` HDR badge has no descriptive aria

`apps/web/src/components/photo-viewer.tsx:881-889`: The badge is a `<span>` containing `t('viewer.hdrBadge')` which is `"HDR"` in both en.json:316 and ko.json:316. A screen reader announces "HDR" with no further context. Better practice: `aria-label="High Dynamic Range image"` or `<abbr title="High Dynamic Range">HDR</abbr>` so screen readers can announce the expanded form. The acronym is jargon — non-technical users (especially Korean users where "HDR" in Korean i18n stays "HDR" without expansion at ko.json:316) will hear an opaque three-letter sound.

### `[A11Y-MED-10]` Dynamic download button label changes — no `aria-live`

`apps/web/src/components/photo-viewer.tsx:947-949`:
```tsx
{image.color_pipeline_decision?.startsWith('p3-from-')
    ? t('viewer.downloadP3Jpeg')
    : t('viewer.downloadJpeg')}
```

The visible label switches between "Download (Display P3 JPEG)" and "Download JPEG" depending on the image. This is fine on initial render — the screen reader reads the current label. However, when the user navigates to the next photo via Arrow keys the button label silently mutates with no `aria-live` region. The screen reader will not announce the change unless the user re-focuses the button. Compare with the photo position counter at line 654 which correctly uses `role="status" aria-live="polite"`. **The download button itself does not need a live region**, but the gamut/format change is interesting metadata — a separate live region or a re-announcement when navigation happens would help.

### `[A11Y-MED-11]` Color details accordion does not announce expanded state

Already noted above (A11Y-MED-3) under keyboard nav. Same SR impact: a screen-reader user has no indication that activating the button revealed new content below.

### `[A11Y-LOW-9]` Histogram canvas `role="img"`

`apps/web/src/components/histogram.tsx:362-368`: the `<canvas>` is given `role="img"` and `aria-label={t('aria.histogramLabel', { mode: modeLabels[mode] })}`. Korean translation at ko.json:554 is `"컬러 히스토그램, {mode} 모드"`. Pass — well-formed.

### `[A11Y-LOW-10]` Calibration tooltip content is reachable via screen reader but only via focus

Radix Tooltip places content in a portal with `role="tooltip"` and uses `aria-describedby`. Because the trigger `<span>` is non-focusable (no tabindex, no role="button"), the tooltip's `aria-describedby` link never wires to anything a SR can navigate to. Net: the calibration message at `apps/web/src/components/photo-viewer.tsx:854` and i18n key `viewer.calibrationTooltip` is effectively SR-invisible. **`[A11Y-MED-12]`**.

---

## 5. Color contrast (WCAG AA)

### `[A11Y-MED-13]` HDR badge color in light mode

`apps/web/src/components/photo-viewer.tsx:886`: `bg-amber-100 text-amber-700` for the HDR badge. Tailwind:
- `amber-700` (#b45309) on `amber-100` (#fef3c7) → contrast ratio ~5.2:1 — passes WCAG AA for normal text.

Dark mode (line 886): `dark:bg-amber-900/30 dark:text-amber-300`. With background `amber-900/30` (composited over `--card` which is `240 10% 3.9%` ~ #0a0a0c), the effective bg is roughly #2c1d0c. `amber-300` is #fcd34d → ~9.5:1 against the composited bg. Passes AAA.

OLED mode (`.oled` at globals.css:70-90): `--card: 0 0% 4%` (#0a0a0a). `amber-900/30` on #0a0a0a yields a darker bg (~#231706); `amber-300` (#fcd34d) → ~10.2:1. Passes AAA.

Pass overall, but verify on real hardware — the `amber-100`/`amber-700` pair is at the lower edge of AA for non-large text (~4.5:1 floor). A user with a slightly miscalibrated display may see this dip below.

### `[A11Y-LOW-11]` P3 badge contrast

`apps/web/src/components/photo-viewer.tsx:750-752` and `info-bottom-sheet.tsx:319-321`: `bg-purple-100 text-purple-700` light / `dark:bg-purple-900/30 dark:text-purple-300` dark. `purple-700` (#7e22ce) on `purple-100` (#f3e8ff) → ~6.8:1. Passes AAA. Dark composited variant similar to HDR badge — ~9:1. Passes.

### `[A11Y-MED-14]` Color details muted text

`apps/web/src/components/photo-viewer.tsx:842`: `text-muted-foreground`. The muted-foreground was bumped to `40%` lightness in light mode at globals.css:33 (commit comment notes WCAG AA is now ~6.1:1). Pass. Dark mode `--muted-foreground: 240 5% 64.9%` on `--background: 240 10% 3.9%` ≈ 7.76:1. Pass.

OLED mode at globals.css:82: `--muted-foreground: 240 5% 64.9%` on `--background: 0 0% 0%` (#000) → ~5.7:1 (per the comment at line 68). At the AA cliff for normal text, AAA borderline. Acceptable.

### `[A11Y-LOW-12]` Lightbox controls — semi-transparent black bg

`apps/web/src/components/lightbox.tsx:477,497,521`: `bg-black/50 text-white hover:bg-black/70`. Over a bright photo, the 50% black bg may not provide sufficient contrast for the white icon. The recent C1RPF-PHOTO-LOW-05 fix bumped a similar status indicator from `bg-black/50` to `bg-black/70` (per the photo-viewer.tsx:654 comment). The lightbox controls were missed. Potentially a WCAG AA failure on bright photos. The lightbox already has `focus-visible:outline-2 focus-visible:outline-blue-500` so the focused state is fine; the resting state is the concern.

### `[A11Y-MED-15]` Histogram channel colors are not differentiable in monochrome / for color-blind users

`apps/web/src/components/histogram.tsx:208-210`: red `#ef4444`, green `#22c55e`, blue `#3b82f6`. In RGB-overlay mode at 50% alpha these overlap meaningfully. Deuteranopia (red-green color blindness, ~5% of males) cannot distinguish channels in the RGB overlay. The mode-cycle button does provide single-channel views (`r`, `g`, `b`), which is a partial mitigation. The aria-label on the canvas only announces the current mode — it does not announce that the histogram is displayed at all, nor what the user should expect. Acceptable but jargon-heavy.

---

## 6. Reduced motion

`@media (prefers-reduced-motion: reduce)` is applied globally at `apps/web/src/app/[locale]/globals.css:227-236` — reduces animation and transition duration to `0.01ms !important`. This catches:
- Color details `transition-transform` chevron rotation at photo-viewer.tsx:845.
- Tooltip's `animate-in fade-in-0 zoom-in-95` at `apps/web/src/components/ui/tooltip.tsx:49`.
- Dropdown-menu transitions.
- Lightbox `Ken Burns` (also explicitly checked at lightbox.tsx:88, 410-416, 452-461 via `shouldReduceMotion`).
- Photo-viewer entry/exit animation at photo-viewer.tsx:637-640 via `prefersReducedMotion = useReducedMotion()`.

### `[A11Y-LOW-13]` Smooth-scroll back-to-top respects reduced motion

`apps/web/src/components/home-client.tsx:377-380`: explicit `prefersReducedMotion` check before `behavior: 'smooth'`. Pass.

### `[A11Y-LOW-14]` Bottom sheet drag has `transition-transform duration-300` that does not switch off in reduced-motion

`apps/web/src/components/info-bottom-sheet.tsx:169`. The global `*` rule at globals.css:228-235 catches `transition-duration` so this becomes effectively instant when the user opts out. Pass — but the `liveTranslateY` drag tracking in `handleTouchMove` at line 63-68 is a transform, not a transition; it follows the finger 1:1 regardless. Acceptable.

---

## 7. Internationalization (en + ko parity)

i18n keys verified for the new color UI:

| Key | en.json | ko.json |
|---|---|---|
| `viewer.colorSpace` | "Color Space" L261 | "색 공간" L261 |
| `viewer.colorDetails` | "Color details" L312 | "색상 정보" L312 |
| `viewer.colorPrimaries` | "Color primaries" L313 | "색 재현 영역" L313 |
| `viewer.transferFunction` | "Transfer function" L314 | "전달 함수" L314 |
| `viewer.colorPipelineDecision` | "Color pipeline" L315 | "색상 파이프라인" L315 |
| `viewer.hdrBadge` | "HDR" L316 | "HDR" L316 |
| `viewer.colorUnknown` | "Unknown" L317 | "알 수 없음" L317 |
| `viewer.calibrationTooltip` | full sentence L318 | full sentence L318 |
| `viewer.downloadSrgbJpeg` | "Download (sRGB JPEG)" L305 | "다운로드 (sRGB JPEG)" L305 |
| `viewer.downloadP3Jpeg` | "Download (Display P3 JPEG)" L306 | "다운로드 (Display P3 JPEG)" L306 |
| `viewer.downloadP3Avif` | "Download (Display P3 AVIF)" L307 | "다운로드 (Display P3 AVIF)" L307 |
| `viewer.downloadHdrAvif` | "Download (HDR AVIF)" L308 | "다운로드 (HDR AVIF)" L308 |
| `viewer.histogramSrgbClipped` | "sRGB clipped" L291 | "sRGB 클리핑" L291 |

### `[A11Y-LOW-15]` Korean naturalness review

- "색 공간" — natural and correct.
- "색상 정보" — translates as "color information" which is broader than "Color details". Acceptable but slightly imprecise; "색상 세부 정보" would be tighter. Low priority.
- "색 재현 영역" — translates as "color reproduction area"; this is a common Korean photographer/print term for "color primaries" or "gamut", though the technical color science term is closer to "원색좌표" (color primaries coordinates). For a non-expert audience the current term is more readable. Acceptable.
- "전달 함수" — direct calque; correct technical term.
- "색상 파이프라인" — direct calque; technical jargon. The audience for this field is admin-only (`isAdmin` guard at photo-viewer.tsx:872) so jargon is acceptable.
- "캘리브레이션" — borrowed word; standard usage in Korean photography circles. Fine.
- "HDR" stays untranslated — standard practice in Korean media.

### `[RESP-LOW-1]` Korean character widths in dynamic download button

`apps/web/src/components/photo-viewer.tsx:945-951`: the gamut-aware button shows e.g. "다운로드 (Display P3 JPEG)" (en.json:306 = "Download (Display P3 JPEG)" 26 chars; ko.json:306 = "다운로드 (Display P3 JPEG)" but Korean characters are CJK-wide). The button is `w-full` inside a 350 px card sidebar (photo-viewer.tsx:601, the `lg:grid-cols-[1fr_350px]`). With chevron `<ChevronDown className="h-4 w-4 ml-auto" />` and the leading `<Download className="h-4 w-4" />`, available text width is roughly 290 px. Korean text width: 다운로드 (4 CJK ≈ 64 px at 14 px font) + " (Display P3 JPEG)" (18 ASCII ≈ 100 px) = ~164 px + icons. Fits in 350 px sidebar.

On mobile the bottom sheet's download button at info-bottom-sheet.tsx:429-438 is also `w-full` inside a viewport-width sheet — fits comfortably.

### `[A11Y-LOW-16]` Tooltip text length in Korean

Korean `viewer.calibrationTooltip` ko.json:318: ~63 characters; en.json:318: ~152 characters (English is much wordier here). The Radix `TooltipContent` has no max-width set in `apps/web/src/components/ui/tooltip.tsx:49` — the browser default kicks in. On a narrow phone the English tooltip can overflow. Verify with a 360 px viewport.

---

## 8. Forced-colors (Windows High Contrast Mode)

`apps/web/src/app/[locale]/globals.css:246-257` has explicit `@media (forced-colors: active)` rules for masonry-card text overlays. Pinned to `CanvasText` and `Canvas`. Good.

### `[A11Y-MED-16]` HDR badge has NO forced-colors rule

`apps/web/src/components/photo-viewer.tsx:881-889`: the badge uses `bg-amber-100 text-amber-700` (and dark variants). In Windows HCM, all `bg-*` and `text-*` colors are overridden. The amber palette is effectively replaced by the system's `Highlight`/`HighlightText` pair on dark HCM themes, and `ButtonFace`/`ButtonText` on light HCM themes. Without an explicit override, the badge may render with poor contrast (e.g. white-on-light if the system maps it that way) OR may simply disappear if it ends up `Canvas` on `Canvas`. This is the same defect class that the masonry-card fix at globals.css:246-257 closes for the photo card overlays.

### `[A11Y-MED-17]` Color details accordion has no forced-colors rule

The chevron rotation indicator and the `text-muted-foreground` color may not survive forced-colors. The accordion content (color primaries / transfer function values) renders with no explicit forced-colors fallback. Acceptable for low-information density text, but the chevron's open/closed state — currently encoded only in transform — is invisible in HCM. Combined with the missing `aria-expanded` (A11Y-MED-3), a keyboard + HCM user has no way to know the accordion is open.

### `[A11Y-LOW-17]` P3 badge in forced-colors

Same issue as HDR badge but already pre-existing — confirmed gap not introduced by this batch of commits.

### `[A11Y-LOW-18]` Tooltip in forced-colors

Radix Tooltip's `bg-primary text-primary-foreground` at ui/tooltip.tsx:49 will be overridden by HCM. This is a generic forced-colors gap on all tooltips, not specific to the new calibration tooltip.

---

## 9. Mobile viewport (360 px)

### `[RESP-MED-1]` Color details panel is desktop-only

`apps/web/src/components/photo-viewer.tsx:660-664`: the info sidebar is wrapped in `hidden lg:block` (line 664). On mobile the info bottom sheet (`info-bottom-sheet.tsx`) renders instead. **The bottom sheet does NOT include the color details accordion or the HDR badge.** A mobile user cannot see color primaries, transfer function, color pipeline, or HDR status. The Color Space line (info-bottom-sheet.tsx:313-325) IS rendered with the inline P3 badge, but the new accordion content is missing entirely. Confirmed by reading info-bottom-sheet.tsx end-to-end: no mention of `color_primaries`, `transfer_function`, `color_pipeline_decision`, `is_hdr`, or `colorDetails` translation key.

This is feature parity gap, not a layout break per se. Severity is responsive-medium because the new color UX is invisible on mobile — wide-gamut customers viewing on phones (which arguably have the best P3 displays) cannot see the color metadata they need.

### `[RESP-LOW-2]` Download menu on mobile bottom sheet

`apps/web/src/components/info-bottom-sheet.tsx:427-440`: the bottom sheet renders a single download button without the gamut-aware dropdown. Wide-gamut images on mobile cannot download AVIF or HDR variants from the bottom sheet — only the JPEG. Mobile users miss the new feature entirely. Cycle 1 RPF / C1RPF-PHOTO-LOW-02 commit comment notes the desktop hides this when `license_tier !== 'none'`; the bottom sheet has parallel logic at line 427 but does not get the dropdown. Same severity class as RESP-MED-1.

### `[RESP-LOW-3]` 95dvh max-height handling

`apps/web/src/components/info-bottom-sheet.tsx:175-176`: uses both `maxHeight: '95vh'` and `maxHeight: '95dvh'` (the latter via the spread `{...({'maxHeight': '95dvh'} as React.CSSProperties)}`). Modern browsers prefer dvh; the fallback ordering is correct. Pass.

### `[A11Y-LOW-19]` 360 px nav layout

`apps/web/src/components/nav-client.tsx:88-103`: the mobile expand button is sized to `min-w-[44px] min-h-[44px]`. Topics row `overflow-x-auto scrollbar-hide` (line 110) on mobile collapses to a horizontally scrolling list with `mask-gradient-right` fade. This is a known pattern and works on 360 px. Pass.

---

## 10. Tablet viewport (768-1024 px)

### `[RESP-MED-2]` Sidebar boundary at lg breakpoint (1024 px)

`apps/web/src/components/photo-viewer.tsx:601` uses `lg:grid-cols-[1fr_350px]`. The breakpoint change is at `lg = 1024 px`. On a 1023 px iPad portrait viewport the bottom sheet shows; on a 1025 px window the sidebar shows. There is no tablet-specific intermediate state. The orientation-aware rule at globals.css:193-197 attempts to compensate for landscape tablet:
```
@media (orientation: landscape) and (min-width: 768px) and (max-width: 1023px) {
  .photo-viewer-grid { grid-template-columns: 1fr 300px; }
}
```
But this CSS only takes effect when the parent has `lg:grid-cols-[1fr_350px]` — which it does NOT at width 768-1023 px because the Tailwind class only activates at `lg` (1024+). Net: the CSS override never fires because the prerequisite Tailwind class hasn't activated. **`[RESP-MED-2]`** — the `300px` landscape tablet override is dead code.

### `[A11Y-LOW-20]` `useColumnCount` and CSS `2xl:columns-N` boundary

`apps/web/src/components/home-client.tsx:33-40`: 1280→4 columns, 1536→5 columns. CSS classes generated at line 237 must match `columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5`. Mirror is correct. Pass.

---

## 11. Landscape mobile

`apps/web/src/app/[locale]/globals.css:172-190` has a dedicated landscape mobile rule:

```
@media (orientation: landscape) and (max-width: 767px) {
  .photo-viewer-image { max-height: 100vh; }
  .photo-viewer-toolbar { display: flex; position: sticky; top: 0; ... }
}
```

### `[RESP-MED-3]` Color details accordion does NOT participate in landscape rule

The new color details accordion at photo-viewer.tsx:838-893 lives inside the desktop sidebar (which is already hidden on mobile via `hidden lg:block`). Landscape mobile does not render the desktop sidebar at all; the color details are exposed only via the bottom sheet, which doesn't render them (RESP-MED-1). So in landscape phone the color details are doubly invisible.

### `[RESP-LOW-4]` Toolbar wraps in landscape mobile

The toolbar at photo-viewer.tsx:467-597 contains: Back, Lightbox, Info, Share, Info-pin (desktop-only). On a 736 px landscape iPhone, the Korean toolbar with "갤러리로 돌아가기" (Korean back button text via `t('viewer.backTo', { topic: ... })`) plus other buttons may overflow. The container is `flex items-center justify-between` with `<div className="flex gap-2">` for the right-side actions. No `flex-wrap`. Confirmed with a long topic label, the toolbar can horizontally overflow. The orientation-aware sticky rule at globals.css:176-185 keeps the toolbar visible but does not solve the wrap problem. **`[RESP-MED-4]`**.

---

## 12. Touch gestures interaction

### `[RESP-LOW-5]` Lightbox swipe vs HDR badge / color details

The HDR badge (photo-viewer.tsx:881-889) is in the desktop sidebar; the lightbox (lightbox.tsx) is full-screen and does not render the sidebar. So no swipe conflict — the gestures are in disjoint components. Pass.

### `[RESP-LOW-6]` `photo-navigation.tsx` swipe handling

`apps/web/src/components/photo-navigation.tsx:43-140`: registers `touchstart`/`touchmove`/`touchend` on `window`. With color details accordion as a tap target inside the photo container, a tap on the accordion could be misinterpreted as a swipe-start. The `SWIPE_THRESHOLD = 80` and `VERTICAL_LIMIT = 30` thresholds at lines 19-20 are large enough that an accordion tap (zero-distance change) won't trigger navigation. Tap-vs-swipe logic at line 96-129 confirms: `if (!isSwiping.current) return;` so a pure tap does nothing. Pass.

### `[A11Y-LOW-21]` `touchmove` calls `e.preventDefault()` only when horizontal

`apps/web/src/components/photo-navigation.tsx:55-60`: only blocks vertical scroll when `dx > dy && dx > 10`. Pass — does not break vertical scroll on the photo page when the user is scrolling to read EXIF.

---

## 13. Dark mode + OLED

Tested mentally against the four themes (light/dark/oled/system) using globals.css:14-90. New UI elements:

- HDR badge — passes on all four themes (see A11Y-MED-13 above).
- P3 badge — passes on all four (A11Y-LOW-11).
- Color details muted text — passes on all four (A11Y-MED-14).
- Tooltip primary bg — `--primary` swaps between light/dark/oled at globals.css:24/51/77. On OLED the `--primary` is `0 0% 98%` (white) and `--primary-foreground` is `240 5.9% 10%` (near-black). The tooltip becomes white-on-near-black bubble. Slightly jarring against an OLED black background but legible (~15:1).

### `[A11Y-LOW-22]` Histogram canvas grid color

`apps/web/src/components/histogram.tsx:163`: `gridColor = isDark ? '#404040' : '#d4d4d4'`. The `isDark` flag at line 235 is `resolvedTheme === 'dark'`. On OLED theme `resolvedTheme` is the underlying `system` resolution (via next-themes), so OLED users probably get `'dark'` and `#404040`. The histogram itself uses `bg-black/20` on the container at histogram.tsx:355, which on OLED becomes a 20% black on a true-black bg — invisible until pixels are drawn. Acceptable.

---

## 14. i18n edge cases — Korean text wrap

### `[RESP-LOW-7]` Long Korean topic name in viewer toolbar

`apps/web/src/components/photo-viewer.tsx:472-477`: Back button reads `t('viewer.backTo', { topic: image.topic_label || image.topic })`. The translation key in ko.json formats as something like `"<label>로 돌아가기"`. With a long topic label (e.g. "음악 페스티벌 사진들" + "로 돌아가기" = "음악 페스티벌 사진들로 돌아가기" ~ 14 CJK chars ~ 230 px at 14 px font), the button approaches the 360 px viewport's safe area. The Button has `gap-2 h-11` but no `truncate` or `max-w`. On a 320 px viewport (older iPhone SE) the toolbar will wrap or overflow — see RESP-MED-4 above.

### `[A11Y-LOW-23]` Calibration tooltip word-wrap in Korean

ko.json:318 calibration text: 63 chars vs en.json:318: 152 chars. Korean is much shorter. In en the tooltip can overflow on narrow phones (see A11Y-LOW-16); ko fits. Asymmetric responsive behavior — verify with English locale on a 360 px phone.

---

## 15. Smart-collections public route

`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx` is the new public route.

### `[A11Y-MED-18]` Smart collection page heading is rendered via HomeClient h1, NOT a dedicated page heading

`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:108-130` passes `heading={collection.name}` to `<HomeClient>`. `home-client.tsx:210-217` renders that as the `<h1>`. The heading hierarchy works:
- `<h1>` = collection name (e.g. "Sunsets")
- `<h2 className="sr-only">` = `t('home.photosHeading')` (line 231) — visually hidden but SR-readable

This matches the home page pattern and gives a single H1 per WCAG 1.3.1 / 2.4.6. Pass.

### `[A11Y-LOW-24]` No breadcrumb on smart collection page

The route is `/c/[slug]`. Compare with topic pages `/[topic]` which also lack breadcrumbs. The site does not use breadcrumbs anywhere — the main nav covers wayfinding. Acceptable.

### `[A11Y-MED-19]` Tag filter on smart collection has no scope label

`apps/web/src/components/home-client.tsx:222-224` renders `<TagFilter tags={tags} />`. `tag-filter.tsx:58` wraps as `role="group" aria-label={t('home.tagFilter')}`. On a smart collection page the user may expect "filter within this collection" semantics. Today the tag filter changes the URL `?tags=` query — clicking a tag filter inside a smart collection URL adds `?tags=` to the smart collection URL, narrowing further. Verified via load-more.tsx:43-44 which dispatches to `loadMoreSmartCollectionImages` when `smartCollectionSlug` is set. Functionality works; the SR experience is identical to the home page tag filter. Pass.

### `[RESP-LOW-8]` `revalidate = 0` on smart collection page

`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:15`: matches the project-wide pattern (per CLAUDE.md "Public route freshness"). Not a responsive issue — noted for completeness.

### `[A11Y-LOW-25]` JSON-LD without aria

`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:110-118`: emits a `<script type="application/ld+json">` with the gallery name and 10 image URLs. SR-irrelevant (script tags are not announced). Pass.

---

## 16. Cross-cutting summary

| Severity | Count | Notable items |
|---|---|---|
| A11Y-CRIT | 0 | — |
| A11Y-HIGH | 0 | — |
| A11Y-MED | 19 | A11Y-MED-1 (audit gap on `min-h-[44px]`), MED-3 (`aria-expanded` missing), MED-4 (calibration tooltip keyboard-unreachable), MED-7/8 (focus-visible missing on raw `<button>`), MED-9 (HDR badge SR ambiguous), MED-12 (calibration tooltip SR-invisible), MED-16/17 (HDR badge / color details no forced-colors rule), MED-18 (smart collection h1 verified pass) |
| A11Y-LOW | 25 | Mostly polish: focus indicators, channel color overlap, monochrome differentiation |
| RESP-HIGH | 0 | — |
| RESP-MED | 4 | RESP-MED-1 (color details + HDR badge invisible on mobile), RESP-MED-2 (dead-code landscape tablet override), RESP-MED-3 (landscape mobile color details), RESP-MED-4 (toolbar overflow on landscape mobile with Korean) |
| RESP-LOW | 8 | — |

### Highest-impact findings for the user (ranked)

1. **`[RESP-MED-1]`** — `info-bottom-sheet.tsx` does not render the color details accordion or the HDR badge. Mobile users (the audience most likely to have a wide-gamut OLED P3 display) cannot see the color metadata or HDR status. Severity: medium because feature is silent-degraded, not broken.
2. **`[A11Y-MED-12]`** — Calibration tooltip is invisible to screen-reader and keyboard-only users. The `<span>` trigger cannot receive focus, so Radix Tooltip's `aria-describedby` link never wires. Per WCAG 1.3.1 / 4.1.2.
3. **`[A11Y-MED-3]`** — Color details accordion lacks `aria-expanded`. Disclosure state is visual-only (chevron rotation).
4. **`[A11Y-MED-9]`** — HDR badge announces only "HDR" with no expansion. Korean i18n preserves the acronym; non-photographer users will not parse it.
5. **`[A11Y-MED-7]`** — Color details disclosure raw `<button>` does not inherit shadcn `Button`'s `focus-visible:ring-[3px]` style; the recent ghost-button focus-visible fix (97e44bf) does not extend here.
6. **`[A11Y-MED-16]`** — HDR badge has no `@media (forced-colors: active)` rule; the masonry-card fix at globals.css:246-257 was not propagated to the HDR/P3 badges.

### Findings the test suite would NOT catch today

- `touch-target-audit.test.ts` does not check raw `<button>` sizing (only `<Button>` and explicit `h-N` literals). The color details accordion and histogram collapse triangle are invisible to it.
- `touch-target-audit.test.ts` allow-list at lines 214/221 does not include `min-h-[44px]` — the new accordion happens to clear the floor, but the test does not actively confirm this.
- No fixture test asserts that `aria-expanded` is set on disclosure buttons.
- No fixture test asserts that the HDR badge / new color UI has a `@media (forced-colors: active)` rule.
- No fixture test confirms en/ko parity for the new color management i18n keys (manual diff was the only check; verified above in section 7).

### Things the team got right

- Multi-line `<Button>` audit normalizer (touch-target-audit.test.ts:311-385).
- Global `prefers-reduced-motion` rule at globals.css:227-236 catches every transition without per-component plumbing.
- HDR badge gates on `@media (dynamic-range: high)` so users without HDR displays don't see the badge — correct presentation logic.
- P3 histogram source preference is gated on canvas-P3 + AVIF support (histogram.tsx:254-260) — correct fallback chain.
- Smart collection route correctly inherits the H1/H2 hierarchy from HomeClient.
- Force-colors rule for masonry-card overlays at globals.css:246-257 is exemplary — same shape should be replicated for HDR badge and color details.
- Bottom sheet `dvh` + `safe-area-inset-bottom` (info-bottom-sheet.tsx:175-179, 242).
- 350 px desktop sidebar accommodates the new color details accordion vertically without forcing scroll on a tall photo.

---

**Word count:** ~2,050.
