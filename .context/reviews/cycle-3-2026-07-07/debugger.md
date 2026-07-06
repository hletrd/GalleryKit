# Debugger Review — Latent Bug Surface (Run-10 Cycle 3)

Repo: `/Users/hletrd/flash-shared/gallery`. HEAD at review time: `e08b6f97`
("docs(review): record run-10 cycle-2 post-deploy verification evidence"). Read-only
review: no source files were modified. One empirical reproduction (migrate.js) was run
directly against the real exported function via plain `node -e`, using an in-memory mock
connection — no source files touched, no DB required.

## Approach

1. Read the predecessor (`.context/reviews/cycle-2-2026-07-07/debugger.md`) and both
   deferred registers (`cycle-2-2026-07-07-deferred.md`, `cycle-1-2026-07-06-deferred.md`).
   No deferred item is re-reported below absent new evidence.
2. Priority 1: read every commit in `642c5091..e08b6f97` (29 commits) with a focus on the
   nine named in the task brief. For each, read the full diff AND the current state of the
   touched file (not just the diff hunk) to check for interactions the diff alone wouldn't
   show.
3. Priority 2: grep-driven inventory across the full repo for `setInterval`/`setTimeout`,
   `process.on`, `AbortController`, `.then(` without a paired `.catch`, and floating
   promises in `lib/`, `app/actions/`, `app/api/`. Each hit was opened and read, not just
   pattern-matched.
4. One finding (migrate.js) was verified empirically by invoking the real exported
   `prepareLegacyDatabaseIfNeeded` against a scripted mock connection, mirroring the
   commit's own test harness shape but with a case its added tests do not cover.

## Findings

### DBG3-01 — Ref-based swipe-visual refactor in `photo-navigation.tsx` leaves stale opacity/transform on the swiped-from edge indicator after a successful in-place photo switch (shared-group view)

- Severity: **Medium** (visible visual glitch on a real, used feature — shared-group
  browsing — not a data-integrity issue; self-corrects on the next swipe gesture).
- Confidence: **High** for the mechanism (verified by reading React's reconciliation
  contract plus the exact code paths involved); **not** reproduced in a live browser.
- Classification: Regression risk introduced by commit `ffc4a06e` ("perf(viewer): ref-based
  swipe transforms in photo navigation").
- Files: `apps/web/src/components/photo-navigation.tsx:158-190` (`handleTouchEnd`),
  interacting with `apps/web/src/components/photo-viewer.tsx:657`
  (`onSelectId={isSharedView ? setCurrentImageId : undefined}`).
- Mechanism: the commit moved swipe-feedback styling (edge chevron opacity/transform,
  progress bar) from React state (`swipeOffset`, derived JSX styles) to direct DOM
  mutation via refs (`applySwipeVisuals` writing `el.style.*`). On a **successful**
  swipe-to-next/prev (`handleTouchEnd`'s `deltaX < -SWIPE_THRESHOLD && nextId` /
  `deltaX > SWIPE_THRESHOLD && prevId` branches, `photo-navigation.tsx:171-178`), the code
  calls `goToPhoto(...)` but — like the "snap back" branch — never calls
  `applySwipeVisuals(0, ...)` to reset the indicator to its resting state. For a **full page
  navigation** (`router.push`, the non-shared-view path) this is harmless because Next.js
  remounts the page and the component starts fresh. But for a **shared-group view**
  (`isSharedView`), `photo-viewer.tsx:657` wires `onSelectId={setCurrentImageId}` — a plain
  React state update with no navigation — so the SAME `PhotoNavigation` instance and the
  SAME DOM nodes persist across the photo switch, just re-rendered with new `prevId`/`nextId`
  props.
  Because the indicator elements' JSX `style` prop is a **static literal**
  (`style={{ opacity: 0, transform: 'translateY(-50%) translateX(0px)' }}`,
  `photo-navigation.tsx:215228`) that never changes value between renders, React's
  reconciler compares old-vs-new `style` prop key-by-key against its own last-applied
  values — not against the actual current DOM state — and sees no difference (0 vs 0,
  same transform string vs itself), so it skips writing to the DOM for those keys. The
  directly-mutated value left over from the drag (e.g. `opacity: 1`, a non-zero
  `translateX`) is therefore **not** cleared by the re-render that shows the new photo.
  The stale glow/offset then sits on top of the newly-displayed photo until the user
  performs another swipe (the next `touchmove` overwrites it) — it does not self-heal via
  navigation, prop changes, or a subsequent non-swipe re-render.
- Contrast: the sibling ref-based refactor in the same review cycle,
  `info-bottom-sheet.tsx` (commit `fc21007a`), avoids this exact trap by re-asserting the
  resting transform via a `useLayoutEffect` keyed on `[isOpen, sheetState, getTranslateY]`
  (`info-bottom-sheet.tsx:117-123`) — i.e. it re-applies the resting imperative style
  whenever the relevant state changes, not just implicitly through React's props diff.
  `photo-navigation.tsx` has no equivalent "reset visuals when `prevId`/`nextId` change"
  effect.
- Failure scenario: open a shared-group link (`/s/<key>` or `/g/<key>`) on a touch device,
  swipe left past the threshold to advance to the next photo. The right-edge "next" chevron
  (and/or the bottom progress bar) remains visible at whatever opacity/offset it had at the
  moment of release, persisting over the newly-loaded photo indefinitely (until another
  swipe attempt), even though `pointer-events-none` keeps it non-interactive — a rendering
  correctness bug, not a functional blocker.
- Fix: in the success branches of `handleTouchEnd` (`photo-navigation.tsx:171-178`), call
  `applySwipeVisuals(0, true)` before/alongside `goToPhoto(...)`, mirroring the "snap back"
  branch — or, more robustly, add a `useLayoutEffect` keyed on `[prevId, nextId]` that resets
  all four ref-driven elements to their resting style whenever the displayed photo changes
  (protects against any future call path that transitions `prevId`/`nextId` without going
  through `handleTouchEnd` at all, e.g. keyboard/button navigation while mid-gesture state
  is stale).

### DBG3-02 — `migrate.js`'s FDR-01 pending-vs-drift split (commit `b4e986c3`) silently swallows OTHER genuinely-new pending migrations in the same deploy when just one migration in the batch has a non-monotonic/mistaken `when` value

- Severity: **Medium-High** (same failure class the commit was written to close — silent
  loss of migration SQL/DML with no hard failure — reintroduced under a narrower but
  real, previously-demonstrated trigger condition specific to this repo's journal).
- Confidence: **High** — reproduced empirically against the real exported
  `prepareLegacyDatabaseIfNeeded` (see below), not just read.
- Classification: Latent bug in a same-cycle fix; the added tests for this exact commit do
  not cover the scenario that triggers it.
- Files: `apps/web/scripts/migrate.js` (`prepareLegacyDatabaseIfNeeded`, the "mixed" branch
  that calls `reconcileLegacySchema` + `baselineAllJournalMigrations(connection,
  migrations)`); `apps/web/src/__tests__/migrate-pending-migrations.test.ts` (added by the
  same commit).
- Mechanism: the new code computes `missing` (all journal entries whose hash isn't yet
  recorded) and takes the "pure pending" fast path — returning without baselining anything,
  so `drizzle.migrate()` genuinely executes the SQL — **only if every entry in `missing`**
  has `folderMillis > cursor`. If even ONE entry in that batch has a `folderMillis` at or
  below the recorded cursor (e.g. an author accidentally didn't advance `when` past
  `Math.max(...)`, or copy-pasted an old value — a mistake this exact repo's journal has
  already made twice historically per `apps/web/drizzle/meta/_journal.json`, idx 7 dropping
  from 2026 dates back to 2025, and idx 0/1 also non-monotonic), the code falls through to
  the "mixed" branch, which calls
  `await baselineAllJournalMigrations(connection, migrations)` — and that helper baselines
  **every currently-missing entry**, not just the below-cursor one(s). So legitimate,
  correctly-dated new migrations that happen to share a deploy batch with one bad entry
  get baselined-without-executing too: their DDL is covered by `reconcileLegacySchema`
  (if mirrored), but any DML in them (backfills, data migrations — exactly the class this
  commit's own message says `reconcileLegacySchema` "never mirrors") silently never runs.
  The only signal is a `console.warn` naming the swallowed entries — not a thrown error —
  so `runMigrations`' post-condition (which checks hashes are present, and they now are,
  since they were just baselined) passes, and the deploy log ends with
  `[Migration] Complete.` The CLAUDE.md runbook's own claim — "Failing to monotonically
  advance `when` ... the post-condition assertion will then fail the next deploy" — no
  longer holds after this fix: a non-monotonic `when` now degrades to a buried warning
  line, not a deploy failure, for the *entire batch* it lands in.
- Empirical proof (via `node -e` against the real `require('./scripts/migrate.js')` export,
  in-memory mock connection, no source modified): journal `[1000, 2000, 2500, 1800, 3000]`
  with hashes 0/1 already recorded and cursor=2000. Three genuinely pending entries:
  hash-2 (when=2500, correctly above cursor), hash-3 (when=1800, mistakenly below cursor —
  the injected "bad" entry), hash-4 (when=3000, correctly above cursor). Expected if the
  fix only handled the true-drift entry: baseline INSERT only for `hash-3`. Actual result:
  ```
  [Migration] WARNING: drift repair is baselining 2 migration(s) above the recorded
  cursor WITHOUT executing their SQL: 0002_test, 0004_test. ...
  Baseline INSERTs issued for hashes: [ 'hash-2', 'hash-3', 'hash-4' ]
  ```
  All three were baselined without execution — including the two legitimately-new,
  correctly-dated migrations that the fix's own stated intent says should have been left
  for `drizzle.migrate()` to apply.
- Why the added tests miss it: `migrate-pending-migrations.test.ts`'s three cases each use
  a single missing entry (either fully above cursor, or the one entry at/below cursor with
  no siblings) — none constructs a mixed batch with multiple missing entries straddling the
  cursor, so the batch-wide swallow was never exercised.
- Fix: baseline only the entries in `missing` that are at-or-below the cursor (true drift),
  and leave the above-cursor entries unbaselined regardless of whether the batch is "mixed"
  — i.e. compute `const trueDrift = missing.filter(m => Number(m.folderMillis) <=
  Number(cursor))` and pass only `trueDrift`-covering state to
  `baselineAllJournalMigrations` (or give it an explicit subset parameter), rather than the
  full `migrations` array, so an above-cursor entry is never baselined merely because a
  sibling entry in the same batch happened to be misdated. Add a test with a mixed batch
  (some above, some at/below cursor) asserting the above-cursor entries are NOT baselined.

### DBG3-03 (low) — `info-bottom-sheet.tsx`'s focus-restore effect (commit `fc21007a`) has no cleanup function, so the commit message's "unmount-while-open" claim is not actually implemented for this component

- Severity: **Low** (no observed practical impact — see below).
- Confidence: **Medium** (verified by full file read; impact analysis depends on how the
  parent is currently wired, which could change).
- Files: `apps/web/src/components/info-bottom-sheet.tsx:81-93`.
- The commit message states focus is "restored explicitly to the captured opener on
  close-while-mounted AND unmount-while-open," and the doc comment on `restoreFocusRef`
  echoes "the sheet's `return null` unmounts the FocusTrap in the same commit it
  deactivates." The effect implementing this
  (`apps/web/src/components/info-bottom-sheet.tsx:82-93`) has **no return/cleanup
  function** — it only runs its body on the next render after `isOpen` flips (which is the
  close-while-mounted case, since `InfoBottomSheet`'s own top-level component instance
  never conditionally unmounts — `photo-viewer.tsx:993-1004` renders it unconditionally,
  only its *internal* `if (!isOpen || !image) return null` gates the JSX). A genuine
  "unmount-while-open" (the whole `InfoBottomSheet` instance disappearing while `isOpen`
  was still `true`, without ever transitioning through `false`) would only happen if the
  parent `PhotoViewer` itself unmounts — and in that case the restore target
  (`mobileInfoButtonRef`, also owned by the same `PhotoViewer` instance) is unmounted too,
  so there is nothing to focus regardless. Contrast with `Lightbox` (commit `2c82a69c`),
  which genuinely needs and implements an unmount-safe cleanup because it IS conditionally
  rendered (`{showLightbox && <Lightbox ... />}` in `photo-viewer.tsx:971`).
  This is a documentation/test-coverage mismatch rather than a live defect today, but if a
  future change makes `InfoBottomSheet` conditionally rendered (mirroring `Lightbox`), the
  "unmount-while-open" case would silently regress with no cleanup path to catch it, and no
  test currently exercises it (`e2e/focus-restore.spec.ts` only covers close-while-mounted
  for the sheet).
- Suggested fix: either correct the commit-message/doc-comment claim to describe only the
  close-while-mounted mechanism actually implemented, or add a genuine unmount cleanup
  (`useEffect(() => () => { if (isOpen) { /* restore */ } }, [])`-style, capturing
  `restoreFocusRef` at mount) so the component is robust if its conditional-rendering
  contract ever changes.

### DBG3-04 (very low / cosmetic) — `image-queue.ts` processing-failure retry backoff comment claims "escalating up to 25s" but the achievable maximum is 10s

- Severity: **Very Low** (comment/log accuracy only; no functional impact).
- Confidence: **High**.
- Files: `apps/web/src/lib/image-queue.ts:857-874` (new in commit `02bea8d6`), compare
  `:611-641` (the claim-retry schedule it mirrors).
- The new `PROCESSING_RETRY_DELAY_MS * Math.min(retries, 5)` formula (and its `// escalating
  up to 25s` comment) is copy-pasted verbatim from the claim-retry schedule
  (`CLAIM_RETRY_DELAY_MS * Math.min(claimRetries, 5)`, also commented "up to 25s"). For
  claim retries, `MAX_CLAIM_RETRIES = 10`, so `claimRetries` genuinely reaches 5+ before
  giving up, making 25s achievable. For processing-failure retries, `MAX_RETRIES = 3`, so
  `retries` is only ever 1 or 2 while still in the retry branch (`retries < MAX_RETRIES`) —
  `Math.min(retries, 5)` never exceeds 2, so the real maximum delay is `5000 * 2 = 10000`ms
  (10s), and the `, 5` cap is dead code for this call site. Not a functional bug (the actual
  backoff still works, just tops out lower than the comment/log message imply), but worth
  fixing so a future reader doesn't assume 25s of headroom that doesn't exist, e.g. when
  tuning `MAX_RETRIES` independently of this formula.

## Verified fixed (not re-reported)

- **Cycle-2 DBG-01** (ISOBMFF child-box bounds in `color-detection.ts` /
  `gain-map-detection.ts` validated only against `buffer.length` instead of the parent
  container's true end) — fixed by commit `9ce5cf96`. Confirmed both `readBoxHeader` (now
  takes an `end` parameter) and `parseCicpFromHeif`'s inline check now bound against the
  passed-in container `limit`/`end`, matching `gps-exif-strip.ts`'s existing correct
  pattern. Grepped remaining `buffer.length` references in both files — all are top-level
  entry-point calls (`walk(0, buffer.length, 0)`) or a `Math.min(end, ..., buffer.length)`
  safety clamp, which is correct (narrows, never widens, the effective bound).

## Areas examined and found clean

- `apps/web/src/lib/admin-mutation-barrier.ts` (full read, not previously read end-to-end
  by this lane) — the drain-timer/waiter mechanism correctly clears its `setTimeout` on
  every exit path (`onIdle` success path and the timeout-fires path both guard against
  double-settling via a `settled` flag), `unref()`s the timer, and re-checks idle state
  after waiter registration to close the register/notify race window.
- `apps/web/src/lib/clip-model.ts` (`withInferenceSlot`/`waitForInferenceSlot`/
  `releaseInferenceSlot`) — the direct-hand-off semaphore pattern (a released slot is
  handed straight to the next FIFO waiter without touching `activeInferenceCount`) is
  correct, not a bug; abort/timeout listeners are removed on every settle path via
  `removeInferenceWaiter`.
- `apps/web/src/components/lightbox.tsx` slideshow `setInterval` — start/stop effect
  correctly keyed on `[isSlideshowActive, slideshowIntervalSeconds]` with symmetric
  clear, plus a redundant unmount-safety cleanup effect.
- `apps/web/src/components/similar-photos.tsx` `AbortController` usage — mature
  request-id + mounted + abort-guarded pattern (`isCurrentOpenRequest()`), already
  hardened from prior cycles; no new issue.
- `apps/web/src/lib/image-queue.ts` `bootstrapMissingActiveEmbeddings`'s new
  `SEMANTIC_SCAN_LIMIT` cap (commit `02bea8d6`, C2-34) — the cap check runs before each
  batch query (not after), so it can't overshoot into an extra query; `cursorId` correctly
  advances past every scanned row (success or per-row failure) within one invocation, so a
  single permanently-broken row cannot infinite-loop the walk; the cap only bounds work
  per-invocation, consistent with its documented "later bootstrap continues" contract.
  Cross-checked the retry-escalation and enqueued-state bookkeeping in the same commit's
  `finally` block against the pre-existing claim-retry pattern it mirrors — consistent, no
  double-release or stuck-`state.enqueued` scenario found.
- `apps/web/public/sw.template.js` / `sw.js` meta-first recency change (commit `bf5a4da9`)
  — `evictExpiredCachedImage` is only reached on the HEAD-probe-failed/no-ETag fallback
  path; the confirmed-fresh (304/same-ETag) branches return before reaching it, so reading
  `getMeta()`'s timestamp first is consistent with `touchMeta` having just updated it on
  every prior confirmed-fresh view. The un-awaited `touchMeta(...).catch(() => {})` calls
  in the fetch-event handler are an unchanged pre-existing pattern (not a new
  regression from this commit), not flagged.
- `apps/web/src/lib/content-security-policy.ts` `buildCspSafely` (commit `a4a2d250`) — the
  try/catch/fallback + once-per-process logging is correct and well-tested; no path was
  found where the fallback itself could throw (the fallback call passes a literal
  `imageBaseUrl: null`, bypassing the parser that threw).
- `apps/web/src/components/masonry-card.tsx` / `home-client.tsx` (commit `e5504bc8`) — the
  `memo()` prop contract is sound: `image` keeps referential identity across
  `setAllImages(prev => [...prev, ...newImages])` appends, `onLinkClick` is a
  `useCallback` keyed only on `scrollKey`, and `topicLabel`/`imageSizes` are
  parent-stable. Context consumption (`useTranslation()`) inside the memoized component
  is unaffected by `memo` (context changes always re-render consumers regardless of props
  memoization), so a locale change still propagates correctly.
- `apps/web/src/lib/settings-hash.ts` `getColorSettingsHash`'s `.then().finally()` chain —
  `fetchHashFromDb()` itself never rejects (internal try/catch with a fallback hash), so
  no unhandled-rejection path exists.
- Repo-wide grep for `setInterval`, `process.on`, `AbortController`, and `.then(` without
  `.catch` (excluding tests) — every non-trivial hit outside the above was either already
  covered by a prior cycle's clean verdict (`data.ts`, `image-queue.ts` bootstrap plumbing,
  `storage/index.ts`, `storage/local.ts`) or resolved to an inert/already-guarded pattern.

## Caveats

- DBG3-01 (photo-navigation stale swipe visuals) is derived from React's documented props-
  diffing contract plus static code reading, not a live browser reproduction (this
  environment has no headless-browser/DOM test harness wired for this component per the
  project's own `masonry-card-memo.test.ts` note that no `jsdom`/`@testing-library/react`
  dependency exists). Confidence in the mechanism is high; visual severity in practice
  (how jarring the stuck glow looks) was not measured on a device.
- DBG3-02 (migrate.js batch swallow) was verified by directly invoking the real exported
  `prepareLegacyDatabaseIfNeeded` against a scripted mock connection (not a real MySQL
  instance), mirroring the commit's own added-test harness style. The underlying SQL
  string-matching in the mock is a simplification of real MySQL responses but exercises
  the exact control-flow branch in question.
- This lane did not run the test suite, lint, typecheck, or build (read-only latent-bug
  hunting per the task brief); no source files were modified. The one executed script
  (`node -e ...` against `scripts/migrate.js`) ran read-only against an in-memory mock and
  touched no repository files or real database.
