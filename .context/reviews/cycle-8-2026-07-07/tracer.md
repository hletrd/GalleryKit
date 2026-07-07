# Cycle 8 — Tracer lane (causal tracing, competing hypotheses)

Scope per the lead's brief: five flows, read-only (no source edits, no git add/commit/stash).
HEAD at trace time: `6256a988`.

Findings use IDs `TRACE8-NN`. Each states hypotheses, evidence (file+line), verdict
(CONFIRMED DEFECT or CONFIRMED CORRECT), confidence, and severity. Negative evidence
(flows traced and found correct) is reported explicitly, as requested.

---

## Flow 1 — Upload → queue claim → Sharp fan-out → conditional `processed` UPDATE → cleanup on delete-mid-processing

Files traced: `apps/web/src/lib/image-queue.ts` (job body ~L719-1063, advisory-lock
helpers ~L630-672), `apps/web/src/lib/process-image.ts` (`processImageFormats`
~L1049-1485), `apps/web/src/app/actions/images.ts` (`deleteImage` ~L655-757,
`deleteImages` ~L759-920).

### TRACE8-01 — Delete-while-processing race: CONFIRMED CORRECT (negative evidence)

**Hypothesis tested:** an admin deleting an image while the queue worker is mid-Sharp-encode
could either (a) leave an orphaned derivative file on disk, or (b) corrupt/half-write a
derivative that a concurrent reader could observe.

**Causal chain traced:**
1. `deleteImage` (`images.ts:655`) does **not** take the per-image processing advisory lock
   (confirmed absent — it only takes `acquireAdminMutationSlot()`, the restore-window fence,
   not `gallerykit:image-processing:{id}`). It can run fully concurrently with an in-flight
   queue job for the same id, as CLAUDE.md documents.
2. The queue worker's authority for "is this image still live" is **not** the initial claim
   check at `image-queue.ts:778-783` (`processed=false` SELECT before Sharp starts) but the
   **conditional UPDATE** at `image-queue.ts:873-875`:
   ```
   .set({ processed: true, ... }).where(and(eq(images.id, job.id), eq(images.processed, false)))
   ```
   which is evaluated fresh, atomically, by MySQL at the moment it runs — strictly *after*
   `processImageFormats` has fully finished writing every format/size (line 840-855 `await`s
   it before reaching the UPDATE).
3. If `deleteImage`'s transaction (`images.ts:721-725`, delete `imageTags` then `images` by id)
   committed before that UPDATE runs, `affectedRows === 0` and the queue worker's own cleanup
   (`image-queue.ts:877-894`) does a **full directory scan** (`deleteImageVariants(dir, filename, [])`
   with empty sizes array) across all three format dirs — this scan runs *after* Sharp is
   100% done, so it necessarily sees every file Sharp just wrote, including any files that
   didn't exist yet when `deleteImage`'s own cleanup (`images.ts:738-745`) ran earlier and
   found nothing to remove for that filename. No orphan.
4. If `deleteImage` runs *after* the UPDATE committed (i.e. the row was already `processed=true`),
   it proceeds as an ordinary, non-racy delete: DB rows gone, then its own full-directory-scan
   cleanup (`images.ts:738-745`) removes everything. No race.
5. Partial-fan-out safety within a single `processImageFormats` call: format generation uses
   `Promise.allSettled` (not `Promise.all`) at `process-image.ts:1436-1440`, so a rejection in
   one format (e.g. AVIF fails because the *original* file was unlinked mid-run by a concurrent
   `deleteImage`, since `deleteImage` deletes the private original too) is only inspected after
   **all three settle** — no format's write can "keep running in the background" past the point
   the caller decides to roll back. On any rejection, `restorePreviousFinalPaths()`
   (`process-image.ts:1206-1221`, invoked from the `catch` at `1473-1475`) unlinks every file
   this call newly created (`createdFinalPaths`) and restores any it overwrote from
   `backupFinalPaths` — a real all-or-nothing rollback to the pre-call state. For a brand-new
   upload (no pre-existing derivatives) this means every partially-written file from *this*
   invocation is removed before the exception propagates to the queue worker's outer `catch`.
6. Net effect of unlinking the *original* file mid-encode: subsequent per-format/per-size Sharp
   instances (`generateForFormat`, `process-image.ts:1227-1431`, which intentionally opens a
   **fresh** `sharp(processingInputPath, …)` per format/size — WI-14) hit `ENOENT` on the next
   open, `processImageFormats` rolls back (step 5), the queue worker retries up to `MAX_RETRIES`
   (`image-queue.ts:972-993`), and `resolveOriginalUploadPath` / `fs.access`
   (`image-queue.ts:785-796`) fails on every retry since the original is truly gone. After
   retries are exhausted, the terminal `processing_error` UPDATE (`image-queue.ts:1033-1035`)
   is unconditional on `processed` but the row is already deleted, so it silently affects 0 rows
   — wasted retry cycles (~15-20s of backoff/log noise per CLAUDE.md's documented escalation),
   **not** a correctness defect (no orphaned file, no crash, no stale error surfaced for a
   nonexistent row).

**Verdict:** the delete-mid-processing race is correctly handled on both sides (whichever
side loses the race is responsible for cleanup, and that cleanup always runs strictly after
all of the other side's writes have settled, because MySQL's row visibility and the
`Promise.allSettled` barrier both provide the necessary ordering). Confidence: **High**.

### TRACE8-02 — Wasted retries when the original is deleted mid-fan-out: LOW/informational, not scheduled

Per step 6 above: if `deleteImage` unlinks the private original while a multi-size Sharp
fan-out is still opening it for later sizes, the job burns all `MAX_RETRIES` (3, with
5s/10s backoff) before giving up quietly. No user-visible harm (the row and files are
already gone), just log noise and ~15s of wasted worker time. Not worth scheduling; noting
for completeness since it's adjacent to the traced race.

### TRACE8-03 — `acquireImageProcessingClaim` GET_LOCK-query-throw path releases (not destroys) the connection: CONFIRMED CORRECT on inspection, Medium confidence

**Hypothesis tested:** several acquire sites (`image-queue.ts:641-658`
`acquireImageProcessingClaim`, `admin-backfill-runner.ts:324-343/363-379`) call
`lockConnection.release()` (not `.destroy()`) when the `GET_LOCK` query itself throws,
which looks like it could leak a lock the same way the fixed RELEASE_LOCK bug did — if the
server actually processed `GET_LOCK` and returned success, but the client-side promise
rejected anyway (network blip after processing), `release()` would return a connection
that still holds the lock server-side.

**Evidence against a real leak:** `node_modules/mysql2/lib/pool_connection.js:11-16` wires
a `once('error', …)` listener that calls `_removeFromPool()`
(`pool_connection.js:62-69`), which sets `this._pool = null` and calls
`pool._removeConnection(this)` — permanently ejecting the connection from the pool's
bookkeeping. `release()` (`pool_connection.js:19-29`) checks `if (!this._pool || …) return;`
first, so once a fatal error has fired, a later `.release()` call is a no-op rather than
returning a live, lock-holding connection to the free list. The only realistic way
`GET_LOCK(name, 0)` (a fixed, non-parameterized-by-user-input, non-blocking call) rejects
its promise is a genuinely fatal connection-level error, and MySQL releases session-scoped
advisory locks automatically when the underlying TCP connection closes — which a fatal
client-side error implies has already happened or is about to. So the class of bug C7-02
fixed for `RELEASE_LOCK` (leaking the lock onto a *live* pooled session) does not apply
symmetrically to `GET_LOCK` failures in this codebase.

**Verdict:** CONFIRMED CORRECT, but flagged Medium (not High) confidence because this rests
on mysql2 internal behavior (verified by reading `node_modules/mysql2/lib/pool_connection.js`
in this checkout, not by a forced-failure integration test) rather than an explicit contract
test. If mysql2 is ever upgraded to a version that changes this error-listener behavior, this
reasoning should be re-verified. Not scheduling — no repro path, no observed incident.

---

## Flow 3 — Advisory-lock destroy-on-failed-release: audited every acquire site

Files traced: `apps/web/src/lib/advisory-lock-release.ts`,
`apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/image-queue.ts:641-672`,
`apps/web/src/lib/upload-processing-contract-lock.ts` (full file),
`apps/web/src/lib/admin-backfill-runner.ts:324-391`,
`apps/web/src/app/actions/topics.ts:70-95`,
`apps/web/src/app/actions/admin-users.ts:194-315`,
`apps/web/src/app/actions/embeddings.ts:113-213`,
`apps/web/src/app/[locale]/admin/db-actions.ts:150-360` (backup) and `:369-602` (restore),
`apps/web/scripts/backfill-clip-embeddings.ts:108-258`,
`apps/web/scripts/backfill-color-pipeline.ts:330-360,595-610`,
`apps/web/src/__tests__/advisory-lock-release-contract.test.ts`.

### TRACE8-04 — Restore's three chained locks (`LOCK_DB_RESTORE`, `LOCK_COLOR_PIPELINE_BACKFILL`, `LOCK_SEMANTIC_EMBEDDING_BACKFILL`) plus the upload-contract lock: CONFIRMED CORRECT, no double-release, no leak

**Hypothesis tested:** `restoreDatabase` (`db-actions.ts:369-602`) holds up to four
locks/handles at once, released at different points across four early-return branches
plus two nested `finally` blocks — a natural place for a double-release or a leaked lock
on one of the paths.

**Evidence — traced every exit path:**
- `!uploadContractLock` early return (`:418-423`): releases `LOCK_DB_RESTORE`, clears
  `dbRestoreLockHeld`, returns. Outer `finally` (`:582-601`) checks each flag before acting;
  all are already false/null, so it only calls `lockReleaser.finish()`. No double release.
- `!backfillLockAcquired` early return (`:430-439`): releases `LOCK_DB_RESTORE` then
  `uploadContractLock`, clearing both trackers, in the correct order before falling through.
- `!semanticBackfillLockAcquired` early return (`:447-457`): releases
  `LOCK_COLOR_PIPELINE_BACKFILL` (clearing `backfillLockHeld`), then `LOCK_DB_RESTORE`
  (clearing `dbRestoreLockHeld`), then `uploadContractLock` (nulled) — all three cleared
  before the outer `finally` runs.
- `!restoreMaintenanceStarted` early return (`:469-495`): releases `LOCK_DB_RESTORE`
  unconditionally (guaranteed held at this point) then conditionally releases the backfill
  and semantic locks (`if (backfillLockHeld)` / `if (semanticBackfillLockHeld)`), then the
  upload-contract lock — all trackers cleared.
- Normal/failure path through the drain+restore body: the **inner** `finally`
  (`:542-581`) unconditionally releases `LOCK_DB_RESTORE` (again, provably held at this
  point in every code path that reaches here) and sets `dbRestoreLockHeld = false`, then
  conditionally releases the other two locks and the upload-contract lock, clearing every
  tracker. The **outer** `finally` (`:582-601`) re-checks all four trackers and finds them
  already false/null in this path too — no double release.
- Every release, in every branch, goes through either `lockReleaser.release(...)` (the
  staged `createPooledAdvisoryLockReleaser`, `advisory-lock-release.ts:46-71`) or
  `uploadContractLock.release()` (which internally calls `releasePooledAdvisoryLocks`,
  `upload-processing-contract-lock.ts:46-56`). `lockReleaser.finish()` is called exactly
  once, at the very end of the outer `finally` (`:600`), and destroys the connection iff
  *any* tracked release failed — matching the intended "one connection, N chained locks,
  one terminal destroy-or-release decision" design.

**Verdict:** CONFIRMED CORRECT. Confidence: **High** (full path enumeration, not sampling).

### TRACE8-05 — All other pooled-advisory-lock acquire sites: CONFIRMED CORRECT

Individually traced (not merely grepped):
- `image-queue.ts` per-image processing claim (`acquireImageProcessingClaim` /
  `releaseImageProcessingClaim`, `:641-672`) — routes through the shared
  `releasePooledAdvisoryLocks` helper; the non-acquired path (`isAdvisoryLockAcquired` false)
  correctly plain-`release()`s since no lock was taken by this connection.
- `upload-processing-contract-lock.ts` (whole file) — both the success path and the two
  failure paths (`lockAcquired` false, and the post-acquire query-throw path) correctly
  distinguish "never acquired → plain release" from "acquired then something failed →
  destroy-don't-release via the shared helper."
- `admin-backfill-runner.ts` color-pipeline backfill lock (`:324-353`) and per-image
  processing claim (`:363-391`) — same shape, shared helper used for both.
- `topics.ts` `withTopicRouteMutationLock` (`:70-95`) — the historical origin site of the
  fix pattern (commit `3acf638a`), now delegating to the shared helper.
- `admin-users.ts` `deleteAdminUser`'s table-wide admin-delete lock (`:194-315`) — releases
  via the shared helper in the `finally`, `conn.rollback()` is separately awaited-and-caught
  before the lock release, so a failed transaction never skips the lock release.
- `embeddings.ts` semantic-backfill action (`:113-213`) — same shape.
- `db-actions.ts` backup path (`exportImagesCsv`'s neighbor, `:150-360`) — single lock,
  correctly destroy-don't-release via the shared helper in its `finally`.
- `backfill-clip-embeddings.ts` (`:108-258`) and `backfill-color-pipeline.ts`
  (`:330-360,595-610`) — these two are the test's allowlisted exemptions from the shared
  helper (raw `RELEASE_LOCK` calls). Verified the exemption is actually justified in the
  current code, not just asserted: both are one-shot `--rm` sidecar scripts whose `main()`
  calls `process.exit(exitCode)` immediately after the lock-holding connection is
  `.release()`d (`backfill-clip-embeddings.ts:249-250` then process exit in the trailing
  `main().then(...)`; `backfill-color-pipeline.ts:601-610` same shape) — a poisoned pool
  connection cannot outlive the process, so the C7-02 hazard (a live pooled session
  wedging *future* callers) cannot materialize here.
- `single-writer-guard.ts` — confirmed exempt per its own file comment and the contract
  test's allowlist reasoning (dedicated non-pool `mysql.createConnection`, not a
  `PoolConnection`; its own lifecycle closes the socket on failure).

**Verdict:** every acquire site destroys (not releases) the pooled connection when any
`RELEASE_LOCK` on it fails, no path double-releases, and no path leaks a held lock onto a
connection returned to the pool. Confidence: **High**.

---

## Flow 2, 4, 5 — delegated to parallel sub-traces

Flows 2 (DB restore end-to-end: marker → barrier drain → advisory lock → mysqldump import
→ reconcile postconditions → logout revocation queue), 4 (searchImages tag_names parity +
restore SQL rolling raw scan tail), and 5 (migrate.js mixed-drift handling) were traced by
three parallel forked sub-agents sharing this session's context, to cover more ground within
the same investigation. Their findings are folded in below, re-verified against the cited
line numbers before inclusion.
