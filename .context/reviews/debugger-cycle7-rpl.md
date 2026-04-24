# Debugger Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** debugger (latent bug surface, failure modes,
regressions)

## Findings

### D7-01 — `escapeCsvField` formula-injection check runs AFTER
CR/LF→space collapse, creating a bypass when input starts with CR/LF

**File:** `apps/web/src/lib/csv-escape.ts:16-20`

```ts
value = value.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
value = value.replace(/[\r\n]+/g, ' ');
if (value.match(/^[=+\-@\t]/)) {
    value = "'" + value;
}
```

If input is `\r\n=HYPERLINK("evil")`:
1. Controls stripped: `\r\n=HYPERLINK("evil")` (CR and LF NOT in strip
   range — CR is `\x0D` excluded; LF is `\x0A` excluded).
2. CRLF collapse: `" =HYPERLINK(\"evil\")"` (note leading space).
3. Formula check: `/^[=+\-@\t]/.test(" =HYPERLINK...")` → **FALSE**.
4. Output: `"" =HYPERLINK(""evil"")"`.

Excel/LibreOffice typically trim leading whitespace when interpreting
cells; this CAN cause formula execution. Cross-agent overlap with
TR7-01.

**Severity:** MEDIUM (security-flavored, but low exploitation surface
— the data in `user_filename` is set by an authenticated admin).
**Confidence:** HIGH
**Recommendation:** run the formula check AFTER `trimStart()`, or
swap the regex to `/^\s*[=+\-@\t]/`.

### D7-02 — `cleanOrphanedTmpFiles` does not check if the `.tmp` file
it's about to unlink was created by the CURRENT process's ongoing
image-processing run (atomic rename window)

**File:** `apps/web/src/lib/image-queue.ts:23-48`

Carried from cycle-6-rpl AGG6R-13. At bootstrap, the function runs
shortly after queue bootstrap; a concurrent in-flight
`processImageFormats` call could have a `.tmp` file open for the
atomic rename. Unlinking it during the brief rename window would
cause the rename to fail with ENOENT.

Probability is very low because bootstrap happens at import time
before any enqueue, and `.tmp` files from the CURRENT process's
brief `link()→rename()` atomic window are ≤1ms old — very unlikely
to exist at bootstrap.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** only unlink `.tmp` files older than 5 minutes
(mtime threshold).

### D7-03 — `checkShareRateLimit` pre-increment sets `count = 1` on
fresh/expired entries but then checks `count > SHARE_MAX_PER_WINDOW`
— which for count=1 returns FALSE (within limit), so first request
passes. OK.

If a second caller arrives before the first returns:
- first: `count = 1`, check: `1 > 20 ? false`, proceeds.
- second: entry exists, count++ → 2, check: `2 > 20 ? false`, proceeds.

Pre-increment is sound.

**File:** `apps/web/src/app/actions/sharing.ts:54-67`

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### D7-04 — `rollbackShareRateLimitFull` in the FK-violation branch
of `createGroupShareLink` rolls back BOTH counters, but the in-memory
counter may have been reset between `checkShareRateLimit` and the
rollback if `SHARE_RATE_LIMIT_WINDOW_MS` elapsed

**File:** `apps/web/src/app/actions/sharing.ts:85-90, 285-288`

If the FK violation fires after a 60-second network round-trip (rare
for a local DB), the window may have rolled over. `rollbackShareRateLimit`
at line 69-77 would then decrement the NEW window's entry (count=1
→ delete), which leaks a quota that wasn't consumed.

Low probability: DB operations are fast. Not actionable.

**Severity:** LOW
**Confidence:** MEDIUM

### D7-05 — `discoverActionFiles` does NOT handle symlinks in the
recursive walk

**File:** `apps/web/scripts/check-action-origin.ts:54-72`

```ts
for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { stack.push(full); continue; }
    if (!entry.isFile()) continue;
    // ...
}
```

A symlinked directory under `actions/` (unlikely but possible in a
monorepo) would be skipped because `isSymbolicLink()` is neither
`isDirectory()` nor `isFile()`. Depending on threat model, this is
either safe (prevents symlink confusion) or a gap (misses scan
coverage on legitimate symlinks).

For a security lint gate, the current strict "skip non-regular"
behavior is the safer choice. Document it.

**File:** `apps/web/scripts/check-action-origin.ts:65-66`

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** add a comment noting symlinks are intentionally
skipped.

### D7-06 — `getNextFlushInterval` references `consecutiveFlushFailures`
which is module-level mutable state. If `flushGroupViewCounts` is called
concurrently (which it's guarded against via `isFlushing`), the counter
read/write is serialized. Safe.

**File:** `apps/web/src/lib/data.ts:22-26`

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### D7-07 — `bootstrapImageProcessingQueue` fires `purgeExpiredSessions`
without awaiting. If the function throws synchronously (unlikely, it
has its own try/catch at lines 295-301), the error would be unhandled.

**File:** `apps/web/src/lib/image-queue.ts:337`

```ts
purgeExpiredSessions();  // no await, no catch
```

`purgeExpiredSessions` returns a Promise and has an internal try/catch.
The outer fire-and-forget is acceptable but would leak a rejected
Promise warning to Node if the try/catch ever misses. Good-enough.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** add `.catch(err => console.debug(...))` for
consistency with the sibling calls.

### D7-08 — `restoreDatabase` advisory-lock acquisition and
`beginRestoreMaintenance()` are SEPARATE mutually-exclusive gates.
If advisory lock succeeds but `beginRestoreMaintenance` fails
(already true from a previous hung restore), the lock is held but
maintenance flag not set — the lock is released in the outer finally.

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:263-273`

Flow:
1. `GET_LOCK` → acquired=1.
2. `beginRestoreMaintenance()` returns false (already active).
3. Return error. Outer finally releases the connection.
4. The advisory lock is implicitly released when the connection is
   returned to the pool (GET_LOCK is session-scoped, and the next
   pool user would be a different session).

Wait — MySQL advisory locks are held by the SESSION until
RELEASE_LOCK or connection close. When the connection is returned to
the pool, is the session closed or reused?

`mysql2/promise` pool keeps sessions alive. So the advisory lock
WOULD persist if the connection is reused. The outer `finally` block
at line 290-291 calls `RELEASE_LOCK`, so this is safe on the
success path, but the `beginRestoreMaintenance() returns false`
early-return at line 272 bypasses that outer finally's RELEASE.

Actually, re-reading: line 259 opens the connection, line 292 outer
finally releases it. The RELEASE_LOCK at line 290 is inside the inner
try/finally, which only fires after `beginRestoreMaintenance()` succeeds
(line 275).

**Bug:** If `beginRestoreMaintenance()` returns false at line 272,
the inner try block is SKIPPED, so `RELEASE_LOCK` never runs. The
advisory lock remains held by this pool connection until the
connection is actually closed (pool eviction, server restart, or the
next legitimate RELEASE_LOCK call — but there is no such call).

Next restore attempt from another admin: GET_LOCK returns 0 (held by
a dead/unused pool connection), returns "restore in progress" forever
until the pool evicts the connection.

**Severity:** MEDIUM (latent deadlock on rare failure path)
**Confidence:** HIGH
**Recommendation:** release the lock BEFORE the early-return, OR
restructure so the inner try/finally begins immediately after
GET_LOCK acquires.

**Note:** `beginRestoreMaintenance()` returns false only if already
active — i.e., a previous restore still holds the maintenance flag.
In practice, this almost never fires on the first attempt because
the flag is cleared by `endRestoreMaintenance` in the outer finally
of that previous restore. The bug is real but has low real-world
probability. Still worth fixing.

### D7-09 — `escapeCsvField` formula prefix is a SINGLE quote (`'`),
not a tab. OWASP recommends either `'` or tab-prefix. Single quote
is standard. OK.

**File:** `apps/web/src/lib/csv-escape.ts:19`

**Severity:** INFORMATIONAL
**Confidence:** HIGH

## Summary

9 findings. 1 MEDIUM (D7-01 CSV leading-CRLF formula bypass), 1
MEDIUM (D7-08 restore advisory-lock leak on rare early-return path),
rest LOW/INFORMATIONAL.
