# Cycle 37 Designer UI/UX Review

Date: 2026-07-08
Scope: `/Users/hletrd/flash-shared/gallery`
Role: cycle 37 designer reviewer, adapted from `~/.codex/agents/ui-ux-designer-reviewer.md` to GalleryKit.

No product code was edited. No commit or push was made.

## Findings

### DES37-01: Navigation visibility switches hide only the header while copy promises visitor hiding

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Area: information architecture, admin affordance accuracy, public discovery, i18n copy

Evidence:

- The Settings UI presents the controls as visitor-facing navigation visibility: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:878-918`.
- The English and Korean hints say turning the switches off hides the links from visitors: `apps/web/messages/en.json:789-794`, `apps/web/messages/ko.json:789-794`.
- The config reaches only the header nav: `apps/web/src/components/nav.tsx:7-34` passes `showTimelineNav` / `showMapNav`; `apps/web/src/components/nav-client.tsx:35-49` conditionally builds only header `browseLinks`.
- The footer still always renders `/timeline` and `/map`: `apps/web/src/components/footer.tsx:26-71`, especially `footer a[href$="/timeline"]` at lines 45-47 and `footer a[href$="/map"]` at lines 48-50.
- The sitemap still always emits `/timeline` and `/map`: `apps/web/src/app/sitemap.ts:25` and `apps/web/src/app/sitemap.ts:100-107`.

Concrete failure scenario:

An admin disables “Show Map link” before publishing a private-location-heavy gallery, expecting visitors not to discover the map browse surface. The header link disappears, but every public footer still links to `/map` and crawlers still receive `/map` in `/sitemap.xml`. The result is a misleading partial-hide state: the admin thinks discovery is suppressed, while first-party discovery still exists.

Suggested fix:

Choose and enforce one contract. If the switches mean “hide from first-party visitor discovery,” resolve `getGalleryConfig()` in `Footer` and `sitemap()`, omit hidden paths there too, and add tests for header/footer/sitemap with each flag false. If the switches are intentionally header-only, rename the card and hints to “navigation bar only” and remove “hide it from visitors” language.

### DES37-02: Admin navigation remains one flat wrapping strip for ten unrelated work areas

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed
- Area: admin information architecture, responsive navigation, operational risk affordance

Evidence:

- `apps/web/src/components/admin-nav.tsx:15-26` defines ten peer links: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics.
- `apps/web/src/components/admin-nav.tsx:28-49` renders them as a single `flex flex-wrap` nav, with no grouping or priority.
- `apps/web/src/components/admin-header.tsx:13-27` places this full strip next to the admin brand and logout in one wrapping header.

Concrete failure scenario:

A Korean admin on a tablet sees routine publishing links, access-control links, analytics, and the database backup/restore entry at the same hierarchy. Translation length and viewport width change where links wrap, so spatial memory differs between desktop and tablet. High-risk operational pages look as prominent as daily curation links, while common “upload/manage images” work has no stable primary section.

Suggested fix:

Group the admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights. On narrow widths, use a sectioned drawer/menu or tabs with the active section visible instead of one wrapping peer list. Keep 44 px link targets and current `aria-current` behavior.

### DES37-03: Public map can mount 10,000 markers plus a 10,000-item list in one client render

- Severity: Medium
- Confidence: Medium-High
- Status: Risk
- Area: perceived performance, responsive behavior, map accessibility fallback

Evidence:

- `apps/web/src/lib/data.ts:1766-1816` caps public map rows at `MAP_MAX_MARKERS = 10000` and returns all capped rows to the route.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-67` maps the whole result into marker props.
- The same page renders both the interactive map and a full fallback/list UI from the same marker array: `apps/web/src/app/[locale]/(public)/map/page.tsx:90-111`, selector `#map-photo-list`.
- `apps/web/src/components/map/map-client.tsx:78-95` allocates latitude and longitude arrays and spreads them into `Math.min` / `Math.max`; `apps/web/src/components/map/map-client.tsx:121-142` renders every marker as a React Leaflet `<Marker>` with a `<Popup>`.

Concrete failure scenario:

A photographer enables map visibility for a large travel archive. On a mid-range phone, `/map` receives thousands of rows, mounts thousands of Leaflet marker/popup trees, builds an equally large accessible list, and computes bounds with large array spreads before the user can pan, zoom, or open a photo. The route remains technically bounded, but the UI can still feel frozen.

Suggested fix:

Reduce the initial interactive budget and add clustering or viewport/bbox paging. Keep the accessible list, but page or virtualize it and expose the currently loaded/count state. Compute bounds in a single loop without spreading large arrays. Validate with a Playwright performance trace or synthetic 5k/10k marker fixture.

## Validation Evidence

- Read first: `AGENTS.md`, full `CLAUDE.md`, and `~/.codex/agents/ui-ux-designer-reviewer.md`. The project-local `.codex/agents/ui-ux-designer-reviewer.md` path named in the prompt does not exist.
- Used Playwright skill guidance from `/Users/hletrd/.codex/skills/playwright/SKILL.md`.
- Local runtime was attempted but blocked:
  - `npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3100` failed because Next reported an existing dev lock for PID 7042.
  - `lsof`/`curl` found no reachable listener on 3000 or 3100; I did not delete `.next/dev/lock` because that is a filesystem deletion.
  - `npm run typecheck --workspace=apps/web` failed on `settings-hash.test.ts` fixtures missing `showTimelineNav` and `showMapNav`, so full current-branch browser verification is blocked.
- Browser-backed baseline against live `https://gallery.atik.kr`:
  - Mobile `/en` at 390x844: `lang="en"`, `dir="ltr"`, nav controls measured 44 px high, first photo link had accessible label `View photo: #Color in Music Festival #DOHOON #JIHOON #348`, and ARIA snapshot exposed skip link, main nav, H1, tag group, H2 “Photos”, and photo links.
  - Desktop `/en` at 1440x900: nav exposed Timeline/Map/topic links plus search/theme/language controls with 44 px targets.
  - Mobile `/ko/admin`: `lang="ko"`, username/password inputs 308x44, show-password 44x44, submit 308x44, logical focus order.
  - Live mobile home still showed tag chips overlapping the first photo by hit-test, but current source has the mobile tag filter collapsed behind `<details>` in `apps/web/src/components/tag-filter.tsx:143-160`, so I did not file that as a current-source issue.
- Targeted tests passed:
  - `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/settings-save-affordance-source.test.ts src/__tests__/gps-map-link-touch-targets.test.ts src/__tests__/select-item-touch-target.test.ts`
  - Result: 7 files passed, 40 tests passed.

## Inventory And Files Examined

Inventory built before review:

- Public routes: `apps/web/src/app/[locale]/(public)/**`, including home, topic, photo, shared, smart collection, timeline, year, map, privacy, and loading/layout states.
- Admin routes: `apps/web/src/app/[locale]/admin/**`, including dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics, protected loading/error, login.
- Components: `apps/web/src/components/**`, including nav, footer, search, tag filter, masonry card, lightbox, photo viewer, bottom sheet, map, upload, image manager, admin nav/header, dialogs, and shadcn/Radix primitives.
- Styling/theme/i18n: `apps/web/src/app/[locale]/globals.css`, `apps/web/src/components/theme-provider.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, locale layout.
- Tests/artifacts: UI/a11y/touch/focus/theme/i18n tests under `apps/web/src/__tests__`, Playwright config/e2e files, and prior UI review artifacts under `.context/reviews/`.

Key examined line regions:

- Navigation/settings: `nav.tsx:7-34`, `nav-client.tsx:24-55`, `footer.tsx:26-71`, `sitemap.ts:20-108`, `settings-client.tsx:878-918`, messages `en.json:789-794`, `ko.json:789-794`, config `gallery-config.ts:93-154`, `gallery-config-shared.ts:69-221`.
- Admin IA: `admin-nav.tsx:15-49`, `admin-header.tsx:13-27`, protected layout `layout.tsx:1-26`.
- Map: `map/page.tsx:1-116`, `map-client.tsx:78-143`, `data.ts:1766-1816`.
- Dialog/error-prevention sweep: token revoke/plaintext dialog `tokens-client.tsx:254-329`, alias delete dialog `topic-manager.tsx:497-530`, image delete dialog `image-manager.tsx:571-585`.
- Focus/focus traps: search dialog `search.tsx:416-577`, bottom sheet `info-bottom-sheet.tsx:255-360`, lightbox `lightbox.tsx:452-610`.
- Contrast/motion/theme/RTL: `globals.css:13-120`, `globals.css:276-290`, locale layout `layout.tsx:100-154`, `constants.ts:1-4`, `i18n/request.ts:1-15`.

## Coverage Notes

- Information architecture: findings DES37-01 and DES37-02.
- Affordances and admin workflow: DES37-01/DES37-02; destructive token and alias confirmations are now target-specific and were not re-filed.
- Focus/keyboard/focus traps: no confirmed current failure; source and live baseline show skip link, visible focus, focus traps, and 44 px controls.
- WCAG 2.2 contrast/ARIA/reduced motion: no confirmed current failure; theme comments and targeted tests support contrast/focus/touch claims; global reduced-motion rules are present.
- Responsive breakpoints: DES37-02 and DES37-03 remain responsive risks; current mobile tag filter source addresses the live deployed overlap.
- Loading/empty/error states: map empty state, search status, protected loading/error, restore-maintenance states, and dialog states were swept; no additional confirmed defect.
- Form validation UX: no new confirmed issue; target-specific destructive confirmations are present in current source.
- Dark/light mode: theme tokens and live dark admin login baseline passed.
- i18n/RTL: English/Korean parity test passed; root `dir` is wired through `getLocaleDirection`, but only LTR `en`/`ko` are shipped.
- Perceived performance: DES37-03.

## Final Missed-Issues Sweep

I re-swept for `aria-`, `role=`, `focus`, `FocusTrap`, `Dialog`, `AlertDialog`, `Sheet`, `duration-`, `animate-`, `prefers-reduced-motion`, `show_timeline_nav`, `show_map_nav`, `/timeline`, `/map`, and current cycle review findings. No additional high-confidence UI/UX issue was confirmed beyond the three above.

Known validation gaps: no authenticated current-branch browser pass because the local dev server is blocked by stale Next state and the branch currently fails typecheck; no production-scale map trace for the 10k-marker risk; no physical P3/HDR display validation.
