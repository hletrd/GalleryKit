# Cycle 36 Designer Review

Role: `cycle-36 designer`
Repo: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `bc73c02293f2568d23602ab498f12346a37fadf1`
Date: 2026-07-08 KST

Scope: review-only. I did not change production code, commit, push, or deploy. This file is a provenance artifact for the designer lane.

## Evidence Base

- Read `AGENTS.md` instructions supplied in-thread and `CLAUDE.md`.
- Used agent-browser skills/CLI: core navigation, query snapshots, visual screenshots, config/viewport, and debug/eval.
- Runtime path: `npm run start --workspace=apps/web -- -p 3002` served the existing build. `next start` warned that standalone output should use `node .next/standalone/server.js`, but it did serve local pages for review.
- `next dev` was not used because a stale Next dev marker reported an existing PID/port 3000 while no listener existed. I did not delete lock files or kill processes.
- Runtime sampled: `/en`, `/ko`, `/en/admin`, `/en/map`, and the search modal. Authenticated admin screens were source-reviewed only because credentials were not provided.
- Validation evidence: `npm run typecheck --workspace=apps/web` passed.

## Findings

### DES-C36-01 - Footer navigation overflows below 360px

Severity: Medium
Confidence: High
Area: responsive breakpoints, WCAG 2.2 Reflow

Evidence:

- Source: `.context` runtime selector `footer div div` maps to `apps/web/src/components/footer.tsx:41-68`, a single `flex items-center gap-4` row with no wrapping.
- Source: every footer link has at least `min-h-11 min-w-11` or larger, `footer.tsx:42-65`.
- Browser evidence at `http://localhost:3002/ko`, viewport `320x568`: `document.documentElement.scrollWidth` was `350` while `window.innerWidth` was `320`; `footer div div` measured `left=-30.078125`, `right=350.078125`, `width=380.15625`. The first link started off-screen and the Admin link ended beyond the viewport.

Failure scenario:

A visitor on a narrow phone sees horizontal page overflow at the footer. The first and last footer links can be clipped or require sideways panning, which violates the expected single-axis mobile reading flow and weakens access to Timeline, Map, Privacy, GitHub, and Admin links.

Fix:

Allow the footer link row to wrap (`flex-wrap justify-center`) or split it into two rows below `sm`. Keep the 44px targets but reduce the fixed gap at narrow widths (`gap-x-3 gap-y-1`) and verify at 320px in EN and KO.

### DES-C36-02 - Public IA hides archive/map/about surfaces in the footer

Severity: Medium
Confidence: High
Area: information architecture, affordance, product discovery

Evidence:

- Source: top navigation renders brand, topic links, search, theme, locale, and mobile expand controls only: `apps/web/src/components/nav-client.tsx:91-194`.
- Source: topic links are the only primary content links in the sticky nav: `nav-client.tsx:106-143`.
- Source: Timeline, Map, About/GalleryKit, Privacy, GitHub, and Admin links appear only in the footer: `apps/web/src/components/footer.tsx:41-67`.
- Browser evidence on `/en`: sticky nav exposed `Atik Gallery`, topic `E2E Smoke`, Search, Theme, and language; Timeline/Map/Privacy were only in `contentinfo`.

Failure scenario:

On a long gallery or infinite-scroll session, a visitor may never discover the date archive or map because those routes are below the photo grid. On mobile, the menu button expands topics only, so the "more ways to browse" affordance is still absent from the first viewport.

Fix:

Add a compact "Browse" or "Archive" cluster to the sticky nav containing Timeline and Map, with About/Privacy remaining secondary. On mobile, include these links in the expanded menu under the topic list rather than relying on the footer.

### DES-C36-03 - Admin image management remains spreadsheet-first on mobile and small laptops

Severity: Medium
Confidence: High for source; authenticated runtime not available
Area: admin UX, responsive, affordance

Evidence:

- Source: the manager wraps one wide table in `overflow-x-auto`: `apps/web/src/components/image-manager.tsx:427-620`.
- Source: columns include preview, title, filename, topic, tags, gamut, date, and actions: `image-manager.tsx:431-450`.
- Source: preview is a fixed `h-32 w-32`: `image-manager.tsx:473-488`.
- Source: tag editing reserves `min-w-[200px]`: `image-manager.tsx:500-552`.
- Source: edit/delete actions sit at the far right: `image-manager.tsx:571-607`.

Failure scenario:

An admin reviewing a phone upload batch has to pan horizontally to connect image identity, tags, gamut, date, and destructive actions. Similar adjacent photos increase the risk of editing or deleting the wrong row after horizontal scrolling breaks row context.

Fix:

Introduce a responsive card/workbench view below `lg`: preview, title, topic, tags, gamut/date, selection, and actions should stay in one block. Keep the dense table as the wide-desktop mode.

### DES-C36-04 - Future RTL support is declared globally but key nav layout uses physical directions

Severity: Low
Confidence: Medium
Area: i18n/RTL

Evidence:

- Source: root layout sets `dir={getLocaleDirection(locale)}` and comments that this future-proofs RTL locales: `apps/web/src/app/[locale]/layout.tsx:101-107`.
- Source: nav layout uses physical margin and alignment utilities: `mr-3 md:mr-6` at `apps/web/src/components/nav-client.tsx:100`, `ml-auto` at `nav-client.tsx:112` and `nav-client.tsx:148`, and `ml-1`/`ml-auto` for the mobile expander at `nav-client.tsx:180`.
- Current locale set is EN/KO, both LTR, so this is a future-locale risk rather than an active shipped-locale bug.

Failure scenario:

If an RTL locale is added, the document direction changes but nav spacing and "push to edge" behavior can remain left/right physical. Controls may appear on the wrong visual side, focus order may not match visual order, and iconography such as chevrons/back buttons may need mirroring.

Fix:

Before adding an RTL locale, replace physical utilities with logical equivalents (`ms-*`, `me-*`, `start-*`, `end-*` where supported) or direction-aware class composition. Add a small RTL browser matrix for nav, footer, search, photo viewer, and admin header.

## Coverage Map

IA: public top nav/footer, home/topic discovery, timeline/map/about/privacy routes, admin source nav/managers.
Affordances: search, theme, language switch, mobile menu, tag filter, map fallback list, login, footer links, admin table actions.
Keyboard/focus: skip link, search dialog focus trap, login labels, source focus-visible rings, focus restoration patterns.
WCAG 2.2: reflow, touch target policy, live regions, named landmarks, modal isolation, reduced motion.
Responsive: 1440px, 390px, and 320px browser checks plus source inspection for protected admin views.
Loading/empty/error: admin loading status, photo loading component, route/global errors, map empty state, search empty/status states, upload/settings source states.
Dark/light: mobile Korean dark snapshot and theme-token source.
i18n/RTL: EN/KO runtime; RTL source-only because no RTL locale ships.
Perceived performance: image sizing, masonry memoization, content-visibility, map chunking, search debounce/abort reviewed.

## Final Missed-Issue Sweep

Rechecked prior cycle findings against current source and runtime. Closed from prior evidence: wide-gamut hint no longer claims an sRGB version; search combobox no longer points `aria-controls` at the dialog when empty; typecheck passes despite stale dev log. Remaining unverified live areas: authenticated admin internals, production CDN/service-worker behavior, share-key pages with non-seeded data, large-gallery performance traces, physical HDR/P3 output, and destructive DB/upload flows. No production code was changed.
