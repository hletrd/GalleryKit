# Cycle 3 RPF — UI/UX Photographer Review

**Date:** 2026-05-08
**Reviewer perspective:** professional photographer + end-user-workflow.
**Scope:** information architecture, accordion behavior, lightbox color pip, mobile bottom sheet, photographer audit ergonomics.
**Predecessor reviews:** `.context/reviews/photographer-r3/ui-ux-photographer.md`, `.context/reviews/cycle2-rpf-photographer/ui-ux-photographer.md`.

---

## State of the codebase entering cycle 3

The UI/UX photographer-audit surface is mature:

- ColorDetailsSection: rendered in BOTH desktop sidebar AND mobile bottom-sheet (cycle 2). Accordion default-open for non-trivial color sources. `c` keyboard shortcut toggles. ARIA: `aria-expanded`, `aria-controls`, focus-visible, calibration tooltip as sibling button (not nested in accordion button), forced-colors mode rules.
- Histogram: clip indicators (red strips at L:0 and L:255 when bin > 0.5%), grid lines at 0/64/128/192/255, percent labels below threshold. `h` keyboard shortcut cycles modes (luminance/RGB/R/G/B). canvas-P3 runtime probe (cycle-2 P3-6).
- Lightbox: `LightboxColorPip` at bottom-left with primaries · transfer (lines 78-134); click expands a panel showing primaries / transfer / pipeline. `c` shortcut documented in pip's title attribute. Reduce-motion respected. Slideshow / Ken Burns animation conditional on motion preference.
- Wide-gamut hint: rewritten in cycle 2 (`viewer.wideGamutHint`) to attribute the limitation to the visitor's display capability (not victim-blame), in en+ko.
- HDR badge: high-contrast amber gradient (P3-15 cycle 2). Admin-only via privacy field separation. Forced-colors mode rules.
- Mobile bottom sheet: layout reordered for non-trivial color sources (`info-bottom-sheet.tsx:160`); ColorDetailsSection rendered in the sheet for parity with desktop sidebar.
- Touch targets: ≥44 px enforced by `touch-target-audit.test.ts`.
- Force-show color chips: `force_show_color_chips=true` admin opt-in (P3-26) bypasses the `(color-gamut: p3)` MQ gate via `data-force-show-color-chips` attribute on `<html>`.

---

## Findings (cycle 3)

### MED (3)

#### C3-UX-MED-1 — Mobile bottom sheet does NOT receive `colorDetailsToggleRef` / `histogramCycleRef`

**File:** `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/photo-viewer.tsx:127-128, 343-351, 668, 807`.
**Severity:** MED.
**Confidence:** HIGH.

Carry-forward from cycle 2 `C2-UX-MED-2 / C2-ARCH-MED-1` (deferred to plan 41). The keyboard shortcut handler at `photo-viewer.tsx:343-351` calls `colorDetailsToggleRef.current()` and `histogramCycleRef.current()`. Both refs are only wired to the **desktop sidebar** instances:

- `<ColorDetailsSection ... toggleRef={colorDetailsToggleRef} />` at line 668 — rendered inside the DESKTOP SIDEBAR conditional.
- `<Histogram ... cycleModeRef={histogramCycleRef} />` at line 807 — rendered inside the DESKTOP SIDEBAR conditional.

The mobile bottom sheet (`info-bottom-sheet.tsx`) renders its own `ColorDetailsSection` and `Histogram` instances, but does not receive the ref props. So on mobile (or when desktop sidebar is closed and mobile sheet is open), pressing `c` or `h` does NOTHING — the ref `current` is null because the desktop instance is not mounted.

The `i` shortcut at lines 336-342 correctly handles the breakpoint:

```ts
if (e.key === 'i' || e.key === 'I') {
    const isLg = window.matchMedia('(min-width: 1024px)').matches;
    if (isLg) { setIsPinned(prev => !prev); }
    else { setShowBottomSheet(prev => !prev); }
}
```

But `c` and `h` blindly call the ref without breakpoint awareness.

**Photographer impact:** mobile / tablet photographer cannot toggle color details or cycle histogram via keyboard. Bluetooth keyboard on iPad is a real use case.

**Fix shape (architectural symmetry):** options:

- (a) Route the refs through both instances: each `ColorDetailsSection` / `Histogram` writes to a parent-managed ref. The handler then uses whichever ref is currently mounted (the unmounted one is null).
- (b) Hoist the toggle/cycle state to the parent (`PhotoViewer`) and pass both the state and the setter to each instance. Eliminates refs entirely.
- (c) Conditionally render only ONE instance based on breakpoint (consolidate sidebar + sheet into a single component that swaps layout).

Recommendation: **(b)** — hoist state. Removes the ref dance entirely; both instances become controlled. Larger refactor but cleanest.

Cycle 2 deferred this with exit criterion "Implement when next cycle works on the bottom-sheet IA, or when a tablet keyboard regression is reported." Cycle 3 does NOT have a fresh user report; the architectural fix can land here OR continue to defer. **Recommended action: schedule for plan 41 implementation in cycle 3.**

#### C3-UX-MED-2 — Lightbox color pip does NOT show the HDR badge for admin viewers

**File:** `apps/web/src/components/lightbox.tsx:78-134`.
**Severity:** MED.
**Confidence:** HIGH.

`LightboxColorPip` renders primaries · transfer at bottom-left of lightbox. The expanded panel shows primaries / transfer / pipeline. **It does not render the HDR badge**, even when `image.is_hdr === true`.

For an admin photographer demoing an HDR shoot to a client in lightbox mode, the audit pip says `Display P3 · PQ (ST 2084)` (technical) but does NOT show the prominent HDR pill. Photographer expects the badge — it's in the sidebar Color Details section, but the lightbox pip is the demo surface.

**Fix shape:** add HDR badge rendering inside `LightboxColorPip` expanded panel:

```tsx
{image.is_hdr && (
    <div className="flex justify-between gap-3">
        <span className="opacity-70">{t('viewer.hdrBadge')}</span>
        <span className="hdr-badge px-2 py-0.5 text-[10px] font-bold bg-gradient-to-r from-amber-300 to-orange-400 text-white rounded">
            HDR
        </span>
    </div>
)}
```

Note: `image.is_hdr` is admin-only (privacy guard), so the public viewer correctly won't see the HDR row. Admin will.

Also: the collapsed pip ("Display P3 · PQ (ST 2084)") could optionally show a small HDR pill inline:

```tsx
<button>
    {primaries}
    {transfer && <span>· {transfer}</span>}
    {image.is_hdr && <span className="hdr-mini-pill">HDR</span>}
</button>
```

This is a polish item — the expanded panel HDR row is sufficient.

**Photographer impact:** admin demoing HDR in lightbox loses the visual cue.

#### C3-UX-MED-3 — `LightboxColorPip` collapsed-form text mixes English `Display P3` with Korean `전달 함수` in the panel labels

**File:** `apps/web/src/components/lightbox.tsx:103-128`.
**Severity:** MED.
**Confidence:** HIGH.

Same root cause as `C3-COL-MED-1` (humanizers not localized). In the collapsed pip:

```tsx
{primaries ? (
    <span className="font-medium">{primaries}</span>  // "Display P3" / "BT.709" — English from humanizeColorPrimaries
) : (
    <span>{t('viewer.colorUnknown')}</span>           // localized
)}
{transfer && <span className="opacity-80">· {transfer}</span>}  // "PQ (ST 2084)" / "Gamma 2.2" — English
```

Korean photographer sees `Display P3 · PQ (ST 2084)` next to a localized aria-label `색역 정보 표시`. Inconsistent.

The labels themselves (Display P3, PQ) are technical Latinate and could be argued to be universal, but the **pairing** with localized aria text and panel labels produces a mixed-language audit surface.

**Fix shape:** route both `humanizeColorPrimaries` and `humanizeTransferFunction` through `t` callbacks. Add keys:

- `viewer.primariesBt709` → en: "BT.709", ko: "BT.709" (technical)
- `viewer.primariesDisplayP3` → en: "Display P3", ko: "Display P3" (technical)
- `viewer.transferSrgb` → en: "sRGB", ko: "sRGB" (technical)
- `viewer.transferGamma22` → en: "Gamma 2.2", ko: "감마 2.2"
- `viewer.transferPq` → en: "PQ (ST 2084)", ko: "PQ (ST 2084)"
- `viewer.transferHlg` → en: "HLG", ko: "HLG"
- `viewer.transferLinear` → en: "Linear", ko: "리니어"

The Latinate names (BT.709, Display P3, PQ) stay identical across locales, which is correct. Only the descriptive transfer functions (Gamma 2.2 → 감마 2.2, Linear → 리니어) get translated. Eliminates the mixed-language smell.

**Photographer impact:** consistent audit surface in non-English locales.

---

### LOW (3)

#### C3-UX-LOW-1 — Histogram clip-indicator threshold (0.5%) is hardcoded; no admin tunable

**File:** `apps/web/src/components/histogram.tsx:261, 430`.
**Severity:** LOW.
**Confidence:** MEDIUM.

The clip threshold `CLIP_THRESHOLD = 0.005` (0.5%) is hardcoded. Pro tools (Capture One, RawTherapee) let the user toggle the threshold. For high-key portraits the photographer may want 0.1%; for landscape shoots 1%. Today neither is exposed.

**Fix shape:** add `histogram_clip_threshold` admin setting (default 0.005, range 0.001-0.05). Or ship a viewer-side toggle. Plan-38 P3-9 documented this; the implementation shipped with the hardcoded threshold.

**Photographer impact:** photographer cannot tune the clip blink to their preferred sensitivity.

#### C3-UX-LOW-2 — `colorDetailsId` collision between sidebar and bottom-sheet during breakpoint transition

**File:** `apps/web/src/components/color-details-section.tsx:88`.
**Severity:** LOW.
**Confidence:** HIGH.

Carry-forward from cycle 2 `C2-UX-LOW-2`. `colorDetailsId = `color-details-${image.id}` ` is used as both the `id` attribute and the `aria-controls` value. When BOTH desktop sidebar and mobile bottom sheet are mounted simultaneously (breakpoint transition window), the DOM has two elements with the same `id`. ARIA `aria-controls="color-details-123"` resolves to whichever element matches first.

**Photographer impact:** brief assistive-tech inconsistency during resize. Self-corrects when one instance unmounts.

**Fix shape:** parameterize the ID per-context: `color-details-sidebar-${image.id}` vs `color-details-sheet-${image.id}`. Or pass a `idPrefix` prop. Couples to C3-UX-MED-1 (state hoist).

#### C3-UX-LOW-3 — Histogram canvas size fixed at `240x120`; not responsive on small viewports

**File:** `apps/web/src/components/histogram.tsx:408, 416-418`.
**Severity:** LOW.
**Confidence:** HIGH.

Carry-forward from cycle 2 `C2-UX-LOW-1` / R3-L7. On a 320 px-wide phone with the bottom sheet expanded, the 240×120 canvas takes ~75 % of the available width and pushes other audit elements off-screen.

**Fix shape:** make the canvas responsive: `width="100%"`, set internal raster to `Math.min(viewport - padding, 256)`. Cap at 240 to avoid stretch on tablet.

**Photographer impact:** mobile audit ergonomics. Bounded.

---

### Photographer-axis re-confirmation

| Question | Answer |
|---|---|
| Is the Color Details accordion default-open for wide-gamut/HDR sources? | YES (`isNonTrivialColor` initial state). |
| Is there a `c` keyboard shortcut to toggle? | YES on desktop (sidebar). NO on mobile (sheet) — see C3-UX-MED-1. |
| Is there an `h` shortcut to cycle histogram modes? | YES on desktop. NO on mobile — see C3-UX-MED-1. |
| Does the lightbox have a color metadata pip? | YES (`LightboxColorPip` at bottom-left, `c` shortcut). |
| Does the lightbox pip show HDR? | NO (the panel does not show the HDR badge — see C3-UX-MED-2). |
| Is the wide-gamut hint copy display-attributing (not victim-blame)? | YES (cycle-2 C2-A2). |
| Are touch targets ≥44 px enforced? | YES (`touch-target-audit.test.ts`). |
| Is there an admin opt-in to force-show color chips on non-P3 displays? | YES (`force_show_color_chips`; per-viewer scope, see `C3-COL-LOW-3`). |
| Is the HDR badge admin-only and not visible to public consumers? | YES (privacy field separation; locked by `map-privacy.test.ts`). |
| Is there a histogram clip blink + percent labels? | YES (P3-9 cycle 2). |

**Net:** the UI/UX surface is mature. The 6 cycle-3 findings cluster around (a) bottom-sheet ↔ sidebar architectural symmetry (refs not wired) and (b) localization completeness on the lightbox pip + humanizer helpers.

---

## Convergent findings (this round)

C3-COL-MED-1 / C3-UX-MED-3 are the same locale-coverage concern at two angles (humanizer + lightbox pip). HIGH signal.

---

## Provenance

Cycle-3 RPF UI/UX photographer angle. Single-orchestrator focused pass.
