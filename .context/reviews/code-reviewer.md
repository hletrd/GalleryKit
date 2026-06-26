# Code Review — GalleryKit Cycle 12 (HEAD: 2a9976a1)

**Date:** 2026-06-27
**Reviewer:** Code Reviewer Agent (cycle 12)
**Baseline:** bcd67b12 (cycle 10 HEAD)
**HEAD:** 2a9976a1
**Scope:** All commits from bcd67b12..HEAD (17 commits)
**LSP Diagnostics:** Clean — no errors or warnings on modified files
**Tests:** 2065 passed, 4 skipped (from verifier evidence)

---

## Stage 1 — Spec Compliance

All 17 commits in the range address prior cycle findings explicitly (commit messages reference M-series IDs from the aggregate or L/H identifiers). Each commit targets a specific reported issue and implements the described fix. No feature additions, no behavior changes outside the stated scope.

**Stage 1 verdict: PASS**

---

## Stage 2 — Code Quality

### By Severity

- **CRITICAL:** 0
- **HIGH:** 0
- **MEDIUM:** 1
- **LOW:** 2

---

## Issues (New — Cycle 12)

### R12-CR-01 [MEDIUM] `gracefulShutdown` sets `process.exitCode` but never calls `process.exit()`
**File:** `apps/web/src/instrumentation.ts:49-72`
**Confidence:** HIGH

**Problem:**
`gracefulShutdown` is an async function that drains the image queue and view-count buffer, then sets `process.exitCode = completed ? 0 : 1`. However, it never calls `process.exit()`. The SIGTERM/SIGINT handlers call `gracefulShutdown('SIGTERM')` as a fire-and-forget async call. After the drain completes and `process.exitCode` is set, the process does NOT exit: the MySQL connection pool holds ref'd TCP connections (keepalive-enabled, 10 connections), which prevent the Node.js event loop from draining naturally. The process remains alive until Docker's grace period expires and Docker sends SIGKILL.

**Failure scenario:**
1. Docker sends SIGTERM to the container (e.g., deploy, `docker stop`)
2. Drain completes in, say, 2 seconds. `process.exitCode = 0` is set.
3. Process does NOT exit. Event loop is kept alive by the MySQL pool.
4. Docker waits its stop grace period (default 10 s).
5. Docker sends SIGKILL. Process exits with code 137 (SIGKILL), not 0.
6. Docker/orchestrator log shows a non-zero exit code even though shutdown was clean. The `process.exitCode = 1` (timeout branch) is equally meaningless: the orchestrator always sees 137.

**Fix:**
```typescript
process.exitCode = completed ? 0 : 1;
process.exit(process.exitCode);    // add this line
```

This makes the process exit promptly after drain, with the correct exit code, rather than relying on SIGKILL. The drain still runs to completion; calling `process.exit()` after it is the intended pattern for graceful shutdown in long-lived Node.js servers that hold ref'd handles.

---

### R12-CR-02 [LOW] Carry-over AGG-M9: `hasTrustedSameOriginWithOptions` still exported
**File:** `apps/web/src/lib/request-origin.ts:109`
**Confidence:** HIGH

**Problem:**
`export { hasTrustedSameOriginWithOptions };` on line 109 exposes the internal function that accepts `{ allowMissingSource: true }`, which bypasses the entire same-origin check. No current caller uses `allowMissingSource: true`, but the export makes this a latent CSRF bypass vector for any future caller. Commit `5ba4025c` message says "unexport allowMissingSource" but only changed the option parameter's visibility within the function — it did NOT remove the function's own export. AGG-M9 status: still open.

**Fix:**
Remove `export { hasTrustedSameOriginWithOptions };` (line 109). The public-facing safe wrapper `hasTrustedSameOrigin` (line 79–81) already delegates to it and is the only export needed externally. Remove the `allowMissingSource` option parameter entirely, or retain it for internal use only (unexported function, no external access).

---

### R12-CR-03 [LOW] Shutdown timeout sentinel fires spurious warning after clean drain
**File:** `apps/web/src/instrumentation.ts:21-26`
**Confidence:** HIGH

**Problem:**
The `shutdownTimeout` Promise wraps a `setTimeout` that calls `console.warn('[Shutdown] Timed out after 15s...')`. When the drain completes in under 15 seconds, `Promise.race` resolves with the drain result, `completed = true` is set, and `console.debug('[Shutdown] In-flight queue work drained, exiting.')` is logged. However, the 15-second `setTimeout` is not cancelled. It fires 15 seconds later and emits the "Timed out" warning to the log — a false alarm that misrepresents a clean shutdown as a timeout.

This is partially mitigated if R12-CR-01 is fixed (adding `process.exit()` after drain means the process terminates before the 15-second timer fires). Without R12-CR-01 fix, any clean shutdown within the grace window will produce a spurious timeout warning in logs.

**Fix:**
```typescript
let shutdownTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
const shutdownTimeout = new Promise<void>((resolve) => {
    shutdownTimeoutHandle = setTimeout(() => {
        console.warn('[Shutdown] Timed out after 15s, forcing exit with queued jobs remaining');
        resolve();
    }, 15_000);
});
try {
    await Promise.race([
        Promise.all([
            shutdownImageProcessingQueue(),
            flushBufferedSharedGroupViewCounts(),
        ]).then(() => {
            completed = true;
            if (shutdownTimeoutHandle !== null) {
                clearTimeout(shutdownTimeoutHandle);
                shutdownTimeoutHandle = null;
            }
        }),
        shutdownTimeout,
    ]);
    ...
```

---

## Carry-Over Status

| ID | Description | Status |
|----|-------------|--------|
| AGG-M7 | `getServingColorSettingsHash` no circuit breaker for DB outages (`serve-upload.ts:50-83`) | STILL OPEN — no changes to `serve-upload.ts` in this cycle |
| AGG-M8 | `ogRateLimit`/`shareRateLimit` stale entry accumulation (request-driven only, not timer-driven) | PARTIALLY ADDRESSED — request-driven prune added (60 s throttle), but no independent timer. BoundedMap hard cap (2000 keys) limits worst-case memory. Carry-over at LOW priority |
| AGG-M9 | `hasTrustedSameOriginWithOptions` exported with `allowMissingSource` bypass | STILL OPEN — see R12-CR-02 |
| AGG-M10 | `getTrustedRequestProtocol` HTTP fallback silently returns `'http'` | **FIXED** in commit `5ba4025c` — now returns `null`; callers handle null correctly |
| AGG-M12 | `deleteImage()` cleanup failures not reported to caller | **FIXED** prior to cycle 10 baseline — `deleteImage` returns `{ success: true, cleanupFailureCount }` and `image-manager.tsx` shows a toast warning when non-zero |
| AGG-M13 | DB init timeout may return connections without `group_concat_max_len` set | STILL OPEN (conceptually) — the timeout clears the stored init promise, but the `'connection'` event only fires once per TCP connection, so clearing the symbol does not schedule a re-run. Low confidence / low likelihood for a well-connected MySQL instance |

---

## Confirmed Fixes (Cycle 11 Commits)

The following prior-cycle findings were closed by commits in this range:

| Commit | Prior ID | What was Fixed |
|--------|----------|---------------|
| `14730ee2` | AGG-M1 | 3× `console.log` → `console.info` in `admin-backfill-runner.ts` |
| `5ba4025c` | AGG-M10 | `getTrustedRequestProtocol` returns `null` instead of `'http'` on fallback |
| `9d88e217` | AGG-M8 (partial) | `ogRateLimit`/`shareRateLimit` now use time-gated request-driven prune |
| `74bd776a` | AGG-M3 (M-series variants) | All shallow-copy mutation bugs fixed across rate-limit surfaces |
| `2b166245` | M-series auth-rate-limit | `loginRateLimit` rollback functions use `map.set({count: entry.count - 1, ...})` |
| `038b3154` | M3 follow-up | `semanticRateLimit.set()` instead of direct mutation in `preIncrementSemanticAttempt` |
| `3111cc7e` | M7 process-image | `safeUnlink`/`safeCloseDirHandle` distinguish `ENOENT` from real errors |
| `6cfcc75d` | M12 audit | `prioritizeSecurityFields` reorders audit metadata keys before truncation |
| `bbfd747f` | M6 | `checkLoadMoreRateLimit` helper extracted (DRY) |
| `d6107f89` | M14 | Bootstrap cursor 4-case state machine: first-scan-empty vs continuation-empty distinguished |
| `b3c55036` | R11C11 | SIGTERM/SIGINT graceful shutdown handler added; geoip-lite pre-warm; `assertNoLegacyPublicOriginalUploads` at startup |
| `92ce7a9e` | R11C11 follow-up | Local `ConnInfo` interface for `navigator.connection` in photo-viewer |
| `f1f6202d` | Touch target / accessibility | Sheet close button 44px touch target; `role="progressbar"` + ARIA attrs on progress; `motion-reduce:animate-none` on skeleton; `delayDuration` 0→100 tooltip |

---

## Open Questions (low-confidence findings — surfaced, not blocking)

None for this cycle. All flagged findings have HIGH confidence.

---

## Positive Observations

- **Bootstrap cursor 4-case state machine (`image-queue.ts`):** The four branches (first-scan-empty, empty-continuation, partial-batch, full-batch) are logically correct and cover all reachable states. The cursor is updated before the branch conditionals, avoiding the duplicate assignment in the full-batch branch (a minor redundancy, not a bug).

- **Shallow-copy mutation pattern uniformly applied:** All `entry.count++` mutations across `rate-limit.ts`, `auth-rate-limit.ts`, and `actions/public.ts` have been replaced with `map.set(key, { count: entry.count + 1, ... })`. The `BoundedMap.get()` shallow-copy JSDoc explicitly documents the limitation (nested objects are still references). The fix is consistent and defensively documented.

- **`BoundedMap.set()` auto-enforces hard cap:** The `enforceHardCap()` call inside `set()` ensures that maps stay bounded even if callers forget explicit `prune()` calls. This is a sound "belt-and-suspenders" design choice, correctly commented.

- **`hasTrustedSameOrigin` → `hasTrustedSameOriginWithOptions` wrapper:** The public-facing safe function delegates to the private options-bearing one. This is the correct one-caller-per-exported-function pattern; the issue (R12-CR-02) is merely that `hasTrustedSameOriginWithOptions` is additionally exported.

- **Adaptive prefetch guards in photo-viewer (`92ce7a9e`):** The `conn?.saveData` and `conn?.effectiveType === '2g'` checks before prefetch correctly short-circuit on metered/slow connections. The local `ConnInfo` interface avoids polluting `Navigator`'s global type surface.

- **`mountedRef` unmount guard in `home-client.tsx`:** The `{ current: true }` ref (not `useRef`) created inside `useEffect` is correct. Setting `mountedRef.current = false` in the cleanup before `cancelAnimationFrame` ensures that a rAF callback executing immediately before cancellation still no-ops on the state setter. Belt-and-suspenders pattern for fast unmounts.

- **`motion-reduce:animate-none` on `skeleton.tsx`:** `prefers-reduced-motion` conformance is critical for vestibular-disorder users. Correct placement on the `animate-pulse` class.

- **`delayDuration = 100` on Tooltip:** The previous `0` caused instant tooltip flash on accidental hover. 100 ms is the standard accessibility-friendly delay (enough to ignore transient mouseover, short enough not to feel sluggish).

- **`Buffer.indexOf` in `verifyAvifNclxInBuffer` (`process-image.ts`):** Replacing the manual byte-by-byte search loop with `Buffer.indexOf('colr', searchStart, 'ascii')` is both more readable and leverages V8's optimized string search. Functionally equivalent with better clarity.

---

## Verdict

**COMMENT** (no blocking issues)

One MEDIUM finding (R12-CR-01) warrants a follow-up fix: the graceful shutdown does not call `process.exit()`, so the exit code signal to the orchestrator is lost. No CRITICAL or HIGH findings. Two LOW carry-overs (AGG-M9/R12-CR-02, R12-CR-03) are straightforward one-line fixes.

Cycle 12 is the cleanest cycle since cycle 7: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 2 LOW.
