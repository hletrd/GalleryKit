# Designer Review - Cycle 16

Role: designer lane for cycle 16/100 review-plan-fix loop. Scope: UI/UX,
accessibility, responsive behavior, i18n, perceived performance, and form/dialog
affordances in the current working tree.

## Inventory

Reviewed UI surface:

- Public routes: home, topic, smart collection, shared link/group, map, timeline,
  year archive, privacy, photo detail/loading, root loading/error/not-found,
  localized layout, public layout, upload proxy route metadata surfaces.
- Admin routes: login, protected layout, dashboard/upload/image manager, failed
  image retry, categories, tags, settings, SEO, password, users, tokens, DB,
  analytics, admin loading/error.
- Shared components: nav, footer, search, masonry/home client, load-more,
  photo viewer, photo navigation, lightbox, image zoom, bottom sheet, color
  details, histogram, map client/loader, upload dropzone, tag input, admin nav,
  admin header, user manager, Radix/shadcn UI primitives.
- Localization/tests: `apps/web/messages/en.json`, `apps/web/messages/ko.json`,
  i18n direction helpers, Playwright e2e specs, touch-target/focus/theme/a11y
  tests.

I did a final missed-issues sweep over `aria-*`, `role=`, `tabIndex`,
`DialogContent`, `AlertDialogContent`, `sr-only`, `focus-visible`,
`overflow-x`, `truncate`, `placeholder`, `required`, `aria-invalid`,
`aria-describedby`, `toast`, loading/empty/error keys, and RTL/direction code.

## Browser Evidence And Blockers

Local dev server started on `http://127.0.0.1:3001` because port 3000 was already
serving a different Next app (`ccusage`). GalleryKit dev server reported:

```text
Could not connect to database to bootstrap queue (ECONNREFUSED).
```

Agent-browser evidence:

- `agent-browser install` confirmed Chrome was installed.
- `/en/privacy` rendered at 390x844 with a clean accessibility tree: skip link,
  `navigation "Main navigation"`, `main`, h1 `Privacy`, h2 `Analytics`, h2
  `Photo Metadata`, `contentinfo`, and notifications region. Screenshot:
  `/tmp/gallerykit-privacy-mobile.png`.
- `/en/admin` rendered the unauthenticated login shell with skip link, main,
  h1 `Admin`, username textbox, password textbox, `Show password`, and
  `Sign in`. Screenshot: `/tmp/gallerykit-admin-login-mobile.png`.
- `/en` returned HTTP 200 but the RSC payload contained `Error: Failed query`
  for latest-image/topic data and only the loading/error shell was extractable.

Runtime interaction blocker:

- Agent-browser semantic and coordinate clicks did not trigger React handlers
  in this local dev session. Cross-checking with Playwright produced the same
  result: mobile nav stayed `aria-expanded="false"` after click and the admin
  password field stayed `type="password"` after clicking `Show password`.
- Playwright console showed HMR WebSocket handshake errors:
  `/_next/webpack-hmr ... net::ERR_INVALID_HTTP_RESPONSE`.
- Static script requests returned no 4xx/5xx, so this is recorded as a runtime
  validation blocker, not as a product interaction defect by itself.

## Findings

### DES16-01 - Home route fails to a broken/loading experience when the DB is unavailable

Severity: High
Confidence: High
Selectors/files: `/en`, `main`; `apps/web/src/app/[locale]/(public)/page.tsx:18-147`,
`apps/web/src/app/[locale]/(public)/page.tsx:149-166`,
`apps/web/src/lib/data.ts:933-946`, `apps/web/src/lib/data.ts:1720-1744`

Failure scenario:

The site can still render static public surfaces like `/en/privacy` from
site-config fallbacks when MySQL is unavailable, but the home page calls
`getLatestImageForOgCached()` in metadata and `getImagesLitePage()`/tag/topic
queries in the page body without a graceful fallback. In the observed runtime,
`/en` returned a 200 response containing a failed query stack and left the
browser at a loading/error shell rather than a stable gallery outage state.

Suggested fix:

Catch non-critical OG latest-image failures in `generateMetadata()` and fall
back to no `og:image` or the configured static OG image. For the page body,
render an explicit public maintenance/unavailable state when listing queries
fail, with a retry affordance and normal nav/footer, instead of relying on the
route error boundary. Keep true schema/programming errors loud in logs.

### DES16-02 - Search result keyboard highlight can move off-screen

Severity: Medium
Confidence: High
Selectors/files: `#search-dialog`, `#search-input`, `#search-results [role=option]`;
`apps/web/src/components/search.tsx:390-399`,
`apps/web/src/components/search.tsx:428-444`

Failure scenario:

The search dialog uses `aria-activedescendant` and arrow keys to move
`activeIndex`, but it never scrolls the active option into the `sm:max-h-[60vh]`
scroll container. With enough results, a sighted keyboard user can keep pressing
ArrowDown and move the active row below the visible viewport. The screen reader
state changes, but the visible highlight is lost.

Suggested fix:

Add an effect on `activeIndex` that calls
`resultRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })`.
Keep the `aria-activedescendant` pattern; just synchronize the visual viewport
with the active option.

### DES16-03 - Map marker click bypasses the popup affordance

Severity: Medium
Confidence: Medium
Selectors/files: Leaflet marker/popup button; `apps/web/src/components/map/map-client.tsx:97-105`,
`apps/web/src/components/map/map-client.tsx:120-141`,
`apps/web/src/app/[locale]/(public)/map/page.tsx:59-89`

Failure scenario:

Each marker has a `click` handler that immediately navigates to the photo, while
the marker also contains a popup with a thumbnail button labeled `Open photo`.
Mouse users who click the marker never get to inspect the popup preview. The
accessible fallback list below the map helps, but the primary map affordance is
internally inconsistent.

Suggested fix:

Let the marker click open the Leaflet popup by default, and reserve navigation
for the explicit popup button and the accessible list links. If direct marker
navigation is intentional, remove the unused popup UI and make the marker
navigation semantics explicit.

### DES16-04 - Login errors are announced twice

Severity: Low
Confidence: Medium
Selectors/files: admin login form; `apps/web/src/app/[locale]/admin/login-form.tsx:28-31`,
`apps/web/src/app/[locale]/admin/login-form.tsx:97-100`

Failure scenario:

On a failed login, the same server error is sent to Sonner via `toast.error()`
and rendered inline as `role="alert"`. Screen-reader users can hear duplicate
announcements for one validation failure, and sighted users see both a toast and
an inline error competing for attention.

Suggested fix:

Use the inline alert as the primary form-validation surface and reserve toast
for non-field infrastructure errors, or suppress the toast when `state.error`
is already displayed inline.

### DES16-05 - RTL remains only partially future-proofed

Severity: Low
Confidence: High
Selectors/files: `html[dir]`; `apps/web/src/app/[locale]/layout.tsx:94-110`,
`apps/web/src/components/nav-client.tsx:90-178`,
`apps/web/src/components/home-client.tsx:442-455`,
`apps/web/src/components/photo-navigation.tsx:156-244`

Failure scenario:

The root layout derives `dir` through `getLocaleDirection()`, which is good for
future RTL locales, but major UI controls still use physical direction classes
and assumptions: `left-*`, `right-*`, `ml-*`, `mr-*`, left/right swipe language,
and fixed right-side floating buttons. Today only English and Korean are shipped
and both are LTR, so users are not affected now. If an RTL locale is added, the
document direction can flip while navigation, floating controls, and photo
previous/next affordances still behave visually LTR.

Suggested fix:

Before adding any RTL locale, convert exposed physical positioning/margins to
logical utilities or locale-aware variants, and define whether photo previous
/ next follows chronology or reading direction. Add at least one RTL layout
fixture test before enabling the locale.

## Areas Reviewed With No New Finding

- Landmark and heading structure: public privacy, admin login, root layout,
  public/admin error and loading shells.
- Touch targets: shared `Button` variants floor at 44 px in
  `apps/web/src/components/ui/button.tsx:23-29`; upload, nav, footer, login,
  image-manager, and map controls mostly use explicit 44 px floors or are
  covered by the existing audit.
- Focus indicators: focus-visible scanner exists and covers `components/` plus
  the app tree; source review did not find a fresh unguarded hover-only control.
- Loading/empty/error states: route loading, not-found/error shells, home empty,
  search loading/empty/status, load-more live region, upload progress/errors,
  admin loading/error, tokens empty/loading, map empty state.
- Forms and validation UX: visible labels on login/upload/settings/password,
  required/max-length constraints, inline error alerts for edit/password flows,
  pending/disabled states for async actions.
- Dark/light mode: root theme provider, theme tokens, and `color-scheme` metadata
  are wired; runtime theme interaction could not be clicked because of the local
  hydration blocker.
- Korean i18n: Korean messages are present and key parity is tested; no Korean
  text overflow was confirmed in the renderable browser pages.
- Perceived performance: masonry reserves aspect ratio/intrinsic size, above-fold
  image priority is bounded by column count, image decoding is async, map client
  is dynamically loaded, and photo neighbor preloads are data-saver aware.

## Validation

Commands/evidence used:

```sh
npm run dev --workspace=apps/web -- -p 3001
curl -L http://127.0.0.1:3001/en
curl -L http://127.0.0.1:3001/en/privacy
curl -L http://127.0.0.1:3001/en/admin
agent-browser install
agent-browser set viewport 390 844
agent-browser open http://127.0.0.1:3001/en/privacy
agent-browser snapshot -C
agent-browser screenshot /tmp/gallerykit-privacy-mobile.png --full
agent-browser open http://127.0.0.1:3001/en/admin
agent-browser snapshot -C
```

I did not run the full test suite because this lane is review-only and the local
database was unavailable. Browser coverage for data-backed and interactive
flows is incomplete until MySQL and the dev-client/HMR issue are fixed.

## Final Missed-Issues Sweep

Final source sweeps covered information architecture, affordances,
keyboard/focus, WCAG 2.2 target/focus/labels, responsive breakpoints, loading
/ empty / error states, form validation UX, dark/light mode hooks, i18n/RTL,
and perceived performance. No additional confirmed findings were found beyond
DES16-01 through DES16-05 and the explicit runtime interaction blocker above.
