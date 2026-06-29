# Designer Review - Cycle 19

Role: designer for cycle 19. Scope: comprehensive UI/UX/accessibility review of
the GalleryKit Next.js web UI at `/Users/hletrd/flash-shared/gallery`.
Write scope: this review artifact only. No source code changes, commits, pushes,
or deploys were performed.

## Method

Read and followed `AGENTS.md` and `CLAUDE.md`. Loaded the required
`agent-browser` skills/CLI instructions and used `agent-browser 0.22.2` against
the local app where feasible.

Started the app from `apps/web`:

```text
npm run dev -- --hostname 127.0.0.1 --port 3100
```

The app booted at `http://127.0.0.1:3100`, but public gallery pages could not
render real data because local MySQL was unavailable:

```text
connect ECONNREFUSED 127.0.0.1:3306
```

Runtime browser evidence collected:

- `agent-browser` rendered `/en/admin` and `/ko/admin`; both exposed localized
  login landmarks, visible labels, password reveal, and 44 px visible controls.
- `agent-browser` rendered `/en` as the route error boundary because DB-backed
  topic/latest-image queries failed. The route error UI exposed `main`, h1
  `Error`, button `Try again` 143 x 44, and link `Return to Gallery` 143 x 44.
  Screenshot saved to `/tmp/gallery-cycle19-public-error.png`.
- Mobile 390 x 844 `/ko/admin` rendered `lang="ko"` and `dir="ltr"`, with
  visible controls measured at 308 x 44 or 44 x 44.
- Manual dark-class probe showed dark tokens apply (`bodyBg rgb(9,9,11)`,
  foreground `rgb(250,250,250)`). `agent-browser set media dark` did not flip
  `matchMedia('(prefers-color-scheme: dark)')` in this environment, so I did not
  treat media-emulation output as product evidence.
- Browser console/page errors on public pages were DB failures only; no separate
  hydration or blank-screen failure was observed.

Targeted validation:

```text
npm test --workspace=apps/web -- touch-target-audit.test.ts focus-visible-rings-cycle19.test.ts focus-visible-rings-cycle20.test.ts info-bottom-sheet-ia.test.ts a11y-us-p15.test.ts hdr-badge-contrast.test.ts i18n-key-parity.test.ts
```

Result: 7 test files passed, 57 tests passed.

## Inventory

Reviewed UI/docs/source surfaces:

- Docs/contracts: `AGENTS.md`, `CLAUDE.md`, existing `.context/reviews/*`,
  `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Public routes: `/[locale]`, `/[locale]/[topic]`, `/[locale]/p/[id]`,
  `/[locale]/g/[key]`, `/[locale]/s/[key]`, `/[locale]/c/[slug]`,
  `/[locale]/map`, `/[locale]/timeline`, `/[locale]/year/[year]`,
  `/[locale]/privacy`, loading/error/not-found shells.
- Admin routes: login, dashboard, categories, tags, SEO, settings, password,
  users, tokens, DB, analytics, protected loading/error.
- Shared components: `nav-client`, `search`, masonry/home grid, `load-more`,
  `photo-viewer`, `photo-navigation`, `image-zoom`, `lightbox`,
  `info-bottom-sheet`, `lightbox-color-pip`, `color-details-section`,
  `wide-gamut-hint`, `histogram`, map components, `upload-dropzone`,
  `image-manager`, `tag-input`, `bulk-edit-dialog`, admin nav/header, and
  Radix/shadcn primitives.
- Style/system contracts: `globals.css`, `button.tsx`, focus-visible tests,
  touch-target audit, i18n key parity, reduced-motion and forced-colors CSS.

Coverage by requested dimension:

- Information architecture: public nav/topics/search, photo detail IA, timeline,
  map, admin dashboard/settings/categories/tokens.
- Affordances: icon buttons, password reveal, search trigger/dialog, info panel,
  lightbox, map popups, upload/dropzone, destructive dialogs.
- Focus/keyboard: browser snapshots for login/error; source review for focus
  traps, Esc, shortcuts, IME guards, focus-visible tests.
- WCAG 2.2: target size, focus appearance, labels, live regions, dialog naming,
  reduced motion, forced colors, error/empty states.
- Contrast/dark/light: token source, HDR badge contrast test, manual dark class
  probe, forced-colors CSS.
- ARIA/focus traps: Search, lightbox, bottom sheet, route shells, load-more,
  map list fallback.
- Responsive breakpoints: mobile nav/login/photo bottom sheet, masonry columns,
  admin table behavior, timeline sticky headers.
- Loading/empty/error: route loading/error/not-found, photo loading, load-more,
  home empty/filter empty, map empty, tokens empty/loading, upload no-topic.
- Forms/validation UX: login, upload, tag input, settings, token creation/revoke,
  admin user/image dialogs.
- i18n/RTL: en/ko browser evidence, key parity test, `getLocaleDirection`.
- Perceived performance: masonry `content-visibility`, image sizing/fetch
  priority, lazy map CSS, load-more live status, blur placeholders, reduced
  motion.

## Findings

### DES19-01 - Photo-page swipe navigation is attached to `window`, so horizontal gestures outside the media surface can change photos

Severity: Medium
Confidence: High
Route/selector: `/[locale]/p/[id]`, global `window` touch listeners while
`PhotoNavigation` is visually mounted inside the media box.

Evidence:

- `apps/web/src/components/photo-navigation.tsx:47-60` records every
  `window` touch start/move and calls `preventDefault()` once horizontal
  movement exceeds 10 px.
- `apps/web/src/components/photo-navigation.tsx:96-133` completes navigation
  from the same global gesture and registers `touchstart`, `touchmove`, and
  `touchend` on `window`.
- `apps/web/src/components/photo-viewer.tsx:687-694` mounts
  `PhotoNavigation` inside the image container, but the event scope is not
  limited to that container.

Failure scenario:

A phone user opens a photo, starts a horizontal pan while reading metadata,
interacting with page chrome, or beginning a browser-edge gesture. The gallery
can prevent default scrolling and navigate to the previous/next photo even
though the gesture did not start on the photo.

Fix:

Scope swipe listeners to a media-container ref, or record the touch-start target
and ignore gestures that begin outside the image/navigation surface. Add a
mobile touch regression that swipes metadata/bottom-sheet/page chrome and
asserts the current photo does not change.

### DES19-02 - The main photo is exposed as a generic zoom button, hiding the photo identity from the focused control name

Severity: Medium
Confidence: High
Route/selector: `/[locale]/p/[id]`, `.photo-viewer-image` inside `ImageZoom`.

Evidence:

- `apps/web/src/components/image-zoom.tsx:343-362` wraps the photo content in a
  focusable `div role="button"` named only by `aria-label={Zoom in|Zoom out}`.
- `apps/web/src/components/photo-viewer.tsx:720-723` uses that wrapper around
  the primary image surface.
- The page has a hidden h1 at `apps/web/src/components/photo-viewer.tsx:562-564`
  and the underlying image path carries alt text, but the tabbable object at the
  center of the page announces the action, not the photo title/subject.

Failure scenario:

A keyboard or screen-reader user tabs to the main visual object on a shared
photo page and hears only "Zoom in button." They cannot confirm which photo is
focused without moving to surrounding metadata or heading navigation.

Fix:

Preserve the photo identity in the accessible name or separate the zoom action
from the image semantic. Options: make zoom a distinct adjacent button; render
the image as a `figure`/`img` and attach zoom to a named control; or include the
photo title/alt in the wrapper name and move shortcut/action details to
`aria-describedby`.

### DES19-03 - First-time desktop photo pages hide metadata, color/HDR explanation, similar photos, and download behind a non-default info panel

Severity: Medium
Confidence: Medium
Route/selector: `/[locale]/p/[id]`, desktop info sidebar.

Evidence:

- `apps/web/src/components/photo-viewer.tsx:103-108` initializes `isPinned`
  from `sessionStorage`, defaulting to `false`.
- `apps/web/src/components/photo-viewer.tsx:174-175` maps `showInfo` directly
  from `isPinned`.
- `apps/web/src/components/photo-viewer.tsx:736-747` hides the desktop sidebar
  unless `showInfo` is true.
- The hidden sidebar contains color details, wide-gamut hint, similar photos,
  EXIF, histogram, capture date, and download controls at
  `apps/web/src/components/photo-viewer.tsx:787-999`.

Failure scenario:

A client receives a direct photo link, inspects the image, and leaves without
finding download, title/caption, color/HDR delivery notes, or similar photos
because the only desktop entry point is the toolbar Info button.

Fix:

Default the desktop sidebar open on direct photo pages, or add a compact
persistent summary/download strip outside the panel. If keeping the immersive
default, make the first-run desktop affordance more explicit and surface
download/color status outside the hidden panel.

### DES19-04 - Admin image management remains a wide table in a scroll container, so mobile/event-day management is not first-class

Severity: Medium
Confidence: High
Route/selector: `/[locale]/admin/dashboard`, Recent Uploads image manager.

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`
  places `ImageManager` in `max-w-full ... overflow-auto`.
- `apps/web/src/components/image-manager.tsx:421-445` renders a 9-column table:
  select, preview, title, filename, topic, tags, gamut, date, actions.
- `apps/web/src/components/image-manager.tsx:463-492` includes a 128 px preview
  and a `min-w-[200px]` tag editor column.
- Row actions are far right at `apps/web/src/components/image-manager.tsx:544-579`.

Failure scenario:

A photographer uploads from a phone or small tablet and then needs to fix tags,
title, or sharing. They must horizontally pan a dense table while selection,
thumbnail, editable metadata, and actions are separated across columns, making
wrong-row edits more likely.

Fix:

Add a card/list layout below `lg`: thumbnail, title/filename, topic/date/gamut,
tags, and edit/delete/share actions in one vertical unit. Keep the table for
desktop. Put bulk selection/actions in a sticky bottom bar on narrow screens.

### DES19-05 - Timeline sticky month headings use `top-0`, so they can slide under the sticky global nav

Severity: Low-Medium
Confidence: Medium
Route/selector: `/[locale]/timeline`, month section headings.

Evidence:

- The global nav is sticky at `top-0` with `z-50` in
  `apps/web/src/components/nav-client.tsx:84-88`.
- Timeline month headings are also sticky at `top-0`, with a lower `z-10`, in
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:204-208`.

Failure scenario:

While scrolling the timeline, the month heading sticks to the viewport top under
the already-sticky nav. On desktop it can be visually obscured by the nav; on
mobile it competes with the nav's 64 px fixed-height region, reducing
wayfinding exactly when the month label should orient the user.

Fix:

Offset month headings by the nav height, for example `top-16`, or expose a CSS
custom property for the sticky nav block size and use it on internal sticky
subheaders. Verify at mobile, tablet, and desktop breakpoints with long year
data.

### DES19-06 - Token revoke can still be hidden mid-request via the Cancel button

Severity: Medium
Confidence: Medium
Route/selector: `/[locale]/admin/tokens`, revoke confirmation dialog.

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:75-85`
  starts the revoke transition and clears the confirmation only on success.
- The dialog `onOpenChange` guards backdrop/Esc close while pending at
  `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:240-241`.
- The visible Cancel button still calls `setConfirmRevokeId(null)` regardless
  of `isPending` at
  `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:247-249`.
- The destructive action button is disabled during pending at
  `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:251-258`,
  but the dialog can disappear if Cancel is clicked after revoke starts.

Failure scenario:

An admin clicks Revoke, then clicks Cancel while the request is in flight. The
dialog disappears even though the server action is still pending, hiding which
credential is being revoked and whether the action completed.

Fix:

Disable Cancel while `isPending`, or convert this flow to the same
settle-before-close `AlertDialog` pattern used by image/user deletion. Keep the
dialog open with a localized "Revoking..." label until the request resolves.

### DES19-07 - Touch-target governance still carries documented admin compact-control budgets

Severity: Low
Confidence: High
Route/selector: admin protected routes and `ImageManager`.

Evidence:

- Runtime Button variants are currently safe: `apps/web/src/components/ui/button.tsx:23-30`
  floors `default`/`sm` to `min-h-11` and icon variants to `size-11`.
- The source audit intentionally retains known admin compact-pattern budgets at
  `apps/web/src/__tests__/touch-target-audit.test.ts:151-245`.
- One remaining `ImageManager` compact pattern is documented at
  `apps/web/src/components/image-manager.tsx:335-338`, relying on the Button
  primitive floor rather than an explicit local `h-11`.

Failure scenario:

A future Button primitive change or one-off admin control can turn historically
accepted compact patterns into real sub-44 px targets. The audit will catch some
changes, but reviewers must reason from exception budgets rather than a simple
"all controls declare or measure 44 px" rule.

Fix:

Retire the remaining budgets over time. Add explicit `h-11`/`min-h-11` to
remaining admin compact controls or replace the source-pattern budget with a
layout-aware measured target-size test.

## Positive Observations

- Login is strong in rendered evidence: visible labels, autofocus, required
  fields, password reveal with `aria-pressed`, alert placement, and 44 px
  visible controls in both English and Korean.
- Route error UI is not a blank failure: `apps/web/src/app/[locale]/error.tsx:22-53`
  provides a main landmark, h1, retry button, and return link; browser-measured
  controls were 44 px high.
- Reduced motion is broadly covered: global CSS clamps animations/transitions
  and suppresses hover scale in `apps/web/src/app/[locale]/globals.css:253-279`;
  photo viewer motion also uses `useReducedMotion`.
- Forced-colors support exists for key photo surfaces in
  `apps/web/src/app/[locale]/globals.css:164-181` and card overlays at
  `apps/web/src/app/[locale]/globals.css:281-300`.
- Search has clear dialog/combobox/listbox semantics, an IME guard, focus trap,
  close control, and live status at `apps/web/src/components/search.tsx:363-524`.
- Mobile photo bottom-sheet IA is intentionally tested; `info-bottom-sheet` now
  orders color details, wide-gamut hint, histogram, EXIF, capture, and download
  consistently, locked by `info-bottom-sheet-ia.test.ts`.
- Map accessibility has a non-map fallback path: skip link and accessible photo
  list in `apps/web/src/app/[locale]/(public)/map/page.tsx:59-89`.
- i18n key parity is enforced by `apps/web/src/__tests__/i18n-key-parity.test.ts:43-67`.
  Current shipped locales are en/ko LTR; `getLocaleDirection` is explicit at
  `apps/web/src/lib/locale-path.ts:37-40`.
- Perceived performance is considered: masonry `content-visibility`,
  responsive image size selection/fetch priority, blur placeholders, lazy
  load-more with live status, and map CSS isolated to the map chunk.

## Validation Limits

The local app server ran, but DB-backed public and protected flows could not be
fully exercised in-browser because MySQL on `127.0.0.1:3306` was unavailable.
This prevented live interaction with real masonry photos, photo detail/lightbox
state, search results, map markers, upload, authenticated settings/tokens
mutations, analytics tables, and e2e seeded flows. Those surfaces were reviewed
statically with exact file evidence.

`agent-browser` color-scheme emulation did not flip `matchMedia` in this
environment, so dark-mode evidence is from source plus manual `html.dark`
computed-style probing, not from OS media emulation.

## Final Missed-Issue Sweep

- Rechecked prior designer issues. The cycle-18 one-time token plaintext
  dismissal issue is improved in current source by
  `plaintextAcknowledged` gating at
  `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:187-238`,
  so it is not re-filed.
- Reviewed likely focus-trap hotspots: search, lightbox, info bottom sheet,
  Radix dialogs, token dialogs, admin user/image destructive dialogs. No new
  high-confidence trap escape or trapped-background issue beyond DES19-06.
- Reviewed loading/empty/error states: route loading/error/not-found, photo
  loading, load-more status, home empty/filter empty, map empty/list fallback,
  tokens empty/loading, upload no-topic. No additional high-confidence issue
  beyond the DB-limited runtime validation noted above.
- Reviewed WCAG 2.2 target size and focus appearance through source plus tests:
  targeted tests passed 57/57; no measured login/error control failed 44 px.
- Reviewed contrast/dark/light/reduced-motion/forced-colors surfaces. No new
  high-confidence contrast failure found in the inspected code.
- Reviewed i18n/RTL: en/ko browser strings rendered, parity test passed, and
  there are no shipped RTL locales. Future RTL support still requires layout QA
  because many controls use physical left/right positioning.

## Summary

Findings: 7 total.

- Medium: 5
- Low-Medium: 1
- Low: 1

No source files were modified. No commit, push, or deploy was performed.
