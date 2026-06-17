# Designer A11y/UX Review — Cycle 11

Reviewer: Designer (oh-my-claudecode:designer)
HEAD: a7de3ebd
Scope: `apps/web/src/components/` + `apps/web/src/app/[locale]/`

---

## Result: ZERO new findings

The frontend a11y/UX surface has converged. No new defects were found that a senior engineer would commit to fixing.

---

## Surface Verified Clean

### Navigation (`nav-client.tsx`)
- Mobile expand toggle: `min-w-[44px] min-h-[44px]` — compliant.
- `aria-expanded` + `aria-controls="primary-nav-topics primary-nav-controls"` — correct pairing.
- `aria-current="page"` on active topic links — correct.
- Theme and locale buttons: `min-w-[44px] min-h-[44px]` — compliant.

### Search dialog (`search.tsx`)
- Trigger button `h-11 w-11` — compliant.
- Dialog has `role="dialog" aria-modal="true" aria-label` — correct.
- `<Input>` has `role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, `aria-expanded`, `aria-activedescendant` — correct ARIA combobox pattern.
- SR-only live region announces result counts and loading state — present.
- Close button `h-11 w-11` — compliant.
- FocusTrap with `initialFocus="#search-input"` and focus returned to trigger on close — correct.
- Known deferred (cycle 10, not re-raised): search `<Input>` at line 374 is `h-8` (full-width text field, excluded from touch-target-audit `<Input>` scope).

### Lightbox (`lightbox.tsx`)
- `role="dialog" aria-modal="true" aria-label` — correct.
- Close, fullscreen, play/pause buttons all `h-11 w-11`; prev/next are full-height edge strips (`h-full w-16`) — compliant.
- `controlVisibilityProps` applies `tabIndex={-1}` and `aria-hidden={true}` when controls hidden — WCAG 4.1.2 compliant.
- `hideControlsRespectingFocus` blurs before hiding so `aria-hidden` never lands on a focused element — correct.
- Slideshow `aria-live="polite"` region for state changes — present.
- Position counter `role="status" aria-live="polite"` — correct.
- FocusTrap active; focus returned to `previouslyFocusedRef` on close — correct.
- `aria-keyshortcuts` on all keyboard-shortcut buttons — present.

### Color pip (`lightbox-color-pip.tsx`)
- Toggle button `min-h-11` — compliant.
- `aria-expanded` on toggle — correct.
- DCI-P3 info tooltip trigger `min-h-11 min-w-11` — compliant.
- Copy button `min-h-11 min-w-11` — compliant.

### Photo viewer (`photo-viewer.tsx`)
- `size="sm"` buttons (Buy, Info, Share) all carry explicit `h-11` override or rely on the `sm` variant floor (`min-h-11`) — compliant.
- `aria-describedby="photo-viewer-shortcuts"` on container — correct.

### Photo navigation (`photo-navigation.tsx`)
- Prev/Next `Button size="icon"` renders `size-11` (44 px square) — compliant.
- `aria-label` on both nav buttons — present.
- SR-only `aria-live="polite"` nav status region — present.

### Tag filter (`tag-filter.tsx`)
- `Badge asChild` wrapping `<button>` with `min-h-11` — compliant.
- `aria-pressed` state on each chip — correct.
- `role="group" aria-label` on container — correct.

### Home client (`home-client.tsx`)
- Masonry card `Link` has `aria-label={t('aria.viewPhoto', { title })}` — correct.
- Hidden `<h2>` between page `<h1>` and per-card `<h3>` — heading hierarchy intact.
- P3 badge `aria-hidden="true"` (decorative) — correct.
- Back-to-top button: `min-h-11 min-w-11`, `aria-hidden` when hidden, `tabIndex={-1}` when hidden — correct.
- Empty state SVG: `aria-hidden="true"` — correct.

### Similar photos (`similar-photos.tsx`)
- Toggle button `min-h-11` — compliant.
- `aria-expanded` + `aria-controls="similar-photos-results"` — correct (MDN-endorsed pattern per cycle-10 prior; not re-raised).
- Loading state `role="status" aria-live="polite"` — present.
- Thumbnail `Link` with `min-h-11` — compliant.

### Admin components
- Admin header logout `Button size="sm"` — `min-h-11` via variant floor — compliant.
- Admin user manager: add `Button size="sm"` and delete `Button size="icon"` — both meet 44 px via variant floors — compliant.
- Image manager: all `size="sm"` and `size="icon"` buttons — compliant via variant floors or explicit overrides.

### `ui/button.tsx` variant floors (source of truth)
- `sm`: `min-h-11` — all bare `size="sm"` buttons are 44 px minimum without needing an override.
- `icon`: `size-11` (44×44 px square).
- `default`: `min-h-11`.
- `lg`: `min-h-12`.

### i18n key parity (`en.json` vs `ko.json`)
- Full structural diff: **no missing or extra keys in either direction**.
- ICU plural asymmetry (Korean fixed-form `{count}장` vs. English `{count, plural, …}`) confirmed intentional — not flagged.

### ARIA roles and patterns
- All `role="combobox"` + `aria-expanded` + `aria-activedescendant` pairings verified consistent.
- `role="dialog" aria-modal="true"` used correctly in lightbox, search, and info bottom sheet.
- `role="status"` / `aria-live="polite"` present on all async state regions (search, lightbox position, slideshow, similar-photos loading, photo navigation).

### Semantic HTML
- Heading hierarchy (`h1` → sr-only `h2` → `h3` per card) on home and topic pages — intact.
- `<nav aria-label>` on main navigation — present.
- `<aside aria-label>` on On This Day widget — present.
- `alt` text: masonry cards use `getConcisePhotoAltText`; lightbox uses same helper; decorative images carry `alt=""` or `aria-hidden="true"` — correct.

---

## Conclusion

Zero new findings at cycle 11. All interactive elements meet the 44 px touch-target floor (enforced at the `ui/button.tsx` variant level for `sm` and `icon` sizes). ARIA patterns, focus management, keyboard navigation, i18n key parity, semantic HTML, and live regions are all correct. The two cycle-10 priors were not re-raised.

---

## Cycle-10 priors NOT re-raised (per orchestrator directive)

- **REJ-C10-01** — `aria-controls` referencing a conditionally-unmounted disclosure region (`similar-photos.tsx:116`, `color-details-section.tsx:290`). This is the MDN-endorsed pattern (MDN `aria-controls`: "only needs to be set when the popup is visible, but it is valid and easier to program to reference an element that is not visible"). Rejected in cycle 10; not a WCAG 4.1.2 failure. NOT re-reported.
- **DEF-C10-01** — search dialog `<Input>` at `search.tsx:374` is 32px tall (`h-8`). Full-width text-entry field, deliberately outside the `touch-target-audit.test.ts` `<Input>`-exclusion scope. Already deferred with exit criteria. NOT re-reported.

Both were verified still in their cycle-10 disposition state at HEAD a7de3ebd; neither is a new finding.
