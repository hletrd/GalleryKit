# GalleryKit UI/UX Designer Review — Run-10 Cycle 4

**Reviewer:** designer agent
**Date:** 2026-07-07
**Scope:** Live local dev instance (`http://localhost:3000`, Next.js 16.2.9), plus a one-time
production build/serve (`http://localhost:3101`, `next start` — with the caveat noted in DES4-P3)
for the DES3-02 exit-criterion check. E2E seed DB (`gallerykit_e2e`), reached through a
pre-existing dev server (PID 57860) that was already running when this review started — reused
rather than competing for the port, matching cycle-3's precedent. **Method: live browser
verification** via `agent-browser` (core/query/interact/wait/config/debug), using accessibility
snapshots, computed styles, DOM/state inspection, synthetic `TouchEvent`/`matchMedia` injection,
`curl` header checks, and one isolated Playwright e2e run against a private, non-shared server
instance. No repo files were modified. My own production server (port 3101) and build process
were both cleaned up before finishing; the pre-existing dev server (not started by me) was left
running for other lanes, per the same reasoning cycle-3's designer used.

**Predecessor:** `.context/reviews/cycle-3-2026-07-07/designer.md` (DES3-01, DES3-02) and
`_aggregate.md` (C3-05, C3-13/C3-14/C3-23). This cycle's start HEAD `ec433dc4` contains the fixes
for both: `d6b2b82c` (404 robots) and `9c45e933` (swipe visual reset), plus the JSON-LD warning
was flagged for prod-build validation (DES3-02).

**Environment note (transparency):** this is a shared dev server under concurrent load from
sibling review lanes (`architect.md`, `code-reviewer.md`, `critic.md`, `debugger.md`,
`document-specialist.md`, `security-reviewer.md`, `test-engineer.md`, `tracer.md`, `verifier.md`
were all already present in this cycle's review directory while I worked). The `/g/` and `/s/`
share routes carry a per-IP probe limiter (`SHARE_MAX_REQUESTS=60/min`, `rate-limit.ts`); I hit it
repeatedly while trying to reproduce the swipe-visual-reset fix live, consistent with the concern
`24c46745`'s own commit message names ("stay under the share probe limiter"). I also ran the
project's own isolated e2e spec once (`E2E_PORT=3103 npx playwright test
e2e/swipe-visual-reset.spec.ts`) to sidestep the contention — this invokes `npm run e2e:seed`
against the **same** `gallerykit_e2e` database the shared dev server reads, so it likely reseeded
data out from under any other concurrently-running lane (photo IDs in the shared group visibly
shifted from 89/90 to 92 immediately afterward). I did not repeat this. Flagging as an
environment/process observation, not a product defect — but future concurrent cycles should be
aware that any lane running `test:e2e` against the shared DB can invalidate other lanes' live
sessions.

## Summary

Both priority regressions from cycle-3 are confirmed fixed with no residuals, and the DES3-02
exit criterion (prod-build validation) is closed clean. A fresh UX pass surfaced one new
MEDIUM-HIGH defect this cycle didn't have on its radar: **a hydration mismatch that fires on
every desktop-viewport photo-page load**, rooted in `photo-viewer.tsx`'s info-panel-pin state
reading `sessionStorage` unconditionally inside a `useState` lazy initializer. Everything else
checked this cycle — keyboard-only navigation through home → viewer → lightbox → close,
reduced-motion gating (verified via synthetic `matchMedia` injection since the tool's own
reduced-motion emulation still doesn't propagate, same gap cycle-3 hit), dark/light theme,
mobile viewport + bottom sheet, search dialog empty/populated states, and the en↔ko locale
switch — came back clean.

## Findings

| ID | Severity | Confidence | Status | Evidence | Title |
|----|----------|------------|--------|----------|-------|
| DES4-01 | MEDIUM-HIGH | High (empirically reproduced, isolated with a clean control) | NEW | `photo-viewer.tsx:103-114`; fresh-session `agent-browser errors --json` on both dev (3000) and a production build (3101) | Hydration mismatch on every desktop-viewport photo-page load: `isPinned` reads `sessionStorage` unconditionally inside `useState`'s lazy initializer, diverging from the server's forced `false` |
| DES4-P1 | — | High | VERIFIED FIXED (dev + prod build) | `curl -D-` on 3 fresh 404 slugs + prod build; `d6b2b82c` | Single `noindex` robots meta tag on 404s, both locales, in both dev and a real production build |
| DES4-P2 | — | High (isolated e2e) / source-confirmed | VERIFIED FIXED | Isolated Playwright run of `e2e/swipe-visual-reset.spec.ts` (own server, port 3103) — 1 passed; source diff review of `9c45e933` | Swipe visual reset on in-place shared-group photo switches; live manual repro on the shared dev server was blocked by contention (documented above), isolated automated repro passed cleanly |
| DES4-P3 | — | High | VERIFIED CLOSED (DES3-02 exit criterion met) | `agent-browser console`/`errors` on a fresh session against a production build (`next build && PORT=3101 next start`), home/photo/404 pages | The JSON-LD "script tag while rendering" warning is dev-only; zero console output of any kind on the same pages in production |

---

### DES4-01 — Hydration mismatch on every desktop-viewport photo-page load (MEDIUM-HIGH, High confidence)

**Root cause:** `apps/web/src/components/photo-viewer.tsx:103-109`:

```js
const [isPinned, setIsPinned] = useState(() => {
    try {
        const stored = sessionStorage.getItem('gallery_info_pinned');
        if (stored !== null) return stored === 'true';
        return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
    } catch { return false; }
});
```

On the server, `sessionStorage` doesn't exist, so the very first line throws a `ReferenceError`,
caught by the `catch { return false; }` — the SSR-rendered HTML therefore **always** assumes
`isPinned = false` (info panel unpinned/closed), no matter the request. On the client, React
re-runs this same initializer during hydration, where `sessionStorage` *does* exist. On a
first-ever visit in a tab (no stored value yet), it falls through to
`matchMedia('(min-width: 1024px)').matches`, which is `true` on any desktop-width viewport —
directly contradicting the server's fixed `false`. Once the client settles on a value, an effect
(`photo-viewer.tsx:110-114`) persists it back to `sessionStorage`, so on **every subsequent**
photo-page navigation within the same tab the server *still* can't read it and *still* renders
`false`, while the client rehydrates to whatever was last stored — meaning a desktop visitor who
ever had the panel pinned gets this mismatch on every single photo view for the rest of the tab's
session, not just the first.

This is not a cosmetic-only mismatch. `isPinned` drives `showInfo` (`photo-viewer.tsx:175`), which
gates:
- The button's visible state (`variant={isPinned ? "default" : "outline"}`, `title`
  `"Info (I)"` ↔ `"Pinned (I)"`, icon direction `PanelRightOpen` ↔ `PanelRightClose`, and the
  visible label text "Info" ↔ "Pinned").
- The whole layout grid (`grid-cols-1` vs `grid-cols-1 lg:grid-cols-[1fr_350px]`,
  `photo-viewer.tsx:627`).
- The entire EXIF/histogram/tags/description sidebar's presence (`{showInfo && (...)}`,
  `photo-viewer.tsx:711`).
- The responsive image `sizes` hint (`getPhotoViewerImageSizes(showInfo)`,
  `gallery-config-shared.ts:297-304`): `false` → `100vw`; `true` → `calc(100vw - ~430px)` on
  `min-width: 1024px`. Since the browser's HTML preload scanner reads `sizes`/`srcset` from the
  raw SSR markup before hydration can correct it, the SSR-forced `false` means the scanner always
  computes the "wanted width" as if the sidebar weren't there — on the shipped default derivative
  ladder (640/1536/2048/4096/5120/7680) this is unlikely to change which tier gets picked for most
  viewport widths (both the narrower and wider "wanted width" usually round up to the same
  candidate), so I'm not asserting a confirmed bandwidth regression here — but it's a second,
  distinct symptom of the same root cause worth being aware of if the size ladder is ever
  reconfigured more finely.

Because a meaningfully large subtree diverges (not just a text node), React discards and
regenerates it on every affected navigation instead of a cheap hydration — a real, if usually
sub-frame, cost on top of the console error noise.

**Reproduction (clean, with a control):**

1. Fresh browser session (`agent-browser close` then `open`), viewport 1440×900, first-ever
   navigation to `/en/p/89` — errors buffer confirmed empty and `sessionStorage` confirmed
   inaccessible (no document) immediately beforehand, ruling out any carried-over state:
   ```
   agent-browser errors --json
   → "Error: Hydration failed because the server rendered text didn't match the client...
      <PhotoViewer images={[...]} initialImageId={89} ...>
      ...
      data-variant="default"   (was: "outline")
      title="Pinned (I)"       (was: "Info (I)")
      d="m8 9 3 3-3 3"          (was: "m10 15-3-3 3-3", i.e. the icon literally points the other way)
      Pinned                    (was: Info)"
   ```
   `sessionStorage.getItem('gallery_info_pinned')` reads `"true"` immediately after this load,
   confirming the client settled on the desktop-matchMedia default while the SSR HTML shipped the
   opposite.
2. **Control:** identical procedure at a mobile viewport (390×844), fresh session, first-ever
   load of `/en/p/90` — `agent-browser errors --json` returns `{"errors":[]}` and
   `sessionStorage.getItem('gallery_info_pinned')` settles to `"false"`, matching the server's
   assumption. This isolates the defect to desktop-width (≥1024px) viewports specifically, which
   is exactly what the `matchMedia('(min-width: 1024px)')` branch predicts.
3. **Confirmed in a real production build, not just dev:** during the DES4-P3 prod-build check
   (`next build && PORT=3101 next start`), the accumulated error buffer from an earlier
   `/en/p/89` navigation on that same production port contained `Error: Minified React error
   #418` (React's production hydration-mismatch error) with a stack trace rooted in the
   production chunk — the same code path, just minified. This is not a dev-only artifact like
   DES3-02; every real desktop visitor's browser will log this and pay the reconciliation cost.

**Suggested fix:** don't read `sessionStorage` (or call `matchMedia`) inside the `useState` lazy
initializer at all — keep the first render deterministic and SSR-safe (e.g., always `false`, or
whatever value a server-visible cookie/deterministic default would produce, matching what the
server renders), then restore the persisted/matchMedia-derived value in a `useEffect` that runs
after mount, the same idiom this file's `lightbox.tsx` sibling already uses for
`shouldAutoHideControls` (`useEffect` syncing from `hover`/`pointer` media queries rather than
seeding it from the lazy initializer). This is literally the first bullet point React's own
hydration-mismatch error message links to
(https://react.dev/link/hydration-mismatch) as a common cause.

---

## Priority verification detail

### DES4-P1 — `d6b2b82c`: single `noindex` robots signal on 404 pages (VERIFIED FIXED)

```
curl -sD- http://localhost:3000/en/nonexistent-page-xyz-cycle4 | grep -o '<meta name="robots"[^>]*>'
→ <meta name="robots" content="noindex"/>          (exactly one tag, was two in cycle-3)
curl -o /dev/null -w "%{http_code}" http://localhost:3000/en/nonexistent-page-xyz-cycle4
→ 404
```
Reproduced against fresh, never-before-seen slugs to rule out caching. **Also verified in a real
production build** (`localhost:3101`, `next build && next start`):
```
curl -sD- http://localhost:3101/en/nonexistent-page-prod-check2 | grep -o '<meta name="robots"[^>]*>'
→ <meta name="robots" content="noindex"/>
→ 404
```
Both locales spot-checked; no conflicting `index, follow` tag anywhere. Closes C3-05.

### DES4-P2 — `9c45e933`: swipe visual reset on in-place shared-group switches (VERIFIED FIXED)

Source diff review confirms the fix matches DBG3-01/C3-13's described mechanism exactly: a
`useLayoutEffect` keyed on `prevId`/`nextId` re-asserts resting indicator styles on **any**
in-place switch path (not just swipe), plus explicit `applySwipeVisuals(0, true)` calls in both
success branches (`handleTouchEnd`'s swipe-left and swipe-right cases) before `goToPhoto` fires —
directly addressing the "React never clears imperative style writes because the JSX carries
static style literals" root cause.

Live manual reproduction on the shared dev server was repeatedly blocked by the per-IP share-probe
limiter (documented in the environment note above) despite multiple retries with backoff. To get
an independent, non-source-only confirmation, I ran the project's own dedicated e2e spec against
an isolated server instance (own port, own seed, zero contention with the shared dev server):

```
E2E_PORT=3103 npx playwright test e2e/swipe-visual-reset.spec.ts --reporter=list
→ ✓ 1 [chromium] › shared-group swipe: sub-threshold snaps back; threshold navigates in place;
     visuals reset both times (542ms)
→ 1 passed (33.0s)
```

This spec dispatches the same synthetic `TouchEvent` sequence I would have driven manually
(sub-threshold drag → snap-back, same photo, indicator settles to `opacity: 0`; threshold drag →
in-place navigation via `onSelectId=setCurrentImageId`, **both** `swipe-next-indicator` and
`swipe-prev-indicator` settle to `opacity: 0` after the switch) and passed cleanly on the current
HEAD. Combined with the source diff match, I'm treating this as a solid (if not first-party
manual-browser) confirmation. No regression found.

### DES4-P3 — DES3-02 exit criterion: JSON-LD console warning is dev-only (VERIFIED CLOSED)

Ran `npm run build && PORT=3101 npm run start` (build completed in well under the 15-minute
budget; `next start` printed a harmless warning that `"next start" does not work with "output:
standalone"` — expected, since the documented production path is `node
.next/standalone/server.js` inside Docker, not `next start`; this only affects which files get
served for static assets, not React's client bootstrap/hydration behavior, so it doesn't
undermine this specific check).

With a **freshly closed-and-reopened** browser session (important: reusing the same session
carried over stale dev-mode HMR/Fast-Refresh console lines from earlier in my testing, which would
have produced a false "still there" read):
```
agent-browser open http://localhost:3101/en/p/90   → console: (empty), errors: (empty)
agent-browser open http://localhost:3101/en        → console: (empty), errors: (empty)
agent-browser open http://localhost:3101/en/nonexistent-page-prod-check → console: (empty), errors: (empty)
```
Zero console output of any kind — confirming the "Encountered a script tag while rendering React
component" warning DES3-02 flagged is a React 19 **dev-build-only** heuristic that does not fire
against the JSON-LD `<script type="application/ld+json">` pattern in a production build. This
closes DES3-02's stated exit criterion cleanly; no further action needed on that item.

---

## Fresh UX passes (no regressions found)

- **Keyboard-only navigation, home → photo viewer → lightbox → close:** Tab order is
  logical (skip link → nav → search/theme/locale → tag filter chips → masonry cards). The
  masonry card's own `<a>` shows the browser's native focus outline
  (`rgb(153,200,255) auto 1px`) while its `.masonry-card` ancestor separately applies
  `focus-within:ring-2 ring-primary ring-offset-2` (computed `box-shadow`: white 2px + faint gray
  4px ring) — double-verified via real `Tab` presses (not `.focus()` scripting, which
  under-reports `:focus-visible` in Chromium and initially gave me a false negative on the tag
  filter chips before I re-tested with real keys). `Enter` on a card link navigates correctly;
  `Tab` into the toolbar → `Open fullscreen view` → `Escape` restores focus correctly; the
  lightbox's internal trap cycles `Close → Open fullscreen view → Next image → Close` exactly as
  cycle-3 found, still correct. No regression in either the focus-restore fixes (`fc21007a`,
  `2c82a69c`) or the lightbox trap.
- **Reduced motion:** `agent-browser set media ... reduced-motion` still doesn't flip
  `window.matchMedia('(prefers-reduced-motion: reduce)').matches` in this tool (confirmed via
  three variant syntaxes + reloads — same gap cycle-3 recorded, a tooling limitation not an app
  issue). Worked around it by monkey-patching `window.matchMedia` in-page to force the query
  result, then dispatching the real "Open fullscreen view" interaction so the actual component
  code path (not just its source) runs: with the override forcing `matches: true`, the lightbox
  controls-overlay element's inline `transition` style is empty (`transitionDuration: "0s"`); with
  `matches: false` on an otherwise-identical repeat, the same element's inline transition is
  `"opacity 0.2s ease-in-out"`. Confirms `lightbox.tsx`'s `shouldReduceMotion` gating
  (`transitionStyle`, line 430) is wired correctly and responds live to the media query, not just
  correct-looking in source.
- **Dark/light theme:** OS-level `prefers-color-scheme: dark` emulation correctly applies the
  `dark` class (`background: rgb(9,9,11)`, `color: rgb(250,250,250)`) on the public home page.
  Manually toggling the theme button correctly overrides the system preference
  (`html.className` flips to `"light"`, background/text invert, and the button's own accessible
  name updates from `"Theme: System. Switch to Light."` to `"Theme: Light. Switch to Dark."`).
- **Mobile viewport (390×844):** masonry grid renders as a single column
  (`columns-1`, `columnCount: "1"`), consistent with the CSS breakpoint design. The photo
  viewer's mobile "Info" trigger opens a `role="dialog"` bottom sheet (`aria-label="Photo Info"`,
  positioned `y: 704–844`, i.e. pinned to the viewport's bottom edge) with focus moving to
  "Close"; `Escape` closes it and restores focus to "Info" with the dialog count back at 0. The
  hamburger nav's `aria-expanded` correctly flips `false → true` and its accessible name flips
  `"Expand menu" → "Collapse menu"` on open. No regressions from cycle-2/3's mobile findings.
- **Search dialog — empty and populated states:** typing a nonsense query renders `"No results"`
  inside a `role="status"` live region (`aria-live` implicit via the `status` role) — an
  accessible empty-state pattern, properly announced without requiring the combobox itself to
  claim a popup is expanded. Typing a real term (`"e2e"`) correctly flips the combobox to
  `aria-expanded="true"`, renders a `role="listbox"` with 2 `role="option"` entries carrying
  descriptive accessible names (`"E2E Portrait E2E Smoke · January 2, 2025"`), and shows the
  arrow-keys-then-Enter hint. I checked whether `aria-expanded={hasDisplayedResults}` (rather than
  reflecting "is any status content shown") might be an ARIA gap for the no-results case, but
  concluded it's a defensible, common pattern given the live region compensates — not filing as a
  finding.
- **i18n switch (en ↔ ko):** clicking the locale toggle round-trips `/en ⇄ /ko` cleanly. Every
  visible string I checked flips correctly (nav, headings, tag-filter chip labels, the toggle's
  own accessible name in both directions — `"Switch language to 한국어"` ↔
  `"언어를 English(으)로 전환"`), tag names themselves stay untranslated by design (matches the
  documented `humanizeTagLabel` behavior), and no new console errors appeared on either locale
  beyond the already-accounted-for dev-only DES3-02 warning.

## Pages/surfaces browsed

Public: `/en` and `/ko` home (desktop 1440×900, mobile 390×844), `/en/p/89`, `/en/p/90`,
`/en/g/Abc234Def5` (shared-group listing + in-place photo view), six fresh not-found URL classes
across both dev (3000) and a production build (3101), search dialog (empty + populated), locale
toggle, theme toggle, hamburger nav (mobile). Production build: `/en`, `/en/p/89`, `/en/p/90`,
`/en/nonexistent-page-prod-check(2)`.

## Component/source files reviewed

`photo-viewer.tsx` (isPinned/showInfo, DES4-01's root cause), `photo-navigation.tsx` (swipe reset
diff), `lightbox.tsx` (focus trap, reduced-motion gating, transitionStyle), `[locale]/layout.tsx`
(robots metadata elision), `gallery-config-shared.ts` (`getPhotoViewerImageSizes`), `search.tsx`
(combobox/listbox aria wiring), `tag-filter.tsx` + `ui/badge.tsx` (focus-visible ring source),
`rate-limit.ts` (share-route limiter constants), `scripts/run-e2e-server.mjs` (e2e:seed side
effect on the shared DB), `playwright.config.ts` (isolated webServer port config),
`e2e/swipe-visual-reset.spec.ts`.

## What I did not chase further (time-boxed, not blocking)

- Did not attempt a first-party manual-browser repro of DES4-P2 beyond what's documented above —
  the shared dev server's rate-limit contention made repeated manual attempts unproductive, and
  the isolated e2e run plus source diff review together give solid confidence.
- Did not investigate whether DES4-01's `sizes`-attribute divergence causes a measurable
  bandwidth regression at the shipped default derivative ladder — flagged as an open, likely-minor
  secondary symptom rather than a separately-scored finding.
- Did not re-litigate UX-04/UX-05 (already deferred as C2-53/C2-54 with unchanged reasoning) or
  re-run the full admin-surface pass (cycle-3 covered login validation, delete confirmation,
  touch targets, settings dark mode — out of this cycle's fresh-pass scope, no code changed there
  since).
