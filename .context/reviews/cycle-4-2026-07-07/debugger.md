# Run-10 Cycle 4 — Debugger Lane

Start HEAD: `ec433dc4`. Scope: cycle-3 fix commits `e08b6f97..ec433dc4`, adversarial input
construction with empirical reproduction where feasible (real exported functions imported
into scratch scripts under `/private/tmp/.../scratchpad`, no repo files modified). Repro
scripts: `repro-migrate-null-cursor.js`, `repro-sw-cache.ts` (both re-runnable verbatim).

## Headline: DBG4-01 — migrate.js `cursor === null` branch still swallows pending DML (CONFIRMED, reproduced)

**Severity: MED-HIGH. Confidence: High (empirical repro).**

`prepareLegacyDatabaseIfNeeded` (`apps/web/scripts/migrate.js:783-871`) branches into a
"mixed drift + pending" path when a gallery-bearing DB has journal hashes missing from
`__drizzle_migrations`. The C3-01 fix (285a4538) added a belt-and-braces guard in
`baselineAllJournalMigrations` (`migrate.js:747-781`):

```js
// migrate.js:760
if (options.maxFolderMillis !== undefined && options.maxFolderMillis !== null) {
    const aboveCursor = inserts.filter((m) => Number(m.folderMillis) > Number(options.maxFolderMillis));
    if (aboveCursor.length > 0) { throw new Error(...); }
}
```

and split the caller's baseline set into `trueDrift` vs `pendingTail` (`migrate.js:857-860`):

```js
const trueDrift = cursor === null ? missing : missing.filter((m) => Number(m.folderMillis) <= Number(cursor));
const pendingTail = missing.filter((m) => !trueDrift.includes(m));
```

**The bug:** when `cursor` (i.e. `MAX(created_at)` over `__drizzle_migrations`) is `null` —
which happens whenever a gallery-bearing DB has a completely empty (but existing)
`__drizzle_migrations` table — `trueDrift = missing` (**every** missing entry, including
brand-new pending migrations with real DML). This `trueDrift` set is then passed to
`baselineAllJournalMigrations(connection, trueDrift, { maxFolderMillis: cursor })` with
`cursor === null`. The belt-and-braces guard's condition is
`options.maxFolderMillis !== null` — which is **false** when `maxFolderMillis` is `null` —
so the guard is **completely skipped**, and every entry (including ones bearing un-executed
DML) is baselined without ever running their SQL. This is the exact same swallow-class bug
C3-01 was written to close, just reachable through the sibling branch the fix didn't cover.

This is not a synthetic corner: `prepareLegacyDatabaseIfNeeded`'s entire reason for existing
is the "legacy DB adopting drizzle for the first time" scenario, which is precisely
"gallery tables exist, `__drizzle_migrations` is empty" — CLAUDE.md's own migration runbook
documents that `reconcileLegacySchema` (the DDL mirror this path also runs) has **already**
drifted out of sync with real migrations once in production (R4C1: color/HDR columns
0015-0018 were missing from the mirror for months). A new migration landing while the
mirror is behind, on a DB whose migrations table happens to be empty (fresh drizzle
adoption, or a restore that didn't carry `__drizzle_migrations`), reproduces the identical
silent-DML-drop failure mode C3-01 was supposed to close.

**Test suite awareness:** `apps/web/src/__tests__/migrate-pending-migrations.test.ts:154-167`
has a test titled *"legacy empty-log DB (cursor null) still baselines everything after
reconcile"* that explicitly asserts both entries get baselined (`inserts.toHaveLength(2)`).
The team was aware of and **pinned this exact behavior as intended**, not recognizing it
defeats the belt-and-braces guard for this branch. `baselineAllJournalMigrations`'s own test
at line 186 (*"baselines normally when no cursor bound is provided (fresh/legacy bootstrap
path)"*) pins the same thing at the lower-level API.

### Empirical repro (`repro-migrate-null-cursor.js`, run against the real exported functions)

```
=== Scenario: cursor===null, gallery tables pre-exist ===
[Migration] Reconciling legacy schema before baselining migrations...
[Migration] Baseline inserted 2 migration row(s) for already-reconciled schema.
  0001_old_ddl (folderMillis=1000): baselined=true
  0099_new_dml_backfill (folderMillis=99999999999999): baselined=true

RESULT: new migration with un-executed DML baselined-without-running = true
CONFIRMED BUG: the cursor===null branch silently marks a brand-new, never-executed migration as applied.

=== Scenario: cursor=500 (non-null), true mixed batch (control) ===
[Migration] 2 pending migration(s) above the recorded cursor will be applied by drizzle: 0001_old_ddl, 0099_new_dml_backfill
  0001_old_ddl (folderMillis=1000): baselined=false
  0099_new_dml_backfill (folderMillis=99999999999999): baselined=false
```

The control scenario shows the guard working correctly when `cursor` is a real number; the
first scenario shows it silently defeated when `cursor` is `null`.

**Fix direction:** the `cursor === null` case needs to distinguish "genuinely fresh legacy
bootstrap, reconcile mirrors 100% of the DDL, safe to baseline everything" from "some
migrations are genuinely new/pending and reconcile does not mirror their DML" — the same
distinction the non-null-cursor path already makes. One option: only take the
"baseline-everything, no cursor" fast path when the __drizzle_migrations table was *just
created this call* (i.e., truly bootstrapping for the first time — `ensureMigrationTable`
could report whether it created vs. found the table); if the table already existed but is
merely empty, treat it with the same drift/pending split as the non-null-cursor branch
using some other reference point (e.g. treat "empty log" as cursor `-Infinity`, changing
`missing.filter(m => folderMillis <= cursor)` to legitimately produce an empty `trueDrift`
and route everything through the "pending, let drizzle apply" path instead).

---

## DBG4-02 — sw-cache.ts `recordAndEvict`: phantom meta entries cause over-eviction of freshly-cached files (CONFIRMED, reproduced)

**Severity: MED-HIGH. Confidence: High (empirical repro). Pre-existing (not introduced by 0ae67c25), found via the requested adversarial-meta-state sweep of the LRU logic 0ae67c25 also touches.**

`recordAndEvict` (`apps/web/src/lib/sw-cache.ts:100-156`) walks the meta store oldest-first
to evict once the tracked total exceeds the cap:

```js
// sw-cache.ts:135-150
for (const entry of entries.values()) {
  if (total <= maxBytes) break;
  const deleted = await cache.delete(entry.url);
  if (deleted) {
    evicted += entry.size;
    total -= entry.size;
  }
  entries.delete(entry.url);   // <-- unconditional, regardless of `deleted`
}
```

The code already anticipates "phantom" meta entries — ones whose backing Cache Storage
entry was independently evicted by the browser under storage/quota pressure (comment at
`sw-cache.ts:140-144`: *"Browser quota evictions may have removed it independently of our
metadata Map"*) — and correctly gates the **`evicted`** return value on `cache.delete()`
actually succeeding. But it does **not** gate the **`total`** decrement the same way: when
`deleted` is `false` (phantom entry), `total` is never reduced for that entry's tracked
size, even though the entry is unconditionally removed from meta on the next line. Since the
loop's only stopping condition is `total <= maxBytes`, phantom bytes that can never be
"paid down" force the walk to evict **additional real, currently-cached entries** —
including the entry this very call just wrote — to compensate for storage that was never
actually occupied.

### Empirical repro (`repro-sw-cache.ts`, run against the real `apps/web/src/lib/sw-cache.ts`)

Seeded meta with two 20 MB "phantom" entries (present in meta, absent from the mock Cache
Storage — modeling an independent browser quota eviction), 50 MB cap, then called
`recordAndEvict` to record one genuinely-fresh 20 MB entry (`c.avif`, real total usage after
the write: only 20 MB, well under the 50 MB cap):

```
=== Scenario 3: recordAndEvict when cache.delete() returns false (already gone from Cache Storage) ===
evicted (should be 0 - cache.delete() returned false for phantom entries): 20971520
remaining meta entries: []
total tracked size now: 0
```

`evicted` reports 20 MB freed (that's `c.avif` — the entry we JUST wrote) and the final meta
map is **empty** — the fresh write was evicted by its own recording call, purely because two
unrelated phantom entries inflated the tracked `total` to 60 MB against a 50 MB cap, and
neither phantom's size was ever subtracted from `total` before the walk reached (and
sacrificed) the real entry. A device whose browser has been quietly trimming Cache Storage
under disk pressure — plausible on mobile Safari/Chrome, which the codebase's own PWA usage
targets — will see the SW image cache effectively unable to retain anything once enough
phantom bytes accumulate, defeating the offline/PWA caching story and forcing repeat
network fetches for images that were supposedly just cached.

**Verified correct (ruled out, no bug):** the touchMeta recency-bump mechanism itself is
sound — Scenario 2 in the repro confirms that touching an older entry moves it to the tail
so a subsequent eviction correctly skips it and takes the next-oldest untouched entry
instead.

**Fix direction:** decrement `total` by `entry.size` unconditionally (the entry's size is
leaving the tracked set either way), and keep `evicted`/`cache.delete()` gating exactly as-is
for the return value that represents actually-freed Cache Storage bytes.

---

## DBG4-03 — image-queue.ts embedding-scan cursor is process-memory-only; every deploy resets it to the exact starvation state C3-07 fixed (CONFIRMED by inspection)

**Severity: MED. Confidence: High (structural — no repro needed; `embeddingScanCursorId` demonstrably lives only in a `globalThis`-keyed object).**

`ProcessingQueueState.embeddingScanCursorId` (`image-queue.ts:353`, initialized at
`image-queue.ts:436`, consumed at `image-queue.ts:532`) is the C3-07 fix for TRC3-01's
starvation bug: a permanently-un-embeddable prefix (missing originals, broken encoder)
previously consumed the entire `SEMANTIC_SCAN_LIMIT` budget on every invocation because the
scan always restarted at id 0. The fix persists the resume point **on the in-memory
`ProcessingQueueState` object**, which lives on `globalThis` for the life of the Node
process (`getProcessingQueueState()`, `image-queue.ts:361-441`) — there is no DB row, no
file, no durable store backing it.

This means the cursor is wiped back to `0` on **every process restart** — not just the DB
restore path that explicitly resets it (`quiesceImageProcessingQueueForRestore`,
`image-queue.ts:1291`, documented and intentional), but any crash, OOM-kill, or — critically
for this project — **every ordinary redeploy**. CLAUDE.md's own deploy policy states: *"The
deploy is per-iteration by project policy — every commit pushed to master is followed by a
deploy. There is no staging environment."* Given a stuck prefix ≥ `SEMANTIC_SCAN_LIMIT`
(default 2000) rows ever exists (broken CLIP weights during a maintenance window, a batch of
images whose originals were deleted from disk out-of-band, etc.), every single deploy that
follows will restart the scan from id 0, re-walk into the same stuck prefix, and re-consume
the entire per-invocation budget before any newer row is reached — for however many
`BOOTSTRAP_RETRY_DELAY_MS` (30 s) cycles it takes to walk back past the stuck prefix again.
The fix genuinely solves the "long-lived process, cursor persists across many invocations"
case the review targeted, but the operational reality of this specific project (deploy on
every commit) means the cross-restart case is arguably the *more common* trigger, and it is
untouched by C3-07.

Not rated higher because the precondition (an actual ≥2000-row permanently-stuck backlog)
is itself an unusual state for a personal-gallery-scale deployment; this is a latent
robustness gap rather than an active production incident.

**Fix direction:** persist `embeddingScanCursorId` in a durable location that survives
process restart even though the value is best-effort (e.g. an `admin_settings` row, mirroring
how other soft state — like the backfill runner's status — already round-trips through the
DB), or explicitly document the restart caveat next to the C3-07 code comment so a future
reader doesn't assume cross-restart durability that doesn't exist.

---

## DBG4-04 — photo-navigation.tsx: touchEnd's animated "settle" reset is immediately overridden by the reset `useLayoutEffect`, in exactly the in-place-switch case C3-13 targets (LIKELY, mechanism traced + confirmed test blind spot)

**Severity: LOW-MED (cosmetic — final state is always correct, no stuck state). Confidence: Medium-High (traced precisely through React 19 automatic-batching + layout-effect-before-paint semantics; not confirmed with a live browser frame capture).**

C3-13 (9c45e933) added two independent reset mechanisms for the swipe indicator styles:

1. `handleTouchEnd`'s success branches call `applySwipeVisuals(0, true)` (animate=true, sets
   a 0.25s CSS transition) before navigating (`photo-navigation.tsx:193,198`).
2. A `useLayoutEffect` keyed on `[prevId, nextId]` calls `applySwipeVisuals(0, false)`
   (animate=false, clears the transition to `''`) whenever the displayed photo changes
   (`photo-navigation.tsx:112-115`).

In the shared-group view (`onSelectId={setCurrentImageId}` at
`components/photo-viewer.tsx:657`, no route/remount), `goToPhoto` calls `onSelectId(nextId)`
directly inside the native `touchend` listener. React 18+/19 automatically batches this
`setState` call; the resulting re-render, DOM commit, and layout-effect run happen
synchronously, before the browser's next paint. Concretely, within one browser task:

```
touchend fires
  -> handleTouchEnd: applySwipeVisuals(0, true)   // sets transition:0.25s + resting values
  -> goToPhoto(nextId) -> setCurrentImageId(nextId)   // batched update, not yet flushed
  -> handleTouchEnd returns
  -> React flushes the batched update -> re-render -> commit
  -> useLayoutEffect (prevId/nextId changed) runs BEFORE paint:
       applySwipeVisuals(0, false)   // overwrites transition to '' + same resting values
  -> browser paints for the first time (only ever sees the non-animated end state)
```

Because `useLayoutEffect` is guaranteed to run before the browser paints, the transition the
touchEnd handler set up is overwritten before it is ever visually rendered — the intended
"smooth settle" animation on a successful in-place swipe silently never plays; the indicator
just snaps to rest instantly. The final values are identical either way (opacity 0, resting
transform), so this is not a stuck-state regression and does not reintroduce the original
DBG3-01 bug — but it does mean the touchEnd success-branch reset the commit description
calls out ("Success branches now reset before goToPhoto") is dead in exactly the one path
(shared-group in-place switch) it was written for; only the route-navigation path (where the
component remounts fresh, so there's no prior animated state to cancel) gets to keep any
transition.

Route-navigation instances (non-shared-group `/p/[id]`) are unaffected: Next's App Router
remounts the page tree on a dynamic-segment change, so there is no live imperative style to
interrupt.

**Confirmed test blind spot:** `e2e/swipe-visual-reset.spec.ts:75,92` only asserts
`toHaveCSS('opacity', '0')` — the final value — never whether a transition actually played,
so this would not be caught by the existing suite either way.

**Fix direction (if the animation is considered worth preserving):** skip the
`useLayoutEffect`'s reset when the touchEnd handler already just performed an animated reset
for the same transition (e.g. a ref flag set by the touchEnd success branches and checked/
cleared by the layout effect), or accept the instant-snap behavior and drop the now-dead
`animate: true` argument from the touchEnd success branches with an updated comment.

---

## Ruled out (verified during this pass, no defect found)

- **gallery-config.ts micro-cache (`getGalleryConfigUncached`, `gallery-config.ts:215-233`):**
  traced the check-then-populate sequence; because the function has no `await` before the
  synchronous cache/in-flight checks and the assignment of a new in-flight promise, Node's
  run-to-completion semantics prevent any interleaving between concurrent callers within the
  same tick — the in-flight dedupe and TTL boundary are both sound. No settings-flip-missed
  race beyond the explicitly-accepted 2 s skew documented in the code.
- **image-queue.ts GC-timer "double-arm":** traced whether two overlapping
  `bootstrapImageProcessingQueue()` invocations (e.g. startup racing a post-restore resume)
  could both observe `!state.gcInterval` and both arm a timer. They can't: the only await
  point before the `if (!state.gcInterval)` check is the initial `db.select(...)`, so whichever
  call's promise settles first runs its entire synchronous tail (including the arm) to
  completion before the other call's continuation gets a turn. Confirmed by inspection, no
  double-arm possible. The same reasoning also rules out duplicate enqueues from concurrent
  bootstrap calls scanning the same unfiltered (`bootstrapCursorId === null`) range — the
  `state.enqueued` dedupe check inside `enqueueImageProcessing` is synchronous per call and
  correctly no-ops the second call's redundant enqueue attempts.
- **Retry-delay comments (`image-queue.ts:721,949`):** re-verified both the claim-retry
  ("up to 25s", `CLAIM_RETRY_DELAY_MS=5000 * min(claimRetries,5)`, `MAX_CLAIM_RETRIES=10`)
  and processing-retry ("up to 10s at this call site", `PROCESSING_RETRY_DELAY_MS=5000 *
  min(retries,5)`, `MAX_RETRIES=3` caps `retries` at 2 on the retry-scheduling branch) — both
  are numerically correct post-C3-21; no residual copy-paste error.
- **http-etag.ts (`ifNoneMatchMatches`/`splitEntityTagList`):** traced comma-inside-quotes
  splitting, unbalanced/malformed quote handling (safely normalizes to `null`, never
  crashes), and the `*` wildcard case — all correct per RFC 9110 weak comparison semantics.
- **optimistic-image.tsx retry state machine:** traced the fallback-switch guard
  (`retryBaseRef.current !== fallbackSrc`) against a sequence where the fallback itself gets
  a `?retry=N` suffix appended — confirmed the guard (added by C3-24) correctly prevents
  re-entering the one-shot fallback branch merely because `imgSrc !== fallbackSrc` becomes
  true again once a retry suffix is appended. No ping-pong or stuck state found; terminal
  error state is idempotent against spurious extra `onError` calls.
- **serve-upload.ts fd-caching (fc9e4407):** the 304/HEAD path-stat vs. GET fd-stat split is
  safe because neither 304 nor HEAD ever sends a body, so there's no headers-vs-body
  coherence hazard from skipping the fd. `resolveUploadRootCached`'s success-only memoization
  is technically stale if `UPLOAD_ROOT` were ever repointed via a live symlink swap
  mid-process, but the product only supports local filesystem storage today (no live backend
  switching), so this is a low-likelihood residual, not flagged as a standalone finding.
  Separately observed (pre-existing, out of scope for this commit): the route has no `Range`
  header support at all (always 200s the full body) — a real gap for resumable downloads,
  but the static-file-server path is documented as primary for existing files, so impact is
  low; not a regression from fc9e4407.
- **restore-maintenance-durable.ts `beginDurableRestoreMaintenance({allowExisting:true})`:**
  initially looked like a residual (re-entrant call overwrites the durable marker's
  `startedAt`), but this file is untouched since cycle-28/71/72 (outside this cycle's scope),
  and the MySQL advisory lock (`LOCK_DB_RESTORE`) genuinely prevents concurrent restores from
  reaching this code path simultaneously — the only reachable case is the same restore
  legitimately retaking a stale marker from its own prior crashed attempt, where resetting
  `startedAt` to reflect the new attempt's real start time is arguably correct. Not reported
  as a defect.

## Summary

- **DBG4-01** (migrate.js, MED-HIGH/High, reproduced): the `cursor === null` legacy-bootstrap
  branch bypasses the C3-01 belt-and-braces guard entirely, silently baselining pending
  migrations with un-executed DML — the same bug class C3-01 fixed, reachable through the
  sibling branch, and explicitly pinned as "intended" by the fix's own test suite.
- **DBG4-02** (sw-cache.ts, MED-HIGH/High, reproduced): phantom/stale LRU meta entries never
  decrement the tracked eviction-walk total, causing genuinely fresh cache writes to be
  evicted by their own recording call. Pre-existing, found via the requested adversarial
  sweep of code 0ae67c25 touches.
- **DBG4-03** (image-queue.ts, MED/High): the C3-07 embedding-scan cursor is process-memory
  only and resets on every restart, which this project's per-commit deploy policy triggers
  routinely — the fix only covers within-process-lifetime starvation.
- **DBG4-04** (photo-navigation.tsx, LOW-MED/Medium-High): the touchEnd success branch's
  animated reset is overridden before paint by the C3-13 layout effect in exactly the
  in-place-switch scenario both were built for — cosmetic only, confirmed test blind spot.
- Six areas verified clean by direct inspection/repro (gallery-config micro-cache, GC-timer
  double-arm, retry-delay comments, http-etag parsing, optimistic-image retry machine,
  serve-upload fd-caching/Range gap, restore-maintenance re-entrant marker).
