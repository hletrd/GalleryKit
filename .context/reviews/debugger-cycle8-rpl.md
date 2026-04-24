# Debugger — Cycle 8 (RPL loop, 2026-04-23)

**Scope:** latent bug surface, failure modes, regression corner cases.

## Findings

### DBG8-01 — Zero-width CSV formula bypass [LOW, HIGH]

Same as CRIT8-01 / S8-03 / Trace 1. Real bypass; admin-only
exposure. Low severity but real.

**Regression risk:** none — cycle-7-rpl fix remains correct for
regular whitespace. Zero-width is a separate class.

### DBG8-02 — `uploadImages` TOCTOU on cold IP [LOW, HIGH]

Same as CR8-01. Finite burst, admin-authenticated. Real concurrency
hole but bounded impact.

### DBG8-03 — `runRestore` tempPath leak on process kill [LOW, LOW]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:317-324`.

**Scenario:** `const tempPath = path.join(os.tmpdir(), ...)`. If
the Node process is killed (SIGKILL) between `createWriteStream`
and the finally-based unlink, the temp file leaks. `os.tmpdir()`
is typically cleaned by the OS on reboot, so long-term leak is
bounded.

**Severity:** LOW, LOW.

**Status:** acknowledged. No fix needed for personal-gallery.

### DBG8-04 — `sharing.ts` rollback drift across window boundary [LOW, LOW]

Same as Trace 5. Sub-second race at the 1-minute window boundary.
Not a real issue.

### DBG8-05 — `restore.on('close')` and `restore.on('error')` race [LOW, MEDIUM]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:432-454`.

**Scenario:** if mysql spawns and exits with error code 1, both
`'error'` (spawn failure) and `'close'` (exit) fire. The `settled`
flag prevents double-resolution, so whichever fires first wins.

**Trace:**
- spawn fails → `'error'` fires first → `failRestore` called →
  `settled = true`.
- 'close' fires with code 1 → `settled` check aborts → no double-resolve.

**Conclusion:** correct handling. No issue.

### DBG8-06 — `escapeCsvField` infinite-loop risk with trailing control chars [LOW, LOW]

**File:** `apps/web/src/lib/csv-escape.ts:25`.

**Scenario:** the control-strip regex is `/g` with a character class.
JS regex is O(n) over the input; no backtracking risk. Safe.

**Status:** no finding.

### DBG8-07 — `purgeOldBuckets` unbatched DELETE table-lock risk [LOW, MEDIUM]

Same as AGG7R-15 deferred. On a multi-year instance with billions
of rate-limit buckets and a missed GC, a single DELETE could lock
the table for minutes.

**Status:** carry-forward deferred.

### DBG8-08 — `cleanOrphanedTmpFiles` ENOENT swallowed by broad catch [LOW, HIGH]

**File:** `apps/web/src/lib/image-queue.ts:48-50`.

**Scenario:** the outer `try/catch` swallows ALL errors, not just
ENOENT. If readdir fails with EACCES (permission denied), we
silently skip the dir without logging. For an ENOENT this is
correct; for EACCES it's an operator concern.

**Severity:** LOW, HIGH.

**Suggested fix:** narrow the catch:
```ts
} catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        // Directory may not exist yet — normal at bootstrap
        return;
    }
    console.warn('[Cleanup] readdir failed for', dir, err);
}
```

### DBG8-09 — `fd.read` `bytesRead` of 0 on empty file [LOW, HIGH]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:338-348`.

**Scenario:** if the uploaded file is empty (0 bytes), `bytesRead`
is 0 and `headerBytes = ''.trimStart()` → empty string. The valid-
header regex `/^(--)|(CREATE\s)|.../` does NOT match empty string,
so we return `invalidSqlDump`. Correct rejection.

**Status:** no finding.

### DBG8-10 — `sharing.ts` retry loop assumes key generation is fast [INFO]

**File:** `apps/web/src/app/actions/sharing.ts:137-186`.

**Scenario:** 5 retries on ER_DUP_ENTRY. `generateBase56(10)` has
58^10 ≈ 4×10^17 keyspace. Collision probability at N=10000 existing
keys is ≈ 10000/4×10^17 ≈ 2.5×10^-14. Essentially zero.

**Status:** retry count is overkill but defensive. No finding.

## Summary

DBG8-01, DBG8-02 are real findings (overlapping with prior reviewers).
DBG8-08 is a narrow-the-catch polish. The rest are either verified
correct or acknowledged-deferred.
