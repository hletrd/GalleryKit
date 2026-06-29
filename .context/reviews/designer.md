# Designer Review - Cycle 17

Role: designer reviewer for cycle 17/100. Scope: comprehensive UI/UX review for
the Next.js frontend, including information architecture, public/admin flows,
components, CSS/tokens, i18n/RTL, loading/empty/error states, accessibility,
keyboard/focus behavior, responsive behavior, form validation, and perceived
performance. No fixes were implemented.

## Inventory

Reviewed UI routes:

- Public: `/[locale]`, `/[locale]/[topic]`, `/[locale]/p/[id]`,
  `/[locale]/g/[key]`, `/[locale]/s/[key]`, `/[locale]/c/[slug]`,
  `/[locale]/map`, `/[locale]/timeline`, `/[locale]/year/[year]`,
  `/[locale]/privacy`, localized loading/error/not-found shells.
- Admin: `/[locale]/admin`, protected dashboard, categories, tags, SEO,
  settings, password, users, tokens, DB, analytics, protected loading/error.
- Shared components: nav, footer, search dialog, tag filter, masonry grid,
  load more, photo viewer, lightbox, info sheet, color details, histogram,
  map, upload dropzone, image manager, admin nav/header, Radix/shadcn UI
  primitives.
- Contracts: `en.json`/`ko.json`, `locale-path.ts`, `globals.css`,
  `tailwind.config.ts`, touch target audit, focus-visible scanner, a11y tests,
  Playwright public/admin specs.

Browser coverage used `agent-browser` against a local dev server. Port 3000 was
already serving a different app (`ccusage`), so GalleryKit ran on
`http://localhost:3001`. MySQL was unavailable:

```text
Could not connect to database to bootstrap queue (ECONNREFUSED).
```

Browser evidence:

- `/en/admin` rendered the login form with skip link, h1, visible labels,
  required username/password fields, password reveal button, and submit button.
- Screenshot artifact:
  `.context/reviews/ui-ux-artifacts-cycle17/admin-login-mobile.png`.
- `/en` rendered the localized error boundary rather than a gallery or empty
  state.
- `/en/no-such-page` also rendered the localized error boundary rather than the
  intended localized not-found shell.
- Protected admin routes could not be meaningfully exercised in-browser because
  auth and data access depend on the unavailable DB; those flows were inspected
  statically.

## Strengths

- The design system has strong baseline a11y contracts: 44 px Button primitives
  in `components/ui/button.tsx:23-30`, a blocking touch-target audit in
  `src/__tests__/touch-target-audit.test.ts:1-83`, and a broad hover/focus
  scanner in `src/__tests__/focus-visible-links-scan.test.ts:1-88`.
- Theme tokens cover light, dark, and OLED modes with documented contrast
  rationale in `app/[locale]/globals.css:14-101`.
- Reduced motion and forced-colors are explicitly handled in
  `app/[locale]/globals.css:253-300`.
- Search, lightbox, and load-more include focus trap/live-region patterns:
  `components/search.tsx:359-508`, `components/lightbox.tsx:430-685`,
  `components/load-more.tsx:146-158`.
- i18n key parity is currently clean: `en.json` and `ko.json` both have 810
  flattened keys in the local parity check.

## Findings

### DES17-01 - Public DB failures replace public recovery UI with a generic error shell

Severity: High
Confidence: High
Routes/selectors: `/en`, `/en/no-such-page`, `main`, `role="region" name="Error"`
Files: `apps/web/src/app/[locale]/(public)/page.tsx:151-176`,
`apps/web/src/app/[locale]/(public)/[topic]/page.tsx:166-176`,
`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-109`,
`apps/web/src/app/[locale]/error.tsx:22-53`,
`apps/web/src/app/[locale]/not-found.tsx:18-48`

Issue:

The public nav and not-found shell are designed to provide recovery, but a DB
outage throws before several public routes can render stable degraded UI. The
home page catches only the image-list query at `page.tsx:169-176`; tags, topics,
config, smart collections, topic pages, and archive-like data paths still throw.
In-browser, both `/en` and `/en/no-such-page` landed on the generic route error
boundary, which has no public nav/footer/search/locale controls.

User failure scenario:

During a DB restart or transient MySQL outage, a visitor opening the gallery or
a mistyped URL gets "Something went wrong loading this page" plus Try again /
Return to Gallery. Return to Gallery loops back to the same broken route. They
cannot search, switch locale, navigate topics, or understand whether the site is
empty, under maintenance, or broken.

Suggested fix:

Preserve the public recovery shell during data failures. Catch non-critical
public data queries (`getTagsCached`, `getTopicsCached`, `getGalleryConfig`,
smart-collection/topic list reads) into empty/default values where safe, and add
a localized maintenance/temporarily unavailable state for routes that truly
cannot render without DB data. Also consider rendering `Nav`/`Footer` inside the
localized error boundary, matching the intent already documented in
`not-found.tsx:7-11`.

### DES17-02 - Archive/year mobile cards hide photo titles before open

Severity: Medium
Confidence: High
Routes/selectors: `/en/timeline`, `/en/year/[year]`, masonry photo links
Files: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:238-267`,
`apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:196-225`,
contrast with `apps/web/src/components/home-client.tsx:393-404`

Issue:

Home and shared-group masonry cards expose a mobile title overlay
(`sm:hidden`) so touch users can identify a photo before opening it. Timeline
and year-in-review cards only render the title overlay in
`hidden ... sm:block` hover/focus content. On phones, archive cards become
image-only links.

User failure scenario:

A mobile visitor browsing a year archive sees many thumbnails but no visible
titles, topics, or dates per card. If several images look similar, the only way
to identify one is to open each photo and return, which is slow and breaks the
archive browsing workflow.

Suggested fix:

Mirror the home card pattern: add a small mobile top or bottom gradient overlay
with the display title, and keep the desktop hover/focus overlay. Ensure the
text remains truncated and contrast-safe over bright photos.

### DES17-03 - Admin create/edit validation is toast-only and not field-associated

Severity: Medium
Confidence: Medium-high
Routes/selectors: `/en/admin/categories`, `/en/admin/tags`, create/edit dialogs
Files: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:81-104`,
`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:195-213`,
`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:306-327`,
`apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52-66`,
`apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:175-180`

Issue:

Category and tag mutations return server validation errors through `toast.error`
only. The fields themselves do not receive `aria-invalid`, `aria-describedby`,
inline error text, or focus redirection. Some server-side checks are more
specific than the native `required`/`maxLength` constraints, such as slug format,
alias format, duplicate route segments, and disallowed Unicode formatting.

User failure scenario:

A keyboard or screen-reader admin enters an invalid slug in a create/edit dialog.
They hear or see a transient toast, but focus remains wherever it was and the
invalid field is not programmatically identified. Re-submitting becomes trial
and error, especially in Korean input/IME flows where the offending value may be
visually subtle.

Suggested fix:

Move these dialogs to a structured action-state pattern with field-level errors.
Render inline messages under the relevant input, set `aria-invalid`, connect via
`aria-describedby`, and focus the first invalid field after the action returns.
Keep the toast as a secondary global summary, not the only validation surface.

### DES17-04 - RTL support is documented as future-proof but direction is hardcoded LTR

Severity: Low
Confidence: High
Routes/selectors: root `<html dir>`
Files: `apps/web/src/lib/locale-path.ts:33-39`,
`apps/web/src/app/[locale]/layout.tsx:93-100`

Issue:

The root layout sets `dir={getLocaleDirection(locale)}` and the comment says it
future-proofs RTL locales, but `getLocaleDirection` always returns `'ltr'`.
This is correct for the current supported locales (`en`, `ko`), but the helper
name and layout comment can create false confidence when a future RTL locale is
added.

User failure scenario:

If Arabic or Hebrew is added to `LOCALES`, pages will still render LTR. Reading
order, punctuation flow, nav alignment, focus expectations, and form layout will
be wrong across the app even though the root layout appears to have a direction
hook.

Suggested fix:

Implement an explicit RTL locale set, add a unit test for `getLocaleDirection`,
and include at least one RTL smoke render before adding any RTL locale. Until
then, adjust the comment to state that only current LTR locales are supported.

## Additional Coverage Notes

- Information architecture: public IA is clear and consistent around gallery,
  topic, photo, share, map, timeline, and admin surfaces. Admin nav exposes all
  major operational areas in `components/admin-nav.tsx:15-26`.
- Affordances: public nav, footer, search trigger, theme/locale buttons, photo
  toolbar, lightbox controls, map list links, and admin actions have clear labels
  and focus styles in source.
- Keyboard/focus: skip links target `#main-content` in public and admin layouts;
  search and lightbox use focus traps and restore focus; focus-visible scanner
  covers `Link`/`a`/raw `button` hover affordances.
- WCAG contrast: core tokens and destructive text are documented; HDR gradient
  contrast is pinned by `hdr-badge-contrast.test.ts`.
- Responsive: public home/photo/nav are mobile-aware. Admin tables are mostly
  desktop-density surfaces; categories/tags/analytics use horizontal overflow,
  and dashboard wraps `ImageManager` in an overflow container.
- Loading/empty/error: loading states use `role="status"` in key components;
  empty gallery/search/map/admin-table states exist. The main gap is the DB
  failure path in DES17-01.
- Forms: login and image edit have visible labels and inline/alert errors.
  Category/tag create/edit dialogs need stronger field-level validation UX.
- Dark/light/OLED: tokenized through `next-themes`; screenshot was captured in
  light mode only because DB blocked the richer public surfaces.
- i18n: English/Korean key parity passed locally; Korean plural asymmetry is
  documented in `CLAUDE.md`. RTL is not implemented beyond the root `dir` hook.
- Perceived performance: masonry uses responsive srcsets, lazy/eager priority,
  `content-visibility`, blur placeholders, and reduced-motion handling. Map CSS
  is route-chunked through the dynamic map component.

## Validation

- Read `AGENTS.md` and `CLAUDE.md`.
- Used `agent-browser` skills/CLI for navigation, snapshots, interaction, mobile
  viewport, and screenshot capture.
- Started local dev server with `npm run dev --workspace=apps/web`; server ran
  at `http://localhost:3001`.
- Captured and inspected
  `.context/reviews/ui-ux-artifacts-cycle17/admin-login-mobile.png`.
- Static sweeps covered `aria-*`, `role=`, `tabIndex`, `focus-visible`,
  `sr-only`, `aria-live`, loading/empty/error states, forms, tables, i18n keys,
  RTL helper, design tokens, and e2e/a11y tests.

Not run: full lint/typecheck/build/test suite. This was a read-only designer
review, and DB unavailability prevented full browser coverage of authenticated
admin and data-backed public flows.
