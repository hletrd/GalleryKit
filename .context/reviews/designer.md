# GalleryKit Designer Review - Cycle 18

Repo: `/Users/hletrd/flash-shared/gallery`
Lane: `designer`, adapted to GalleryKit. No source edits, commits, pushes, or protected review artifacts touched.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `README.md`, `apps/web/README.md`, the current plan/deferred index, and prior UI/product reports for cycle context. UI/product inventory covered:

- Public app routes under `apps/web/src/app/[locale]/(public)`: home, topic, photo, shared photo/group, smart collection read route, map, timeline, year, privacy, about, loading/error/not-found.
- Admin app routes under `apps/web/src/app/[locale]/admin`: login plus protected dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics.
- UI components under `apps/web/src/components`: nav/search/home/masonry/photo viewer/lightbox/info sheet/color details/map/upload/admin header/admin nav/image manager/tag inputs/dialog primitives.
- Design system and behavior support: `apps/web/src/app/[locale]/globals.css`, shadcn/Radix primitives, theme provider, i18n provider, service worker files, EN/KO messages, Playwright and UI contract tests.

Browser evidence: agent-browser was used for local runtime probing. Local dev was blocked by an existing Next dev lock for PID 7042 and port 3000 refused connections; I did not kill the process or delete lock files. A non-destructive `next start` on `localhost:3001` served `/api/live` but DB-backed `/en` returned HTTP 500, so authenticated/admin DB pages were source-reviewed. Agent-browser confirmed the local/live Korean admin login page has `lang="ko"`, `dir="ltr"`, visible username/password fields `308x44`, show-password `44x44`, and submit `308x44`. Playwright fallback measured the live public/demo DOM because agent-browser became unresponsive after several navigations; no findings rely on raw screenshots.

## Confirmed Findings

### DES-C18-01 - Mobile home makes tag controls the first meaningful content before photos

Severity: Medium
Confidence: High
File/region: `apps/web/src/components/home-client.tsx:287-330`; `apps/web/src/components/tag-filter.tsx:63-122`

Why this is real: `HomeClient` renders the heading and full `TagFilter` before the masonry grid. `TagFilter` renders every tag as a 44 px button in a wrapping `role="group"` with no collapse, overflow, or sheet mode.

Browser evidence: live mobile probe at `https://gallery.atik.kr/en`, viewport `390x844`, found `tagGroup {x:16,y:180,w:358,h:200}` and first photo link `{x:16,y:412,w:358,h:238}`. The first photograph starts roughly halfway down the viewport, after eight visible tag chips.

Failure scenario: a visitor opens a shared gallery on a phone and first sees utility filters rather than finished photography. As tag count grows, the gallery feels like a filter catalog and the image-first product promise weakens.

Suggested fix: keep a compact active-filter/primary-topic affordance above the grid and move the full tag set behind a disclosure, horizontal scroller, or filter sheet on mobile. Preserve 44 px targets inside the expanded surface.

### DES-C18-02 - Admin photo management is still a horizontal table rather than a photo workbench

Severity: Medium
Confidence: High
File/region: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`; `apps/web/src/components/image-manager.tsx:427-591`

Why this is real: the dashboard wraps the image manager in `max-h[...] overflow-auto`, and `ImageManager` uses a wide table with separate preview, title, filename, topic, tags, gamut, date, and far-right action columns. Preview is fixed at `128x128`; tag editing is a `min-w-[200px]` cell; actions sit at the row edge.

Failure scenario: an admin reviewing a small batch on a laptop or tablet must horizontally pan between thumbnail, metadata, tags, and actions. This makes visual quality-control slower and raises the chance of editing the wrong row.

Suggested fix: add a responsive card/list workbench below large desktop widths: larger thumbnail, title/filename/topic grouped next to the image, status chips near the preview, and edit/delete/share actions adjacent to the visual. Keep the dense table as a desktop compact mode.

### DES-C18-03 - Admin navigation remains one flat wrapping strip for unrelated workflows

Severity: Low-Medium
Confidence: High
File/region: `apps/web/src/components/admin-nav.tsx:15-49`; `apps/web/src/components/admin-header.tsx:13-26`

Why this is real: ten links are rendered as peers in one wrapping `nav`: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics. The header places brand, the flat nav, and logout in a single wrapping flex row.

Failure scenario: a Korean admin on tablet width sees routine publishing links, access/security links, DB operations, and analytics wrap together. Spatial position changes by viewport and translation length, and high-risk operational pages feel as prominent as daily publishing pages.

Suggested fix: group admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights. On mobile/tablet, expose a drawer or sectioned menu with the active section visible instead of a single wrapping strip.

## Likely Issues

None filed. Cycle-17 issues around token revoke target naming, category alias confirmation, semantic-search Settings copy, and localized analytics country labels are fixed in current source.

## Manual-Validation Risks

- Authenticated admin pages were not browsed with credentials in this pass; dashboard/table findings are source-backed and should be verified with a credentialed Playwright pass before implementation.
- RTL is not a current bug because shipped locales are EN/KO and both resolve to `dir="ltr"`. Treat adding an RTL locale as a dedicated layout/icon/focus-order design task.
- Local DB-backed pages returned a production error shell on `localhost:3001/en`; the error shell itself had working 44 px retry/return controls, but this limited local public-route browsing.

## Positive Evidence

- Admin login touch targets meet the 44 px policy in live and local probes.
- Reduced-motion CSS exists globally in `globals.css`.
- Search/semantic copy, token revoke copy, alias delete copy, and analytics country display were improved since the previous cycle and were not reopened.
