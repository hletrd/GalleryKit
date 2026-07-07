# Cycle 8 (2026-07-07) — Code Quality / Logic Correctness Review

**Reviewer lane:** code-quality (logic bugs, SOLID/maintainability, cross-file
contract consistency). HEAD reviewed: `6256a988`.

**Scope note (honesty on coverage):** This codebase has already been through
~10 review "runs" and dozens of cycles (see `.context/plans/deferred-carry-forward.md`,
143 lines of still-open low/med items alone). The vast majority of files I
read were already extremely hardened — many carry inline comments citing the
exact prior finding ID (e.g. `C7-02`, `R16C16 CR-16-01`) that fixed the bug I
was about to independently flag. I read, in full, every file in
`app/actions/*.ts`, the advisory-lock / restore-maintenance / admin-mutation-barrier
/ session / pending-revocation lock-and-fence subsystem, `image-queue.ts`
(full, both halves), the `processImageFormats` encoder in `process-image.ts`,
`sql-restore-scan.ts`, `smart-collections.ts`, `proxy.ts`, `api-auth.ts`,
`use-display-capability.ts`, and `image-zoom.tsx`. I spot-checked (not
full-line-by-line) the remaining `lib/*` helpers, `components/*.tsx`, and
`db/schema.ts` via targeted reads and greps — no correctness-relevant issue
surfaced there, but I did not read every one of those files end-to-end, so
treat that subset as "no finding" rather than "clean, proven."

I explicitly targeted the six areas the team lead called out as recent work:
advisory-lock destroy-on-failed-release (`ae197531`), restore-window logout
revocation queue (`c882e82d`), SQL-restore-scan rolling raw tail (`9f416f01`),
searchImages tag_names parity (`f3cafa9c`/`584417f5`), watchdog extraction
(`f201309c`), and IMAGE_BASE_URL diagnostics (`f9b4a086`). Of those six, five
check out as correct on close reading. The sixth (restore-window logout
revocation queue) has the one confirmed bug below — introduced in the very
commit that was supposed to close the class of bug it reopens.

---

## CR8-01 — `logout()` silently drops the pending-revocation queue on a genuine DB failure, reopening the exact bug C7-01 just closed

**File:** `apps/web/src/app/actions/auth.ts:280-303` (added in commit `c882e82d`)

```ts
if (!maintenanceError) {
    using mutationSlot = acquireAdminMutationSlot();
    if (mutationSlot.acquired) {
        const session = await verifySessionToken(token);
        if (session) {
            logAuditEvent(session.userId, 'logout', 'user', String(session.userId)).catch(console.debug);
        }
        await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).catch(() => {});
        revoked = true;
    }
}
if (!revoked) {
    enqueuePendingSessionRevocation(hashSessionToken(token));
}
```

**Why it's a problem:** `revoked = true` is set unconditionally immediately
after the `db.delete(sessions)...catch(() => {})` line — regardless of
whether the DELETE actually succeeded. The `.catch(() => {})` swallows any
error from the delete (query timeout, connection reset, deadlock, pool
exhaustion, etc.) and the `await` therefore never throws; execution always
reaches `revoked = true`. Because `revoked` is `true`, the `if (!revoked)`
branch that calls `enqueuePendingSessionRevocation(...)` — the exact
mechanism commit `c882e82d` introduced specifically so a skipped/failed
revocation isn't silently lost — never runs.

The surrounding commit's entire stated purpose (see its own commit message
and the module doc-comment in `pending-session-revocations.ts:5-21`) is: "a
skipped DB-side session revocation must never leave the token silently
verifiable for its remaining lifetime (up to 24h)." That invariant is upheld
for the *restore-maintenance-window* trigger (the `if (!maintenanceError)` /
`if (mutationSlot.acquired)` branches correctly fall through to the queue),
but not for a plain transient DB failure during the delete itself — which is
arguably the more common real-world failure mode outside a restore window
(a momentary MySQL connection blip, pool timeout under load, etc.).

**Concrete failure scenario:** Admin clicks "Log out" while the DB is briefly
unreachable (e.g. a MySQL restart, network blip, or pool exhaustion from a
concurrent bulk operation). `db.delete(sessions)...` rejects, the rejection
is swallowed, `revoked` is still set to `true`, so the token is NOT queued
for the post-restore/hourly-sweep retry. The cookie is cleared client-side
(so the UI looks logged out), but the session row survives in the DB and the
token remains cryptographically valid until natural expiry (up to 24h per
the module's own documented threat model). A user who believes they logged
out on a shared/public machine is not actually revoked server-side.

**Suggested fix:** track the delete's actual outcome instead of assuming
success once the swallow-catch is reached:

```ts
let deleteSucceeded = false;
if (mutationSlot.acquired) {
    const session = await verifySessionToken(token);
    if (session) {
        logAuditEvent(session.userId, 'logout', 'user', String(session.userId)).catch(console.debug);
    }
    try {
        await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
        deleteSucceeded = true;
    } catch (err) {
        console.debug('Failed to delete session row on logout:', err);
    }
}
revoked = deleteSucceeded;
```

**Confidence:** High (the swallow-then-assume-success pattern is
unambiguous from the code — no branching hides it).
**Severity:** MED (real-world trigger probability is lower than the
restore-window case the surrounding commit targeted, since it needs a
same-instant DB failure rather than a scheduled maintenance window, but the
resulting exposure — a token verifiable for up to 24h after the user
believes they logged out — is identical in kind to the CRIT/MED-HIGH finding
`c882e82d` was written to close).

---

## CR8-02 — Image-queue claim-retry counter is not reset after a job successfully claims but then fails processing

**File:** `apps/web/src/lib/image-queue.ts:660-1065` (finally block at
`1049-1065`, `claimRetryCounts` semantics at `727-775`)

**Why it's a problem:** `claimRetryCounts` tracks how many times a job
failed to *acquire* the per-image advisory-lock claim (the `GET_LOCK(...,0)`
branch at line 726, `!lockConnection`). When a job DOES acquire the claim,
line 775 resets `claimRetryScheduled = false` so the `finally` block's
`if (!claimRetryScheduled) state.claimRetryCounts.delete(job.id);` clears the
stale counter — but only when `retried` is also `false` (the `if (!retried)`
guard at line 1056 wraps that whole cleanup block). If the job's *processing*
then fails (Sharp error, transient FS/DB blip) and a processing-retry is
scheduled, `retried` is set to `true` (line 991) before returning from the
catch block, which skips the entire `if (!retried) { ... }` block in
`finally` — including the `claimRetryCounts.delete(job.id)` that would
otherwise fire since `claimRetryScheduled` is `false` at that point.

The result: a job that previously needed, say, 3 attempts to acquire its
claim (each attempt bumping `claimRetryCounts` via the escalating-backoff
path) but then succeeds and moves on to processing, which fails and is
retried — carries its stale `claimRetryCounts` entry (`3`) into the *next*
processing retry's re-enqueue. If that re-enqueue then also needs to retry
claim acquisition (e.g. another worker/process still holds the per-image
lock briefly), `claimRetries = (state.claimRetryCounts.get(job.id) || 0) + 1`
starts from `3 + 1 = 4` instead of `0 + 1 = 1`, escalating the backoff delay
faster and reaching `MAX_CLAIM_RETRIES` (10) sooner than the counter's own
"claim acquisition attempts for this pass" semantics intend.

**Concrete failure scenario:** Low-likelihood but reachable in a busy
multi-worker-ish window (e.g. backfill runner + live queue worker both
touching the same image id around a manual retry): a job claims after 3
tries, fails processing (transient error, retried), re-enqueues, and now
needs claim-retries again — it gives up on claim acquisition after only 6
more tries instead of the intended 9, persisting a `processing_error` to the
admin failed-images panel earlier than the documented 10-attempt budget
would suggest.

**Suggested fix:** clear `claimRetryCounts` right after a successful claim
(next to the existing `claimRetryScheduled = false;` reset at line 775),
independent of the `retried` flag's later value:

```ts
claimRetryScheduled = false;
state.claimRetryCounts.delete(job.id);
```

**Confidence:** Medium (traced through the state machine by hand; not
verified against a live repro or the test suite — this is a narrow
interaction between two independent retry counters that only diverges on
the claim-then-processing-fails path).
**Severity:** LOW (affects only the pacing of an already-bounded retry
budget; does not cause incorrect processing, data loss, or a stuck job —
worst case a job gives up slightly earlier than the documented 10-attempt
claim budget).

---

## Areas examined in depth with no new findings

- **Advisory-lock destroy-on-failed-release migration** (`advisory-lock-release.ts`,
  and its seven call sites: `image-queue.ts`, `admin-backfill-runner.ts`,
  `upload-processing-contract-lock.ts`, `app/actions/admin-users.ts`,
  `app/actions/embeddings.ts`, `app/actions/topics.ts`, and the staged
  multi-lock releaser in `app/[locale]/admin/db-actions.ts` `restoreDatabase`).
  Traced the `dbRestoreLockHeld` / `backfillLockHeld` / `semanticBackfillLockHeld`
  sentinel flags across every early-return path in `restoreDatabase` against
  the single terminal `lockReleaser.finish()` in the outer `finally` — no
  double-release, no leaked lock, no path that skips the terminal
  release/destroy decision.
- **`sql-restore-scan.ts` rolling raw-suffix fix** (`9f416f01`): the
  cumulative `nextRawSuffix` correctly fixes the three-short-read keyword-split
  evasion described in the commit; verified the call site in `db-actions.ts`
  correctly threads `scanRawSuffix` across chunk iterations.
- **`searchImages` tag_names EXISTS-subquery fix** (`f3cafa9c`/`584417f5`
  in `lib/data.ts`): confirmed the aggregation joins are unfiltered and the
  match predicate lives only in the `EXISTS` subquery, matching every other
  `tagNamesAgg` consumer's contract; the `remainingLimit`/`aliasRemainingLimit`
  removal is correctly provably-dead code per the short-circuit return above it.
- **`db-child-watchdog.ts` extraction** (`f201309c`): the SIGKILL-escalation
  ordering (arm grace timer before invoking `onTimeout`), the `once()`-based
  double-invocation safety on `markSettled`, and the `fired`-gated cleanup
  are all internally consistent; verified all three call sites in
  `db-actions.ts` (backup, restore, post-restore migration) register/clear
  the watchdog symmetrically.
- **`admin-mutation-barrier.ts`** — the shared/exclusive slot counting and
  drain-waiter registration is race-free (no `await` sits between
  `exclusiveActive` being set and the `inFlight` check, so no window exists
  for a slot to sneak in after the exclusive flag flips).
- **`processImageFormats`** in `process-image.ts` — verified the fresh-Sharp-
  instance-per-format invariant (WI-14) actually holds in the current code
  (no shared `image` variable across formats), the 10-bit→8-bit AVIF retry
  correctly forces `bitdepth: 8` explicitly on the cloned pipeline (Sharp
  option setters merge, they don't reset), and the atomic backup/restore
  bookkeeping (`createdFinalPaths` / `backupFinalPaths`) is deliberately
  shared across all three format closures so a partial-format failure rolls
  back the whole multi-format encode transactionally.
- **`smart-collections.ts`** compiler/validator — confirmed every predicate
  value is validated as a scalar (string/finite number) before reaching
  Drizzle's parameter binding, closing the `mysql2` object-expansion risk the
  module's own `R4C4 HARD-R4C4-07` comment describes; the tag-predicate
  subquery and topic-slug remap/reference helpers are consistent with each
  other and with `topics.ts`'s slug-rename transaction.
- **`proxy.ts` / `api-auth.ts`** — the admin-route matcher, cookie
  format pre-check, and the token-vs-cookie auth branches in `withAdminAuth`
  are logically sound; confirmed the API route matcher exclusion
  (`matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']`) is why every
  `api/admin/**` route must self-enforce auth via `withAdminAuth`, and that
  wrapper does so correctly for both the cookie and PAT-token paths.
- **`use-display-capability.ts`** — the `useSyncExternalStore` snapshot-cache
  invariant (stable reference until the underlying gamut/HDR value actually
  changes) holds; confirmed via tracing `detect()`'s early-return-cached-object
  branch.
- **`image-zoom.tsx`** — the ref-based (non-re-rendering) gesture state
  machine for wheel/mouse/touch/pinch is internally consistent; the native
  (non-React-synthetic) `touchmove`/wheel listener registration with
  `{ passive: false }` is required and correctly scoped.
- Spot-checked `app/actions/{images,topics,tags,collections,sharing,
  lr-tokens,settings,seo,admin-users,embeddings,public}.ts` in full — every
  mutating export correctly chains `getRestoreMaintenanceMessage` →
  `requireSameOriginAdmin` → `acquireAdminMutationSlot` → `isAdmin()` in that
  order, and every rate-limited public action in `public.ts`/`sharing.ts`
  correctly pre-increments before the DB-backed check and symmetrically rolls
  back both counters on every rejection/error path I traced.

## Summary

**Total findings: 2** (0 CRIT, 0 HIGH, 1 MED, 1 LOW)

- CR8-01 (MED, High confidence): `logout()` in `auth.ts` treats a swallowed
  DB-delete failure as a successful revocation, skipping the pending-queue
  fallback that the same commit introduced for the restore-window case.
- CR8-02 (LOW, Medium confidence): `image-queue.ts`'s `claimRetryCounts` is
  not cleared when a successfully-claimed job's processing attempt fails and
  retries, causing claim-retry backoff to escalate faster than intended on
  a subsequent claim contention for the same job.
