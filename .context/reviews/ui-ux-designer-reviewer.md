# Cycle 25 UI/UX Designer Reviewer - GalleryKit

Date: 2026-06-30
Repo: `/Users/hletrd/flash-shared/gallery`
Commit reviewed: `4cb1258b`
Role: UI/UX/accessibility reviewer

## Runtime Coverage And Blockers

- Started the Next.js app with `PORT=3001 npm run dev --workspace=apps/web`; Next 16 dev server reached `http://localhost:3001`.
- Port 3000 was already occupied by an unrelated auth/device-login service, so runtime review used port 3001.
- MySQL was not available locally. Runtime requests logged `ECONNREFUSED 127.0.0.1:3306`, including the public home page queries for topics/images and admin login queries.
- Browser coverage completed where feasible:
  - `/en` rendered the global error page with heading `Error`, message `Something went wrong loading this page.`, `Try again`, and `Return to Gallery`.
  - `/en/admin` rendered the login form with labelled username/password fields and password visibility toggle; login could not complete because DB access failed.
  - `/en/privacy` rendered without DB and was used for navigation, search dialog, light/dark, desktop/mobile, and accessibility-tree inspection.
  - Search dialog runtime inspection confirmed background content remained exposed in the accessibility tree while the modal was open.
- Validation not run: full lint/typecheck/build/test/e2e. This was a review-only pass and the dev DB was unavailable.

## UI Inventory

Reviewed route surfaces:
- Public app routes in `apps/web/src/app/[locale]/(public)/`: home, topic, collection, search/share, map, photo detail, privacy, timeline, year, loading/error/not-found, and layout.
- Admin routes in `apps/web/src/app/[locale]/admin/`: login plus protected dashboard, analytics, categories, database, settings, tags, tokens, users, password, SEO, and admin layout.
- API-facing UI contracts where they affect states: search, load-more, auth/login, admin restore/backfill, upload, and public gallery listing.

Reviewed UI implementation surfaces:
- Components in `apps/web/src/components/`: navigation/search, home client/masonry, photo viewer, lightbox, image zoom, info bottom sheet, load more, upload dropzone, image manager, admin nav/header, tag input, and shared UI primitives.
- Styling and tokens in `apps/web/src/app/[locale]/globals.css`, `apps/web/tailwind.config.ts`, and `apps/web/src/components/ui/*`.
- Localization in `apps/web/messages/en.json` and `apps/web/messages/ko.json`; layout locale/RTL handling in `apps/web/src/app/[locale]/layout.tsx`.
- Assets in `apps/web/public/`: fonts, icons, manifest/service worker, resources, uploaded/generated public media paths.
- Existing QA artifacts/tests in `apps/web/e2e/` and `apps/web/src/__tests__/`, including touch target, focus, lightbox, i18n parity, admin settings, search, privacy, and upload-oriented tests.

## Findings

### 1. High - Modal background remains exposed to assistive technology

Severity: High
Confidence: High
Area: Keyboard/focus, WCAG 2.2 modal semantics, screen-reader navigation

Evidence:
- Runtime browser snapshot on `/en/privacy` after opening Search showed the underlying skip link, banner/nav, main Privacy content, footer, dev tools alert, and notifications still present in the accessibility tree alongside `dialog "Search photos"`.
- Search uses a custom portal and focus trap with `aria-modal="true"` at `apps/web/src/components/search.tsx:363-524`, specifically the backdrop at `apps/web/src/components/search.tsx:365-369`, `FocusTrap` at `apps/web/src/components/search.tsx:370-377`, dialog role at `apps/web/src/components/search.tsx:378-383`, and `createPortal` at `apps/web/src/components/search.tsx:524`.
- The same custom modal pattern appears in the lightbox at `apps/web/src/components/lightbox.tsx:451-459`.
- The mobile info sheet also uses `FocusTrap` plus `role="dialog"`/`aria-modal="true"` without background isolation at `apps/web/src/components/info-bottom-sheet.tsx:185-199`.

Failure scenario:
A screen-reader user opens Search, Lightbox, or the Info bottom sheet. Tabbing is trapped, but the virtual cursor can still traverse and activate background navigation, page content, footer links, and development alerts. The page declares a modal but does not make the rest of the app inert, so the accessibility model and visual model disagree.

Suggested fix:
- Prefer the existing Radix dialog/sheet primitives for these surfaces, or add a shared modal manager that sets `inert` and an `aria-hidden` fallback on the app root/sibling trees while any custom modal is open.
- Ensure portal containers are outside the hidden subtree.
- Add a regression test that opens Search/Lightbox/Info sheet and asserts the accessibility snapshot exposes the active dialog, not background landmarks and controls.

### 2. Medium - DB outages collapse the public gallery into a generic app error

Severity: Medium
Confidence: High
Area: Empty/error states, IA, perceived reliability, public visitor UX

Evidence:
- Runtime `/en` rendered the global error page after MySQL connection failure: heading `Error`, copy `Something went wrong loading this page.`, `Try again`, and `Return to Gallery`.
- Server logs showed `ECONNREFUSED 127.0.0.1:3306` during public data reads.
- Home metadata awaits the latest image without a fallback at `apps/web/src/app/[locale]/(public)/page.tsx:89-93`.
- Home body awaits tags, topics, config, translations, and then image listing before rendering the real public experience at `apps/web/src/app/[locale]/(public)/page.tsx:149-167` and `apps/web/src/app/[locale]/(public)/page.tsx:222-224`.
- Topic and timeline pages use the same unguarded pattern for DB-backed navigation/listing data at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:141-177` and `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84`.

Failure scenario:
During a DB restart, migration window, or local demo without MySQL, visitors and clients do not get a localized gallery maintenance/degraded state. They see a generic framework-level error with little task context, which makes the gallery feel broken rather than temporarily unavailable.

Suggested fix:
- Catch expected DB-unavailable failures around public listing and metadata reads.
- Render a localized public maintenance state inside the normal public layout with the nav/footer intact, a clear retry action, and a short explanation that photos are temporarily unavailable.
- Let metadata fall back to site config when latest-image OG data is unavailable.
- Consider a shared `PublicDataUnavailable` component used by home/topic/timeline and covered by a DB-failure unit or integration test.

### 3. Medium - Photo viewer single-key shortcuts fire while focus is on controls

Severity: Medium
Confidence: High
Area: Keyboard UX, affordances, WCAG 2.1.4 character key shortcuts, focus predictability

Evidence:
- `isEditableTarget` only ignores text inputs, textareas, contentEditable, and `role="textbox"` at `apps/web/src/components/photo-viewer.tsx:42-49`.
- The window-level keydown handler navigates or toggles UI for `ArrowLeft`, `ArrowRight`, `F`, `I`, `C`, and `H` whenever the lightbox is closed and the event target is not considered editable at `apps/web/src/components/photo-viewer.tsx:355-386`.
- The same viewer contains many non-text interactive controls that can hold focus: toolbar link/buttons at `apps/web/src/components/photo-viewer.tsx:541-623` and download dropdown trigger/items at `apps/web/src/components/photo-viewer.tsx:919-968`.

Failure scenario:
A keyboard user tabs to Back, Share, Info, the download trigger, or a dropdown item and presses a single-letter key while oriented on that control. Instead of only interacting with the focused control or doing nothing, the page can open the lightbox, toggle panels, or change color/histogram state. Arrow keys can also navigate photos while focus is on an interactive element.

Suggested fix:
- Expand the guard to ignore all interactive targets: `a`, `button`, `select`, `summary`, `[role=button]`, `[role=link]`, `[role=menuitem]`, `[role=option]`, Radix trigger/content descendants, and disabled/aria-disabled controls as appropriate.
- Better: scope viewer shortcuts to the media canvas/container when it has focus, and avoid global single-character shortcuts unless the user opts in or a modifier is required.
- Add focused-control regression tests for toolbar buttons and dropdown items.

### 4. Medium - Admin settings copy mixes photographer controls with operator runbook detail

Severity: Medium
Confidence: Medium
Area: Information architecture, form comprehension, i18n readability, admin task flow

Evidence:
- The settings page places backfill/re-encode operational detail directly in the primary color/settings form at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:307-329` and confirmation text at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:394-415`.
- Firefox display detection details are embedded inline in the same settings surface at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:556-560`.
- Semantic search setup exposes implementation and operator gating inside the primary settings card at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:741-789`.
- English strings include dense terms such as stub embeddings, operator-gated production mode, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, sidecar backfill, `--force-reencode`, CPU/disk-heavy live host processing, and pipeline versions at `apps/web/messages/en.json:747-780`.
- Korean strings carry the same operational density, with long translated admin copy at `apps/web/messages/ko.json:747-780`.

Failure scenario:
A photographer-admin trying to adjust color/HDR/search settings must parse deployment and runbook language before understanding the user-facing outcome. On mobile and in Korean, the long dense paragraphs are especially hard to scan and increase the chance of selecting the wrong setting or postponing a needed re-encode.

Suggested fix:
- Keep the primary form outcome-oriented: what visitors will see, what uploads will accept, and whether existing photos need processing.
- Move operator-only implementation detail into collapsible "Operator details" sections or linked runbook text.
- Split settings into "Photographer controls" and "Operator setup" where semantic search production gating and sidecar commands live outside the everyday form path.
- Rewrite Korean UI strings as shorter native UI copy rather than line-for-line operational prose.

## Coverage Notes

- IA: Public nav/home/topic/timeline/admin surfaces are discoverable, but outage IA is too generic and admin settings mix user controls with operator runbooks.
- Affordances: Core actions generally use clear buttons/icons and 44 px touch-target conventions; photo viewer shortcuts need safer focus scoping.
- Keyboard/focus: Skip link and visible focus patterns are present; modal background isolation and global shortcut scoping are the main gaps.
- WCAG 2.2: Findings map primarily to modal name/role/state consistency, focus order/predictability, and character-key shortcut behavior.
- Responsive behavior: Mobile dark-mode pass on `/en/privacy` did not reveal layout breakage; DB-backed pages could not be fully exercised.
- Loading/empty/error states: Search and form-level states exist; DB-unavailable public listing currently falls through to a generic error page.
- Form validation UX: Admin login labels/toggle/error state rendered correctly; deeper admin forms could not be submitted without DB.
- Dark/light: Token system and dark mobile smoke pass looked coherent on the accessible static page.
- i18n/RTL: `html lang`/`dir` is set by layout; English/Korean parity appears covered by tests, but admin settings copy needs localization-quality editing. No RTL locale runtime was available in the current messages.
- Perceived performance: CSS includes reduced-motion and masonry content-visibility optimizations; runtime DB failure prevents assessing real gallery load perception.

## Missed-Issue Sweep

- Removed as false positive: admin skip link target exists because the admin layout renders `main id="main-content"`.
- Removed as false positive: admin image tables use the shared `Table` wrapper with horizontal overflow handling.
- Existing tests were inventoried for touch targets, focus, lightbox, i18n, search, privacy, admin settings, and upload, but not executed in this review pass.
- No commits or pushes were made, per user instruction.
