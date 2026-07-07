# GalleryKit Designer UI/UX Review - Cycle 14

Date: 2026-07-07
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `14d31ea4`
Reviewer lane: designer + UI/UX + local product-marketer reviewer
Mode: read-only review. The only write performed by this pass is this report.

## Instructions And Local Reviewer Prompts

Read and followed:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`
- `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`
- Playwright/agent-browser skill guidance for local browser automation

The two local reviewer prompts are BurstPick-specific, so I used them as review rigor/persona guidance rather than importing BurstPick product assumptions into GalleryKit.

## Review Inventory

I first built an inventory of review-relevant files, then inspected the current implementation across the relevant surfaces rather than sampling a subset:

- Public localized app routes under `apps/web/src/app/[locale]/(public)/**`
- Admin routes under `apps/web/src/app/[locale]/admin/**`
- Shared UI and feature components under `apps/web/src/components/**`
- Theme/global interaction CSS under `apps/web/src/app/globals.css`
- Public and admin locale messages in `apps/web/messages/en.json` and `apps/web/messages/ko.json`
- UI, accessibility, i18n, theme, lightbox, touch-target, and e2e tests under `apps/web/src/__tests__/**` and `apps/web/e2e/**`
- Prior local review history under `.context/reviews/**` and deferred cycle notes under `.context/plans/**`

The main UI inventory contained 108 public/admin/component files. Route handlers and nonvisual utilities were reviewed only where they shaped UI states, validation, labels, performance, or accessibility.

## Browser And Verification Evidence

Current-checkout local browser validation was attempted, but `npm run start --workspace=apps/web` returned HTTP 500s because the local MySQL dependency was unavailable at `127.0.0.1:3306`. I stopped only the local `next start` process I launched for this review. No containers were stopped or removed.

Because local runtime was blocked by the DB dependency, I used source inspection plus tests as the authority for current HEAD, and used live browser automation at `https://gallery.atik.kr` only as supplemental behavior evidence. Production may lag HEAD.

Live browser routes checked with Playwright-style automation:

- `/en`, `/ko`, `/en/p/348`, `/en/map`, `/en/timeline`, `/en/privacy`, `/en/about-gallerykit`, `/ko/admin` at mobile 390 x 844, dark mode, reduced motion
- `/en` at desktop 1440 x 900

Observed live behavior:

- All checked routes returned 200.
- Each route had one `main` landmark.
- `html lang` matched locale for English and Korean; `dir` was `ltr`.
- No page-level horizontal overflow was detected on checked mobile routes.
- No unnamed visible buttons were found on checked public routes.
- Search dialog used `role="dialog"` and `aria-modal="true"`, focused the search input on open, restored focus to the Search trigger on Escape, and returned distinct search option labels such as `#JIHOON #348`.
- Mobile nav tab order matched the visual order in current source: skip link, brand, search, theme, locale, expand menu, then nav links.

Targeted current-HEAD tests run:

```text
npm test --workspace=apps/web -- --run \
  src/__tests__/touch-target-audit.test.ts \
  src/__tests__/focus-visible-links-scan.test.ts \
  src/__tests__/i18n-key-parity.test.ts \
  src/__tests__/password-form-a11y.test.ts \
  src/__tests__/theme-token-contract.test.ts \
  src/__tests__/lightbox-controls-contract.test.ts
```

Result: 6 test files passed, 44 tests passed.

## Confirmed Findings

### DES-C14-01 - Mobile Home Still Puts A Full Tag Wall Before The First Photo

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/components/home-client.tsx:287-305` renders the header and `TagFilter` before the photo grid.
- `apps/web/src/components/home-client.tsx:318-330` starts the masonry grid only after the tag filter.
- `apps/web/src/components/tag-filter.tsx:62-122` renders all topic/tag chips as a wrapping `role="group"` with no collapse, overflow rail, prioritization, or "more" affordance.
- Live `/en` mobile supplemental check: the first photo began around y=412 on a 390 x 844 viewport, after a multi-row filter block; the mobile tab sequence reached many filter chips before content.

Problem:

The homepage's primary product value is the photo collection, but on mobile the top of the page is dominated by filters. This creates a browsing-first IA mismatch: visitors who came to see images must scroll or tab through a dense chip wall before reaching the gallery.

Concrete user failure scenario:

A mobile visitor opens the gallery from a shared link or social profile, expects photos immediately, and instead sees nav plus many tags. A keyboard or switch user must traverse the chip group before the first image card, making the first meaningful content feel delayed.

Suggested fix:

Keep a small, high-value filter affordance above the grid and move the full taxonomy into a collapsible sheet, horizontal filter rail, or "Filters" control. Prioritize "All" and a few active/recent tags in the first viewport, then expose the full list on demand. Preserve chip semantics and 44 px targets.

### DES-C14-02 - Admin Create/Edit Failures Remain Toast-Only Instead Of Field-Linked Validation

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-105` handles create failure with `toast.error(...)`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:109-124` handles update failure with `toast.error(...)`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:145-160` handles alias failure with `toast.error(...)`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:205-223` create form fields do not render persistent server error text, `aria-invalid`, or `aria-describedby`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:363-383` edit form fields also lack field-linked server error affordances.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:404-423` alias add input has no field-linked error state.
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:53-67` update failure is toast-only.
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:176-181` edit controls lack field-linked server error affordances.
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-70` save failure is toast-only.
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:98-184` SEO fields provide help text, but not persistent server-error states or invalid-field focus.

Problem:

Toast-only validation is easy to miss, disappears from the visual context, and does not reliably connect the failure to the control that needs correction. This is especially weak for duplicate names/slugs, alias normalization, and SEO metadata where the invalid field may not be obvious.

Concrete user failure scenario:

An admin tries to rename a tag to an existing slug or add an invalid category alias. A toast appears briefly while focus remains on the submit button or elsewhere. If the admin misses the toast, uses a screen reader after the toast expires, or is working in a long form, they do not know which input needs correction.

Suggested fix:

Store server validation errors in component state and render persistent inline errors next to the relevant input. Set `aria-invalid="true"` and `aria-describedby` on affected controls, move focus to the first invalid field after submit failure, and keep the toast only as a secondary global notification.

### DES-C14-03 - Tag Autocomplete Can Be Clipped Inside The Admin Image Table Scrollport

Severity: Medium
Confidence: Medium
Status: Likely issue from current DOM/CSS structure; needs authenticated visual confirmation

Evidence:

- `apps/web/src/components/image-manager.tsx:427-452` wraps the admin image table in `overflow-x-auto`.
- `apps/web/src/components/image-manager.tsx:501-534` embeds `TagInput` inside each table row's tags cell.
- `apps/web/src/components/tag-input.tsx:184` positions the tag input container as `relative`.
- `apps/web/src/components/tag-input.tsx:231-234` renders suggestions as an absolutely positioned `top-full` child with `z-50`.

Problem:

The autocomplete popup is positioned inside the row/cell subtree that also lives inside a horizontally scrollable table wrapper. A high `z-index` does not escape an overflow clipping ancestor. On narrower admin viewports, the suggestion list can be partially hidden or require horizontal scrolling while the user is trying to pick a tag.

Concrete user failure scenario:

An admin edits tags for a photo on a tablet-width screen. They type a tag prefix, but the suggestion popup opens near the lower or right edge of the table scroll area and is clipped. The admin cannot see all options or misinterprets the field as having no matching tags.

Suggested fix:

Render suggestions through a portal/popover primitive that positions relative to the input but escapes the table scroll container, or redesign row editing so tag editing happens in an inspector/drawer outside the overflow table. Verify with keyboard arrows, Escape, outside click, and touch selection.

### DES-C14-04 - Admin Recent Uploads Still Uses A Dense Metadata Table As The Primary Photo Workbench

Severity: Medium
Confidence: Medium-High
Status: Confirmed from source; authenticated workflow needs hands-on validation

Evidence:

- `apps/web/src/components/image-manager.tsx:427-452` uses a multi-column table with Preview, Title, Filename, Topic, Tags, Gamut, Date, and Actions.
- `apps/web/src/components/image-manager.tsx:473-553` packs image preview, metadata, category select, tag editor, and actions into each row.
- `apps/web/src/components/image-manager.tsx:497-499` truncates filenames in a narrow cell.
- `apps/web/src/components/image-manager.tsx:501-534` embeds tag editing inside the table row.

Problem:

For a photographer-facing admin tool, the main post-upload task is photo review and metadata cleanup. A dense horizontal table makes visual comparison, photo identity, and repeated metadata edits harder than a photo-first grid/list with an inspector. This is an IA and affordance issue, not just a styling issue.

Concrete user failure scenario:

After uploading a batch, the photographer wants to quickly identify images, assign categories, and fix tags. They must scan small thumbnails and horizontally dense rows, losing visual context and repeatedly interacting with cramped controls.

Suggested fix:

Make the default admin upload management view photo-first: larger thumbnails in a grid/list, visible key metadata, and a side drawer or inline detail panel for category/tags. Keep the table as an optional dense mode for power users if needed.

### DES-C14-05 - Admin Navigation Remains A Flat Ten-Link Wrap

Severity: Low-Medium
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/components/admin-nav.tsx:15-26` defines ten top-level nav links in one flat array.
- `apps/web/src/components/admin-nav.tsx:28-49` renders them as a single wrapping nav list.
- `apps/web/src/components/admin-header.tsx:13-27` places the nav and logout in a wrapping header row.

Problem:

The admin IA exposes operational, content, analytics, system, and account surfaces as one flat cluster. On smaller widths or in Korean labels, the wrap order changes the perceived grouping and makes repeated admin tasks harder to locate.

Concrete user failure scenario:

An admin moving between upload management, tags, SEO, database, and settings must visually rescan the entire link cluster each time. On narrow screens the row wraps, so spatial memory is unstable.

Suggested fix:

Group admin navigation into stable sections such as Content, Discovery, System, and Account. Use a persistent sidebar on desktop and a drawer/segmented menu on mobile, preserving visible current-page state and 44 px touch targets.

### DES-C14-06 - The Long Settings Form Has Only A Top Save Action

Severity: Low-Medium
Confidence: Medium
Status: Confirmed

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:316-330` renders the Save button in the top header action area.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:731-858` continues through lower settings sections such as slideshow, auto alt text, and semantic search without a repeated or sticky save action near the bottom.

Problem:

The settings page is long and contains high-consequence toggles. When users change a lower section, the action needed to persist the change is off-screen, increasing the chance of unsaved changes or unnecessary scrolling.

Concrete user failure scenario:

An admin scrolls to semantic search settings, changes activation or model/weight controls, then pauses. There is no nearby save affordance, so they may navigate away assuming the setting applied or need to scroll back to the top to commit it.

Suggested fix:

Add a sticky bottom action bar or a repeated Save button after the final settings group. Include dirty-state messaging and leave/reset actions so admins can see whether changes are pending.

### DES-C14-07 - Truncated Technical Values Still Rely On Mouse-Only Native `title`

Severity: Low-Medium
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/components/info-bottom-sheet.tsx:413-423` truncates camera/lens values and exposes full text only through `title`.
- `apps/web/src/components/photo-viewer.tsx:803-812` repeats the same camera/lens truncation pattern.
- `apps/web/src/components/upload-dropzone.tsx:535-538` truncates uploaded filenames and exposes full text only through `title`.
- `apps/web/src/components/image-manager.tsx:497-499` truncates filenames and exposes full text only through `title`.

Problem:

Native `title` is not a reliable disclosure mechanism for touch users, keyboard users, or many assistive technology users. Technical values such as long lens names and filenames are often the exact data an admin or photographer needs to verify.

Concrete user failure scenario:

A mobile admin reviews uploaded files with similar filenames or a photographer checks lens metadata in the lightbox. The visible text is truncated, and there is no keyboard/touch-accessible way to reveal the full value.

Suggested fix:

Prefer wrapping for metadata where space allows. Where truncation is required, provide a focusable tooltip/disclosure, copy affordance, or details row that is available to keyboard and touch users. Keep `title` only as a supplemental hint.

## Likely Issues And Risks Needing Manual Validation

- Authenticated admin visual workflows could not be exercised against current HEAD because local runtime required MySQL and no authenticated browser session was available. The admin findings above are source-backed, but layout severity should be rechecked in an authenticated local or staging session.
- Large production data sets for `/map`, `/timeline`, and search should still be manually profiled for perceived performance. The checked public routes had no obvious page errors or overflow, but source and live checks here do not prove LCP/INP under the largest realistic photo corpus.
- RTL is not currently a supported product locale. Current layout correctly sets `lang` and `dir` for supported English/Korean, and tests treat Arabic as `ltr`; adding a real RTL locale would require a dedicated layout, icon-direction, carousel, map, and lightbox audit.
- Live production showed a 40 x 44 Search trigger in one mobile measurement, but current HEAD source uses `h-11 w-11` and the current touch-target audit passed. Treat that as a possible deployment lag, not a current source finding; recheck after the next deploy if users report touch misses.

## Verified Closed Or Not Findings This Cycle

- Mobile nav focus order is fixed in current source: `apps/web/src/components/nav-client.tsx` renders controls before the mobile expand toggle, and live tab order matched the visual order.
- Category and tag delete confirmations now name the target item rather than showing only a generic destructive prompt.
- Toasts now expose a close button and longer duration through `apps/web/src/components/ui/sonner.tsx`.
- Table header cells now set `scope="col"` through `apps/web/src/components/ui/table.tsx`.
- Search result option labels are distinct enough for repeated tags; live `#JIHOON` results included unique photo identifiers.
- Search dialog focus management worked in the live browser check: focus moved into the dialog and returned to the trigger on Escape.
- Theme, reduced-motion, focus-visible, forced-colors, and lightbox control contracts are covered by current CSS/tests and passed targeted verification.
- Product/marketing surface did not overpromise editing, culling, scoring, proofing, or plugin capabilities in the inspected README/About/messages. The public About copy describes the product as a publishing/gallery system, which matches the implementation direction.

## Final Sweep

The final sweep rechecked commonly missed UI issues against the inspected inventory:

- Information architecture: findings filed for public home filter hierarchy and admin nav/workbench structure.
- Affordances: findings filed for tag autocomplete clipping, settings save placement, and truncated value disclosure.
- Keyboard/focus navigation: current public search and nav behavior were verified; admin form invalid-focus remains a finding.
- WCAG 2.2 contrast/ARIA/focus traps/reduced motion: targeted tests passed; toast-only validation and `title`-only disclosure remain accessibility gaps.
- Responsive breakpoints: public mobile routes had no horizontal overflow; admin table/nav/settings risks remain source-backed.
- Loading/empty/error states: route loading shells exist; field-specific admin error states remain weak.
- Form validation UX: confirmed issue filed for category/tag/SEO admin forms.
- Dark/light mode: token and theme contract tests passed.
- i18n/RTL: English/Korean parity passed; RTL remains a future-locale risk rather than a current defect.
- Perceived performance: no page errors or obvious layout overflow in live public checks; large-corpus map/timeline/search performance remains a manual validation risk.
- Product/marketing mismatch: no current mismatch found.

Skipped files: no review-relevant public/admin/component files were intentionally skipped. Nonvisual server-only code was only inspected where it affected UI labels, validation, loading/error states, accessibility, or performance.
