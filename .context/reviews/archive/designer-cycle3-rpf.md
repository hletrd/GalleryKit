# Designer / UI-UX review — Prompt 1, cycle 3

## Scope & verification
I reviewed the Next.js UI end-to-end with live browser automation against the running app.

### What I checked
- Public home, mobile home, search overlay, photo detail page, lightbox, mobile info sheet, dark mode, Korean locale, reduced-motion emulation
- Admin login and dashboard upload surface
- Key UI files, layouts, shared components, primitives, tests, and locale files

### Browser evidence collected
- Home desktop/mobile screenshots
- Search overlay screenshot
- Photo detail desktop/mobile screenshots
- Lightbox screenshot
- Admin dashboard screenshot
- Live DOM and focus-order checks
- Scroll-lock measurement for modal surfaces

## Findings

| Severity | Confidence | File / region | Issue | Failure scenario | Fix |
|---|---|---|---|---|---|
| Medium | High | `apps/web/src/components/search.tsx:195-203` | The combobox input reports `aria-expanded={results.length > 0}` instead of reflecting whether the search dialog is actually open. In the live browser, the dialog was visible and focused while the input still exposed `aria-expanded="false"`. | Screen-reader users hear a collapsed combobox while a modal search UI is already open, which misstates the control state and can make the search panel harder to understand. | Bind `aria-expanded` to `isOpen` or remove it from the input if the dialog is the real disclosure surface. Keep the active popup semantics aligned with the visible overlay. |
| Medium | High | `apps/web/src/components/info-bottom-sheet.tsx:112-178` | The mobile info sheet traps focus but does not lock page scrolling. Live browser verification showed `window.scrollY` changing from `0` to `113` while the sheet was open. | On mobile, a user opens photo info and then swipes/scrolls the page behind it; the gallery moves underneath the sheet, causing context loss and making the sheet feel only partially modal despite `aria-modal="true"`. | Add body scroll locking while the sheet is open, matching the search/lightbox pattern, and keep backdrop/pointer behavior consistent with the modal semantics. |

## Positive checks / no-issue notes
- Home page, photo page, admin dashboard, and dark mode render cleanly in the browser after the app is loaded correctly.
- Mobile nav expands/collapses cleanly; the visible controls remain 44px class touch targets.
- Search overlay focus restores correctly on close and works across keyboard interaction.
- Lightbox traps focus and prevents background scrolling correctly; Escape restores focus to the trigger.
- Reduced-motion emulation still renders correctly, and the global stylesheet includes a `prefers-reduced-motion: reduce` override.
- Korean locale renders correctly; the repo intentionally ships only LTR locales, and `dir="ltr"` is explicitly set in the root layout.

## Missed-issues sweep
I rechecked the high-risk surfaces a second time before concluding:
- public nav / search / tag filters
- home masonry cards and empty-state behavior
- photo viewer / info sheet / lightbox
- admin login, dashboard, upload form, table actions
- dark mode, Korean locale, and reduced-motion behavior

No additional actionable UI defects were found beyond the two findings above.
