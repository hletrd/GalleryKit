# Tracer — Run-10 Cycle 5 (2026-07-07)

Start HEAD `d9bcbf4c`. Causal tracing of the cycle-4 IMPLEMENTATION commits
(`b68d09e2..d9bcbf4c`) — i.e. the fixes that cycle-4's own review lanes (C4-01..C4-47)
prescribed — with fresh eyes, plus the seven flows the orchestrator named. Every verdict is
backed by file:line citations and, where a mechanism was ambiguous, by reading the actual
source (Next.js locale config, the SW meta-mutation queue internals, the drizzle bootstrap
paths). No repo files were modified.

Confidence scale: High (mechanism traced to source) / Medium (code-trace, plausible
untested interleaving) / Low (speculative / narrow window).

I explicitly re-verified the cycle-4 "Tracer ruled out" list and did NOT re-report those.
The two NEW findings below are about the cycle-4 FIXES themselves (a fix's own residual /
newly-introduced gap), not about the pre-cycle-4 code the cycle-4 tracer already cleared.

---

## NEW FINDING TRC5-01 — migrate DML-baseline guard bricks fresh installs for any FUTURE DML migration; the runbook's own DML guidance is self-contradictory

**Flow traced:** `b68d09e2` (fix(migrate): refuse DML-bearing baselines on every path) →
`journalSqlContainsDml` → `baselineAllJournalMigrations` throw → the fresh-install code path
in `prepareLegacyDatabaseIfNeeded`.

**Competing hypotheses:**
- (a) The guard breaks the CURRENT deploy (some existing migration other than 0001 carries DML).
- (b) The guard is fully correct and inert until misused.
- (c) The guard is correct for drift repair but creates a latent trap on the fresh-install /
  empty-log path that the runbook actively steers authors into.

**Evidence:**
- I scanned every `apps/web/drizzle/*.sql` with the same lexical rule the guard uses
  (comment-strip → split on `--> statement-breakpoint`/`;` → statement-start
  `INSERT|UPDATE|DELETE|REPLACE`). **Only `0001_sync_current_schema.sql` carries DML**, and it
  is allowlisted in `LEGACY_DML_MIRRORED_BY_RECONCILE` (`migrate.js:187`). So hypothesis (a)
  is **ruled out** — the current deploy is safe. High confidence.
- The fresh-install path is `prepareLegacyDatabaseIfNeeded` `!hasGalleryTables`
  (`migrate.js:842-861`): it runs `reconcileLegacySchema(...)` then
  `await baselineAllJournalMigrations(connection, migrations)` — **ALL journal entries**, no
  `maxFolderMillis` option. Inside `baselineAllJournalMigrations` the cursor guard is skipped
  (`maxFolderMillis === null`), then the new DML guard filters
  `inserts.filter(m => m.containsDml && !LEGACY_DML_MIRRORED_BY_RECONCILE.has(m.tag))` and
  **throws** if non-empty (`migrate.js:817-828`). So any FUTURE migration `NNNN` that carries
  a data backfill (INSERT/UPDATE/DELETE/REPLACE) and is not allowlisted makes
  `baselineAllJournalMigrations` throw on the fresh-install path → `npm run init` /
  cold-DB e2e bootstrap fails hard for every fresh database. Confirms hypothesis (c). High
  confidence (mechanism).
- **The runbook guidance is internally contradictory for this case.** CLAUDE.md's
  "DDL-only invariant (qualified, C4-35)" (line 449) states a future DML migration
  "must rely exclusively on the drizzle-apply path (never a new reconcile-side UPDATE)."
  But on a fresh install the drizzle-apply path is *deliberately* a no-op — everything is
  baselined precisely so `drizzle.migrate()` does nothing (`migrate.js:850-858` comment:
  "after baselining every journal hash drizzle.migrate() is a verified no-op"). So the DML
  can NEVER run on a fresh DB via drizzle-apply, and the guard now converts that silent gap
  into a hard boot failure. The only way to satisfy the guard is to allowlist the tag AND
  mirror the DML in `reconcileLegacySchema` — which is exactly the "never a new reconcile-side
  UPDATE" the same note forbids. The "Adding a new migration" steps (CLAUDE.md 452-458) do
  **not mention the DML constraint at all** — step 3 only says "mirror the new schema state
  (idempotent CREATE/ALTER)".
- Not a half-broken-DB hazard: `reconcileLegacySchema` fully builds the schema before the
  throw, and a retry re-enters the same throw (idempotent), so the failure is a clean,
  repeatable "resolve the DML then retry" — but it is a HARD BLOCK on fresh installs, not a
  degrade.

**Confirmed/likely defect:** `apps/web/scripts/migrate.js:817-828` (DML guard) reached via the
fresh-install caller `migrate.js:846-851` with ALL migrations. The guard is *correct* for
drift-repair, but there is no runbook-blessed, fresh-install-safe way to author a DML-bearing
migration; the DDL-only note (CLAUDE.md:449) and "Adding a new migration" (452-458) don't
close the loop.

**Failure scenario:** A future contributor adds `0033_backfill_foo.sql` with an
`UPDATE images SET ...` backfill, follows the runbook (mirror DDL in reconcile, bump `when`,
update schema.ts) but does NOT touch `LEGACY_DML_MIRRORED_BY_RECONCILE`. Existing deployed
DBs heal fine (drizzle-apply runs the UPDATE on the pending-tail path). But **every fresh
`npm run init`, every cold-DB Playwright run, and every brand-new operator install throws**
`[Migration] Refusing to baseline 1 DML-bearing migration(s)...` and cannot boot until someone
diagnoses that the fresh path is unrelated to the drizzle-apply path the runbook pointed them
at.

**Suggested fix (pick one, then document):**
1. Split the fresh-install path from drift-repair: on a genuinely empty DB, *let
   `drizzle.migrate()` actually apply everything* (its SQL, including DML) and only baseline on
   true legacy drift — so DML migrations run on fresh installs via the very drizzle-apply path
   the runbook promises. (This is a larger change to the C-series bootstrap decision.)
2. If keeping baseline-all-on-fresh, extend the "Adding a new migration" steps with an explicit
   DML sub-procedure: DML backfills must NOT ride a migration; do them in a separate idempotent
   sidecar script (like the color/CLIP backfills), OR allowlist + reconcile-mirror them. Make
   the guard's throw message point at the runbook section.

**Confidence:** High (mechanism) / Medium (real-world reachability — requires a future DML
migration, but the runbook actively leads authors toward the trap).
**Label:** Confirmed (mechanism) / Needs-validation (reachability). **Severity:** MED
(fresh-install / cold-DB boot break when hit).

---

## NEW FINDING TRC5-02 — config write-invalidation has an in-flight repopulation race; the "observe the flip immediately, not after the TTL" contract is not actually delivered

**Flow traced:** `12037508` (fix(config): write-invalidated detached config cache) →
`updateGallerySettings` commit → `invalidateDetachedGalleryConfigCache()` racing an already
in-flight `getGalleryConfigDetached()` from a background consumer (image-queue side-effect
gate / admin backfill runner).

**Competing hypotheses:**
- (a) Invalidation makes flip-then-act EXACT as the commit claims.
- (b) Invalidation clears the cache but an in-flight read that started BEFORE the invalidation
  resolves AFTER it and repopulates the cache with a pre-commit value.

**Evidence:**
- `getGalleryConfigDetached` (`apps/web/src/lib/gallery-config.ts:219-237`) captures **no
  generation token**. The in-flight closure unconditionally executes
  `uncachedConfigCache = { value, expiresAt: Date.now() + DETACHED_CONFIG_TTL_MS }`
  (`:230`) when `_getGalleryConfig()` resolves — regardless of any intervening invalidation.
- `invalidateDetachedGalleryConfigCache()` (`:247-250`) sets `uncachedConfigCache = null` and
  `uncachedConfigInFlight = null`, but has no way to signal an ALREADY-running closure to
  discard its result. Confirms hypothesis (b). High confidence (pure code trace).
- Concrete interleaving:
  1. Background consumer calls `getGalleryConfigDetached()`. No cache/inflight → starts read
     `P` (`uncachedConfigInFlight = P`). `P`'s `SELECT` on `admin_settings` executes and
     snapshots the PRE-flip rows.
  2. Admin `updateGallerySettings` commits new settings, then calls
     `invalidateDetachedGalleryConfigCache()` → both module vars nulled.
  3. `P` resolves and runs `:230` → `uncachedConfigCache = { PRE-flip value, expiresAt now+2s }`.
  4. Any detached read in the next 2 s (`:221-223`) returns the **stale pre-flip value** — up
     to `DETACHED_CONFIG_TTL_MS` AFTER the invalidation the commit says makes it immediate.
- **Worse (last-writer-wins clobber):** because step 2 also nulls `uncachedConfigInFlight`, a
  detached read arriving between step 2 and step 3 does NOT dedupe onto `P`; it starts a fresh
  read `P2` that reads the POST-flip value. `P2` and `P` both write `:230` in nondeterministic
  order. If `P` (stale) resolves last, it **overwrites the fresh `P2` value**, pinning the
  stale value for the full TTL.

**Confirmed defect:** `apps/web/src/lib/gallery-config.ts:227-235` — the in-flight closure has
no invalidation-generation guard, so `invalidateDetachedGalleryConfigCache()` (`:247`) does not
actually guarantee the "flip-setting-then-act observes the new value immediately" contract the
commit message and the docstring (`:239-245` and the `FRESHNESS CONTRACT` block) assert.

**Failure scenario:** During an active upload burst (image-queue calls
`getGalleryConfigDetached()` once per processed image, so an in-flight read is common), an
admin flips `avif_effort`/`image_quality_*`/`semantic_search_mode` and immediately triggers a
re-encode or relies on the queue's per-image gate. If a detached read was in flight at the
commit instant and its SELECT predated the commit, the queue / backfill reads the **pre-flip
settings** for up to 2 s after the invalidation — the exact "must never re-encode at the
pre-flip settings" invariant the commit message invokes, narrowly reintroduced. The admin
backfill runner reads config once per run (`admin-backfill-runner.ts` `runBackfill`), so a
run that reads within that 2 s window re-encodes at old settings.

**Suggested fix:** add a monotonically-incrementing `configGeneration` counter bumped by
`invalidateDetachedGalleryConfigCache()`; capture it when the in-flight closure starts and only
write `uncachedConfigCache` on resolve if the generation is unchanged (else discard and let the
next call re-read). This makes the "immediate" claim actually hold.

**Confidence:** High (mechanism). **Label:** Confirmed. **Severity:** LOW-MED (bounded 2 s
staleness in a narrow race; single-writer/single-process only affects the background
queue/backfill consumers, not the admin's own request-path `getGalleryConfig`).

---

## NEW OBSERVATION TRC5-03 — the single-writer guard's new self-heal loop only covers POST-acquisition lapses; a startup (never-acquired) connect failure still permanently disarms with no retry

**Flow traced:** `ce15103a` (self-heal after a lapse) — `startSingleWriterGuard` →
`openGuardConnection('startup')` failure path vs. the new post-lapse `scheduleReacquire` loop.

**Evidence:**
- The C4-06 re-acquire loop is armed only from `holdConnection`'s error handler (`:130-140`)
  and the keepalive failure handler (`:145-155`) — i.e. AFTER a successful acquisition. Both
  call `scheduleReacquire()` (`:167-173`) → infinite unref'd 60 s retry. Good: a DB
  restart/blip after acquisition now self-heals. Verified against the test suite added in the
  commit.
- But `startSingleWriterGuard` (`:307+`) does `const opened = await openGuardConnection();
  if (!opened) return;` — a **startup connect failure** (`openGuardConnection` catch →
  returns null, `:96-108`) exits with NOTHING scheduled: no keepalive, no reprobe, no
  re-acquire. The guard is permanently disarmed for the process lifetime.
- This is asymmetric with the fix's own thesis ("a lapse no longer disarms the guard
  permanently"): a post-acquisition lapse retries forever, but a never-acquired startup blip
  gives up immediately. Realistic in a compose stack where the web process boots before MySQL
  accepts connections — the guard silently never protects against a later second instance.

**Verdict:** confirmed mechanism, but this is the **same class as the cycle-4 tracer's TRC4-02**
(reprobe-connect-failure gives up) one step earlier (startup-connect-failure), and it PRE-dates
`ce15103a` (the commit deliberately scoped itself to post-acquisition lapses). Reporting as a
residual/coverage note, not a regression the fix introduced. **Confidence:** High.
**Label:** Confirmed (mechanism). **Severity:** LOW (warn-only guard; best-effort by design).
**Suggested fix:** on a startup connect failure OR a startup contention, schedule the same
unref'd re-acquire loop instead of `return`ing, so the guard is eventually-consistent from any
cold start.

---

## NEW OBSERVATION TRC5-04 — SW `networkFirstHtml` `void`s the `extendLifetime` no-event fallback, contradicting the helper's own comment

**Flow traced:** `31ff51f5` — `extendLifetime` (`sw.template.js:295-302`) as used by
`networkFirstHtml` (`:465-472`).

**Evidence:** `extendLifetime`'s no-event branch returns `guarded` so a caller can await it
"inline so the write stays inside the respondWith chain" (comment `:293-294`). But
`networkFirstHtml` calls `void extendLifetime(event, ...)` — the returned promise is discarded,
so in the (defensive, effectively-never-hit) no-event case the HTML `cache.put` is neither
awaited nor lifetime-covered. The image path (`:396,415`) correctly `await`s the helper, so
its inline fallback works. Zero real-world impact: fetch events always expose `waitUntil`, and
the HTML fallback cache is explicitly best-effort (`:447-455`). **Confidence:** High.
**Label:** Confirmed (cosmetic/inconsistency). **Severity:** LOW (comment/behavior mismatch
only). **Suggested fix:** `await extendLifetime(...)` in `networkFirstHtml` too (harmless when
`event` exists — returns `Promise.resolve()`), or drop the no-event inline-await claim from the
helper comment.

---

## Flows traced and RULED OUT (evidence-backed; do NOT re-report as bugs)

**Shared-group `history.replaceState` locale drop (0da58d6b) — RULED OUT, High.**
Hypothesis: raw `window.history.replaceState(null, '', targetUrl)` writes a literal string, so
if `syncPhotoQueryBasePath` lacked the locale prefix it would strip `/en`|`/ko` from the URL
(where the old `router.replace` would have been locale-corrected by middleware). Traced:
`syncPhotoQueryBasePath = localizePath(locale, '/g/${key}')` (`g/[key]/page.tsx:164`);
`localizePath` (`lib/locale-path.ts:26-30`) always prepends `/${locale}`; and `proxy.ts:10`
sets `localePrefix: 'always'`, so the served URL is ALWAYS locale-prefixed. Therefore
`targetUrl` (`.../en/g/..`) and `window.location.pathname` are locale-consistent, the
skip-if-match guard (`photo-viewer.tsx:349-351`) compares like-for-like, and no locale is
dropped. Hypothesis disproven.

**SW `readMetaForUrl` deadlock via nested `withMetaMutation` (31ff51f5/C4-26) — RULED OUT, High.**
Hypothesis: `readMetaForUrl` wraps `getMeta()` in `withMetaMutation`; if `getMeta` itself
acquired the same non-reentrant queue it would self-deadlock. Traced `getMeta` (`sw.template.js`
tail `:76-85`) — it just opens `META_CACHE` and JSON-parses; it does NOT call
`withMetaMutation`. The queue (`:98-104`) is a serial promise chain with no re-entrancy from
`getMeta`/`setMeta`. No deadlock.

**SW `event.waitUntil` called while the fetch event is inactive (InvalidStateError) — RULED OUT, High.**
Hypothesis: `extendLifetime` calls `event.waitUntil` asynchronously (after awaits), which throws
if the event is no longer active. Traced: both consumers run inside the promise passed to
`event.respondWith` (`:540,552`), and `respondWith` keeps the event's extend-lifetime count > 0
until the handler returns. `extendLifetime`→`waitUntil` is always invoked BEFORE the handler
returns (`staleWhileRevalidateImage` `:396`/`:415` before `return cached`; `networkFirstHtml`
`:465` before `return networkResponse`), so the event is always still active. Legal.

**SW phantom-eviction unconditional decrement — RULED OUT, High.**
`ad1fd22d` makes `total -= entry.size` unconditional in the eviction walk (`:129-137`, mirrored
`sw-cache.ts`). Traced: tracked `total` ≥ real occupancy always (phantoms inflate `total`,
occupy 0 real bytes), so paying phantom bytes down cannot cause under-eviction of real bytes;
the just-added entry sits at the Map tail (delete-then-set `:119`) so the oldest-first head-walk
evicts it last. `evicted` stays gated on `delete()` success (reports actual freed bytes). Sound;
matches the DBG4-02 repro test.

**photo-viewer hydration transient sessionStorage write (4afacfa8) — RULED OUT as a bug, High.**
Hypothesis: the restore effect sets `pinRestoredRef.current=true` BEFORE the persist effect
checks it, so the persist effect runs on first mount and writes `String(false)`, clobbering a
stored `'true'`. Traced the effect ordering: React runs effects top-to-bottom in one commit, so
restore (defined first, `:104-121`) runs and calls `setIsPinned(true)`, THEN persist
(`:122-127`) writes `'false'` — but `setIsPinned(true)` schedules render 2, whose persist effect
(`isPinned` false→true) immediately rewrites `'true'`. Net sessionStorage = `'true'`; the
restore READ already happened before the transient write, so no data is lost. The comment's
"the gate keeps a transient false from overwriting a stored true" is mechanically imprecise (the
gate doesn't prevent the transient write; render 2 corrects it) but the OUTCOME is correct.

**serve-upload `buildDerivativeEtag` extraction (e3d221e3) — RULED OUT, High.**
Both sites (`:266` path-stat, `:314` fd-stat) now call the identical helper
(`W/"v{pipeline}-{mtimeMs}-{size}-{settingsHash}"`); pre-body and streamed-body ETags cannot
drift. Behavior unchanged.

**health-probe coalescing (18b6cbb4) — RULED OUT, High.** `probeDb` shares one in-flight
promise; `.finally` resets it on resolve/timeout. Correct coalescing; both concurrent callers
get the same result. The "timeout abandons the query, query keeps its connection" accumulation
is pre-existing (same `Promise.race` pattern existed inline pre-commit) and is explicitly
documented in the new comment — not introduced here.

**embedding model-version reset (d7ca37de) — RULED OUT as buggy, High.** The reset is gated
below the `if (semanticMode === 'disabled') return;` early-out (`image-queue.ts:535`), so a
disabled mode never spuriously resets; the reset fires correctly in BOTH directions
(stub↔production) because `activeModelVersion` is recomputed each call and compared to the
tracked `embeddingScanModelVersion`; the `getProcessingQueueState` migration guard
(`:408-410`) initializes a missing field to `null`. Correct — and, as the commit itself
documents, narrow (a production activation requires a redeploy → fresh process → cursor already
0), consistent with deferred C4-09d. Not re-reporting the narrowness (already carried).

**nav swipe-settle `skipNextHardReset` (678ebbeb) — RULED OUT, Medium-High.** The one-shot flag
(`photo-navigation.tsx`) is set only on a swipe-SUCCESS branch that always calls `goToPhoto`,
which changes `prevId`/`nextId` → the layout effect fires and check-and-clears the flag every
time, so it can't leak into a later id change. Remount (non-shared path) discards the flag on a
fresh instance. No stale-visual regression.

**zoom native touchmove (9dccebcd) — RULED OUT, Medium-High.** Native
`addEventListener('touchmove', handler, {passive:false})` honors `preventDefault`; the handler
closes over stable ref objects; the effect re-attaches only if `handleTouchMove` identity
changes (stable, deps `[applyTransform]`). React `onTouchStart`/`onTouchEnd` still fire on the
same element in order. Assumes the native listener target (`containerRef.current`) is the same
node as the JSX `onTouchStart` element — consistent with this file's existing wheel-listener
idiom.

**neighbor-preload stale `sizes` ref (d79f6f70) — RULED OUT as a bug, High.** The effect now
reads `photoViewerSizesRef.current` and drops `photoViewerSizes` from deps, so an info-panel
toggle no longer tears down the preloads. The `sizes` value can be stale after a toggle, but it
is only a preload responsive HINT; the neighbor's actual `<img>` uses the live
`photoViewerSizes` at navigation time, so a mismatched hint is at most a minor wasted preload —
the deliberate, documented perf tradeoff of C4-23, not a correctness bug.

**settings-hash no-arg normalize (5f0388ed) — RULED OUT, Medium-High.** `fetchHashFromDb` now
normalizes `image_sizes` via `parseImageSizes(...).join(',')` (`settings-hash.ts:102-114`),
matching the config-arg path's ascending sort + de-dupe, so the two ETag-hash paths agree.
Consistent with C4-19's intent.

---

## Summary table

| ID | Flow (cycle-4 fix) | Verdict | Confidence | Severity |
|----|--------------------|---------|------------|----------|
| TRC5-01 | migrate DML guard bricks fresh installs for future DML migrations; runbook self-contradictory | NEW confirmed mechanism / needs-validation reachability | High/Med | MED |
| TRC5-02 | config write-invalidation in-flight repopulation race defeats the "immediate" contract | NEW confirmed | High | LOW-MED |
| TRC5-03 | single-writer startup connect-failure still permanently disarms (no re-acquire) | NEW observation (residual of TRC4-02 class) | High | LOW |
| TRC5-04 | SW networkFirstHtml `void`s extendLifetime no-event fallback vs. helper comment | NEW observation (cosmetic) | High | LOW |
| — | 0da58d6b shared-group replaceState locale drop | ruled out | High | — |
| — | SW readMetaForUrl nested-queue deadlock | ruled out | High | — |
| — | SW waitUntil-on-inactive-event InvalidStateError | ruled out | High | — |
| — | SW phantom-eviction under/over-eviction | ruled out | High | — |
| — | photo-viewer hydration transient-write clobber | ruled out | High | — |
| — | serve buildDerivativeEtag drift | ruled out | High | — |
| — | health-probe coalescing correctness | ruled out | High | — |
| — | embedding model-version reset logic | ruled out | High | — |
| — | nav skipNextHardReset leak | ruled out | Med-High | — |
| — | zoom native touchmove | ruled out | Med-High | — |
| — | neighbor-preload stale sizes | ruled out | High | — |
| — | settings-hash no-arg normalize | ruled out | Med-High | — |
