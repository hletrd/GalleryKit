# Tracer — Run-10 Cycle 4 (2026-07-07)

Start HEAD `ec433dc4`. Evidence-driven causal tracing of the six assigned flows plus two
self-selected flows. Every verdict below is backed by file:line citations, and where the
underlying mechanism was ambiguous from reading GalleryKit code alone, by direct inspection
of the installed `mysql2` / `drizzle-orm` dependency source or a small experiment script
under the scratchpad (paths noted inline). No repo files were modified.

Confidence scale: High (mechanism traced to source, often with a runnable experiment) /
Medium (code-trace only, plausible but untested interleaving) / Low (speculative, narrow
window).

---

## Flow 1 — `serve-upload.ts` vs. a concurrent backfill rename-over (fc9e4407 + d07c6d32)

**Hypotheses considered:** (a) stat/open race serves mismatched ETag vs. body; (b) 0-byte
read; (c) fd leak on any early-return/error/abort path.

**Evidence:**
- `apps/web/src/lib/process-image.ts:1187-1204` (`writeFinalPathAtomically`) confirms every
  derivative write goes temp-file → `fs.rename(tmpPath, outputPath)`, never truncate-in-place.
  Verified this is universal for the `public/uploads/{avif,webp,jpeg}` derivatives the route
  serves — every `.toFile(` call in `process-image.ts` targets a `tmpPath` (grep, no direct
  `.toFile(outputPath)` writes to a final derivative path).
- `serve-upload.ts:296-297` opens the fd (`open(resolvedPath,'r')`) and stats **through the
  same fd** (`fileHandle.stat()`) to build `bodyEtag`/`Content-Length` — never mixing a
  path-based stat with the fd's body, for the GET path. The 304/HEAD branches (`:217`,
  `:280-290`) never open an fd and never stream a body, so there is nothing to desync.
- **Empirically verified** POSIX rename semantics with a live experiment
  (`scratchpad/rename-fd-test.mjs`): opened an fd on a file, then renamed a differently-sized
  file over the same path (simulating backfill's atomic rename-over) — the pre-existing open
  fd's `stat()` and `read()` continued to report the **old** inode's size/bytes unchanged.
  Confirms a GET that has already reached `open()` can never observe a torn/mixed file
  regardless of how many backfill re-encodes race it afterward.
- fd-leak paths (`scratchpad/fd-leak-test.mjs`): confirmed `FileHandle.createReadStream({autoClose:true}).destroy()` fires `'close'` (fd released) both when called **before** any read (the `signal?.aborted` early-bail branch, `:327-330`) and **mid-stream** (client abort, `:337-348`); confirmed a double `.close()` on an already-closed handle does not throw (matches the defensive `.catch(() => undefined)` in the outer catch, `:361-363`).

**Verdict TRC4-01a (stat/open race → mismatched ETag/body):** ruled-out, High confidence.
**Verdict TRC4-01b (0-byte read):** ruled-out, High confidence (atomic rename means readers
only ever see a fully-written file at that path).
**Verdict TRC4-01c (fd leak on early-return/abort):** ruled-out, High confidence (every path
traced closes the handle or triggers the stream's `autoClose`).

**Residual observations (not new bugs, but worth a maintainer's eye):**
- `CLAUDE.md`'s ETag/cache section (grep `rewrites bytes in place under unchanged filenames`,
  `R4C6 ARCH-R4C6-06`) is imprecise: the encoder does **not** rewrite bytes in place — it
  writes to a `.tmp` sibling and atomically renames over the target (confirmed above). The
  route's fd-stat design specifically depends on genuine rename-over semantics (an in-place
  truncate+write would break the safety argument for the GET path). Worth correcting the
  wording so a future refactor doesn't "simplify" the encoder to truncate-in-place based on
  the doc's own words.
- A lstat→realpath TOCTOU (`:200-204`) exists in theory (a symlink could be swapped into
  `absolutePath` between the two calls) but is unrelated to the backfill-rename scenario in
  scope here (backfill never writes symlinks) and pre-dates fc9e4407/d07c6d32 — flagged as
  Low-confidence/out-of-scope, not attributed to this cycle's commits.

---

## Flow 2 — `single-writer-guard.ts` keepalive/reconnect state machine (3f8b6c88)

**Hypotheses considered:** MySQL restart; `wait_timeout` reap despite keepalive; pool
exhaustion during reacquire; process SIGTERM racing an in-flight ping. Can the guard believe
it holds a lock it lost, or double-log false alarms?

**Evidence:**
- MySQL restart / connection death while idle: `holdConnection`'s `conn.on('error', ...)`
  (`:100-109`) nulls `heldConnection` and clears the keepalive timer on the very first error.
  The guard never re-believes it holds a dropped lock — confirmed by the existing test
  `single-writer-guard.test.ts:310-331` and consistent with a full read of the module. **No
  auto-reconnect** is by design (comment `:24-29`); once lapsed it stays lapsed for the rest
  of the process's life. Ruled out for "believes it holds a lock it lost" — High confidence.
- `wait_timeout` reap: keepalive fires every `KEEPALIVE_INTERVAL_MS=60_000` (`:39,114-124`),
  far under any sane `wait_timeout` (server default 8h), so the connection is never truly
  idle long enough to be server-reaped. Ruled out — High confidence.
- Pool exhaustion: both the initial probe and every reprobe use a **dedicated**
  `mysql.createConnection` (`:70-83`), never the shared pool — so live-traffic pool pressure
  cannot block the guard's own reconnect attempts. Ruled out — High confidence.
- **TRC4-02 (needs-validation, Medium confidence): reprobe gives up permanently after ONE
  failed connection attempt, not just one failed lock-contention outcome.**
  `reprobeOnce()` (`:147-170`) only fires once (`startSingleWriterGuard`'s `setTimeout` at
  `:193-196`). If `openGuardConnection()` inside that single reprobe merely **fails to
  connect** (e.g., transient network blip, MySQL momentarily at `max_connections`) — as
  opposed to connecting and finding the lock still held — `reprobeOnce` just `return`s
  (`:151`) with no further scheduling, no loud error, and no lasting flag. The guard then
  goes fully quiet for the remainder of the process's life: it never determines whether a
  second live instance actually exists, and (b) the log line printed for that failure
  (`openGuardConnection`'s `console.warn('...to probe the singleton lock at startup...')`,
  `:77-81`) is worded for the initial call and is misleading when it fires from the reprobe
  path 25s into the process's life, not "at startup." This is a real detection gap
  distinct from a false alarm — a legitimate second-instance collision occurring in the same
  ~25s window as a transient connectivity blip would go completely undetected.
- **TRC4-03 (needs-validation, Medium confidence, mechanism-verified against the real
  `mysql2` driver): a keepalive tick racing `stopSingleWriterGuard()`'s RELEASE_LOCK can
  double-log for a single failure.** Read the real `mysql2` `_notifyError` implementation
  (`node_modules/mysql2/lib/base/connection.js:253-297`): a fatal connection error is
  delivered to the **active command's own callback** (rejecting that specific query's
  promise) and only ALSO emitted as a connection `'error'` event if there is no active
  command, or a queued command lacks a callback, or it's a pool connection — none of which
  is normally true for a lone promise-wrapped query on this dedicated connection. So if the
  fatal error strikes while `stopSingleWriterGuard`'s `RELEASE_LOCK` query (`:213-217`) is
  the SOLE active command, only its own promise rejects (`console.debug`, `:219`) — no
  `'error'` event, no `warnLapse`, no double-log; this path is actually safe. However, IF a
  keepalive `SELECT 1` (armed every 60s, `:114-123`) is still in-flight (the small round-trip
  window) at the exact moment SIGTERM triggers `stopSingleWriterGuard()`, the RELEASE_LOCK
  query gets **queued behind** the keepalive's active command. A fatal error at that instant
  delivers to the keepalive's own callback (triggering `warnLapse` →
  `console.warn(...'the guard has lapsed'...)`, `:115-119`) via the drain loop in
  `_notifyError` AND separately rejects the queued RELEASE_LOCK (caught by
  `stopSingleWriterGuard`'s own try/catch → `console.debug`, `:218-219`) — two different
  log lines, different severities, for one root cause, one of which reads as an alarming
  "guard has lapsed" during what is actually a clean, intentional shutdown. The window is
  narrow (must land within a `SELECT 1` round-trip, which recurs every 60s) but a host-wide
  reboot that kills MySQL and sends SIGTERM to the app at roughly the same moment (the
  documented "real incident" pattern in this repo) measurably widens it. Not empirically
  reproduced against a live MySQL server (would need one); confidence is Medium, grounded in
  reading the actual dependency's fatal-error notification logic rather than the project's
  own mocked test doubles (`single-writer-guard.test.ts`'s `FakeConnection` does not model
  this queuing/bubbling behavior, so the existing suite cannot catch or rule out this case).

---

## Flow 3 — `image-queue.ts` embedding bootstrap cursor (200a74bf + 1dff18d6)

**Hypotheses considered:** rows deleted under the cursor; cursor beyond max id; process
restart; concurrent manual backfill holding the semantic advisory lock.

**Evidence:**
- Rows deleted under/ahead of the cursor: `gt(images.id, cursorId)` (`:554`) means deletions
  below the cursor are inert; a row deleted between the SELECT and its embed/insert just
  fails the insert (caught, `:570-572`, logged and skipped) — no crash, and it naturally
  disappears from future scans since the row no longer exists. Ruled out — High confidence.
- Cursor beyond max id: an empty `rows` result triggers `!lastRow` → cursor resets to 0
  (`:580-586`) — self-heals on the very next call. Ruled out — High confidence.
- **TRC4-05 (confirmed structural gap, High confidence): the persisted cursor is
  `globalThis`-scoped in-memory state and does not survive a process restart, and — more
  importantly — is only ever exercised by the SAME limited set of triggers as the
  broader processing bootstrap, not on any independent cadence.** Traced every caller of
  `bootstrapMissingActiveEmbeddings` (`:511`, only invoked from inside
  `bootstrapImageProcessingQueue` at `:1161-1170`), and every place that flips
  `state.bootstrapped` back to `false` so `bootstrapImageProcessingQueue` will actually
  re-enter its body: claim exhaustion (`:715`), a job's final permanent failure after
  `MAX_RETRIES` (`:1010`), and DB-restore recovery (`:1285`) — **normal healthy uploads never
  reset it.** Once the initial startup scan reaches `state.bootstrapped = true`
  (`:1184`/`:1194`), `bootstrapImageProcessingQueue`'s own guard (`:1084`) makes every future
  call a no-op, so `bootstrapMissingActiveEmbeddings` — and therefore the whole persisted
  cursor mechanism this cycle's fix (TRC3-01/C3-07) added — effectively runs **once per
  process lifetime** under ordinary operation (barring a permanent processing failure or a
  restore). Given this repo's own documented **per-commit deploy policy** ("every commit
  pushed to master is followed by a deploy," `CLAUDE.md` Operational Playbook), a stuck
  un-embeddable prefix larger than `SEMANTIC_SCAN_LIMIT` (default 2000) would have its
  climb-past-the-stuck-prefix progress reset to 0 on every single deploy — the in-memory
  persistence the fix relies on almost never gets a chance to carry state across the
  multi-invocation climb the design assumes. This does not "permanently" skip rows (a
  process that stays up long enough, or enough manual retries, still converges), but under
  this project's real deploy cadence the fix's practical protection window is much shorter
  than "across invocations" implies. Not urgent (requires a genuinely large permanently-
  un-embeddable prefix, which should be rare — missing originals or broken CLIP weights) but
  worth documenting as a known limitation rather than treating C3-07 as fully closed.
- **TRC4-06 (confirmed, High confidence, no corruption): the automatic in-app embedding scan
  and the manual sidecar backfill are NOT mutually exclusive.**
  `scripts/backfill-clip-embeddings.ts:120-121,251` acquires the
  `gallerykit_semantic_embedding_backfill` advisory lock
  (`LOCK_SEMANTIC_EMBEDDING_BACKFILL`, `src/lib/advisory-locks.ts:49`); grepped
  `bootstrapMissingActiveEmbeddings` end-to-end and confirmed it never references that lock
  name or calls `GET_LOCK`/`isAdvisoryLockAcquired` at all. Running the documented sidecar
  backfill (CLAUDE.md "Operational Playbook" pattern) while the live web process is up can
  therefore have both paths computing CLIP embeddings for the same images concurrently. Both
  use `onDuplicateKeyUpdate` on insert (`:496-507`), so the final DB state converges
  correctly (no corruption) — the cost is wasted duplicate CLIP inference work and
  contention for the shared `CLIP_INFERENCE_CONCURRENCY`-bounded queue, which is real but
  lower severity than a correctness bug. CLAUDE.md's "Concurrent backfill prevention" section
  describes the lock existing for "their respective... backfill windows" without claiming
  the in-app scan participates in it — so this isn't a doc contradiction, but it is a gap an
  operator running a manual backfill alongside a live deployment should know about.

---

## Flow 4 — Service worker install→activate→fetch→touch→evict at a full 50MB cache (0ae67c25)

**Hypotheses considered:** lost recency or miscounted size under absent `Content-Length`,
opaque responses, or 304 revalidation.

**Evidence:**
- `touchMeta` (`public/sw.template.js:178-213`): when an existing meta record's `size` is
  truthy it's reused directly (skips `resolveSize()` entirely) — a 304/same-ETag confirm
  never disturbs an already-correct tracked size. When no usable size is known (`knownSize`
  falsy and no meta record), it lazily reads the actual blob size (`responseSize`, `:224-233`)
  rather than ever writing a 0-size ghost entry (`if (!size) return;`, `:198-200`) — this is
  the C3-22 fix and it is applied consistently; traced no path that still writes size 0 for
  a genuinely non-empty cached body.
- **TRC4-07 (confirmed by code trace, Medium confidence — functional gap, not corruption):
  opaque cross-origin responses (the `IMAGE_BASE_URL` CDN-origin configuration) are matched
  by `isImageDerivative` (`:51-53`, pathname-only regex — origin-agnostic) but never actually
  cached.** `startRevalidate`'s success handler bails at `if (!networkResponse.ok) return
  networkResponse;` (`:304`) before any `imageCache.put`/`recordAndEvict`, and a `no-cors`
  opaque response always has `ok:false`/`status:0` per the Fetch spec — so for a CDN-origin
  deployment, `cached` is always `null` and the entire touch/evict/LRU machinery in this
  flow is unreachable dead code for those requests. The user-visible behavior is still
  correct (the opaque response body is handed straight through to the `<img>`, so images
  render fine) — but the documented "50 MB LRU cap" / offline-fallback story for images
  silently does not apply when `IMAGE_BASE_URL` points at a different origin, and nothing in
  `CLAUDE.md`'s Service Worker section calls this out.
- **TRC4-08 (needs-validation, Low-Medium confidence, narrow and self-healing): the
  `evictExpiredCachedImage` recency READ is not covered by the `withMetaMutation` write
  serialization queue.** `recordAndEvict`/`touchMeta`/`deleteMeta` all funnel their
  read-modify-write cycles through `withMetaMutation` (`:98-104`) so they never interleave
  with each other, but `evictExpiredCachedImage`'s own `getMeta()` call (`:263`) is a bare,
  unsynchronized read. Two near-simultaneous `fetch` events for the identical image URL (a
  duplicate `<img>` in a masonry re-render, or a prefetch racing the visible load) could have
  one request's `evictExpiredCachedImage` read a **pre-touch** snapshot of the meta map while
  the other request's `touchMeta` write is queued but not yet committed — if that stale
  snapshot's timestamp happens to sit past `IMAGE_MAX_STALE_MS` (1h), the reader would evict
  an entry the other request had just (or was about to) confirm as fresh. Impact is limited
  to a spurious re-fetch on the next view (self-healing, not data corruption), and the
  precondition (two near-simultaneous fetches to the identical URL at exactly the 1-hour
  staleness boundary) is narrow. This is the same C3-10 problem class one layer down — the
  WRITE path was fixed to be durable/awaited, but the READ path used for the eviction
  decision was not brought into the same mutation queue.

---

## Flow 5 — `migrate.js` fresh / legacy-drifted / mixed-journal paths (285a4538)

**Hypotheses considered:** does the pending tail now always execute; can baselining still
swallow a pending migration under any journal-order permutation?

**Evidence — the core fix is sound, verified against the real dependency, not just the
project's own comments:**
- Read the actual installed `drizzle-orm`'s migrator (`node_modules/drizzle-orm/mysql-core/dialect.cjs:56-73`
  and `node_modules/drizzle-orm/migrator.cjs:36-63`): `lastDbMigration` (the single row with
  `MAX(created_at)`) is fetched **once**, before the loop, and the loop iterates the journal
  array in **journal-file order** (not re-sorted by `folderMillis`), applying every entry
  whose `folderMillis` exceeds that one fixed snapshot value. Crucially there is **no
  per-entry hash check inside drizzle itself** — this confirms `CLAUDE.md`'s own claim in the
  Migration Runbook is accurate, and that the `baselineAllJournalMigrations` doc-comment
  claiming "per-entry baselining keeps drizzle's own hash check authoritative"
  (`scripts/migrate.js:742-744`) is a **stale/inaccurate comment** — there is no such
  drizzle-side hash check to keep authoritative; correctness instead rests entirely on
  keeping the table's `MAX(created_at)` unchanged when baselining true-drift entries.
- Given that mechanism, traced the mixed-batch fix's arithmetic: `trueDrift` entries
  (`folderMillis <= cursor`, `migrate.js:857-859`) are baselined with `created_at =
  m.folderMillis` for each — since every one of those values is by definition `<=` the
  pre-existing cursor (itself already the table's max), inserting them **cannot raise**
  `MAX(created_at)`. So when `runMigrations` later calls `migrate()`, its one-time snapshot
  of `lastDbMigration` is unchanged from the pre-baseline cursor, and — because that snapshot
  is fixed for the entire loop, not re-queried per iteration — **every** `pendingTail` entry
  (folderMillis > cursor) is compared against the *same* pre-baseline value and applied,
  regardless of the pendingTail entries' relative order to each other. Constructed and
  reasoned through an adversarial permutation (two pending entries where the later-idx one
  has an *earlier* folderMillis than the former, mimicking this repo's own documented
  non-monotonic-timestamp history) and confirmed both still apply correctly, because
  drizzle's comparison base never moves mid-loop.
- **Verdict TRC4-09: "does the pending tail always execute" — confirmed-fixed, High
  confidence** (verified against the real dependency's exact comparison semantics, not
  assumed from the project's internal comments). "Can baselining still swallow a pending
  migration under any journal-order permutation" — **ruled-out** for the specific
  mixed-batch class C3-01 targeted, High confidence.
- The `baselineAllJournalMigrations` above-cursor throw guard (`:760-771`) is correctly
  redundant/defensive for the current call sites: `prepareLegacyDatabaseIfNeeded` only ever
  passes it a `trueDrift` array that has already been filtered to `<= cursor`
  (`:857-859,870`), so the guard should never fire today — it is pure belt-and-braces against
  a future refactor, exactly as its comment states.

**Evidence — a distinct residual the mixed-batch fix does NOT cover:**
- **TRC4-10 (confirmed by code + fixture read, High confidence for the mechanism / Medium
  for real-world reachability): the "true drift" (below-cursor) baselining path has no
  guard against silently skipping embedded DML, even though the project's own migration
  history contains at least one such migration.** `apps/web/drizzle/0001_sync_current_schema.sql:58-66`
  adds `shared_group_images.position` via DDL (`DEFAULT 0 NOT NULL`) and then runs a genuine
  DML backfill (`UPDATE ... JOIN (... ROW_NUMBER() ...) ... SET sgi.position =
  ordered.computed_position WHERE sgi.position = 0`) to correctly sequence **pre-existing**
  rows. `CLAUDE.md`'s freshly-added "DDL-only invariant" note (this cycle's own WP1 doc
  change) states migrations "MUST be DDL-only for reconcile-mirroring purposes; DML rides
  only the drizzle-apply path" — but 0001 itself, already in the repo, violates that
  invariant. The above-cursor `pendingTail` path is explicitly guarded (throws if baselined
  without executing); the below-cursor `trueDrift` path has **no equivalent check** — if any
  future legacy-drifted database (plausible given this repo's own documented history of
  non-monotonic-timestamp-induced gaps) is missing 0001's hash specifically while some later
  migration's hash IS already recorded (establishing a cursor past 0001), `trueDrift` would
  baseline 0001 — reconcile only adds the column with its `DEFAULT 0`, the DML re-sequencing
  UPDATE never runs, and every pre-existing row in every shared group would silently end up
  with `position = 0` instead of a correct per-group ordering. Grepped
  `apps/web/src/__tests__/migrate-pending-migrations.test.ts` and confirmed no test exercises
  "a true-drift entry that carries DML" — the mixed-batch and above-cursor-refusal tests
  cover the pendingTail side only. This is a latent architectural gap rather than an active
  production risk today (a currently-healthy deployment should already have 0001's hash
  recorded from the historical one-time full-baseline recovery this whole system was built
  around, so `journalCovered` would short-circuit before ever reaching this path) — but it
  would silently reproduce for any future DML-bearing migration that ends up below a cursor,
  and for any fresh legacy-DB-adoption scenario that predates 0001.

---

## Flow 6 — `photo-navigation.tsx` swipe visuals across in-place switches (9c45e933)

**Hypotheses considered:** shared-group in-place switches, rapid double-swipe, orientation
change — any path leaving stale transform/opacity?

**Evidence:**
- `applySwipeVisuals` (`:64-92`) is a full imperative overwrite of all four tracked style
  properties (`transition`/`opacity`/`transform` ×2, plus the progress bar) on every call —
  there is no incremental/relative state, so any subsequent call (from any source: touchmove,
  touchend, or the layout effect) always fully corrects whatever was there before. This makes
  the mechanism inherently self-healing against most interleavings.
- The fix under trace (`:112-115`, `useLayoutEffect` keyed on `[prevId, nextId,
  applySwipeVisuals]`) fires synchronously before paint whenever the displayed photo's
  neighbor ids change — this covers the shared-group `onSelectId=setCurrentImageId` in-place
  case (no remount, so the static JSX style literals alone would never have cleared drag
  styles), and equally covers the button-click and any keyboard-navigation paths, none of
  which call `applySwipeVisuals` directly. Traced this is a genuine superset fix, not
  overlapping-only with the two success-branch resets added in the same commit (`:193,198`).
- Constructed the rapid-double-swipe scenario by reasoning (a live device can't overlap two
  single-finger touch sequences, so "rapid" means gesture 2 starts very soon after gesture
  1's `touchend`, before React has necessarily re-rendered with the new `prevId`/`nextId`):
  gesture 2's `handleTouchMove` fully overwrites the styles with its own live drag values
  regardless of what gesture 1's settle-animation had set (no partial/merged state is
  possible given the overwrite-only design); if gesture 2 never crosses the horizontal
  swipe-detection threshold, `handleTouchEnd`'s `if (!isSwiping.current) return;`
  (`:174-175`) is a no-op, but that's fine because gesture 1's own `touchend` already wrote
  the synchronously-correct resting value (`opacity:'0'`, etc., `:193/198/203`) — the CSS
  `transition` only smooths the *visual* interpolation, the inline style attribute is set
  immediately, so there's no way for this interleaving to leave a genuinely stale computed
  value even without the layout effect's help.
- **Verdict TRC4-11a (stale transform/opacity from double-swipe or orientation change):
  ruled-out, Medium confidence** (reasoned from the overwrite-only design and the dual
  reset/layout-effect mechanism; not run against a real device or Playwright, so residual
  timing quirks specific to a given browser's touch-event dispatch cannot be fully excluded).
- **Verdict TRC4-11b (test coverage gap, confirmed, High confidence):** the new
  `e2e/swipe-visual-reset.spec.ts` (grepped for `test(`) contains exactly **one** test,
  covering a single sub-threshold snap-back and a single threshold-crossing swipe — it does
  **not** exercise rapid double-swipe or an orientation-change interaction, so the "no stale
  visuals" claim for those specific interleavings rests on code reasoning only, not on
  automated evidence, despite this cycle explicitly landing the first behavioral coverage for
  this component (closing C3-14).

---

## Additional flow A (self-selected) — `app/actions/embeddings.ts`'s cached-config read

**Reason for suspicion:** this cycle's WP3 fixed the exact bug class "detached background
task reads request-cached `getGalleryConfig()`" in `admin-backfill-runner.ts`, explicitly
calling it a repeatable sibling pattern ("the exact class C2-10 fixed in image-queue, one
file over"). `app/actions/embeddings.ts:94` still calls the cached `getGalleryConfig()`
(not `getGalleryConfigUncached()`), so it looked like a plausible next sibling.

**Evidence:** read the full function body (`app/actions/embeddings.ts:57-207`). Unlike
`admin-backfill-runner.ts`'s pattern, `backfillClipEmbeddings()` does **not** spawn a
detached/background continuation — every DB query and the entire batch/chunk processing
loop (`:126-189`) is fully `await`ed inline before the function returns its result object.
Since `getGalleryConfig()` is `React.cache()`-scoped to a single invocation and this whole
action completes within one invocation, there is no "stale cached value read once, used by a
background task minutes later" window here — the bug class genuinely does not apply.
Additionally confirmed via the file's own comment (`:81-86`) that this action is **not
wired to any UI** and the canonical entry point remains the sidecar script, so even a latent
issue here would not affect the running product today.

**Verdict TRC4-12: ruled-out, High confidence.**

---

## Additional flow B (self-selected) — shared-group view-count buffer's SIGTERM flush

**Reason for suspicion:** `CLAUDE.md` documents this buffer as "best-effort... flushed on
graceful SIGTERM, lost on SIGKILL," and this cycle's flows 2/3 both surfaced MySQL-restart
racing shutdown as a live theme in this repo's incident history — worth checking whether the
"graceful SIGTERM ⇒ flushed" half of that claim actually holds when the DB itself is down at
shutdown time.

**Evidence:** traced `flushBufferedSharedGroupViewCounts` (`src/lib/data.ts:222-249`) and its
wiring in `instrumentation.ts:46-59`. The shutdown path is well hardened against the
timing bug this project has hit before elsewhere (it cancels any pending timer, **awaits an
in-flight drain** rather than racing it — the `currentFlushPromise` mechanism at
`data.ts:71,105,217-218` specifically exists to prevent observing a post-swap empty buffer
mid-drain — then cancels any follow-up timer the awaited drain re-armed, and only then does
its own final synchronous flush). However: `flushGroupViewCounts`'s per-item `.catch()`
handler (`:127-152`) always re-buffers a failed write and swallows the error inside the
`Promise.all` — it never rejects the outer promise. So if MySQL is unreachable at the exact
moment of a graceful SIGTERM (plausible under the same host-reboot-kills-MySQL-and-app
scenario noted in flow 2/3), `flushBufferedSharedGroupViewCounts()` still resolves
**successfully** even though every write failed and the re-buffered increments are about to
be abandoned (the process calls `process.exit()` immediately after the `Promise.race` in
`instrumentation.ts:51-59`, so the newly re-armed retry timer never fires). The shutdown's
`completed=true`/`exitCode=0` signal (`instrumentation.ts:57,74`) does not distinguish this
outcome from a real successful flush — unlike the image-queue drain, which correctly sets
`exitCode=1` on its own timeout.

**Verdict TRC4-13: confirmed (mechanism), Medium confidence overall — this is squarely
within the documented "best-effort/approximate" contract for this analytics buffer
(`CLAUDE.md`'s own Database Schema section already disclaims it as non-audit-grade), so the
*data loss* itself is accepted-by-design. The gap is narrower: the exit code doesn't reflect
that this specific best-effort store failed to flush during an otherwise-graceful shutdown,
which could mask a DB-down-at-shutdown condition from process-supervisor-level monitoring
that keys off exit codes.** Low severity given the explicit best-effort framing; noted for
completeness rather than as an urgent fix.

---

## Summary table

| ID | Flow | Verdict | Confidence | Severity |
|----|------|---------|------------|----------|
| TRC4-01a/b/c | serve-upload.ts rename race | ruled-out | High | — |
| TRC4-02 | single-writer-guard reprobe-connect-failure gives up silently, wrong "at startup" wording on reprobe | needs-validation (mechanism confirmed by code read) | Medium | Low-Med |
| TRC4-03 | single-writer-guard keepalive-vs-shutdown double-log | needs-validation (mechanism confirmed against real mysql2 source) | Medium | Low |
| TRC4-05 | embedding-scan cursor is in-memory-only and rarely re-invoked under per-commit-deploy cadence | confirmed structural gap | High | Low-Med |
| TRC4-06 | in-app embedding scan not lock-coordinated with sidecar backfill | confirmed (no corruption, wasted work) | High | Low |
| TRC4-07 | SW never caches opaque/CDN-origin image responses | confirmed functional gap | Medium | Low |
| TRC4-08 | SW eviction recency read races a concurrent touchMeta write | needs-validation | Low-Medium | Low |
| TRC4-09 | migrate.js pending tail always executes; no swallow under any pendingTail permutation | confirmed-fixed (verified against real drizzle-orm source) | High | — |
| TRC4-10 | migrate.js true-drift baselining can silently skip embedded DML (0001 itself qualifies) | confirmed mechanism / needs-validation for current-DB reachability | High (mechanism) / Medium (reachability) | Med (if hit) |
| TRC4-11a | photo-navigation double-swipe/orientation stale visuals | ruled-out | Medium | — |
| TRC4-11b | photo-navigation new e2e test doesn't cover double-swipe/orientation | confirmed test gap | High | Low |
| TRC4-12 | embeddings.ts action stale-config bug class | ruled-out | High | — |
| TRC4-13 | view-count flush exit code doesn't reflect DB-down-at-shutdown partial loss | confirmed mechanism, accepted-by-design data loss | Medium | Low |
