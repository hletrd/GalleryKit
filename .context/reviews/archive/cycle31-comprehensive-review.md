# Cycle 31 Comprehensive Review (2026-04-19)

**Reviewer:** Single multi-angle reviewer (code quality, security, performance, architecture, UX)
**Scope:** Full codebase — all action files, library modules, components, schema, middleware, and API routes

---

## Methodology

Reviewed every server action (`auth.ts`, `images.ts`, `topics.ts`, `tags.ts`, `sharing.ts`, `admin-users.ts`, `public.ts`, `db-actions.ts`), all library modules (`data.ts`, `process-image.ts`, `session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `serve-upload.ts`, `sql-restore-scan.ts`, `image-queue.ts`, `validation.ts`, `audit.ts`, `revalidation.ts`, `api-auth.ts`, `upload-limits.ts`), key components (`image-manager.tsx`, `upload-dropzone.tsx`, `admin-user-manager.tsx`, `password-form.tsx`, `dashboard-client.tsx`, `login-form.tsx`), schema, DB connection, middleware, API routes, and i18n files (en.json, ko.json).

---

## Findings

### C31-01: `dumpDatabase` resolves before writeStream finishes flushing [LOW, Medium]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, lines 142-154

The `dump.on('close')` callback resolves the success promise before confirming the writeStream has fully flushed all data to disk. When `dump.stdout.pipe(writeStream)` is used, `writeStream.end()` is called when stdout ends, but the writeStream's 'finish' event (which confirms all data is flushed) may fire asynchronously after the process 'close' event.

**Failure scenario:** A large database backup completes. The dump process exits (code 0). The 'close' callback fires and resolves with `{ success: true, url: ... }`. The client navigates to the download URL. But the writeStream hasn't finished flushing the last megabyte of data, so the downloaded backup file is truncated.

**Fix:** Await the writeStream 'finish' event before resolving success:
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
            }
        });
        // ... resolve success
    }
});
```

---

### C31-02: Upload tracker final adjustment overwrites concurrent pre-increment [LOW, Low]

**File:** `apps/web/src/app/actions/images.ts`, lines 247-248

The final tracker adjustment uses absolute assignment that can overwrite a concurrent request's pre-incremented state for the same IP:
```ts
tracker.count = originalTrackerCount + successCount;
tracker.bytes = originalTrackerBytes + uploadedBytes;
```

If two concurrent uploads from the same IP execute, Request A's final adjustment (using its saved `originalTrackerCount`) overwrites Request B's pre-incremented values. The code already addresses the check-time TOCTOU race with pre-increment (lines 112-119), but the final adjustment introduces a different race.

**Failure scenario:** Two browser tabs from the same admin IP upload concurrently. Tab A pre-increments tracker to count=3. Tab B reads count=3 and pre-increments to count=6. Tab A finishes and sets tracker.count = 0 + 2 = 2 (overwriting Tab B's increment). The cumulative limit is now under-counted.

**Fix:** Use additive adjustment instead of absolute assignment:
```ts
tracker.count += (successCount - files.length);
tracker.bytes += (uploadedBytes - totalSize);
uploadTracker.set(uploadIp, tracker);
```
This adjusts only the delta (actual vs. pre-incremented), preserving concurrent requests' contributions.

---

### C31-03: Unnecessary `pruneLoginRateLimit` call in password change flow [LOW, Low]

**File:** `apps/web/src/app/actions/auth.ts`, line 233

The `updatePassword` function calls `pruneLoginRateLimit(now)` even though the password change flow doesn't use the login rate limit map. This performs an O(n) scan of the login rate limit entries on every password change attempt, which is wasteful and confusing for maintainers.

**Failure scenario:** No functional impact. A developer reading the code might assume the login rate limit is used for password changes, causing confusion about the rate-limiting architecture.

**Fix:** Remove the `pruneLoginRateLimit(now)` call on line 233. The `prunePasswordChangeRateLimit(now)` call on line 234 is the correct one.

---

### C31-04: Share link creation retries on all exceptions, not just key collisions [LOW, Low]

**File:** `apps/web/src/app/actions/sharing.ts`, lines 106-109 and 182-185

Both `createPhotoShareLink` and `createGroupShareLink` have retry loops that catch ALL exceptions and retry with a new key. The retry is intended for key collisions (unique constraint violations), but non-retryable errors like DB connection failures, deadlocks, or disk full errors also trigger retries.

**Failure scenario:** The database is temporarily unreachable. An admin creates a share link. The function tries 5 times with different keys, each time getting a connection error, before giving up. This wastes 5 connection attempts and delays the error response.

**Fix:** Inspect the caught error and only retry on unique constraint violations. For other errors, propagate immediately:
```ts
catch (e) {
    if (isMySQLError(e) && e.code === 'ER_DUP_ENTRY') {
        retries++;
        continue;
    }
    // Non-retryable error — propagate immediately
    return { error: t('failedToGenerateKey') };
}
```

---

### C31-05: `dumpDatabase` close callback can leave promise pending on `getCurrentUser()` error [LOW, Low]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, lines 142-154

The async `dump.on('close')` callback sets `settled = true` at line 144 before `await getCurrentUser()` at line 146. If `getCurrentUser()` throws an unexpected error (e.g., DB connection lost between the mysqldump completing and the audit log call), the `resolve` is never reached and the outer Promise hangs forever. The client would see the request time out instead of receiving a success response.

**Failure scenario:** A large backup completes successfully (mysqldump exits 0). The writeStream finishes. But between the dump completing and the audit log call, the DB connection pool is exhausted. `getCurrentUser()` throws. The promise never resolves. The admin's HTTP request hangs until the browser times out.

**Fix:** Wrap the `getCurrentUser()` and `logAuditEvent()` calls in a try-catch so errors there don't prevent the success resolve:
```ts
try {
    const currentUser = await getCurrentUser();
    logAuditEvent(...).catch(console.debug);
} catch (err) {
    console.debug('Failed to log audit event for backup:', err);
}
resolve({ success: true, filename, url: ... });
```

---

## Previously Fixed (Confirmed)

All cycle 1-30 findings remain resolved. Specifically verified:
- C30-01: `deleteGroupShareLink` now uses `t('failedToDeleteGroup')` (sharing.ts:244) — FIXED
- C30-02: `PASSWORD_CHANGE_MAX_ATTEMPTS = 10` is now in auth-rate-limit.ts:56 — FIXED
- C30-09: `createAdminUser`/`deleteAdminUser` now revalidate `/admin/users` (admin-users.ts:51,88) — FIXED
- C30-05: `purgeOldAuditLog` precedence logic is now clear with if/else structure (audit.ts:46-54) — FIXED

No regressions detected.

---

## Deferred Carry-Forward

All previously deferred items from cycles 5-29 remain deferred with no change in status:
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04: `createGroupShareLink` insertId validation inside transaction
- C30-06: Tag slug regex inconsistency
- C30-08: Health endpoint DB disclosure

---

## Totals

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **5 LOW** findings (1 actionable, 4 minor)
- **5 total** findings
