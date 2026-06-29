# Designer Review - Cycle 15

Role: cycle-15 designer reviewer for GalleryKit. Scope is current HEAD only:
`d401dd68`.

I read the repo instructions and `CLAUDE.md`, inventoried the UI surface, used
`agent-browser` against a local Next dev server where feasible, and reviewed
data-backed UI from source where the local database blocked runtime flows. No
production source code was changed and no commit was made.

## Inventory

Inventory command used before inspection:

```sh
git ls-tree -r --name-only HEAD apps/web/src/app apps/web/src/components apps/web/messages apps/web/src/i18n apps/web/e2e | rg '\.(tsx|css|json|ts)$' | sort
```

Result: 143 UI-adjacent files.

Covered:

- Public App Router pages and shells: home, topic, smart collection, shared link/group, map, timeline, year archive, privacy, photo detail/loading, not-found, error, loading, root layout, metadata/icon/manifest routes.
- Admin App Router pages and client surfaces: login, protected layout, dashboard, upload/image manager, categories, tags, settings, SEO, password, users, tokens, DB, analytics, admin error/loading.
- Shared UI: nav, footer, search, masonry, photo viewer, lightbox, image zoom, info bottom sheet, map client, color/histogram/details, upload dropzone, tag input, admin header/nav/user manager, Radix/shadcn primitives.
- Localization and tests: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, i18n request setup, Playwright e2e specs, and a11y/touch/focus/theme tests.

I did not intentionally skip any file from that inventory.

## Browser Evidence

Local server:

```sh
PORT=3001 npm run dev --workspace=apps/web
```

Agent-browser samples:

- `/en` at 1440x900 loaded the route-level error boundary instead of the gallery. Accessibility tree exposed skip link, `main`, region `Error`, button `Try again`, link `Return to Gallery`, and Sonner notifications. Screenshot: `/tmp/gallery-c15-en-desktop.png`.
- Server logs for `/en` confirmed the blocker: `connect ECONNREFUSED 127.0.0.1:3306` while reading `topics` and latest image metadata. Browser console showed the same failed topic query handled by the `Home` error boundary.
- `/en/admin` rendered the unauthenticated login shell. Accessibility snapshot exposed skip link, `main`, heading `Admin`, username textbox, password reveal button, and sign-in button. Screenshot: `/tmp/gallery-c15-admin-desktop.png`.
- `/ko/admin` at 390x844 rendered the Korean login shell with no horizontal overflow. Runtime eval: `htmlLang: "ko"`, `dir: "ltr"`, `overflowX: false`, title `관리 | GalleryKit`, h1 `관리자 로그인`. Screenshot: `/tmp/gallery-c15-ko-admin-mobile.png`.
- Login form target-size check via browser eval: `#login-password` was 334x44 and the reveal button was 44x44. Source labels are `label for="login-password"` / `id="login-password"` at `apps/web/src/app/[locale]/admin/login-form.tsx:63-80`.
- Dark-theme smoke check: `agent-browser set media dark` did not change `matchMedia('(prefers-color-scheme: dark)')` in this browser session, so I forced the app preference with `localStorage.gallery_theme = "dark"` and reloaded. Runtime eval then showed `<html class="dark">`, `body` background `rgb(9, 9, 11)`, foreground `rgb(250, 250, 250)`. Screenshot: `/tmp/gallery-c15-ko-admin-mobile-forced-dark.png`.

## Findings

### DES-C15-01 - Root layout still hard-codes document direction

Severity: Low
Confidence: High
Classification: likely issue, latent i18n risk
Status: current

Evidence:

- `apps/web/src/app/[locale]/layout.tsx:95-99` renders `lang={locale}` but always sets `dir="ltr"`.
- The adjacent comment at `apps/web/src/app/[locale]/layout.tsx:96-98` says the explicit direction improves screen-reader flow and future-proofs RTL locales.
- Runtime `/ko/admin` confirmed the current shipped Korean locale is correctly LTR (`htmlLang: "ko"`, `dir: "ltr"`), so this is not a Korean defect today.

Failure scenario:

If an RTL locale is added later, the document will still expose LTR reading
direction. Screen-reader speech flow, punctuation order, horizontal layout,
scroll assumptions, and directional controls can all be wrong before component
translations are reviewed.

Fix:

Derive direction from locale, for example `rtlLocales.has(locale) ? "rtl" :
"ltr"`, and add a layout/i18n test that fails if a future RTL locale does not
change `dir`. If RTL is intentionally out of scope, update the comment so it no
longer claims future-proofing.

### DES-C15-R1 - Data-backed UI flows could not be browser-tested locally

Severity: Medium
Confidence: High
Classification: validation risk
Status: confirmed blocker

Evidence:

- `/en` browser snapshot reached only the route error shell, not the gallery.
- Server logs showed `connect ECONNREFUSED 127.0.0.1:3306` for topic and latest-image queries.
- The same DB blocker prevents runtime inspection of masonry images, search results, photo viewer/lightbox with real images, map markers, authenticated admin pages, upload, and mutation validation states.

Failure scenario:

Runtime-only defects in data-backed UI could remain hidden: keyboard result
navigation in search, photo/lightbox focus return, map marker affordances,
image-manager tables, upload validation, real empty states, and authenticated
admin dialogs.

Fix:

Repeat this browser pass with a seeded local MySQL database and cover:

- Public home with real masonry images at desktop and mobile.
- Search open/type/keyboard navigation/loading/empty/error states.
- Photo detail, lightbox next/previous, zoom, metadata sheet, and focus return.
- Map page with markers.
- Admin login plus categories/tags/images/settings form validation.
- Light, dark, OLED, system-theme, and reduced-motion modes.
- `npm run test:e2e --workspace=apps/web` once the DB/browser fixture is available.

## Resolved Since Prior Designer Cycle

- The search dialog input now keeps a 44 px height: `apps/web/src/components/search.tsx:372-402` uses `className="h-11 ..."` and the shared input primitive floors controls at `min-h-11` in `apps/web/src/components/ui/input.tsx:10-14`.
- The mobile nav expand button now exposes both controlled regions:
  `apps/web/src/components/nav-client.tsx:105-107` has
  `aria-controls="primary-nav-topics primary-nav-controls"`.
- Admin form dialogs now include descriptions, including category create/edit and tag edit dialogs.

## Areas Reviewed With No New Finding

- IA and wayfinding: public/admin route inventory, nav, footer, login, not-found, error, loading shells, topic/photo/shared surfaces.
- Affordances and touch targets: shared `Button` floors default/sm/icon variants at 44 px (`apps/web/src/components/ui/button.tsx:23-29`); focused tests passed.
- Focus and keyboard: skip link, login focus, search dialog, lightbox focus trap/return focus (`apps/web/src/components/lightbox.tsx:430-456`), mobile info sheet focus trap (`apps/web/src/components/info-bottom-sheet.tsx:190-244`), combobox/listbox patterns.
- WCAG 2.2 and ARIA: target size, labels, landmarks, dialogs, live regions, disabled states, `aria-current`, `aria-controls`, `aria-expanded`, `aria-invalid`, and alert/status usage.
- Contrast and themes: token comments and tests cover muted/destructive/HDR contrast; forced dark theme applied expected dark tokens in browser.
- Responsive breakpoints: mobile Korean login had no horizontal overflow; source review covered nav wrapping, masonry reservations, dialogs/sheets, table overflow wrappers, and photo viewer breakpoints.
- Loading, empty, and error states: route loading/status, home empty/filter-empty, search empty/error/loading, upload progress/errors, admin loading/error, and not-found/error shells.
- Validation UX: visible labels, required fields, max lengths, inline alert text for edit forms, toasts for async failures, and pending/disabled controls.
- Korean/i18n: English/Korean messages are parity-tested; Korean login rendered correctly in browser. The remaining direction issue is future RTL only.
- Perceived performance: masonry aspect-ratio/contain-intrinsic-size, eager above-fold images, blur placeholders, async image decoding, bounded loading shells, and reduced-motion source handling were reviewed.

## Validation

Focused test command:

```sh
npm test --workspace=apps/web -- touch-target-audit i18n focus-visible hdr-badge-contrast theme-token-contract error-shell
```

Result: 12 test files passed, 124 tests passed.

Browser validation was partial because MySQL was unavailable locally. The
unauthenticated admin login shell was tested at desktop and mobile/Korean;
data-backed public/admin flows were source-reviewed and recorded under
`DES-C15-R1`.

## Final Missed-Issues Sweep

Final sweeps covered `dir="ltr"`, `aria-controls`, `aria-expanded`,
`aria-modal`, dialog/sheet/alert-dialog content, compact sizing tokens,
placeholders/required/invalid/alert/live states, disabled/pending states, and
reduced-motion handling across `apps/web/src/app` and `apps/web/src/components`.

No additional current UI/UX findings were confirmed beyond `DES-C15-01` and
the runtime validation blocker `DES-C15-R1`.
