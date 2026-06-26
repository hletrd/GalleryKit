# Debugger Review — Cycle 13

**Date:** 2026-06-27
**HEAD:** 2a9976a1
**Reviewer:** debugger agent (Sonnet 4.6)
**Scope:** Cycle-12 regression verification + latent-bug surface hunt
**Prior art consulted:** `.context/reviews/_aggregate.md`, `.context/plans/cycle-12-plan.md`

---

## Cycle-12 Regression Verification

All four cycle-12 changes verified correct with no regressions introduced.

### AGG-R12-01 — `instrumentation.ts` graceful shutdown

`apps/web/src/instrumentation.ts`: `shutdownTimer` is captured before the `try` block, `.unref()` is called immediately, `clearTimeout(shutdownTimer)` runs in `finally`, and `process.exit(exitCode)` executes only after the `try/catch/finally` completes. The `process.on('SIGTERM', …)` guard uses a `shutdownInProgress` boolean to prevent re-entrant signals from stacking. **PASS.**

### AGG-R12-02 — `_verifyAvifNclx` file-handle leak

`apps/web/src/lib/process-image.ts`: the `fileHandle` obtained from `fs.open()` is now wrapped in a `try/finally` that calls `fileHandle.close()` unconditionally. The earlier partial-read path (4 KB read, returns early on buffer-scan result) executes inside that `finally`. **PASS.**

### AGG-R12-04 — `db/index.ts` connection-init timer leak

`apps/web/src/db/index.ts` lines 94–111: `initTimer` is declared outside `try`, `.unref()` is called immediately after creation, and `clearTimeout(initTimer)` runs in `finally`. On the timeout path the `catch` releases the connection and clears the stored init-promise symbol; the `finally` then calls `clearTimeout` (harmless no-op on a fired timer). **PASS.**

### AGG-R12-11 — `image-queue.ts` runtime-shape guard

No changes to this file in cycle 12 per git log. Previously verified. **Carried as PASS.**

---

## Latent Bug Surface — New Findings

### DBG13-01 (LOW) — Disk-space pre-check uses `bfree` instead of `bavail`

**File:** `apps/web/src/app/actions/images.ts` line 206

```ts
const stats = await statfs(UPLOAD_DIR_ORIGINAL);
const freeBytes = stats.bfree * stats.bsize;
if (freeBytes < 1024 * 1024 * 1024) { return { error: t('insufficientDiskSpace') }; }
```

`stats.bfree` is the total count of free blocks on the filesystem, including blocks that are kernel-reserved for root processes (typically 5 % on ext4 with default `mkfs.ext4` settings). The field that reflects what a non-root process can actually allocate is `stats.bavail`. When the disk is in the range where `bfree` is above 1 GiB but `bavail` is below (i.e., the filesystem is between 95 % and ~100 % full), the pre-check passes and the upload proceeds, but the subsequent `fs.writeFile` for the original may still fail with `ENOSPC`. The error path does clean up the saved file (`deleteOriginalUploadFile(savedOriginalFilename)`) so the failure is not catastrophic — it degrades to a generic upload error on the client side rather than surfacing the actionable "insufficient disk space" localized message.

**Root cause:** `bfree` vs `bavail` semantic confusion in `statfs` field selection.

**Minimal fix:** Change `stats.bfree` to `stats.bavail` at `images.ts:206`. One character insertion.

**Reproduction:** Upload a large batch when the disk is between 95–100 % full. The pre-check passes, the write fails with `ENOSPC`, and the user sees a generic upload error rather than the "insufficient disk space" toast.

**Similar pattern:** No other `statfs` calls exist in the codebase.

---

### DBG13-02 (LOW) — `getPasswordChangeRateLimitEntry` returns raw entry without spread

**File:** `apps/web/src/lib/auth-rate-limit.ts` line 115

```ts
// getLoginRateLimitEntry (line 33):
return { ...entry };   // spread copy

// getAccountLoginRateLimitEntry (line 43):
return { ...entry };   // spread copy

// getPasswordChangeRateLimitEntry (line 115):
return entry;          // raw — no spread
```

`BoundedMap.get()` already returns a shallow copy of the stored value, so a caller mutating the returned object cannot corrupt the BoundedMap's internal state. The window-expiry branch at line 111 sets `entry.count = 0` before returning, which mutates the shallow copy from `BoundedMap.get()` — safe, since it is already a detached copy. However, the asymmetry with the two login-variant functions — which are documented as returning "a shallow copy so callers can mutate the returned object without corrupting the internal Map state" — creates a fragile contract. A future caller that reads the `getLoginRateLimitEntry` source and assumes `getPasswordChangeRateLimitEntry` behaves identically may pass the returned object somewhere unexpected. The inconsistency also complicates reasoning during audits of the rate-limit surface.

**Root cause:** Missing `{ ...entry }` spread in the password-change variant.

**Minimal fix:** Change `return entry;` to `return { ...entry };` at `auth-rate-limit.ts:115`. One word insertion.

**Similar pattern:** `getAccountLoginRateLimitEntry` (line 43) correctly spreads; use that as the reference.

---

### DBG13-05 (INFO) — Stale comment: FLUSH_CHUNK_SIZE = 20, actual value is 5

**File:** `apps/web/src/lib/data.ts` lines 66 and 147

```ts
// line 66 — definition:
const FLUSH_CHUNK_SIZE = 5;

// line 147 — C1F-DB-01 comment:
// The overflow is bounded by the chunk size (FLUSH_CHUNK_SIZE = 20).
```

The value at line 66 is 5. The comment on line 147 says 20. No runtime impact — the constant itself is correct and the logic is sound. Pure documentation drift.

**Root cause:** The constant was changed from 20 to 5 (or was always 5) but the inline comment at the C1F-DB-01 post-flush buffer-cap note was not updated.

**Minimal fix:** Update the comment at `data.ts:147` to read `(FLUSH_CHUNK_SIZE = 5)`.

---

## Not Bugs — Confirmed Safe

### WI-15 temporary TIFF intermediate cleanup

`apps/web/src/lib/process-image.ts` lines 1358–1362: the `processingInputPath` (TIFF intermediate created when a wide-gamut source exceeds `wideGamutMaxSourcePixels`) is cleaned up unconditionally in a `finally` block:

```ts
} finally {
    if (processingInputPath !== inputPath) {
        await safeUnlink(processingInputPath);
    }
}
```

This runs even when `processImageFormats` throws mid-encode. No file-handle or temp-file leak. Investigated as a potential regression from cycle-12 scope; confirmed SAFE.

### ICC extractor `declaredLength === 1` edge case

`apps/web/src/lib/icc-extractor.ts`: when an ICC v2 `desc` tag has `declaredLength === 1` the computed string length becomes 0 after the `Math.max(0, declaredLength - 1)` trailing-null drop, the substring extraction produces an empty string, the `strStart >= strEnd` guard fires, and the function returns `null`. This is correct — a 1-byte desc tag contains only a null terminator with no meaningful name. Returning `null` is appropriate graceful behavior.

---

## Deferred / Carried-Forward Findings

These were documented in earlier cycles and are not yet actioned. Re-verified still present in HEAD.

| ID | File | Severity | Summary |
|----|------|----------|---------|
| AGG-R12-09 | `lib/request-origin.ts:83` | LOW | `hasTrustedSameOriginWithOptions` exports an `options` param that `hasTrustedSameOrigin` never passes. Dead interface surface, harmless today. |
| AGG-R12-10 | `lib/bounded-map.ts:115` | LOW | `BoundedMap.entries()` returns the raw `Map.entries()` iterator; callers holding the iterator across an eviction see entries removed from the live Map. |
| DBG-05 | `lib/process-image.ts:1414` | LOW | `decimalToRational(Number.MIN_VALUE)` → `"1/Infinity"` string. No real camera produces sub-nanosecond exposure times; purely theoretical. |
| DBG-07 | Admin token auth path | LOW | Length check `token.length !== 64` runs before the constant-time HMAC comparison, creating a timing oracle that leaks whether the submitted token has the correct length. |

---

## Summary

**Cycle-12 regressions:** 0 (all 4 changes verified PASS).

**New actionable findings:** 2 code bugs (DBG13-01, DBG13-02) + 1 doc inconsistency (DBG13-05).

All findings are LOW severity. No CRIT or HIGH issues found in this sweep.

**Top findings by impact:**

1. **DBG13-01** (`images.ts:206`) — one-character fix (`bfree` → `bavail`) makes the upload disk-space pre-check semantically correct for non-root processes, surfacing the localized "insufficient disk space" error instead of a generic upload failure near disk-full.
2. **DBG13-02** (`auth-rate-limit.ts:115`) — add `{ ...` spread to `getPasswordChangeRateLimitEntry` return to match the contract of the two login-rate-limit accessors and close a latent mutation-asymmetry hazard.
