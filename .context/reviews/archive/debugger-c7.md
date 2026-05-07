# Debuggability & Observability Review — Cycle 7

## Summary

Logging is defensive and informative. Error messages are generally actionable. A few gaps in distributed tracing and error context remain.

---

## C7-DEBUG-01: `image-queue.ts` permanent failure logs image ID but not failure reason — Medium

**File:** `apps/web/src/lib/image-queue.ts`
**Lines:** ~340-345

**Finding:** When an image permanently fails processing, the log includes the image ID but not the underlying error message or stack trace. Over time, operators see "Image N permanently failed" without knowing WHY (disk full? Sharp crash? DB timeout?).

**Fix:** Include the last error message (truncated to 200 chars) in the permanent failure log:
```typescript
console.error(`[Queue] Image ${imageId} permanently failed after ${MAX_RETRIES} retries. Last error: ${lastError}`);
```

**Confidence:** Medium

---

## C7-DEBUG-02: `flushGroupViewCounts` logs aggregate counts but not per-group failures — Low

**File:** `apps/web/src/lib/data.ts`
**Lines:** ~82-87

**Finding:** When a view-count flush fails for a specific group, the error is caught and the increment is re-buffered, but the error itself is swallowed (`.catch(() => {})` on line 87-88 in the `.then().catch()` chain). The retry count is incremented but the actual DB error (connection timeout? constraint violation?) is lost.

**Fix:** Log the DB error at `.catch` time before re-buffering:
```typescript
.catch((err) => {
    console.warn(`[viewCount] Flush failed for group ${groupId}:`, err);
    // ... re-buffer logic
});
```

**Confidence:** Low

---

## C7-DEBUG-03: `rate-limit.ts` does not log when `TRUST_PROXY` is missing — Low

**File:** `apps/web/src/lib/rate-limit.ts`
**Lines:** ~98-99

**Finding:** The `warnedMissingTrustProxy` flag prevents duplicate warnings, but the warning itself only fires when `getClientIp` is called with a request that has `x-forwarded-for` headers AND `TRUST_PROXY` is not set. If the app is deployed behind a proxy and `TRUST_PROXY` is forgotten, the first indication is a single log line that might be buried in startup noise.

**Fix:** Add a startup-time check: if `process.env.TRUST_PROXY` is unset and `process.env.NODE_ENV === 'production'`, log a prominent warning at module load time.

**Confidence:** Low

---

## C7-DEBUG-04: `buildFallbackResponse` in OG route silently redirects without logging — Low

**File:** `apps/web/src/app/api/og/photo/[id]/route.tsx`
**Lines:** 188-212

**Finding:** Every fallback path (invalid ID, image not found, fetch failure, oversized buffer) returns a 302 redirect without logging WHY the fallback occurred. In production, operators cannot distinguish between "photo doesn't exist" and "photo fetch timed out" when debugging OG image issues.

**Fix:** Add a `console.warn` before each early return and in `buildFallbackResponse`:
```typescript
console.warn(`[og/photo/${id}] Fallback: ${reason}`);
```

**Confidence:** Low
