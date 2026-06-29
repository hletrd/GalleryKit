# Product Marketer Review - Review-Plan-Fix Cycle 2

Role: product-marketer-reviewer. Scope: product promise, positioning, share metadata, localized copy consistency, admin/product-facing credibility. No application code was edited.

## Inventory Coverage

Built the UI/product inventory first: 132 files across app routes, components, i18n setup, and localized messages. I also inspected current HEAD/package metadata, Next.js scripts, tests, scripts, migrations, and current `.context` reviews/plans. Product-positioning checks focused on public gallery surfaces, timeline/year-in-review, share/social metadata, admin copy, localized messages, and the standing product rule that the gallery must not drift into edit/culling/scoring features.

Browser automation: a local Next dev server ran on `127.0.0.1:3012`. `/en` and `/ko` rendered localized error boundaries because local DB-backed queries failed; `/en/admin` rendered and exposed the generic title `GalleryKit`. Findings below are therefore backed by source evidence plus the available DOM/title check rather than screenshot-based visual comparison.

## Findings

### PM-C2-01 - Admin product surfaces lose page identity in browser titles

Severity: Medium
Confidence: High

Evidence:
- Browser check: `/en/admin` document title was `GalleryKit`, while the page content was the admin sign-in surface.
- `apps/web/src/app/[locale]/layout.tsx:22-27` defines only the site-level title default/template.
- `apps/web/src/app/[locale]/admin/page.tsx:6-15` has no metadata for the sign-in route.
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:5-17` does not set an admin title frame for protected routes.
- Only `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx:6-9` has localized admin metadata.
- Localized admin labels are already available in `apps/web/messages/en.json:2-13` and `apps/web/messages/ko.json:2-13`.

Failure scenario: GalleryKit presents a polished operational product, but tab titles for login/dashboard/settings/database/SEO work do not communicate the current task. That makes the admin experience feel less deliberate and reduces confidence when users juggle multiple operational tabs.

Suggested fix: give every admin route a localized product/task title using existing `nav` strings. Recommended pattern: `{Task} | Admin | {Site title}`. Add a metadata coverage test for admin routes so new operational pages cannot silently inherit only the root title.

### PM-C2-02 - Timeline and year-in-review pages miss social preview metadata

Severity: Low
Confidence: High

Evidence:
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:26-30` returns title, description, and alternates only.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-41` also returns title, description, and alternates only.
- The home page already emits rich Open Graph/Twitter metadata in `apps/web/src/app/[locale]/(public)/page.tsx:125-145`.
- Topic pages emit rich Open Graph/Twitter metadata in `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:101-125`.
- Smart collections emit at least configured OG fallback metadata in `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:46-74`.

Failure scenario: "Timeline" and "{year} in review" are naturally shareable, product-defining browsing moments, but social cards can fall back to a generic site preview. That weakens the product promise when a photographer or client shares a year recap.

Suggested fix: add Open Graph and Twitter metadata to timeline/year pages. Prefer a representative latest/year photo via the existing `/api/og/photo/{id}` pattern when available, with `seo.og_image_url` or a generated gallery card as fallback. Keep the copy localized through the existing `timeline` namespace.

### PM-C2-03 - Invalid year metadata returns English copy on localized routes

Severity: Low
Confidence: High

Evidence:
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:22-25` returns `{ title: 'Not Found', robots: { index: false, follow: false } }` before loading locale/messages.
- Localized not-found copy already exists for topic pages in `apps/web/messages/en.json:666-667` and `apps/web/messages/ko.json:666-667`.

Failure scenario: a malformed Korean URL such as `/ko/year/not-a-year` can expose an English document title in browser chrome and search/debug previews. The visible 404 body may be localized later, but the metadata itself breaks the localized brand presentation.

Suggested fix: resolve the locale and localized not-found title before returning invalid-year metadata, or centralize a localized not-found metadata helper used by topic/year public routes.

## Positioning Notes

No current copy was found that contradicts the "photo delivery, not editing/culling/scoring" product constraint. Existing public copy remains oriented around gallery browsing, sharing, tags, topics, timeline, maps, and admin operations.

## Missed-Issues Sweep

I rechecked prior product/SEO notes, route metadata patterns, localized strings, social-card metadata, and hard-coded English fallbacks. No additional product-marketing blockers were found within the inventory. Remaining risk is visual/social-card rendering quality because local public pages could not fully render against a working DB in this review lane.
