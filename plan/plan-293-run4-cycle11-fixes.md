# Plan 293 — Run-4 Cycle 11 fixes

**Source review:** `.context/reviews/run4-cycle11/_aggregate.md`

One scheduled correctness fix this cycle. Repo policy applies when picked up:
GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, all
gates green before push, per-cycle deploy.

---

## Task 1 — COR-R4C11-01: stop `flushGroupViewCounts` self-stranding its timer  ✅ DONE

**File:** `apps/web/src/lib/data.ts` (`flushGroupViewCounts`, ~line 63).

**Defect:** the function sets `viewCountFlushTimer = null` only AFTER the
`if (isFlushing) return` guard. When a timer scheduled mid-flush fires while a
previous flush is still awaiting (a flush running longer than
`BASE_FLUSH_INTERVAL_MS = 5s`, reachable under DB slowness — pool saturation,
lock contention, a running backup), the invocation early-returns at the guard
and leaves `viewCountFlushTimer` holding the fired-and-inert handle. From that
point:
- the in-flight flush's finally-reschedule guard `viewCountBuffer.size > 0 && !viewCountFlushTimer` is false (stale non-null), so it does not reschedule, and
- every subsequent `bufferGroupViewCount` sees `if (!viewCountFlushTimer)` false, so it never arms a new timer.

The buffer stops draining entirely, grows to `MAX_VIEW_COUNT_BUFFER_SIZE = 1000`,
then silently drops every further increment until the process exits (the
explicit `flushBufferedSharedGroupViewCounts` on shutdown / pre-backup also
no-ops if `isFlushing` is true). Best-effort approximate analytics → LOW
severity, but a self-stranding state machine distinct from the documented
outage-undercount.

**Fix:** hoist `viewCountFlushTimer = null` to the very top of the function
(this invocation has consumed the scheduled timer regardless of the
`isFlushing` outcome), and on the `isFlushing` early-return re-arm a timer
when the buffer is non-empty so the post-swap increments are eventually
drained after the in-flight flush ends. Respects the existing exponential
backoff via `getNextFlushInterval()` and `.unref()`.

**Test:** add fixture-style assertions to
`apps/web/src/__tests__/data-view-count-flush.test.ts` locking (a) the
`viewCountFlushTimer = null` assignment precedes the `if (isFlushing)` guard,
and (b) the `isFlushing` branch re-arms a timer guarded by
`viewCountBuffer.size > 0`. Consistent with the file's established
fixture-style convention (full behavioral mock deferred as C7-F03). These
assertions fail against pre-fix source and pass after.

**Acceptance:** existing 12 invariants still pass; new assertions pass; full
`npm test` green; the swap-and-drain pair and finally-reschedule guard are
unchanged.

**Status:** ✅ implemented + committed (see CHANGES). All gates green.

---

## Regression review of cycle-10 commits — no follow-on work

Both c10 fixes independently re-verified SOUND at line level (GPS post-EOI
trailer rejection correct for baseline + progressive; admin-delete audit
detach complete because `audit_log.target_id` carries no FK). No corrective
task required.

## Deferred / non-scheduled

DES-R4C11-A (aria-live constant string) and the standing carry-forwards are
recorded in `plan-294-run4-cycle11-deferred.md`.
