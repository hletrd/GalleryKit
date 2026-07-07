# debugger review — cycle 6 (retry)

## Summary

Reviewed committed HEAD `583277fb` (the pinned cycle-6 baseline; confirmed an ancestor of
current `b965e3bf`, and confirmed the diff between the two touches ONLY the peer-dirty file
list, so the working tree is a valid stand-in for every non-peer-dirty file). Focused on
non-peer-dirty `apps/web/src/lib/*.ts`, `db-actions.ts`, and components touched in the last
~15 commits (`cae5fbd9`, `d4bccea2`, `44ab13c4`, `20e9048e`, `09a0dcd3`, plus the adjacent
`eca55414`, `d79f6f70`, `0da58d6b`, `4afacfa8`, `9c45e933`, `2c82a69c`, `fc9e4407`). One
concrete, previously-unreported timezone bug found; several recent hardening commits
(`db-actions.ts` restore fencing, `serve-upload.ts` fd-free HEAD/304, the `image-zoom.tsx`
`role="button"` self-match fix, the swipe-visual-reset/`skipNextHardReset` coordination in
`photo-navigation.tsx`) were traced end-to-end and found correct — no regression.

## Findings

### F1 — `OnThisDayWidget` computes "today" from the server's local clock, not the visitor's

**[SEV: MED | CONF: High | file: `apps/web/src/lib/on-this-day-date.ts:6-11`, `apps/web/src/components/on-this-day-widget.tsx:15-16`]**

`OnThisDayWidget` is an `async function` Server Component (no `'use client'`, rendered directly
by `<OnThisDayWidget />` in `apps/web/src/app/[locale]/(public)/page.tsx:234`, itself a
`revalidate = 0` dynamic page — so this runs fresh on every request, on the server). It calls
`getLocalMonthDay()` with no argument, which defaults to `new Date()`:

```ts
export function getLocalMonthDay(now: Date = new Date()): MonthDay {
    return { month: now.getMonth() + 1, day: now.getDate() };
}
```

`now.getMonth()`/`now.getDate()` resolve in the **Node process's OS/container timezone**, not
the visitor's browser timezone. Neither the Dockerfile nor `docker-compose.yml` sets a `TZ`
env var (confirmed via grep — no `TZ=` anywhere in `apps/web/Dockerfile`,
`apps/web/docker-compose.yml`, or `.env.local.example`), so a container started from the
shipped image defaults to UTC. The resulting `(month, day)` is then used verbatim as the
"today" key for `getOnThisDayImages(month, day)` (`apps/web/src/lib/data-timeline.ts`,
peer-dirty — not re-analyzed here beyond the call contract).

**Failure scenario:** operator and gallery audience are in KST (UTC+9, matching the demo's
`gallery.atik.kr` / the repo's Korean i18n locale). Container runs in UTC (the Docker default,
unconfigured). Between 00:00 and 08:59 KST, the server's wall clock is still on the *previous*
calendar date. A visitor loading the home page during that ~9-hour window sees "On this day"
content for **yesterday** relative to their own calendar, and — depending on which side of a
year boundary the visitor is on — could see a September-31-style boundary-adjacent day for the
*wrong* year's worth of past photos. The mismatch direction and magnitude scale with
`|visitor UTC offset|`, so any deployment where server and majority-visitor timezone differ has
a multi-hour daily window of visibly wrong content. This is not hypothetical config drift: it's
the *default* behavior of the shipped container image with zero operator action.

This is a real inconsistency with the rest of the codebase's date-handling discipline:
`apps/web/src/lib/exif-datetime.ts:63-77` explicitly pins `timeZone: 'UTC'` when formatting
*stored* EXIF dates specifically so display never depends on ambient server TZ. The
`on-this-day` feature is the one place that silently reintroduces an ambient-server-clock
dependency for what is effectively a "today" comparison against visitor-perceived data.

**Confirmed NOT already covered:** grepped `.context/reviews/_aggregate.md` and
`.context/plans/deferred-carry-forward.md` for `on-this-day` / `getLocalMonthDay` — the only
existing hit is `AGG-C10-05`-adjacent `AGG-C10-0x`-style perf note about `MONTH()`/`DAY()` SQL
scan cost on the hot path (unindexed query performance), not a timezone-correctness issue. The
cycle-6 `designer.md` lists `on-this-day-widget.tsx` only in its file inventory, with no
associated finding. This is a distinct, new defect.

**Suggested fix:** either (a) explicitly document/require operators to set `TZ` to their own
timezone in `docker-compose.yml`/`.env.local` (Node respects `process.env.TZ` for local-time
`Date` methods — cheap, matches the single-family/single-timezone-audience threat model this
app already assumes elsewhere), or (b) make the "today" comparison client-driven: compute
`month`/`day` from the visitor's browser `Date` (already done correctly, but unused, in the
existing `getLocalMonthDay` when called client-side) and fetch the widget's photos via a small
client-side request instead of baking it into the server-rendered shell. (a) is the
minimal/low-risk fix given the existing single-writer/self-hosted deployment model.

## Also inspected — no new finding (traced, not re-reporting)

- **`apps/web/src/app/[locale]/admin/db-actions.ts`** (`restoreDatabase`, `dumpDatabase`,
  `runRestore`, `runPostRestoreMigrations`) — traced every lock-acquisition/early-return/finally
  path for double-release, leaked advisory locks, and leaked `conn`/fd handles across the
  `cae5fbd9` (`drainMaintenanceSweepsForRestore` gate) and `20e9048e`/`09a0dcd3` changes. Every
  early return that partially acquires locks explicitly releases what it holds before
  returning, and the outer `finally` re-checks each flag (all correctly cleared by the inner
  paths) before `conn.release()` — no double `RELEASE_LOCK`, no descriptor leak on the header/
  tail-scan `fs.open`/`fs.close` pairs (all wrapped in `try/finally`). Matches critic.md's and
  test-engineer.md's independent conclusions on this file.
- **`apps/web/src/lib/serve-upload.ts`** (`fc9e4407` fd-free HEAD/304 path) — the 304 and HEAD
  branches now use a plain `stat()` (no `open()`), while the GET body path still opens the fd
  and stats *through* it before building the response, preserving the fd-stat race-safety
  contract. Abort-listener fd cleanup, the cached-realpath ENOENT fallback (uncached on
  purpose), and the SWR settings-hash cache are all internally consistent. No leak on any
  branch, including the error path (`catch` closes `fileHandle`/destroys `fileStream` if set).
- **`apps/web/src/components/image-zoom.tsx`** (`cae5fbd9`) — the
  `interactiveAncestor !== containerRef.current` guard correctly fixes what was previously a
  total click-to-zoom regression (the container's own `role="button"` matched
  `target.closest('[role="button"]')` unconditionally, so `handleClick` bailed on *every* click,
  including on the container itself). Verified no new gap: a real nested interactive element
  (e.g., a caption link/button) is still correctly excluded, since `.closest()` returns the
  *nearest* match, which is the nested element, not the container.
- **`apps/web/src/components/photo-navigation.tsx`** (`9c45e933` + the later `skipNextHardReset`
  one-shot flag) — traced the interaction between the touchend success branch (animated reset +
  `skipNextHardReset.current = true`) and the `[prevId, nextId]` `useLayoutEffect` (hard reset,
  skipped once when the flag is set). No race: `goToPhoto`'s `onSelectId(id)` path triggers a
  batched React state update in the parent, so the layout effect always runs *after* the flag is
  set and consumes it exactly once. Also checked whether `PhotoViewer`'s
  `prevId ?? (images[currentIndex - 1]?.id || null)` fallback (line ~698-699) could pin
  `PhotoNavigation`'s `prevId`/`nextId` to a stale value once the shared-group in-place-switch
  path advances `currentIndex` — it cannot, because the shared-group page
  (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`) never passes a `prevId`/`nextId` prop
  to `<PhotoViewer>` at all, so the `??` always falls through to the live
  `images[currentIndex ± 1]` computation on every render.
- **`apps/web/src/lib/background-db-writes.ts` / `apps/web/src/lib/queue-shutdown.ts`** — the
  drain-until-idle `while` loops (`drainBackgroundDbWrites`, `drainProcessingQueueForShutdown`)
  terminate correctly: every tracked promise removes itself from its owning `Set` in a
  `.finally()` before the loop re-checks size, so there is no infinite loop and no leaked
  tracking entry on either the success or rejection path.
- **`apps/web/src/lib/pagination.ts` / `apps/web/src/lib/bounded-map.ts`** — boundary handling
  (`parsePageParam`'s `page || 1` zero-guard, `maxPage` floor, `BoundedMap`'s FIFO eviction count
  math) is correct; no off-by-one found.
- **`apps/web/src/lib/queue-shutdown.ts` sideEffects drain contract** — verified against the
  (peer-dirty) `image-queue.ts` call sites: every side-effect promise added via
  `state.sideEffects.add(task)` is paired with a `state.sideEffects.delete(task)` on settle, so
  the drain loop in `queue-shutdown.ts` cannot spin forever waiting on a task that never removes
  itself.

## Files examined (inventory)

`apps/web/src/app/[locale]/admin/db-actions.ts` (full read); `apps/web/src/lib/serve-upload.ts`
(full read + `fc9e4407` diff); `apps/web/src/lib/queue-shutdown.ts`,
`apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/pagination.ts`,
`apps/web/src/lib/bounded-map.ts`, `apps/web/src/lib/on-this-day-date.ts` (full reads);
`apps/web/src/components/image-zoom.tsx`, `apps/web/src/components/photo-navigation.tsx`,
`apps/web/src/components/photo-viewer.tsx` (targeted reads around the diffed regions: lines
1-150, 620-712); `apps/web/src/components/on-this-day-widget.tsx`,
`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` (grepped for prop wiring);
`apps/web/src/__tests__/on-this-day-date.test.ts`, `apps/web/src/__tests__/image-list-cursor.test.ts`
(read; the latter tests peer-dirty `data.ts`, not re-analyzed).
Diffs read in full: `cae5fbd9`, `d4bccea2` (stat), `44ab13c4` (docs-only, no source diff),
`20e9048e`, `09a0dcd3`, `fc9e4407`, `9c45e933`, `d79f6f70`, `0da58d6b`.
Directory listing of all 106 files under `apps/web/src/lib/*.ts` cross-checked against the
peer-dirty list to scope the non-peer-dirty subset.
Prior context read: `.context/plans/deferred-carry-forward.md`, `.context/reviews/_aggregate.md`,
and grepped all nine already-completed cycle-6 lane files
(`architect.md`, `critic.md`, `designer.md`, `document-specialist.md`,
`feature-dev-code-reviewer.md`, `perf-reviewer.md`, `security-reviewer.md`, `test-engineer.md`,
`tracer.md`, `verifier.md`) for overlap before writing up F1 and the "also inspected" list.

## Final sweep (commonly-missed) notes

- Double-checked the git history claim in the briefing: `583277fb` is a genuine ancestor of the
  current `b965e3bf` HEAD, and `git diff --stat 583277fb..b965e3bf` touches *only* the listed
  peer-dirty paths (plus their paired tests and review/plan docs) — so reviewing the current
  working tree for every non-peer-dirty file is equivalent to reviewing the pinned baseline;
  no silent scope drift.
  Confidence: High.
- Did not find additional null/undefined-deref, unhandled-rejection, or off-by-one bugs in the
  assigned non-peer-dirty scope beyond F1 within the time-box; the restore/backup/serve-upload/
  swipe-visual paths that looked highest-risk on first pass were traced to be correct and are
  recorded above so a future reviewer doesn't have to re-derive that from scratch.
