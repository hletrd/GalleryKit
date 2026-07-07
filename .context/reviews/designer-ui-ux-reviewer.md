# Cycle 12 Designer / UI-UX / Product Messaging Review

Date: 2026-07-07  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Mode: review-only. I did not edit application source, start containers, touch MySQL containers, deploy, remove files, or mutate production data. This review file is the only intended write.

## Inventory

- Control docs read first: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, relevant prior `.context/reviews/*` UI/UX and product-marketing artifacts.
- Public UI reviewed: localized layout, nav/footer, home/topic/smart collection/share/photo/map/timeline/year/about/privacy/not-found/error routes; `home-client`, `masonry-card`, `tag-filter`, `search`, `photo-viewer`, `photo-navigation`, `lightbox`, `info-bottom-sheet`, `similar-photos`, `map-loader`, loading/error components.
- Admin UI reviewed by source: login, dashboard/image manager, categories, tags, SEO, settings, tokens, users, password, DB, analytics, admin nav/header, form primitives.
- Systems reviewed: design tokens/theme CSS, reduced motion/forced-colors rules, i18n messages and locale direction plumbing, a11y/focus/touch/contrast tests, e2e specs.
- Runtime/browser evidence: local dev could not be used because Next reported a stale existing dev lock for PID `57860` on `localhost:3000`, but that PID no longer existed and `localhost:3000` refused connections. Starting `next dev --port 3001` was also blocked by the same lock. I used the documented live demo `https://gallery.atik.kr` for read-only browser/DOM/accessibility evidence with `agent-browser`.

## Validation Evidence

- Live `/en` mobile `390x844`: accessibility snapshot showed skip link, main nav, search/theme/locale controls, `main`, H1, tag filter, photo links, load-more, footer, notification region. DOM metrics: document width 390, body width 390, no unnamed visible controls, no visible sub-44 px controls except the 1x1 skip link while unfocused.
- Live `/en/p/348`: accessibility snapshot showed H1, shortcut hint, Back, fullscreen, Info, Next photo, and named zoom button. Cleared console/page-error buffers did not reproduce the historical photo-viewer hydration mismatch.
- Live `/en`: semantic search API smoke `POST /api/search/semantic` with `Origin: https://gallery.atik.kr`, query `TWS`, returned 200 with real results.
- Targeted tests passed: `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/hdr-badge-contrast.test.ts src/__tests__/theme-token-contract.test.ts` -> 6 files, 47 tests passed.

## Findings

### C12-UX-01 - Public map and timeline are implemented and marketed, but undiscoverable from normal public navigation

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Areas: information architecture, product messaging, public visitor workflow
- Evidence:
  - `README.md:36` names "map/timeline browsing" as part of the visitor experience.
  - Map route exists and renders a public page/list fallback at `apps/web/src/app/[locale]/(public)/map/page.tsx:68`.
  - Timeline route exists and renders year/month browsing at `apps/web/src/app/[locale]/(public)/timeline/page.tsx:61`.
  - Primary nav renders only topic links plus search/theme/locale controls at `apps/web/src/components/nav-client.tsx:128` and `apps/web/src/components/nav-client.tsx:167`.
  - Footer links About, Privacy, GitHub, Admin only at `apps/web/src/components/footer.tsx:41`.
  - The only source-level Timeline link is conditional on same-day photos; `OnThisDayWidget` returns `null` when empty at `apps/web/src/components/on-this-day-widget.tsx:24`, and its Timeline link is inside that optional widget at `apps/web/src/components/on-this-day-widget.tsx:39`.
  - Live DOM on `/en`: `mapLinks: []`, `timelineLinks: []`; nav visible text was `ATIK.KR Gallery`, `TWS`, `TOMORROW X TOGETHER`, `KO`.
- Failure scenario: A demo visitor or README evaluator expects map/timeline browsing, lands on the gallery, and has no visible route to either feature unless they know the URL or happen to visit on a day with `OnThisDayWidget` content.
- Suggested fix: Add persistent secondary navigation links for Map and Timeline, probably in the footer and optionally in the public nav overflow. If they are intentionally secondary, the About page should also link them and set expectations for GPS-topic visibility.

### C12-UX-02 - Production semantic search is active but hidden behind an icon-only nav affordance

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Areas: product messaging, affordance clarity, discoverability
- Evidence:
  - Semantic search is positioned as a differentiator in `README.md:48` and `apps/web/README.md:67`.
  - Live `POST https://gallery.atik.kr/api/search/semantic` returned real results for `TWS`, confirming production/demo support.
  - Closed search control is icon-only: `apps/web/src/components/search.tsx:371` renders a `Button` with `aria-label` but no visible text.
  - The semantic toggle/hint appears only after opening the modal at `apps/web/src/components/search.tsx:521`.
  - Live nav visible text does not contain "Search" or "Semantic search"; the search button outerHTML has only `aria-label="Search photos"`.
- Failure scenario: The strongest visitor-facing differentiator works, but first-time users evaluating the demo must infer that a small magnifying-glass icon opens both keyword and semantic search.
- Suggested fix: When `semanticSearchMode === 'production'`, make the nav affordance visibly say `Search` or `Search photos`, and add a compact empty-state hint such as "Keyword or semantic search" before typing. Consider a few localized prompt examples grounded in real gallery content.

### C12-UX-03 - Similar photos is documented as visitor-facing, but absent from the mobile photo info surface

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Areas: responsive behavior, feature parity, product messaging
- Evidence:
  - Docs advertise `"similar photos"` at `README.md:48` and `apps/web/README.md:67`.
  - `SimilarPhotos` is production-gated and implemented at `apps/web/src/components/similar-photos.tsx:58`, with a null return outside production at `apps/web/src/components/similar-photos.tsx:141`.
  - Desktop photo viewer mounts `<SimilarPhotos>` only inside the `lg` sidebar at `apps/web/src/components/photo-viewer.tsx:747` and `apps/web/src/components/photo-viewer.tsx:800`.
  - Mobile bottom sheet includes tags, description, color details, histogram, EXIF, capture time, GPS/admin rows, and downloads at `apps/web/src/components/info-bottom-sheet.tsx:353`, but no `SimilarPhotos` mount.
  - Live mobile `/en/p/348` snapshot exposed the Info button and photo controls, but no Similar Photos content path.
- Failure scenario: A mobile visitor opens a photo and expands Info expecting the advertised image-to-image discovery feature. It is unavailable on the primary consumption viewport even though semantic search is active.
- Suggested fix: Pass `semanticSearchMode` and `imageSizes` into `InfoBottomSheet`, then render `<SimilarPhotos>` near the description or after the histogram. If product intent is desktop-only, state that explicitly in docs and UI copy.

### C12-UX-04 - Mobile home still spends the first photo viewport on a tag-filter wall

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Areas: responsive IA, first impression, public gallery browsing
- Evidence:
  - `HomeClient` places `TagFilter` before the masonry grid at `apps/web/src/components/home-client.tsx:303` and the grid starts after it at `apps/web/src/components/home-client.tsx:318`.
  - `TagFilter` renders every tag as a wrapping button group with no collapse or overflow model at `apps/web/src/components/tag-filter.tsx:62`.
  - Live mobile `/en` at `390x844`: tag group box was `y=180`, `height=200`, `bottom=380`; first photo link started at `y=412`.
  - Live snapshot showed 9 tag buttons before the first photo.
- Failure scenario: On phones, visitors arrive to see taxonomy controls before photography. As tag count grows, the first viewport becomes filter-first rather than gallery-first.
- Suggested fix: Use a compact mobile filter model: `All` plus top 2-3 tags, a horizontal chip rail with clear overflow affordance, or a filter sheet. Preserve `aria-pressed` and 44 px targets.

### C12-UX-05 - Category, tag, and SEO save failures are still toast-only instead of persistent form errors

- Severity: Medium
- Confidence: High
- Status: Confirmed by source; authenticated admin runtime not available
- Areas: form validation UX, accessibility, keyboard recovery
- Evidence:
  - Category create/update action errors only call `toast.error(...)` at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90` and `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:108`.
  - Category create inputs have labels/required attributes, but no persistent alert, `aria-invalid`, error `aria-describedby`, or invalid-field focus target at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:204`.
  - Tag update failures are toast-only at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52`.
  - SEO save failures are toast-only at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42`.
  - The login form has the stronger local pattern: field errors, `aria-invalid`, `aria-describedby`, and `role="alert"` at `apps/web/src/app/[locale]/admin/login-form.tsx:62`, `apps/web/src/app/[locale]/admin/login-form.tsx:72`, `apps/web/src/app/[locale]/admin/login-form.tsx:78`, `apps/web/src/app/[locale]/admin/login-form.tsx:99`, and `apps/web/src/app/[locale]/admin/login-form.tsx:126`.
- Failure scenario: An admin submits a duplicate slug, invalid tag, or invalid SEO URL/locale. A transient toast appears, focus stays wherever it was, and a screen-reader or keyboard user has no persistent field-level recovery path.
- Suggested fix: Reuse the login/settings form pattern: keep form error state, render a persistent `role="alert"` inside the dialog/card, wire `aria-invalid` and `aria-describedby`, focus the first invalid field or a form-level alert, and disable/pending-label submit buttons during the action.

### C12-UX-06 - Tag autocomplete popovers can be clipped inside the admin image table scroller

- Severity: Medium
- Confidence: Medium
- Status: Likely by source topology; authenticated admin runtime validation still needed
- Areas: interaction, admin responsive behavior, table overflow
- Evidence:
  - Image manager wraps the table in `overflow-x-auto` at `apps/web/src/components/image-manager.tsx:427`.
  - Each image row renders `TagInput` inside a table cell at `apps/web/src/components/image-manager.tsx:501`.
  - `TagInput` creates a local `relative` container at `apps/web/src/components/tag-input.tsx:184`.
  - Suggestions render as an absolutely positioned child at `apps/web/src/components/tag-input.tsx:231`; `z-50` cannot escape clipping from overflow ancestors.
- Failure scenario: On tablet/laptop admin widths, typing a tag near the table scrollport edge opens a suggestion list that can be clipped by the horizontal scroller, making options partially hidden or hard to select.
- Suggested fix: Render suggestions through a portal/popover layer that escapes table overflow, or convert `TagInput` to a Radix Popover/Command-style surface. Add a regression harness that mounts it inside an overflow table wrapper.

### C12-UX-07 - Admin image management remains table-first for a photo-first workflow

- Severity: Low-Medium
- Confidence: Medium
- Status: Likely by source; authenticated admin runtime validation still needed
- Areas: admin IA, workflow ergonomics, responsive behavior
- Evidence:
  - Image manager is a horizontally scrollable table at `apps/web/src/components/image-manager.tsx:427`.
  - The table has preview, title, filename, topic, tags, gamut, date, and actions columns at `apps/web/src/components/image-manager.tsx:431`.
  - Tag editing is embedded inline inside that table at `apps/web/src/components/image-manager.tsx:501`.
- Failure scenario: An admin cleaning up a batch after upload must scan across many columns and horizontal scroll states instead of operating from photo preview plus metadata inspector. Korean labels and smaller laptop widths increase the scanning cost.
- Suggested fix: Add a workbench view: photo grid/list on one side and a sticky metadata/tags inspector on the other. Keep the dense table as an optional list view for bulk operations.

## Verified Non-Findings / Coverage

- Search duplicate accessible labels from cycle 11 are fixed: current `SearchResultItem` appends `#${image.id}` visibly and in `aria-label` at `apps/web/src/components/search.tsx:71`.
- Smart-collection delete copy no longer points admins to a phantom Collections UI. Current English/Korean messages explicitly say collections are not editable in admin UI and name `smart_collections query_json` at `apps/web/messages/en.json:506` and `apps/web/messages/ko.json:506`.
- Touch targets: live mobile DOM found no visible sub-44 px controls except the unfocused 1x1 skip link; the blocking touch-target audit passed.
- Focus/keyboard: search uses dialog + focus trap + focus restoration at `apps/web/src/components/search.tsx:411` and `apps/web/src/components/search.tsx:340`; photo/lightbox controls expose shortcut metadata where visible; focus-visible scan passed.
- WCAG contrast/theme: token comments and tests cover muted/destructive/dark/OLED contrast in `apps/web/src/app/[locale]/globals.css:29`, `apps/web/src/app/[locale]/globals.css:38`, and `apps/web/src/app/[locale]/globals.css:75`; HDR badge contrast and theme-token tests passed.
- Reduced motion: global CSS collapses animations/transitions and disables hover-scale transforms under `prefers-reduced-motion` at `apps/web/src/app/[locale]/globals.css:253`; photo viewer and lightbox also read reduced-motion preferences.
- Loading/empty/error states: map/timeline empty states, photo loading skeleton, public error/not-found shells, upload progress, search loading/empty/error, and similar-photo loading/error/empty states are present in inspected routes/components.
- Dark/light mode: theme tokens cover light/dark/OLED; live admin/mobile checks from prior cycle remain consistent, and current theme-token tests passed.
- i18n/RTL: English/Korean key parity passed. `html lang` and `dir` are wired via `getLocaleDirection` at `apps/web/src/app/[locale]/layout.tsx:101`; `RTL_LOCALES` is empty at `apps/web/src/lib/locale-path.ts:37`, which is correct for the currently shipped locales but means RTL remains future-readiness only.
- Perceived performance: live home reported `CLS=0`; source reserves photo geometry via image dimensions/aspect behavior and lazy/eager loading. Network timing on the live run was noisy (`domContentLoaded` about 8.45s), so I did not file a performance defect without a controlled trace.

## Final Missed-Issue Sweep

Swept landmarks, headings, skip links, nav/footer IA, map/timeline route discoverability, search and semantic-search messaging, mobile photo/info parity, lightbox/photo keyboard paths, focus traps/restoration, reduced motion, forced colors, dark/light/OLED tokens, touch targets, loading/empty/error states, admin validation, admin tables, upload/tag controls, i18n/RTL readiness, LCP/CLS/INP-adjacent source patterns, prior current-day UI/product reports, and BurstPick-specific prompt assumptions. I found no additional distinct issue with enough current evidence to file beyond the findings above.
