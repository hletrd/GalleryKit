# Run-10 Cycle 5 — Architect lane review (2026-07-07)

Start HEAD `d9bcbf4c`, branch `master`. Scope: module boundaries / coupling, lifecycle
ownership (startup+shutdown ordering), single-writer/single-process assumptions, data-layer
discipline, client effect coupling. Read for context first: CLAUDE.md (Runtime topology,
Race Condition Protections, Performance), `deferred-carry-forward.md`, and the cycle-4
aggregate (C4-01..C4-47). Findings below are NEW signal unless explicitly folding into an
existing id. The headline deliverable is the concrete **C4-17** extraction proposal (A5-01).

Files read in full or in load-bearing part: `instrumentation.ts`, `lib/image-queue.ts`
(all 1345 lines), `lib/single-writer-guard.ts`, `lib/background-db-writes.ts`,
`lib/queue-shutdown.ts`, `lib/data.ts` (view-count scheduler + select-field discipline),
`lib/admin-backfill-runner.ts` (state + concurrency budget), `lib/restore-maintenance*.ts`,
`db/schema.ts` (indexes + embeddings PK).

---

## Summary (top of file for the chat digest)

The cycle-4 lens on C4-17 ("retention sweeps are parasitic on the image-queue's `gcInterval`")
is correct but **understated**: retention/GC is gated behind THREE unrelated preconditions —
DB reachable at boot, restore-maintenance inactive, AND the queue bootstrap `SELECT` succeeding
— none of which is retention's real dependency (wall-clock time). A stale restore marker or an
extended boot-time DB outage silently disables ALL four retention sweeps indefinitely. The root
cause is a **lifecycle-ownership asymmetry** (A5-02): `instrumentation.ts` enumerates 4
subsystems by name at *shutdown* but only 2 at *startup*; the rest self-arm implicitly, so a
5th background concern has no registry to join and gets forgotten (retention already was).
Two more NEW couplings: the DAL (`data.ts`) owns a process-lifetime scheduler+timer it never
should (A5-03), and the pool-budget reservation policy is verbatim-duplicated across the two
runners (A5-04).

**NEW-finding counts:** 1 MED-HIGH-mechanism (A5-01, the scheduled C4-17 work), 3 MED
(A5-02, A5-03, A5-04), 2 LOW (A5-05, A5-06). Plus 2 status confirmations on C4-16 and the
single-writer guard.

**C4-17 recommendation: SCHEDULE THIS CYCLE.** Extract `lib/maintenance-scheduler.ts` with
`startMaintenanceScheduler()` / `stopMaintenanceScheduler()` owned by `instrumentation.ts`,
armed unconditionally at boot (independent of queue bootstrap and DB reachability), self-healing
on DB outage via its own interval. Concrete shape in A5-01. Low blast radius, high correctness
payoff, and it also drains ~30 lines of the image-queue god-object (partial C4-16 progress).

---

## A5-01 — [C4-17, SCHEDULED] Retention/GC is triple-gated behind the image-queue bootstrap

**Confidence: High. Confirmed.** Sev: MED-HIGH mechanism / Med reachability.

**Location:**
- `lib/image-queue.ts:1244-1274` — the one-shot startup purge (`if (!bootstrapCleanupRun)`)
  AND the hourly `gcInterval` arming (`if (!state.gcInterval)`) both live inside
  `bootstrapImageProcessingQueue`'s success path, after the pending-images `SELECT`.
- `lib/image-queue.ts:1119` — bootstrap early-returns when `isRestoreMaintenanceActive()`.
- `lib/image-queue.ts:1275-1282` — on any thrown error (incl. `ECONNREFUSED`) the catch
  schedules a bootstrap retry but arms NEITHER the purge NOR the interval.
- `instrumentation.ts:7-8` — `bootstrapImageProcessingQueue()` is awaited exactly once at boot.

**Design risk.** The four retention sweeps (`purgeExpiredSessions`, `purgeOldBuckets`,
`purgeOldAuditLog`, `purgeOldViewEvents`) and the hourly cadence that drives them are
armed *as a side effect of the image queue discovering pending uploads*. Their true
dependency is wall-clock time, but they are transitively gated on three unrelated conditions:

1. **DB reachable at boot** — if MySQL is down when `register()` runs, bootstrap throws,
   the catch reschedules, and until a bootstrap batch *succeeds* the `gcInterval` is never
   armed. Retention does eventually start once the DB returns (the retry re-enters the
   success path), so this one self-heals — but only via the queue's retry, not retention's own.
2. **Restore-maintenance inactive** — `bootstrapImageProcessingQueue` early-returns at
   `:1119` when the durable restore marker is set. If a crashed restore leaves a **stale
   marker** (the documented `restore:maintenance clear` recovery was not run), the awaited
   boot bootstrap early-returns, `gcInterval` never arms, and there is no re-trigger except
   `resumeImageProcessingQueueAfterRestore` (only called at the end of a *successful* restore).
   Net: a stale marker disables ALL retention indefinitely, silently, while the app otherwise
   serves reads fine. This is not hypothetical — the CLAUDE.md "Restore-maintenance recovery"
   section documents that stale markers happen and must be manually cleared.
3. **Queue bootstrap `SELECT` succeeding** — any non-ECONNREFUSED throw in the pending
   query path (e.g. a transient `ER_LOCK_WAIT_TIMEOUT`, a schema-drift error) also skips the
   arming for that pass.

Why it matters concretely: `purgeOldViewEvents` is the growth bound on the anonymous,
per-IP-only-limited `*_views` tables on the single MySQL writer (CLAUDE.md schema note,
AGG-H2). Silently disabling it lets those tables grow unbounded for the entire duration of a
stale marker or boot outage — the exact class of unbounded-growth failure the sweep exists to
prevent. The audit-log and session sweeps have the same property.

**Suggested refactor shape — concrete C4-17 extraction.**

New file `apps/web/src/lib/maintenance-scheduler.ts`:

```ts
// Owns the process-lifetime retention/GC cadence. Deliberately independent of
// the image queue, DB reachability at boot, and restore-maintenance state:
// its sweeps are wall-clock GC, not queue work. Each sweep already no-ops or
// logs-and-continues on its own errors, so a DB outage degrades to "this tick
// did nothing" instead of "retention is disabled until something else reboots
// the queue."
import { purgeExpiredSessions } from '@/lib/image-queue'; // or move the fn here
import { purgeOldBuckets } from '@/lib/rate-limit';
import { purgeOldAuditLog } from '@/lib/audit';
import { purgeOldViewEvents } from '@/lib/view-retention';

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const schedulerKey = Symbol.for('gallerykit.maintenanceScheduler');
type SchedulerState = { interval?: ReturnType<typeof setInterval>; startupRun: boolean };

function runSweeps(): void {
    // fire-and-forget; each purge owns its own try/catch + debug log
    purgeExpiredSessions().catch(() => {});
    purgeOldBuckets().catch(() => {});
    purgeOldAuditLog().catch(() => {});
    purgeOldViewEvents().catch(() => {});
}

export function startMaintenanceScheduler(): void {
    const g = globalThis as typeof globalThis & { [schedulerKey]?: SchedulerState };
    const s = (g[schedulerKey] ??= { startupRun: false });
    if (!s.startupRun) { s.startupRun = true; runSweeps(); } // immediate one-shot
    if (!s.interval) {
        s.interval = setInterval(runSweeps, MAINTENANCE_INTERVAL_MS);
        s.interval.unref?.();
    }
}

export function stopMaintenanceScheduler(): void {
    const g = globalThis as typeof globalThis & { [schedulerKey]?: SchedulerState };
    const s = g[schedulerKey];
    if (s?.interval) { clearInterval(s.interval); s.interval = undefined; }
}
```

Ownership + wiring:
- `instrumentation.ts` calls `startMaintenanceScheduler()` **unconditionally** right after
  `syncRestoreMaintenanceFromDurable()`, BEFORE (and independent of)
  `bootstrapImageProcessingQueue()`. Add `stopMaintenanceScheduler()` to the
  `Promise.all([...])` drain list in `gracefulShutdown` (alongside the existing four).
- Delete the `bootstrapCleanupRun` module boolean, the `if (!bootstrapCleanupRun)` block
  (`:1245-1255`), and the `if (!state.gcInterval)` block (`:1256-1274`) from `image-queue.ts`.
  `pruneRetryMaps(state)` (the only queue-coupled item in the hourly tick) either stays on
  the queue via a tiny queue-owned interval or is passed to the scheduler as an optional
  callback — keep it OUT of the generic scheduler so the scheduler has no queue dependency.
- Remove `gcInterval` from `ProcessingQueueState` and from `QueueShutdownStateLike`
  (`queue-shutdown.ts:12`), plus the two `clearInterval(existing.gcInterval)` defensive sites
  in `getProcessingQueueState` (`:426-428`) and `drainProcessingQueueForShutdown` (`:27-30`).
  This is the C4-16 drainage dividend: ~4 state fields/branches leave the god-object.

Result: retention depends only on the process being alive, self-heals per-tick on DB
outage, and survives a stuck queue bootstrap or a stale restore marker. Lock this with a test
that (a) calls `startMaintenanceScheduler()` with a mocked-down DB and asserts the interval is
still armed, and (b) asserts `bootstrapImageProcessingQueue` no longer arms any interval.

---

## A5-02 — [NEW] Asymmetric startup/shutdown lifecycle coordinator (root cause of C4-17)

**Confidence: High. Confirmed.** Sev: MED.

**Location:** `instrumentation.ts:1-107` vs the four subsystem modules.

**Design risk.** `gracefulShutdown` (`:51-57`) enumerates FOUR subsystems by name —
`shutdownImageProcessingQueue`, `flushBufferedSharedGroupViewCounts`, `drainBackgroundDbWrites`,
`stopSingleWriterGuard`. But startup enumerates only TWO explicitly
(`bootstrapImageProcessingQueue`, `startSingleWriterGuard`). The others are *implicit*:
- retention/GC self-arms inside queue bootstrap (A5-01),
- the `data.ts` view-count flush timer self-arms on the first buffered view (A5-03),
- `background-db-writes` has no timer, only a drained Set.

There is no single registry that both the start path and the stop path consult. The concrete
failure this shape produces has already happened: retention was silently welded onto the queue
bootstrap because there was no "here is where background subsystems are started" seam to add it
to. The next background concern (a future embedding-recompute cadence, a cache warmer, a
metrics flusher) faces the same fork — either hand-edit the shutdown `Promise.all` and find
some existing success path to self-arm from, or be forgotten on one side. Shutdown and startup
drifting out of sync is a *when*, not an *if*.

**Suggested refactor shape.** Introduce a minimal lifecycle registry that both paths consult,
e.g. `lib/lifecycle.ts` exposing `registerSubsystem({ name, start?, stop? })` and
`startAllSubsystems()` / `stopAllSubsystems(timeoutMs)`. Each subsystem module registers itself
at import time (queue, maintenance-scheduler from A5-01, single-writer-guard, view-count buffer
from A5-03, background-db-writes). `instrumentation.register()` becomes: sync durable marker →
assert paths → `startAllSubsystems()`; `gracefulShutdown` becomes the timed
`stopAllSubsystems(15_000)`. This is a larger change than A5-01 and can be **staged**: land
A5-01 first (it is self-contained and high-value), then adopt the registry when the 5th
subsystem lands (natural exit criterion). Recommend: schedule A5-01 now, DEFER A5-02 with exit
criterion "the next background subsystem is added, OR a startup/shutdown enumeration drift bug
lands." Flag it explicitly in the deferred register so it is not re-forgotten.

---

## A5-03 — [NEW] The data-access layer owns a process-lifetime scheduler (layering violation)

**Confidence: High. Confirmed.** Sev: MED.

**Location:** `lib/data.ts:13-222` — `viewCountBuffer` (`:18`), `viewCountRetryCount` (`:27`),
`viewCountFlushTimer` (`:34`), `consecutiveFlushFailures` (`:41`), `getNextFlushInterval`,
`bufferGroupViewCount`, `flushGroupViewCounts`, `isFlushing`/`currentFlushPromise`,
`flushBufferedSharedGroupViewCounts`.

**Design risk.** `data.ts` is described in CLAUDE.md as the "Data access layer with React
cache() deduplication" — a request-scoped, side-effect-light query module. It also contains a
**self-arming background scheduler**: mutable module-scoped `let` state, a `setTimeout` loop
with exponential backoff, a bounded retry Map, an atomic Map-swap drain, and a shutdown hook.
This is a different *kind* of code than the other ~40 exported query functions, and it violates
the layering the file name advertises. Two concrete consequences:

1. **Lifecycle invisibility.** This timer is the only background scheduler in the codebase with
   NO explicit start — it materializes on the first `bufferGroupViewCount()` call and is only
   ever *stopped* by the implicit unref + a shutdown flush. It is exactly the kind of subsystem
   A5-02 says the coordinator can't see. `flushBufferedSharedGroupViewCounts` (`:222`) does not
   even clear `viewCountFlushTimer`; it relies on `.unref()` so the timer can't hold the loop
   open, which is correct-by-luck rather than owned.
2. **God-module accretion.** This is the same drift C3-36 flags for `data.ts` query concerns,
   but it is a *distinct* concern (scheduler, not query). Any future contributor grepping
   `data.ts` for a query has to scroll past 200 lines of view-count scheduler state first, and
   a change to the buffer's backoff/retry semantics is reviewed in the same file as the SEO
   settings fallback and the masonry `tagNamesAgg` contract.

**Suggested refactor shape.** Extract to `lib/view-count-buffer.ts` exporting
`bufferGroupViewCount(groupId)` and `flushBufferedSharedGroupViewCounts()` (verbatim move;
keep the C2-F01 atomic-swap and R14-01 currentFlushPromise semantics intact — they are
load-bearing and tested). `data.ts` re-exports `flushBufferedSharedGroupViewCounts` for the
`instrumentation.ts` import path if you want to avoid touching the shutdown wiring, or
`instrumentation.ts` imports the new module directly. Once A5-02's registry exists, the new
module registers its own `stop` (clear the timer). This peels ~200 lines off the 1860-line
`data.ts` and removes the only "DAL owns a timer" wart. Low risk — it's a mechanical move of a
self-contained, already-tested cluster.

---

## A5-04 — [NEW] Pool-budget reservation policy is verbatim-duplicated across the two runners

**Confidence: High. Confirmed.** Sev: MED (correctness-drift latent).

**Location:**
- `lib/image-queue.ts:125-139` — `IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS = max(3, ceil(pool/2))`,
  then `resolveImageQueueConcurrency` cap `= max(1, floor((limit - reserved) / 2))`.
- `lib/admin-backfill-runner.ts:105-142` — `BACKFILL_RESERVED_LIVE_CONNECTIONS = max(3,
  ceil(pool/2))` (byte-identical body), then `resolveBackfillConcurrency` cap `= max(1,
  floor((limit - reserved - 1) / 2))`.

**Design risk.** The reservation policy — "reserve ≈ half the pool (≥ one full `getImage`
fan-out) for live request traffic" — is encoded in **two** modules with a byte-identical
`RESERVED` function and two *nearly*-identical cap formulas that differ only by a `- 1` (the
backfill subtracts the whole-run advisory-lock connection; the queue folds its per-worker claim
lock into the "2 connections per worker" term). Nothing links them: `POOL_CONNECTION_LIMIT`
flows from `@/db` into both independently, and the shared "half the pool" constant `2` and the
floor `3` are re-typed in each. If an operator raises the pool size, or the pool's reservation
policy is retuned (e.g. to reserve a fixed count instead of half), a maintainer editing one
runner will very plausibly miss the other, and the two background consumers of the *same shared
10-connection pool* would then disagree about how much they may take — the precise scenario that
starves live traffic (the whole reason the cap exists, per the AGG-5 comment at
`admin-backfill-runner.ts:122-124`). The `-1` discrepancy also already reads like an accidental
divergence to a reviewer (it is intentional, but nothing says so at either site).

**Suggested refactor shape.** New `lib/pool-budget.ts`:

```ts
export const reservedLiveConnections = (poolLimit: number): number =>
    Math.max(3, Math.ceil(poolLimit / 2));

// workerConnections = connections a single worker can hold at once (queue:2, backfill:2)
// pinnedConnections = run-lifetime connections outside the worker pool (backfill lock:1, queue:0)
export function resolveWorkerConcurrency(
    requested: number, poolLimit: number,
    { workerConnections = 2, pinnedConnections = 0 } = {},
): number {
    const limit = Number.isFinite(poolLimit) ? poolLimit : DEFAULT_POOL_LIMIT;
    const reserved = reservedLiveConnections(limit);
    const cap = Math.max(1, Math.floor((limit - reserved - pinnedConnections) / workerConnections));
    return Math.min(Math.max(1, Math.floor(requested) || 1), cap);
}
```

Queue calls it with `pinnedConnections: 0`, backfill with `pinnedConnections: 1`. The `-1`
divergence becomes an explicit, documented parameter instead of a silent formula difference,
and the reservation policy lives once. Keep both existing exported names as thin wrappers so the
current tests (`resolveImageQueueConcurrency` / `resolveBackfillConcurrency`) and CLAUDE.md
references stay valid. This can ride the next queue- or backfill-touching cycle; low urgency,
but it is a genuine single-source-of-truth gap on a scale-sensitive budget.

---

## A5-05 — [NEW, LOW] The globalThis-Symbol-with-read-time-migration idiom is copied 4×

**Confidence: High. Confirmed.** Sev: LOW.

**Location:** `image-queue.ts:378-462` (`getProcessingQueueState`),
`admin-backfill-runner.ts:221-303` (`getState`), `restore-maintenance.ts:1-20`
(`getRestoreMaintenanceState`), and the maintenance-scheduler A5-01 would add a 5th.

**Design risk.** Four modules independently implement the same pattern: state persisted on a
`Symbol.for(...)` global (to survive Next HMR / module re-eval), a getter that validates the
existing object's shape, and — for the two big ones — **read-time field backfilling** for
fields added after the shape was first persisted (`image-queue.ts:400-413` backfills
`sideEffects`, `retryTimers`, `embeddingScanCursorId`, `embeddingScanModelVersion`;
`admin-backfill-runner.ts:245-249+` backfills `processed`, `errors`, `skipped*`, ...). Every new
field on either state object obligates a new `??=`/`instanceof` branch in the getter, forever;
miss it and an older persisted object returns `undefined` for the field (the exact class of bug
the `retryTimers`/`embeddingScan*` backfills were retroactively added to fix). This is the
read-migration tax of the god-objects (C4-16) generalized across modules.

**Suggested refactor shape.** A shared `lib/global-singleton.ts`:
`getGlobalSingleton<T>(key: symbol, factory: () => T, migrate?: (existing: unknown) => T | null)`
that centralizes the "validate → migrate → or rebuild" flow. Each state module supplies its
factory + a migrate function; the boilerplate (symbol read, `typeof === 'object'` guard, rebuild
on invalid) lives once. This does NOT eliminate the per-field migration obligation (that is
inherent to persisting mutable shape across reloads) but it makes the pattern one reviewed
implementation instead of four subtly-different ones (note `restore-maintenance` doesn't validate
at all, `image-queue` validates value-types since R12C12 AGG-R12-11, `admin-backfill-runner`
validates presence). DEFER with exit criterion "next state-shape field is added to either god
state object, OR a 5th globalThis-symbol store lands (A5-01 is one)."

---

## A5-06 — [NEW, LOW] `bootstrapCleanupRun` module-scope vs `gcInterval` state-scope mismatch

**Confidence: High. Confirmed.** Sev: LOW. (Folds into A5-01's fix — noted for completeness.)

**Location:** `image-queue.ts:104` (`let bootstrapCleanupRun = false`, module scope) vs
`ProcessingQueueState.gcInterval` (state scope), both consumed at `:1245` / `:1264`.

**Design risk.** The one-shot startup purge is guarded by a MODULE boolean while the hourly
interval is guarded by a STATE field. The defensive re-init in `getProcessingQueueState`
(`:426-428`) clears and rebuilds `state.gcInterval` when it replaces a malformed state object —
so after a state replacement the interval RE-arms on the next bootstrap, but `bootstrapCleanupRun`
stays `true` forever, so the immediate one-shot purge never re-runs. The two halves of "startup
retention" therefore have different lifetimes across a state rebuild. Impact is small (the hourly
interval still covers it within an hour), but the inconsistency is a latent trap. A5-01 removes
both guards entirely (the scheduler owns a single `startupRun` flag on its own state), which is
the clean fix — calling it out so the A5-01 implementer deletes `bootstrapCleanupRun` rather than
carrying it.

---

## Status confirmations (not new findings; recorded so they are not re-derived)

- **C4-16 (image-queue god-object) — still open, and A5-01 makes concrete progress on it.**
  `ProcessingQueueState` remains a 17+-field object with reset obligations spread across
  `getProcessingQueueState` re-init, `quiesceImageProcessingQueueForRestore` (`:1313-1331`),
  `shutdownImageProcessingQueue`, and `drainProcessingQueueForShutdown`. The cleanest
  incremental drain is exactly A5-01 (retention/`gcInterval` leave the object). The
  {durable|transient} partition the C4-16 exit criterion asks for is still the right end state;
  A5-01 is a down-payment, not a substitute. Keep C4-16 open.

- **Single-writer guard (C4-06) — the cycle-4 self-healing re-acquire is architecturally sound
  on read.** `single-writer-guard.ts:130-216` now warns-once + schedules an unref'd 60s
  re-acquire loop; the `stopping` latch (`:59,168,177,185,190,240,246`) blocks post-stop
  ownership on all three timer paths (keepalive, reprobe, reacquire). One residual **Needs-
  validation** observation (NOT re-reporting C4-06): the guard's re-acquire loop and the
  view-count/queue subsystems are still four independent module-scoped timer owners — this is
  the A5-02 generalization, not a guard-specific defect. No new guard bug found.

- **Data-layer select-field discipline — clean.** `adminSelectFieldKeys` /
  `publicSelectFieldKeys` / `publicMapSelectFieldKeys` (`data.ts:446-472`) plus the
  `PrivacySensitiveKeys` compile-time guard remain the enforcement seam; no leakage path found.
  `image_embeddings.imageId` is the PRIMARY KEY (`schema.ts:285`), so the missing-embedding
  anti-join (`image-queue.ts:578-593`) uses the PK for the `imageId` half of its join predicate —
  fine for the current one-row-per-image model. NOTE this PK-on-imageId-only is precisely what
  the deferred multi-model migration (C4-10 / C88-03) must change; not double-reporting, just
  confirming the coupling is real and already tracked.

- **Schema index coverage vs access patterns — no new gap.** The composite indexes
  (`schema.ts:118-121`, `236-266`) match the documented listing/analytics/retention scans; the
  two open index deferrals (C2-16 home-latency, C2-21 `(processed, updated_at, id)`) are still
  the only outstanding ones and I did not find a third.

---

## Deferred-register deltas this lane recommends

- **A5-01 (C4-17): SCHEDULE this cycle.** Concrete extraction above; low blast radius.
- **A5-02:** DEFER — exit: next background subsystem OR a start/stop drift bug. Record so the
  lifecycle asymmetry is tracked rather than rediscovered.
- **A5-03:** DEFER or fold into A5-01's PR — mechanical move of the view-count scheduler out of
  the DAL; exit: any `data.ts`-touching or view-count-touching cycle.
- **A5-04:** DEFER — exit: next queue- or backfill-concurrency-touching cycle (extract
  `pool-budget.ts`).
- **A5-05:** DEFER — exit: next state-shape field on either god state object.
- **A5-06:** absorb into A5-01 (delete `bootstrapCleanupRun`); no standalone row needed.
