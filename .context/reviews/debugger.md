# Cycle 14 Debugger Review

**Date:** 2026-06-27
**HEAD**: 80145992 (cycle-13 aggregate baseline)
**Reviewer:** debugger agent (Sonnet 4.6)
**Scope**: Full latent-bug sweep — async/queue code, data layer, server actions, lib/* utilities, instrumentation.ts, scripts/migrate.js
**Prior state**: All gates GREEN after cycle 13 (eslint, tsc, vitest 2071 pass/4 skip, lint:api-auth/action-origin/public-route-rate-limit)

---

## Severity Table

| ID | File:Line | Severity | Confidence | Summary |
|----|-----------|----------|------------|---------|
| R14-01 | `lib/data.ts:196-207` | MEDIUM | High | `flushBufferedSharedGroupViewCounts` returns early on empty buffer without checking `isFlushing` — in-flight DB writes silently dropped on SIGTERM during an active flush |
| R14-02 | `lib/icc-extractor.ts:~95` | LOW | High | `mluc` bounds guard is `dataSize < 12` but `readUInt32BE(dataOffset+12)` needs 4 more bytes past that offset; requires `dataSize >= 16`; RangeError caught by outer try/catch |
| TRC-13-04 | `lib/process-image.ts:1414-1421` | LOW | High | `decimalToRational` with subnormal inputs produces `"1/Infinity"`. Carry-over, confirmed unreachable with real EXIF exposure times |
| TRC-13-05 | `lib/bounded-map.ts:114-117` | LOW | Medium | `entries()` returns raw Map iterator. Carry-over, confirmed zero production callers |

---

## Findings

### R14-01 — `flushBufferedSharedGroupViewCounts` does not wait for an in-flight flush (MEDIUM)

**File**: `apps/web/src/lib/data.ts:196-207`

```typescript
export async function flushBufferedSharedGroupViewCounts() {
    if (viewCountFlushTimer) {
        clearTimeout(viewCountFlushTimer);
        viewCountFlushTimer = null;
    }

    if (viewCountBuffer.size === 0) {
        return;   // ← returns here without checking isFlushing
    }

    await flushGroupViewCounts();
}
```

**Root cause**: `flushGroupViewCounts()` (lines 94-101) performs an atomic buffer swap BEFORE writing to the DB:

```typescript
isFlushing = true;
const batch = viewCountBuffer;
viewCountBuffer = new Map();   // ← buffer is now empty; DB writes begin for `batch`
```

When SIGTERM fires while `isFlushing = true`, the sequence is:
1. `flushGroupViewCounts` sets `isFlushing = true`, swaps `viewCountBuffer` to an empty new Map, begins DB writes for the old batch.
2. `gracefulShutdown` (instrumentation.ts) calls `flushBufferedSharedGroupViewCounts()`.
3. `viewCountBuffer.size === 0` is true (the new empty Map) → early return immediately.
4. `Promise.all([shutdownImageProcessingQueue(), flushBufferedSharedGroupViewCounts()])` resolves with `completed = true`.
5. `process.exit(0)` is called — the in-flight `flushGroupViewCounts` DB writes are killed mid-execution.

**Trigger**: SIGTERM received during the ~5–50 ms window while `isFlushing = true` (i.e., after the atomic swap but before `isFlushing` is reset to false in the finally block at line 141). This window is short per event but will occur in production across enough deployments.

**Impact**: View counts from the swapped batch that were being written to the DB are lost. This is best-effort-by-design per CLAUDE.md ("view_count is best-effort approximate analytics…do not treat it as billing/audit-grade state"), so data loss is acceptable per spec. However the SIGTERM path was specifically hardened in cycles 11-13 to drain in-flight state; not waiting for an in-progress flush is inconsistent with that hardening intent.

**Fix** — expose the in-flight flush promise at module scope (minimal diff):

```typescript
// NEW: track the in-flight flush so shutdown can await it
let currentFlushPromise: Promise<void> | null = null;

async function flushGroupViewCounts() {
    viewCountFlushTimer = null;
    if (isFlushing) { ... return; }
    isFlushing = true;
    const batch = viewCountBuffer;
    viewCountBuffer = new Map();

    // wrap the body in a tracked promise
    const p = (async () => {
        try { /* existing chunk-write loop unchanged */ }
        finally {
            isFlushing = false;
            currentFlushPromise = null;
            /* existing timer re-arm and eviction code unchanged */
        }
    })();
    currentFlushPromise = p;
    await p;
}

export async function flushBufferedSharedGroupViewCounts() {
    if (viewCountFlushTimer) {
        clearTimeout(viewCountFlushTimer);
        viewCountFlushTimer = null;
    }

    // Wait for any in-flight flush to complete before inspecting the buffer.
    if (currentFlushPromise) {
        await currentFlushPromise;
    }

    if (viewCountBuffer.size === 0) {
        return;
    }

    await flushGroupViewCounts();
}
```

**Verification**: mock the DB chunk-write to sleep 500 ms; send SIGTERM mid-sleep; confirm the shutdown log shows the sentinel fires only AFTER the mock write returns.

**Similar pattern**: `shutdownImageProcessingQueue` in queue-shutdown.ts correctly drains via `queue.onIdle()` before returning — same pattern should apply here.

---

### R14-02 — ICC extractor `mluc` bounds guard off by 4 bytes (LOW)

**File**: `apps/web/src/lib/icc-extractor.ts` (~line 95, `mluc` branch)

**Root cause**: The outer guard before `mluc` processing is:
```typescript
if (dataOffset + 12 > iccLen || dataSize < 12 || dataOffset + dataSize > iccLen) break;
```
Then inside the `mluc` branch:
```typescript
const numRecords = Math.min(icc.readUInt32BE(dataOffset + 8), 100);  // reads bytes [+8,+12) — within guard ✓
const recordSize = icc.readUInt32BE(dataOffset + 12);                 // reads bytes [+12,+16) — NOT within guard ✗
```

`readUInt32BE(dataOffset + 12)` needs `dataOffset + 16 <= iccLen`. The guard only ensures `dataOffset + 12 <= iccLen` (via `dataOffset + dataSize <= iccLen` + `dataSize >= 12`). With a pathologically small `mluc` tag where `dataSize = 12` and `iccLen = dataOffset + 12`, Node.js throws `RangeError: The value of "offset" is out of range`.

**Trigger**: Malformed ICC profile where the `mluc` tag's declared `dataSize = 12`. No valid `mluc` tag has fewer than 16 bytes (header + reserved + numRecords + recordSize). Only adversarially crafted or severely corrupted ICC data triggers this.

**Impact**: The outer `try { ... } catch { /* ICC parsing is best-effort */ }` catches the `RangeError` and returns `null` for the profile name. No crash, no data corruption, no security impact — correct best-effort fallback.

**Fix** (one character change):
```typescript
// Before:
if (dataOffset + 12 > iccLen || dataSize < 12 || dataOffset + dataSize > iccLen) break;
// After:
if (dataOffset + 12 > iccLen || dataSize < 16 || dataOffset + dataSize > iccLen) break;
```

The `desc` path only reads up to `dataOffset + 12` so is unaffected by this guard tightening.

---

## Cycle-13 Commit Verification

All five main cycle-13 commits verified correct:

| Commit | Change | Verdict |
|--------|--------|---------|
| `7d1b3727` | `exec node server.js` in Dockerfile CMD | Correct — PID-1 signal delivery fixed |
| `552df92c` | `stats.bavail` instead of `stats.bfree` | Correct — available-to-unprivileged-user disk check |
| `f70d6579` | `getPasswordChangeRateLimitEntry` returns `{...entry}` copy | Correct — shallow-copy contract restored; matches `getLoginRateLimitEntry` and `getAccountLoginRateLimitEntry` |
| `8613e36f` | `hasColorDetails` and `transfer_function` gated on `isAdmin` | Correct — admin-only fields no longer leak to public color-details surface |
| `85f580ea` | Feed query uses `null` not `adminUsers.username` | Correct — `uploaded_by` PII removed from public Atom feed |

---

## Deferred Carry-Overs (confirmed, no change)

**TRC-13-04 — `decimalToRational` subnormal** (`process-image.ts:1414-1421`, LOW):
`val = 5e-324` → `Math.round(1/val) = Infinity` → produces `"1/Infinity"`. Confirmed unreachable: real EXIF exposure times are always in the range `[1/32000 s, 30 s]`, never near `Number.MIN_VALUE`. No fix needed.

**TRC-13-05 — `BoundedMap.entries()` raw iterator** (`bounded-map.ts:114-117`, LOW):
Returns the Map's live iterator without a snapshot copy. Confirmed zero production callers of `entries()` across all of `src/` and `scripts/`. The safe alternative `windowedEntries()` (lines 119-125) is used exclusively in the one call site that needs iteration. No fix needed until a new `entries()` caller is added.

---

## Areas Inspected (no new issues found)

- `lib/queue-shutdown.ts` — `drainProcessingQueueForShutdown` correctly clears `gcInterval` and `bootstrapRetryTimer` before `queue.onIdle()` drain. No resource leak.
- `lib/icc-chromaticity.ts` — `chad` matrix inversion has `|det| < 1e-12` guard, `Number.isFinite(det)` check, `invert3x3` returns null on singular matrix; `xyzToXy` guards `|sum| < 1e-9`. All bounds correct.
- `lib/gain-map-detection.ts` — ISOBMFF walker bounded at MAX_DEPTH=5 / MAX_SCAN_BYTES=1MB; `Number(readBigUInt64BE)` is safe for buffers well under `Number.MAX_SAFE_INTEGER`; `readBoxHeader` handles `size = 0` and extended 64-bit sizes correctly.
- `lib/color-detection.ts` — NCLX `colr` box walker: `limit = Math.min(end, offset + MAX_SCAN_BYTES, buffer.length)` correct; 64-bit extended-size `Number(BigInt(...))` conversion is safe for practical 1 MB scan windows.
- `lib/auth-rate-limit.ts` — All three `get*RateLimitEntry` functions return `{...entry}` shallow copies; rollback decrements (`count - 1` then delete at 0) are correct; DB-backed `decrementRateLimit` called consistently.
- `lib/rate-limit.ts` — `preIncrementOgAttempt`, `rollbackOgAttempt`, `getClientIp` all correct.
- `lib/csv-escape.ts` — formula-injection prefix, C0/C1 strip, bidi/ZW strip, interlinear-anchor strip all correct and symmetrical with the validation layer.
- `app/actions/tags.ts` — `getAdminTags` has `@action-origin-exempt: read-only admin getter` comment (line 18); all mutating exports use `requireSameOriginAdmin()`.
- `app/actions/admin-backfill.ts` — `triggerBackfill` and `getBackfillStatus` both gate on `isAdmin()` then `requireSameOriginAdmin()`; mutex status correctly surfaces `lastError`.
- `app/actions/public.ts` — `preIncrementLoadMoreAttempt` and `checkLoadMoreRateLimit` cover public load-more mutations; analytics read actions carry `@action-origin-exempt` comments.
- `scripts/migrate.js` — `getAllJournalMigrations` SHA-256 hash check, `reconcileLegacySchema` idempotent CREATE/ALTER guards, `baselineAllJournalMigrations` INSERT IGNORE pattern, `runMigrations` post-condition assertion that throws on any missing hash. No silent-skip regression and no new schema columns missing from `reconcileLegacySchema`.

---

## Summary

**New confirmed findings**: 2
- R14-01 (MEDIUM): `data.ts:196-207` — `flushBufferedSharedGroupViewCounts` early-return on empty buffer misses in-flight DB writes when `isFlushing = true`. View counts from the swapped batch are killed on SIGTERM. Fix: expose `currentFlushPromise` and await it before the size check.
- R14-02 (LOW): `icc-extractor.ts:~95` — `mluc` guard is `dataSize < 12` but should be `dataSize < 16`; the read at `dataOffset+12` needs 4 bytes beyond offset 12. Caught by outer try/catch; no security or correctness impact.

**Cycle-13 regressions**: None detected. All 5 commits verified correct.
**Deferred carry-overs**: 2 confirmed low/theoretical — no change in disposition.
**Build gates**: Not re-run (read-only investigation); all were GREEN at HEAD 80145992.
