# GalleryKit UI/UX Designer Review — Run-10 Cycle 3

**Reviewer:** designer agent
**Date:** 2026-07-07
**Scope:** Live local dev instance (`http://localhost:3000`, Next.js 16.2.9 / Turbopack, e2e
seed DB — 2 photos, 1 topic, 2 tags) reached via a MySQL connection that was already running
on the host, plus static source reading. **Method used: live browser verification**, not a
static-only fallback — MySQL was reachable, the dev server booted, and both public and admin
surfaces were exercised with `agent-browser` (core/query/interact/wait/config/debug) using
accessibility snapshots, computed styles, DOM/state inspection, synthetic touch-event dispatch,
and `curl` header checks. A pre-existing dev server was already up on port 3000 when this review
started (presumably from a sibling review lane) — I reused it rather than starting a competing
one; my own `npm run dev` attempt hit a port conflict and exited immediately with no lingering
process, so there was nothing of mine to stop at the end. No production site was touched this
cycle. Logged into `/admin` with the seeded local admin credentials to review the admin surface
(new ground this cycle — cycle-2's designer lane was production-only/read-only and explicitly
skipped `/admin`); only viewed and cancelled destructive dialogs, no data was created/deleted/
mutated beyond the login session itself.

**Predecessor:** `.context/reviews/cycle-2-2026-07-07/designer.md` (UX-01..UX-05). Deferred
registers consulted: `.context/plans/cycle-2-2026-07-07-deferred.md` (C2-53 = UX-04, C2-54 =
UX-05, both intentionally left low-priority) and `.context/plans/cycle-1-2026-07-06-deferred.md`.
Per instructions, UX-04/UX-05 are not re-litigated below since their deferral reasoning is
unchanged and I found nothing that reopens either.

## Summary

Priority 1 verification is clean: all four named cycle-2 commits do what their commit messages
claim, with no regressions found under active reproduction (not just code reading) — the
lightbox and mobile info-sheet focus-restore fixes (`fc21007a`, `2c82a69c`) both correctly return
focus to their trigger buttons via Escape *and* mouse-click-Close, survive a rapid double-open/
close cycle with no stuck dialogs or lost focus, and the lightbox's own internal Tab-cycle still
wraps correctly (Close → Fullscreen → Next → Close). The ref-based swipe-transform refactor
(`ffc4a06e`) is functionally intact: drag-proportional visual feedback, threshold-crossing
navigation, sub-threshold snap-back, `touchcancel`, and the horizontal→vertical gesture-abort
path all behave exactly as the source implies, confirmed by dispatching synthetic `TouchEvent`s
and checking the resulting URL/DOM state end-to-end rather than just reading the diff. The
extracted `MasonryCard` (`e5504bc8`) still wires `group-hover`/`group-focus-within` correctly —
verified computed `opacity`/`transform` mid-hover and on programmatic focus, not just class-name
presence. The 404 HTTP-status fix (`911cb0f5`) also works exactly as documented — every
not-found URL class I tried (bad photo id, bad topic, bad path, bad collection, both locales)
now returns a real `404` with a usable, localized not-found page (nav, footer, translated
heading, "back to gallery" link) — a clean close of cycle-2's UX-03.

That said, the 404 fix has one residual gap the previous cycle's HTTP-status check didn't
surface (it checked status codes and page content, not raw meta tag output): not-found pages
now emit **two conflicting `<meta name="robots">` tags** in the same document — a live SEO
regression risk that appears to be a direct side effect of moving existence checks from
page-body `notFound()` to segment-layout-level `notFound()`. See DES3-01.

The admin surface (new ground this cycle) is in good shape: the login form's client-side
validation is fully accessible (`aria-invalid`/`aria-describedby` correctly wired on *both*
fields, focus moves to the first invalid field), and the destructive per-row delete confirmation
is a proper `AlertDialog` that defaults focus to "Cancel" and restores focus to the trigger on
close/cancel — exactly the pattern cycle-2 found missing elsewhere.

## Findings

| ID | Severity | Confidence | Status | Evidence | Title |
|----|----------|------------|--------|----------|-------|
| DES3-01 | MEDIUM | High | NEW (regression risk from 911cb0f5) | `curl -D-` + HTML on `/en/nonexistent-page-xyz-abc`, `[topic]/page.tsx:71`, `[locale]/layout.tsx:54-57` | Not-found pages emit two conflicting `<meta name="robots">` tags (`noindex` + `index, follow`) |
| DES3-02 | LOW | Medium (root cause not fully isolated) | NEW, informational | `agent-browser console` on `/en` and the 404 page; `page.tsx:215-231` JSON-LD `<script>` blocks | Sitewide dev-console React warning: "Encountered a script tag while rendering React component" |
| DES3-P1 | — | High | VERIFIED FIXED | `fc21007a`, `2c82a69c`; live focus-restore repro on desktop lightbox + mobile info sheet | Cycle-2 focus-loss regression (UX-01) confirmed closed, including rapid-reopen edge case |
| DES3-P2 | — | High | VERIFIED NO REGRESSION | `ffc4a06e`; synthetic touch-event repro of drag, threshold-nav, snap-back, cancel, vertical-abort | Ref-based swipe transform refactor preserves all gesture behavior |
| DES3-P3 | — | High | VERIFIED NO REGRESSION | `e5504bc8`; computed-style check of `group-hover`/`group-focus-within` on extracted `MasonryCard` | MasonryCard extraction preserves hover/focus caption reveal and image scale |
| DES3-P4 | — | High | VERIFIED FIXED (with DES3-01 residual) | `911cb0f5`; `curl` status codes across 6 not-found URL classes, both locales | Real HTTP 404s confirmed; usable, localized not-found UI in both `en`/`ko` |

---

### DES3-01 — Not-found pages emit two conflicting `<meta name="robots">` tags (MEDIUM, High confidence)

**Evidence:**
```
curl -sD- http://localhost:3000/en/nonexistent-page-xyz-abc-1 | grep -o '<meta name="robots"[^>]*>'
<meta name="robots" content="noindex"/>
<meta name="robots" content="index, follow"/>
```
Reproduced identically across three distinct never-before-seen slugs (to rule out any caching)
and on the topic-not-found path (`/en/nonexistent-topic-xyz`) — both tags are present every
time, in the same order, on a real `404` response. By contrast, a valid page (`/en` home)
renders **zero** `<meta name="robots">` tags at all (Next.js elides the tag entirely for the
`{index: true, follow: true}` default case), so the "index, follow" tag specifically only
appears once the not-found path is triggered.

**Root cause (from source):** `apps/web/src/app/[locale]/layout.tsx:54-57` (the true root layout
— there is no separate `app/layout.tsx`) unconditionally sets `robots: { index: true, follow:
true }` in its `generateMetadata`. `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:71` (and
the sibling `p/[id]`, `c/[slug]`, `year/[year]` pages per the `911cb0f5` commit message) now
`throw notFound()` from *inside* `generateMetadata` itself, rather than returning a
`notFoundTitle`-shaped metadata object with its own `robots` override the way the pre-cycle-2
code did. When a page's `generateMetadata` throws instead of returning, Next.js's own not-found
handling appears to inject a `noindex` tag as a safety default for the 404 render — but this
happens *in addition to*, not *instead of*, the parent layout's already-resolved `robots: {index:
true, follow: true}`, so both land in the final HTML. This reads as a direct, previously-masked
side effect of the `911cb0f5` HTTP-status fix: the *old* code's `notFoundTitle` metadata object
(returned, not thrown) fully replaced the layout's `robots` key per Next's per-key metadata
override semantics, so only one tag ever appeared before. Moving to a thrown `notFound()` for the
real-404 fix bypassed that override path.

**Why it harms users/operators:** this is the exact "soft 404" quality signal cycle-2's UX-03 set
out to fix, just at the meta-tag layer instead of the HTTP-status layer. A conflicting pair of
robots directives on the same document is technically undefined behavior for many crawlers;
Google's stated behavior is to honor the most restrictive directive when duplicates conflict, but
that isn't guaranteed for every search engine or SEO/uptime tool that parses `<meta>` tags
directly (some naively take the first match, some the last, some flag the page as malformed).
Given this fires on **every** not-found URL sitewide (bad photo ids, bad topic slugs, bad paths,
bad collection slugs, in both locales), it's a systemic, not a one-off, signal-quality gap.

**Suggested fix:** give `apps/web/src/app/[locale]/not-found.tsx` its own explicit `metadata`
export (`robots: { index: false, follow: false }`) so there is one authoritative source for the
not-found robots directive, and audit whether Next's notFound()-triggered metadata pass can be
told to suppress/override the ancestor layout's `robots` value rather than layering on top of it
(may require filing/checking against Next.js's tracked behavior here, since this looks like a
framework-level metadata-merge gap around thrown `notFound()` specifically, adjacent to the same
streaming-metadata class of issue `911cb0f5`'s own commit message cites, vercel/next.js#75543).

---

### DES3-02 — Sitewide dev-console warning: "Encountered a script tag while rendering React component" (LOW, Medium confidence)

**Evidence:** `agent-browser console` shows this exact error-level message on **every** page
load I checked (`/en` home, `/en/nonexistent-page-xyz-abc`), not just the not-found path:
```
[error] Encountered a script tag while rendering React component. Scripts inside React
components are never executed when rendering on the client. Consider using template tag
instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).
```
Source: the JSON-LD structured-data blocks rendered as `<script type="application/ld+json"
nonce={nonce} dangerouslySetInnerHTML={{__html: safeJsonLd(...)}} />` in
`apps/web/src/app/[locale]/(public)/page.tsx:215-231` (and the same pattern repeated in
`[topic]/page.tsx`, `p/[id]/page.tsx`, `year/[year]/page.tsx`, `timeline/page.tsx`,
`c/[slug]/page.tsx`) — this is the standard, Next.js-documented way to emit JSON-LD from a
Server Component, and functionally harmless here since `application/ld+json` was never meant to
execute as JS and the tag is present in the initial server-rendered HTML the browser's own parser
consumes directly (not something React inserts into a live DOM after the fact in the normal
navigation flow).

**Why this is LOW/uncertain rather than a real defect:** I could not fully isolate whether this
is (a) a React 19 dev-build-only heuristic warning that doesn't fire in a production build, or
(b) evidence that some client-side reconciliation pass is actually touching/re-inserting these
script nodes (which, if true, would be worth knowing about, though still not user-visible today
since JSON-LD has no client behavior to break). It costs nothing for a photographer/visitor and
doesn't correlate with any visible breakage in this pass — flagging it as a dev-console hygiene
item worth a cheap follow-up (`next build && next start` + check for the same warning) rather
than a confirmed production defect.

**Suggested fix:** reproduce against a production build to confirm whether this is dev-only
noise; if it also appears in `next start` output (server logs won't show it, but a real browser's
devtools console would), consider whether Next's own `Script` component (already imported and
used elsewhere in `[locale]/layout.tsx` for the GA snippet) has an `application/ld+json`-safe
variant, or whether this is simply an accepted framework-level false positive for this
well-documented JSON-LD pattern.

---

## Priority 1 — cycle-2 commit verification detail

### `fc21007a` + `2c82a69c` — focus restore for lightbox + mobile info sheet (VERIFIED FIXED)

Reproduced live, not from source alone:
- Desktop: click "Open fullscreen view" → lightbox opens, focus moves to its "Close" button →
  press `Escape` → `document.activeElement` is the "Open fullscreen view" button (not `<body>`).
- Lightbox internal Tab-trap: Close → Fullscreen → Next image → wraps back to Close on the 4th
  Tab (trap itself intact, matching cycle-2's finding that only the *return* path was broken).
- Mobile viewport (390×844): click "Info" → sheet opens, focus moves to "Close" → **both**
  `Escape` and a real click on the sheet's "Close" button correctly return focus to the "Info"
  trigger.
- Rapid-reopen stress case (open → Escape → open → Escape with no waits in between, targeting the
  "close-while-mounted AND unmount-while-open" cases the `fc21007a` commit message calls out): no
  stuck dialog (`role=dialog` count is 0 afterward), focus correctly lands back on "Info", and
  `agent-browser errors`/`console` show no new errors from the sequence.

No edge case reopened UX-01.

### `ffc4a06e` — ref-based swipe transforms in `photo-navigation.tsx` (VERIFIED NO REGRESSION)

Dispatched synthetic `TouchEvent`s at the actual swipe target (`mediaContainerRef`'s DOM node)
rather than relying on code reading alone:
- Mid-drag (`deltaX = -40`, half the 80px threshold): next-side indicator `opacity` reads `0.5`,
  matching `Math.min(-offset/SWIPE_THRESHOLD, 1)` exactly.
- Past-threshold drag (`deltaX = -100`) + `touchend`: indicator opacity clamps to `1`, and the
  page actually navigates (`/en/p/84` → `/en/p/83`), confirming the imperative-ref visual layer
  and the navigation-trigger logic are both wired correctly post-refactor.
- Sub-threshold drag (`deltaX = -40`) + `touchend`: no navigation (URL unchanged) — snap-back path
  intact.
- `touchcancel` mid-drag: no navigation.
- Horizontal drag past threshold that *then* turns vertical beyond `VERTICAL_LIMIT` (30px) before
  `touchend`: no navigation — the direction-abort logic in `handleTouchMove`/`handleTouchEnd`
  survived the refactor to ref-based writes.

No console errors during any of the above.

### `e5504bc8` — extracted, memoized `MasonryCard` (VERIFIED NO REGRESSION)

- Programmatic focus on the card's `<Link>`: computed `box-shadow` on the ancestor
  `.masonry-card` shows the `focus-within:ring-2 ring-primary ring-offset-2` ring is applied, and
  the desktop caption overlay (`sm:group-focus-within:opacity-100`) computes to `opacity: 1`.
- Real mouse `hover` over the same link: caught mid-transition with overlay opacity `~0.91` and
  image `transform: scale(~1.023)` climbing toward the full `group-hover:scale-105` — confirms the
  `group` class wiring between the extracted card's outer container and its children survived
  the extraction into a separate memoized component.

### `911cb0f5` — real HTTP 404s (VERIFIED FIXED, residual gap filed as DES3-01)

```
404  /en/p/99999999                       (bad photo id)
404  /en/nonexistent-topic-xyz            (bad topic slug)
404  /en/nonexistent-page-xyz-abc         (bad arbitrary path)
404  /ko/p/99999999                       (bad photo id, Korean locale)
404  /ko/nonexistent-topic-xyz            (bad topic slug, Korean locale)
404  /en/c/nonexistent-collection-xyz     (bad smart-collection slug)
200  /en/year/1899                        (syntactically valid year, zero photos — by design)
```
The `/en/year/1899` 200 is **not** a bug: `year/[year]/layout.tsx` deliberately does only "pure
arithmetic validity" (`1 <= yearNum <= 9999`) per its own comment, since a year with zero photos
today isn't a missing resource the way a bad photo id is — it renders a clean, correctly-worded
empty state ("No photos found for 1899.") rather than a blank or broken page. Verified this
renders sensibly rather than assuming it from the layout comment alone.

Both locales' not-found page render a proper heading (`"Page not found."` / `"페이지를 찾을 수
없습니다."`), a working localized "back to gallery" link, and the full nav/footer shell (this was
itself an earlier, separately-fixed regression per the `F-4`/`F-22` comment in `not-found.tsx` —
still holding up here).

## Admin surface — new ground this cycle

Cycle-2's designer lane was production-only and explicitly skipped `/admin`. This cycle logged
into the local dev instance's admin with the seeded credentials to check the surface for the
first time in the designer lane's history.

- **Login form validation** (`apps/web/src/app/[locale]/admin/login-form.tsx`): submitting empty
  correctly shows `role="alert"` error text under *both* fields, with `aria-invalid="true"` and
  `aria-describedby` correctly pointing to each field's own error paragraph (I initially
  mis-measured this via a wrong array index in a quick DOM check — checked by element `id` instead
  and confirmed the wiring is correct on both fields, not just the first). Focus moves to the
  first invalid field (`#login-username`) on failed submit — a good, easily-overlooked pattern.
- **Per-row delete confirmation** (`apps/web/src/components/image-manager.tsx:557-585`): a real
  Radix `AlertDialog` (`role="alertdialog"`), not a native `confirm()` or a home-grown popover.
  Opens with focus defaulted to "Cancel" (the safe non-destructive action), and both "Cancel" and
  the dialog's `Escape` handling correctly restore focus to the row's own delete-trigger button —
  this is exactly the pattern cycle-2 found missing on the lightbox/info-sheet before `fc21007a`/
  `2c82a69c`, and it's already correct here.
- **Row-action touch targets**: "Edit image", "Delete image", and "Remove tag" buttons in the
  dense admin table all measure exactly `44×44` via `agent-browser get box`, matching the
  documented policy even in this information-dense, admin-only surface.
- **Settings page** (`/en/admin/settings`): dark mode applies correctly (`rgb(9,9,11)` body
  background, spot-checked label contrast at effectively white-on-near-black), and every
  color/HDR toggle carries a substantive plain-language help paragraph (including a specific,
  useful callout about the Firefox wide-gamut detection gap and how "Force Show Color Chips"
  mitigates it for admin demos) — this matches the unusually high documentation bar the rest of
  the color pipeline holds itself to.
- **Mobile hamburger nav** (`Nav`/`nav-client.tsx`, checked at 390×844): `aria-expanded` toggles
  `false→true` and the accessible name correctly flips `"Expand menu"` → `"Collapse menu"` on
  open.
- **Search dialog** (⌘K) and **tag-filter chips**: both still correct — search dialog opens with
  proper `role="dialog"`/focus, and every filter chip (`All`, `e2e (2)`, `landscape (1)`,
  `portrait (1)`) carries the right `aria-pressed` state for the currently-active filter. No
  regression from anything touched this cycle.

I did not attempt to reproduce the previously-deferred `C96-12` mobile-admin-overflow item or any
mobile-admin redesign work — out of scope for this pass and unrelated to the priority-1 commits.

## What I did not chase further (time-boxed, not blocking)

- Could not get `agent-browser`'s `reduced-motion` media emulation to actually flip
  `window.matchMedia('(prefers-reduced-motion: reduce)').matches` in this session (tried both
  `set media light reduced-motion` and `set media reduced-motion`, with and without a reload) —
  a tooling limitation, not an app finding. Fell back to source confirmation instead:
  `photo-navigation.tsx`'s `applySwipeVisuals` correctly gates its CSS `transition` string behind
  `!shouldReduceMotion` (line 65-67), consistent with the rest of the app's `prefers-reduced-motion`
  handling that cycle-2 already verified live elsewhere.
- Did not re-verify UX-04 (duplicate "Info"/"Open fullscreen view" accessible names) or UX-05
  (hashtag H1 fallback) beyond confirming UX-04 is still observably present (both "Open fullscreen
  view" buttons are still simultaneously in the DOM during the lightbox Tab-trap check above) —
  both are already correctly deferred as C2-53/C2-54 with unchanged reasoning; no new information
  this cycle reopens either.

## Pages/surfaces browsed

Public: `/en` (home, desktop + 390×844), `/en/p/84` + `/en/p/83` (photo viewer, lightbox,
synthetic swipe gestures), `/en/year/1899`, six not-found URL classes across `en`/`ko`, search
dialog. Admin: `/en/admin/login` (empty-submit validation, successful login), `/en/admin/dashboard`
(upload form, recent-uploads table, edit/delete row actions), `/en/admin/settings` (dark mode).

## Component/source files reviewed

`photo-viewer.tsx`, `lightbox.tsx`, `photo-navigation.tsx`, `info-bottom-sheet.tsx`,
`masonry-card.tsx`, `home-client.tsx`, `not-found.tsx` (`[locale]`), `[locale]/layout.tsx`,
`[topic]/page.tsx`, `[topic]/layout.tsx`, `year/[year]/layout.tsx`, `p/[id]/page.tsx` (JSON-LD
script sites), `login-form.tsx`, `image-manager.tsx` (delete/edit row actions).
