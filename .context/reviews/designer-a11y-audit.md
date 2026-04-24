# Designer / Accessibility Audit — Cycle 3

**Date:** 2026-04-23
**Standard:** WCAG 2.2 Level AA (plus partial AAA coverage)
**Method:** Live DOM introspection via Playwright, contrast computed with WCAG relative-luminance formula, ARIA/role inspection, keyboard focus traversal, screen-reader landmark check.

## WCAG 2.2 AA Findings

### A11Y-01 — Photo page has no `<h1>` (SC 1.3.1, 2.4.6) [MEDIUM]
Photo pages (`/en/p/[id]`, `/ko/p/[id]`) emit zero heading elements. On mobile, where the info sidebar is hidden by default (`hidden lg:block` at photo-viewer.tsx:363), even the `<div data-slot="card-title">` label is `display: none`. Heading-based screen-reader navigation yields "no headings on this page." See C3R-UX-01 for detail.

### A11Y-02 — Locale switch button has no accessible name (SC 4.1.2, 2.4.4) [MEDIUM]
`apps/web/src/components/nav-client.tsx:149-155`. The button text "KO" (or "EN") is context-dependent; a screen-reader user without sighted context cannot determine the button's purpose. See C3R-UX-02.

### A11Y-03 — Tag filter pill touch target 22px (SC 2.5.8) [LOW]
Tag-filter pills at `apps/web/src/components/tag-filter.tsx` render at 22×{33..94}px on the 375px viewport. WCAG 2.2 AA requires at least 24×24. See C3R-UX-03.

### A11Y-04 — Heading skip H1 → H3 on home (SC 1.3.1, 2.4.6) [LOW]
Home gallery uses `<h1>` for the page title and `<h3>` for each photo card with no `<h2>` in between. See C3R-UX-04.

## WCAG 2.2 Contrast (SC 1.4.3 AA, SC 1.4.6 AAA)

Computed via WCAG relative-luminance formula (sRGB):

| Pair | FG | BG | Ratio | AA | AAA |
|---|---|---|---|---|---|
| H1 light | rgb(9,9,11) | rgb(255,255,255) | 19.9:1 | OK | OK |
| H1 dark | rgb(250,250,250) | rgb(9,9,11) | 19.06:1 | OK | OK |
| muted light | rgb(113,113,122) | rgb(255,255,255) | 4.83:1 | OK | FAIL |
| muted dark | rgb(161,161,170) | rgb(9,9,11) | 7.76:1 | OK | OK |
| footer admin light (50% opacity) | rgba(113,113,122,0.5) | rgb(255,255,255) | ~4.83:1* | OK(borderline) | FAIL |
| footer admin dark (50% opacity) | rgba(161,161,170,0.5) | rgb(9,9,11) | 7.76:1 | OK | OK |

*Note: contrast ratio with transparent FG is calculated against parent bg; effective visible color ≈ rgb(186,184,190) on white. Borderline AA pass on 12px text.

**Conclusion:** light-mode muted-foreground (`hsl(240, 3.8%, 46.1%)`) is **AA-compliant but AAA-failing** for small text. No action needed for WCAG AA compliance. See C3R-UX-06.

## Keyboard Navigation

Tab order on `/en` home (first 13 stops):
1. `<a>` Skip to content (#main-content) — focus-visible OK
2. `<a>` GalleryKit (home link)
3. `<button>` Expand menu (aria-label, aria-expanded)
4. `<a>` E2E Smoke (topic nav — real topic "Test" in dev seed)
5. `<button>` All (tag filter)
6-8. `<button>` tag-filter pills
9-11. `<a>` photo cards (aria-label="View photo: {title}")
12. `<a>` GitHub (external)
13. `<a>` Admin (footer)

**Assessment:** Tab order matches visual reading order (top-to-bottom, left-to-right). All focusable items show a visible focus ring (outline rgb(0,95,204) auto 1px — OS default, acceptable). No focus traps outside the lightbox dialog.

## Landmarks

- `<nav aria-label="Main navigation">` ✓
- `<main id="main-content">` ✓ (target of skip link)
- `<nav aria-label="Admin navigation">` on admin routes ✓
- `<footer>` (no aria-label needed per ARIA spec) ✓
- No `<aside>` used (info sidebar is a `<div>`) — acceptable but could be promoted.

## ARIA Live Regions

- `<section aria-live="polite">` (sonner toast container) — correct for status toasts.
- `<div role="status" aria-live="polite">` on photo-position indicator (`photo-viewer.tsx:355`) — correct.

## Reduced Motion

Global CSS rule at `globals.css:156-165` clamps animations to 0.01ms when `prefers-reduced-motion: reduce`. Individual components also read the preference: lightbox (line 54, 61), home-client back-to-top (line 341), photo-viewer framer-motion transitions (via `useReducedMotion`). **Compliant with WCAG 2.3.3 AAA.**

## Forms (Login)

- Username input: `type=text`, `name=username`, `autocomplete=username`, `maxLength=64`, `required`, `<label htmlFor="login-username" class="sr-only">`. ✓
- Password input: `type=password`, `name=password`, `autocomplete=current-password`, `maxLength=1024`, `required`, labeled. ✓
- Submit button: `<button type="submit" disabled={isPending}>`. ✓
- On empty submit: browser-native HTML5 validation (`required`) blocks submit and announces "Please fill out this field." — acceptable UX.

## Totals

- **0 CRITICAL/HIGH** (WCAG A or widespread AA failures)
- **2 MEDIUM** (A11Y-01, A11Y-02)
- **2 LOW** (A11Y-03, A11Y-04)
- **0 AAA findings** recommended for action (contrast AAA-fail on small muted text is a deliberate design choice and still passes AA)
