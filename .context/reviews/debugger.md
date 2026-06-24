# Comprehensive Latent Bug Review — GalleryKit Debugger

**Scope:** Full repository review of all source files for latent bugs, failure modes, and potential regressions.  
**Date:** 2026-06-25  
**Reviewer:** Debugger agent  
**HEAD:** 87065049 (run-10 cycle-2)  
**Confidence labels:** High, Medium, Low

---

## Summary

After reviewing 40+ source files across the GalleryKit codebase at HEAD 87065049, I identified **6 latent bugs** with confidence levels ranging from Medium to High. This is cycle 8 of the review-plan-fix loop. I verified the status of all 15 findings from the previous cycle's debugger review and found that **2 have been fixed** (Finding 1: cosineSimilarity epsilon check; Finding 2: embedding IIFE unhandled rejection was already correct), while the remaining findings are still present. The codebase is generally well-hardened with extensive defensive programming, compile-time guards, and comprehensive error handling. Most findings are edge cases in concurrency, resource management, and boundary conditions rather than obvious logic errors.

---

## Previously Identified Issues — Status Check

| # | Finding | File | Status | Notes |
|---|---------|------|--------|-------|
| 1 | `cosineSimilarity` denormal underflow | `clip-embeddings.ts:37` | **FIXED** | EPSILON check added (`denom < EPSILON`) |
| 2 | Embedding IIFE unhandled rejection | `image-queue.ts:468` | Already correct | Inner try/catch covers all paths; no fix needed |
| 3 | `getServingColorSettingsHash` no circuit breaker | `serve-upload.ts:50` | **STILL OPEN** | No exponential backoff during DB outages |
| 4 | `decimalToRational` precision edge case | `process-image.ts:1343` | **STILL OPEN** | Low confidence, theoretical only |
| 5 | Abort signal listener leak | `serve-upload.ts:280` | **STILL OPEN** | `{ once: true }` is acceptable; belt-and-braces only |
| 6 | `viewCountRetryCount` eviction mismatch | `data.ts:167-187` | **STILL OPEN** | Retry count eviction not synchronized with buffer |
| 7 | `deleteAdminUser` TOCTOU | `admin-users.ts` | Already correct | Global advisory lock prevents race |
| 8 | `getDummyHash` timing side-channel | `auth.ts:64` | **STILL OPEN** | Lazy init creates first-login timing diff |
| 9 | `BoundedMap` hard cap not enforced | `bounded-map.ts:65` | **STILL OPEN** | `set()` does not auto-prune |
| 10 | `iloc` parse offset bug | `gps-exif-strip.ts:480` | Already correct | Bounds check is correct |
| 11 | `readS15Fixed16` NaN propagation | `icc-chromaticity.ts:106` | Already correct | Callers check `isFinite()` |
| 12 | `useDisplayCapability` SSR mismatch | `use-display-capability.ts:39` | Already correct | Documented intentional trade-off |
| 13 | `getGalleryConfig` cache invalidation | `gallery-config.ts` | Already correct | Request-scoped cache is correct |
| 14 | `purgeOldViewEvents` missing transaction | `view-retention.ts:57` | Already correct | Idempotent GC operation |
| 15 | `logAuditEvent` metadata serialization | `audit.ts:16` | Already correct | Fallback is sufficient |

---

## NEW Finding 1: `processImageFormats` Temp File Cleanup Race on Wide-Gamut Downscale Failure

**File:** `apps/web/src/lib/process-image.ts`  
**Lines:** 994-1018  
**Confidence:** Medium

### Bug Description

When a wide-gamut source exceeds the pixel cap and the downscale intermediate creation fails, the code attempts to clean up the temp file. However, the cleanup is in a `catch` block that only runs if the `toFile` call throws. If the process crashes between `toFile` success and the assignment to `processingInputPath` (line 1010), the temp file is never cleaned up. More critically, if `toFile` succeeds but the subsequent `processingInputPath = tmpPath` assignment is interrupted by a process crash, the temp file is orphaned.

More importantly: the `finally` block at line 1291 only cleans up `processingInputPath` if it differs from `inputPath`. But if the downscale `toFile` throws (e.g., disk full), the catch block at line 1012 attempts `fs.unlink(tmpPath)` — but `tmpPath` was declared at line 994 OUTSIDE the try block. If the `toFile` throws BEFORE the file is created, `tmpPath` may not exist, and `fs.unlink` on a non-existent file is harmless (returns ENOENT). However, if `toFile` partially creates the file and then throws (e.g., disk full mid-write), the temp file may be left behind. The `catch` block's `fs.unlink(tmpPath).catch(() => {})` handles this, but if the process crashes between the throw and the catch, the temp file is orphaned.

### Failure Scenario

A very large wide-gamut image (e.g., 100MP medium format) is uploaded. The downscale intermediate creation starts but the process receives SIGKILL mid-write (e.g., OOM killer). The temp file `*.wi15.tmp` is partially written and never cleaned up. Over time, these accumulate in `/tmp`.

### Fix

Register the temp file for cleanup using a `try/finally` pattern that guarantees cleanup even on uncaught exceptions, or use `process.on('exit', ...)` to register a cleanup handler for the temp file:

```typescript
const tmpPath = path.join(os.tmpdir(), `${path.basename(inputPath)}.${randomUUID().slice(0, 8)}.wi15.tmp`);
try {
    await sharp(...).toFile(tmpPath);
    processingInputPath = tmpPath;
} catch {
    await fs.unlink(tmpPath).catch(() => {});
    throw new Error('Failed to create wide-gamut downscale intermediate');
}
```

The current code already has this structure, but the `tmpPath` variable is declared outside the try block. The real issue is that the `finally` block at line 1291 only cleans up if `processingInputPath !== inputPath`, which is correct for the success path but doesn't cover the case where the process crashes between the `toFile` completion and the `finally` block entry. This is a bounded leak (one temp file per crashed downscale) and is acceptable for most deployments, but worth documenting.

**Verdict:** The current code is correct for the normal error path. The only unhandled case is process crash mid-operation, which is a bounded leak. No fix needed, but document the operational implication.

---

## NEW Finding 2: `normalizeExposureTime` Array Form Handling Edge Case

**File:** `apps/web/src/lib/process-image.ts`  
**Lines:** 1336-1338  
**Confidence:** Medium

### Bug Description

The `normalizeExposureTime` function handles array-form EXIF values:

```typescript
if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'number' && typeof val[1] === 'number' && val[1] !== 0) {
    return `${val[0]}/${val[1]}`;
}
```

This assumes the array contains `[numerator, denominator]`. However, some EXIF readers return the array as `[value, 1]` for integer values (e.g., `[1, 1]` for 1 second). The code handles this correctly. But if the array contains floating-point values (e.g., `[0.008, 1]` from a malformed EXIF reader), the result is `0.008/1` which is not a clean rational string. This is a display-quality issue, not a correctness bug.

More critically: if `val[0]` is `NaN` or `Infinity`, the `typeof` check passes (`typeof NaN === 'number'`), but the resulting string is `NaN/1` or `Infinity/1`, which is nonsensical. The `val[1] !== 0` check doesn't guard against `NaN` or `Infinity` in the numerator.

### Failure Scenario

A camera produces malformed EXIF where the ExposureTime tag is read as `[NaN, 1]`. The function returns `NaN/1`, which is stored in the database and displayed to the user.

### Fix

Add `Number.isFinite()` checks for both numerator and denominator:

```typescript
if (Array.isArray(val) && val.length === 2 
    && typeof val[0] === 'number' && Number.isFinite(val[0])
    && typeof val[1] === 'number' && Number.isFinite(val[1]) && val[1] !== 0) {
    return `${val[0]}/${val[1]}`;
}
```

---

## NEW Finding 3: `getImage` Prev/Next Query May Return Incorrect Results for Mixed Dated/Undated Images

**File:** `apps/web/src/lib/data.ts`  
**Lines:** 994-1102  
**Confidence:** Medium

### Bug Description

The `getImage` prev/next navigation uses complex OR-chains for cursor-based pagination. For dated images, the `nextConditions` include `isNull(images.capture_date)` as the first condition (line 1024). This means ALL undated images are considered "next" (successors) of a dated image, regardless of their `created_at` value. The query then orders by `desc(capture_date), desc(created_at), desc(id)` and limits to 1.

The issue: when a dated image has MANY undated successors, the `next` query returns the undated image with the highest `created_at` (because `NULL` capture_date sorts last in DESC). This is correct per the documented sort order. However, the `prev` query for a dated image does NOT include `isNull(capture_date)` — it only includes dated images with later capture_date (lines 1011-1015). This means the closest predecessor of a dated image is always another dated image, even if there are undated images with very high `created_at` values that were uploaded just before the dated image.

Wait — re-reading the sort order: `capture_date DESC NULLS LAST, created_at DESC, id DESC`. In ASC order (for prev), NULLs come FIRST. So undated images sort BEFORE dated images in the prev direction. But the `prevConditions` for a dated image (lines 1011-1015) do NOT include `isNull(capture_date)` — they only look for dated images with `gt(capture_date, ...)` or same-date with higher `created_at/id`. This means undated images are EXCLUDED from being predecessors of dated images, which is correct because undated images sort before dated images in ASC order (they would be far away, not "nearest").

Actually, looking more carefully: the `prev` query orders by `asc(capture_date), asc(created_at), asc(id)`. With NULLS LAST in DESC, NULLS are FIRST in ASC. So undated images appear at the BEGINNING of the ASC result. The `prevConditions` for a dated image correctly exclude undated images because they would be at the very beginning, not near the current dated image. This is correct.

However, for an undated image, the `prevConditions` (lines 1042-1046) include `isNotNull(images.capture_date)` as the FIRST condition. This means ANY dated image is a valid predecessor of an undated image. The query then orders by `asc(capture_date), asc(created_at), asc(id)` and limits to 1. The result is the dated image with the LOWEST capture_date (or same-date with lowest created_at/id). But the "nearest" predecessor should be the dated image with the HIGHEST capture_date that still sorts before the undated image. In ASC order, the dated images come AFTER the undated block (because NULLS FIRST), so the first dated image is the one with the lowest capture_date. This is the FARTHEST dated image, not the nearest.

Wait — let me re-read. The sort order is `capture_date DESC NULLS LAST, created_at DESC, id DESC`. In the gallery grid, this means:
1. Dated images with latest capture_date first
2. Within same capture_date, latest created_at first
3. Within same created_at, highest id first
4. Undated images at the end

For prev (ASC): we want the image that appears immediately BEFORE this image in the gallery grid. For an undated image, the images immediately before it would be the undated images with higher created_at (or same created_at with higher id). If there are no such undated images, the prev would be the LAST dated image (the one with the highest capture_date that still sorts before the undated block). But the current `prevConditions` for undated images include ALL dated images (`isNotNull(images.capture_date)`), and the query orders by `asc(capture_date)` which returns the LOWEST capture_date first. This is wrong — it should return the HIGHEST capture_date (the one closest to the undated block).

### Failure Scenario

A gallery has dated images from 2024 and 2023, plus some undated images. When viewing an undated image, clicking "prev" should show the most recent dated image (the one closest to the undated block in the gallery grid). Instead, it shows the oldest dated image (2023) because the `asc` order returns the lowest capture_date first.

### Fix

For the undated image `prev` branch, the `isNotNull` condition should be ordered by `desc(capture_date)` to get the nearest predecessor, not `asc`. But the query already uses `asc` for the prev direction. The correct fix is to change the prev query's order for undated images to use `desc` for the dated portion, or to restructure the conditions.

Actually, looking at the code again: the prev query for undated images uses `asc(capture_date), asc(created_at), asc(id)` (line 1081). The `prevConditions` include `isNotNull(images.capture_date)` as the first OR branch. In ASC order, this returns the dated image with the LOWEST capture_date. But we want the dated image with the HIGHEST capture_date that still sorts before the undated image.

The correct approach: for an undated image's prev, the dated predecessor should be ordered by `desc(capture_date)` so the nearest dated image is returned. But this conflicts with the overall query ordering.

Alternatively, split the prev query into two queries: one for undated predecessors (ordered by `asc(created_at)`) and one for dated predecessors (ordered by `desc(capture_date)`), then pick the closer one.

This is a MEDIUM confidence bug because the prev/next navigation for undated images at the boundary of dated/undated images may jump to the wrong image.

---

## NEW Finding 4: `db-actions.ts` `failRestore` Async in Sync Event Handler (Carried from Previous Cycle)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`  
**Lines:** 465-474, 477-487  
**Confidence:** Medium

### Bug Description

The `failRestore` function is declared as `async`:

```typescript
const failRestore = async (error: string, logLabel: string, reason: unknown) => {
    if (settled) return;
    settled = true;
    console.error(logLabel, reason);
    readStream.destroy();
    restore.stdin.destroy();
    restore.kill();
    await fs.unlink(tempPath).catch(() => {});
    resolve({ success: false, error });
};
```

It is called from sync event handlers:

```typescript
readStream.on('error', async (err) => {
    await failRestore(t('failedToReadRestore'), 'Failed to read restore file:', err);
});

restore.stdin.on('error', async (err: NodeJS.ErrnoException) => {
    if (isIgnorableRestoreStdinError(err)) {
        return;
    }
    await failRestore(t('restoreFailed'), 'mysql restore stdin error:', err);
});
```

The `async` callback in the event handler means that if `failRestore` throws (e.g., `fs.unlink` fails and the `.catch()` somehow doesn't catch it — though it should), the rejection is unhandled. More importantly, the event handler itself doesn't return the promise, so the event emitter has no way to know when the async work completes. If another error event fires while `failRestore` is still running (e.g., `readStream` error followed immediately by `restore` close), the `settled` guard prevents double-resolve, but the async operations (unlink, kill) may race.

### Failure Scenario

During a restore, the `readStream` encounters an error. The `failRestore` async function starts running. Before it completes, the `restore` process also emits an error. The `settled` guard prevents double-resolve, but `restore.kill()` may be called twice (once from each failRestore invocation), and the `fs.unlink` may race with itself.

### Fix

Remove `async` from the event handler callbacks and use `.catch()` on the promise instead:

```typescript
readStream.on('error', (err) => {
    failRestore(t('failedToReadRestore'), 'Failed to read restore file:', err).catch(() => {});
});
```

Or, make `failRestore` synchronous by moving the `await fs.unlink` to a `.catch()`:

```typescript
const failRestore = (error: string, logLabel: string, reason: unknown) => {
    if (settled) return;
    settled = true;
    console.error(logLabel, reason);
    readStream.destroy();
    restore.stdin.destroy();
    restore.kill();
    fs.unlink(tempPath).catch(() => {});
    resolve({ success: false, error });
};
```

---

## NEW Finding 5: `canUseHighBitdepthAvif` Singleton Caches Permanent Failure Without Retry

**File:** `apps/web/src/lib/process-image.ts`  
**Lines:** 69-123  
**Confidence:** Medium

### Bug Description

The `_highBitdepthAvifProbePromise` is a Promise-based singleton that caches the result of the libheif 10-bit probe for the process lifetime:

```typescript
let _highBitdepthAvifProbePromise: Promise<boolean> | null = null;

export async function canUseHighBitdepthAvif(): Promise<boolean> {
    if (_highBitdepthAvifProbePromise) return _highBitdepthAvifProbePromise;
    _highBitdepthAvifProbePromise = _probeHighBitdepthAvif();
    return _highBitdepthAvifProbePromise;
}
```

The `_probeHighBitdepthAvif` function retries up to 3 times with exponential backoff for transient errors (EIO, ENOSPC, EMFILE, EAGAIN). However, if the probe fails with a non-transient error (e.g., `isBitdepthRejection` returns false), the result is cached as `false` permanently. If the underlying system is later upgraded to support 10-bit AVIF (e.g., libheif updated), the process must be restarted to re-probe.

More critically: if the probe fails due to a transient error on the FINAL attempt (e.g., EMFILE on attempt 3), the function returns `false` and this is cached permanently. The transient error should have triggered a retry, but if it happens on the last attempt, no retry is possible and the permanent failure is cached.

### Failure Scenario

A GalleryKit process starts during a brief disk pressure spike (EMFILE). The 10-bit AVIF probe fails on all 3 retries due to transient errors. The process caches `false` permanently. Even after disk pressure subsides, all wide-gamut images get 8-bit AVIF until the process restarts.

### Fix

Add a periodic re-probe or a time-based cache invalidation. Alternatively, distinguish between "permanent not supported" (bitdepth rejection) and "transient failure" (EIO/ENOSPC/EMFILE/EAGAIN) and only cache permanent failures:

```typescript
let _highBitdepthAvifProbePromise: Promise<boolean> | null = null;
let _highBitdepthAvifPermanentFailure = false;

export async function canUseHighBitdepthAvif(): Promise<boolean> {
    if (_highBitdepthAvifPermanentFailure) return false;
    if (_highBitdepthAvifProbePromise) return _highBitdepthAvifProbePromise;
    _highBitdepthAvifProbePromise = _probeHighBitdepthAvif().catch(() => {
        // Don't cache transient failures permanently
        _highBitdepthAvifProbePromise = null;
        return false;
    });
    return _highBitdepthAvifProbePromise;
}
```

Actually, looking at the code more carefully: `_probeHighBitdepthAvif` already retries 3 times for transient errors. If it still fails after 3 retries, the failure is likely persistent (e.g., the libheif build genuinely doesn't support 10-bit). The only case where this is problematic is if the transient condition lasts longer than the 3 retries (max delay: 100 + 200 + 400 = 700ms). This is a narrow window.

**Verdict:** The retry logic is sufficient for most cases. The permanent cache is acceptable for a production deployment where libheif doesn't change without a restart. Documented as a known limitation.

---

## NEW Finding 6: `getDummyHash` TOCTOU Race on First Login After Restart

**File:** `apps/web/src/app/actions/auth.ts`  
**Lines:** 64-70  
**Confidence:** Medium

### Bug Description

The `getDummyHash` function lazily initializes the dummy Argon2 hash:

```typescript
let dummyHashPromise: Promise<string> | null = null;
async function getDummyHash(): Promise<string> {
    if (!dummyHashPromise) {
        dummyHashPromise = argon2.hash(randomBytes(32).toString('hex'), PASSWORD_HASH_OPTIONS);
    }
    return dummyHashPromise;
}
```

The check-then-set pattern is not atomic. Two concurrent login requests (for non-existent users) after a server restart can both see `dummyHashPromise === null` and start separate Argon2 computations. This wastes CPU and memory.

### Failure Scenario

After a server restart, two concurrent login requests for non-existent users both trigger Argon2 hash computation. Each computation uses ~64MB of memory (Argon2id with memoryCost=65536). On a memory-constrained server, this could cause OOM.

### Fix

Pre-compute the dummy hash at module initialization time:

```typescript
const dummyHashPromise = argon2.hash(randomBytes(32).toString('hex'), PASSWORD_HASH_OPTIONS);
async function getDummyHash(): Promise<string> {
    return dummyHashPromise;
}
```

This pays the Argon2 cost once at module load time, which is acceptable for a server process. The timing side-channel (first login for non-existent user takes longer) is also eliminated.

---

## Commonly Missed Issues — Final Sweep (Cycle 8)

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

### K. New Patterns Checked in Cycle 8

- **Caption generator stub truthfulness** (`caption-generator.ts`): The stub correctly prefixes with `ALT_TEXT_STUB_PREFIX` and documents that it's a stub. No latent bug.
- **CLIP model lazy loading** (`clip-model.ts`): The `loadPromise` is nulled on failure so the next call retries. Correct.
- **View retention purge** (`view-retention.ts`): The `resolveRetentionMs` function correctly guards against negative values. The chunked DELETE is bounded by `MAX_BATCHES_PER_TABLE`. Correct.
- **Display capability hook** (`use-display-capability.ts`): The snapshot memoization correctly prevents infinite loops. The `subscribe` function properly cleans up all listeners. Correct.
- **Admin backfill runner** (`admin-backfill-runner.ts`): The advisory lock pattern is correct. The concurrency cap is enforced. The `lastError` is last-writer-wins but documented as acceptable.
- **Restore maintenance** (`restore-maintenance.ts`): The global state is correctly managed via Symbol.for. The `beginRestoreMaintenance` and `endRestoreMaintenance` are paired correctly in `db-actions.ts`.
- **Queue shutdown** (`queue-shutdown.ts`): The `drainProcessingQueueForShutdown` correctly handles the shutdown promise singleton. Correct.
- **Session management** (`session.ts`): The `getSessionSecret` correctly handles the production env check. The `verifySessionToken` uses `timingSafeEqual`. Correct.
- **Audit logging** (`audit.ts`): The metadata serialization fallback is correct. The 4096-char truncation uses code-point-aware slicing. Correct.
- **Gallery config** (`gallery-config.ts`): The `validatedNumber` function correctly falls back to defaults. The `semanticSearchMode` healing is correct. The React `cache()` deduplication is correct.
- **Rate limiting** (`rate-limit.ts`): The `getClientIp` correctly handles proxy headers. The `normalizeIp` correctly handles IPv6 and IPv4 with ports. The `shouldWarnMissingTrustProxy` is correct.
- **Auth rate limiting** (`auth-rate-limit.ts`): The `rollbackLoginRateLimit` correctly decrements instead of deleting. The `clearSuccessfulLoginAttempts` correctly resets both in-memory and DB counters. Correct.

---

## Conclusion

The GalleryKit codebase remains exceptionally well-hardened at HEAD 87065049. The most actionable items from this cycle are:

1. **NEW Finding 2 (Medium):** Add `Number.isFinite()` checks in `normalizeExposureTime` array form handling to prevent `NaN/Infinity` propagation.
2. **NEW Finding 3 (Medium):** Investigate and fix the `getImage` prev query for undated images — the `asc(capture_date)` order may return the farthest dated predecessor instead of the nearest.
3. **NEW Finding 4 (Medium):** Make `failRestore` synchronous or use `.catch()` on the async call to avoid potential race conditions in error event handlers.
4. **NEW Finding 6 (Medium):** Pre-compute `dummyHashPromise` at module init to eliminate the TOCTOU race and timing side-channel.
5. **Previous Finding 6 (Medium):** Synchronize `viewCountRetryCount` eviction with `viewCountBuffer` to prevent retry count reset during sustained DB outages.
6. **Previous Finding 9 (Medium):** Add hard cap enforcement to `BoundedMap.set()` to prevent unbounded growth if a consumer forgets to call `prune()`.

All other findings are either already handled correctly, documented as intentional trade-offs, or theoretical edge cases with negligible practical impact.

---

*End of cycle 8 review.*
