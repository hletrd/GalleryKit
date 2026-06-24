# Designer UI/UX/A11y Review — review-plan-fix cycle 1, PROMPT 1

Reviewer: designer / UI-UX lane
HEAD: `1d5545cb`
Date: 2026-06-22
Scope: Next.js UI in `apps/web/src/app`, `apps/web/src/components`, `apps/web/messages`, plus live local browser checks.

## Executive Summary

I found 4 confirmed UI/accessibility issues and 2 source-only risks.

Most core public flows are in good shape: semantic navigation exists, the global skip link works, public home/photo routes have no horizontal overflow at tested desktop/mobile viewports, the login form has visible labels/autocomplete/required fields, and lightbox/bottom-sheet focus trapping works. The main live defect is the search modal: it is rendered inside the sticky blurred nav and does not cover/inert the page as a modal.

## UI File Inventory

Routes examined:
- Public: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `map/page.tsx`, locale `layout.tsx`, `loading.tsx`, `not-found.tsx`, `error.tsx`.
- Admin unauthenticated/protected source: `admin/layout.tsx`, `admin/login-form.tsx`, protected `dashboard`, `categories`, `tags`, `settings`, `seo`, `password`, `tokens`, `db`, `users`, `analytics`.

Components examined:
- Navigation/layout: `nav.tsx`, `nav-client.tsx`, `footer.tsx`, `admin-header.tsx`, `admin-nav.tsx`, `theme-provider.tsx`.
- Public gallery/viewer: `home-client.tsx`, `tag-filter.tsx`, `search.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `image-zoom.tsx`, `similar-photos.tsx`, `load-more.tsx`, `wide-gamut-hint.tsx`, `color-details-section.tsx`, `histogram.tsx`, `map/*`.
- Admin controls: `upload-dropzone.tsx`, `image-manager.tsx`, `bulk-edit-dialog.tsx`, `tag-input.tsx`, protected page clients listed above.
- Shared UI: `ui/button.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `switch.tsx`, `table.tsx`, `tooltip.tsx`, `sonner.tsx`, `skeleton.tsx`.
- i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.

## Live Browser Evidence

Tooling:
- Used `agent-browser` CLI per required approach.
- Started local dev server only: `npm run dev --workspace=apps/web -- --port 3017`.
- No deploy, no commit, no source-code edits.

Pages/viewports checked:
- `/en` at 1440x1000 and 375x812.
- `/ko` at 375x812.
- `/en/admin` and protected redirect from `/en/admin/dashboard`.
- `/en/p/80` at 1440x1000 and 375x812.
- Search dialog, lightbox, and mobile photo info sheet.

Evidence highlights:
- `/en` accessibility snapshot: `navigation "Main navigation"`, `main`, `contentinfo`, tag filter group, photo links.
- Skip link: first `Tab` focused visible `Skip to content` at `141.8x40`; `Enter` moved focus to `main#main-content`.
- Login form: username/password inputs were `334x44`, visible labels existed, `autocomplete=username/current-password`, required fields used browser validation.
- Protected admin route: `/en/admin/dashboard` redirected to `/en/admin` unauthenticated.
- Photo page: viewer controls were >= 44 px; no horizontal overflow.
- Lightbox and bottom sheet: focus trapped inside dialog on Tab.
- Console/logging: normal React DevTools/HMR development logs appeared. After forcing `gallery_theme=light` in localStorage for light-mode checks, Next/React emitted text-extractable hydration mismatch errors for the nav theme button; captured as DES-06.
- Existing touch-target audit: `npm test --workspace=apps/web -- touch-target-audit` passed, `15 passed`.

## Findings

### DES-01 — Search modal is clipped inside the sticky nav and does not cover/inert the page

Severity: High
Confidence: High
Type: Confirmed issue
Areas: modal behavior, keyboard/pointer affordance, accessibility tree, responsive

Evidence:
- Source: `apps/web/src/components/nav-client.tsx:78` renders a sticky nav with `backdrop-blur-xl supports-[backdrop-filter]:bg-background/20`.
- Source: `apps/web/src/components/search.tsx:318-338` renders the overlay and `#search-dialog` as `fixed` descendants inside that nav subtree.
- Desktop live measurement at 1440x1000 with search open:
  - overlay box: `1440x64`, matching nav height, not viewport height.
  - dialog box: `1440x320`.
  - `document.elementFromPoint(200, 500)` returned the gallery masonry content behind the open dialog.
- Mobile live measurement at 375x812 with expanded nav and search open:
  - dialog box: `375x172`, matching expanded nav height, not the viewport.
  - accessibility snapshot still exposed nav/main/footer controls while the dialog had `aria-modal="true"`.
- Focus trap cycles between input and Close, but pointer hit-testing outside the clipped dialog can still reach page content.

Failure scenario:
- A mobile user opens search from expanded nav. The UI claims a modal search dialog, but only the nav-height area is covered. The gallery below remains visually and pointer-accessible, and screen-reader users can still discover background controls in the tree despite `aria-modal=true`.

Suggested fix:
- Render search through a portal at document/body level or use the shared Radix `Dialog` primitive.
- Ensure the overlay and content are outside the filtered/sticky nav containing block.
- While open, make the app background inert/hidden to assistive tech, not only focus-trapped.
- Add a browser regression that asserts `#search-dialog` and the overlay cover the viewport at mobile and desktop, and that `elementFromPoint()` below the panel does not return page content.

### DES-02 — English `All` tag chip renders below the repo’s 44 px touch-target floor

Severity: Medium
Confidence: High
Type: Confirmed issue
Areas: touch target, public mobile home

Evidence:
- Source: `apps/web/src/components/tag-filter.tsx:62-65` comments that chips meet the 44 px floor, but the class only sets `min-h-11`, not `min-w-11`.
- Browser `/en` desktop and mobile measurements:
  - `All` tag button box: `41x44`.
- Existing static audit passed (`touch-target-audit`: 15 tests), so current test coverage does not catch rendered text-width targets.
- Korean `/ko` renders `전체` as `47x44`, so the miss is locale/text-length dependent.

Failure scenario:
- On English public gallery pages, the active All filter presents a 41 px wide pointer target. This violates the repo’s stated 44 px minimum for every interactive element and is easy to miss because the static class audit sees `min-h-11`.

Suggested fix:
- Add `min-w-11` to the `Badge`/button wrapper in `TagFilter`, or use `inline-flex min-h-11 min-w-11 justify-center`.
- Extend `touch-target-audit.test.ts` or add a browser-level smoke check for short text-only rendered targets.

### DES-03 — Footer Admin link is below 44 px width in both English and Korean

Severity: Medium
Confidence: High
Type: Confirmed issue
Areas: touch target, repeated public footer

Evidence:
- Source: `apps/web/src/components/footer.tsx:45-52` explicitly documents `min-h-11` but the Admin link has no `min-w-11` or horizontal padding.
- Browser `/en` measurement: `Admin` footer link was `36x44`.
- Browser `/ko` measurement: `관리자` footer link was `31x44`.
- This appears on public pages through the shared footer.

Failure scenario:
- Mobile users get a narrow footer admin target. It is isolated enough to be tappable for many users, but it violates the project’s stricter 44 px touch-target policy and the comment above the links claims “both links” meet the 44 px floor.

Suggested fix:
- Add `min-w-11 justify-center` or `px-3` to the Admin link.
- Consider applying the same target-size check to all footer links in the static audit.

### DES-04 — Admin data tables lack local horizontal overflow containment on narrow screens

Severity: Medium
Confidence: Medium
Type: Likely issue / manual-validation risk
Areas: responsive admin IA, table usability

Evidence:
- Source: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:216-261` renders a 6-column `Table` directly, no `overflow-x-auto` wrapper.
- Source: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:95-125` renders a table directly, no overflow wrapper.
- Source: `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:92-230` repeats plain bordered table wrappers for analytics tables, no `overflow-x-auto`.
- Contrast: dashboard image management is placed inside a scrollable container in `dashboard-client.tsx`, which suggests this repo already uses overflow containment for dense admin data.
- Could not live-validate protected admin pages because no non-secret admin test credential was available; unauthenticated protected routes redirected to login.

Failure scenario:
- On a 375 px admin viewport, category/topic labels, aliases, action buttons, analytics referrers, or share keys can force document-level horizontal scrolling or clipped action columns. That makes repeated admin tasks harder and can hide destructive controls off-screen.

Suggested fix:
- Wrap each table in `div className="max-w-full overflow-x-auto rounded-md border"` and move the border from the inner table wrapper where needed.
- For analytics, apply `min-w-[...]` to tables so columns remain readable while the wrapper scrolls.
- Longer term: use stacked row cards for category/tag management on small screens if editing is a primary mobile admin workflow.

### DES-05 — Custom modal surfaces rely on focus trap but do not hide/inert background from the accessibility tree

Severity: Medium
Confidence: Medium
Type: Manual-validation risk
Areas: ARIA modal semantics, screen-reader isolation

Evidence:
- Search is confirmed broken separately in DES-01.
- Lightbox live snapshot with `role="dialog" aria-modal="true"` still exposed nav/footer controls in the accessibility tree, although the dialog covered the viewport and focus stayed trapped.
- Mobile info bottom sheet live snapshot with `role="dialog" aria-modal="true"` exposed underlying viewer/nav/footer controls; focus stayed trapped between the sheet handle and Close.
- Source: `apps/web/src/components/lightbox.tsx` and `apps/web/src/components/info-bottom-sheet.tsx` use custom `FocusTrap` wrappers rather than a modal primitive that automatically applies background hiding/inert behavior.

Failure scenario:
- Some screen-reader/browser combinations may still browse to controls outside the advertised modal. For the bottom sheet, this is especially plausible because the sheet is intentionally a peek-height surface over visible page content.

Suggested fix:
- Add explicit inert/background hiding while these modals are open, or migrate to a dialog primitive that manages `aria-hidden`/inert siblings.
- If the bottom sheet is intended to be non-modal in peek mode, remove `aria-modal="true"` until expanded and document the interaction model.
- Add an accessibility-tree regression that checks background controls are not exposed while modal dialogs are open.

### DES-06 — Persisted light theme causes nav theme-button hydration mismatch

Severity: Medium
Confidence: High
Type: Confirmed issue
Areas: dark/light mode, hydration, perceived performance

Evidence:
- Browser setup for light-mode contrast used `localStorage.setItem('gallery_theme', 'light')` and reloaded public routes.
- Dev/browser logs then repeatedly emitted React hydration mismatch errors on `/en`, `/en/p/80`, and `/ko`.
- Error diff showed the server rendered the theme button as `title="System"` with a Monitor icon, while the client rendered `title="Light"` / `title="라이트"` with a Sun icon.
- Source: `apps/web/src/components/nav-client.tsx:155-164` renders the icon and title directly from `const { theme, setTheme } = useTheme()` during the initial client render.
- `apps/web/src/app/[locale]/layout.tsx` has `suppressHydrationWarning` on `<html>/<body>`, but the mismatch is inside the nav button subtree.

Failure scenario:
- Any returning visitor with `gallery_theme=light` (and likely `dark`/`oled`) can get a hydration mismatch on first load. In development this opens the Next error overlay; in production React regenerates that client subtree, causing avoidable flicker and work in the sticky navigation.

Suggested fix:
- Gate the theme-specific icon/title behind a mounted state (`useEffect(() => setMounted(true), [])`) and render a stable placeholder until mounted.
- Alternatively, render a server-stable icon/title and update only after hydration with `suppressHydrationWarning` scoped to the changing text/icon if needed.
- Add a browser or component hydration regression with `gallery_theme=light` preloaded before navigation.

## Watchlist, Not Active Findings

- `apps/web/src/components/ui/sheet.tsx:84` has a close button with no `h-11 w-11`/`min-h-11 min-w-11`. `rg` found only the primitive definition and no current `SheetContent` usage, so I am not counting it as a shipped issue. Fix before first use.
- `agent-browser set media light reduced-motion` did not make `matchMedia('(prefers-reduced-motion: reduce)')` return true in this session. Source coverage is strong via `globals.css:291-316`, lightbox checks, and back-to-top smooth-scroll guard, but reduced-motion live emulation remains unproven.
- Admin analytics links use unlocalized `href={`/p/${row.imageId}`}` and `href={`/g/${row.shareKey}`}` in `analytics-client.tsx:113` and `222`. This may rely on locale middleware/cookies; verify during authenticated admin testing.

## Positive Coverage Notes

- Information architecture: public pages expose `nav`, `main`, `contentinfo`; home has `h1`, sr-only `h2`, and photo-card `h3`s.
- Keyboard navigation: skip link works; search, lightbox, and bottom sheet keep Tab inside their dialogs.
- Forms: login has visible labels, required fields, proper autocomplete, 44 px inputs/buttons, password visibility toggle with `aria-pressed`.
- Loading/empty/error states: source includes localized loading states, empty gallery state, login error alert, route/global errors, load-more toasts, admin settings load-failed alert, and processing placeholders.
- Contrast: dark-mode visible text scan found no plain text below 4.5:1. Light-mode scan only flagged text over gradient photo overlays; source uses black gradient overlays, so those were treated as heuristic false positives.
- i18n: `/ko` renders `lang="ko"`, localized labels, LTR direction, and no horizontal overflow in the public home route. RTL is not implemented; root layout hardcodes `dir="ltr"` for current `en`/`ko` locales.
- Perceived performance: masonry uses `content-visibility`, eager/fetch-priority for above-fold images, blur/placeholder paths in viewer, and lazy loading for lower-priority images.

## Files/Pages Examined

Live pages:
- `http://localhost:3017/en`
- `http://localhost:3017/ko`
- `http://localhost:3017/en/admin`
- `http://localhost:3017/en/admin/dashboard` redirect behavior
- `http://localhost:3017/en/p/80`

Key files:
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/ui/*`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/**`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

## Missed-Issues Sweep

- Re-ran `rg` for ARIA/focus/dialog/table/transition/loading/error/empty/i18n patterns after live testing.
- Rechecked confirmed live measurements against source line regions.
- Verified no source files were intentionally changed.
- Did not authenticate into protected admin UI because no non-secret E2E credential was available locally; protected admin live coverage is limited to redirect/login evidence.
- Did not deploy, commit, push, or modify app source.
