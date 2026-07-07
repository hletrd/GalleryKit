# GalleryKit Designer Review - Cycle 22

Repo: `/Users/hletrd/flash-shared/gallery`  
HEAD: `dabf8e8a`  
Lane: `designer`  
Date: 2026-07-08

Review-only artifact. I overwrote only this file and did not commit or push.

## Context And Method

Read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, and the relevant `agent-browser-*` skill files for core navigation, query, visual, interaction, wait, debug, network, state, and config.

Adapted reviewer posture from the local UI/product reviewer prompts where useful, ignoring their BurstPick-specific paths and claims. GalleryKit is a Next.js finished-photo publishing gallery: no edit, culling, or scoring features are expected.

Runtime: started existing production build with `npm run start --workspace=apps/web -- --hostname 127.0.0.1 --port 3100`. Next served `http://127.0.0.1:3100` and warned that standalone output should normally use `.next/standalone/server.js`; this did not block browser review. Public pages used local E2E seed content. Protected admin runtime was limited to the login page because no plaintext admin password was used in this review.

Browser evidence collected with `agent-browser`: accessibility snapshots, DOM boxes, attributes, focus state, color-scheme styles, map marker attributes, search dialog modal isolation, mobile card metrics, and login form metrics. Source/static review covered public/admin IA, affordances, WCAG 2.2, ARIA, responsive breakpoints, loading/empty/error states, validation UX, dark/light mode, i18n/RTL posture, and perceived performance.

Validation: `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/focus-visible-rings-cycle20.test.ts src/__tests__/info-bottom-sheet-ia.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/cycle-22-source-contracts.test.ts src/__tests__/free-download-contract.test.ts` passed: 9 files, 63 tests.

## Findings

### DES-C22-01 - Admin image management still behaves like a spreadsheet instead of a photo review workbench

Severity: Medium  
Confidence: High  
Status: Confirmed

File and region:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`
- `apps/web/src/components/image-manager.tsx:427-620`

Evidence:

- Source wraps recent uploads in a nested scroll region: `max-h-[calc(100vh-16rem)] overflow-auto` at `dashboard-client.tsx:142`.
- The image manager is a 9-column table inside `overflow-x-auto` at `image-manager.tsx:427-450`.
- Per-row preview is fixed at `h-32 w-32` (`image-manager.tsx:473-481`), tags require a separate `min-w-[200px]` cell (`image-manager.tsx:500-552`), and edit/delete actions sit at the far-right cell (`image-manager.tsx:571-607`).
- Runtime admin login was available, but protected dashboard was not browser-clicked because this review did not use plaintext credentials. The finding is therefore source-confirmed and matches the same component shape that shipped in Cycle 21.

Failure scenario:

On a tablet or narrow laptop, an admin reviewing a batch must scroll vertically inside the dashboard and horizontally inside the table to connect thumbnail, filename, tags, gamut, date, and actions. With similar images, row context is easy to lose before the admin reaches the action cell.

Concrete fix:

Keep the table for wide desktop density, but add a responsive card/list workbench below large desktop widths. Group preview, title/filename/topic, status chips, tags, and edit/delete/share actions in one visual cluster per image; avoid nested horizontal and vertical scroll for the daily upload-review loop.

### DES-C22-02 - Admin navigation is one flat ten-link strip with no workflow grouping

Severity: Low-Medium  
Confidence: High  
Status: Confirmed

File and region:

- `apps/web/src/components/admin-nav.tsx:15-49`
- `apps/web/src/components/admin-header.tsx:13-26`

Evidence:

- `AdminNav` defines Dashboard, Categories, Tags, SEO, Settings, Tokens, Password, Users, Database, and Analytics as ten peer links (`admin-nav.tsx:15-26`).
- The render path is one wrapping flex nav (`admin-nav.tsx:29-49`).
- `AdminHeader` places brand, all nav links, and logout in one wrapping row (`admin-header.tsx:13-26`).
- The implementation preserves 44px targets and `aria-current`, so the issue is IA/scanning, not touch target compliance.

Failure scenario:

An admin doing common publishing work has to scan the same visual strip for routine upload/taxonomy tasks and high-risk operations such as database restore, tokens, users, and password changes. On mobile/tablet the wrap order can mix operational and content-management destinations, making destructive or rarely used areas feel as ordinary as daily publishing pages.

Concrete fix:

Group admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights. On mobile/tablet, use a sectioned drawer or menu instead of a single wrapping strip, while preserving current focus rings, `aria-current`, and 44px targets.

### DES-C22-03 - Mobile masonry cards permanently cover finished photos with metadata chrome

Severity: Low  
Confidence: High  
Status: Confirmed

File and region:

- `apps/web/src/components/masonry-card.tsx:149-155`

Evidence:

- Source always renders the mobile overlay as `absolute inset-x-0 top-0 sm:hidden bg-gradient-to-b from-black/75 to-transparent p-3` (`masonry-card.tsx:149-154`).
- Agent-browser mobile viewport 390x844 on `/en`: first card box `358x556.875`; top metadata gradient box `358x60`, visible and displayed `block`; second card repeats the same `358x60` top overlay.
- Desktop overlay is separate and hidden until hover/focus (`masonry-card.tsx:155-160`), so the always-on treatment is mobile-specific.

Failure scenario:

On phone galleries, a portrait or landscape with important subject detail near the top is partially covered before the visitor has chosen to open the photo. GalleryKit's product premise is finished-photo publishing; permanent grid chrome competes with the photographer's crop.

Concrete fix:

Move mobile metadata below the image, reserve a compact caption band, or provide a clean-grid mode where metadata appears on focus/open rather than over the bitmap. Preserve the current accessible photo link label and heading semantics.

## Current Non-Issues Checked

- Map marker names are fixed: `/en/map` snapshot exposes marker as `button "Open photo: E2E Landscape"`, and DOM has `alt="Open photo: E2E Landscape"`, `title="E2E Landscape"`, `role="button"`, `tabindex="0"`, and `44x44` box.
- Search modal behavior is sound in the sampled flow: clicking "Search photos" focuses the combobox, opens a named `role="dialog"`, and sets outside body children inert/`aria-hidden`.
- Admin login form has labeled username/password fields, a 44px show-password control, a 44px submit button, and no alert on initial load.
- Mobile tag filter is collapsed behind a 44px `<summary>`; the interactive chips meet 44px boxes when the disclosure is open.
- Dark mode privacy page rendered with `html.dark`, body background `rgb(9, 9, 11)`, foreground `rgb(250, 250, 250)`, and muted text `rgb(161, 161, 170)`.
- EN/KO message parity, focus-visible contracts, touch targets, theme tokens, search status, and Cycle 22 source contracts passed targeted Vitest validation.

## Coverage Notes

Information architecture: public nav/footer, home grid/tag filter, map/timeline/privacy/about routes, admin shell/login/source-only protected pages.  
Affordances: search, theme, locale, mobile menu, tag filter, photo links, map markers/list fallback, login controls, admin image-manager source.  
Keyboard/focus: skip link, focus rings, search modal focus/inert handling, admin login, source/tests for lightbox/info sheet.  
WCAG/ARIA: landmarks, headings, dialog naming, marker naming, touch target tests, focus-visible tests, message-key parity.  
Responsive: 390px mobile and 1440px desktop sampled; source reviewed for table/card/nav breakpoints.  
Loading/empty/error: login, search, not-found/error shells, map no-photos source, admin token/settings source, failed image source.  
Dark/light: agent-browser dark media sample plus theme token tests.  
i18n/RTL: English/Korean LTR only; `html dir` exists via `getLocaleDirection`, but no RTL locale is shipped.  
Perceived performance: source evidence for memoized masonry cards, sized map/search thumbnails, lazy/eager image split, search debounce/abort, and Leaflet route chunking; no Chrome performance trace was run.

## Final Missed-Issue Sweep

Searched docs/source/messages/tests for UI/a11y and product-claim surfaces including `aria-`, `role`, `tabIndex`, focus, loading, empty, error, validation, RTL/dir, dark mode, semantic search, AI, Lightroom, storage, S3/MinIO, proofing, scoring, payment, analytics, OpenStreetMap, `site-config`, and `BASE_URL`.

Uninspected or partially inspected categories: authenticated protected-admin runtime beyond login; destructive admin actions such as DB restore/delete/re-encode; production CDN/service-worker/offline behavior; physical P3/HDR display behavior; true RTL layout; high-volume gallery performance; generated build output and binary assets. No source fixes, commits, pushes, or deploys were performed.
