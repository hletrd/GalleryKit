# Designer Review - Cycle 7 / 100

Role: designer / UI-UX reviewer. Scope: Next.js frontend UI/UX, information architecture, affordances, keyboard/focus navigation, WCAG 2.2 accessibility, contrast, ARIA, focus traps, responsive behavior, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL constraints, and perceived performance.

No fixes were implemented. This lane only wrote the review artifact.

## Inventory Coverage

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- agent-browser skills: core navigation, config, query, visual, interact, wait, network, debug, and state.

Review inventory built before findings:

- Public localized routes under `apps/web/src/app/[locale]/(public)/`: home, topic, smart collection, shared group/link, photo detail/loading, map, timeline, year, and upload-file route surfaces.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, protected layout, dashboard/upload manager, categories, tags, SEO, settings, password, users, DB, tokens, analytics, loading, and error shells.
- Shared UI components under `apps/web/src/components/`: nav, search, masonry home client, load more, photo viewer, lightbox, image zoom, bottom sheet, color details, histogram, upload dropzone, tag input/filter, admin nav/header, image manager, user manager, and shadcn/Radix primitives.
- Styling and tokens: `apps/web/src/app/[locale]/globals.css`, UI primitive class contracts, dark/oled tokens, forced-colors and reduced-motion CSS.
- i18n: `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
- Test/e2e coverage relevant to UI/a11y: touch-target audit, focus-visible scanner, US-P15 a11y contracts, client source contracts, bottom-sheet IA tests, HDR contrast tests, and public/admin Playwright specs.
- Cross-file interactions checked: route locale handling, canonical tag parsing, modal/focus-trap source contracts, search result accessibility, upload in-flight state, tag input focusability, and prior designer-plan patterns.

Files intentionally not inspected in detail: Drizzle migrations, image-processing internals, storage backends, deployment scripts, non-UI server action internals, and most data/security tests outside UI cross-file contracts. They are outside this designer lane except where they affected browser feasibility or UI state.

## Browser Evidence

Local app:

- Started `npm run dev --workspace=apps/web -- --port 3017`.
- Dev server reached `http://localhost:3017`, but DB-backed rendering failed because local MySQL was unavailable at `127.0.0.1:3306`.
- Local `/en` rendered the app error shell. Server output showed `connect ECONNREFUSED 127.0.0.1:3306` in topic/image queries used by `Nav` and home metadata.
- Because the local DB was unavailable, full gallery content, search results, and authenticated admin dashboards could not be fully browser-validated locally.

Live public deployment used for interaction evidence:

- Loaded `https://gallery.atik.kr/en` at 1440x1000 and 390x844.
- Captured accessibility snapshots for desktop home, mobile home, search dialog, admin login, Korean home, and photo detail/lightbox.
- Captured screenshots: `/tmp/gallery-cycle7-mobile.png`, `/tmp/gallery-cycle7-admin-login.png`, `/tmp/gallery-cycle7-photo.png`, `/tmp/gallery-cycle7-dark.png`.
- Search dialog focus stayed inside the dialog during Tab/Shift+Tab checks, and ArrowDown updated `aria-activedescendant`.
- Admin login exposed visible labels, required username/password inputs, password reveal, and submit; empty submit used native required-field validation.
- Korean route `/ko` set `document.documentElement.lang` to `ko` and localized the main UI labels observed in the accessibility snapshot.
- RTL was not runtime-tested because the configured locales are English and Korean; neither is RTL.

## Confirmed Issues

### DES-C7-01 - Tag filter active state and next URLs can diverge from the canonical server filter

Severity: Medium
Confidence: High
Classification: confirmed issue; UI state / accessibility / navigation correctness

Evidence:

- `apps/web/src/app/[locale]/(public)/page.tsx:161-166` parses and filters the requested tag slugs through `parseRequestedTagSlugs()` and `filterExistingTagSlugs()`, then queries the gallery with only the canonical existing `tagSlugs`.
- `apps/web/src/app/[locale]/(public)/page.tsx:221-223` passes that canonical `tagSlugs` array to `HomeClient` as `currentTags`.
- `apps/web/src/components/home-client.tsx:241-250` uses `currentTags` for the visible H1 tag label display.
- `apps/web/src/components/tag-filter.tsx:14-15` ignores the canonical server-filtered `currentTags` and re-derives active state from raw `useSearchParams().get('tags')`.
- `apps/web/src/components/tag-filter.tsx:21-39` also builds the next pushed URL from that raw list, preserving invalid slugs when toggling real tags.
- Live browser evidence:
  - `https://gallery.atik.kr/en?tags=not-a-real-tag` rendered H1 `Latest` and `445 photos`, but no tag button had `aria-pressed="true"`; even `All` had `aria-pressed="false"`.
  - `https://gallery.atik.kr/en?tags=shinyu,not-a-real-tag`, then clicking `DOHOON`, produced `https://gallery.atik.kr/en?tags=shinyu%2Cnot-a-real-tag%2Cdohoon` while the UI showed only `#SHINYU #DOHOON`.

Why this is a problem:

The server correctly treats invalid tag slugs as absent, but the client controls present and mutate a different state. Assistive tech users get a filter group where no chip is pressed even though the page is effectively unfiltered, and all users can keep carrying dead URL state forward through normal chip toggles. This is a small UI inconsistency on ordinary links, but it becomes confusing when links are shared or when QA/admins use URLs to diagnose gallery state.

Failure scenario:

A visitor opens a shared link with a removed tag slug. The page displays the unfiltered gallery, but the filter controls do not mark "All" as selected. If the visitor then selects a real tag, the stale removed slug remains in the URL. The visible UI and the browser URL no longer describe the same filter set.

Suggested fix:

Pass canonical `currentTags` into `TagFilter` and use it for `variant`, `aria-pressed`, and toggle math. When pushing a new query, start from the canonical selected slugs plus unrelated query params, not from the raw `tags` value. Optionally replace the URL on mount/render when invalid slugs are removed so shared links self-heal.

### DES-C7-02 - Mobile nav toggle says it controls visible topic links while collapsed

Severity: Low
Confidence: High
Classification: confirmed issue; ARIA semantics / information architecture

Evidence:

- `apps/web/src/components/nav-client.tsx:99-107` renders the mobile toggle with `aria-expanded={isExpanded}` and `aria-controls="primary-nav-topics primary-nav-controls"`.
- `apps/web/src/components/nav-client.tsx:117-123` keeps `#primary-nav-topics` rendered as a flex row even when `isExpanded` is false; collapsed mode only changes it to horizontal overflow.
- `apps/web/src/components/nav-client.tsx:155-159` hides `#primary-nav-controls` on collapsed mobile with `hidden md:flex`.
- Live mobile DOM evidence at 390x844 while collapsed:
  - Toggle HTML had `aria-label="Expand menu"`, `aria-expanded="false"`, and `aria-controls="primary-nav-topics primary-nav-controls"`.
  - `#primary-nav-topics` computed `display:flex`; topic links `TWS` and `TOMORROW X TOGETHER` had visible 44 px-high boxes.
  - `#primary-nav-controls` computed `display:none`.

Why this is a problem:

The control advertises one expanded/collapsed state for two controlled regions, but one of those regions is still visible and operable while the control says collapsed. For screen-reader users, "Expand menu" implies the topic navigation is hidden until expansion, even though topic links are already present. For sighted mobile users, the chevron expands only utility controls, not the already-visible category links, so the menu model is unclear.

Failure scenario:

A keyboard or screen-reader visitor lands on "Expand menu, collapsed" and then encounters visible topic links that are supposedly inside the collapsed controlled region. Expanding the menu reveals search/theme/language controls, not the topic links the ARIA relationship promised.

Suggested fix:

Choose one model and align DOM semantics with it:

- If topics should remain visible in collapsed mobile nav, remove `primary-nav-topics` from `aria-controls` and rename the button to something like "Show navigation tools" / "Hide navigation tools".
- If the button is intended to control the whole mobile nav, hide or inert the topic list while collapsed and reveal it together with the controls.

### DES-C7-03 - Search result accessible names repeat generic thumbnail text

Severity: Low
Confidence: High
Classification: confirmed issue; screen-reader verbosity / accessible-name quality

Evidence:

- `apps/web/src/components/search.tsx:71-80` renders each search result as a `Link` with `role="option"`.
- `apps/web/src/components/search.tsx:82-85` gives the thumbnail image `alt={image.title || t('common.photo')}`.
- `apps/web/src/components/search.tsx:99-103` separately renders the visible fallback title as `{image.title || image.description || `${t('common.photo')} ${image.id}`}`.
- Live browser evidence after opening search and typing `dohoon`: the accessibility snapshot exposed options such as `Photo Photo 348 TWS ...`; the first "Photo" came from the thumbnail alt and the second from the visible fallback title.

Why this is a problem:

The thumbnail is redundant inside a result row that already has visible result text. When a photo lacks a title, the option's accessible name starts with a repeated generic label, making a long search list noisier and slower to scan with assistive tech.

Failure scenario:

A screen-reader user searches for a tag that returns many untitled photos. Each result begins "Photo Photo N ..." before the useful metadata, so the user has to listen through repeated generic words for every option.

Suggested fix:

Make the search-result thumbnail decorative with `alt=""` and `aria-hidden="true"` when the adjacent text names the same result. If retaining image alt text, derive it from the same final result label and avoid duplicating the visible fallback title.

## Risks / Manual Validation Needed

- Authenticated admin dashboards were source-reviewed but not browser-tested because no admin credentials were available and local DB was down.
- Local DB-backed route behavior was not fully testable; live production was used for public UI evidence.
- Dark-mode media emulation through `agent-browser set media dark` did not make `matchMedia('(prefers-color-scheme: dark)')` report true in the browser session. Explicit theme cycling to `dark` did work, but a full dark/light visual contrast audit should be repeated in a clean browser session.
- Lightbox fullscreen automation became inconclusive in Chromium after a fullscreen-control interaction, so the report does not claim a fullscreen-specific defect.

## Final Missed-Issues Sweep

Checked the common missed categories after the main pass:

- Touch targets: shared `Button` variants and the inspected custom controls generally preserve 44 px floors; no new sub-44 finding found.
- Focus traps: search focus trap behaved correctly in browser; lightbox and bottom sheet use `FocusTrap` and source-managed focus restoration. No new confirmed trap issue beyond the ARIA/modal caveats noted above.
- Reduced motion: global CSS includes a `prefers-reduced-motion: reduce` override and explicit hover-scale suppression for photo cards.
- Forced colors: globals include forced-colors handling for photo overlays, gamut chips, HDR badge, and color pip.
- Loading/empty/error states: local app error shell, admin login validation, search empty/loading/result states, load-more live region, admin loading spinners, and upload progress source were reviewed.
- i18n: English/Korean snapshots and source key usage were reviewed; no key mismatch found in this lane.
- Responsive breakpoints: desktop and mobile public nav/home/search/photo snapshots were exercised. The mobile nav ARIA mismatch above is the only confirmed responsive finding from this pass.
