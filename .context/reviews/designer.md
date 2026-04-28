# UI/UX Review — GalleryKit

Scope: `apps/web` (Next.js 16 / React 19, Next Intl, Radix, Tailwind, Framer Motion)

Runtime checked against a seeded local server at `http://127.0.0.1:3100` after:
- `npm run build --workspace=apps/web`
- local standalone server start with the repo’s E2E env

## Executive summary

The app’s core gallery flow is generally strong: nav, headings, photo cards, admin login labels, and the 404 shell are all present and mostly well-structured.

The main UX issues I found are:
1. Locale switching resets the user’s scroll position.
2. The search dialog has no visible empty state when a query returns zero results.
3. The photo-detail loading fallback is spinner-only and gives very little contextual feedback.

## Findings

### 1) Locale switching drops the user back to the top of the gallery

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed
- **Files / lines:** `apps/web/src/components/nav-client.tsx:65-68` and `:155-160`

**What happens**
The locale switch writes the cookie and calls `router.push(localeSwitchHref)` without preserving scroll state.

**Runtime evidence**
On a scrollable home page at `1280x500`, I scrolled to `scrollY=292`, clicked the locale switch, and the page landed at `scrollY=0` on `/ko`.

**Failure scenario**
A visitor browsing deep in the masonry grid switches languages and loses their place immediately. On a photo-heavy page, that feels jarring and makes comparison across locales harder.

**Fix**
Use navigation that preserves scroll state when appropriate, e.g. `router.push(localeSwitchHref, { scroll: false })`, or otherwise restore the previous scroll position after the locale transition.

---

### 2) Zero-result search has no visible empty state

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed
- **Files / lines:** `apps/web/src/components/search.tsx:234-247`

**What happens**
When search returns no matches, the component only updates an SR-only live region. There is no visible “No results” panel or retry/clear hint in the dialog body.

**Runtime evidence**
On the seeded app, typing `zzzzzzzzzzzz` into the search dialog produced:
- `dialog-visible-text`: only the search prompt/help text
- `dialog-option-count`: `0`

There was no visible empty-state message in the dialog body.

**Failure scenario**
Sighted users get a blank panel after entering a query, which reads as “the search didn’t work” rather than “there are no matches.”

**Fix**
Render a visible empty state under the input when `results.length === 0` and `query.trim()` is non-empty. A short message plus a clear/reset action would be enough.

---

### 3) Photo-detail loading feedback is spinner-only

- **Severity:** Low
- **Confidence:** Medium
- **Category:** Likely / manual-validation
- **Files / lines:** `apps/web/src/components/photo-viewer-loading.tsx:5-16`

**What happens**
The dynamic photo-viewer fallback is only a centered spinner with an aria-label. There is no skeleton shape, no contextual text, and no indication of what is loading.

**Failure scenario**
On slow connections or first-load route transitions, the user sees a nearly blank viewport with a tiny spinner. That is easy to misread as stalled UI rather than intentional loading.

**Fix**
Replace the bare spinner with a photo-aware skeleton or at least add short visible copy such as “Loading photo…” and a content-shaped placeholder.

## Coverage sweep

I reviewed:
- App shell and layout: `apps/web/src/app/[locale]/layout.tsx`, `globals.css`, `loading.tsx`, `not-found.tsx`, `error.tsx`, `global-error.tsx`
- Public navigation and shell: `apps/web/src/components/nav-client.tsx`, `nav.tsx`, `footer.tsx`
- Core gallery interactions: `home-client.tsx`, `search.tsx`, `tag-filter.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `info-bottom-sheet.tsx`, `lightbox.tsx`
- Admin entry points: `apps/web/src/app/[locale]/admin/page.tsx`, `admin/login-form.tsx`, `admin/layout.tsx`
- Form / upload surfaces: `tag-input.tsx`, `upload-dropzone.tsx`
- Relevant tests and runtime helpers: Playwright e2e specs, touch-target audit, locale-path tests, error-shell tests, validation tests

I also verified:
- Desktop nav affordances are present and labeled.
- The 404 shell has a main landmark plus visible nav/footer.
- The admin login form exposes visible labels and a password toggle.
- The app is currently configured for `en` / `ko` only, with `dir="ltr"`; no RTL locale is shipped yet.

## Final sweep

- **Information architecture:** reviewed top-level nav, topic chips, search, gallery entry points, 404 shell, and admin entry.
- **Affordances / keyboard / focus:** reviewed nav controls, search dialog focus trap, lightbox controls, bottom sheet, and admin login toggle.
- **WCAG / ARIA / contrast:** reviewed labels, landmarks, live regions, `aria-current`, dialog semantics, and touch targets.
- **Responsive behavior:** reviewed mobile nav collapse/expand, masonry breakpoints, photo-viewer responsive layout, and bottom-sheet behavior.
- **Loading / empty / error states:** reviewed route loading, photo loading fallback, search empty state, 404 shell, and admin login error presentation.
- **Forms / validation UX:** reviewed admin login, tag input, upload flow, and file-level error display.
- **Dark / light mode:** reviewed theme toggle and the global color-token setup in CSS.
- **i18n / RTL:** reviewed locale switching, localized routes, and the current LTR-only shipping posture.
- **Perceived performance:** reviewed masonry eager-loading logic, content-visibility usage, and loading fallbacks.

Overall: no blocking accessibility or layout defect was found, but the three issues above are worth addressing to improve the gallery’s polish and usability.
