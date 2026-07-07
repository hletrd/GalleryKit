# Cycle 9 — Tracer lane (causal tracing, competing hypotheses)

Scope per the lead's brief: trace 3-5 high-risk flows end-to-end, look for ordering
hazards, cross-request/process state leaks, cleanup that skips a path, and async races.
Read-only — no source edits.

HEAD at trace time: `6efd737b` (`fix(cycle18): 🐛 harden review-plan-fix findings`).

This is a very mature checkout. `.context/reviews/cycle-8-2026-07-07/tracer.md` already
exhaustively traced (a) upload→queue→Sharp→conditional-UPDATE→delete-mid-processing
cleanup and (d) advisory-lock acquire/destroy-on-failed-release discipline and found both
CONFIRMED CORRECT with full path enumeration. `.context/reviews/cycle10-2026-07-07/tracer.md`
separately found auth/session/origin, schema migration, deploy, restore/shutdown, and data
privacy all CONFIRMED CORRECT. Per the lead's brief, the PAT `last_used_at`-before-route-gates
finding is already tracked as fixed in the `fix(cycle18)` commit at HEAD — I verified the fix
does not regress (see "Verified, not re-reported" below) but did not re-file it.

Given that backdrop, this pass prioritized (1) code paths NOT covered by the two prior
exhaustive audits — the service-worker LRU meta accounting flow (e), which neither prior
cycle traced in depth — and (2) code touched by the very latest commits (cycle 17/18, plus
`db-child-watchdog.ts` and `apps/web/src/app/actions/settings.ts`'s new color-backfill lock
site), on the theory that fresh changes are the likeliest place for a fresh causal defect to
hide in an otherwise heavily-audited codebase.

Findings use IDs `TRC9-NN`.

---

## TRC9-01 — SW image LRU: a stale-read eviction decision can discard a concurrently-refreshed entry (CONFIRMED DEFECT)

**Files traced:** `apps/web/public/sw.template.js` (`withMetaMutation` L98-104, `touchMeta`
L181-216, `deleteMeta` L218-225, `readMetaForUrl` L270-275, `evictExpiredCachedImage`
L277-289, `staleWhileRevalidateImage` L305-437, `HEAD_REVALIDATE_TIMEOUT_MS` L39); the
unit-tested reference mirror `apps/web/src/lib/sw-cache.ts` (`touchMeta` L221-252,
`evictIfExpired` L284-305, `removeEntry` L169-178); test coverage
`apps/web/src/__tests__/sw-cache.test.ts` L513-559.

**Competing hypotheses:**
- **Safe:** the C4-26/TRC4-08 fix ("read the recency behind the queue") plus the shared
  `metaMutationQueue` promise-chain fully closes any TOCTOU between a confirmed-fresh
  `touchMeta` and a stale-based eviction for the same URL.
- **Unsafe:** the queue only serializes individual *reads* and individual *writes*
  relative to each other — it does not make "read the age, decide, then act on that
  decision" atomic as a whole, so a `touchMeta` that lands strictly between the read and
  the subsequent delete is silently undone.

**Causal chain traced:**
1. `metaMutationQueue` is one module-level promise chain shared by every queued operation
   (`withMetaMutation`, `sw.template.js:98-104`). Operations are strictly serialized in the
   order the *synchronous* `withMetaMutation(...)` call site executes, not in the order
   their underlying work happens to finish.
2. `evictExpiredCachedImage(imageCache, cacheKey, url, cached)` (`sw.template.js:277-289`)
   is reached from `staleWhileRevalidateImage` (`sw.template.js:424`) specifically on the
   HEAD-probe-failed / non-304 / non-matching-ETag fallthrough path — i.e. exactly when the
   300 ms-bounded revalidation (`AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)`,
   `sw.template.js:383`) did not confirm freshness for *this* request.
3. It calls `readMetaForUrl(url)` (`sw.template.js:270-275`), which *is* queued
   (`withMetaMutation`), reads the current timestamp, and returns. The age comparison
   (`age > IMAGE_MAX_STALE_MS`, 1 h — `sw.template.js:32,283`) and the resulting boolean
   decision happen **after** that queued read has already resolved and control has
   returned to `evictExpiredCachedImage`'s caller-level code — i.e. *outside* any queue
   operation.
4. If stale, it then calls `await imageCache.delete(cacheKey)` followed by
   `await deleteMeta(url)` (`sw.template.js:284-285`). `deleteMeta` is its own, *separate*
   `withMetaMutation` call (`sw.template.js:218-225`) — a new tail position in the queue —
   and it unconditionally deletes the entry; it never re-reads or re-checks the timestamp
   it is about to discard.
5. Meanwhile, a **second concurrent** `staleWhileRevalidateImage` invocation for the exact
   same URL (e.g. the same photo rendered twice on one page, or the same origin's single
   shared service worker handling two browser tabs on the same photo) can land on the
   304 / same-ETag branch (`sw.template.js:386-398` or `406-419`) and call
   `touchMeta(request.url, ...)` (`sw.template.js:181-216`, itself queued). Critically, that
   call is dispatched via `extendLifetime(event, touchMeta(...))`
   (`sw.template.js:296-303,397,416`), which returns `Promise.resolve()` immediately and
   only keeps the SW alive via `event.waitUntil` — the *caller* does not block on the
   touch actually committing, so this can be in flight during step 3-4 of a **different**
   request's eviction check.
6. If that `touchMeta` call's synchronous invocation happens to chain onto the queue
   **after** the other request's `readMetaForUrl` (step 3) but **before** its `deleteMeta`
   (step 4), the sequence executes as: stale read → decision "evict" (based on the old
   timestamp) → concurrent touch commits a fresh timestamp → `deleteMeta` runs anyway and
   removes the just-refreshed entry (and `imageCache.delete` removes the still-good cached
   bytes). Nothing re-validates the decision against the newer state before acting on it.

**Evidence this is untested and unguarded:** `apps/web/src/__tests__/sw-cache.test.ts:513-559`
covers `evictIfExpired`'s single-actor cases (fresh, expired, repeatedly-touched-so-fresh,
header-fallback) but every case calls `touchMeta`/`evictIfExpired` fully sequentially — none
interleaves a `touchMeta` write for the same URL *between* `evictIfExpired`'s internal read
and its internal delete. The reference module `apps/web/src/lib/sw-cache.ts`'s
`evictIfExpired` (`:284-305`) has the identical shape: `withMetaMutation` around the read
only, then bare `cache.delete` + `removeEntry` (its own separate queued op) outside any
atomic "read+decide+act" boundary — confirming this is a structural gap in the design, not
a template-only slip, since the two are deliberately kept in lockstep (`sw-cache.ts:8-12`).

**Trigger conditions (concrete):** requires two overlapping fetches for the identical image
URL where the cached entry is already past `IMAGE_MAX_STALE_MS` (1 h) — realistic after a
backgrounded tab/idle period — and one fetch's HEAD probe is confirmed-fresh (304 or
same-ETag) while a second, concurrent fetch's HEAD probe times out/errors (the 300 ms
`AbortSignal.timeout` makes this common under any real network latency) and falls through
to the age check. Two tabs of the same origin share one service worker, so the "same URL,
concurrently" precondition is not exotic — background+foreground tabs both holding the same
photo open, or a photo rendered twice on one page (thumbnail + lightbox), both qualify.

**Impact:** the evicted entry's bytes are gone from Cache Storage and its meta record is
gone, even though a concurrent request *just* proved server-side freshness. This directly
contradicts the documented invariant in `CLAUDE.md` ("the entry's stored `time` … decides
eviction victims" / C4-36) for exactly the case that invariant exists to protect. Blast
radius is bounded to a spurious cache miss (one extra network round trip on the next load
of that URL, doubled write I/O from the wasted `touchMeta`) — no data corruption, no
security impact — but it undermines the LRU/offline-reliability contract the SW cache
exists to provide, and it is silent (no error, no log).

**Suggested fix:** make the read-decide-delete-meta sequence one atomic `withMetaMutation`
operation (re-read the entry *inside* the same queued callback that decides and, if stale,
calls `entries.delete(url)` + `setMeta(entries)`), then perform `imageCache.delete` based on
that atomic decision. This closes the TOCTOU the same way C4-26 closed the symmetric
read-side race, by extending the same "decide inside the queue" discipline to the delete
this time. Apply the parallel change to `apps/web/src/lib/sw-cache.ts`'s `evictIfExpired` to
keep the reference mirror in lockstep, and add a Vitest case that interleaves a `touchMeta`
promise between the read and delete phases (inject a controllable `resolveSize`/timestamp or
a manually-advanced `metaMutationQueue` tick) to pin the fix.

**Confidence:** Medium-High on the mechanism (verified by direct code reading of both the
shipped template and the reference module, and by confirming no test exercises this
interleaving). Medium on real-world frequency (needs the specific stale-entry + concurrent-
same-URL-fetch timing window described above, which is plausible but not certain).
**Severity:** Medium (perf/reliability, not correctness-of-served-content or security).

**Probe to raise confidence:** a fake-timer-driven Vitest test against `sw-cache.ts` that
calls `evictIfExpired` and manually resolves a same-URL `touchMeta` call *between* the
internal read and the internal delete (by controlling `metaMutationQueue` ordering directly,
or by exposing the two phases for test injection) would turn this from a code-reading
argument into an executable repro.

---

## TRC9-02 — Admin-mutation restore barrier: synchronous marker-check-then-slot-acquire has no exploitable gap (CONFIRMED CORRECT, independently re-verified)

**Files traced:** `apps/web/src/lib/admin-mutation-barrier.ts` (whole file),
`apps/web/src/app/actions/settings.ts:65-92` as a concrete call site.

**Competing hypotheses:**
- **Unsafe:** an action that checks `getRestoreMaintenanceMessage()` and only later (after
  an `await`) calls `acquireAdminMutationSlot()` could slip a mutation in during the gap
  between the restore setting its durable marker and setting `exclusiveActive`.
- **Safe:** `exclusiveActive` is the sole authoritative gate for the slot, checked
  synchronously at acquisition time regardless of how far the marker check is from the slot
  call, so no ordering gap between "check marker" and "acquire slot" can matter.

**New evidence traced (not just re-accepting the prior cycles' "no finding"):**
- `drainAdminMutationsForRestore` (`admin-mutation-barrier.ts:102-130`) sets
  `state.exclusiveActive = true` as its very first synchronous statement, before any
  `await`. Since Node is single-threaded and there is no `await` between that assignment
  and `acquireAdminMutationSlot`'s synchronous `if (state.exclusiveActive)` check
  (`:78-80`), there is no scheduler interleaving window in which a slot could be granted
  after `exclusiveActive` flips — this holds regardless of how many `await`s an action has
  between its own marker check and its own slot acquisition, because the slot check itself
  is what's authoritative, not the marker.
- The re-check pattern inside `drainAdminMutationsForRestore` (`:119-128`, "a holder may
  have released between the inFlight check above and the waiter registration") is also
  race-free for the same reason: `state.inFlight===0` check, `Promise` executor
  registration, and `notifyDrainWaitersIfIdle` re-check all run synchronously in one tick —
  the only way `inFlight` changes is via a slot's `Symbol.dispose`, which is itself
  synchronous, so there is no `await` boundary during which a concurrent decrement could be
  missed.
- Concrete call site `updateGallerySettings` (`settings.ts:67-77`) confirms the pattern in
  practice: marker check, then `requireSameOriginAdmin()` (awaited), then
  `using mutationSlot = acquireAdminMutationSlot()` with no further `await` before the
  acquired-check — and even if another action had more `await`s in between, per the above
  argument it would still be safe.

**Verdict:** CONFIRMED CORRECT. Confidence: High (full synchronous-ordering argument, not
sampling).

---

## Verified, not re-reported (per lead's instruction)

**PAT `last_used_at` marked before/after route admission gates** — already tracked and fixed
in this HEAD's `fix(cycle18)` commit (`api-auth.ts`, `lr/upload/route.ts`). I traced the new
shape for a regression rather than re-filing the original finding:
- `withAdminAuth` (`apps/web/src/lib/api-auth.ts:66-152`) now stores the verified token in a
  `WeakMap<NextRequest, VerifiedToken>` (`requestTokenContext`) and only clears it
  (`requestTokenContext.delete` / `requestTokenUsageMarked.delete`) in a `finally` after
  `await handler(...args)` settles (`:93-100`). The Lightroom route's own
  `try { … } finally { await uploadContractLock.release(); }` (`route.ts:283-620`) guarantees
  the handler's whole body — including its `return` — completes before that promise
  resolves, so the wrapper's cleanup cannot race the handler's own use of
  `getAdminAuthToken`/`markAdminAuthTokenUsed`. No double-mark, no premature-clear
  regression found.
- `markAdminAuthTokenUsed` (`api-auth.ts:23-28`) is itself idempotent (`requestTokenUsageMarked`
  WeakSet guard), so even if a future handler called it twice, only one `markTokenUsed` DB
  write would fire.

No new angle surfaced here beyond confirming the fix holds; not filed as a TRC9 finding.

**New advisory-lock site — `apps/web/src/app/actions/settings.ts`'s color-backfill
coordination lock** (added since cycle 8's lock audit, which predates this file's lock
usage): `acquireColorBackfillSettingsLock` (`:25-41`) correctly uses
`destroyPooledAdvisoryLockConnectionOnAcquireError` on a `GET_LOCK` query throw, matching
the established pattern audited elsewhere in cycle 8. `updateGallerySettings`'s `finally`
(`:271-280`) releases both `uploadContractLock` and `colorBackfillLockConn` unconditionally
via `Promise.all`, and every early return before acquisition leaves the corresponding `let`
binding `null` so the finally's `if (...)` guards correctly skip a lock that was never
taken. No leak, no double-release, no deadlock (both locks are acquired with `GET_LOCK(name,
0)` — non-blocking, fail-fast). Extending flow (d)'s coverage to this site; no defect found.

---

## Residual uncertainty

- TRC9-01's real-world trigger frequency is not measured; it depends on network timing
  variance around the 300 ms HEAD-probe timeout and on genuinely concurrent same-URL
  fetches, which this review could only reason about structurally (Node/browser scheduling
  argument + code reading), not reproduce live.
- This pass did not re-run the full `npm test` / `npm run build` / e2e suite (a targeted,
  read-only causal trace); no source files were edited.
- Flows (b) (DB restore chain beyond the mutation barrier) and (c) (auth wrapper beyond the
  PAT-marking regression check) were spot-checked against the very latest commit rather than
  re-traced end-to-end, since both were already exhaustively covered by cycle 8 (flow-2
  sub-trace) and cycle 10 with no findings.
