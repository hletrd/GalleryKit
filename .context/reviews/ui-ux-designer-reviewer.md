# UI/UX Designer Reviewer - Review-Plan-Fix Cycle 2

Role: ui-ux-designer-reviewer. Scope: accessible page structure, localized UX, focus/keyboard behavior, responsive/product-facing UI states, and browser-observable evidence. No application code was edited.

## Inventory Coverage

Inventory was built before review: 132 UI/product-facing files under `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/i18n`, and `apps/web/messages`. I inspected package metadata/scripts, source routes/components, tests, scripts, migrations, and current `.context` review/plan docs. Covered public gallery, photo, topic, smart collection, timeline, year, map, admin, error/loading/not-found, i18n, and UI primitive surfaces.

Browser automation evidence:
- Started `npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3012`.
- Inspected `/en`, `/ko`, and `/en/admin` at desktop/mobile widths with DOM/accessibility/title checks.
- `/en` and `/ko` rendered localized error boundaries because local DB queries failed; both exposed a single `main` region and localized document titles.
- `/en/admin` rendered sign-in controls and reported document title `GalleryKit`.
- No screenshot-based visual verdict was possible for DB-backed gallery states; findings below use source, DOM, accessibility, and computed route evidence.

## Findings

### UX-C2-01 - Admin routes lack accessible, task-specific page titles

Severity: Medium
Confidence: High

Evidence:
- Browser DOM/title check on `/en/admin`: title `GalleryKit`; visible h1 `Admin`; controls included `Show password` and `Sign in`.
- `apps/web/src/app/[locale]/layout.tsx:22-27` supplies the default site title/template.
- `apps/web/src/app/[locale]/admin/page.tsx:6-15` renders the login page without route metadata.
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-17` does not set metadata for the admin section.
- `rg -n "generateMetadata|metadata" apps/web/src/app/[locale]/admin` found only `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx:6-9`.

Failure scenario: keyboard and assistive-technology users navigating admin tabs cannot use browser titles or screen-reader title announcements to distinguish sign-in, dashboard, analytics, database, SEO, settings, users, and password pages. This is a page-title usability failure even when each page has a visible heading.

Suggested fix: add localized metadata to admin routes. Use existing `nav` messages and assert that admin login/protected pages expose titles such as `Admin | GalleryKit`, `Dashboard | Admin | GalleryKit`, and `Database | Admin | GalleryKit`. Add a test that enumerates admin route modules and fails when a rendered page can inherit only the root title.

### UX-C2-02 - Timeline/year photo links do not match the localized accessible-name pattern

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:192-193` hard-codes English fallback `Photo` for display title and alt text.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:209-212` sets link `aria-label={displayTitle}`.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:151-152` uses `monthName` as display fallback but hard-codes English `Photo` as alt fallback.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:165-168` sets link `aria-label={displayTitle}`.
- The home grid uses localized fallbacks and an action label in `apps/web/src/components/home-client.tsx:291-323`.
- The On This Day widget uses localized fallbacks and `viewPhotoAria` in `apps/web/src/components/on-this-day-widget.tsx:49-59`.

Failure scenario: in the Korean UI, an untitled/no-tag timeline photo can produce English alt/link fallback text. In both locales, a screen-reader link list can expose title-only links instead of action-oriented "view photo" names, making the timeline/year grids less consistent than the main gallery.

Suggested fix: reuse the home grid accessible-name pattern on timeline/year cards: localized untitled/photo fallback text plus a localized view-photo aria template. Add a regression test for timeline/year route source or rendered markup that rejects hard-coded English fallback strings and bare title-only photo link labels.

## Non-Findings Rechecked

- Error boundary skip target/title: fixed in `apps/web/src/app/[locale]/error.tsx` and covered by tests.
- Search result `role="option"` links: no current keyboard/focus defect; source now keeps result links out of the tab order and tests cover the exception.
- SEO form descriptions: controls now use `aria-describedby` and source tests cover expected hint wiring.
- Touch target system: UI primitives and audit tests continue to enforce the 44 px minimum at the source/test level.

## Missed-Issues Sweep

Final sweep covered route metadata, focus labels, hard-coded English UI fallbacks, localized message availability, public/admin route structure, and prior review findings. No additional UI/UX defects were found within the inventory. Remaining risk is limited to visual states that require a working local DB: loaded gallery grids, empty gallery states, search results with real data, and photo-viewer interactions.
