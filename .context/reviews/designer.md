# Designer Review — Cycle 15

**Reviewer:** Designer (UI/UX + Accessibility)
**Date:** 2026-06-27
**Scope:** Static TSX/ARIA analysis of `apps/web/src/components/` and `apps/web/src/app/[locale]/` route UIs. Focus: WCAG 2.2, keyboard/focus management, reduced motion, icon semantics, `focus-visible` consistency, i18n parity, form UX.

---

## Findings

### HIGH — LightboxColorPip excluded from `controlVisibilityProps` (WCAG 4.1.2, 2.1.1)

**File:** `apps/web/src/components/lightbox.tsx` line 654

`lightbox.tsx` defines `controlVisibilityProps` at line 368:

```ts
const controlVisibilityProps = controlsVisible
  ? {}
  : { tabIndex: -1, 'aria-hidden': true as const };
```

This is spread onto all five overlay interactive elements: close (~549), fullscreen (~569), slideshow (~593), prev (~616), next (~636). However `<LightboxColorPip>` at line 654 does **not** receive `...controlVisibilityProps`:

```tsx
<LightboxColorPip
    image={image}
    t={t}
    open={colorPipOpen}
    onToggle={() => setColorPipOpen(prev => !prev)}
    imageSizes={imageSizes}
    cycleModeRef={colorPipCycleModeRef}
    isAdmin={isAdmin}
    forceSrgbDerivatives={forceSrgbDerivatives}
/>
```

`LightboxColorPip` renders interactive toggle and cycle buttons. When `controlsVisible` is `false` (controls faded to `opacity: 0` via the CSS transition on the overlay `div` at line 542), the pip's buttons retain their default `tabIndex` and have no `aria-hidden` on the subtree. A keyboard user Tabbing through the lightbox lands on invisible, unannounced controls. This is a real keyboard trap in the hidden state.

**Fix:** Either pass `controlVisibilityProps` as a prop into `LightboxColorPip` and apply it to the outermost interactive element, or add a forwarded `inert` / `aria-hidden` + `tabIndex` guard to the pip's container div driven by the same `controlsVisible` value.

---

### MED — `focus:ring-2` on Dialog and Sheet close buttons affects all overlays (WCAG 2.4.7 consistency)

**Files:**
- `apps/web/src/components/ui/dialog.tsx` line 82
- `apps/web/src/components/ui/sheet.tsx` line 84

Both shared primitives style their close `<button>` elements with bare `focus:ring-2`:

```
focus:ring-ring ... focus:ring-2 focus:ring-offset-2 focus:outline-hidden
```

Every other interactive element in the codebase uses `focus-visible:ring-2`. The bare `focus:` pseudo-class fires on **mouse click** as well as keyboard focus — clicking to dismiss any dialog or sheet produces a focus-ring flash before the overlay closes. This is visually inconsistent and unexpected for pointer users.

Because these are shared primitives, this affects every overlay in the application: image edit dialog, bulk-delete confirm, tag/group share dialog, admin create/edit dialogs, database-backup sheet, and so on.

**Fix:** In both files replace `focus:ring-ring focus:ring-2 focus:ring-offset-2 focus:outline-hidden` with `focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden`.

---

### LOW — `focus:ring-2` on two additional non-primitive elements

**Files:**
- `apps/web/src/components/upload-dropzone.tsx` line 370 — native `<select>` for topic assignment
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` line 333 — alias delete `<button>`

Both use `focus:ring-2 focus:ring-ring focus:ring-offset-2` without the `focus-visible:` qualifier, producing ring flashes on mouse click.

**Fix:** Replace `focus:ring-2 focus:ring-ring focus:ring-offset-2` with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` in both elements.

---

### LOW — No `aria-live` region for bottom sheet state transitions

**File:** `apps/web/src/components/info-bottom-sheet.tsx`

The bottom sheet cycles between `collapsed`, `peek`, and `expanded`. Transitions are triggered by swipe gestures, drag handle taps, and Escape. Sighted users see the sheet animate. AT users do not get an announcement when the state changes — the content visible in the viewport changes substantially between peek (title, camera, date only) and expanded (full EXIF, histogram, download), but there is no live-region signal for this change.

Focus correctly moves to `closeButtonRef` on open (via `FocusTrap initialFocus`), but nothing announces whether the sheet is currently collapsed, peeked, or expanded after a gesture.

**Fix:** Add a visually-hidden `aria-live="polite"` region below the drag handle that announces the new state when `sheetState` changes. Example:

```tsx
<div aria-live="polite" className="sr-only">
  {sheetState === 'expanded' ? t('aria.sheetExpanded')
   : sheetState === 'peek' ? t('aria.sheetPeek')
   : t('aria.sheetCollapsed')}
</div>
```

Add keys `aria.sheetExpanded`, `aria.sheetPeek`, `aria.sheetCollapsed` to both `en.json` and `ko.json`.

---

## Confirmed Non-Issues (investigated in cycle 15)

**Lucide React icon `aria-hidden` — handled automatically.** Lucide React v0.562.0 (pinned `^0.562.0`) injects `aria-hidden="true"` on every SVG wrapper when the icon has no children and no a11y props (`aria-*`, `role`, `title`):

```js
// lucide-react/dist/cjs/lucide-react.js
...!children && !hasA11yProp(rest) && { "aria-hidden": "true" },
```

All plain icon usages in the codebase (e.g. `<X className="h-4 w-4" />`, `<Calendar className="w-3 h-3" />`, `<ChevronDown className="h-4 w-4" />`) satisfy both conditions. The explicit `aria-hidden="true"` in `wide-gamut-hint.tsx` line 205 is redundant but harmless. This is not a finding for this cycle.

**i18n key parity — complete.** `en.json` and `ko.json` have identical key sets (verified programmatically). The ICU plural asymmetry (English `{count, plural, one {…} other {…}}`; Korean flat `{count}장`) is intentional per DOC-R5C3-07.

**Tag input combobox ARIA — fully implemented.** `tag-input.tsx` correctly uses `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"`, `role="option"`, and `aria-selected`. IME composition is guarded via `isImeComposingReactEvent`. Remove-tag buttons meet the 44 px touch target floor (`min-h-11 min-w-11`).

**Tag filter chips — correct pattern.** `role="group" aria-label` on the container; `aria-pressed` on each chip button.

**Reduced-motion support — consistent.** `lightbox.tsx` reads `matchMedia('(prefers-reduced-motion: reduce)')` with a change listener. `photo-viewer.tsx` uses Framer Motion `useReducedMotion()`. `home-client.tsx` checks the MQ before scroll restoration. `image-zoom.tsx` checks before pan animation.

**Focus management on lightbox/dialog — correct.** `FocusTrap` (lazy-focus-trap) wraps lightbox, info-bottom-sheet, and admin dialogs. `photo-viewer.tsx` tracks `previouslyFocusedElement` via ref and restores focus on lightbox close. Escape key handlers are wired in both lightbox and bottom sheet.

**Photo navigation live region — correct.** `photo-navigation.tsx` has an `aria-live="polite"` region announcing navigation status; prev/next buttons have `aria-label`.

**Similar photos disclosure — correct.** `similar-photos.tsx` uses `aria-expanded` + `aria-controls`, and has a `role="status" aria-live="polite"` loading state region.

---

## Deferred (pre-existing, not re-reported per cycle-15 scope)

- Position counter `aria-label` on `role="status"` live region (lightbox ~666, photo-viewer ~731) — AT announces text content not `aria-label`.
- Theme toggle state-in-label.
- Bottom sheet `aria-expanded` 3-state representation.
- P3 `sr-only` badge.
- Combobox `aria-expanded` during loading state (search.tsx).
