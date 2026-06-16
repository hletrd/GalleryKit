# GalleryKit UI/UX & Accessibility Review — Cycle 2

**Type:** Static-only analysis (no dev server, no browser automation)
**Date:** 2026-06-16
**Cycle:** 2
**HEAD:** 8ccc8806
**Reviewer:** oh-my-claudecode:designer

---

## Summary

The surface is notably mature. Prior RPF cycles have closed almost all the obvious a11y gaps: a working skip-to-main link with `tabIndex={-1}` target, ARIA dialog + focus trap in the lightbox, live-region counters for photo position, `focus-visible` rings on all interactive elements, `prefers-reduced-motion` guards in `framer-motion` and the lightbox Ken Burns / slideshow paths, and a bumped `--muted-foreground` contrast to ~6.1:1 AA. The findings below are genuine residual issues discovered by static analysis, not manufactured ones.

---

## Accessibility (by WCAG 2.2 severity)

### High

**DES-01 — `group-hover:scale-105` image zoom transitions are NOT gated on `motion-safe:` — affects every masonry card, year/timeline, on-this-day widget, and shared-group pages**
- Confidence: High
- Files:
  - `apps/web/src/components/home-client.tsx` lines 355, 370
  - `apps/web/src/components/on-this-day-widget.tsx` line 72
  - `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx` line 190
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx` line 238
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` line 230
- Problem: Every photo card image uses `transition-transform duration-500 group-hover:scale-105` unconditionally. Users who set `prefers-reduced-motion: reduce` still receive the spatial zoom animation on every card hover. The lightbox and `photo-viewer` correctly guard Ken Burns and slide transitions via `shouldReduceMotion` / `useReducedMotion()`, but these Tailwind CSS-only hover animations bypass that runtime check entirely. The only `motion-reduce:` usage found in the codebase is `motion-reduce:animate-none` on a single `animate-pulse` in `similar-photos.tsx`.
- Affected users: Vestibular disorder / motion-sensitive users on pointer devices.
- WCAG: 2.3.3 Animation from Interactions (AAA); also relevant to WCAG 2.1 principle of non-interference.
- Fix: Replace every `group-hover:scale-105` with `motion-safe:group-hover:scale-105` and `transition-transform` with `motion-safe:transition-transform`. The `duration-*` class can remain (it is a no-op when no transition is active). Six files, one-line change each. Alternatively, add a global CSS rule in `globals.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .masonry-card img, .group:hover img { transform: none !important; transition: none !important; }
  }
  ```

**DES-02 — Admin UI close-button default label `"Close"` is hardcoded English — affects Korean locale**
- Confidence: High
- Files: `apps/web/src/components/ui/dialog.tsx` line 53, `apps/web/src/components/ui/sheet.tsx` line 51
- Problem: Both shadcn primitives define `closeLabel = "Close"` as the default prop. Any consuming component that does not explicitly pass a `closeLabel` prop (which is the common usage pattern for shadcn) will render an English "Close" label for the screen-reader button regardless of the active locale. Korean screen-reader users hear "Close" instead of the Korean equivalent throughout all admin dialogs and sheets.
- Affected users: Korean-locale screen-reader users.
- WCAG: 3.1.2 Language of Parts (AA).
- Fix: Thread `useTranslation` (or `getTranslations` for server components) into the primitives, or enforce that every call site passes a translated `closeLabel` by removing the default and making the prop required. The simplest approach is to make the shadcn wrapper accept an optional `closeLabel` and internally fall back to `t('common.close')` via the i18n provider context.

---

### Medium

**DES-03 — Admin login form: no `aria-invalid` / `aria-describedby` wiring for server-side auth errors**
- Confidence: Medium
- File: `apps/web/src/app/[locale]/admin/login-form.tsx` lines 56, 76
- Problem: Both form fields carry `required` (browser-native validation), but there is no `aria-invalid` state set on failed submission and no `aria-describedby` pointing to a server-returned error message. Auth errors are surfaced as Sonner toasts (inferred from the codebase pattern), which are not programmatically associated with the form field that caused the failure. Screen readers announce the toast in a separate live region but leave the field in an apparently valid state.
- WCAG: 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA).
- Fix: On failed login, set `aria-invalid="true"` on the password `<Input>` and wire `aria-describedby` to an error `<p id="login-error">` rendered adjacent to the field. The existing toast can remain as a secondary signal.

**DES-04 — `tag-input.tsx` text field uses `outline-none` with no `focus-visible` replacement ring**
- Confidence: High
- File: `apps/web/src/components/tag-input.tsx` line 199
- Problem: `className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"` — the underlying `<input>` element suppresses the browser outline (`outline-none`) without providing a `focus-visible:ring-*` replacement. Every other interactive element in the codebase (buttons, color pip, histogram controls, bottom sheet handle) applies `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. This input is the primary tag-entry control in the admin upload/edit flow.
- Affected users: Keyboard-only admin users.
- WCAG: 2.4.7 Focus Visible (AA), 2.4.11 Focus Appearance (AA, new in WCAG 2.2).
- Fix: Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the `<input>` className.

**DES-05 — Search modal input is `h-8` (32 px) — below the 44 px touch-target policy**
- Confidence: High
- File: `apps/web/src/components/search.tsx` line 356
- Problem: `className="border-0 p-0 h-8 shadow-none focus-visible:ring-2 ..."` sets the search input inside the modal to 32 px tall. The touch-target audit (`__tests__/touch-target-audit.test.ts`) scans `<Button>` and `<button>` elements but not `<Input>` / shadcn `<Input>` primitives directly, so this slips through the automated gate. On mobile, 32 px is below both the WCAG 2.2 AA minimum (2.5.8, 24 px — barely passes) and the site-wide 44 px policy (WCAG 2.5.5 AAA / Apple HIG / Google MDN).
- Affected users: Mobile / touch users searching photos.
- WCAG: 2.5.8 Target Size Minimum (AA), 2.5.5 (AAA); site policy (CLAUDE.md 44 px minimum).
- Fix: Change `h-8` to `h-11` or `min-h-11`.

**DES-06 — `<main tabIndex={-1} className="... focus:outline-none">` suppresses focus ring for all focus, not just programmatic skip-link focus**
- Confidence: Medium
- File: `apps/web/src/app/[locale]/(public)/layout.tsx` line 12
- Problem: `focus:outline-none` fires for every focus event on the `<main>` element, including any unusual keyboard scenario where focus lands there. The correct fix for skip-link targets is `:focus:not(:focus-visible) { outline: none }` — which suppresses only the mouse/programmatic-click ring while preserving keyboard-visible rings. The current `focus:outline-none` Tailwind class is the standard shadcn pattern for skip targets and is widely accepted in practice, but strictly speaking suppresses `focus-visible` too.
- WCAG: 2.4.7 Focus Visible (AA), 2.4.11 Focus Appearance (AA, WCAG 2.2).
- Fix: Change `focus:outline-none` to `focus-visible:outline-none` for maximum precision, or add a globals.css rule: `#main-content:focus:not(:focus-visible) { outline: none; }`.

**DES-07 — `lightbox-color-pip.tsx` cycle-mode and copy buttons use `ring-1` not `ring-2`**
- Confidence: Medium
- File: `apps/web/src/components/lightbox-color-pip.tsx` lines 186, 268
- Problem: `focus-visible:ring-1 focus-visible:ring-white/50` — a 1 px focus ring on a `bg-black/70` backdrop. The WCAG 2.2 Focus Appearance criterion (2.4.11, AA) requires the focus indicator to have at least a 2 CSS pixel perimeter and a minimum 3:1 contrast ratio between focused and unfocused states. A 1 px ring at 50% opacity white on near-black likely fails the perimeter requirement. The close, fullscreen, and slideshow buttons in the same lightbox use `ring-2` — this is an inconsistency introduced when the color pip was added.
- WCAG: 2.4.11 Focus Appearance (AA, WCAG 2.2).
- Fix: Change to `focus-visible:ring-2 focus-visible:ring-white/70` to match the lightbox toolbar button pattern.

---

### Low

**DES-08 — Year/timeline caption overlay fade uses `transition-opacity` without `motion-safe:`**
- Confidence: Low
- File: `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx` line 195
- Problem: `sm:group-hover:opacity-100 transition-opacity duration-300` on the caption gradient. Opacity fades are generally not vestibular triggers and WCAG 2.3.3 is AAA, so this is low priority. However since DES-01 touches the same files, wrapping both in `motion-safe:` at the same time adds zero cost.
- Fix: `motion-safe:transition-opacity motion-safe:sm:group-hover:opacity-100` (or rely on the same global CSS block as DES-01).

**DES-09 — Mobile nav: focus may not return to the hamburger trigger when the menu closes**
- Confidence: Low
- File: `apps/web/src/components/nav-client.tsx`
- Problem: The mobile nav uses `aria-expanded` and `aria-controls` correctly. However, if the menu closes via click-outside or Escape (common patterns), the code needs to explicitly call `hamburgerRef.current?.focus()` on collapse. Without focus restoration, keyboard users lose their position in the document and must Tab from the top. This could not be fully confirmed statically without reading the full `nav-client.tsx` close handler.
- WCAG: 2.4.3 Focus Order (A).
- Fix: In the `isExpanded → false` transition, call `hamburgerButtonRef.current?.focus()` if the close was triggered by Escape or outside click (not by tabbing out naturally).

**DES-10 — `<OnThisDayWidget>` is not wrapped in `<Suspense>` on the home page**
- Confidence: Medium
- File: `apps/web/src/app/[locale]/(public)/page.tsx` line 223
- Problem: `<OnThisDayWidget />` is rendered without a `<Suspense>` boundary, unlike `<TagFilter>` on line 244 which is correctly wrapped. If `OnThisDayWidget` performs DB queries (likely — it queries photos from the current calendar date), a slow query or render error cascades to the whole page render rather than degrading gracefully.
- Fix: Wrap in `<Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-muted" aria-hidden="true" />}>`. Also consider an Error Boundary wrapping it so a DB failure on "on this day" does not break the main gallery.

**DES-11 — Masonry grid column count built with dynamic class interpolation — potential production purge**
- Confidence: Medium
- File: `apps/web/src/components/home-client.tsx` line 259
- Problem: `className={`columns-${colBase} sm:columns-${colSm} md:columns-${colMd} xl:columns-${colXl} 2xl:columns-${col2xl}`}` generates class strings like `columns-3` at runtime. Tailwind JIT requires complete class strings at build time; dynamic interpolation is not scanned by the content extractor. If these classes are not safelisted in `tailwind.config.*`, they may be purged and the grid collapses to one column in production.
- Fix: Add a `safelist` entry to `tailwind.config.*`:
  ```js
  safelist: [
    { pattern: /^columns-[1-5]$/ },
    { pattern: /^(sm|md|xl|2xl):columns-[1-5]$/ },
  ]
  ```
  Or refactor to use CSS custom properties / inline `style={{ columnCount: colBase }}`.

---

## UX / IA

No critical UX architecture issues found. The heading hierarchy (`h1` → `sr-only h2` → per-card `h3`) is correct. Tag filter, topic dropdown, and masonry scroll restoration are all well-implemented. The lightbox `role="dialog"` with `aria-label`, `aria-live` counter, and focus trap is exemplary.

One informational note: the `info-bottom-sheet` drag-expand gesture has no keyboard equivalent for the drag motion, but the toggle button (`aria-expanded`) covers the core use case. Low priority.

---

## Responsive

No critical responsive breakpoint failures found statically. The 5-column 2xl grid and the `useColumnCount` hook correctly mirror Tailwind breakpoints. The `containIntrinsicSize` dynamic height reservation is a sound CLS mitigation.

---

## i18n

- DES-02 (above) is the primary i18n gap: hardcoded English "Close" default in shadcn primitives.
- All other user-facing strings pass through `useTranslation` / `getTranslations`. Transfer function names are correctly routed through the i18n callback (`humanizeTransferFunction`). Color primaries intentionally stay as Latinate technical names (documented in `color-details-section.tsx` per cycle-3 RPF convention C3-D2) — this is correct.
- The `en.json` / `ko.json` asymmetry on count plurals (ICU plural in `en`, fixed form in `ko`) is documented in CLAUDE.md as intentional. No issue.

---

## Perceived Performance (LCP / CLS / INP)

- **LCP:** The masonry grid correctly sets `fetchPriority="high"` / `loading="eager"` on the first `columnCount` images (line 269 `isAboveFold`). Above-fold images use `<picture>` with AVIF/WebP srcsets. No LCP regression found.
- **CLS:** `containIntrinsicSize` + `aspect-ratio` per card is the right pattern. The triple-RAF scroll-restore (lines 154–162) is a known trade-off for CSS columns and is acceptable.
- **INP:** The lightbox `showControls` callback avoids re-registration via `controlsVisibleRef` — correct. The masonry `useMemo` for `estimatedCardWidth` and `orderedImages` prevents unnecessary re-renders. No INP regression found.
- **Note (DES-10 cross-ref):** `<OnThisDayWidget>` without Suspense can delay Time to First Byte / initial render on slow DB connections.

---

## Top 3 Highest-Impact Fixes

1. **DES-01 — Add `motion-safe:` prefix to all `group-hover:scale-105` / `transition-transform` classes** across six files. This is the most impactful a11y fix: every photo card on every public page fires a spatial zoom animation at users with vestibular disorders. Six files, one-line change each, zero visual regression for unaffected users.

2. **DES-04 + DES-05 — Add `focus-visible:ring-2` to the tag input field AND change the search modal input from `h-8` to `h-11`.** The search input is the most-used interactive element after the masonry grid; the tag input is the primary admin data-entry control. Both currently violate the site's own 44 px / focus-visible policy in ways the existing automated audit does not catch.

3. **DES-02 — Fix hardcoded `"Close"` default in `ui/dialog.tsx` and `ui/sheet.tsx`** to read from the i18n system. This is a systemic gap: every admin dialog and sheet close button announces in English to Korean screen-reader users, even though the rest of the admin surface is fully localized.
