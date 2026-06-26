# Debugger Review — Cycle 12

**Date:** 2026-06-27
**HEAD:** 2a9976a1
**Reviewer:** debugger agent
**Scope:** Latent bug surface, failure modes, regressions introduced by cycle 11 changes; deep inspection of image processing, queue, rate-limit, retention GC, color detection, DB init/timeout, session, migrate.js

---

## Summary

**Cycle 12 new findings: 4 (0 CRITICAL, 1 MEDIUM, 3 LOW)**
**Carry-over open findings from prior cycles: 3 (0 CRITICAL, 0 MEDIUM, 3 LOW)**
**Confirmed closed from prior cycles: 2 (AGG-M6, AGG-M13 core)**

---

## New Findings

### R12-DBG-01 — Shutdown timeout timer never cleared on successful drain

- **ID:** R12-DBG-01
- **Severity:** MEDIUM
- **Confidence:** Confirmed by reasoning
- **File:** `apps/web/src/instrumentation.ts:21-36`

**Latent bug:**
`shutdownTimeout` is created unconditionally with `new Promise<void>((resolve) => { setTimeout(() => { console.warn('[Shutdown] Timed out ...'); resolve(); }, 15_000); })`. The `setTimeout` handle is never captured and never cleared. When `Promise.all([shutdownImageProcessingQueue(), flushBufferedSharedGroupViewCounts()])` resolves first (the normal success path), `Promise.race` resolves and `gracefulShutdown` continues to set `process.exitCode = 0`. Fifteen seconds later, the stale timer fires and logs:

```
[Shutdown] Timed out after 15s, forcing exit with queued jobs remaining
```

even though `completed = true` and the drain succeeded cleanly.

**Trigger condition:** Any clean process shutdown where queue drains in < 15s. Fires on every clean SIGTERM and SIGINT handled by the cycle 11 code.

**Observable failure:** Misleading log entry in production deployment logs 15 seconds after every clean container stop. Operators seeing this in logs may misdiagnose as failed drains and trigger unnecessary incident investigation. Additionally, the Node.js event loop is held alive for an extra 15 seconds by the active timer (see also R12-DBG-04).

**Suggested fix:**
Capture the timer handle so it can be cleared in the success branch:
```typescript
let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
const shutdownTimeout = new Promise<void>((resolve) => {
    shutdownTimer = setTimeout(() => {
        console.warn('[Shutdown] Timed out after 15s, forcing exit with queued jobs remaining');
        resolve();
    }, 15_000);
    shutdownTimer.unref();
});
try {
    await Promise.race([
        Promise.all([
            shutdownImageProcessingQueue(),
            flushBufferedSharedGroupViewCounts(),
        ]).then(() => {
            completed = true;
            if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
        }),
        shutdownTimeout,
    ]);
```

---

### R12-DBG-02 — getProcessingQueueState() key-presence guard regressed for null queue

- **ID:** R12-DBG-02
- **Severity:** LOW
- **Confidence:** Confirmed by reasoning
- **File:** `apps/web/src/lib/image-queue.ts:183-192`

**Latent bug:**
The `getProcessingQueueState()` function validates the global state object with:

```typescript
if (
    existing
    && typeof existing === 'object'
    && 'queue' in existing
    && 'enqueued' in existing
    && 'bootstrapped' in existing
) {
    return existing;
}
```

`'queue' in existing` is a key-presence check, not a type/value check. If `existing.queue === null` (possible in test teardown, state corruption, or an edge-case re-initialization path where the key is set but the value is `null`), this guard passes and returns the corrupt state object. Any downstream caller that subsequently invokes `state.queue.add(...)`, `state.queue.size`, or `state.queue.onIdle()` throws `TypeError: Cannot read properties of null (reading 'add')`.

The pre-cycle-11 guard `if (!globalWithQueue[processingQueueKey])` treated `null` as falsy and would fall through to re-initialize, preventing this path.

**Trigger condition:** State object with `queue: null` present on `globalThis`. Realistic in integration test teardown or a process restart boundary where partial cleanup nulled the queue handle.

**Observable failure:** `TypeError: Cannot read properties of null (reading 'add')` on the first upload or queue operation after state corruption. Manifests as a 500 on image upload with no queue re-initialization.

**Suggested fix:** Add a non-null value check alongside the key-presence check:
```typescript
&& 'queue' in existing
&& (existing as { queue: unknown }).queue !== null
&& typeof (existing as { queue: unknown }).queue === 'object'
```

---

### R12-DBG-03 — initTimeout timer accumulates on every pool-reuse getConnection() call

- **ID:** R12-DBG-03
- **Severity:** LOW
- **Confidence:** Confirmed by reasoning
- **File:** `apps/web/src/db/index.ts:87-100`

**Latent bug:**
`getConnection()` is patched to race `initPromise` against a fresh `initTimeout = new Promise<void>((_, reject) => { setTimeout(() => reject(...), 10_000); })`. The `setTimeout` handle is never captured and never cleared. For the first use of a freshly created pool connection, `initPromise` is pending (the `SET group_concat_max_len` query) and the race correctly waits. However, after `SET` succeeds, `connectionInitSymbol` still holds the already-RESOLVED promise. On every subsequent `getConnection()` call for that same connection, `if (initPromise)` is truthy (a resolved Promise is truthy), so a fresh 10-second `setTimeout` is armed. `Promise.race` resolves immediately via microtask queue (since `initPromise` is already settled), and the function returns — but the 10-second timer is now orphaned.

`Promise.race` registers an internal rejection handler on `initTimeout`, so the eventual `reject()` does not produce an unhandled rejection warning. The harm is purely resource: under steady production traffic (multiple queries per second), there is a constant backlog of active 10-second timers. Each is individually trivial, but the cumulative effect keeps the event loop artificially busy and inflates Node.js timer-queue pressure.

**Trigger condition:** Any production workload with more than a few queries per second after initial pool warm-up. Every `db.execute()` and `db.query()` calls `getConnection()`, so this fires for every single database operation.

**Observable failure:** Subtle event-loop keepalive inflation under load. Also contributes to the process-won't-exit-on-its-own issue (R12-DBG-04), since there are always active timers in steady state.

**Suggested fix (option A):** Clear the stored `initPromise` after successful race so future calls skip the block entirely:
```typescript
try {
    await Promise.race([initPromise, initTimeout]);
    // Mark this connection as initialized so future getConnection()
    // calls skip the race entirely rather than spawning a new timer.
    if (underlying) {
        underlying[connectionInitSymbol] = undefined;
    }
} catch (err) { ... }
```

**Suggested fix (option B):** Unref the timer so it does not hold the event loop:
```typescript
const initTimeout = new Promise<void>((_, reject) => {
    const t = setTimeout(() => reject(new Error('DB connection init query timed out after 10s')), 10_000);
    t.unref();
});
```

Option A is preferred: it eliminates the race creation entirely for the common case.

---

### R12-DBG-04 — gracefulShutdown never calls process.exit(); process does not exit after drain

- **ID:** R12-DBG-04
- **Severity:** LOW
- **Confidence:** Confirmed by reasoning
- **File:** `apps/web/src/instrumentation.ts:49,63,71`

**Latent bug:**
After `gracefulShutdown` completes — either by draining successfully or hitting the 15-second timeout — it sets `process.exitCode = completed ? 0 : 1` and returns. It never calls `process.exit()`. The mysql2 connection pool, Next.js HTTP server, and (until R12-DBG-01/R12-DBG-03 are fixed) orphaned timers all keep the event loop alive indefinitely. The process does NOT exit on its own after the graceful shutdown function completes.

In the Docker deployment (`docker stop gallerykit-web`), the consequence is:
1. SIGTERM sent → `gracefulShutdown` starts draining the queue (good)
2. Docker's default stop timeout is 10 seconds (`stop_grace_period`)
3. If the drain completes in < 10s: `process.exitCode = 0` is set, function returns, process KEEPS RUNNING
4. Docker stop timeout expires → SIGKILL
5. Process exits via SIGKILL; `process.exitCode = 0` is irrelevant (exit code from SIGKILL is 137)

The 15-second code timeout is longer than Docker's 10-second default stop timeout, so Docker SIGKILL's before the code's own timer can ever fire. The `completed ? 0 : 1` distinction in `process.exitCode` is never surfaced to Docker or systemd.

**Trigger condition:** Every `docker stop` in production.

**Observable failure:** Docker always reports exit code 137 (SIGKILL) for the container stop, never a voluntary 0 or 1. The intention of setting `process.exitCode` to distinguish clean vs truncated shutdown is unrealized. Additionally, if future code uses the `'exit'` event to perform last-chance cleanup, that cleanup runs only if `process.exit()` is called first.

**Suggested fix:** Call `process.exit()` at the end of `gracefulShutdown` after setting `process.exitCode`:
```typescript
process.exitCode = completed ? 0 : 1;
process.exit(process.exitCode);
```

`process.exit()` triggers registered `'exit'` event handlers synchronously before the process terminates, which is the correct semantic. Calling it after the drain is complete is safe.

---

## Carry-Over Open Findings

The following findings were raised in prior cycles and are confirmed still present at HEAD 2a9976a1.

---

### R12-DBG-05 — decimalToRational subnormal input returns "1/Infinity"

- **ID:** R12-DBG-05 (originally Finding 16 from prior cycle)
- **Severity:** LOW
- **Confidence:** Confirmed by reasoning
- **File:** `apps/web/src/lib/process-image.ts` (`normalizeExposureTime`, `decimalToRational`)

**Latent bug:**
`normalizeExposureTime` guards with `typeof val === 'number' && Number.isFinite(val) && val > 0` before calling `decimalToRational(val)`. The guard `val > 0` passes for subnormal floats such as `Number.MIN_VALUE` (≈ 5e-324). Inside `decimalToRational`:
- `1 / Number.MIN_VALUE = Infinity`
- `Math.round(Infinity) = Infinity`
- `Infinity > 0 = true` (passes the "rational denominator" check)
- `1 / Infinity = 0`
- `|0 - Number.MIN_VALUE| < 0.001 = true` (passes the tolerance check)
- Returns `"1/Infinity"` as the exposure time string

**Trigger condition:** EXIF `ExposureTime` rational tag with an astronomically small non-zero numerator (sub-1e-300 range). Not realistically occurring in camera-produced files; possible in a crafted or corrupted EXIF payload.

**Observable failure:** `"1/Infinity"` stored in the `exposure_time` DB column and rendered in the photo viewer's EXIF panel.

**Suggested fix:** Strengthen the guard to `val >= Number.EPSILON` instead of `val > 0`, or add `Number.isFinite(Math.round(1 / val))` inside `decimalToRational` before attempting rational formatting.

---

### R12-DBG-06 — BoundedMap.entries() returns raw iterator without shallow copies

- **ID:** R12-DBG-06 (originally Finding 35 from prior cycle)
- **Severity:** LOW
- **Confidence:** Confirmed by code inspection
- **File:** `apps/web/src/lib/bounded-map.ts:115-117`

**Latent bug:**
`BoundedMap.get()` returns `{ ...value }` (a shallow copy) specifically to prevent external mutation of internal state. `entries()` at line 115 returns `this.map.entries()` — the raw internal Map iterator, exposing actual stored references. A caller that iterates `entries()` and mutates returned objects directly mutates the BoundedMap's internal state, bypassing the copy-on-read guarantee. `[Symbol.iterator]()` at line 119 has the same issue.

Currently, no known callsite uses `entries()` to mutate entries, but the asymmetry is a correctness trap for future callers.

**Suggested fix:**
```typescript
*entries(): IterableIterator<[K, V]> {
    for (const [k, v] of this.map) {
        yield [k, typeof v === 'object' && v !== null ? { ...v } as V : v];
    }
}
```

---

### R12-DBG-07 — tokenHashesEqual length check leaks token length via timing

- **ID:** R12-DBG-07 (originally Finding 28 from prior cycle)
- **Severity:** LOW
- **Confidence:** Needs validation
- **File:** `apps/web/src/lib/admin-tokens.ts:64-66`

**Latent bug:**
`tokenHashesEqual` exits early with `return false` if `a.length !== b.length`. The early-exit path is faster than the `timingSafeEqual` path, leaking whether the candidate token has the correct length.

**Mitigating factors:** Both `a` and `b` are SHA-256 hex digests (always 64 chars) for valid tokens. In practice the early-exit is never taken on the happy path. Exploitability requires sub-microsecond remote timing precision. Severity remains LOW.

**Suggested fix:** Always run `timingSafeEqual` on fixed-size 32-byte buffers, using a dummy buffer for invalid-length inputs:
```typescript
const EXPECTED_HEX_LEN = 64;
const aBuf = a.length === EXPECTED_HEX_LEN ? Buffer.from(a, 'hex') : Buffer.alloc(32);
const bBuf = b.length === EXPECTED_HEX_LEN ? Buffer.from(b, 'hex') : Buffer.alloc(32, 1);
const equal = timingSafeEqual(aBuf, bBuf);
return a.length === EXPECTED_HEX_LEN && b.length === EXPECTED_HEX_LEN && equal;
```

---

## Confirmed Closed in Prior Cycles

- **AGG-M6** (`gallery-config.ts` — `semanticSearchMode` fallback missing operator gate): **CLOSED.** The fallback path now applies the same `value === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true'` gate as the happy path. Confirmed at HEAD 2a9976a1.

- **AGG-M13** (`db/index.ts` — connection init never times out): **CORE CLOSED.** A `Promise.race` against a 10-second `initTimeout` was added. The initTimeout timer accumulation on pool-reuse paths is filed separately as R12-DBG-03.

- **`normalizeExposureTime` NaN/Inf regression** (prior cycles): `Number.isFinite(val) && val > 0` guard added. The subnormal sub-case (R12-DBG-05) is carried over but is a pre-existing gap, not a regression.

---

## Module Coverage (Cycle 12 Inspection)

| Module | Status |
|---|---|
| `instrumentation.ts` | Inspected — 2 new findings (R12-DBG-01, R12-DBG-04) |
| `image-queue.ts` | Inspected — 1 new finding (R12-DBG-02) |
| `db/index.ts` | Inspected — 1 new finding (R12-DBG-03) |
| `process-image.ts` | Inspected — carry-over R12-DBG-05 confirmed present |
| `bounded-map.ts` | Inspected — carry-over R12-DBG-06 confirmed present |
| `admin-tokens.ts` | Inspected — carry-over R12-DBG-07 confirmed present |
| `view-retention.ts` | Inspected — clean |
| `gallery-config.ts` | Inspected — AGG-M6 confirmed closed |
| `gps-exif-strip.ts` | Inspected — bounded ISOBMFF walker with `BigInt(Number.MAX_SAFE_INTEGER)` guard; clean |
| `auth-rate-limit.ts` | Inspected (prior session) — shallow copies correct; clean |
| `icc-chromaticity.ts` | Inspected (prior session) — all `readS15Fixed16` callers guard with `!Number.isFinite`; clean |
| `gain-map-detection.ts` | Inspected (prior session) — bounded ISOBMFF walk; clean |
| `migrate.js` | Inspected (prior session) — hash-based post-condition prevents silent skips; clean |

---

## References

- `apps/web/src/instrumentation.ts:21-26` — stale timeout timer (R12-DBG-01)
- `apps/web/src/instrumentation.ts:49,63,71` — missing `process.exit()` (R12-DBG-04)
- `apps/web/src/lib/image-queue.ts:183-192` — null queue guard regression (R12-DBG-02)
- `apps/web/src/db/index.ts:87-100` — initTimeout timer accumulation (R12-DBG-03)
- `apps/web/src/lib/process-image.ts` — `decimalToRational` subnormal (R12-DBG-05, carry-over)
- `apps/web/src/lib/bounded-map.ts:115-117` — `entries()` no shallow copy (R12-DBG-06, carry-over)
- `apps/web/src/lib/admin-tokens.ts:64-66` — length timing leak (R12-DBG-07, carry-over)
