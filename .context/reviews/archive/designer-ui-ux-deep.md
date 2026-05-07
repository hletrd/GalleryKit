# Designer / UI-UX Deep Review — Cycle 3

**Date:** 2026-04-23
**Scope:** Entire web app (`apps/web/`), public + authenticated surfaces, both `en` and `ko` locales, 375/768/1280px viewports.
**Method:** Playwright-driven introspection of the live dev server (`http://localhost:3456`) plus source review of every `[locale]/**` route, every `components/*.tsx`, and every Radix/shadcn primitive used. All findings are backed by text-extractable evidence (selectors, computed styles, ARIA, box metrics, URL + viewport context). Screenshots are optional artifacts for human reviewers.

## Executive Summary

The code is hardened well for most UX failure modes (reduced-motion, focus-visible outlines, focus-trap on the lightbox, skip-link, ARIA labels on most interactive controls, a dedicated `isEditableTarget` helper on key handlers, 44×44 min-size on nav utility buttons). The remaining gaps fall into **three themable groups**:

1. **Missing or broken heading hierarchy** on public pages (home skips H1→H3 with no H2; photo viewer has no `<h1>` at all on the main content because `CardTitle` is a plain `<div>` in this shadcn-ui version).
2. **Locale-switch button has no aria-label** — the visible text "KO" or "EN" is not understandable to a screen-reader user without sighted context.
3. **Touch-target size** — tag-filter pills are 22 px tall at the 375px viewport, which is 2px under the WCAG 2.5.8 AA minimum of 24×24.

Every finding below is cross-checked against the actual rendered DOM, not just the source.

---

## C3R-UX-01 — Photo page has zero headings on the main content [MEDIUM] [HIGH confidence]

**Evidence:**
- `curl -sS http://localhost:3456/en/p/64 | grep -oE '<h[1-6][^>]*>'` returns empty — no headings on server-rendered output.
- `apps/web/src/components/ui/card.tsx` line 33-40: `function CardTitle({ className, ...props }: React.ComponentProps<"div">)` renders a `<div data-slot="card-title">`, not a heading. This is the shadcn-ui v3 default.
- `apps/web/src/components/photo-viewer.tsx:384-386` uses `<CardTitle className="mt-2 text-2xl break-words">{normalizedDisplayTitle}</CardTitle>` — which, per the primitive, outputs `<div>` not `<h*>`.
- Even when the CardTitle rendered: it is inside the `hidden lg:block` sidebar container at line 363. Mobile users never see the info sidebar, so even the `<div>` title is `display: none` on mobile.
- No `<h1>` anywhere on the photo page DOM on any viewport.

**Why it is a problem:**
- WCAG 1.3.1 Info and Relationships: structural headings are required so assistive tech can convey document structure.
- WCAG 2.4.6 Headings and Labels: pages should have descriptive headings; the primary content object (a photo) should have at least an `<h1>`.
- Screen-reader users rely on heading navigation (`H` key in NVDA/JAWS/VoiceOver) to orient themselves.

**Concrete failure scenario:**
A visually impaired user navigates to `/en/p/64` expecting to find the photo title via heading navigation. NVDA reports "no headings on this page." The user cannot quickly skip to the main content.

**Suggested fix:**
- Add a visually-hidden-but-SR-visible `<h1 className="sr-only">{normalizedDisplayTitle}</h1>` to the `photo-viewer.tsx` main container (around line 248, inside the root `<div>` of the viewer).
- Optionally upgrade `CardTitle` usage on that page to render as `<h2>` via `asChild`/slot pattern OR replace the sidebar `<CardTitle>` with `<h2>` for the in-sidebar title.

---

## C3R-UX-02 — Locale-switch button has no aria-label [MEDIUM] [HIGH confidence]

**Evidence:**
- `apps/web/src/components/nav-client.tsx:149-155`:
  ```tsx
  <button
      onClick={handleLocaleSwitch}
      className="min-w-[44px] min-h-[44px] ... text-xs font-medium text-muted-foreground ..."
  >
      {otherLocale.toUpperCase()}
  </button>
  ```
- Playwright check: `localeSwitchAria: [{ tag: 'BUTTON', text: 'KO', ariaLabel: null, hasAriaLabel: false }]`.
- Adjacent theme-toggle button at line 141-148 does have `aria-label={t('aria.toggleTheme')}`. Only the locale switch is missing.

**Why it is a problem:**
- WCAG 4.1.2 Name, Role, Value: the accessible name "KO" (or "EN") is opaque to screen-reader users who don't know that "KO" refers to the Korean locale.
- WCAG 2.4.4 Link Purpose in Context: the purpose ("switch to Korean") is not clear from the button's accessible name alone.

**Concrete failure scenario:**
A JAWS user hears "KO button" and cannot infer that this switches the site language. They have to Tab into/out of it and test. The English-reading user may also be confused.

**Suggested fix:**
- Add `aria-label={t('aria.switchLocale')}` to the button. Translations: `en.aria.switchLocale: "Switch language to {locale}"`, `ko.aria.switchLocale: "언어를 {locale}로 전환"` (or similar).
- Alternatively render visible text `"한국어"` / `"English"` (full name) since the button is already 44×44 (ample room).

---

## C3R-UX-03 — Tag-filter pills are 22px tall at mobile viewport [LOW] [HIGH confidence]

**Evidence:**
- Playwright at viewport 375×812 enumerated all interactive elements with `getBoundingClientRect()` < 24×24:
  - `BUTTON "All": 33x22px`
  - `BUTTON "e2e(2)": 58x22px`
  - `BUTTON "landscape(1)": 94x22px`
  - `BUTTON "portrait(1)": 78x22px`
- Source: `apps/web/src/components/tag-filter.tsx` — pill buttons use `px-2 py-0.5` and `rounded-full border text-xs`; at `text-xs` (12px) + `py-0.5` (2px top/bottom) + border, total height clocks to 22px.

**Why it is a problem:**
- WCAG 2.2 SC 2.5.8 (AA) Target Size (Minimum): each pointer target should be at least 24×24 CSS pixels (with exceptions). These pills are 22px tall — 2px under the minimum.
- The tag filter is a primary navigation affordance; users frequently mistap neighboring pills on mobile.

**Suggested fix:**
- Change `py-0.5` → `py-1` (giving 24px min-height); or add `min-h-[24px]` utility to the pill class.
- Consider `min-h-[24px] sm:min-h-[22px]` to keep desktop density if desired — but 24px is also fine on desktop.

---

## C3R-UX-04 — Home gallery heading hierarchy skips H1 → H3 [LOW] [HIGH confidence]

**Evidence:**
- `curl http://localhost:3456/en | grep <h*` yields `H1: Latest` then `H3: E2E Portrait`, `H3: E2E Landscape`, ... with **no `<h2>`** intervening.
- `apps/web/src/components/home-client.tsx:192-199` emits `<h1>{heading || t('home.latestUploads')}</h1>`.
- `apps/web/src/components/home-client.tsx:295`, `:301` emit `<h3>` for each photo card.
- No `<h2>` exists between the page title and the photo cards.

**Why it is a problem:**
- WCAG 1.3.1: heading levels should not skip — the relationship between sections is obscured when H2 is absent.
- Screen-reader navigation by heading level jumps directly from the top-level page title to individual photos, skipping any summary/section heading.

**Suggested fix:**
- Two options:
  1. Demote the photo-card title to `<h2>` (since each card is effectively a sibling of the page title).
  2. Add a visually-hidden `<h2 className="sr-only">{t('home.photosHeading')}</h2>` before the grid — semantically signals "this is the photo list section".
- Option 2 is less disruptive and preserves the visual hierarchy (smaller cards should not render as H2 visually).

---

## C3R-UX-05 — `<html>` has empty `dir` attribute [LOW] [MEDIUM confidence]

**Evidence:**
- Playwright: `lang=en, dir=""` across all audited routes.
- `apps/web/src/app/[locale]/layout.tsx` sets `lang={locale}` but not `dir`.

**Why it is a problem:**
- Browsers default `dir` to `ltr` so there is no immediate visual regression, but explicit `dir` improves compatibility with mirrored layouts, future RTL locales, and some screen readers that use `dir` to change their speech flow.

**Suggested fix:**
- Add `dir="ltr"` to the `<html>` element in `layout.tsx`. Future RTL locales (Arabic, Hebrew) can then flip to `dir="rtl"` without code changes.

---

## C3R-UX-06 — Footer "Admin" link contrast 4.83:1 (AA pass, AAA fail, on 12px text) [LOW] [MEDIUM confidence]

**Evidence:**
- Playwright computed contrast: `lightFooterAdmin: { ratio: 4.83, fg: 'rgba(113, 113, 122, 0.5)', bg: 'rgb(255, 255, 255)' }`.
- Source: `apps/web/src/components/footer.tsx:46`: `className="text-xs text-muted-foreground/50 ..."` — 12px text with 50% opacity muted color.
- Dark mode: `darkFooterAdmin: { ratio: 7.76, OK }` — no issue in dark.

**Why it is a problem:**
- WCAG 1.4.3 (AA) requires 4.5:1 for regular text — **just passes at 4.83**. AAA (7:1) fails.
- `text-xs` (12px) is "small text" in WCAG terminology so AA threshold applies (not the 3:1 large-text threshold). Borderline passes.
- The low-contrast is intentional (admin link deliberately de-emphasized), so this is a design tradeoff, not a regression. Callers should confirm the tradeoff is desired and document it if so.

**Suggested fix:**
- Either raise to `text-muted-foreground/80` (still subdued, would yield ~6.5:1 contrast), OR document the intentional low-contrast choice in a design note and leave as-is (it already passes AA).

---

## C3R-UX-07 — Info sidebar in photo page uses CardTitle `<div>` with no semantic heading [LOW] [HIGH confidence]

**Evidence:**
- `apps/web/src/components/photo-viewer.tsx:384-386`, `:390` — `CardTitle` renders `<div>` per `ui/card.tsx:33-40`. The EXIF section uses `<h3>` (line 390) but the photo title above it uses `<div>`.
- This creates a jump from "no heading" to H3 inside the same card.

**Why it is a problem:**
- Inconsistent heading semantics. The visually-prominent photo title is unreadable by heading navigation.
- Contributes to C3R-UX-01 (zero headings on mobile, only H3 on desktop).

**Suggested fix:**
- Same as C3R-UX-01 (add an `sr-only <h1>` or wrap the CardTitle contents in an `<h2>`).

---

## Observations (non-findings) — working well

These are verified healthy behaviors worth recording so future reviews don't re-flag them:

- **Skip link:** `#main-content` is present and focusable on first Tab; `focus:not-sr-only` correctly reveals it on keyboard focus (141.8×40 px, not `1×1` as initially suspected — the audit caught it pre-focus).
- **Reduced motion:** Global CSS rule (`globals.css:156-165`) overrides all animations when `prefers-reduced-motion: reduce`. Individual components (lightbox, home-client back-to-top) also read the preference directly.
- **Focus trap:** Lightbox uses `FocusTrap` with explicit `allowOutsideClick: true`, manages `previouslyFocusedRef`, and restores focus on unmount.
- **ARIA on interactive elements:** Lightbox buttons all have localized `aria-label`; nav buttons (hamburger, theme toggle) have localized labels; admin nav uses `aria-current="page"` correctly; `aria-live="polite"` + `role="status"` on the photo position indicator.
- **Theme-color handling:** `apps/web/src/app/[locale]/layout.tsx:53-56` emits `theme-color` meta separately for `light` and `dark` via `next/metadata.themeColor` media-scoped array. The audit captured only the `light` media tag on initial load — this is normal; the browser picks the right one.
- **Admin route protection:** Dev server redirects unauthenticated admins from protected routes to `/admin` (login). Redirect is middleware-enforced in `proxy.ts` (per CLAUDE.md).
- **Autocomplete on login form:** `username` autocomplete="username", `password` autocomplete="current-password", both labels present (sr-only) — the "no label" rows in the initial audit were all Next.js internal `$ACTION_*` hidden fields (not real user inputs).
- **Touch targets on utility buttons:** Theme toggle, locale switch, hamburger are all 44×44 or better.
- **Perceived performance:** FCP 96ms, DCL 75ms, transferSize 20 KB for home-en (dev server, uncompressed). Actual prod build + CDN will be faster.

---

## Audit Artifacts

- `/tmp/ux-audit.json` — structural audit (all routes × viewports × lang).
- `/tmp/ux-deep.json` — deep audit (touch targets, contrast, theme, ARIA-live, tab order, perf markers).
- Source citations as listed above.

---

## Totals

- **0 CRITICAL / HIGH** findings
- **2 MEDIUM** findings (C3R-UX-01, C3R-UX-02)
- **5 LOW** findings (C3R-UX-03 through C3R-UX-07)
