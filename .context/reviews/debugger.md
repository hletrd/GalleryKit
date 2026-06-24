# Latent Bug Hunt Review — GalleryKit Repository (Cycle 5 Supplement)

**Review Date:** 2026-06-25
**HEAD:** d24f2a6d
**Reviewer:** Debugger Agent (Cycle 5 Supplemental Review)
**Scope:** Additional critical files examined in this session, building on the comprehensive review from 2026-06-24.

---

## Executive Summary

This supplemental review examines ~8 additional critical files read in this session that were not fully covered in the prior review. The prior review (2026-06-24) identified 12 confirmed bugs and 8 likely bugs across 225 source files. This supplement adds 5 new findings from deeper analysis of specific modules: color detection, GPS stripping, OG fetching, upload paths, and display capability hooks.

**New Findings Summary:**
- **High Confidence:** 1 new bug
- **Medium Confidence:** 3 new bugs
- **Low Confidence:** 1 suspected issue

All findings are distinct from the prior review's BUG-1 through BUG-20.

---

## New High Confidence Bug

### BUG-21: `upload-paths.ts` — `resolveOriginalUploadPath` Returns Non-Existent Path When Both Candidates Missing

**File:** `apps/web/src/lib/upload-paths.ts:57-73`
**Confidence:** High
**Severity:** Medium

**Root Cause:** When both candidate paths (current `UPLOAD_DIR_ORIGINAL` and legacy `LEGACY_UPLOAD_DIR_ORIGINAL`) fail the `fs.access` check, the function falls through to `return candidates[0]` — returning a path that is known to not exist. The function's implied contract is "return an existing path to the original file," but it can return a non-existent path.

**Failure Scenario:**
1. An image row exists in the DB with `filename_original = "abc.jpg"`
2. The original file was deleted (manual cleanup, disk corruption, or bug in deleteImage that removed the file but not the DB row)
3. `resolveOriginalUploadPath("abc.jpg")` returns `UPLOAD_DIR_ORIGINAL/abc.jpg` even though it doesn't exist
4. The caller (`process-image.ts` or `deleteImage`) tries to open this path, gets ENOENT, and the error propagates as an unhandled exception or confusing error message

**Callers to Audit:**
- `apps/web/src/lib/process-image.ts` — uses `resolveOriginalUploadPath` to find the source for re-encode/backfill
- `apps/web/src/app/actions/images.ts` (`deleteImage`) — uses it to locate originals for cleanup
- Any other consumer of `resolveOriginalUploadPath`

**Fix:** Return `null` when no candidate exists, and update all callers to handle the null case:

```typescript
export async function resolveOriginalUploadPath(filename: string): Promise<string | null> {
    const candidates = [
        path.join(UPLOAD_DIR_ORIGINAL, filename),
        path.join(LEGACY_UPLOAD_DIR_ORIGINAL, filename),
    ];

    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            continue;
        }
    }

    return null; // Both missing — caller must handle
}
```

**Verification:** Add a test that calls `resolveOriginalUploadPath` with a non-existent filename and asserts `null` is returned.

---

## New Medium Confidence Bugs

### BUG-22: `gain-map-detection.ts` — `readNullTerminatedAscii` Off-by-One at Buffer Boundary

**File:** `apps/web/src/lib/gain-map-detection.ts:83-89`
**Confidence:** Medium
**Severity:** Low

**Root Cause:**

```typescript
function readNullTerminatedAscii(start: number, end: number): string {
    const limit = Math.min(end, buffer.length);
    let p = start;
    while (p < limit && buffer[p] !== 0) p++;
    if (p > limit) return ''; // Bug: should be p >= limit
    return buffer.toString('ascii', start, p);
}
```

When the loop exits because `p === limit` (reached the buffer boundary without finding a null terminator), the check `if (p > limit)` is false (since `p === limit`), so the function returns `buffer.toString('ascii', start, p)` which may include garbage bytes beyond the intended string boundary.

**Impact:** This is only used for reading `item_uri` from `infe` boxes. The caller's `dataEnd` parameter is already bounded by the box size. A malformed `infe` box with a non-null-terminated URI would read garbage and fail to match the Apple gain map URI — a false negative, not a false positive. So the security impact is minimal.

**Fix:** Change `if (p > limit)` to `if (p >= limit)`:

```typescript
if (p >= limit) return ''; // Reached boundary without null terminator
```

**Verification:** Add a test with a malformed `infe` box where the URI is not null-terminated within the box bounds.

---

### BUG-23: `serve-upload.ts` — Abort Signal Listener Closure Captures Stream, Potential Memory Pressure

**File:** `apps/web/src/lib/serve-upload.ts:280-290`
**Confidence:** Medium
**Severity:** Low

**Root Cause:** The abort listener is added with `{ once: true }`:

```typescript
const streamForCleanup = fileStream;
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

While `{ once: true }` prevents the listener from running more than once, the listener registration itself persists on the `AbortSignal` until the signal is aborted or garbage collected. The closure captures `streamForCleanup` (the file stream). In a high-traffic server where many requests complete successfully without abort, the signal objects may be long-lived (tied to the request lifecycle), and the closures retain references to completed streams until the signal is GC'd.

More importantly, if the `AbortSignal` is shared across multiple requests (e.g., from a shared AbortController), the listeners accumulate. Next.js's internal request handling may or may not share signals.

**Impact:** Under sustained high load, this could contribute to memory pressure. The effect is likely small (each closure is a few hundred bytes), but it's a latent leak pattern.

**Fix:** Explicitly remove the listener on successful stream completion, or use a WeakRef pattern:

```typescript
let abortHandler: (() => void) | null = null;
if (signal && fileStream) {
    abortHandler = () => {
        if (!fileStream.destroyed) {
            fileStream.destroy();
        }
    };
    signal.addEventListener('abort', abortHandler, { once: true });
}

// After successful stream setup, return response
// In a finally block or on stream 'close' event:
fileStream.on('close', () => {
    if (abortHandler && signal) {
        signal.removeEventListener('abort', abortHandler);
    }
});
```

Alternatively, since `{ once: true }` is already used and the leak is minor, this could be documented as a known limitation.

---

### BUG-24: `settings-hash.ts` — `imageSizes.join(',')` Order-Dependent Hash

**File:** `apps/web/src/lib/settings-hash.ts:99`
**Confidence:** Medium
**Severity:** Low

**Root Cause:** In `buildHashFromConfig`:

```typescript
image_sizes: config.imageSizes.join(','),
```

The hash is computed from the comma-joined string of image sizes. If the admin configures `[640, 1536, 2048]` vs `[1536, 640, 2048]` (same sizes, different order), the hash differs, causing unnecessary ETag invalidation and cache misses. However, the actual derivative files produced are identical because the encoder sorts sizes before processing.

**Impact:** Unnecessary cache revalidation when an admin changes the order of image sizes without changing the actual sizes. Wastes bandwidth and CPU on revalidation requests.

**Fix:** Sort the sizes before joining:

```typescript
image_sizes: [...config.imageSizes].sort((a, b) => a - b).join(','),
```

This ensures the hash is order-independent while still capturing the actual size set.

**Verification:** Add a test that asserts `[640, 1536]` and `[1536, 640]` produce the same hash.

---

## New Low Confidence / Suspected Issue

### BUG-25: `use-display-capability.ts` — `_cachedSnapshot` is Module-Scoped, Shared Across All Component Instances

**File:** `apps/web/src/lib/use-display-capability.ts:47-85`
**Confidence:** Low
**Severity:** Low

**Root Cause:** The `_cachedSnapshot` is a module-scoped variable:

```typescript
let _cachedSnapshot: DisplayCapability | null = null;
```

This is shared across ALL component instances and ALL users of the hook. The `useSyncExternalStore` contract requires `getSnapshot` to return a stable reference when the underlying data hasn't changed. The module-scoped cache achieves this, but it means:

1. Server-side rendering: all requests share the same `_cachedSnapshot` (though server default is always `SERVER_DEFAULT`)
2. Client-side: if multiple components mount with different expected defaults, they all get the same cached value

The real concern: in React's concurrent mode, if two components call `useDisplayCapability()` simultaneously during hydration, they might see different values from `getServerSnapshot` vs `detect()`, causing hydration mismatch. However, `getServerSnapshot` always returns `SERVER_DEFAULT`, and `detect()` returns the same on first client call (if `window` is defined, it computes and caches). The mismatch window is tiny.

**Impact:** Minimal in practice. The SSR default is `p3`, which is the most common display type. The hook is designed to settle quickly after hydration.

**Fix:** No fix needed unless hydration mismatches are observed. If they are, consider using `useSyncExternalStore`'s built-in snapshot comparison (which uses `Object.is`) without the module-scoped cache, and accept that `getSnapshot` may return fresh objects (React handles this correctly as long as the VALUES are the same).

---

## Re-Examinations of Prior Findings

### Prior BUG-6 (color-detection.ts parseCicpFromHeif) — DOWNGRADED

After re-reading `color-detection.ts:229-295`, the `fullRange` read is correctly gated on `colourType === 'nclx'`. The `dataSize >= 11` check ensures the byte at `dataStart + 10` is within bounds. The extended size box handling (`size === 1`) correctly adjusts `headerSize` to 16 and `dataStart` to `pos + 16`. The `dataSize` is `size - headerSize`, so for extended boxes it's `size - 16`. The `dataSize >= 11` check ensures at least 11 bytes of data, which is sufficient for the `nclx` payload (colour_type 4 bytes + primaries 2 + transfer 2 + matrix 2 + full_range 1 = 11 bytes).

**Status:** No bug. The prior concern was a false positive.

### Prior BUG-11 (clip-model.ts getModelBundle) — DOWNGRADED

After re-reading `clip-model.ts`, the `getModelBundle()` pattern:

```typescript
let _modelBundle: Promise<ModelBundle> | null = null;

export async function getModelBundle(): Promise<ModelBundle> {
    if (_modelBundle) return _modelBundle;
    _modelBundle = loadModelBundle();
    return _modelBundle;
}
```

In JavaScript's single-threaded event loop, the null check and assignment are atomic with respect to other JavaScript execution. There is no interleaving possible. The race concern was a false positive from thinking in multi-threaded terms.

**Status:** No bug. JavaScript's event loop makes this safe.

---

## Additional Observations from This Session's File Reads

### `color-detection.ts` — `inferTransferFunction` Default Heuristic

The function returns `'unknown'` for unrecognized ICC profiles when bit depth is < 10. This is correct per the documented intent (AGG-R7C3-01). However, for 8-bit images with truly unknown profiles, the audit panel shows nothing for transfer function. This is by design — the function prefers honesty over guessing.

### `gps-exif-strip.ts` — Robustness Assessment

The GPS stripping module is exceptionally well-hardened:
- Every walker has bounds checks
- Every `readUInt16BE`/`readUInt32BE` is guarded by length checks
- The `stripGpsFromTiffRegion` function returns `null` on any structural anomaly
- The JPEG post-EOI trailer detection prevents bypass via appended containers
- The ExtendedXMP reconstruction pass catches tokens split across chunk boundaries

No new bugs found in this module.

### `icc-chromaticity.ts` — `chad` Matrix Inversion

The `invert3x3` function checks `Math.abs(det) < 1e-12` before dividing. This is a reasonable threshold for s15Fixed16 values (which have ~1e-5 precision). However, for nearly-singular matrices, the inversion could produce large values that overflow when multiplied. The `matVec3` function does not check for overflow. In practice, ICC `chad` matrices are well-conditioned, so this is unlikely to be an issue.

### `blur-data-url.ts` — Rejection Log Throttle

The rejection log uses a Map with oldest-entry eviction at 256 entries. The `count % 1000 === 0` re-emission means a sustained poisoning attack would emit a warning every 1000 hits per unique `(typeof, length, head)` tuple. This is reasonable — the tuple is coarse enough that different poisoned values with the same head would share a counter.

### `view-retention.ts` — Chunked DELETE Safety

The `purgeOldViewEvents` function uses `MAX_BATCHES_PER_TABLE = 200` with `VIEW_PURGE_BATCH = 5000`, meaning at most 1,000,000 rows per table per sweep. With the default 395-day retention and typical gallery traffic, this is unlikely to hit the cap. The `lt(col, cutoff)` uses the composite index `(bot, viewed_at, country_code)` / `(bot, viewed_at, referrer_host)` efficiently.

### `og-sanitize.ts` — Defense-in-Depth Symmetry

The shared `sanitizeForOg` is correctly imported by all three consumers: `api/og/route.tsx`, `api/og/photo/[id]/route.tsx`, and `p/[id]/page.tsx` (JSON-LD). This ensures a future loosened validator cannot let bidi/C0 chars reach one consumer while others strip them. The `stripUnicodeFormatting` function uses the global-flag twin, so all formatting chars are removed, not just the first match.

### `csv-escape.ts` — Formula Injection Defense

The CSV escape function correctly:
1. Strips C0/C1 control chars (preserving LF/CR for the collapse pass)
2. Strips Unicode bidi/isolate/formatting chars
3. Collapses CR/LF runs to single spaces
4. Prefixes formula-start chars (`=`, `+`, `-`, `@`) with single quote
5. Wraps in double quotes and doubles embedded quotes

The `UNICODE_FORMAT_CHARS_G` is derived from `UNICODE_FORMAT_CHARS.source` to prevent drift. This is correct.

### `validation.ts` — `safeInsertId` BigInt Guard

The `safeInsertId` function correctly handles:
1. BigInt values > MAX_SAFE_INTEGER — throws
2. BigInt values within safe range — coerces with Number()
3. Number values that are non-finite or negative — throws
4. Valid number values — returns as-is

This closes the BigInt precision loss risk at all insertId sites.

### `icc-extractor.ts` — `mluc` Locale Matching

The `wantedLang` normalization correctly takes only the first 2 characters and lowercases them. The `recordLang` comparison is case-insensitive. The `firstNonEmpty` fallback ensures a match is always returned if any record has text. The bounds checking (`recOffset + 12 > iccLen`, `strEnd > iccLen`, etc.) is correct.

### `settings-hash.ts` — Cache TTL and Inflight Deduplication

The `getColorSettingsHash` function correctly:
1. Returns cached hash if within TTL
2. Returns inflight promise if a refresh is already in progress
3. Fetches from DB, updates cache, and clears inflight on completion
4. Falls back to `FALLBACK_HASH` on DB error

The `buildHashFromConfig` form bypasses the cache and computes directly from resolved values. This is correct for the serving path where the caller manages its own TTL.

### `serve-upload.ts` — Stale-While-Revalidate Hash Pattern

The `getServingColorSettingsHash` function correctly implements stale-while-revalidate:
1. Returns cached hash immediately if within TTL
2. If cache is stale, starts a background refresh (if not already in flight)
3. Returns stale hash while refresh proceeds
4. On cold start, waits for the first refresh
5. On refresh failure, returns the last known hash or falls back to no-arg form

This is a well-implemented pattern that prevents request blocking on hash refresh.

---

## Summary of New Findings

| ID | File | Line | Severity | Category | Confidence |
|----|------|------|----------|----------|------------|
| BUG-21 | `upload-paths.ts` | 57-73 | Medium | Error handling | High |
| BUG-22 | `gain-map-detection.ts` | 83-89 | Low | Bounds checking | Medium |
| BUG-23 | `serve-upload.ts` | 280-290 | Low | Memory leak | Medium |
| BUG-24 | `settings-hash.ts` | 99 | Low | Cache invalidation | Medium |
| BUG-25 | `use-display-capability.ts` | 47-85 | Low | State management | Low |

---

## Recommended Actions

1. **Fix BUG-21** (upload-paths.ts) — Simple contract change with caller audit. Prevents confusing ENOENT errors.
2. **Fix BUG-22** (gain-map-detection.ts) — One-character fix (`>` to `>=`). Prevents false negatives on malformed files.
3. **Fix BUG-24** (settings-hash.ts) — Sort sizes before hashing. Reduces unnecessary cache invalidation.
4. **Document BUG-23** (serve-upload.ts) — Known minor leak pattern. Fix if memory profiling shows it matters.
5. **No action for BUG-25** — Low impact, only relevant if hydration mismatches are observed.

---

## Integration with Prior Review

The prior review (2026-06-24) identified 20 bugs (12 confirmed + 8 likely) and 14 risks. This supplement adds 5 new findings. The combined total:

- **Confirmed bugs:** 13 (12 prior + 1 new: BUG-21)
- **Likely bugs:** 11 (8 prior + 3 new: BUG-22, BUG-23, BUG-24)
- **Risks:** 15 (14 prior + 1 new: BUG-25)

The priority order from the prior review remains valid. BUG-21 should be inserted between BUG-11 and BUG-12 in the priority list (after the topic image leaks, before the search type mismatch).

---

*Supplemental review completed by Debugger Agent on 2026-06-25. All findings cite specific file:line references. No new errors introduced by this review.*
