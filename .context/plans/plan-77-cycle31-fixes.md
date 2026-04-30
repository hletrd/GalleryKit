# Plan 77 — Cycle 31 Fixes

**Created:** 2026-04-19 (Cycle 31)
**Status:** Completed

## Overview

Address findings from cycle 31 comprehensive review. One actionable fix plus deferred items.

## Tasks

### Task 1: Fix `dumpDatabase` writeStream flush before resolve [C31-01]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, lines 142-154
**Severity:** LOW, Medium Confidence

The `dump.on('close')` callback resolves the success promise before confirming the writeStream has fully flushed all data to disk. This can cause truncated backup downloads.

**Implementation:**
1. In the `dump.on('close')` callback, add a wait for the writeStream 'finish' event before resolving success.
2. Wrap `getCurrentUser()` / `logAuditEvent()` in try-catch to prevent promise from hanging on audit errors (also fixes C31-05).

```ts
dump.on('close', async (code: number) => {
    if (settled) return;
    settled = true;
    if (code === 0) {
        // Wait for writeStream to finish flushing before resolving
        await new Promise<void>((resolveFinish) => {
            if (writeStream.writableFinished) {
                resolveFinish();
            } else {
                writeStream.on('finish', resolveFinish);
                writeStream.on('error', resolveFinish); // Don't hang on write error
            }
        });
        try {
            const currentUser = await getCurrentUser();
            logAuditEvent(currentUser?.id ?? null, 'db_backup', 'database', DB_NAME, undefined, { filename }).catch(console.debug);
        } catch (err) {
            console.debug('Failed to log audit event for backup:', err);
        }
        resolve({ success: true, filename, url: `/api/admin/db/download?file=${encodeURIComponent(filename)}` });
    } else {
        fs.unlink(outputPath).catch(() => {});
        resolve({ success: false, error: t('backupExitedWithCode', { code }) });
    }
});
```

**Also fixes:** C31-05 (pending promise on getCurrentUser error)

### Task 2: Remove unnecessary `pruneLoginRateLimit` call in password change [C31-03]

**File:** `apps/web/src/app/actions/auth.ts`, line 233
**Severity:** LOW, Low Confidence

The `updatePassword` function calls `pruneLoginRateLimit(now)` even though the password change flow doesn't use the login rate limit map.

**Implementation:**
1. Remove line 233: `pruneLoginRateLimit(now);`

### Task 3: Fix share link retry to only retry on key collision [C31-04]

**File:** `apps/web/src/app/actions/sharing.ts`, lines 106-109 and 182-185
**Severity:** LOW, Low Confidence

Share link creation retries on all exceptions, not just key collisions.

**Implementation:**
1. In `createPhotoShareLink`, modify the catch block (line 106-109) to check for `ER_DUP_ENTRY` before retrying.
2. In `createGroupShareLink`, modify the catch block (line 182-185) to check for `ER_DUP_ENTRY` before retrying.
3. Import `isMySQLError` from `@/lib/validation`.

```ts
// createPhotoShareLink catch block:
} catch (e) {
    // Only retry on key collision (duplicate entry), not on other errors
    if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('Duplicate entry'))) {
        retries++;
        continue;
    }
    // Non-retryable error
    return { error: t('failedToGenerateKey') };
}
```

### Task 4: Fix upload tracker concurrent overwrite [C31-02]

**File:** `apps/web/src/app/actions/images.ts`, lines 247-248
**Severity:** LOW, Low Confidence

The final tracker adjustment uses absolute assignment that overwrites concurrent pre-increment state.

**Implementation:**
1. Replace absolute assignment with additive adjustment:
```ts
// Before:
tracker.count = originalTrackerCount + successCount;
tracker.bytes = originalTrackerBytes + uploadedBytes;

// After:
tracker.count += (successCount - files.length);
tracker.bytes += (uploadedBytes - totalSize);
```

## Completion Criteria

- [x] Task 1: dumpDatabase awaits writeStream flush + audit error resilience
- [x] Task 2: pruneLoginRateLimit removed from updatePassword
- [x] Task 3: Share link retry only on key collision
- [x] Task 4: Upload tracker uses additive adjustment
- [x] All changes GPG-signed and pushed
