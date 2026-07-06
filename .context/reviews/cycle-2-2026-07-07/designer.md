# GalleryKit UI/UX Designer Review

**Reviewer:** designer agent
**Date:** 2026-07-06/07
**Scope:** Live production instance (https://gallery.atik.kr, read-only) + static review of
`apps/web/src/components/**` and `apps/web/src/app/[locale]/**`.
**Method:** agent-browser (core/interact/query/wait/visual/debug/config) accessibility
snapshots, computed styles, DOM inspection, `curl` header checks, and source reading.
No login, no `/admin`, no form submissions or mutations were performed.

## Summary

This codebase carries an unusually deep accessibility and UX audit history already baked in —
44px touch targets are enforced everywhere and verified live, focus traps, `prefers-reduced-motion`
handling, live regions, and WCAG contrast fixes are pervasive and mostly correct in production.
The gaps found in this pass are narrower and more specific: a genuine focus-management regression
in the two full-screen overlays (Lightbox and mobile Info sheet), a site-wide "soft 404" (missing
pages return HTTP 200), an already-fixed-but-undeployed accessible-name bug on two archive pages,
and two lower-severity naming/fallback-copy rough edges.

## Findings

| ID | Severity | Confidence | Evidence | Title |
|----|----------|------------|----------|-------|
| UX-01 | HIGH | High | `gallery.atik.kr/en/p/348`, `lightbox.tsx`, `info-bottom-sheet.tsx` | Focus is lost to `<body>` after closing the Lightbox or mobile Info sheet |
| UX-02 | MEDIUM | High | `gallery.atik.kr/en/timeline`, `/en/year/2025`, `h2` innerHTML | Month-heading text has no separator ("November 2025276 photos") — already fixed at HEAD, not yet deployed |
| UX-03 | MEDIUM-HIGH | High | `curl -D-` on `/en/p/99999999`, `/en/nonexistent-topic-xyz`, `/en/nonexistent-page-xyz-abc` | All not-found routes return HTTP 200 instead of 404 (soft 404) |
| UX-04 | LOW | High | `document.querySelectorAll('button')` count on `/en/p/348` | Duplicate accessible names ("Info" ×2, "Open fullscreen view" ×2) for different controls |
| UX-05 | LOW | High | `/en/p/348` H1 + document title | Untitled photo's H1/tab title falls back to a raw hashtag string |

---

### UX-01 — Focus is lost to `<body>` after closing the Lightbox or mobile Info sheet (HIGH, High confidence)

**Evidence (reproduced 3 times with a clean methodology, no ambiguity):**

1. Desktop, `gallery.atik.kr/en/p/348`: click the "Open fullscreen view" button (opens the
   Lightbox) → immediately press `Escape` (zero intervening Tab presses) → `document.activeElement`
   is `<body>` (verified via `agent-browser eval "document.activeElement.tagName"`), not the
   button that opened it.
2. Mobile viewport (390×844), same page: click the mobile "Info" toolbar button (opens
   `InfoBottomSheet`) → click the sheet's own visible "Close" (X) button → `document.activeElement`
   is again `<body>`. Reproduced both via `Escape` and via a real mouse click on Close, so it is
   not a keyboard-only edge case.
3. Contrast/control: the same page's Search dialog (⌘K) does NOT have this bug — open Search,
   `Escape`, and `document.activeElement` correctly returns to the "Search photos" trigger button.
   This proves the app already knows how to do focus-return correctly (see `search.tsx`'s
   `triggerRef` + `wasOpenRef` effect) — the Lightbox and InfoBottomSheet are the exceptions.

**Root cause (from source):**
- `apps/web/src/components/photo-viewer.tsx:518` wraps the ENTIRE toolbar (including the
  `LightboxTrigger` button that a keyboard user would have focused) in
  `showLightbox && "hidden"` — i.e. `display: none` — for as long as the Lightbox is open. The
  Lightbox's own mount/unmount effect (`lightbox.tsx:434-450`) captures
  `previouslyFocusedRef.current = document.activeElement` on mount and calls
  `previouslyFocusedRef.current.focus()` on unmount, guarded only by
  `document.body.contains(...)`. That guard passes (the button is still in the DOM), but
  `.focus()` on a `display:none` element is a no-op, so focus silently falls through to `<body>`.
- `apps/web/src/components/info-bottom-sheet.tsx` has no manual focus-restore of its own; it
  relies on `focus-trap-react`'s default `returnFocusOnDeactivate`. But the component's own guard
  (`if (!isOpen || !image) return null;`) unmounts the `FocusTrap` and its whole subtree in the
  *same* commit that flips `active` to `false` (rather than rendering one commit with
  `active={false}` before unmounting), which appears to race the library's own focus-restore
  logic against the browser's synchronous "focused element removed → focus body" behavior.

**Why it harms users:** every time a keyboard or screen-reader user opens the fullscreen lightbox,
or (on mobile, the primary viewing surface) the info sheet, and then closes it — which is a core,
repeated action on the app's single most important screen — their focus silently drops to the top
of the document instead of returning to context. They must re-Tab from the very start of the page
to resume where they left off. This is a real, repeated loss-of-place regression on the app's
primary content-viewing interaction (WCAG 2.4.3 Focus Order intent).

**Suggested fix:**
- Lightbox: don't hide the ancestor toolbar with `display:none` while the Lightbox is mounted
  (the Lightbox is already a `fixed inset-0 z-50` overlay covering it visually) — or have
  `PhotoViewer` pass an explicit trigger ref into `Lightbox` (mirroring `search.tsx`'s pattern)
  instead of relying on `document.activeElement` snapshotting through a soon-to-be-hidden node.
- InfoBottomSheet: adopt the same explicit `triggerRef`-based restore `search.tsx` already uses,
  or restructure the close path so `FocusTrap`'s `active` prop transitions to `false` in a commit
  where the trap (and its restore logic) is still mounted, before the parent unmounts it.

---

### UX-02 — Month-heading text has no separator on Timeline / Year-in-Review (MEDIUM, High confidence — already fixed at HEAD, pending deploy)

**Evidence:** on both `gallery.atik.kr/en/timeline` and `gallery.atik.kr/en/year/2025`, the month
section heading's `innerHTML` is:
```
November 2025<span class="ml-2 text-sm font-normal text-muted-foreground">276 photos</span>
```
`h2.textContent` is literally `"November 2025276 photos"` — no `" · "` separator text node is
present, only the `span`'s `ml-2` CSS margin provides visual spacing. A screen reader (or any
tool that reads accessible name/text content rather than rendered layout) announces the whole
heading, and the ARIA "region" landmark it labels, as the run-on string `"November 2025276 photos"`.
Confirmed live with a cache-busting query param and confirmed the response is
`cache-control: private, no-cache, no-store, max-age=0, must-revalidate` (not a CDN/browser
caching artifact — this is what the running server actually renders).

**Important:** `git log` shows commit `c923e15d` ("fix(a11y): restore focus, add page headings,
separate month counts") already adds a `{' · '}` separator between the month name and the count
span in both `apps/web/src/app/[locale]/(public)/timeline/page.tsx:220` and the equivalent
`year/[year]/page.tsx:181`, and `git status`/`git diff HEAD` show **no** uncommitted changes to
either file — the fix is committed and present in the current working tree. The live site is
therefore running a build older than this commit. **A redeploy should resolve this without any
further code change**; worth confirming the deploy pipeline is current (per `CLAUDE.md`, deploys
are meant to run per-iteration/per-commit).

**Severity:** MEDIUM — visually the spacing looks fine (CSS margin), so sighted users are
unaffected; the degradation is specifically in the accessible name / screen-reader experience, on
two full archive pages (every month section, every year).

---

### UX-03 — All not-found routes return HTTP 200 instead of 404 (MEDIUM-HIGH, High confidence)

**Evidence:**
```
curl -sD- https://gallery.atik.kr/en/p/99999999           → HTTP/2 200
curl -sD- https://gallery.atik.kr/en/nonexistent-topic-xyz → HTTP/2 200
curl -sD- https://gallery.atik.kr/en/nonexistent-page-xyz-abc → HTTP/2 200
```
All three render the "Page not found." UI correctly (client-visible content is fine — heading,
"Back to gallery" link, standard nav/footer, no console errors) but the HTTP status line is `200`,
not `404`, in every case. Response headers show `cache-control: private, no-cache, no-store,
max-age=0, must-revalidate` and `server: nginx`, ruling out a caching artifact.

The photo-detail route (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:136,156`) does call
Next.js's `notFound()` in the not-found branch, which should set a 404 status in App Router — so
something in front of or around the Next.js response (the nginx reverse proxy, or the `[locale]`
routing/middleware layer) is not propagating that status to the client. I could not isolate the
exact layer responsible from outside the box (no server/nginx-config access in scope for this
review), but the behavior is consistent and reproducible across a nonexistent photo ID, a
nonexistent topic slug, and an arbitrary nonexistent path.

**Why it harms users/operators:** this is a textbook "soft 404." Search engines (Google Search
Console explicitly flags these as a quality issue) will index removed/invalid photo and topic
URLs as valid 200 pages instead of dropping them, diluting SEO signal. Uptime/broken-link
monitoring tooling that checks HTTP status codes will not detect genuinely missing content. Any
API-like consumer (RSS readers, share-link validators, external integrations) that relies on
status codes rather than parsing HTML will misreport availability.

**Suggested fix:** verify the Next.js standalone server itself returns 404 when queried directly
(bypassing nginx) to isolate whether this is an nginx `proxy_intercept_errors`/custom
`error_page` config issue or a Next `[locale]` middleware/rewrite issue; then correct whichever
layer is swallowing the status.

---

### UX-04 — Duplicate accessible names for functionally different controls (LOW, High confidence)

**Evidence:** on every `/p/[id]` page, `document.querySelectorAll('button')` finds exactly **2**
buttons whose accessible name/text is `"Info"` simultaneously present in the DOM at all times —
one with `lg:hidden` (opens the mobile `InfoBottomSheet`) and one with `hidden lg:flex` (toggles
the desktop sidebar) — distinguished only by responsive CSS visibility (`display:none`), not by
conditional mounting. Separately, the `aria-label` `"Open fullscreen view"` is shared by two
functionally different buttons: `LightboxTrigger` (opens the app's own full-screen overlay,
`photo-viewer.tsx`) and the fullscreen toggle rendered *inside* the Lightbox itself
(`toggleFullscreen`, invokes the native browser Fullscreen API, `lightbox.tsx`).

**Why it matters:** because both are `display:none`-toggled rather than unmounted, they exist
together in the underlying DOM/accessibility tree at every breakpoint, which is exactly what
tripped up automated `find role button --name` tooling during this review and would equally trip
up "find by name"/voice-control assistive technology or anyone using the browser's in-page find.
In practice only one of each pair is ever visible/focusable at a given viewport, so end-user
impact is limited — this is more a naming-hygiene and testability issue than an active point of
user confusion.

**Suggested fix:** low priority; if addressed, differentiate the labels contextually (e.g., via a
shared translation key parameterized per breakpoint) or accept as-is given the low practical
impact.

---

### UX-05 — Untitled photo's H1/tab title falls back to a raw hashtag string (LOW, High confidence, deliberate design choice)

**Evidence:** `gallery.atik.kr/en/p/348` (an untitled photo — sampling suggests most photos in
this ~445-photo gallery are untitled) renders `<h1 class="sr-only">#JIHOON #DOHOON #Color in
Music Festival</h1>` and a document/tab title of `"#JIHOON #DOHOON #Color in Music Festival |
ATIK.KR Gallery"`. This is produced intentionally by `getPhotoDisplayTitle`/`getPhotoDocumentTitle`
in `apps/web/src/lib/photo-title.ts`, which joins the photo's tags with `#` when no title is set —
a sensible default for this photographer's concert-tagging workflow (tags identify performers).

**Why it's worth a note:** for screen-reader users navigating by headings/landmarks, or anyone
scanning browser history/tabs, the page's single most important structural identifier (H1,
`<title>`) reads as a hashtag list rather than a descriptive sentence. It's functional, not
broken, but a rougher edge than the rest of the app's otherwise careful semantic-heading work
(this app is unusually disciplined elsewhere about `h1`→`h2`→`h3` structure, e.g.
`photo-viewer.tsx:518-527`'s explicit `sr-only` H1 comment referencing WCAG 1.3.1/2.4.6).

**Suggested fix:** consider a more descriptive fallback template for the H1/`<title>` specifically
(e.g., a localized "Untitled photo — JIHOON, DOHOON, Color in Music Festival") while keeping the
terse "#tag #tag" hashtag styling for the visible on-page caption/masonry-card overlay, where it
reads fine as a stylistic choice.

---

## What's working well (verified live, not just in code)

- **Touch targets:** every nav control sampled (search, theme, locale switcher, brand link, topic
  pills, footer links, tag-filter chips, load-more button) measured exactly `44×44` via
  `agent-browser get box`, matching the documented policy.
- **Focus trap cycling:** Tabbing through the Lightbox's 3 focusable controls (Close, Fullscreen,
  Next) correctly wraps back to Close on the 4th Tab — the trap itself works; only the
  *return*-focus-on-close path (UX-01) is broken.
- **Search dialog** (⌘K): correct focus-in on open, correct focus-return on close, correct
  `aria-activedescendant`/`combobox`/`listbox` wiring, live keyword search against "TWS" returned
  20 relevant results with camera/lens/date metadata in each row.
- **i18n:** the Korean locale (`/ko`) fully translates every nav label, heading, button, and
  aria-label sampled; `<html lang="ko">` is set correctly; no layout breakage observed with the
  longer Korean strings tested.
- **Theming:** all four theme states (`system`/`light`/`dark`/`oled`) render distinct, correct
  background colors (`rgb(255,255,255)` light, `rgb(9,9,11)` dark, `rgb(0,0,0)` OLED), with an
  accurately-announced `aria-label` ("Theme: Light. Switch to Dark.") on every cycle step and no
  console errors.
- **Contrast:** spot-checked `text-muted-foreground` on white background computes to ≈6.04:1,
  matching the code's own documented 6.03:1 target — the existing contrast remediation holds up
  under direct measurement.
- **Responsive/no horizontal overflow:** at a 320px viewport, `document.documentElement.scrollWidth`
  equals `clientWidth` (no overflow) and the hamburger "Expand menu" toggle measures 44×44.
- **Empty states:** the GPS Map page correctly shows a clean "No geotagged photos are available"
  message (consistent with GPS being privacy-excluded from public queries) rather than an error.
- **Live regions:** photo position counters, load-more status, and slideshow on/off state all use
  proper `role="status"`/`aria-live="polite"` regions.

## Pages browsed

`/en` (home), `/en/p/348` (photo viewer + Lightbox, desktop and 390×844 mobile viewports),
`/ko` (Korean home), `/en/map`, `/en/timeline`, `/en/year/2025`, `/en/p/99999999` (404 case),
`/en/nonexistent-topic-xyz`, `/en/nonexistent-page-xyz-abc`, plus theme cycling and search
interaction on `/en`. All requests were read-only GETs; no forms were submitted, no `/admin`
routes were touched, and request volume was kept light throughout.

## Component/source files reviewed

`photo-viewer.tsx`, `lightbox.tsx`, `lightbox-color-pip.tsx`, `nav.tsx`, `nav-client.tsx`,
`search.tsx`, `home-client.tsx`, `grid-picture.tsx`, `footer.tsx`, `info-bottom-sheet.tsx`,
`tag-filter.tsx`, `wide-gamut-hint.tsx`, `load-more.tsx`, `topic-empty-state.tsx`,
`public-restore-maintenance.tsx`, `photo-navigation.tsx`, `lazy-focus-trap.tsx`,
`lib/photo-title.ts`, `app/[locale]/(public)/timeline/page.tsx`,
`app/[locale]/(public)/year/[year]/page.tsx` (grep-verified fix parity), and
`app/[locale]/(public)/p/[id]/page.tsx` (notFound() call sites).
