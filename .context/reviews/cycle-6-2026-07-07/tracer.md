# rev-tracer-2 review — cycle 6

## Summary

This repo's tracer lane has already run 5 deep cycles this run (cycle-1 through cycle-5,
`.context/reviews/cycle-{1..5}-2026-07-07/tracer.md`), covering upload→process→serve,
delete-while-processing, session/auth/proxy, topic-rename, service-worker LRU, migrate.js,
and the single-writer guard in detail — several of those findings are already fixed (e.g.
C1-04 claim-exhaustion persistence). To avoid retreading that ground, this cycle
concentrated on the restore-maintenance drain sequence (an area only lightly touched
before, via TRC-05's lock-ordering-message finding) and the login rate-limit internals
(only the X-Forwarded-For/LB angle was previously traced). One new MED-severity,
HIGH-confidence finding: the restore flow's `drainBackgroundDbWritesForRestore()` call has
no timeout, unlike its two sibling drain calls in the same function AND unlike the *same
underlying function* called from the graceful-shutdown path (which wraps it in a 15s
`Promise.race`). Two hypotheses were investigated and refuted with direct evidence
(restore-quiesce vs. stale-job/id-reuse; account rate-limit case-variation bypass) — both
recorded below because the evidence is new even though the conclusion is "no bug." One
previously-known finding (TRC-03, cycle-2: delete racing the original-file read) gets a
small amount of new evidence.

Severity/confidence counts for NEW findings: **1 MED/High, 1 LOW/Medium, 1 LOW/Low**
(F1, F2, F3 below). No CRIT or HIGH findings this cycle.

## Findings

### F1 — `drainBackgroundDbWritesForRestore()` in the restore flow has no timeout, unlike its two sibling drains and unlike the same function's OTHER caller (graceful shutdown)  [SEV: MED | CONF: High | apps/web/src/app/[locale]/admin/db-actions.ts:540-563, apps/web/src/lib/background-db-writes.ts:76-81, apps/web/src/instrumentation.ts:44-56]

**The problem.** `restoreDatabase()` runs four "quiesce the world" steps before importing the
dump:

```
await flushBufferedSharedGroupViewCounts();      // data.ts — no timeout
await quiesceImageProcessingQueueForRestore();   // image-queue.ts — internally bounded by
                                                  // real encode work via queue.onIdle(), no
                                                  // explicit timeout either, but self-limiting
imageQueueQuiesced = true;
await drainBackgroundDbWritesForRestore();       // background-db-writes.ts — NO TIMEOUT
const maintenanceDrained = await drainMaintenanceSweepsForRestore();   // 5s timeout, aborts on false
if (!maintenanceDrained) { ...; return { success: false, error: t('restoreFailed') }; }
const mutationsDrained = await drainAdminMutationsForRestore();       // 30s timeout, aborts on false
if (!mutationsDrained) { ...; return { success: false, error: t('restoreFailed') }; }
```

(`db-actions.ts:540-563`.) `drainMaintenanceSweepsForRestore` (`maintenance-scheduler.ts:56-67`)
and `drainAdminMutationsForRestore` (`admin-mutation-barrier.ts:102-130`) both race their drain
against an explicit timer and return `false` on timeout, which the caller treats as a hard abort
(`restoreFailed`, releasing all locks). `drainBackgroundDbWrites` (aliased as
`drainBackgroundDbWritesForRestore`, `background-db-writes.ts:76-81`) has no such race:

```ts
export async function drainBackgroundDbWrites() {
    while (backgroundDbWrites.size > 0 || analyticsDbWrites.size > 0 || analyticsQueue.length > 0) {
        pumpAnalyticsQueue();
        await Promise.allSettled([...backgroundDbWrites, ...analyticsDbWrites]);
    }
}
export const drainBackgroundDbWritesForRestore = drainBackgroundDbWrites;
```

This loop only terminates once every tracked promise settles. If a single queued analytics
write (e.g. a view-count record from `public.ts`, tracked via `trackAnalyticsDbWrite`) never
resolves — a stalled MySQL connection, a metadata-lock wait, a network partition to the DB —
this `await` blocks forever. `ANALYTICS_DB_WRITE_MAX_PENDING = 1000` at concurrency 2 means the
queue can legitimately be deep at the moment an admin starts a restore during a traffic spike,
widening the exposure window even without a genuine hang.

**Evidence this asymmetry is not intentional.** The *exact same* `drainBackgroundDbWrites`
function is also called from `gracefulShutdown` in `instrumentation.ts:44-56`, and there it
*is* correctly bounded:

```ts
await Promise.race([
    Promise.all([
        shutdownImageProcessingQueue(),
        flushBufferedSharedGroupViewCounts(),
        drainBackgroundDbWrites(),
        stopSingleWriterGuard(),
    ]).then(() => { completed = true; }),
    shutdownTimeout,   // 15s, unref'd, forces exit with process.exitCode = 1
]);
```

The shutdown path proves the author is aware this drain needs a ceiling and applied one there;
the restore path calls the identical function directly with no ceiling.

**Concrete failure scenario.** An admin triggers a restore while a DB hiccup (lock wait, replica
lag if MySQL is remote, transient network stall) has one analytics write stuck mid-query. The
restore action has already: acquired the DB-restore, upload-processing-contract, color-pipeline-
backfill, and semantic-embedding-backfill advisory locks (each pinning a connection off the
10-connection pool), set the durable restore-maintenance marker (blocking every admin mutation
and all uploads site-wide), and paused/cleared the image-processing queue. It now hangs
indefinitely inside `drainBackgroundDbWritesForRestore()`. The browser/HTTP request will likely
time out client-side (or at any reverse-proxy `proxy_read_timeout`), but the server-side
`restoreDatabase()` invocation keeps running — nothing aborts it — so the locks and the durable
marker stay held until either the stuck write resolves on its own or an operator restarts the
container and runs the documented `restore:maintenance clear --confirm-clear-restore-maintenance`
recovery command. Because this hang occurs *before* `runRestore()` (the actual dump import) is
ever called, there is no partial-import data-corruption risk — this is a pure availability/
liveness bug, not a correctness one, but it can wedge uploads, processing, and admin mutations
site-wide for an unbounded time with no operator-visible signal beyond the request silently never
returning.

**Suggested fix.** Wrap `drainBackgroundDbWritesForRestore()` (and, ideally,
`flushBufferedSharedGroupViewCounts()` and the `queue.onIdle()` half of
`quiesceImageProcessingQueueForRestore()`, which share the same unbounded-await shape, just with
smaller/self-limiting exposure) in the same `Promise.race(..., timeout)` pattern already used for
both `drainMaintenanceSweepsForRestore` and `drainAdminMutationsForRestore` — and for this same
function at the shutdown call site. On timeout, treat it the same way the other two drains are
treated: abort the restore, release all locks, return `restoreFailed`, rather than hanging.

**Residual uncertainty:** whether a genuine indefinite query hang (vs. a slow-but-finite one) is
realistic depends on the MySQL driver's own connection/query timeout configuration, which I did
not trace (out of scope: `mysql-connection-options.ts`/pool config). If `mysql2` is configured
with a connection or statement timeout, a "hang" would eventually surface as a rejected promise
(which `Promise.allSettled` already tolerates) rather than truly blocking forever, which would
lower this from "can hang forever" to "can hang for the configured timeout duration" — still an
asymmetry worth fixing, but with a bounded (if not proven) worst case. Next probe: check the pool
options for `connectTimeout`/`enableKeepAlive` and whether any statement-level timeout exists.

---

### F2 (minor, largely defused) — the permanent-processing-failure `processing_error` UPDATE lacks the `processed = false` guard every sibling UPDATE in the same file uses  [SEV: LOW | CONF: Medium | apps/web/src/lib/image-queue.ts (permanent-failure catch branch, ~line 1028 in the working tree)]

**Hypothesis:** after `MAX_RETRIES` processing failures, the queue job persists the error via:

```ts
await db.update(images)
    .set({ processing_error: truncatedError, failed_at: toMySqlDateTime(new Date()) })
    .where(eq(images.id, job.id));
```

— filtered on `id` alone. Every *other* mutating UPDATE in this file guards with
`and(eq(images.id, job.id), eq(images.processed, false))` (the "mark processed" update, and the
claim-exhaustion error-persist branch). If a stale, closure-captured `job.id` from a job that
started before an event could fire this UPDATE against a *different, already-successful* row
that later reused the same auto-increment id, it would stamp a bogus `processing_error`/
`failed_at` onto a healthy, already-processed image. AUTO_INCREMENT id reuse is not a
theoretical concern here — the codebase's own `C2-HIGH-01` comment (`images.ts:708-711`,
`:826-829`) explicitly acknowledges "stale IDs... after a DB restore" as a real trigger (a
mysqldump restore resets the auto-increment counter to its dump-time value, so ids deleted after
the dump can be reissued to new uploads once restored).

**Evidence against (why this is NOT currently exploitable):** `quiesceImageProcessingQueueForRestore()`
(`image-queue.ts:1251-1298`) is invoked as part of the restore's pre-import drain sequence
(`db-actions.ts:543-544`), *before* `runRestore()` ever imports the dump. It: pauses + clears +
awaits `onIdle()` on the PQueue (so every actively-running job, including one about to hit this
exact catch branch, finishes — and therefore this UPDATE, if it fires, writes into the *pre-restore*
database that is about to be replaced anyway); drains all un-awaited caption/embedding side
effects; and — critically — calls `clearTrackedRetryTimers(state)`, which cancels every scheduled
claim-retry/processing-retry `setTimeout` so no stale job can re-enter `enqueueImageProcessing`
and reach a *fresh* execution of this catch branch after the restore completes. New enqueues are
also rejected throughout (`isRestoreMaintenanceActive()` gate). So the one realistic id-reuse
trigger this codebase has (restore) is already closed off for this code path by the quiesce
sequence — I could not construct a live scenario where this UPDATE lands on a wrong row.

**Residual uncertainty / why still worth a LOW-severity note:** (1) it's a real inconsistency with
every sibling UPDATE in the same file, which is the kind of drift that becomes a live bug the next
time someone adds a new id-reuse trigger (e.g. an operator manually running
`ALTER TABLE images AUTO_INCREMENT = N`, which is unsupported but not preventable) without
re-auditing every UPDATE for the `processed = false` guard; (2) it costs nothing to add the guard
defensively, matching the file's own established pattern. Suggested fix: add
`and(eq(images.id, job.id), eq(images.processed, false))` to this UPDATE for consistency, purely
as defense-in-depth — no urgency, no known live trigger.

**Note on prior coverage:** this is a distinct code detail from `TRC-03` (cycle-2,
`.context/reviews/cycle-2-2026-07-07/tracer.md:63-85`), which examined `deleteImage`/`deleteImages`
racing the per-image processing claim and the original-file-unlink-during-Sharp-read question.
`TRC-03`'s "next probe" about NFS unlink-of-open-file semantics remains unresolved by static
tracing (still a real, if narrow, residual per that finding). One additional piece of evidence for
that finding, found while re-tracing this area: the WI-14 change (a fresh `sharp()` instance per
format, replacing a single shared decoded instance reused across formats) mechanically *widens*
the unlink race relative to the pre-WI-14 shape — instead of one `open()` on the original file for
the whole encode, there are now (at least) 3 independent `open()` calls (webp/avif/jpeg), each a
fresh opportunity for `ENOENT` if `deleteOriginalUploadFileStrict` unlinks between them. The window
is still narrow in the common case (Promise.all fires all three `generateForFormat` calls together,
so the three opens cluster within roughly the same tick), but it widens meaningfully on the WI-15
wide-gamut downscale path (`process-image.ts:1117-1144`), which does a full extra read+write to a
temp intermediate *before* the three-format fan-out even starts — for a 50MP+ wide-gamut source
this can add real wall-clock time (plausibly hundreds of ms to low seconds) during which
`deleteImage()`'s unsynchronized original-file unlink could land. This doesn't change TRC-03's
conclusion (the eventual on-disk state is still correct, per the affectedRows=0 cleanup path), but
it does mean the practical race window for hitting whatever the true unlink-during-read behavior
is on the deployment's filesystem is somewhat wider post-WI-14 than before it.

---

### F3 (minor) — DB-backed login rate limit uses aligned fixed windows; the in-memory fast-path uses idle-gap reset; the two semantics diverge exactly at process-restart-near-a-window-boundary  [SEV: LOW | CONF: Medium | apps/web/src/lib/rate-limit.ts:441-474, apps/web/src/app/actions/auth.ts:104-170]

**Hypothesis:** two different reset semantics govern the "same" rate limit. The in-memory map
(`getLoginRateLimitEntry`, `auth-rate-limit.ts:26-34`) resets a bucket only when
`now - entry.lastAttempt > LOGIN_WINDOW_MS` — an *idle-gap* reset: as long as attempts keep
arriving less than one window apart, the count never resets, no matter how much *total* time has
elapsed since the first attempt. The DB-backed bucket (`checkRateLimit`/`incrementRateLimit`,
`rate-limit.ts:441-496`) uses `getRateLimitBucketStart` — a classic *aligned fixed window*
(`nowSec - (nowSec % windowSec)`), which resets unconditionally the instant the epoch crosses into
a new `windowSec`-sized bucket, independent of attempt activity.

**Evidence for the divergence:** directly confirmed by reading both implementations; they are not
the same algorithm, just tuned to the same `LOGIN_WINDOW_MS`/`LOGIN_MAX_ATTEMPTS` constants.

**Evidence this is not a live weakening (in the dominant case):** the in-memory fast-path check
runs *first* in `login()` (`auth.ts:114`, before the DB-backed check at `:151-170`) and is, if
anything, *stricter* than the DB's fixed window (idle-gap reset requires a full window of
inactivity, whereas a fixed window hands out a fresh budget on every boundary crossing regardless
of activity). So in normal single-process operation, the stricter in-memory semantics dominate and
the DB's boundary-reset weakness is masked.

**Concrete scenario where the gap actually matters:** the in-memory map is process-local and does
not survive a restart (documented behavior — "DB-backed... bucket remains the source of truth
across restarts"). If a process restart happens to land at/near a DB bucket-window boundary while
an attacker is mid-brute-force against one account/IP, both mechanisms reset in the same moment:
the in-memory map starts empty (process restart) and the DB bucket also just rolled over (window
boundary) — briefly handing the attacker a fresh full budget with no memory of the prior attempts
in either layer. This is a narrow timing coincidence (bounded by the deploy cadence — this repo's
policy is a deploy-per-commit, so restarts are not rare — intersected with the ~15-minute window
boundary), not a general bypass.

**Suggested fix (low priority):** switch the in-memory map to the same aligned-bucket semantics as
the DB path (or vice versa) so a restart-at-boundary coincidence can't hand out a double-fresh
budget; alternatively, document the intentional asymmetry if the idle-gap behavior is considered a
feature (it is arguably the more attacker-hostile of the two). No urgency — this is a rate-limit
*tuning* nuance, not an auth bypass; both layers still function independently.

**Related refuted hypothesis (recorded for completeness):** I also checked whether an attacker
could defeat the *account-scoped* rate limit by cycling the case of a username (e.g.
`admin`/`Admin`/`ADMIN`) if MySQL's username column collation is case-insensitive but the rate
-limit key were case-sensitive — this would let each case variant consume its own separate bucket
against the same real account. **Refuted:** `buildAccountRateLimitKey` (`rate-limit.ts:159-163`)
explicitly does `username.trim().toLowerCase()` before hashing, so every case variant of a
username maps to the identical rate-limit key. No bypass.

## Refuted hypotheses (recorded — evidence-backed "no bug")

1. **"A scheduled claim-retry/processing-retry timer from before a restore fires after the restore
   and corrupts a recycled-id row."** Refuted by direct evidence: `quiesceImageProcessingQueueForRestore()`
   (`image-queue.ts:1251-1298`) explicitly calls `clearTrackedRetryTimers(state)` and clears
   `retryCounts`/`claimRetryCounts`/`lastErrors`/`permanentlyFailedIds`/`enqueued`/
   `embeddingScanCursorId`/`bootstrapCursorId` as part of the restore-prep sequence, with an
   explicit comment ("the restore may replace the images table entirely — reset the
   embedding-scan resume point and clear any parked per-job retry timers whose jobs reference
   pre-restore rows") showing this exact scenario was already considered and closed.
2. **"`triggerBackfill()` not calling `acquireAdminMutationSlot()` is a restore-fence gap."**
   Refuted: `triggerAdminBackfill()` (`admin-backfill-runner.ts:870-917`) synchronously acquires
   the `gallerykit_color_pipeline_backfill` advisory lock via `acquireBackfillLock()` *before*
   returning `{status: 'queued'}` to the action (the lock connection is handed off to the
   detached `runBackfill` fire-and-forget call only after acquisition succeeds) — so a concurrent
   `restoreDatabase()`'s own non-blocking acquisition of the same lock will correctly fail and
   surface `restoreBlockedByBackfill` the instant a backfill is truly running. The admin-mutation
   barrier is the wrong mechanism to expect here; the advisory lock is the actual (and correct)
   fence for this fire-and-forget pattern.
3. **Topic slug rename → FK re-pointing.** Re-verified against committed HEAD
   (`git show HEAD:apps/web/src/db/schema.ts`): exactly 3 `references(() => topics.slug, ...)`
   sites exist (`topicAliases.topicSlug`, `images.topic`, `topicViews.topic`), matching cycle-1's
   `H4.1` conclusion ("Refuted — no new store is missed as of this HEAD"). `topics.ts` and
   `schema.ts` are both peer-dirty this cycle (23 and 9 changed lines respectively, not yet
   examined since they're in-flight) — worth a fresh check once that work lands, since schema.ts
   is exactly the file where a new slug-referencing table would be added.

## Files examined (inventory)

- `apps/web/src/lib/image-queue.ts` (peer-dirty — diffed against HEAD; only a 2-line unrelated
  `embeddingValue` cast differs, so analysis is HEAD-equivalent) — read in full (both halves)
- `apps/web/src/app/actions/images.ts` — read in full
- `apps/web/src/lib/process-image.ts` — read the encoder (`processImageFormats`), atomic-rename
  helpers, and variant-cleanup/deletion helpers in detail
- `apps/web/src/lib/upload-paths.ts` — read in full
- `apps/web/src/lib/restore-maintenance.ts`, `restore-maintenance-durable.ts`,
  `admin-mutation-barrier.ts` — read in full
- `apps/web/src/app/[locale]/admin/db-actions.ts` — read `restoreDatabase()` in full
- `apps/web/src/lib/maintenance-scheduler.ts` — read in full
- `apps/web/src/lib/background-db-writes.ts` — read in full
- `apps/web/src/lib/upload-processing-contract-lock.ts` — read in full
- `apps/web/src/instrumentation.ts` (peer-dirty — read committed HEAD via `git show`)
- `apps/web/src/lib/admin-backfill-runner.ts` — read `acquireBackfillLock`/`triggerAdminBackfill`
  and surrounding lock-handoff logic
- `apps/web/src/app/actions/admin-backfill.ts`, `lr-tokens.ts` (HEAD, via `git show`) — scanned
  for `requireSameOriginAdmin`/`acquireAdminMutationSlot` coverage
- All 12 files under `apps/web/src/app/actions/` — grepped at HEAD for
  `requireSameOriginAdmin()`/`acquireAdminMutationSlot()` call-count parity
- `apps/web/src/lib/auth-rate-limit.ts` — read in full
- `apps/web/src/app/actions/auth.ts` — read `login()` in full
- `apps/web/src/lib/rate-limit.ts` — read `checkRateLimit`/`incrementRateLimit`/`resetRateLimit`/
  `decrementRateLimit`/`getRateLimitBucketStart`/`buildAccountRateLimitKey`
- `apps/web/src/app/actions/admin-users.ts` — checked username validation/normalization
- `apps/web/src/lib/data.ts` (peer-dirty) — read `flushBufferedSharedGroupViewCounts` (partial,
  enough to confirm the no-timeout shape; smaller/self-limiting scope than F1's headline case)
- `apps/web/src/db/schema.ts` (peer-dirty, via `git show HEAD`) — grepped for
  `references(() => topics.slug` to re-verify the topic-rename FK inventory
- Prior context read in full: `.context/plans/deferred-carry-forward.md`,
  `.context/reviews/_aggregate.md` (cycle 10), and the tracer.md from every prior run-10 cycle
  (`cycle-1` through `cycle-5`, plus `cycle10-2026-07-07/tracer.md`) to establish what was already
  traced and avoid duplicate reporting

## Final sweep (commonly-missed) notes

- Confirmed the peer-dirty file list in the briefing matches the actual `git status`/`git diff
  HEAD` output at the time of this review — no drift between the briefing's snapshot and the live
  worktree.
- Checked all 12 `apps/web/src/app/actions/*.ts` files for `requireSameOriginAdmin()` vs.
  `acquireAdminMutationSlot()` call-count parity as a systematic sweep for actions that mutate
  without participating in the restore-drain barrier — found two apparent mismatches
  (`admin-backfill.ts`: 1/0, `lr-tokens.ts`: 4/2), traced both, and confirmed both are
  intentional/correct (the backfill trigger is fenced by its own advisory lock instead; the
  extra `lr-tokens.ts` call is on a read-only `listLrTokens()` action that doesn't mutate and so
  correctly has no slot). `public.ts` shows 0/0, which is expected — it hosts intentionally
  anonymous public actions (search/load-more/view recording), not admin mutations.
  `getBackfillStatus()` in `admin-backfill.ts` also correctly carries no
  `requireSameOriginAdmin()`/slot as a documented `@action-origin-exempt` read.
- Did not find any admin API route (`app/api/admin/**`) outside the two that exist
  (`db/download`, `lr/upload`) that would need independent restore-fence coverage; both are
  already accounted for by prior cycles (download is read-only; upload is fenced by the
  upload-processing-contract lock per cycle-2's TRC finding).
- Verified `mysql2` pool/statement-timeout configuration was **not** traced as part of F1 —
  flagged explicitly as the next probe rather than assumed either way.
