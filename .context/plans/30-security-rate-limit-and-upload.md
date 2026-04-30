# Plan 30: Security — Rate-Limit TOCTOU and Upload Batch Bypass

**Priority:** HIGH
**Estimated effort:** 1-2 hours
**Sources:** SEC-01 (U-01), SEC-04 (U-02)
**Status:** COMPLETED (cycle 1, commits f9f0566)

---

## Scope
- Fix search rate-limit TOCTOU (same pattern as previously fixed login TOCTOU)
- Fix per-file upload invocation that bypasses batch limits

---

## Item 1: Fix search rate-limit TOCTOU (U-02)

**File:** `apps/web/src/app/actions/public.ts:55-60`

**Problem:** The in-memory rate limit check (line 41) and increment (line 57-58) are separated by the DB-backed check which yields the event loop. Concurrent requests can pass the check before any of them increment.

**Fix:** Move the in-memory increment before the DB-backed check, matching the pattern from the login fix (commit 1036d7b). If the DB check fails (rate limited), the in-memory count was already incremented which is fine — it just means the in-memory count is slightly ahead, which is conservative.

```typescript
// Increment BEFORE the DB check (TOCTOU fix)
if (!entry || entry.resetAt <= now) {
    searchRateLimit.set(ip, { count: 1, resetAt: now + SEARCH_WINDOW_MS });
} else {
    entry.count++;
}

// DB-backed check for accuracy across restarts
try {
    const dbLimit = await checkRateLimit(ip, 'search', SEARCH_MAX_REQUESTS, SEARCH_WINDOW_MS);
    if (dbLimit.limited) {
        return [];
    }
} catch {
    // DB unavailable — rely on in-memory Map
}

incrementRateLimit(ip, 'search', SEARCH_WINDOW_MS).catch(() => {});
```

---

## Item 2: Fix per-file upload batch limit bypass (U-01)

**File:** `apps/web/src/components/upload-dropzone.tsx:86-121`

**Problem:** The client sends each file as a separate `uploadImages(formData)` call with 1 file per FormData. The server's batch-level validations (`files.length > 100`, `totalSize > MAX_TOTAL_UPLOAD_BYTES`) are never triggered because each call has exactly 1 file.

**Fix Option A (preferred — server-side):** Add a server-side session-level upload quota in `uploadImages`. Track cumulative upload count/bytes per admin session within a time window.

**Fix Option B (client-side):** Change `handleUpload` to send all files in a single `uploadImages` call. This is simpler but means a single large FormData (potentially 10GB).

**Chosen approach:** Option A — add a lightweight server-side upload tracker:

```typescript
// In actions/images.ts — module-level upload tracking
const uploadTracker = new Map<string, { count: number; bytes: number; windowStart: number }>();
const UPLOAD_TRACKING_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function uploadImages(formData: FormData) {
    // ... existing admin check ...

    const ip = getClientIp(await headers());
    const now = Date.now();
    const tracker = uploadTracker.get(ip) || { count: 0, bytes: 0, windowStart: now };
    if (now - tracker.windowStart > UPLOAD_TRACKING_WINDOW_MS) {
        tracker.count = 0;
        tracker.bytes = 0;
        tracker.windowStart = now;
    }

    // Enforce cumulative limits within the tracking window
    if (tracker.count >= 100) {
        return { error: 'Upload limit reached (max 100 files per hour). Please try again later.' };
    }
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (tracker.bytes + totalSize > MAX_TOTAL_UPLOAD_BYTES) {
        return { error: `Total upload size exceeds ${formatUploadLimit(MAX_TOTAL_UPLOAD_BYTES)} limit per hour` };
    }

    // ... existing upload logic ...

    // Update tracker after successful upload
    tracker.count += successCount;
    tracker.bytes += totalSize;
    uploadTracker.set(ip, tracker);
}
```

---

## Deferred Items

None — all findings from the security review are either planned or already resolved.
