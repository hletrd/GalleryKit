# GalleryKit Designer Review - Cycle 19

Repo: `/Users/hletrd/flash-shared/gallery`
Lane: `designer`, PROMPT 1. Review only; no fixes, commits, or pushes. Only write target: `.context/reviews/designer.md`.

## Scope And Inventory

Read first: `AGENTS.md`, `CLAUDE.md` UI/accessibility/color/HDR/touch-target guidance, `README.md`, root and web `package.json` scripts, Playwright config/tests, existing `.context/reviews/*designer*` conventions, and current target report.

Inventory covered:

- Public routes: `apps/web/src/app/[locale]/(public)` home, topic, photo, shared photo, shared group, collection read route, map, timeline, year, privacy, about; plus locale `error.tsx`, `not-found.tsx`, `global-error.tsx`, layouts, and loading behavior.
- Admin routes: `apps/web/src/app/[locale]/admin` login and protected dashboard, images/recent uploads, settings, users, tags, categories, db, tokens, SEO, analytics, password.
- UI surfaces/components: `apps/web/src/components` nav, search, tag filter, home/masonry, photo viewer, lightbox, info bottom sheet, color/HDR details, map, upload dropzone, admin header/nav, image manager, tag input, admin user manager, and `components/ui` primitives.
- Supporting assets and contracts: `apps/web/src/app/[locale]/globals.css`, `messages/en.json`, `messages/ko.json`, `apps/web/e2e`, `apps/web/public/sw*.js`, histogram worker, icons/fonts, and fixture uploads/resources.

Browser/runtime evidence: started local `next start` on `http://127.0.0.1:3100` from the existing production build. Probed mobile `390x844` and desktop `1280x900` for `/en`, `/en/timeline`, `/en/map`, `/en/privacy`, `/en/not-a-real-route`, and `/en/admin`; probed the search dialog on `/en`. Stopped the local server afterward. Authenticated admin pages were source-reviewed because no admin credentials were available.

Validation evidence: focused UI/accessibility contract subset passed: `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/focus-visible-rings-cycle20.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/search-status-source.test.ts src/__tests__/settings-save-affordance-source.test.ts` -> 8 files, 46 tests passed.

## Confirmed Findings

### DES-C19-01 - Map embeds sub-44 px Leaflet controls on a public mobile surface

Severity: Medium
Confidence: High
Status: Confirmed by browser + source
File/region: `apps/web/src/components/map/map-client.tsx:109-140`; mitigation/fallback list in `apps/web/src/app/[locale]/(public)/map/page.tsx:80-104`; touch-target contract in `apps/web/src/__tests__/touch-target-audit.test.ts:9-15`.

Why this is real: `MapClient` renders the default `MapContainer`, `TileLayer`, and `Marker` controls without local sizing overrides for Leaflet's own zoom buttons, marker hit target, or attribution links. The page does provide a keyboard skip link and a 44 px fallback photo list, but the visible map controls remain interactive.

Browser evidence: local `/en/map`, viewport `390x844`, reported visible interactive elements below the project's 44 px floor: marker button `25x41`, Zoom in `30x30`, Zoom out `30x30`, Leaflet attribution `51x14`, and OpenStreetMap contributors `154x14`. The same small controls appeared on desktop `1280x900`. Public nav and fallback photo-list links in the same probe were 44 px or larger; the only public-route undersized controls came from the embedded Leaflet UI, ignoring the expected off-screen skip links.

Failure scenario: a visitor using touch, tremor-prone input, or magnification on the map route can miss or accidentally activate the map's zoom/marker/attribution controls. This violates the repo's stricter 44 px target policy and weakens WCAG 2.2 target-size ergonomics on a public route.

Suggested fix: disable Leaflet defaults where possible and render custom 44 px zoom controls plus a larger custom marker hit area, or apply scoped Leaflet CSS that preserves visual size while expanding hit boxes. Keep the existing skip link and fallback list; they are useful mitigations, not replacements for visible target sizing.

### DES-C19-02 - Admin photo management is still a horizontal table rather than a photo workbench

Severity: Medium
Confidence: High
Status: Confirmed by source; authenticated browser validation pending
File/region: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`; `apps/web/src/components/image-manager.tsx:427-604`.

Why this is real: the dashboard places upload and image management side by side only at `2xl`; otherwise the recent uploads panel is a constrained `overflow-auto` container. `ImageManager` then renders a wide table with separate preview, title, filename, topic, tags, gamut, date, and far-right action columns. Preview is fixed at `128x128`; tags require a `min-w-[200px]` cell; actions sit at the row edge.

Failure scenario: an admin reviewing a batch on a laptop, tablet, or split-screen desktop must pan between thumbnail, metadata, tags, and actions. That slows visual quality-control and raises the chance of editing or deleting the wrong row because the visual object and action controls are spatially distant.

Suggested fix: below wide desktop, switch recent uploads to a photo-first card/list workbench: larger thumbnail, title/filename/topic grouped beside the image, status chips near the preview, tags as a wrapped region, and edit/delete/share controls adjacent to the visual. Keep the dense table as an explicit large-screen compact mode.

### DES-C19-03 - Admin navigation remains one flat wrapping strip for unrelated workflows

Severity: Low-Medium
Confidence: High
Status: Confirmed by source; authenticated browser validation pending
File/region: `apps/web/src/components/admin-nav.tsx:15-49`; `apps/web/src/components/admin-header.tsx:13-26`.

Why this is real: ten admin destinations are rendered as peers in one wrapping nav: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, and analytics. The header places brand, this flat nav, and logout in a single wrapping flex row.

Failure scenario: translated labels and tablet widths can reshuffle daily publishing links, access/security links, DB operations, and analytics into a changing multi-line strip. High-risk operational pages feel as prominent as routine publishing pages, and muscle memory breaks when wrapping changes by viewport or locale.

Suggested fix: group admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights. Use a sectioned drawer or menu on mobile/tablet, while keeping the active section visible in the header.

### DES-C19-04 - SEO settings validation is toast-only and not field-addressable

Severity: Low-Medium
Confidence: High
Status: Confirmed by source; authenticated browser validation pending
File/region: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-72` and `98-184`; server validation in `apps/web/src/app/actions/seo.ts:111-140`.

Why this is real: the server action validates per-field conditions such as title length, locale format, and OG image URL format, returning specific localized errors. The client handles any failure with `toast.error(result.error || t('seo.saveFailed'))` and renders the SEO inputs without field error state, `aria-invalid`, `aria-describedby` for errors, or focus routing to the invalid field.

Failure scenario: an admin enters an invalid OG image URL or Open Graph locale, presses Save, and gets a transient toast. Keyboard and screen-reader users are not moved to the affected input, and sighted users must infer which field failed after the toast disappears.

Suggested fix: return or map server error codes to field keys, set field-level error text and `aria-invalid`, focus the first invalid field after a failed save, and keep a persistent summary near the save control. Client-side pre-validation for URL/locale format would make the failure faster, but the server must remain authoritative.

### DES-C19-05 - Password mismatch validation announces an error but does not move focus to the invalid field

Severity: Low
Confidence: Medium-High
Status: Confirmed by source; authenticated browser validation pending
File/region: `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:36-45` and `96-114`; `apps/web/src/components/ui/alert.tsx:22-34`; current source contract only checks descriptions in `apps/web/src/__tests__/password-form-a11y.test.ts:10-18`.

Why this is real: `handleSubmit` detects mismatch, sets `confirmError`, and returns without calling the server action. The confirm input gets `aria-invalid` and an error description, and `Alert` has `role="alert"`, so announcement is partially covered. There is no confirm-field ref, focus call, or selection behavior; focus remains where the submit originated.

Failure scenario: a keyboard admin submits mismatched passwords and hears/sees an error, but focus stays on the submit button or current control. They must manually locate the confirm field before correcting the mismatch.

Suggested fix: add a `confirmPasswordRef`, focus and optionally select the confirm field when mismatch is detected, and extend the existing password a11y test to assert the focus contract. This would align the form with stronger patterns already present in the login and user-create flows.

## Positive Evidence And Fixed Prior Risks

- Mobile home tag filtering is no longer the old tag wall: `TagFilter` uses a mobile `<details>` disclosure with a 44 px summary at `apps/web/src/components/tag-filter.tsx:125-143`. Local `/en` mobile showed the tag summary at `358x44` and first photo at `y=256`, not the previous full-chip wall.
- Public nav, footer, timeline, privacy, not-found, admin login, and most public links/buttons measured at or above 44 px in local browser probes. The only visible sub-44 controls were Leaflet internals on `/en/map`; off-screen skip links were intentionally 1x1 until focused.
- Search dialog source labels the dialog and combobox (`apps/web/src/components/search.tsx:425-470`) and local browser probe confirmed the dialog opens with `aria-label="Search photos"` and the combobox focused.
- Lightbox/photo viewer/info sheet have strong source evidence for keyboard handling, focus restore/body lock, reduced-motion checks, accessible close controls, and localized photo metadata: `apps/web/src/components/lightbox.tsx`, `photo-viewer.tsx`, and `info-bottom-sheet.tsx`.
- Token revoke confirmation now includes the token label (`apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:134-137` and `307-329`), category alias deletion includes the alias/topic (`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:389-396` and `431-445`), and analytics countries display localized labels plus codes (`apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:202-212`). I did not reopen those older issues.
- Theme/color/HDR support is covered by global tokens, forced-colors/reduced-motion CSS, P3/HDR display conventions, and the passing `theme-token-contract` subset. Photographer color intent guidance remains reflected in the UI source; no edit/culling/scoring UX was introduced.

## Categories Examined

Examined: information architecture, affordances, keyboard/focus navigation, WCAG 2.2/touch targets, responsive behavior, loading/empty/error states, form validation UX, dark/light/OLED/forced-colors/reduced-motion support, EN/KO i18n and future RTL direction handling, perceived performance cues, public share/photo/lightbox/search/map/privacy/error/not-found surfaces, admin login/dashboard/settings/users/tags/categories/db/tokens/SEO/analytics surfaces, public assets/service worker, and Playwright/source contracts.

Skipped or limited: protected admin routes were not browser-tested because credentials were unavailable; findings there are source-backed. RTL is a future-readiness risk rather than a current bug because `LOCALES` are `en` and `ko`, and `getLocaleDirection` currently returns `ltr` for both. Shared photo/group pages were source-reviewed but not browser-tested with a generated live share key in this pass.
