# Code Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** code-reviewer (code quality, logic, SOLID, maintainability)
**Scope:** all app-side source, with focus on the cycle-6-rpl landing
changes (CSV extract, tmp cleanup logging, lint-gate recursion,
rate-limit rollback symmetry, redundant revalidate drop, TRUST_PROXY
docs, advisory-lock docs).
**Agent-fanout note:** The Task/Agent tool is not exposed as a named
fan-out primitive in this environment (carried over from cycle 5/6).
Per orchestrator "skip any that are not registered" clause, the
reviewer role scans directly and writes one file per role.

## Inventory sweep

- `apps/web/src/app/actions/` — `images.ts`, `public.ts`, `sharing.ts`,
  `admin-users.ts`, `auth.ts`, `topics.ts`, `tags.ts`, `settings.ts`,
  `seo.ts`.
- `apps/web/src/app/[locale]/admin/db-actions.ts` (CSV export + dump +
  restore).
- `apps/web/src/lib/*` — csv-escape, rate-limit, data, image-queue,
  action-guards, process-image, session, sql-restore-scan,
  upload-tracker, audit, revalidation.
- `apps/web/scripts/check-action-origin.ts`,
  `apps/web/scripts/check-api-auth.ts`.
- `apps/web/src/__tests__/*` — covered primarily by test-engineer role.
- `README.md`, `CLAUDE.md`, plan directory (design-intent audit).

## Findings

### CR7-01 — `rollbackShareRateLimit` deletes entry when the bucket is
exactly at count === 1, even if other concurrent callers incremented the
same bucket during the rollback

**File:** `apps/web/src/app/actions/sharing.ts:69-77`

```ts
function rollbackShareRateLimit(ip: string, scope: ShareRateLimitScope) {
    const key = getShareRateLimitKey(ip, scope);
    const currentEntry = shareRateLimit.get(key);
    if (currentEntry && currentEntry.count > 1) {
        currentEntry.count--;
        return;
    }
    shareRateLimit.delete(key);
}
```

When `count === 1` the function deletes the entry wholesale — but
between `checkShareRateLimit` (which already set count=1 via the
pre-increment) and the rollback, a second concurrent caller could have
incremented the same bucket. Node event-loop atomicity in
single-request/thread environments makes this vanishingly rare for
server actions (one-at-a-time per action call), but the same-IP-same-
scope bucket is shared across concurrent invocations. A perfectly-timed
second caller between `pre-increment count → 2` and `rollback on the
first caller` would execute `count > 1` → `count-- → 1`, which is
correct.  However if the first caller re-reads `currentEntry` bound to
the pre-rollback state (no), the deletion path is never hit in practice.

**Severity:** LOW (theoretical)
**Confidence:** MEDIUM
**Recommendation:** no code change; document invariant in comment.

### CR7-02 — `createGroupShareLink` returns before rolling back DB
rate-limit on validation errors that happen AFTER the pre-increment
block finishes

**File:** `apps/web/src/app/actions/sharing.ts:240-294`

The early-return paths inside the `while (retries < 5)` loop at lines
291 and 294 (`return { error: t('failedToCreateGroup') }`) fire on
non-retryable errors that are NOT `ER_NO_REFERENCED_ROW_2` and NOT
`ER_DUP_ENTRY`. These paths do NOT roll back either rate-limit counter
— the admin is charged a rate-limit "attempt" for a DB error that
wasn't their fault (infrastructure failure, not quota consumption).

The symmetric-rollback design in C6R-RPL-03 addresses over-limit and
FK-miss cases; generic SQL errors are the remaining asymmetric path.

**Severity:** LOW (minor UX drift on infra failure)
**Confidence:** HIGH
**Recommendation:** roll back both counters on generic non-retryable
errors inside the try/catch (`failedToCreateGroup`/`failedToGenerateKey`
paths in `createPhotoShareLink` too).

### CR7-03 — `scanFd.read` and `fd.read` in `db-actions.ts` don't check
`bytesRead` — prior cycle-6-rpl finding D6-07 flagged this

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:321-326,
340-342`

```ts
await fd.read(headerBuf, 0, 256, 0);
// headerBytes derived from a 256-byte Buffer.alloc — but if the file
// is shorter than 256 bytes, trailing zero bytes are included in
// toString('utf8')
const headerBytes = headerBuf.toString('utf8');
```

The restore path validates file size via `file.size > MAX_RESTORE_SIZE_BYTES`
but does not guarantee `size >= 256`. A ≤255-byte upload would have
trailing `\0` bytes in `headerBytes`, which would typically still match
one of the valid header regexes (since `trimStart()` doesn't strip NULL
bytes and `/^(--)|(CREATE\s)/.test()` looks at the prefix). Not a
security hole — but leads to false-valid on a truncated/corrupt upload.

Same issue at the scan-loop site: `scanFd.read(chunkBuf, 0, readSize, off)`
is followed by `chunkBuf.toString('utf8')` without checking that
bytesRead === readSize. A short read (unusual but possible on some
filesystems) would leave uninitialized bytes in the buffer's tail —
however Node allocates zeroed buffers via `Buffer.alloc`, so the tail is
zeros, which is safe.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** capture `const { bytesRead } = await fd.read(...)`
and slice to `bytesRead` before `toString`.

### CR7-04 — `discoverActionFiles` hard-codes `app/[locale]/admin/db-actions.ts`
but does not validate the file exists at scan time

**File:** `apps/web/scripts/check-action-origin.ts:82-94`

```ts
found.push(path.join(REPO_SRC, 'app/[locale]/admin/db-actions.ts'));
```

`checkActionFile` at 231-237 does a fs.existsSync check and fails the
scan with "MISSING FILE" if the db-actions file is removed. That's
correct — but if the file is *renamed* (e.g., moved into the actions/
directory), the scanner would both:
1. Find it via the recursive walk, AND
2. Print "MISSING FILE" for the stale hard-coded path.

Both branches together would double-fail. A future refactor that moves
db-actions.ts under `actions/admin/` should drop this hard-coded line.

**Severity:** LOW (just a cleanup consideration)
**Confidence:** HIGH
**Recommendation:** keep as-is; document in comment that the
hard-coded path is a known hazard if the file moves.

### CR7-05 — `cleanOrphanedTmpFiles` uses `console.info` at the bootstrap
hot-path even when zero `.tmp` files were discovered

**File:** `apps/web/src/lib/image-queue.ts:29,42`

```ts
if (tmpFiles.length === 0) continue;
// ...
console.info(`[Cleanup] Removed ${removed} orphaned .tmp files from ${dir}`);
```

The `continue` early-return means zero-tmp-files logs nothing, which is
fine. But the `info`-level log fires on every restart for non-zero
counts, which will be normal in busy environments. Consider whether
`info` or `debug` is the right level given that the queue logs are
already `debug` for routine success paths (line 150, 192, 252, 261).

**Severity:** LOW (cosmetic)
**Confidence:** MEDIUM
**Recommendation:** downgrade the non-failure case to `debug`, keep
failures at `warn`.

### CR7-06 — `publicSelectFields` spread-based omission relies on
identical JS identifier names across schema field naming

**File:** `apps/web/src/lib/data.ts:161-181`

The destructure at 161 uses exact field names (`latitude`, `longitude`,
`filename_original`, `user_filename`, `original_format`,
`original_file_size`, `processed`) each with `// eslint-disable-next-line
@typescript-eslint/no-unused-vars` comments. If a schema rename occurs
(e.g., `latitude` → `gps_lat`), the `adminSelectFields` entry name would
change but the destructure would still reference the old name. The
`_PrivacySensitiveKeys` type-guard would catch the LEAK (assuming the
dev also updated `_PrivacySensitiveKeys`), but the build would fail at
destructure level first — so the guard is self-healing in practice.

**Severity:** LOW (informational)
**Confidence:** HIGH
**Recommendation:** no change needed; the TS destructure + type guard
form a dual-fence.

### CR7-07 — `escapeCsvField` import in `db-actions.ts` is grouped with
comments but the `// escapeCsvField moved to ...` paragraph is long

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:27-30`

```ts
// escapeCsvField moved to `@/lib/csv-escape` so it can be unit-tested
// without the `'use server'` async-only constraint (C6R-RPL-06 / AGG6R-11).
// Re-import here to keep the existing call site unchanged.
import { escapeCsvField } from "@/lib/csv-escape";
```

Minor: the import block above already imports from `@/lib/csv-escape`;
the explanatory block is redundant against the source-file header.

**Severity:** LOW (cosmetic)
**Confidence:** HIGH
**Recommendation:** leave as-is; audit-trail comments are valuable.

### CR7-08 — `getNextFlushInterval` in `data.ts` is not exported or
tested in isolation

**File:** `apps/web/src/lib/data.ts:22-26`

`getNextFlushInterval()` is a pure function (only reads module-level
`consecutiveFlushFailures`). Not exported → cannot unit test its
backoff progression. Previous cycles identified this as AGG6R-15; it
remains deferred per the cycle 6 aggregate.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** out of scope for this cycle; already tracked as
deferred.

### CR7-09 — `checkActionSource` returns a CheckReport that CLI flattens
into pass/fail/skip lines — no structured aggregate JSON for CI

**File:** `apps/web/scripts/check-action-origin.ts:148-227`

The CLI entry prints human-readable lines. A future CI that wants to
compute e.g. "regression in number of skipped actions since
last cycle" would need to parse stdout text. A structured
`--json` mode would future-proof this but is not blocking.

**Severity:** LOW (enhancement)
**Confidence:** HIGH
**Recommendation:** defer; not required.

### CR7-10 — `pruneShareRateLimit` evicts in Map insertion order
(FIFO), not LRU — same pattern as `viewCountBuffer`

**File:** `apps/web/src/app/actions/sharing.ts:36-50`

Map iteration is insertion order in ES2015+, so both the expiry sweep
and the FIFO hard-cap are deterministic. But eviction order doesn't
reflect "least recently used" — an active high-traffic IP at the top
of the map could be evicted while a cold 5-second-old IP persists.
Low practical impact given `SHARE_RATE_LIMIT_MAX_KEYS = 500`.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** accept tradeoff; already at low-priority-backlog.

### CR7-11 — `flushGroupViewCounts` re-buffers on failure using a
per-row catch block, but does NOT re-count failed-flush state across
the chunk loop

**File:** `apps/web/src/lib/data.ts:58-96`

The `succeeded` counter is incremented inside the promise resolver, so
after `Promise.all(chunk.map(...))` completes, we know how many succeeded
overall. But if a chunk's Promise.all itself rejects (which it won't
because individual rejections are caught inside the `.catch`), the
outer counter logic would be off. Currently the design is safe because
all rejections are handled per-row.

**Severity:** LOW (informational)
**Confidence:** HIGH
**Recommendation:** no change; the design is defensive.

### CR7-12 — `settleUploadTrackerClaim` is invoked twice in `uploadImages`
at lines 308 and 313 when `failedFiles.length > 0 && successCount === 0`

**File:** `apps/web/src/app/actions/images.ts:307-313`

```ts
if (failedFiles.length > 0 && successCount === 0) {
    settleUploadTrackerClaim(uploadTracker, uploadIp, files.length, totalSize, successCount, uploadedBytes);
    return { error: t('allUploadsFailed') };
}

// Reconcile the pre-claimed quota with the uploads that actually finished.
settleUploadTrackerClaim(uploadTracker, uploadIp, files.length, totalSize, successCount, uploadedBytes);
```

The early return means the second call is only reached on the success
(or partial-success) path. Still, the readability suffers slightly —
a simple `finally`-style reconciliation would unify these paths.

**Severity:** LOW (readability)
**Confidence:** HIGH
**Recommendation:** refactor to a `try/finally` or single-exit pattern.

## Summary

12 findings, all LOW severity. Cycle-6-rpl landings are clean; no new
defects introduced. CR7-02 (asymmetric rollback on generic-error
paths in `sharing.ts`) and CR7-03 (bytesRead check in db-actions scan
loops) are the best candidates for cycle 7 implementation.
