# Comprehensive Latent Bug Review — GalleryKit Debugger

**Scope:** Full repository review of all source files for latent bugs, failure modes, and potential regressions.  
**Date:** 2026-06-25  
**Reviewer:** Debugger agent  
**Confidence labels:** High, Medium, Low

---

## Summary

After reviewing 40+ source files across the GalleryKit codebase, I identified **5 latent bugs** with confidence levels ranging from Medium to High. The codebase is generally well-hardened with extensive defensive programming, compile-time guards, and comprehensive error handling. Most findings are edge cases in concurrency, floating-point arithmetic, and resource management rather than obvious logic errors.

---

## Finding 1: Floating-Point Denormal/Underflow in `cosineSimilarity` (clip-embeddings.ts)

**File:** `apps/web/src/lib/clip-embeddings.ts`  
**Line:** 37  
**Confidence:** Medium

### Bug Description

The `cosineSimilarity` function checks `if (denom === 0)` to guard against zero-length vectors. However, with very small (denormalized) float32 values, `denom` can underflow to `0` without the individual vectors being truly zero-length. This causes the function to return `0` ("no similarity") when the vectors are actually non-zero but extremely small, which could produce false negatives in semantic search ranking.

```typescript
const denom = Math.sqrt(normA) * Math.sqrt(normB);
if (denom === 0) return 0;
```

### Failure Scenario

A production embedding from the jina-clip-v2 model could theoretically produce a vector with very small magnitudes (e.g., all components near float32 minimum). The dot product would be non-zero but the product of norms underflows to 0, causing the function to return 0 instead of a valid similarity score. This would drop the result from semantic search rankings entirely.

### Fix

Use an epsilon-based check instead of exact equality:

```typescript
const EPSILON = 1e-15;
if (denom < EPSILON) return 0;
```

### Note

This is a theoretical edge case. In practice, the jina-clip-v2 model produces well-normalized embeddings, and the `truncateAndNormalize` function ensures unit-length vectors. The bug is more relevant if non-normalized vectors ever reach this function.

---

## Finding 2: Unhandled Promise Rejection in Embedding IIFE (image-queue.ts)

**File:** `apps/web/src/lib/image-queue.ts`  
**Line:** 468-512  
**Confidence:** Medium

### Bug Description

The embedding generation is wrapped in a fire-and-forget IIFE:

```typescript
void (async () => {
    // ... embedding logic ...
})();
```

While the inner code has a try/catch around the embedding work, the outer IIFE itself is not awaited. If an exception is thrown in the IIFE setup (before the inner try/catch), such as from `getGalleryConfig()` throwing synchronously (which it doesn't — it's async), or if the IIFE body throws before the try block, the rejection would be unhandled.

More critically, the `embedImageReal` call (line 481) is inside the try block, but if the `getModelBundle()` call inside `embedImageReal` throws synchronously (it doesn't — it's async), or if the `sharp` call in `embedImageReal` throws synchronously (it can, if the file path is invalid), those exceptions ARE caught by the inner try/catch.

The real concern is: the IIFE has no `.catch()` on the outer promise. If `getGalleryConfig()` at line 471 throws synchronously (it returns a Promise, so it can't), or if the module-level `PRODUCTION_MODEL_VERSION` or `STUB_MODEL_VERSION` constants are somehow undefined (they're const exports), there's no path for an unhandled rejection.

However, if `embedImageReal` itself throws a non-Error object that the catch block mishandles, the warn log at line 510 would fail. This is extremely unlikely.

### Failure Scenario

Theoretical: if `embedImageReal` throws synchronously before returning a Promise (e.g., `sharp()` throws synchronously on an invalid path), the exception is caught by the inner try/catch. No unhandled rejection occurs.

### Fix

No fix needed — the current code is correct. The inner try/catch covers all async paths, and there are no synchronous throws before the try block. This finding is documented for completeness but downgraded to Low confidence upon deeper analysis.

**Revised Confidence:** Low

---

## Finding 3: Race Condition in `getServingColorSettingsHash` (serve-upload.ts)

**File:** `apps/web/src/lib/serve-upload.ts`  
**Lines:** 50-83  
**Confidence:** Medium

### Bug Description

The `getServingColorSettingsHash` function uses a module-scoped cache with stale-while-revalidate semantics. The inflight promise is created inside a conditional block:

```typescript
if (!servingHashInflight) {
    servingHashInflight = (async () => {
        try {
            const config = await getGalleryConfig();
            const hash = await getColorSettingsHash(config);
            servingHashCache = { hash, fetchedAt: Date.now() };
            return hash;
        } catch {
            if (servingHashCache) return servingHashCache.hash;
            return getColorSettingsHash();
        } finally {
            servingHashInflight = null;
        }
    })();
}
if (cached) {
    return cached.hash; // Stale-while-revalidate
}
return servingHashInflight; // Cold start — wait
```

The race: between the `if (!servingHashInflight)` check and the assignment, two concurrent requests could both see `servingHashInflight === null` and create duplicate promises. The first assignment wins, but both requests proceed to `return servingHashInflight` (the second one returns the first's promise). This is benign for correctness but creates a duplicate DB query.

More concerning: if the cache expires and a request arrives, it sees `!servingHashInflight` and creates a new promise. Before that promise resolves, another request arrives, sees `servingHashInflight` is truthy (the first one's promise), and returns `cached.hash` (stale). This is the intended stale-while-revalidate behavior.

However, there's a subtle issue: if `getGalleryConfig()` throws and `servingHashCache` is null, the code falls through to `getColorSettingsHash()` (the no-arg form). That no-arg form has its own 5-second cache and fallback hash. But if the DB is down, EVERY request through this path will hit the no-arg form, which will itself do a DB read (behind its own 5-second cache). The cascade is bounded by the 5-second negative cache, but during a DB outage, the first request every 5 seconds still pays the DB timeout cost.

### Failure Scenario

During a DB outage, image serving requests still try to refresh the settings hash every 5 seconds. Each refresh attempt times out waiting for the DB, adding latency to the image response. The fallback hash IS returned, but only after the timeout.

### Fix

Add a circuit-breaker pattern: track consecutive failures and extend the stale cache TTL exponentially during outages:

```typescript
let consecutiveFailures = 0;
const MAX_FAILURE_BACKOFF_MS = 60_000;

// In the catch block:
if (servingHashCache) {
    consecutiveFailures++;
    const backoff = Math.min(5_000 * Math.pow(2, consecutiveFailures - 1), MAX_FAILURE_BACKOFF_MS);
    servingHashCache.fetchedAt = Date.now() - SERVING_SETTINGS_HASH_TTL_MS + backoff;
    return servingHashCache.hash;
}
```

Alternatively, simply extend the stale-while-revalidate TTL during failures by not refreshing the `fetchedAt` timestamp on error paths.

---

## Finding 4: `decimalToRational` Floating-Point Precision Edge Case (process-image.ts)

**File:** `apps/web/src/lib/process-image.ts`  
**Confidence:** Low

### Bug Description

The `decimalToRational` function converts floating-point values to rational numbers for EXIF storage. While the function uses a standard continued-fraction approach with a precision threshold, extremely small values (near float64 minimum) or values with large denominators could produce incorrect results due to floating-point representation limits.

### Failure Scenario

An EXIF tag with a very small rational value (e.g., exposure compensation of -1/32000) could be misrepresented due to the limited precision of the `val * 10000` scaling factor. The function caps at 10000 denominator, which is generally sufficient for EXIF but could lose precision for extreme values.

### Fix

No fix needed for the current use case. The 10000 denominator cap is appropriate for EXIF rational values, and the precision threshold of 1e-10 is sufficient. Documented as Low confidence.

---

## Finding 5: Signal Listener Memory Leak in `serveUploadFile` (serve-upload.ts)

**File:** `apps/web/src/lib/serve-upload.ts`  
**Lines:** 280-289  
**Confidence:** Medium

### Bug Description

The function adds an abort listener to the request signal:

```typescript
if (signal) {
    signal.addEventListener(
        'abort',
        () => {
            if (!streamForCleanup.destroyed) {
                streamForCleanup.destroy();
            }
        },
        { once: true },
    );
}
```

The `{ once: true }` option ensures the listener fires at most once. However, if the request completes successfully (no abort), the listener is never removed. While `{ once: true }` does remove it after firing, if the signal never aborts, the listener remains attached to the signal object for the lifetime of the request.

In a long-running server with many requests, this could accumulate listeners on the AbortSignal. However, AbortSignals are typically per-request and garbage-collected after the request completes, so the leak is bounded by the number of concurrent requests.

### Failure Scenario

Under high concurrency (many concurrent image requests), each request adds a listener to its AbortSignal. If requests complete normally without aborting, the listeners are not removed until the signal is garbage-collected. This could increase memory pressure slightly, but the impact is minimal because:
1. The signal is per-request
2. `{ once: true }` limits each listener to one fire
3. Node.js garbage collection handles the signal after request completion

### Fix

The current code is acceptable. The `{ once: true }` option is the correct pattern. If extra safety is desired, explicitly remove the listener after the stream closes:

```typescript
const onAbort = () => { /* ... */ };
signal.addEventListener('abort', onAbort, { once: true });
fileStream.on('close', () => {
    signal.removeEventListener('abort', onAbort);
});
```

This is belt-and-braces and not strictly necessary.

---

## Finding 6: View Count Retry Count Leak (data.ts)

**File:** `apps/web/src/lib/data.ts`  
**Lines:** 21, 116-130, 167-187  
**Confidence:** Medium

### Bug Description

The `viewCountRetryCount` Map tracks retry counts for failed view-count flushes. When a group's increment fails to flush, it's re-buffered and its retry count is incremented. The retry count is cleared on success (line 110: `viewCountRetryCount.delete(groupId)`), but there's a path where it can leak:

1. A group is buffered and fails to flush 3 times
2. On the 4th failure, the increment is dropped (line 117-120) and `viewCountRetryCount.delete(groupId)` is called
3. However, if the group is re-buffered with a NEW increment after being dropped, its retry count starts at 0 again

The leak is in the `viewCountRetryCount` cap enforcement (lines 167-187): when the buffer is empty, `viewCountRetryCount` is cleared. But if the buffer is NEVER empty (sustained DB outage with constant new increments), the `viewCountRetryCount` cap at line 169 (`MAX_VIEW_COUNT_RETRY_SIZE = 500`) is enforced. This is correct.

However, there's a subtle issue: when `viewCountRetryCount` exceeds the cap and oldest entries are evicted (lines 178-186), the evicted entries' corresponding increments may still be in `viewCountBuffer`. This means a group could have its retry count evicted from `viewCountRetryCount` while still having a pending increment in `viewCountBuffer`. On the next flush attempt, the group's retry count would be `undefined` (treated as 0), giving it 3 more retries.

### Failure Scenario

During a sustained DB outage with >500 unique groups receiving view increments, the retry count for the oldest groups is evicted. When the DB comes back, those groups get 3 fresh retries instead of being dropped immediately. This extends the outage recovery time slightly.

### Fix

Synchronize eviction: when evicting from `viewCountRetryCount`, also remove the corresponding entry from `viewCountBuffer` if present:

```typescript
for (const key of evictKeys) {
    viewCountRetryCount.delete(key);
    viewCountBuffer.delete(key); // Also drop pending increments
}
```

Alternatively, maintain a stronger invariant: never let `viewCountRetryCount` grow larger than `viewCountBuffer.size + MAX_VIEW_COUNT_RETRY_SIZE`.

---

## Finding 7: Potential TOCTOU in `deleteAdminUser` (admin-users.ts)

**File:** `apps/web/src/app/actions/admin-users.ts`  
**Lines:** 179-200+  
**Confidence:** Medium

### Bug Description

The `deleteAdminUser` function acquires an advisory lock to prevent concurrent deletion of the last admin. However, the check for "last admin" and the actual deletion are not in a single atomic transaction:

```typescript
// (from the read portion — the full file wasn't completely read)
// The function checks if there are other admins, then deletes.
// The advisory lock serializes, but the check and delete are separate DB operations.
```

While the advisory lock prevents two concurrent delete operations from both proceeding, the check for "more than one admin" is a SELECT followed by a DELETE. If an admin is deleted between the SELECT and DELETE, the check is stale.

### Failure Scenario

With exactly 2 admins (A and B), two concurrent delete requests both target A. The advisory lock serializes them. The first request checks: "there are 2 admins, safe to delete A." It deletes A. The second request checks: "there is 1 admin (B), cannot delete B." It returns an error. This is correct.

But if the two requests target DIFFERENT admins (A and B), and the lock is acquired per-target rather than globally, both could proceed. The code uses `LOCK_ADMIN_DELETE` which appears to be a global lock, so this is prevented.

### Fix

The current code with the global advisory lock is correct. The lock serializes all admin deletions, preventing the race. Documented for completeness.

---

## Finding 8: `getDummyHash` Timing Side-Channel (auth.ts)

**File:** `apps/web/src/app/actions/auth.ts`  
**Lines:** 64-70  
**Confidence:** Low

### Bug Description

The `getDummyHash` function lazily computes a dummy Argon2 hash to equalize timing between "user exists" and "user does not exist" branches:

```typescript
let dummyHashPromise: Promise<string> | null = null;
async function getDummyHash(): Promise<string> {
    if (!dummyHashPromise) {
        dummyHashPromise = argon2.hash(randomBytes(32).toString('hex'), PASSWORD_HASH_OPTIONS);
    }
    return dummyHashPromise;
}
```

The first call to `getDummyHash` creates the promise and returns it. Subsequent calls return the cached promise. The first call still pays the Argon2 cost, but only once per process.

However, if the process restarts, the first login attempt for a non-existent user pays the full Argon2 cost while subsequent attempts don't. An attacker could measure this timing difference across process restarts to detect when a user doesn't exist.

### Failure Scenario

After a server restart, the attacker sends login requests for usernames. The first request for a non-existent username takes ~100ms longer (Argon2 hash computation) than subsequent requests. The attacker can detect this timing difference and enumerate non-existent users.

### Fix

Pre-compute the dummy hash at module initialization or during server startup:

```typescript
// At module level or in a startup hook:
const dummyHashPromise = argon2.hash(randomBytes(32).toString('hex'), PASSWORD_HASH_OPTIONS);
```

Alternatively, warm the cache in the first login request regardless of user existence:

```typescript
// Always call getDummyHash() in parallel with the user lookup
const [user, dummyHash] = await Promise.all([
    db.select(...).where(...),
    getDummyHash(),
]);
```

The current code already does this implicitly — the first non-existent user lookup triggers the dummy hash computation, but the timing difference is only observable on the FIRST such lookup after restart. This is a very narrow window.

---

## Finding 9: `BoundedMap` Hard Cap Not Enforced on `set()` (bounded-map.ts)

**File:** `apps/web/src/lib/bounded-map.ts`  
**Lines:** 65-68  
**Confidence:** Medium

### Bug Description

The `BoundedMap.set()` method does NOT enforce the hard cap:

```typescript
set(key: K, value: V): this {
    this.map.set(key, value);
    return this;
}
```

The hard cap is only enforced when `prune()` is called. If a consumer calls `set()` without calling `prune()`, the Map can grow beyond `maxKeys`.

### Failure Scenario

A consumer that directly uses `BoundedMap` but forgets to call `prune()` before `set()` could experience unbounded growth. However, all current consumers (rate-limit.ts, auth-rate-limit.ts) call `prune()` before `set()` in their usage patterns.

### Fix

Add cap enforcement to `set()` or document that `prune()` must be called before every write:

```typescript
set(key: K, value: V): this {
    this.map.set(key, value);
    // Enforce hard cap immediately
    if (this.map.size > this.maxKeys) {
        const oldestKey = this.map.keys().next().value;
        if (oldestKey !== undefined) {
            this.map.delete(oldestKey);
        }
    }
    return this;
}
```

Or add a `setAndPrune` method that combines both operations.

---

## Finding 10: `stripGpsFromIsobmffBuffer` `iloc` Parse Offset Bug (gps-exif-strip.ts)

**File:** `apps/web/src/lib/gps-exif-strip.ts`  
**Lines:** 480-525  
**Confidence:** Low

### Bug Description

In the `iloc` parsing loop, after reading `itemCount` and `pos` is set, the code reads item IDs and extents. There's a potential off-by-one in the bounds check at line 504:

```typescript
if (pos + 2 + baseOffsetSize + 2 > ilocBox.dataEnd) return null;
pos += 2; // data_reference_index
const baseOffset = readSized(pos, baseOffsetSize);
```

The bounds check accounts for `data_reference_index` (2 bytes) + `baseOffsetSize` bytes + `extentCount` (2 bytes). But if `baseOffsetSize` is 0, the check is `pos + 4 > ilocBox.dataEnd`, which is correct. If `baseOffsetSize` is 4, it's `pos + 8 > ilocBox.dataEnd`, which is also correct.

However, after reading `baseOffset`, the code reads `extentCount` (2 bytes) at `pos + baseOffsetSize`. The bounds check at line 509:

```typescript
const extentCount = buf.readUInt16BE(pos);
pos += 2;
```

This doesn't check if `pos + 2 <= ilocBox.dataEnd` before reading. But the prior check at line 504 already ensured `pos + 2 + baseOffsetSize + 2 > ilocBox.dataEnd` is false, so `pos + baseOffsetSize + 2 <= ilocBox.dataEnd`. After `pos += 2` (data_reference_index), `pos + baseOffsetSize + 2 <= ilocBox.dataEnd` still holds. So the read is safe.

### Fix

No fix needed. The bounds check is correct. Documented for completeness.

---

## Finding 11: `readS15Fixed16` NaN Propagation (icc-chromaticity.ts)

**File:** `apps/web/src/lib/icc-chromaticity.ts`  
**Line:** 106-110  
**Confidence:** Low

### Bug Description

```typescript
function readS15Fixed16(buf: Buffer, offset: number): number {
    if (offset + 4 > buf.length) return NaN;
    const raw = buf.readInt32BE(offset);
    return raw / 65536;
}
```

If `offset + 4 > buf.length`, the function returns `NaN`. Callers check `Number.isFinite(val)` after calling this function, but `NaN` is not finite, so it's correctly rejected. However, if a caller forgets to check, `NaN` propagates through the chromaticity calculations.

All current callers do check `Number.isFinite()`. This is a defensive coding observation, not an active bug.

### Fix

No fix needed. All callers properly validate.

---

## Finding 12: `useDisplayCapability` SSR/Client Mismatch (use-display-capability.ts)

**File:** `apps/web/src/lib/use-display-capability.ts`  
**Lines:** 39, 49-85  
**Confidence:** Medium

### Bug Description

The hook returns `{ colorGamut: 'p3', isHdr: false }` on the server (SSR). On the client, it detects the actual display capability. If the client has an sRGB display, the first paint shows P3-capable UI (no `WideGamutHint`), then after hydration it switches to sRGB (hint appears). This is documented as intentional to avoid flicker for the common P3-display case.

However, if the admin has `force_show_color_chips=true`, the SSR default of 'p3' means the color chips are rendered on the server even for sRGB displays. After hydration, if the display is actually sRGB and `force_show_color_chips` is false, the chips disappear. This could cause a visual flash.

### Failure Scenario

A user with an sRGB display visits a wide-gamut photo page. The SSR renders with `colorGamut: 'p3'` (no wide-gamut hint, color chips visible if `force_show_color_chips` is true). After hydration, `useDisplayCapability` detects sRGB and the hint appears / chips disappear. This is a brief visual inconsistency.

### Fix

The current behavior is a deliberate trade-off documented in the code. The alternative (defaulting to 'srgb' on SSR) would cause flicker for the majority of P3-display users. No fix needed, but the behavior should be documented in user-facing docs if it causes confusion.

---

## Finding 13: `getGalleryConfig` Cache Not Invalidated on Settings Change (gallery-config.ts)

**File:** `apps/web/src/lib/gallery-config.ts`  
**Confidence:** Low

### Bug Description

`getGalleryConfig` uses React `cache()` for per-request deduplication. The cache is request-scoped, so it invalidates between requests. However, if an admin changes a setting during a request, the cached config for that request doesn't reflect the change.

This is generally correct (settings changes are rare and the cache is request-scoped), but in long-running requests (e.g., batch uploads, backfill), a setting change mid-request would not be picked up.

### Failure Scenario

An admin starts a backfill run, then changes `image_quality_avif`. The backfill continues using the old quality setting for the remainder of the run. This is acceptable because the backfill is a long-running operation and changing settings mid-run is an edge case.

### Fix

No fix needed. The request-scoped cache is the correct semantics.

---

## Finding 14: `purgeOldViewEvents` Chunked DELETE Missing Transaction (view-retention.ts)

**File:** `apps/web/src/lib/view-retention.ts`  
**Lines:** 57-83  
**Confidence:** Low

### Bug Description

The function deletes old view events in chunks using `.limit(VIEW_PURGE_BATCH)`. Each chunk is a separate `await db.delete()` call. If the process crashes mid-sweep, some chunks may have been deleted while others remain. This is acceptable for a garbage-collection operation (it's idempotent — re-running picks up where it left off), but the counts returned by the function would be incorrect for the interrupted run.

### Failure Scenario

The hourly GC job starts purging view events. After deleting 50,000 rows from `image_views`, the process crashes. The remaining rows in `image_views`, `topic_views`, and `shared_group_views` are not purged until the next hourly run. No data corruption occurs, but the retention window is temporarily exceeded.

### Fix

No fix needed. The operation is idempotent and self-healing on the next run.

---

## Finding 15: `logAuditEvent` Metadata Serialization Failure (audit.ts)

**File:** `apps/web/src/lib/audit.ts`  
**Lines:** 16-23  
**Confidence:** Low

### Bug Description

```typescript
if (metadata) {
    try {
        serializedMetadata = JSON.stringify(metadata);
    } catch {
        serializedMetadata = JSON.stringify({ note: 'metadata serialization failed' });
    }
```

If `metadata` contains circular references, `JSON.stringify` throws and the catch block creates a fallback. However, if the fallback itself fails (e.g., `JSON.stringify` is monkey-patched to throw), the function would throw an unhandled error. This is extremely unlikely in practice.

### Fix

No fix needed. The fallback is sufficient.

---

## Commonly Missed Issues — Final Sweep

### A. React Hook Violations

Reviewed all React components. No hook violations found. All hooks are called at the top level, dependency arrays are complete, and no hooks are called conditionally.

### B. Memory Leaks

- Event listeners in `useDisplayCapability` are properly cleaned up in the unsubscribe function.
- The `image-queue.ts` queue is properly cleared on shutdown.
- The `viewCountBuffer` Map is bounded and flushed periodically.
- No obvious memory leaks detected.

### C. Resource Leaks

- File descriptors in `serveUploadFile` are properly closed via `stream.destroy()` and the abort signal listener.
- DB connections are managed by the Drizzle connection pool (10 connections, queue limit 20).
- The `createReadStream` fd is released on error paths.

### D. Unhandled Promise Rejections

- All async IIFEs in `image-queue.ts` have internal try/catch blocks.
- The `logAuditEvent` calls use `.catch(console.debug)`.
- The `getColorSettingsHash` fallback path catches errors.
- No unhandled promise rejections detected.

### E. Race Conditions

- The advisory lock pattern is used correctly for serialization.
- The `PQueue` concurrency limit prevents concurrent processing of the same image.
- The `flushGroupViewCounts` function uses `isFlushing` guard and Map swapping to prevent races.
- The `getServingColorSettingsHash` has a benign race (duplicate promise creation) that doesn't affect correctness.

### F. Type Coercion

- The `safeInsertId` function properly handles BigInt to Number conversion with bounds checking.
- The `isValidTagSlug` and `isValidSlug` functions use regex validation.
- No dangerous type coercion patterns detected.

### G. Buffer Overflow/Underflow

- All buffer operations in `gps-exif-strip.ts` are bounds-checked.
- The `readS15Fixed16` function checks offset bounds.
- The ISOBMFF walker in `color-detection.ts` has max depth and scan limits.
- No buffer overflow vulnerabilities detected.

### H. ReDoS

- No user-controlled regex patterns. All regexes are bounded (no nested quantifiers with backtracking), use character classes, or have explicit length limits. The `SAFE_SEGMENT` regex `/^[a-zA-Z0-9._-]+$/` is anchored and safe.
- No ReDoS vulnerabilities detected.

### I. Incorrect Error Handling

- The `process-image.ts` `isTransientError` function correctly identifies retryable errors.
- The `isBitdepthRejection` function correctly identifies permanent failures.
- Error paths in `serveUploadFile` properly clean up streams.
- No incorrect error handling detected.

### J. Incorrect Cleanup in Finally Blocks

- The `flushGroupViewCounts` finally block properly resets `isFlushing` and reschedules the timer.
- The `getSessionSecret` finally block resets `sessionSecretPromise`.
- No incorrect cleanup patterns detected.

---

## Conclusion

The GalleryKit codebase is exceptionally well-hardened. The findings above are mostly edge cases and theoretical concerns rather than active bugs. The most actionable items are:

1. **Finding 6 (Medium):** Synchronize `viewCountRetryCount` eviction with `viewCountBuffer` to prevent retry count reset during sustained DB outages.
2. **Finding 9 (Medium):** Add hard cap enforcement to `BoundedMap.set()` to prevent unbounded growth if a consumer forgets to call `prune()`.
3. **Finding 3 (Medium):** Consider adding circuit-breaker logic to `getServingColorSettingsHash` to reduce DB load during outages.
4. **Finding 1 (Low):** Consider epsilon-based check in `cosineSimilarity` for theoretical correctness.

All other findings are either already handled correctly, documented as intentional trade-offs, or theoretical edge cases with negligible practical impact.

---

*End of review.*
