# GalleryKit UI/UX Designer Review — Run-10 Cycle 5

**Reviewer:** designer agent
**Date:** 2026-07-07
**Scope:** Live local dev instance (`http://localhost:3000`, Next.js 16.2.9, pre-existing
server PID 57860 reused — not started by me, left running for other lanes on exit), plus a
one-time production build/serve (`http://localhost:3101`, `next build && PORT=3101 npm run
start`) built and torn down entirely within this session specifically to verify the two
cycle-4 fixes this cycle was asked to check. **Method: live browser verification** via
`agent-browser` (core/config/interact/debug), using synthetic `TouchEvent`/`Touch`
construction, `sessionStorage` injection, `performance.getEntriesByType('navigation')`
navigation-counting, and console/error-buffer inspection. No repo files were modified. My
production server and its build artifacts were cleaned up (process killed, port 3101
confirmed clear) before finishing.

**Predecessor:** `.context/reviews/cycle-4-2026-07-07/designer.md` (DES4-01, DES4-P1/P2/P3)
and `_aggregate.md` (C4-03, C4-12, and the rest of the C4-0x/1x ledger). This cycle's start
HEAD `d9bcbf4c` contains the fixes for both items I was asked to verify: `4afacfa8`
(C4-03/DES4-01, deterministic `isPinned` first render) and `9dccebcd` (C4-12, native
non-passive `touchmove` listener).

## Summary

Both requested cycle-4 fixes check out: **C4-03/DES4-01 is genuinely fixed** (zero hydration
errors, both dev and a real production build, both desktop and mobile viewports — the mobile
control still settles correctly too), and **C4-12 is genuinely fixed** (a synthetic two-finger
pinch dispatched directly at the DOM now produces `defaultPrevented: true` with no "unable to
preventDefault inside passive listener" console intervention, and the zoom transform applies
correctly end-to-end). Bonus positive check: the shared PERF4-01/C4-04 shallow-URL-sync fix
also verified live — an in-place shared-group arrow-key step updates the URL without adding a
new `performance` navigation entry, confirming it's a real `history.replaceState`, not another
RSC round-trip.

While verifying C4-03 I went looking for whether the exact bug pattern (reading
`sessionStorage`/`matchMedia` directly inside a `useState` lazy initializer) had a sibling
elsewhere in the same file, since that's exactly the kind of thing a same-file, same-cycle fix
tends to leave behind. It does: **`showLightbox`'s lazy initializer six lines below `isPinned`
has the identical structural flaw, and I empirically reproduced a real production hydration
mismatch (React #418) from it** — narrower blast radius than DES4-01 (it needs a specific,
plausible-but-not-universal race), but the same bug class, in the same file, in the same
commit's blast radius, left unfixed. Full detail in DES5-01.

## Findings

| ID | Severity | Confidence | Status | Evidence | Title |
|----|----------|------------|--------|----------|-------|
| DES5-01 | MEDIUM | High (empirically reproduced against a real production build) | NEW | `photo-viewer.tsx:76-82`; `agent-browser errors --json` on port 3101 after a forged-flag hard reload | `showLightbox`'s `useState` lazy initializer reads `sessionStorage` unconditionally — the identical anti-pattern DES4-01/C4-03 just fixed six lines above it, still live, and reproducibly triggers React #418 in production |
| DES5-P1 | — | High (reproduced, dev + prod, both viewports) | VERIFIED FIXED | `agent-browser errors --json` on 3000 and 3101, `/en/p/99` (mobile control) and `/en/p/100` (desktop) | C4-03/DES4-01: `isPinned` hydration mismatch is gone |
| DES5-P2 | — | High (reproduced via synthetic DOM `TouchEvent`) | VERIFIED FIXED | `defaultPrevented` + console-warning check on a dispatched 2-touch pinch | C4-12: `touchmove` is now native/non-passive; `preventDefault()` actually suppresses the gesture |
| DES5-P3 (bonus, not requested) | — | High (reproduced) | VERIFIED FIXED | `performance.getEntriesByType('navigation').length` unchanged across an in-place arrow-key step in a shared group | C4-04/PERF4-01: shared-group stepping is a shallow `history.replaceState`, not a real navigation |

---

### DES5-01 — `showLightbox`'s lazy initializer has the same SSR-unsafe pattern DES4-01 just fixed, and it reproducibly triggers React #418 (MEDIUM, High confidence)

**Location:** `apps/web/src/components/photo-viewer.tsx:76-82`, six lines above the code
DES4-01/C4-03 fixed this same cycle:

```js
const [showLightbox, setShowLightbox] = useState(() => {
    try {
        const auto = sessionStorage.getItem('gallery_auto_lightbox') === 'true';
        if (auto) sessionStorage.removeItem('gallery_auto_lightbox');
        return auto;
    } catch { return false; }
});
```

This is structurally identical to the just-fixed `isPinned` bug: the server always throws into
the `catch` (no `sessionStorage` in Node), so SSR always renders `showLightbox = false`. On a
genuine full-document hydration where `sessionStorage.getItem('gallery_auto_lightbox')` is
already `'true'`, the client's first render computes `true`, diverging from the server's fixed
`false`. Unlike `isPinned` (a class/text-node-level divergence), `showLightbox` gates a much
larger structural swing: the entire main view is toggled `hidden` (`className={cn(...,
showLightbox && "hidden")}`, line 566) **and** the whole `<Lightbox>` overlay tree is
conditionally mounted (`{showLightbox && (<Lightbox .../>)}`, line 1013) — a bigger subtree
discard/regenerate than DES4-01's case.

**Why this is narrower than DES4-01, and why it's still worth fixing:** the flag is normally
written and consumed within the same soft (client-side, non-hydrating) navigation — the
standalone `/p/[id]` page passes `images={[image]}` (a **singleton array**, confirmed by
reading `app/[locale]/(public)/p/[id]/page.tsx:287`), so *every* arrow-key press while the
lightbox is open takes the `router.push` branch in `navigate()` (never the in-place
`setCurrentImageId` branch), setting `gallery_auto_lightbox` immediately before navigating.
I verified live that this normal path is clean: opening the lightbox on `/en/p/100`, pressing
`ArrowRight`, landing on `/en/p/99` with the lightbox still open, zero console errors — because
a same-tab App Router client navigation to a new dynamic-segment page is a plain client mount
(no `hydrateRoot` reconciliation against server HTML), so there's no *comparison* to mismatch
against; the initializer just reads the real, current client value. The bug only surfaces when
a **genuine full-document hydration** happens while the flag is still `'true'` — realistically,
a hard reload/tab-relaunch landing in the narrow window between `sessionStorage.setItem()` and
the destination page's mount (which self-clears the flag within the same synchronous
initializer call). This is a real, if infrequent, condition for actual users: mobile browsers
routinely discard backgrounded tabs and reload them fresh on refocus, and a user who swipes to
the next photo and immediately backgrounds the app (to check a notification, take a call, etc.)
lands exactly in this window; a slow/flaky connection stalling the RSC fetch and prompting an
impatient manual refresh is the same shape of race.

**Empirical reproduction (production build, not just source reading):**

```
agent-browser open http://localhost:3101/en/p/99          # fresh session, viewport 1440×900
agent-browser eval "sessionStorage.setItem('gallery_auto_lightbox','true')"
agent-browser reload                                       # simulates the hard-reload-during-the-window case
→ agent-browser errors --json:
  "Error: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML..."
→ post-reload: sessionStorage.getItem('gallery_auto_lightbox') === null (self-cleared as designed)
→ post-reload: document.querySelector('[role="dialog"]') === null (lightbox did NOT reopen)
```

Two things worth separating: (1) the mechanism is real — a stale-but-live flag at genuine
hydration time reproducibly throws React #418 in a real production build, not just a dev
artifact (I initially got a false "clean" read on the **dev** server for this exact scenario —
zero error, flag cleared, lightbox stayed closed — which is consistent with React dev-mode's
double-invoked render calling this *impure* initializer twice, the second call reading back
`null` after the first call's own `removeItem()`, silently absorbing the divergence in dev only;
the production build has no such double-invoke, and there the mismatch surfaces for real). (2)
even setting the console error aside, the feature **silently fails its own purpose** in this
race — the whole point of the flag is to reopen the lightbox on the new page, and in the
reproduction it does not reopen, because React's hydration recovers using values consistent
with the server-rendered subtree rather than the client's momentarily-diverging result.

**Suggested fix:** apply the exact pattern this cycle's `isPinned` fix already established in
the same file — render the deterministic SSR default (`false`) directly in `useState`, then
consume/clear the flag in a mount effect (guarded against React Strict Mode's double-invoke the
same way `pinRestoredRef` guards the `isPinned` restore). This closes the same door twice in one
file with one already-proven idiom, and removes the only currently-known way this project's own
"restore user intent after an internal navigation" mechanism can silently defeat itself.

---

## Priority verification detail (fixes I was asked to check this cycle)

### DES5-P1 — `4afacfa8` (C4-03/DES4-01): deterministic `isPinned` first render (VERIFIED FIXED)

```
# Dev server (3000), fresh session, desktop 1440×900, /en/p/100
agent-browser errors --json → {"errors":[]}
sessionStorage.getItem('gallery_info_pinned') → "true"   (matchMedia-derived default, correctly
                                                           restored post-mount, matching DES4-01's
                                                           described intended behavior)

# Dev server (3000), fresh session, mobile control 390×844, /en/p/99
agent-browser errors --json → {"errors":[]}
sessionStorage.getItem('gallery_info_pinned') → "false"  (matches SSR default, no divergence)

# Production build (3101), fresh session, desktop 1440×900, /en/p/99
agent-browser errors --json → {"errors":[]}
sessionStorage.getItem('gallery_info_pinned') → "true"
```

Source review of `photo-viewer.tsx:102-133` confirms the fix matches the suggested pattern
exactly: `useState(false)` (matches SSR unconditionally), a `pinRestoredRef`-gated mount effect
restores the persisted/viewport-derived value with `eslint-disable-next-line
react-hooks/set-state-in-effect` comments documenting the intentional post-hydration restore,
and the persist-back effect skips writing until the restore has run (so a transient pre-restore
`false` can't clobber a stored `true`). No residual issue found — the fix is both structurally
sound and empirically silent (zero console output) across every combination I checked. Closes
C4-03/DES4-01 cleanly.

### DES5-P2 — `9dccebcd` (C4-12): native non-passive `touchmove` (VERIFIED FIXED)

Real touch hardware isn't available to me (agent-browser drives headless Chromium), so instead
of trusting the source diff alone, I drove the actual DOM event path: constructed real `Touch`
objects and dispatched a `cancelable: true` two-finger `touchstart` (100px apart) followed by a
`touchmove` (160px apart, i.e., a pinch-out) directly at the `ImageZoom` container
(`[role="button"]` wrapping `.photo-viewer-image`):

```
moveEvt.defaultPrevented → true       (preventDefault() was actually honored)
startEvt.defaultPrevented → false     (touchstart doesn't call it — expected, matches source)
transform → "scale(1.6) translate(0%, 0%)"   (160/100 = 1.6×, math applied correctly)
agent-browser console (post-dispatch) → no "Unable to preventDefault inside a passive event
                                          listener" intervention warning
```

This confirms, at the DOM level (not just by reading the diff), that: (1) the listener really is
registered non-passive now — no browser intervention warning fired where the pre-fix code would
have logged one on every pinch frame, and (2) the pinch math pipeline still works end-to-end
through the new native-listener path. Source review of `image-zoom.tsx:262-319` confirms the
implementation mirrors the file's own pre-existing non-passive `wheel` listener pattern, and the
`handleTouchMove` callback's stable identity (`useCallback` deps `[applyTransform]`, itself
`[]`) means the effect attaches the listener exactly once per mount — no listener churn.

**One residual, lower-confidence note (not filed as a separate finding, flagging for
awareness):** the container's CSS `touch-action` is state-driven —
`style={{ touchAction: isZoomed ? 'none' : 'auto' }}` (`image-zoom.tsx:370`) — and `isZoomed`
only flips to `true` *after* the JS pinch handler processes the gesture, so at the moment a
pinch **begins** from an unzoomed state, `touch-action` is still `'auto'`. `touch-action` is
read by the browser at gesture-start to decide whether it may take over the gesture without
waiting on JS; some mobile browsers (notably iOS Safari's page-level pinch-zoom, which has a
history of not fully honoring `touchmove` `preventDefault()` for its own native pinch gesture,
independent of listener passivity) could in principle still recognize and drive native
page-zoom concurrently with the app's own zoom during that specific from-unzoomed pinch, on top
of the app's transform. I could not verify this either way — it requires real touch hardware
and a real WebKit engine, neither available via headless Chromium — so I'm surfacing it as a
**Needs-validation** awareness note for whoever next tests this on an actual iOS device (the
audience this app's own Color & HDR documentation treats as primary), not asserting it as a
confirmed regression. If it turns out to be real, setting `touch-action: none` unconditionally
on this container (rather than gating it on `isZoomed`) would be the natural next fix, at the
cost of also blocking native single-finger page scroll through the image at rest — which is
presumably why it's currently conditional.

### DES5-P3 — `0da58d6b`/C4-04/PERF4-01: shared-group shallow URL sync (VERIFIED FIXED, bonus check)

Not one of the two fixes I was specifically asked to verify, but directly adjacent to the same
file and worth a quick live check given its HIGH severity in the cycle-4 ledger (share-limiter
exhaustion mid-browse). Opened `/en/g/Abc234Def5?photoId=99`, recorded
`performance.getEntriesByType('navigation').length === 1`, pressed `ArrowRight`, confirmed the
URL updated to `?photoId=100` while the navigation-entry count stayed at `1` (i.e., no new
document/RSC round-trip was created) and zero console errors. Confirms the fix is a true
`history.replaceState` shallow sync, not another server round-trip — closes my own live check on
C4-04/PERF4-01 (the aggregate already had source-level + perf-lane confidence; this adds a
direct browser-level confirmation).

## What I did not chase further (time-boxed, not blocking)

- Did not re-run the full keyboard-nav / reduced-motion / dark-light / i18n / mobile-bottom-sheet
  sweep — cycle-3 and cycle-4 both covered this exhaustively with no regressions found, and no
  code touching those surfaces changed between `ec433dc4` and `d9bcbf4c` beyond the two fixes I
  was asked to check plus the shared-group perf fix (verified above). Re-running an identical
  pass with no code delta would not produce new signal.
- Did not attempt to validate the `touch-action`/iOS Safari pinch-gesture concern noted under
  DES5-P2 on real hardware — flagged as an open awareness note, not a scored finding, pending
  someone with a physical iOS device.
- Did not re-litigate C2-53/C2-54 or the C96-09/10/11 field-level form-error deferrals — checked
  the carry-forward register first; none of their exit criteria fired this cycle, and none of
  the touched files this cycle are the ones those rows reference.
