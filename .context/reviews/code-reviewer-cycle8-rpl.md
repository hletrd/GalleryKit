# Code Reviewer — Cycle 8 (RPL loop, 2026-04-23)

**Scope:** full repository after cycle-7-rpl landings (CSV leading-whitespace
formula guard, restore advisory-lock release, share rollback symmetry,
bytesRead capture, CLAUDE docs, parallel orphan cleanup).

**HEAD:** `000000053 docs(plan): 📝 record cycle 7 rpl plan + deferred items`.

## Findings

### CR8-01 — `uploadImages` upload-tracker first-insert race [LOW, HIGH]

**File:** `apps/web/src/app/actions/images.ts:127-176`

**Behavior:** the upload tracker uses a classic "read-then-check-then-set"
pattern. Line 129 reads the current entry (or creates a fresh
`{count:0,bytes:0,windowStart:now}` if none exists), line 135 checks
the projected total, lines 174-176 mutate and set. Between line 124
(`await headers()`) and line 176 there are three `await` boundaries
(`statfs`, no DB call but any future one). For existing keys the
mutation is on a shared object reference, so concurrent requests see
each other's increments. For a *first-time* key where
`uploadTracker.get(uploadIp)` returns `undefined`, each concurrent
request creates its own `{count:0,bytes:0,windowStart:now}` literal
and the last `uploadTracker.set` wins, erasing the earlier request's
claim.

**Impact:** an attacker issuing N concurrent initial uploads from a
cold IP can race the tracker, landing all N batches instead of one.
Once any request's `set` completes, subsequent requests from the same
IP see the canonical tracker.

**Suggested fix:** on the missing-entry branch, immediately
`uploadTracker.set(uploadIp, {count:0,bytes:0,windowStart:now})`
BEFORE the first `await` so that concurrent requests from the same
IP share a single reference. Alternatively, read-modify-write after
all awaits complete (similar to login's pre-increment pattern).

### CR8-02 — Unreachable `\t` branch in CSV formula-prefix regex [LOW, HIGH]

**File:** `apps/web/src/lib/csv-escape.ts:25-35`

**Behavior:** the control-char strip at line 25 removes `\x09` (tab)
from the input before the formula-prefix check at line 35. The
formula regex `/^\s*[=+\-@\t]/` includes `\t` in its character class,
which is effectively unreachable — any `\t` in the input was already
stripped.

**Impact:** none (correctness-preserving dead branch). The comment
trail documents the cycle-6-rpl CRLF fix and the cycle-7-rpl
leading-space fix, but not that `\t` is dead code.

**Suggested fix:** drop `\t` from the character class and add a
comment noting the control-strip runs first. Alternatively, leave as
defense-in-depth and add a comment.

### CR8-03 — `settleUploadTrackerClaim` double-call is still deferred [LOW, HIGH]

**File:** `apps/web/src/app/actions/images.ts:307-313`

Same as AGG7R-21 (carry-forward). The two call sites (failure-only
path + success path) could be unified with `try/finally`. Existing
deferral cited readability; no new information this cycle.

### CR8-04 — `rollbackShareRateLimitFull` await ordering on exhausted retries [LOW, MEDIUM]

**File:** `apps/web/src/app/actions/sharing.ts:180-185, 298-305`

**Behavior:** after the retry loop exhausts (5 key-collision retries),
we `await rollbackShareRateLimitFull(...)` then `return`. The
rollback awaits a DB decrement. If the DB is flaky, this adds up to
a few hundred ms to the error response. Rate-limit rollback failure
is best-effort already (catches errors internally), so the await is
purely for sequencing.

**Impact:** cosmetic. No functional issue. A minor latency cost on
the already-rare "5 collisions in a row" path.

**Suggested fix:** fire-and-forget the rollback via
`.catch(console.debug)` instead of `await`ing to reduce p99 latency
on the failure path. Out-of-scope for this cycle.

### CR8-05 — `runRestore` MAX_RESTORE_SIZE check AFTER lock acquisition [LOW, MEDIUM]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:305-314`

**Behavior:** `runRestore` rejects files larger than
`MAX_RESTORE_SIZE_BYTES` at line 312. This check runs after
`restoreDatabase` has already acquired the MySQL advisory lock AND
called `beginRestoreMaintenance()`. The app still releases the lock
via the outer finally, but the file-size rejection forces every
oversized upload to transit the full maintenance-begin/rollback
cycle, briefly blocking other legitimate maintenance actions.

**Impact:** minor. The `beginRestoreMaintenance` state toggles for
the duration of the size check (microseconds) before being released.
An attacker could use this to briefly block restore attempts by
repeatedly uploading oversized dummies.

**Suggested fix:** move the `file.size > MAX_RESTORE_SIZE_BYTES`
check to `restoreDatabase` BEFORE `conn.query(SELECT GET_LOCK)` — or
even before `requireSameOriginAdmin`. Filesize is available on the
`File` object without reading the stream.

### CR8-06 — Buffer.alloc on every chunk in SQL scan loop [LOW, MEDIUM]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:355-364`

**Behavior:** the SQL-scan loop allocates a new `Buffer.alloc(readSize)`
per 1 MiB chunk. For a 250 MiB file that's ~250 fresh allocations,
each zero-filled (defense from Node's buffer pool contamination).
Performance-neutral in practice (GC handles it), but a single
`Buffer.allocUnsafe(CHUNK_SIZE)` reused across iterations with a
subarray view would avoid the zero-fill cost and pool churn.

**Impact:** negligible. ~10-20ms CPU saved on a 250 MiB restore.

**Suggested fix:** reuse a single `Buffer.allocUnsafe(CHUNK_SIZE)`
buffer across loop iterations; slice via `bytesRead`. Micro-opt.

### CR8-07 — `image-queue.ts` parallel cleanup error-handling granularity [LOW, HIGH]

**File:** `apps/web/src/lib/image-queue.ts:29-51`

**Behavior:** the parallel `Promise.all(dirs.map(...))` at line 29
now runs three dir scans concurrently. Each dir has its own
`try {...} catch {...}` swallowing errors (directory-may-not-exist).
This is correct. However, the outer `Promise.all` cannot reject
because every branch catches. If a new reviewer mistakenly
removes the inner catch, the outer `Promise.all` would short-circuit
and leave one dir unprocessed.

**Impact:** defensive maintenance concern only. The current
implementation is correct.

**Suggested fix:** add a comment or switch to
`Promise.allSettled(dirs.map(...))` at the outer level so reviewers
see the intent explicitly. Optional.

### CR8-08 — `sharing.ts:pruneShareRateLimit` hard-cap oldest-first eviction can evict active entries [LOW, MEDIUM]

**File:** `apps/web/src/app/actions/sharing.ts:41-49`

**Behavior:** when `shareRateLimit.size > SHARE_RATE_LIMIT_MAX_KEYS`
(500) after expiry pruning, eviction walks `keys()` in insertion
order and evicts the first `excess` entries. Insertion order is
approximately oldest-first, so typically this evicts old entries.
However, if the Map was just populated by fresh inserts (e.g., after
a restart drains the memory), those fresh entries are the earliest
in insertion order and would be evicted.

**Impact:** LRU-ish eviction is imperfect. Under sustained pressure
with 500+ active share IPs (very unlikely on a personal gallery),
some legitimate entries could be evicted. The in-memory layer is a
fast-path cache — the DB layer is the source of truth, so evicted
entries re-populate from DB check.

**Suggested fix:** sort by `entry.resetAt` ascending before evicting,
so the entry with the earliest reset is evicted first. Out-of-scope
for this cycle.

## Summary

Code quality is high after 7 cycles. CR8-01 (upload-tracker
first-insert race) is the most concrete finding — a legitimate
concurrency hole, albeit small. The rest are either carry-forward,
cosmetic, or micro-opts. No commit-blocking issues.
