# Test Engineer Review — Cycle 13

**Date:** 2026-06-27
**Baseline:** 2071 tests pass, 4 skip (2 clip offline-load, 2 clip semantic-integration — require model weights on disk, correctly gated)
**Test files:** 226 unit + 5 e2e (Playwright)
**Vitest command:** `npm test --workspace=apps/web`

---

## Executive Summary

The test suite is healthy. All deferred items from cycle 12 (TEST-01 through TEST-06) were re-examined against current source. TEST-02 (audit-prioritize-security-fields) was confirmed complete in cycle 12. The remaining five deferred items are still open; this review updates their status and adds four new gaps arising from cycle-12 code changes. No flaky tests were detected.

---

## Test Suite Health

**Status: HEALTHY**
- 226 test files, 2071 assertions passing
- 4 skips are correctly gated behind missing CLIP model weights (clip-offline-load.test.ts, clip-semantic-integration.test.ts) — these are intentional environment-dependent tests, not flaky tests
- No tests with `setTimeout`/`sleep` in the body (timing-dependent flakiness risk is low)
- All `vi.resetModules()` + `vi.doMock()` isolation patterns are used correctly

---

## Deferred Items from Cycle 12 — Status Update

### TEST-01: Prune timer-gate negative path
**Status: STILL OPEN**
**Priority: Medium | Confidence: High**

The three prune helpers (`pruneOgRateLimit`, `pruneShareRateLimit`, `pruneSearchRateLimit`) share identical guard logic:

```
if (!shouldPrune) return false;
```

where `shouldPrune = options?.force || map.size > MAX_KEYS || now - lastPruneAt >= INTERVAL_MS`.

The existing tests in `og-rate-limit.test.ts` and `rate-limit.test.ts` only verify the happy path: expired entries are removed, live entries are kept. There is no test that calls a prune function twice in rapid succession (within the interval, without the force flag, below the size cap) and asserts it returns `false` without running.

**Risk:** If the `now - lastPruneAt >= INTERVAL` guard is accidentally inverted or removed, the prune will run on every request hit. For the OG route under moderate traffic, `pruneOgRateLimit` fires per OG image request; running `BoundedMap.prune()` (an O(n) scan of all rate-limit buckets) on every call adds measurable latency. The bug would be invisible to the current tests.

**Proposed test (file: `apps/web/src/__tests__/og-rate-limit.test.ts`):**
```ts
it('skips eviction when called again within the prune interval (timer gate)', () => {
    const now = 10_000_000;
    ogRateLimit.set('10.0.0.1', { count: 1, resetAt: now - 1 }); // expired
    pruneOgRateLimit(now);           // first call — runs, removes expired entry
    ogRateLimit.set('10.0.0.2', { count: 1, resetAt: now - 1 }); // new expired entry
    const pruned = pruneOgRateLimit(now + 1); // within interval — must NOT run
    expect(pruned).toBe(false);
    expect(ogRateLimit.has('10.0.0.2')).toBe(true); // still present
});
```

The same pattern should be added for `pruneShareRateLimit` in `rate-limit.test.ts`.

---

### TEST-02: audit-prioritize-security-fields
**Status: COMPLETE**

`apps/web/src/__tests__/audit-prioritize-security-fields.test.ts` exists and is thorough. Six test cases cover ordering, non-priority key preservation, absent key skipping, value preservation, empty object, and all-six-present order. No action needed.

---

### TEST-03: getExpectedOrigin null-host path
**Status: SUBSTANTIALLY COVERED — gap is minor**
**Priority: Low | Confidence: High**

`request-origin.test.ts` line 114 has `'returns null when all protocol headers are missing'` which covers `getTrustedRequestProtocol` returning null. Line 135 has `'fails closed by default when origin metadata is missing (C1R-01)'` which tests `hasTrustedSameOrigin` with host+proto but no origin/referer returning false. The specific scenario where the HOST header is also absent (making `getExpectedOrigin` return null) is not a named standalone test, but the behavioral outcome is exercised.

The `hasTrustedSameOriginWithOptions` export (AGG-R12-09) is now tested at lines 139-150 with `allowMissingSource: true` and `allowMissingSource: false`. This was a deferred concern from cycle 12 — it is now covered.

**No new test required.** The named-test gap is cosmetic; the behavior is locked.

---

### TEST-04: safeUnlink ENOENT discrimination
**Status: STILL OPEN — updated characterization**
**Priority: Low | Confidence: Medium**

`safeUnlink` (process-image.ts:89, private, not exported) handles errors as follows:
- `ENOENT` — silent return (expected race with delete)
- non-ENOENT (EMFILE, ENOSPC, EACCES) — `console.debug(...)` then also silently returns (does NOT rethrow)

The key behavioral contract is: `safeUnlink` never throws. A cleanup failure in one file never aborts the rest of the cleanup fan-out in `processImageFormats`. This is the correct design, but if the catch block is accidentally removed and `fs.unlink` throws on ENOENT, the entire `Promise.all` cleanup sweep would reject.

Since `safeUnlink` is private, the test must be a source-contract test.

**Proposed test (new file: `apps/web/src/__tests__/process-image-safe-unlink.test.ts`):**
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('safeUnlink (process-image.ts)', () => {
    const source = readFileSync(resolve(__dirname, '../lib/process-image.ts'), 'utf8');

    it('catches ENOENT and returns silently', () => {
        expect(source).toMatch(/if \(code === ['"]ENOENT['"]\)\s*\{[\s\S]*?return/);
    });

    it('logs non-ENOENT errors at debug level without rethrowing', () => {
        expect(source).toMatch(/console\.debug\(/);
        // The catch block must not contain a bare throw after the ENOENT guard
        const catchBlock = /catch \(err\)\s*\{([\s\S]*?)\n\s*\}/m.exec(source)?.[1] ?? '';
        expect(catchBlock).not.toMatch(/\bthrow\b/);
    });
});
```

---

### TEST-05: rollbackOgAttempt behavioral
**Status: STILL OPEN**
**Priority: Medium | Confidence: High**

`rollbackOgAttempt` (rate-limit.ts:261) is exported and has clear testable behavior:

```ts
export function rollbackOgAttempt(ip: string) {
    const currentEntry = ogRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        ogRateLimit.set(ip, { count: currentEntry.count - 1, resetAt: currentEntry.resetAt });
    } else {
        ogRateLimit.delete(ip);
    }
}
```

Currently only source-contract tests exist: `og-photo-fallback.test.ts` checks that the call site string `rollbackOgAttempt(ip)` appears exactly twice in the photo-route source, and `og-route-source-contracts.test.ts` checks it does NOT appear in the topic-route source. Neither test verifies the function's own behavior.

**Risk:** If the decrement/delete logic is accidentally swapped (e.g., `count > 1` becomes `count > 0`, deleting entries prematurely), the source contract tests pass but rate-limit counters drift wrong. Under realistic OG traffic, a pre-DB 404 (image not found) would double-decrement the bucket.

**Proposed test (file: `apps/web/src/__tests__/og-rate-limit.test.ts`, appended):**
```ts
import { rollbackOgAttempt } from '@/lib/rate-limit'; // add to existing import

describe('rollbackOgAttempt', () => {
    it('decrements count when greater than 1', () => {
        const ip = '192.0.2.5';
        const now = 1_000_000;
        ogRateLimit.set(ip, { count: 3, resetAt: now + OG_WINDOW_MS });
        rollbackOgAttempt(ip);
        expect(ogRateLimit.get(ip)?.count).toBe(2);
    });

    it('deletes the entry when count equals 1', () => {
        const ip = '192.0.2.6';
        const now = 1_000_000;
        ogRateLimit.set(ip, { count: 1, resetAt: now + OG_WINDOW_MS });
        rollbackOgAttempt(ip);
        expect(ogRateLimit.has(ip)).toBe(false);
    });

    it('is a no-op when the entry is absent', () => {
        rollbackOgAttempt('192.0.2.7'); // must not throw
        expect(ogRateLimit.has('192.0.2.7')).toBe(false);
    });
});
```

---

### TEST-06: bootstrap first-scan-empty named test
**Status: STILL OPEN**
**Priority: Medium | Confidence: High**

The three existing bootstrap tests ("caps each bootstrap pass", "continues scanning after cursor", "retries after ECONNREFUSED") all resolve to `bootstrapped = true` as a postcondition of cursor-pagination paths, not as a direct test of the first-scan-empty path. The branching logic at image-queue.ts:756 is:

```ts
if (pending.length === 0 && state.bootstrapCursorId === null) {
    state.bootstrapped = true;  // first scan: truly no pending images
    state.bootstrapCursorId = null;
}
```

This branch only executes when the first scan (cursor is null) returns zero rows. It is the normal steady-state after all images are processed, but no test names or targets it explicitly.

**Proposed test (file: `apps/web/src/__tests__/image-queue-bootstrap.test.ts`, appended inside the `bootstrapImageProcessingQueue` describe):**
```ts
it('sets bootstrapped=true immediately when the first scan returns no pending images (TEST-06)', async () => {
    const { bootstrapImageProcessingQueue, getProcessingQueueState } = await loadQueueModule({
        getPendingImages: vi.fn().mockResolvedValue([]),
    });
    await bootstrapImageProcessingQueue();
    const state = getProcessingQueueState();
    expect(state.bootstrapped).toBe(true);
    expect(state.bootstrapCursorId).toBeNull();
});
```

---

## New Findings from Cycle-12 Code Changes

### NEW-01: db/index.ts initTimer clearTimeout fix not locked
**Priority: Low | Confidence: High**
**Source: AGG-R12-04 (cycle-12 fix)**

`db/index.ts` was fixed to capture and clear the 10-second init timeout:
```ts
let initTimer: ReturnType<typeof setTimeout> | undefined;
const initTimeout = new Promise<void>((_, reject) => {
    initTimer = setTimeout(..., 10_000);
    initTimer.unref?.();
});
try {
    await Promise.race([initPromise, initTimeout]);
} finally {
    if (initTimer) clearTimeout(initTimer);
}
```

`db-pool-connection-handler.test.ts` is an existing source-contract test that verifies structural patterns via regex. It does NOT check for `clearTimeout(initTimer)` or `initTimer.unref?.()`. If the finally clause is accidentally dropped (reverting the fix), no test catches it — the event loop leak silently reappears.

**Proposed addition to `apps/web/src/__tests__/db-pool-connection-handler.test.ts`:**
```ts
it('captures and clears the init timeout in the finally block (AGG-R12-04)', () => {
    expect(source).toMatch(/initTimer\s*=\s*setTimeout\(/);
    expect(source).toMatch(/initTimer\.unref\?\.\(\)/);
    expect(source).toMatch(/if \(initTimer\) clearTimeout\(initTimer\)/);
});
```

---

### NEW-02: instrumentation.ts shutdown timer fix not locked
**Priority: Low | Confidence: High**
**Source: AGG-R12-01 (cycle-12 fix)**

`instrumentation.ts` was fixed to unref and clear the 15-second shutdown timeout:
```ts
shutdownTimer = setTimeout(..., 15_000);
shutdownTimer.unref?.();
// in finally:
if (shutdownTimer) clearTimeout(shutdownTimer);
```

No test file covers `instrumentation.ts` at all. A source-contract test is cheap to add and would lock both the `unref?.()` and `clearTimeout` patterns, plus the SIGTERM/SIGINT handler registrations.

**Proposed new file: `apps/web/src/__tests__/instrumentation-shutdown-timer.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('instrumentation.ts — shutdown timer (AGG-R12-01)', () => {
    const source = readFileSync(resolve(__dirname, '../instrumentation.ts'), 'utf8');

    it('captures the shutdown timer for later cleanup', () => {
        expect(source).toMatch(/shutdownTimer\s*=\s*setTimeout\(/);
    });

    it('calls unref() on the timer so it cannot alone keep the event loop alive', () => {
        expect(source).toMatch(/shutdownTimer\.unref\?\.\(\)/);
    });

    it('clears the timer in the finally block to prevent spurious timeout warning', () => {
        expect(source).toMatch(/if \(shutdownTimer\) clearTimeout\(shutdownTimer\)/);
    });

    it('registers SIGTERM and SIGINT handlers with process.on', () => {
        expect(source).toMatch(/process\.on\(['"]SIGTERM['"]/);
        expect(source).toMatch(/process\.on\(['"]SIGINT['"]/);
    });
});
```

---

### NEW-03: getProcessingQueueState guard hardening not locked
**Priority: Low | Confidence: Medium**
**Source: AGG-R12-11 (cycle-12 fix)**

The cycle-12 fix to `getProcessingQueueState` in `image-queue.ts` added validation:
```ts
if (existing.queue && typeof existing.queue.add === 'function' && existing.enqueued instanceof Set) {
    return existing as ProcessingQueueState;
}
```

No test verifies this guard. It protects against stale/corrupted module state after hot-reload or test isolation failures.

**Proposed addition (source-contract, appended to `apps/web/src/__tests__/image-queue-bootstrap.test.ts`):**
```ts
import { readFileSync } from 'fs';
import { resolve } from 'path';

it('getProcessingQueueState validates queue.add and enqueued instanceof Set before reusing state (AGG-R12-11)', () => {
    const src = readFileSync(resolve(__dirname, '../lib/image-queue.ts'), 'utf8');
    expect(src).toMatch(/typeof.*queue\.add.*===.*['"]function['"]/);
    expect(src).toMatch(/enqueued instanceof Set/);
});
```

---

## Other Coverage Gaps

### GAP-01: formatShutterSpeed and hasExifData in image-types.ts — untested pure functions
**Priority: Low | Confidence: High**

`apps/web/src/lib/image-types.ts` contains two non-trivial pure utility functions with no test coverage:

- `hasExifData(val)` — returns false for null/undefined/empty string/non-finite numbers
- `formatShutterSpeed(exposureTime)` — converts `"0.002"` to `"1/500"`, `"1.5"` to `"1.5s"`, `"1/125"` stays as `"1/125"`

`formatShutterSpeed` has two non-obvious branches: the fraction-conversion path (checks `Math.abs(1/denominator - val) < 0.00001`) and the whole/decimal-second suffix path. These silently regress when someone edits the threshold or suffix logic.

**Proposed new file: `apps/web/src/__tests__/image-types.test.ts`**

---

### GAP-02: BoundedMap.entries() iterator — no behavioral test
**Priority: Low | Confidence: Medium**
**Source: AGG-R12-10 (deferred from cycle 12)**

`BoundedMap.entries()` (bounded-map.ts:115) returns `this.map.entries()` — a live ES6 Map iterator. `bounded-map.test.ts` has thorough coverage of `prune`, `set`, `get`, `has`, `size`, and `clear`, but no test for `entries()` or `Symbol.iterator`.

**Proposed addition to `apps/web/src/__tests__/bounded-map.test.ts`:**
```ts
it('entries() yields all entries in insertion order', () => {
    const map = makeSlidingWindowMap(60_000, 10);
    const now = 1_000_000;
    map.set('a', { count: 1, lastAttempt: now });
    map.set('b', { count: 2, lastAttempt: now });
    expect([...map.entries()]).toEqual([
        ['a', { count: 1, lastAttempt: now }],
        ['b', { count: 2, lastAttempt: now }],
    ]);
});
```

---

## Flaky Test Risk Assessment

**No flaky tests identified.**

Key risk factors checked:
- No test uses `setTimeout`, `setInterval`, or `sleep` in its body
- All time-dependent tests pass an explicit `now` timestamp parameter rather than calling `Date.now()`
- Module-isolation tests use `vi.resetModules()` + `vi.doMock()` (correct pattern for Vitest)
- The 4 skipped CLIP tests are correctly gated by `CLIP_MODELS_ROOT` environment presence — they do not skip stochastically

One low-risk observation: `image-queue-quiesce.test.ts:137` directly sets `state.bootstrapRetryTimer.unref?.()`, reaching into internal queue state. Not flaky, but tightly coupled to `ProcessingQueueState` field naming — a refactor of that field name would silently pass the test while the implementation drifts.

---

## Proposed Test Additions — Prioritized

| ID | File | Behavior | Priority |
|----|------|----------|----------|
| TEST-05 | `og-rate-limit.test.ts` | rollbackOgAttempt: decrement when count>1, delete when count=1, no-op when absent | Medium |
| TEST-06 | `image-queue-bootstrap.test.ts` | first scan returns empty array with null cursor → bootstrapped=true | Medium |
| TEST-01 | `og-rate-limit.test.ts` + `rate-limit.test.ts` | prune timer-gate returns false when called within interval without force | Medium |
| NEW-02 | `instrumentation-shutdown-timer.test.ts` (new) | shutdownTimer unref+clearTimeout source contract, SIGTERM/SIGINT handler registration | Low |
| NEW-01 | `db-pool-connection-handler.test.ts` | initTimer unref+clearTimeout source contract (AGG-R12-04) | Low |
| GAP-01 | `image-types.test.ts` (new) | formatShutterSpeed fraction conversion, suffix logic; hasExifData edge cases | Low |
| TEST-04 | `process-image-safe-unlink.test.ts` (new) | safeUnlink catches ENOENT silently, non-ENOENT logged, never rethrows | Low |
| NEW-03 | `image-queue-bootstrap.test.ts` | getProcessingQueueState validates queue.add + enqueued instanceof Set (AGG-R12-11) | Low |
| GAP-02 | `bounded-map.test.ts` | entries() yields correct [K,V] pairs in insertion order | Low |

---

## Verification

Baseline run: `npm test --workspace=apps/web`

```
Test Files  226 passed | 2 skipped (228)
     Tests  2071 passed | 4 skipped (2075)
  Duration  21.00s
```

All passing. No regressions introduced by this review cycle (read-only analysis).
