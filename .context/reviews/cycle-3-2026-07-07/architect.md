# GalleryKit — Architecture Review (ARCHITECT pass, run-10 cycle-3)

Scope: architectural assessment of cycle-2's commits (`642c5091..e08b6f97`), plus a
full-repo structural pass (module graph, cyclic deps, duplicated-logic drift,
process-local state vs single-writer topology, config precedence, migrate.js machinery,
cache-invalidation layering, scanner-architecture accretion). Read-only; no source
modified. Predecessor: `.context/reviews/cycle-2-2026-07-07/architect.md` (ARCH-01..09).
Deferred registers consulted: `cycle-2-2026-07-07-deferred.md`, `cycle-1-2026-07-06-deferred.md`.

## Priority-1 verdicts on cycle-2 commits (short form; details below)

- **e39ad990 warn-only single-writer boot guard — DOES IT GUARD ANYTHING?** No, by
  design it only *detects* (warn-only, acknowledged). But the detection itself **decays**:
  the dedicated lock connection is query-idle for the whole process lifetime, so MySQL
  `wait_timeout` closes it, the advisory lock releases server-side, and from then on a
  second instance's GET_LOCK *succeeds* and warns nothing. See **ARCH3-01**. Net: it
  converts "silent" into "logged-once-at-boot, and only while a peer is freshly alive" —
  the "guard" name oversells it, and the highest-probability misconfiguration (scale 1→2
  later) is the one it stops catching after `wait_timeout`.
- **3b8d05c8 /api CSP layer — right layer vs nginx?** Yes. Placing it in `next.config.ts
  headers()` is consistent with the nginx comment naming Next the CSP single source of
  truth, and it correctly targets only the middleware's `/api` blind spot. `default-src
  'none'; frame-ancestors 'none'; sandbox` is a near-no-op on image/JSON subresources
  (defense-in-depth, not load-bearing), which is fine. **No finding** (see Also-examined).
- **02bea8d6 image-queue hardening — coherent with advisory-lock + claim design?** Mostly
  yes (concurrency-from-pool, uncached-config, GC-timer clear, scan cap, escalating retry
  are all coherent). Two seams: it introduced an **inconsistency** — the sibling detached
  background task (`admin-backfill-runner`) was NOT converted to the uncached accessor
  (**ARCH3-02**) — and the new retry `setTimeout`s are **drain-invisible** (**ARCH3-04**).
- **b4e986c3 migrate.js — accreting reconcile complexity that needs a redesign?** The fix
  itself is a genuine correctness win and is sound (the author-time journal-monotonicity
  test makes its cursor fast-path safe). Not yet a redesign, but the machinery keeps
  accreting cursor-dependent branches on the non-monotonic-journal compensation, and the
  new **mixed-case path silently baselines a new migration's DML** past the post-condition
  (**ARCH3-03**, **ARCH3-05**).

Predecessor items now CLOSED by cycle-2 and NOT re-reported: ARCH-04 (journal monotonicity
guard now exists: `__tests__/migration-journal-monotonicity.test.ts`), ARCH-05 (reconcile
drift tripwire exists: `__tests__/migrate-reconcile-coverage.test.ts`), ARCH-08 (/api CSP,
3b8d05c8). ARCH-03/ARCH-06 remain deferred (C2-24b, C2-27) — no new evidence, not re-reported.

---

## Findings

### ARCH3-01 — The single-writer guard's lock connection silently lapses at MySQL `wait_timeout`, so its detection self-disables for the most likely scale-out path  [MED / High]
`apps/web/src/lib/single-writer-guard.ts` (startSingleWriterGuard holds the connection
open after one `GET_LOCK`; the `conn.on('error', …)` handler at ~L76-92 sets
`heldConnection = null` and warns once on drop); `apps/web/scripts/mysql-connection-options.js`
(the options this guard connects with carry **no** `enableKeepAlive` — only the pool in
`db/index.ts:35` does).

The guard opens a dedicated connection, runs `SELECT GET_LOCK('gallerykit_web_singleton',0)`
**once**, then holds the connection idle for the process lifetime. It issues no further
queries. MySQL closes a connection after `wait_timeout` seconds of *query* inactivity
(server default 28800s / 8h; this is query-idle, not TCP-idle — so even if TCP keepalive
were set it would not reset `wait_timeout`). When the connection drops, MySQL releases the
advisory lock server-side; the guard's `error` handler fires, logs one `console.warn`
("the guard has lapsed"), and nulls `heldConnection` with **no auto-reconnect** (explicitly,
by comment). From that moment the singleton signal is gone.

**Failure scenario:** an operator runs one instance for a day (guard connection long since
reaped at 8h → lock released), then adds `replicas: 2` or a second compose host on the same
MySQL. Instance B boots, `GET_LOCK` *succeeds* (nobody holds it), and B logs **nothing** —
exactly the silent scale-out the guard was built to catch, and the scale-*up-later* path is
the more common one (you rarely start at 2). Even in the window where detection works, the
`console.error` fires at B's boot, temporally far from the actual harm (a restore days later
committing into a DB another replica is dumping into). So the guard is a boot-time log line,
not a liveness signal, and it stops being even that after `wait_timeout`.
**Suggested direction:** make the held connection actually live for the process lifetime —
a periodic `SELECT 1` keepalive (interval < `wait_timeout`) on that connection, or re-probe
`GET_LOCK` on an interval and warn *at detection time* (not only at boot). Either turns it
into a real singleton signal; the current form is weaker than its name and its commit
message imply. (Does not change the warn-only/never-block policy — only makes the detection
durable.)

### ARCH3-02 — Detached-context config read left on the CACHED accessor in `admin-backfill-runner`: the exact C2-10 class 02bea8d6 just fixed in image-queue, un-fixed one file over, with no gate to catch it  [MED / High (inconsistency); Medium (runtime symptom)]
`apps/web/src/lib/admin-backfill-runner.ts:691` (`const config = await getGalleryConfig();`
— the request-cached export) inside `runBackfill`, which is launched **detached** at
`admin-backfill-runner.ts:907` (`runBackfill(lockConnHandoff).catch(…)`, fire-and-forget
from the admin action). Contrast the just-landed 02bea8d6, whose commit message states the
invariant plainly: "detached queue tasks … read `getGalleryConfigUncached()` — React
`cache()` is request-scoped and these run outside any request store," and which converted
all three `image-queue.ts` sites plus pinned it with `__tests__/image-queue-uncached-config-wiring.test.ts`.

The backfill runner is the *same* kind of detached background task (no request store), so by
the repo's own freshly-codified invariant this is a live violation. `getGalleryConfigUncached`
is nothing but `_getGalleryConfig` sans the `cache()` wrapper (`gallery-config.ts:201`), and
it is already exported — the fix is a one-line import swap.
**Failure scenario:** admin runs a backfill (reads config, memoized), flips a color/quality
setting (`avif_effort`, `image_quality_*`, chroma), then runs the in-app "Re-encode existing
photos" again — the second detached run re-reads the *memoized* config and re-encodes at the
**old** settings, silently defeating the flip-then-reencode operator workflow that is the
button's entire purpose. (Runtime confidence is Medium only because it hinges on React
`cache()`'s cross-invocation behavior outside a request store — but that is precisely the
hazard the maintainers asserted and fixed for image-queue; the *inconsistency* and the
*absence of any guard* are High-confidence.)
**Suggested direction:** swap `getGalleryConfig()` → `getGalleryConfigUncached()` at
`admin-backfill-runner.ts:691` and add a source-contract test mirroring the image-queue one.
Root cause (worth a small design beat): the cached/uncached split is enforced by **convention
only** — same function, no type or lint boundary marking "detached call site." This is the
recurring "fix one sibling, miss the next" theme (touch-target audit, the `max-` lookbehind).
Consider a scoped lint gate (detached modules — image-queue, admin-backfill-runner, interval/
timeout callbacks — may not import the cached `getGalleryConfig`) or a phantom-typed
`DetachedGalleryConfig` accessor so the next detached call site cannot silently regress.

### ARCH3-03 — migrate.js mixed-case (real drift + a new pending migration) baselines the new migration WITHOUT executing its SQL, and the loud post-condition is structurally blind to it  [LOW-MED / High]
`apps/web/scripts/migrate.js` `prepareLegacyDatabaseIfNeeded` (FDR-01 branch added in
b4e986c3): the fast-path returns early only when `missing.every(folderMillis > cursor)`. If
the DB is genuinely drifted (any missing hash **at/below** the `MAX(created_at)` cursor —
the exact production-poison state the whole runbook exists for) **and** a new migration is
also pending above the cursor, `every(...)` is false, so it falls into `reconcileLegacySchema`
+ `baselineAllJournalMigrations` — which **records the new migration's hash without running
its `.sql`**. `reconcileLegacySchema` mirrors DDL only, never DML. The code emits a
`console.warn` naming the "swallowed tail," but then `runMigrations`' post-condition
(`every journal hash ∈ __drizzle_migrations`) **passes**, because baseline just inserted that
hash — so the deploy does NOT fail loud. A DML-bearing migration in this window is silently
skipped with only a warn in the logs.

This is narrow (migrations here are DDL-only *except* `0001_sync_current_schema.sql`, which
carries 1 DML statement — so the DML-in-migration precedent exists and the commit message
itself contemplates future DML backfills), but the failure mode is the *same class* the
runbook was written to abolish: "every deploy logged Complete with no error" while schema
silently lagged. A warn that the post-condition then overrides is not loud enough for a path
that drops committed migration SQL.
**Suggested direction:** in the mixed case, either (a) run the swallowed-tail entries' `.sql`
explicitly before baselining them, or (b) make the swallowed-tail non-empty case a hard
`throw` (fail the deploy) rather than a `console.warn`, mirroring the post-condition's
loud-fail philosophy — the operator can then re-run after resolving the drift.

### ARCH3-04 — image-queue per-job retry `setTimeout`s are drain-invisible and not cleared on defensive state re-init  [LOW / High]
`apps/web/src/lib/image-queue.ts:648` (claim-retry timer) and `:868` (processing-retry timer,
new in 02bea8d6): both `setTimeout(…).unref()` into bare local vars — neither is wrapped in
`trackQueueSideEffect` (unlike the embedding/side-effect tasks at :506/:784/:823) nor stored
on `state` (unlike `state.bootstrapRetryTimer` at :976 and `state.gcInterval`). Two
consequences: (1) on SIGTERM, `shutdownImageProcessingQueue()` drains the PQueue but a job
parked in its retry-backoff window is neither in the queue nor tracked, so it is dropped
(recoverable — the row stays `processed=false` and `bootstrapImageProcessingQueue()` re-enqueues
on next boot, so correctness holds; it is an availability/latency papercut, not data loss).
(2) The C2-33 re-init fix at `:360` now clears `existing.gcInterval` before replacing a
malformed state object, but the per-job retry timers are invisible to that path too — they
keep a closure over the stale job and fire once against nothing.
**Suggested direction:** store per-job retry timers on `state` (a `Set<Timeout>` or reuse the
side-effect tracker) so shutdown can drain/await or at least clear them, and so the C2-33
re-init clears them alongside `gcInterval`. Low urgency given bootstrap recovery, but it
closes the same leaked-timer class C2-33 just fixed for the GC interval.

### ARCH3-05 — migrate.js is a growing bespoke migrator diverging from stock drizzle tooling; each new branch rests on the same non-monotonic-journal compensation  [LOW / Medium — maintainability trend]
`apps/web/scripts/migrate.js` now carries: `getAllJournalMigrations` (per-entry hashing),
`prepareLegacyDatabaseIfNeeded` (fresh-install detect → cursor fast-path → mixed-case warn →
drift repair), `reconcileLegacySchema` (a hand-maintained parallel DDL of every table/column),
`baselineAllJournalMigrations`, and `runMigrations` post-condition. Every layer exists to
compensate for one root cause: the journal `when` timestamps are non-monotonic by design (idx-6
≈2026-05 → idx-7 ≈2025-05, a year backward; `_journal.json`), which poisons stock drizzle's
`MAX(created_at)` cursor. b4e986c3 added yet another cursor-dependent branch on top. Each branch
is *individually* test-guarded now (monotonicity, reconcile-coverage, pending-migrations,
silent-skip post-condition — a genuinely good safety net), so this is NOT a call for an urgent
redesign. But two structural debts are worth naming so they don't compound:
- **Latent DDL-only constraint:** the whole reconcile+baseline machinery is correct *only if
  migrations are DDL-only* (reconcile mirrors DDL; DML is the ARCH3-03 landmine). That
  constraint is real but undocumented as an invariant — it lives implicitly across three
  functions. Any contributor adding a DML migration is one drifted-DB deploy away from the
  ARCH3-03 silent skip.
- **Divergence from stock tooling:** `drizzle-kit migrate` / `npm run db:push` operate on the
  poisoned cursor and must never be used here; only `migrate.js` is safe. CLAUDE.md says so in
  prose, but nothing in the repo *prevents* a contributor reaching for stock tooling.
**Suggested direction (not this cycle):** the honest redesign is to stop compensating — rewrite
the journal `when` values to be monotonic once (a frozen-history migration of the metadata,
guarded by the existing hash baselining so no entry re-runs), which would let stock drizzle's
cursor work and let most of `prepareLegacyDatabaseIfNeeded` retire. Until then, at minimum
document "migrations MUST be DDL-only (reconcile mirrors DDL, not DML)" as a first-class
invariant next to the monotonicity rule.

### ARCH3-06 — `data.ts` (1860 LOC) is the read-layer god-module and single point of change for every public surface, and it also hosts process-local view-buffer state  [LOW / Medium — maintainability trend]
`apps/web/src/lib/data.ts` is the largest module in the repo (1860 lines; next are
`process-image.ts` 1829, `image-queue.ts` 1221). It mixes image detail/listing reads, topics,
tags, aliases, shared groups, smart-collection resolution, SEO settings, feed/sitemap queries,
the shared `tagNamesAgg` SQL fragment, AND the process-local `sharedGroupViewBuffer` mutable
state (`data.ts:18`, flushed from `instrumentation.ts` drain). Every `revalidate = 0` public
page imports from it, so it is both the read-path SPOF and a coordination-state owner. No
runtime import cycle exists (verified: `data-timeline.ts` and `search-enrichment-fields.ts`
import only a *type* from `data.ts`, erased at compile — no cycle), so this is purely a
change-blast-radius / cohesion concern, not a correctness one. It is accepted/known, but it is
now large enough that a mistake in one concern (e.g. the view buffer, or a select-field omission)
ships to every page.
**Suggested direction (opportunistic, not scheduled):** peel the clearly-separable concerns off
into siblings the way `data-timeline.ts` already was — feed/sitemap queries, shared-group view
buffering, and SEO settings are each self-contained and would shrink the SPOF without touching
the hot listing queries. Do it only when a cycle already touches the relevant concern (per the
C1-32 incremental-drainage policy), never as a big-bang refactor.

---

## Also examined, no material finding

- **3b8d05c8 /api CSP (ARCH-08 fix):** correct layer and correct scope. The catch-all `/(.*)`
  header rule and the new `/api/:path*` rule both match `/api/*` in prod but do not conflict
  (catch-all sets no CSP in prod; the API rule adds the minimal one). `default-src 'none';
  frame-ancestors 'none'; sandbox` is effectively inert on the actual `/api` payloads (OG PNGs,
  JSON, file downloads are subresources/non-interactive documents, not script-bearing HTML), so
  it is harmless defense-in-depth. Sound.
- **a4a2d250 malformed-`IMAGE_BASE_URL` CSP degrade:** correct availability fix — a bad runtime
  env var now degrades CDN images instead of 500-ing every request. Coherent with the per-request
  CSP build in `proxy.ts`.
- **Two backfill entry points (sidecar + in-app):** the shared persisted-column set is pinned by
  `__tests__/backfill-color-pipeline.test.ts` and the detection-failure contract by
  `admin-backfill-runner-detection-failure.test.ts`; the duplication is test-managed, not
  drifting. (The ONE divergence is ARCH3-02's cached-vs-uncached config read — reported there.)
- **Three OG-sanitize consumers:** `og-sanitize.ts` is imported by exactly the three documented
  consumers (`api/og/route.tsx`, `api/og/photo/[id]/route.tsx`, `p/[id]/page.tsx`) and pinned by
  `__tests__/sanitize-for-og-global.test.ts`. One shared sanitizer, no drift.
- **Module graph / cycles:** no runtime import cycle into the read layer (data.ts consumers use
  type-only imports back). `server-only` + `*-shared.ts` client/server split remains clean.
- **Single-writer drain wiring:** `stopSingleWriterGuard()` is correctly inside the shutdown
  `Promise.all` (`instrumentation.ts`); the fire-and-forget start races only harmlessly with an
  immediate SIGTERM (process is exiting anyway).

## Final sweep
Covered: all four priority-1 commits (single-writer guard, /api CSP, image-queue hardening,
migrate.js FDR-01) with a concrete verdict each; full structural pass over module graph, cyclic
deps, the two duplicated-logic pairs, process-local state, config precedence, migrate machinery,
cache-invalidation layering, and scanner accretion. Highest-value new items: **ARCH3-01**
(the guard's detection decays at `wait_timeout`) and **ARCH3-02** (missed detached-config
sibling with no gate). ARCH3-03/04/05/06 are lower-severity traps/trends worth scheduling per the
incremental-drainage policy. Predecessor ARCH-04/05/08 are confirmed closed by cycle-2 and not
re-reported; ARCH-03/06 remain correctly deferred (C2-24b/C2-27).

Commonly-missed check performed: verified the guard's connection has no keepalive (options helper
lacks it; TCP keepalive would not help anyway), verified migrations are DDL-only except 0001,
verified the cached/uncached config accessors are the same underlying function, and verified no
runtime cycle exists behind the type-only data.ts imports.
