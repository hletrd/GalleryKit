# Designer Review - Cycle 20

Role: cycle-20 designer / ui-ux-designer-reviewer for
`/Users/hletrd/flash-shared/gallery`. Scope: UI/UX/accessibility review of the
GalleryKit web UI. Write scope: this artifact only. No implementation code,
commits, pushes, or deploys were performed.

## Method

Followed `AGENTS.md` and `CLAUDE.md`. Loaded the local `agent-browser` skill
instructions for core navigation, config, wait, query, interact, visual, debug,
network, and state before browser work.

Local boot:

```text
npm run dev
Next.js 16.2.9 ready at http://localhost:3001
Could not connect to database to bootstrap queue (ECONNREFUSED).
```

Local public data routes were DB-blocked, so browser evidence for public gallery
flows used `https://gallery.atik.kr` as requested. Local evidence was still used
for the admin login and route error shell.

Browser evidence collected with `agent-browser`:

- Local `/en`: rendered route error boundary because MySQL was unavailable.
  Accessibility tree exposed `main`, region `Error`, button `Try again`, and link
  `Return to Gallery`.
- Local `/en/admin` at 390 x 844: accessible login form with `Username`,
  `Password`, password reveal, and 44 px controls.
- Live `/en` at 1440 x 1000: main nav, tag filter, photo grid, load-more, footer;
  screenshot `/tmp/gallery-cycle20-home-desktop.png`.
- Live `/en` at 390 x 844: collapsed and expanded mobile nav metrics;
  screenshots `/tmp/gallery-cycle20-home-mobile-collapsed.png` and
  `/tmp/gallery-cycle20-home-mobile-expanded-clean.png`.
- Live `/en/p/348` at 1440 x 1000 and 390 x 844: photo viewer controls,
  accessibility snapshot, no default download/info panel on desktop;
  screenshot `/tmp/gallery-cycle20-photo-mobile.png`.
- Live search dialog: keyword query `JIHOON` produced a generic error; semantic
  query `concert stage` posted to `/api/search/semantic`, stayed in loading for
  ~14 s, then returned 20 listbox options.
- Live `/en/map`: empty geotagged map state rendered `Map` plus "No geotagged
  photos are available on the map."

Source/tests/docs inspected:

- Docs/contracts: `CLAUDE.md`, `package.json`, prior `.context/reviews/designer.md`.
- Public IA: localized public routes under `apps/web/src/app/[locale]/(public)`,
  `NavClient`, `HomeClient`, `GridPicture`, `Search`, `PhotoViewer`,
  `PhotoNavigation`, `ImageZoom`, `InfoBottomSheet`, `Lightbox`, map components.
- Admin IA/forms: login, dashboard/upload/image manager, categories/tags,
  settings, SEO, tokens, users, DB, analytics.
- Styling/a11y: `globals.css`, shadcn/Radix primitives, focus-visible tests,
  touch-target audit, i18n messages, route loading/error/not-found shells.

## Findings

### DES20-01 - Keyword search fails on live gallery for normal tag/person queries

Severity: High
Confidence: High for user-visible failure, Medium for root cause
Status: Open

Route/selector/evidence:

- Route: `https://gallery.atik.kr/en`
- Interaction: expand mobile nav, open `button[aria-label="Search photos"]`,
  type `JIHOON` into `#search-input`.
- DOM result: `#search-input[aria-expanded="false"]`, no `#search-results`, live
  region text `Search failed. Please try again.`
- Network evidence: one `POST https://gallery.atik.kr/en` server-action request
  returned `200`; the UI still rendered the structured error state.
- Control comparison: enabling `#semantic-search-toggle` and querying
  `concert stage` hit `POST /api/search/semantic` and eventually returned
  `20 results`, so the search dialog itself is interactive.

Source region:

- `apps/web/src/components/search.tsx:237-245` maps `searchImagesAction(...)`
  non-ok statuses into the dialog state.
- `apps/web/src/components/search.tsx:464-467` renders the generic visible error.
- `apps/web/src/app/actions/public.ts:305-317` catches `searchImages(...)`
  failures and returns `{ status: 'error', results: [] }`.
- `apps/web/src/lib/data.ts:1490-1632` performs the keyword/tag/alias search SQL.

Failure scenario:

A visitor tries the obvious public search path for a visible tag/person name.
Instead of results or a recoverable "no matches" state, they get a generic error
with no explanation and no alternate path except manually toggling semantic
search.

Suggested fix:

Reproduce against production-like MySQL and inspect the `searchImagesAction
failed` server log for the failing query. Add an e2e/search regression that
searches a known tag/person and asserts a listbox result. Keep the generic
fallback, but add a more actionable visitor-facing state if the keyword backend is
temporarily unavailable while semantic search is configured.

### DES20-02 - Mobile collapsed nav shows clipped topic links while hiding search/theme/language

Severity: Medium
Confidence: High
Status: Open

Route/selector/evidence:

- Route: `https://gallery.atik.kr/en`, viewport 390 x 844.
- Collapsed DOM metrics:
  - `button[aria-controls="primary-nav-topics primary-nav-controls"]`
    `aria-expanded="false"`, box `x=180 w=44`.
  - Topic link `TWS`, box `x=224 w=55`.
  - Topic link `TOMORROW X TOGETHER`, box `x=288 w=200 right=488`, clipped past
    the 390 px viewport.
  - Search/theme/language controls all measured `w=0 h=0`.
- Expanded metrics after the same selector click: `aria-expanded="true"`,
  nav height `172`, controls visible at `y=116`.
- Screenshot evidence: `/tmp/gallery-cycle20-home-mobile-collapsed.png`,
  `/tmp/gallery-cycle20-home-mobile-expanded-clean.png`.

Source region:

- `apps/web/src/components/nav-client.tsx:84-88` makes the nav row `h-16
  overflow-hidden` when collapsed.
- `apps/web/src/components/nav-client.tsx:99-108` renders the mobile expand
  toggle before topics.
- `apps/web/src/components/nav-client.tsx:117-123` keeps topics in the collapsed
  row with horizontal overflow.
- `apps/web/src/components/nav-client.tsx:155-159` hides search/theme/language
  controls on collapsed mobile.

Failure scenario:

On a phone, the header visually advertises two partially competing navigation
models: a chevron menu plus clipped topic pills. The primary utility actions
including search and language are hidden until expansion, but the collapsed row
does not clearly communicate that the chevron reveals those utilities rather than
more topics.

Suggested fix:

Use a dedicated collapsed mobile header: brand + search + menu, or brand + menu
only with topics hidden until expanded. If topic preview is intentional, make it a
separate horizontally scrollable row below the header and keep utility controls
discoverable.

### DES20-03 - Home masonry auto-prefetches every visible photo detail route

Severity: Medium
Confidence: High
Status: Open

Route/selector/evidence:

- Route: `https://gallery.atik.kr/en`, desktop viewport.
- Browser network after initial render, before clicking any card, showed RSC
  prefetches for many visible photo links, including:
  `/en/p/324?_rsc=...`, `/en/p/325?_rsc=...`, `/en/p/326?_rsc=...`,
  `/en/p/327?_rsc=...`, `/en/p/332?_rsc=...`, `/en/p/333?_rsc=...`,
  `/en/p/337?_rsc=...`, `/en/p/338?_rsc=...`, `/en/p/339?_rsc=...`,
  `/en/p/340?_rsc=...`, `/en/p/345?_rsc=...`, `/en/p/346?_rsc=...`,
  `/en/p/347?_rsc=...`, `/en/p/348?_rsc=...`.
- Same capture also showed topic route prefetches for `/en/tws` and
  `/en/tomorrow-x-together`.

Source region:

- `apps/web/src/components/home-client.tsx:323-327` renders each masonry card as
  a default Next `<Link>` with no `prefetch={false}`.
- Similar archive/shared masonry links exist in
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:196-201`,
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:238-243`, and
  `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:189-203`.

Failure scenario:

A visitor opening the home page on mobile data or a low-power device pays for a
burst of route/data prefetches for many photos they may never open. On the server,
each prefetch can also add DB and RSC rendering work exactly when the first image
grid is trying to feel fast.

Suggested fix:

Disable automatic prefetch on dense photo-grid links and replace it with bounded
intent prefetching: hover/focus for pointer/keyboard, or only the first N visible
cards after idle on non-metered connections. Keep explicit prev/next prefetches
on photo pages where user intent is clearer.

### DES20-04 - Desktop photo pages default to hiding metadata, color details, similar photos, and downloads

Severity: Medium
Confidence: High
Status: Open

Route/selector/evidence:

- Route: `https://gallery.atik.kr/en/p/348`, viewport 1440 x 1000.
- Accessibility snapshot exposed only `Back to TWS`, `Open fullscreen view`,
  `Info`, `Next photo`, and the zoomable photo button in `main`.
- DOM probe: `hasDownload=false`; `mainText` contained the title, shortcuts,
  back link, info button, and photo navigation status only.

Source region:

- `apps/web/src/components/photo-viewer.tsx:104-114` initializes and persists
  `isPinned` from `sessionStorage`, defaulting to `false`.
- `apps/web/src/components/photo-viewer.tsx:175` maps `showInfo` directly from
  `isPinned`.
- `apps/web/src/components/photo-viewer.tsx:739-750` hides the sidebar unless
  `showInfo` is true.
- The hidden sidebar body beginning at `apps/web/src/components/photo-viewer.tsx:750`
  contains tags, description, color/HDR details, wide-gamut hint, similar photos,
  histogram/EXIF, and download links.

Failure scenario:

A desktop visitor follows a direct photo or shared link, views the image, and
misses download, caption, capture/color context, and similar-photo discovery
because the page opens in an immersive state with only a generic `Info` button as
the entry point.

Suggested fix:

Default the desktop sidebar open for direct photo pages, or surface a compact
always-visible summary/download strip outside the collapsible panel. If the
immersive default remains, make the first-run desktop affordance more explicit
and expose download/color status without requiring the panel.

## Positive Evidence

- Touch targets measured at 44 px or larger for the tested nav, tag chips, login
  fields, admin login actions, photo toolbar buttons, and footer links.
- Search dialog uses a named modal dialog, focus starts on `#search-input`, body
  scroll locks while open, and `Escape`/close affordances are present.
- Semantic search has an explanatory production hint and returns a proper
  combobox/listbox/options pattern after the long server request resolves.
- Reduced-motion and forced-colors CSS are present in `globals.css`, and source
  review found reduced-motion checks in photo viewer, lightbox, and zoom surfaces.
- Korean/English message files have matching search/map/nav keys in the reviewed
  regions; Korean text is natural enough for the surfaced controls inspected.
- Empty/error states exist for route errors, no geotagged map photos, no topics
  before upload, upload failures, load-more failures, and search statuses.

## Missed-Issue Sweep

Rechecked prior cycle-19 items against current source:

- Photo swipe navigation is now scoped to `swipeTargetRef` in
  `photo-navigation.tsx:47-143`; not carried forward.
- Image zoom now includes `accessibleName` in the zoom button name at
  `image-zoom.tsx:343-365`; not carried forward.
- Timeline sticky headings now use `top-16` at
  `timeline/page.tsx:205-208`; not carried forward.
- Admin image manager remains table-based on narrow screens, but I could not
  gather authenticated browser evidence this pass; left as residual risk rather
  than a current finding.

No critical UI/UX issue was found. The highest-impact current gap is the live
keyword-search failure because it breaks a primary public discovery affordance.
