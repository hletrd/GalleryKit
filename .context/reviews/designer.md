# Designer Review - Review-Plan-Fix Cycle 2

Role: designer. Scope: UI architecture, page identity, localized interaction design, responsive/product-facing surfaces. No application code was edited.

## Inventory Coverage

Built a UI/product inventory before reviewing: 132 files under `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/i18n`, and `apps/web/messages`. Covered public routes, admin routes, localized messages, UI primitives, gallery/search/photo components, error/loading/not-found states, tests, package scripts, scripts, migrations, and current `.context` review/plan docs.

Browser automation was feasible partially. I started `npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3012` and inspected `/en`, `/ko`, and `/en/admin` at desktop and mobile widths. The DB-backed public gallery routes rendered the localized error boundary because local DB queries failed, so public gallery visual states were backed primarily by source/DOM evidence rather than full screenshot inspection. `/en/admin` rendered and exposed a generic document title.

Previously reported Cycle 1 issues were rechecked. Localized error skip targets, search option focus behavior, SEO-field descriptions, and the error document title are now covered in source/tests and were not re-filed.

## Findings

### DES-C2-01 - Admin pages do not provide route-specific document titles

Severity: Medium
Confidence: High

Evidence:
- Browser check of `http://127.0.0.1:3012/en/admin` returned document title `GalleryKit` while the visible heading was `Admin`.
- `apps/web/src/app/[locale]/layout.tsx:22-27` sets a site-level title default/template.
- `apps/web/src/app/[locale]/admin/page.tsx:6-15` renders the admin login form without `generateMetadata`.
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-17` wraps protected pages without metadata.
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx:6-9` is the only admin route currently exporting route-specific metadata.
- Admin navigation labels already exist in `apps/web/messages/en.json:2-13` and `apps/web/messages/ko.json:2-13`.

Failure scenario: an admin user working across login, dashboard, analytics, settings, users, database, SEO, and token pages sees multiple browser tabs or screen-reader page-title entries collapse to the site title instead of the active task. This makes orientation weaker in a dense operational UI and undermines the otherwise localized admin navigation model.

Suggested fix: add localized `generateMetadata` for the admin login page and every protected admin page, using the existing `nav` message namespace. Example pattern: `Admin | GalleryKit`, `Dashboard | Admin | GalleryKit`, `Database | Admin | GalleryKit`. Add a source-level test that asserts all admin page modules except explicit redirects/export-only shells provide metadata or are covered by a metadata-bearing layout.

### DES-C2-02 - Timeline and year photo cards use non-localized, non-actionable link names

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:192-193` passes hard-coded English fallback text, `Photo`, to photo title/alt helpers.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:209-212` sets the photo link accessible name to only `displayTitle`.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:151-152` uses `monthName` for the display-title fallback but hard-codes `Photo` for alt fallback.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:165-168` also labels the photo link with only `displayTitle`.
- The home grid uses the stronger localized pattern in `apps/web/src/components/home-client.tsx:291-323`: localized untitled fallback plus `aria.viewPhoto`.
- The On This Day widget follows the same localized action pattern in `apps/web/src/components/on-this-day-widget.tsx:49-59`.

Failure scenario: on Korean timeline/year pages, untitled or untagged photos can expose English fallback text such as `Photo` in image alt text or link names. Screen-reader users also hear bare titles rather than an action-oriented label equivalent to "View photo: {title}", which is inconsistent with the primary gallery grid.

Suggested fix: load localized `common`/`aria` strings, or add timeline-specific equivalents, then pass localized photo/untitled fallbacks into the helpers and set link labels through the same action template used by the home grid. Add a focused regression test that scans localized public photo-card routes for hard-coded `'Photo'` fallbacks and bare `aria-label={displayTitle}` links.

## Missed-Issues Sweep

I re-ran source searches around focusable `role="option"` links, error boundaries, touch target primitives, route metadata, hard-coded English fallbacks, and admin navigation/title coverage. No additional designer-level blockers were found within the inventory. Residual risk is concentrated in DB-backed public gallery states that could not be fully rendered locally because the dev server returned DB query errors for `/en` and `/ko`.
