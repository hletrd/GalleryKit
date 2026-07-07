# Test-Engineer Review — Run-10 Cycle 5 (2026-07-07)

Start HEAD: `d9bcbf4c` (terminal cycle-4 commit). Scope: full test surface
(`apps/web/src/__tests__/` — 335 files, `apps/web/e2e/` — 10 specs), with
targeted focus on the cycle-4 commit surface named in the assignment:
`migrate.js` DML guard, single-writer-guard re-acquire, gallery-config
invalidation, sw-cache phantom eviction, photo-viewer hydration, embedding
cursor model-version reset, image-zoom touchmove.

## Method

Built an inventory from `git log d9bcbf4c~30..d9bcbf4c` (the full cycle-4 fix
set), diffed each fix commit against its own test-file changes (or the
absence of any), then read the resulting test bodies and the source they
claim to guard to judge whether the assertions are behavioral, tautological,
or absent. Cross-checked `.context/plans/deferred-carry-forward.md` items
C4-18, C4-30, C94-04, C94-05 for fired exit criteria (none fired — details
below). Confirmed the cycle-4 fd-close false positive (TEST4-01/C4-05) is
correctly closed, not re-broken.

## New findings

### F1 — image-zoom touchmove/passive fix (C4-12) has zero test coverage
**Confirmed / High confidence / Severity MED**

`apps/web/src/components/image-zoom.tsx:262-319` (commit `9dccebcd`, this
cycle): pinch/pan touchmove handling moved from React's passive delegated
`onTouchMove` to a natively-attached `container.addEventListener('touchmove',
handleTouchMove, { passive: false })`, so `preventDefault()` actually
suppresses the browser's own scroll/zoom during pinch. The commit touched
only `image-zoom.tsx` — no test file. `image-zoom-source-contracts.test.ts`
(18 lines total) still only pins the unrelated keyboard-toggle contract from
R2C10; `image-zoom-math.test.ts` tests pure math helpers, not event wiring.
Nothing in the suite would fail if a future edit reverted to the passive
React handler (reintroducing the exact silent-no-op regression this commit
fixed) or dropped `{ passive: false }`.
**Regression that would slip through:** pinch-zoom silently stops
suppressing native scroll/zoom on touch devices again; ships unnoticed since
CI is green.
**Suggested test:** extend `image-zoom-source-contracts.test.ts` with a
source-pin proving (a) `addEventListener('touchmove'` with `passive: false`
literal is present, (b) no `onTouchMove=` prop remains on the container JSX.
This is the same idiom already used for the keyboard-toggle contract in the
same file, so it is a same-file, low-effort addition.

### F2 — hydration-photo-page e2e assertion is tautological, not a real restoration check
**Confirmed / High confidence / Severity LOW-MED (test-only; the product fix itself is sound)**

`apps/web/e2e/hydration-photo-page.spec.ts:47-49`:
```
await expect(
  page.getByRole('button', { name: /pinned/i }).or(page.getByRole('button', { name: /info/i })).first(),
).toBeVisible();
```
The comment above it claims this proves "the pin state must still be restored
post-mount on a desktop viewport." It does not: the `.or()` accepts *either*
button name, and one of the two names is always present regardless of
`isPinned`'s value (`t('viewer.info')` vs `t('viewer.infoPinned')` are the
component's only two states — `photo-viewer.tsx:649-662`). Read against
`photo-viewer.tsx:111-125`: at the spec's 1440×900 viewport with no
sessionStorage seeded, the mount-effect sets `isPinned = true` via
`matchMedia('(min-width: 1024px)')`, so the correct, non-tautological
assertion is that the "pinned" name specifically is shown. As written, a
regression that permanently breaks restoration (e.g. the mount effect never
firing, `isPinned` stuck at the SSR default `false` forever) would still pass
this line — only the hydration-error-count assertion above it would still
catch a full regression, not this specific "restoration still happens"
claim the comment makes.
**Suggested fix:** replace the `.or()` with a single assertion on
`getByRole('button', { name: /pinned/i })` (drop the `/info/i` alternative),
since the spec's own fixed viewport deterministically produces the pinned
state absent stored preference.

### F3 — settings-write cache invalidation (C4-07) has no wiring test
**Confirmed / High confidence / Severity MED**

`apps/web/src/app/actions/settings.ts:228` calls
`invalidateDetachedGalleryConfigCache()` after a successful
`updateGallerySettings` commit — this call site *is* the C4-07 fix (a
settings flip must be observed immediately by detached background
consumers, not up to 2s later). The underlying primitive is well tested in
isolation (`gallery-config-uncached-microcache.test.ts:129-141` proves
`invalidateDetachedGalleryConfigCache()` itself works), but there is no test
anywhere that imports `updateGallerySettings` and asserts it actually calls
the invalidation function. Grep confirms zero test file references
`updateGallerySettings` outside two narrower action tests
(`settings-backfill-required-action.test.ts`,
`settings-semantic-mode-action.test.ts`, neither of which touches this call
site). Compare to the sibling pattern already used elsewhere in this exact
area — `detached-uncached-config-wiring.test.ts` source-pins that
`image-queue.ts`/`admin-backfill-runner.ts` call the *accessor*; nothing
equivalent pins that the *settings action* calls the *invalidator*.
**Regression that would slip through:** a future refactor of
`updateGallerySettings` (e.g., a merge, or moving the call before
`db.update()` commits, or dropping it entirely) silently reintroduces the
bounded-at-2s staleness this cycle's fix eliminated. Nothing in the suite
would turn red.
**Suggested test:** in a new or existing settings-action test file, mock
`@/lib/gallery-config`'s `invalidateDetachedGalleryConfigCache` and assert it
is called exactly once, after the DB write, on a successful
`updateGallerySettings` call.

### F4 — swipe-visual-reset e2e is a single, still-growing multi-phase test (C4-30 concrete instance, worse this cycle)
**Confirmed (structure) / Likely (false-negative risk) / High-Medium confidence / Severity LOW-MED**

`apps/web/e2e/swipe-visual-reset.spec.ts:59-132` is one `test()` block that
now asserts four independent behaviors in sequence: sub-threshold snap-back
(Phase 1), threshold in-place-switch visual reset (Phase 2), C4-29 chevron
in-place reset (Phase 3), and C4-04 repeated-stepping shallow-URL/no-404
regression (Phase 4, added this cycle by `0da58d6b`). This is the concrete,
now-worse instance of the already-tracked carry-forward item C4-30
("share-limiter has no e2e-reachable reset — the flake class remains for any
future /g/ /s/ spec"); flagging per the assignment's instruction to note
whether that exit criterion fired — it has not, and the single-test
structure it warned about has grown by one more phase.

Beyond the already-known diagnostic-granularity loss (a failure anywhere in
the 132-line test reports as one failing test name with no signal on which
phase broke), Phase 4's loop (lines 121-127) has a latent false-negative
risk:
```js
if (page.url() === before) {
    await dispatchSwipe(page, { fromX: 140, toX: 300, y: 300 });
}
```
This is meant to handle "we reached the end of the shared group, reverse
direction." It cannot distinguish that from "the forward swipe silently did
nothing" (e.g., a regression reintroducing the exact C4-12-adjacent passive-
listener class of bug on `photo-navigation.tsx`'s own touch handlers). If the
reverse swipe then succeeds, the loop's `toHaveURL` assertion for that
iteration still passes — masking that forward-stepping was broken for that
step.
**Suggested fix:** now that `prefetch={false}` (F5) and the shallow
`history.replaceState` sync landed, re-evaluate whether the single-session
constraint documented in the file's own comment (lines 52-58) is still
necessary — if the share-limiter pressure is gone, split into separate
`test()` blocks per phase. At minimum, make Phase 4 assert forward progress
explicitly (track visited photo ids in a `Set` and assert it grows each
iteration, or assert direction via an explicit "photoId sequence" check)
instead of "URL differs from immediately prior."

### F5 — shared-grid tile prefetch={false} (C4-04) has zero regression coverage
**Confirmed / High confidence / Severity MED**

`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:208` — the
`prefetch={false}` added this cycle (`0da58d6b`) on the shared-grid
`?photoId=` tile `<Link>`s, specifically to stop viewport-entry RSC
prefetches from draining the same `SHARE_MAX_REQUESTS` (60/min) anti-
enumeration budget the C4-04 fix was written to protect. The sibling
prefetch fixes from the same lineage (masonry-card, the hidden photo-page
link, viewer/navigation `router.prefetch` removal) ARE source-pinned by
`cycle-20-source-contracts.test.ts:25-36`, but that test was not extended to
cover `g/[key]/page.tsx`'s new attribute, and no e2e spec asserts on the
`prefetch` attribute either (Playwright can read it via
`locator.getAttribute` / the rendered `<link rel=prefetch>` absence, but
nothing does).
**Regression that would slip through:** a future edit to the shared-grid
tile markup (e.g., a grid redesign, or a copy-paste from a non-share grid
component) silently drops `prefetch={false}`, reintroducing the exact
share-limiter-draining prefetch storm PERF4-01 identified and C4-04 fixed —
with the open viewer intermittently replaced by a 404 mid-browse in
production, and zero CI signal.
**Suggested test:** add one assertion to
`cycle-20-source-contracts.test.ts`'s existing prefetch-contract test (or a
new one) reading `g/[key]/page.tsx` and asserting the shared-grid tile
`<Link>` carries `prefetch={false}`.

### F6 — swipe settle-animation preservation fix (C4-15) has zero test coverage, and existing e2e cannot distinguish "fixed" from "still broken"
**Confirmed / High confidence / Severity LOW-MED**

`apps/web/src/components/photo-navigation.tsx` (commit `678ebbeb`, this
cycle, +21 lines, no test file touched): adds a one-shot
`skipNextHardReset` ref so the `[prevId,nextId]` layout effect skips its
instant (`transition: ''`) reset exactly once after a successful swipe,
letting the 0.25s `applySwipeVisuals(0, true)` settle animation
(`transform 0.25s cubic-bezier(...), opacity 0.25s ease`, line 72-73) play
out instead of being killed mid-flight. This is a real, observable CSS
property (`element.style.transition`), but nothing checks it:
`swipe-visual-reset.spec.ts` only asserts the *final* `opacity: '0'` value
(e.g. lines 75, 92, 109), which is identical whether the reset was animated
over 0.25s or applied instantly — the two states this fix is supposed to
distinguish are unobservable to the existing suite. Grep confirms zero test
file references `skipNextHardReset` or otherwise inspects the transition
property.
**Regression that would slip through:** removing the `skipNextHardReset.current
= true` sets from the swipe-success branches (lines 213, 219 per grep), or
the check-and-clear logic in the layout effect, silently regresses to the
instant-reset cosmetic bug C4-15/DBG4-04 already found once — CI stays
green because the final state (opacity 0) is unchanged, only the transition
is lost.
**Suggested test:** in `swipe-visual-reset.spec.ts` Phase 2 (the in-place
threshold swipe), immediately after `dispatchSwipe` and before the
indicator settles, assert the indicator element's inline
`style.transition` (or computed `transition-duration`) is non-zero at least
once during the settle window — e.g. sample it in the same
`page.evaluate` that dispatches the touch sequence, right after `touchend`
fires, before `await expect(...).toHaveCSS(...)` polls to the final state.

## Carry-forward exit-criteria check (no re-derivation of home-register detail)

- **C4-18** (component-behavior harness / RTL / jsdom): **not fired.**
  `package.json` still lists only `vitest` (no `@testing-library/*`, no
  `jsdom`/`happy-dom`); `vitest.config.ts` sets no `test.environment`
  (defaults to Node). F1, F2, and F6 above are direct symptoms of this gap —
  each guards client-only interaction/hydration logic that a jsdom+RTL
  harness could unit-test directly instead of relying on source-pins or
  coarse e2e specs.
- **C4-30** (share-limiter e2e reset): **not fired — and concretely worse**
  this cycle. See F4: the single-session swipe spec gained a fourth phase
  rather than gaining an independent reset path.
- **C94-04** (LR route-level behavior coverage): **not fired.**
  `lr-upload-hdr-gate.test.ts` (all ~20 `it` blocks) remains 100%
  `readFileSync` + `.toContain()` source-text assertions against
  `route.ts`'s text; none invoke the real Next.js route handler with a
  constructed request. Confirmed via grep — no test file imports from
  `@/app/api/admin/lr/upload/route` except the unrelated
  `cycle-7-source-contracts.test.ts`.
- **C94-05** (admin first-class Playwright pages): **not fired.**
  `e2e/admin.spec.ts` (166 lines, 8 tests) still covers only
  login-redirect, login/nav, wrong-password, GPS-toggle, topic
  create/delete, and upload workflow. Tags, Tokens (LR PAT management),
  Smart Collections, DB backup/restore, and the semantic-search settings
  admin surfaces remain e2e-untested.

## Positive verification (do not re-derive; cycle-4 fixes with solid nets)

- **TEST4-01/C4-05 fd-close false positive: correctly closed**, matching the
  pattern flagged in the cycle-4 aggregate as this repo's recurring failure
  mode (stale spy against a moved code path). `serve-upload.test.ts:150-163`
  now asserts the real contract (`openMock` called exactly once on the
  streaming GET; the one opened fd's `close` spy called exactly once),
  correctly re-pinned by `d07c6d32`.
- **Single-writer-guard re-acquire (C4-06, `ce15103a`)**: genuinely strong —
  28 `it` blocks covering re-acquire success/contention, stop-during-reprobe
  window, clean-shutdown lapse suppression, and the `.unref()` invariant on
  every armed timer. No gaps found.
- **sw-cache phantom-eviction fix (C4-02, `ad1fd22d`)**: three new tests
  including a direct DBG4-02 repro (two 20MB phantoms + one fresh 20MB write
  against a 50MB cap must not evict the fresh write). Real behavioral
  assertions, not source pins.
- **migrate.js DML guard (C4-01, `b68d09e2`)**: the core "DML-baseline guard"
  describe block (lines 209-282) calls the real exported
  `prepareLegacyDatabaseIfNeeded`/`baselineAllJournalMigrations` against
  constructed journal fixtures and asserts `rejects.toThrow(/DML-bearing/)`
  — genuine behavioral coverage, not text-pinning (a smaller `migrate.js
  source contracts` block at the bottom of the same file is pin-style, but
  it supplements rather than substitutes for the behavioral tests above it).
- **Embedding cursor model-version reset (C4-09/PERF4-12, `d7ca37de`)**:
  `image-queue-embedding-bootstrap-cap.test.ts:275-307` verifies the real
  `drizzle-orm` mocked `gt()` call argument resets to `0` after a
  stub→production flip, not just a state-field assertion. Good quality.

## Summary

- 6 new findings (F1-F6): 4 rated Confirmed/High-confidence product-adjacent
  test-coverage gaps on this cycle's own fix commits (F1 image-zoom
  touchmove, F3 settings-invalidation wiring, F5 shared-grid prefetch, F6
  swipe settle-animation), 1 tautological e2e assertion (F2), 1 test-quality/
  flakiness structural issue with a secondary false-negative risk (F4).
- 0 exit criteria fired among the 4 tracked carry-forward items checked
  (C4-18, C4-30, C94-04, C94-05); C4-30 has concretely worsened.
- 1 pattern-check closed clean: the cycle-4 fd-close false-positive
  (TEST4-01/C4-05) is correctly fixed and did not regress.
- 4 of this cycle's fix commits (single-writer-guard, sw-cache, migrate.js
  DML guard, embedding-cursor reset) have strong, behavioral regression
  nets and needed no findings.
