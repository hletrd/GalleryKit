# Plan 33: Rate-Limit TOCTOU Fix (updatePassword) and Upload Tracker Hardening

**Priority:** HIGH
**Estimated effort:** 1-2 hours
**Sources:** C2-01, C2-02, C2-04
**Status:** COMPLETED (cycle 2, commit 98765ec)

---

## Scope
- Fix updatePassword rate-limit TOCTOU (same pattern as login/search fixes)
- Add pruning and size cap to uploadTracker
- Separate in-memory Map for password change rate limiting

---

## Item 1: Fix updatePassword rate-limit TOCTOU (C2-02)

**File:** `apps/web/src/app/actions/auth.ts:209-265`

**Problem:** The `updatePassword` function checks the rate limit (line 214-215) and then performs the expensive Argon2 verify before incrementing (line 258-265). Concurrent password change attempts can all pass the check before any of them record the attempt. This is the same TOCTOU pattern that was fixed for login (commit 1036d7b) and search (commit f9f0566).

**Fix:** Move the in-memory increment before the Argon2 verify, matching the login fix pattern. If the password is correct, roll back the increment.

```typescript
// After the check (lines 214-215), add pre-increment:
// ── Increment rate limit BEFORE the expensive Argon2 verify (TOCTOU fix) ──
try {
    limitData.count += 1;
    limitData.lastAttempt = now;
    loginRateLimit.set(ip, limitData);
    await incrementRateLimit(ip, 'password_change', LOGIN_WINDOW_MS);
} catch (err) {
    console.debug('Failed to pre-increment password change rate limit:', err);
}

// Then in the !match branch, REMOVE the existing increment (since it's already done)
// In the match branch, add rollback:
try {
    await clearSuccessfulPasswordAttempts(ip);
} catch (err) {
    console.error('Failed to reset password change rate limit for IP:', ip, err);
}
```

Also create a `clearSuccessfulPasswordAttempts` function in `auth-rate-limit.ts` that resets the `'password_change'` DB bucket.

---

## Item 2: Add pruning and size cap to uploadTracker (C2-01)

**File:** `apps/web/src/app/actions/images.ts:20-21`

**Problem:** The `uploadTracker` Map grows unboundedly. Each unique upload IP adds an entry that is only reset (not deleted) when its 1-hour window expires. Over weeks of operation, this Map can accumulate thousands of stale entries.

**Fix:** Add a size cap and prune expired entries on each `uploadImages` call:

```typescript
const UPLOAD_TRACKER_MAX_KEYS = 2000;

// In uploadImages, before the tracker lookup, prune expired entries:
if (uploadTracker.size > UPLOAD_TRACKER_MAX_KEYS / 2) {
    for (const [key, entry] of uploadTracker) {
        if (now - entry.windowStart > UPLOAD_TRACKING_WINDOW_MS * 2) {
            uploadTracker.delete(key);
        }
    }
}
```

Also integrate with the hourly GC in `image-queue.ts` bootstrap:
```typescript
// In the gcInterval callback, add:
pruneUploadTracker().catch(err => console.debug('pruneUploadTracker failed:', err));
```

Export a `pruneUploadTracker` function from `images.ts`:
```typescript
export function pruneUploadTracker() {
    const now = Date.now();
    for (const [key, entry] of uploadTracker) {
        if (now - entry.windowStart > UPLOAD_TRACKING_WINDOW_MS * 2) {
            uploadTracker.delete(key);
        }
    }
}
```

---

## Item 3: Separate in-memory Map for password change rate limiting (C2-04)

**File:** `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/auth.ts`

**Problem:** `updatePassword` shares `loginRateLimit` (the in-memory Map) with login. This means 5 failed password changes will lock out login too via the in-memory Map, even though the DB check is separate. The coupling is confusing.

**Fix:** Add a separate `passwordChangeRateLimit` Map in `auth-rate-limit.ts`:

```typescript
export const passwordChangeRateLimit = new Map<string, RateLimitEntry>();

export function getPasswordChangeRateLimitEntry(ip: string, now: number): RateLimitEntry {
    const entry = passwordChangeRateLimit.get(ip) ?? { count: 0, lastAttempt: 0 };
    if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
        entry.count = 0;
    }
    return entry;
}

export function clearSuccessfulPasswordAttempts(ip: string) {
    passwordChangeRateLimit.delete(ip);
    await resetRateLimit(ip, 'password_change', LOGIN_WINDOW_MS);
}
```

Then update `auth.ts:updatePassword` to use `passwordChangeRateLimit` instead of `loginRateLimit`.

---

## Deferred Items

None — all security and correctness findings are planned above.
