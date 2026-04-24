# Perf Reviewer — Cycle 8 (RPL loop, 2026-04-23)

**Scope:** performance surface after cycle-7-rpl parallel orphan cleanup,
bytesRead capture, and share rate-limit rollback symmetry.

## Findings

### P8-01 — `Buffer.alloc` zero-fill per chunk in SQL scan [LOW, MEDIUM]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:357`

Fresh `Buffer.alloc(readSize)` per iteration zero-fills the buffer
before the read overwrites it. For a 250 MiB restore at 1 MiB chunks,
that's ~250 zero-fills of 1 MiB = 250 MiB of writes purely for
zero-fill.

**Impact:** ~50-100 ms CPU on a 250 MiB restore. Minor.

**Suggested fix:** allocate once outside the loop with
`Buffer.allocUnsafe(CHUNK_SIZE)` and reuse across iterations.
The subsequent `subarray(0, bytesRead)` already handles the
truncation correctly.

### P8-02 — CSV regex passes count is stable at 4 passes per field [LOW, MEDIUM]

**File:** `apps/web/src/lib/csv-escape.ts:25-38`

Same as deferred AGG7R-12. Four sequential regex passes
(control-strip, bidi-strip, CRLF-collapse, formula-check) + one
quote-double pass. For 50 000 rows × 8 cols × ~30 char avg the
combined work is ~12 MB string processing. Not a realistic
bottleneck on admin-triggered CSV export.

**Status:** carry-forward deferred.

### P8-03 — `sharing.ts` Map-over-size eviction iterates entire keyset [LOW, LOW]

**File:** `apps/web/src/app/actions/sharing.ts:41-49`

When the share rate-limit Map hits the 500 hard cap, eviction walks
from the start of `.keys()` iterator. For a Map already at 500
entries this is fine — only `excess` keys are walked. If excess is
small (1-5), the cost is O(1).

**Status:** no finding.

### P8-04 — `rollbackShareRateLimitFull` awaits DB decrement on error paths [LOW, MEDIUM]

**File:** `apps/web/src/app/actions/sharing.ts:85-90`

The rollback awaits `decrementRateLimit` before returning the error.
On sharing error paths (6 call sites), this adds ~5-50ms per call
(one DB round-trip). Since error paths are rare (the admin-caused
dup-entry retry exhaustion is extremely unlikely), the aggregate
impact is negligible.

**Suggested fix:** fire-and-forget via `.catch(console.debug)`
instead of awaiting. Out of scope.

### P8-05 — `uploadImages` tracker prune scans entire Map on every upload call [LOW, MEDIUM]

**File:** `apps/web/src/app/actions/images.ts:128`, `pruneUploadTracker` at line 64

`pruneUploadTracker()` runs on every upload call and iterates the
full Map (up to 2000 entries). At ~5µs per entry that's 10 ms per
call in the worst case. For a typical gallery with few admin
sessions, the Map rarely approaches cap.

**Suggested fix:** throttle the prune (once per minute) like
`pruneSearchRateLimit` does via `lastSearchRateLimitPruneAt`.

### P8-06 — `image-queue.ts` parallel cleanup increases I/O concurrency [INFO]

**File:** `apps/web/src/lib/image-queue.ts:29-51`

The cycle-7-rpl parallel `Promise.all` over 3 dirs is net-positive
(10-30 ms bootstrap saving). On spinning disks with an external FS,
three concurrent `readdir` + bulk `unlink` could contend for inode
locks. Modern SSDs/ext4 have no practical contention. No action.

### P8-07 — `restoreDatabase` releases lock on beginMaintenance-false via additional DB round-trip [LOW, LOW]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:279`

The cycle-7-rpl `RELEASE_LOCK` call on the early-return path adds one
DB query (`SELECT RELEASE_LOCK(...)`). This is correct behavior —
the alternative (rely on connection release for auto-release) is
unreliable with pooled connections. The added round-trip is
unavoidable and only fires on the already-rare concurrent-restore
race.

**Status:** no finding — correct tradeoff.

### P8-08 — `getClientIp` iterates forwarded-for chain in reverse per call [LOW, LOW]

**File:** `apps/web/src/lib/rate-limit.ts:65-79`

The `x-forwarded-for` header is split, reversed, and iterated per
call. For a typical 2-hop chain (`attacker_ip, real_ip`) this is
O(2). No issue.

### P8-09 — `getCurrentUser` cache hit ratio [INFO]

**File:** `apps/web/src/app/actions/auth.ts:31`

Using React 19 `cache()` deduplicates the DB fetch within a single
request. For multi-action flows where multiple server actions fire
in a single request (e.g., updateMetadata + addTag via
`batchUpdateImageTags`), the shared cache amortizes the auth lookup.
Works as intended.

## Summary

No meaningful perf regressions. P8-01 (buffer reuse) is a simple
micro-opt that could save ~50-100ms on a large restore.
P8-02, P8-04, P8-05 are minor and carry-forward or deferral
candidates.
