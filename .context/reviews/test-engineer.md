# Comprehensive Test Review — GalleryKit

**Repository:** `/Users/hletrd/flash-shared/gallery`
**HEAD:** `2a9976a1`
**Previous Review HEAD:** `bcd67b12` (Cycle 11)
**Date:** 2026-06-27
**Reviewer:** Test Engineer (oh-my-claudecode:test-engineer)
**Status:** HEALTHY — all 225 test files pass; 8 new coverage gaps identified for recent fixes

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Unit test files | 225 passed, 2 skipped (227 total) |
| Unit tests | ~2,100+ total |
| E2E test files | 5 (admin.spec.ts, public.spec.ts, origin-guard.spec.ts, nav-visual-check.spec.ts, test-fixes.spec.ts) |
| Test framework | Vitest (unit), Playwright 1.59.1 (e2e) |
| Full suite duration | ~25s |

**Improvement from prior review:** The 3 previously failing tests are now resolved:
- `image-queue-bootstrap.test.ts` — 2 timeout failures → FIXED (bootstrap logic refactored)
- `touch-target-audit.test.ts` — new sub-44px violation → FIXED by `f1f6202d`
- `request-origin.test.ts` — test pollution flake → NOW STABLE

**New concern:** 11 code-changing commits landed between `bcd67b12` and `2a9976a1`. Of those, 8 introduce behavior changes with no regression test. The security and correctness fixes with the highest risk of silent regression are itemized below.

---

## 2. Commit-to-Test Mapping (since bcd67b12)

| Commit | Description | Test added? |
|--------|-------------|-------------|
| `f1f6202d` | fix(ui): improve touch targets, ARIA, motion safety | No (test fixture updated) |
| `5ba4025c` | fix(request-origin): return null on protocol fallback | Yes — 8 lines added |
| `450d2a53` | fix(request-origin): handle null protocol in getExpectedOrigin | NO — specific edge case untested |
| `9d88e217` | fix(rate-limit): timer-based prune + shallow-copy mutation fix | PARTIAL — existing tests don't cover new timer gate or mutation semantics |
| `2b166245` | fix(public): shallow-copy mutation bugs in rate-limit helpers | NO |
| `74bd776a` | fix(public): remaining shallow-copy mutation bugs | NO |
| `3111cc7e` | fix(process-image): safeUnlink/safeCloseDirHandle ENOENT distinction | NO |
| `6cfcc75d` | fix(audit): prioritize security fields in metadata truncation | NO |
| `d6107f89` | fix(queue): distinguish first-scan empty from continuation empty | Indirect only |
| `038b3154` | fix(rate-limit): semanticRateLimit.set() fix | NO |
| `b3c55036` | fix(shutdown): SIGTERM handler, geoip pre-warm, queue state validation | NO |
| `92ce7a9e` | fix(photo-viewer): local ConnInfo interface for navigator.connection | NO (TS-only) |

---

## 3. New Findings

### R12-TEST-01 — `pruneOgRateLimit` / `pruneShareRateLimit` timer-gate behavior untested

**Severity:** HIGH  
**Confidence:** HIGH  
**Gap:** `9d88e217` added conditional skipping to both prune functions. `pruneOgRateLimit(now)` now returns `false` and skips the prune when called within 60 seconds of the last run (unless `force: true` is passed). The existing test in `og-rate-limit.test.ts` calls `pruneOgRateLimit(now)` exactly once and does not check the return value. There is no test verifying:

1. That a second call within the 60s window returns `false` and skips the prune
2. That `pruneOgRateLimit(now, { force: true })` runs even within the window
3. That `resetOgRateLimitForTests()` resets `lastOgRateLimitPruneAt` (it does via the module reset, but this is untested)
4. Equivalent coverage for `pruneShareRateLimit`

**Risk:** If the timer gate logic has an off-by-one or the `lastPruneAt` state is corrupted, prune runs every request (performance hit) or never runs (unbounded memory growth for OG/share rate-limit maps). Neither regression would be caught.

**Concrete test to add** (`apps/web/src/__tests__/og-rate-limit.test.ts`):
```typescript
it('skips prune within the interval and returns false', () => {
    const now = 10_000_000;
    ogRateLimit.set('1.2.3.4', { count: 1, resetAt: now - 1 });
    expect(pruneOgRateLimit(now)).toBe(true);           // first call — runs
    ogRateLimit.set('1.2.3.5', { count: 1, resetAt: now - 1 });
    expect(pruneOgRateLimit(now + 1)).toBe(false);      // within interval — skipped
    expect(ogRateLimit.has('1.2.3.5')).toBe(true);      // entry not evicted
});

it('force option bypasses the timer gate', () => {
    const now = 10_000_000;
    ogRateLimit.set('1.2.3.6', { count: 1, resetAt: now - 1 });
    pruneOgRateLimit(now);                              // sets lastPruneAt
    ogRateLimit.set('1.2.3.7', { count: 1, resetAt: now - 1 });
    expect(pruneOgRateLimit(now + 1, { force: true })).toBe(true);
    expect(ogRateLimit.has('1.2.3.7')).toBe(false);    // evicted despite timer
});
```

---

### R12-TEST-02 — Audit metadata `prioritizeSecurityFields` function has zero tests

**Severity:** HIGH  
**Confidence:** HIGH  
**Gap:** `6cfcc75d` introduced `prioritizeSecurityFields()` in `apps/web/src/lib/audit.ts`. This function reorders metadata so security-relevant keys (`ip`, `userAgent`, `action`, `userId`, `targetType`, `targetId`) appear first in the JSON, maximizing their survival under the 4000-char truncation limit. Every existing test that calls `logAuditEvent` mocks the entire `@/lib/audit` module and never exercises this function.

**Risk:** If the priority order is wrong or the function silently drops keys, a large metadata payload could truncate away `ip` and `userAgent` before other fields — losing forensic data in the exact scenarios (high-volume or complex operations) where it matters most. No test would catch this.

**Concrete test to add** (`apps/web/src/__tests__/audit-security-fields.test.ts`):
```typescript
import { describe, expect, it } from 'vitest';
// Test the exported (or tested-via-integration) prioritizeSecurityFields behavior
// by checking logAuditEvent serializes in the right order.

it('places ip before non-security fields in serialized metadata', () => {
    const ordered = prioritizeSecurityFields({
        bulkCount: 50,
        ip: '1.2.3.4',
        details: 'some extra',
        userId: 7,
    });
    const keys = Object.keys(ordered);
    expect(keys.indexOf('ip')).toBeLessThan(keys.indexOf('bulkCount'));
    expect(keys.indexOf('userId')).toBeLessThan(keys.indexOf('details'));
});

it('preserves all fields even when all are priority fields', () => {
    const input = { ip: '1', userAgent: 'ua', action: 'login', userId: 1, targetType: 't', targetId: '1' };
    const ordered = prioritizeSecurityFields(input);
    expect(Object.keys(ordered)).toHaveLength(6);
});
```

Note: `prioritizeSecurityFields` is not currently exported. It must be either exported (with an `@internal` JSDoc note) or tested indirectly by inspecting the JSON string produced by `logAuditEvent`.

---

### R12-TEST-03 — `getExpectedOrigin` null-protocol + present-host edge case untested

**Severity:** MEDIUM-HIGH  
**Confidence:** HIGH  
**Gap:** `450d2a53` fixed `getExpectedOrigin` (in `request-origin.ts`) to return `null` early when `getTrustedRequestProtocol()` returns `null`, preventing the function from constructing an `http://host` origin for protocol-less requests. The test added by `5ba4025c` (8 lines) only tests `getTrustedRequestProtocol` in isolation — it verifies the helper returns `null` when `X-Forwarded-Proto` is absent. It does NOT test `hasTrustedSameOrigin` / `getExpectedOrigin` in the scenario where the protocol is missing but a `Host` header IS present.

The specific regression being guarded: before the fix, `request.headers.get('host') = 'gallery.atik.kr'` with no forwarded-proto would construct `http://gallery.atik.kr` and potentially match an Origin of `http://gallery.atik.kr`. After the fix it returns `null` so no origin matches.

**Risk:** A future refactor reintroducing `?? 'http'` in the fallback path would silently downgrade an HTTPS-only deployment's origin guard on non-proxy requests.

**Concrete test to add** (`apps/web/src/__tests__/request-origin.test.ts`):
```typescript
it('hasTrustedSameOrigin returns false when Host is present but no protocol header exists', () => {
    delete process.env.TRUST_PROXY;
    // Attacker sends an http:// origin that happens to match the host.
    // Must not be trusted when we cannot determine the real protocol.
    expect(hasTrustedSameOrigin(
        makeHeaders({ host: 'gallery.atik.kr' }),
        new Headers({ origin: 'http://gallery.atik.kr' }),
    )).toBe(false);
});
```

---

### R12-TEST-04 — `safeUnlink` / `safeCloseDirHandle` ENOENT discrimination untested

**Severity:** MEDIUM  
**Confidence:** HIGH  
**Gap:** `3111cc7e` replaced all `.catch(() => {})` swallowing with named helpers that treat `ENOENT` as expected-race (silent) and all other error codes as debug-logged. These helpers are private functions inside `process-image.ts` and are called from at least 6 call sites (cleanup after atomic rename fallback, deleteImageVariants, orphaned-file cleanup, etc.). No test exercises them.

**Risk:** Two failure modes: (1) ENOENT is mis-identified and logged at debug on every expected race, creating log spam; (2) a non-ENOENT error (EACCES, EMFILE) is silently swallowed, masking sustained filesystem problems. Both regressions are invisible without a test.

**Concrete tests to add** (`apps/web/src/__tests__/process-image-safe-unlink.test.ts`):
```typescript
it('swallows ENOENT without logging', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.mocked(fs.unlink).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await safeUnlink('/tmp/nonexistent.avif'); // must not throw
    expect(consoleSpy).not.toHaveBeenCalled();
});

it('logs at debug for non-ENOENT errors', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.mocked(fs.unlink).mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
    await safeUnlink('/uploads/private.avif');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[safeUnlink]'), expect.anything());
});
```

Note: `safeUnlink` is not currently exported. It must be either exported (with a test-only note) or tested via the higher-level `deleteImageVariants` wrapper.

---

### R12-TEST-05 — `rollbackOgAttempt` behavior untested

**Severity:** MEDIUM  
**Confidence:** HIGH  
**Gap:** `9d88e217` also patched `rollbackOgAttempt` to use `ogRateLimit.set(ip, { count: currentEntry.count - 1, resetAt: currentEntry.resetAt })` instead of mutating the shallow-copied entry object (`currentEntry.count--` which was a no-op due to the `BoundedMap.get()` copy semantics). The only existing tests that reference `rollbackOgAttempt` are source-text fixture tests (`og-photo-fallback.test.ts`, `og-route-source-contracts.test.ts`) that check the function name appears in the right positions in the source file — they do not test whether rollback actually decrements the count.

**Risk:** A caller that pre-increments past the rate limit and then successfully rolls back could be incorrectly blocked on the next request if the rollback is silently broken. This applies to the OG image routes which roll back the increment when the DB lookup fails.

**Concrete test to add** (`apps/web/src/__tests__/og-rate-limit.test.ts`):
```typescript
it('rollbackOgAttempt decrements the in-map count rather than the copy', () => {
    const ip = '203.0.113.20';
    const now = 3_000_000;
    preIncrementOgAttempt(ip, now);
    preIncrementOgAttempt(ip, now); // count = 2
    rollbackOgAttempt(ip);
    expect(ogRateLimit.get(ip)?.count).toBe(1); // not 2
});

it('rollbackOgAttempt deletes the entry when count reaches 1', () => {
    const ip = '203.0.113.21';
    const now = 3_000_000;
    preIncrementOgAttempt(ip, now); // count = 1
    rollbackOgAttempt(ip);
    expect(ogRateLimit.has(ip)).toBe(false);
});
```

---

### R12-TEST-06 — Bootstrap first-scan-empty path has no explicit test

**Severity:** MEDIUM  
**Confidence:** HIGH  
**Gap:** `d6107f89` changed the bootstrap logic to distinguish two empty-batch cases:
- `pending.length === 0 && bootstrapCursorId === null` (first scan) → `bootstrapped = true` immediately
- `pending.length === 0 && bootstrapCursorId !== null` (continuation) → `bootstrapped = false`, retry from null

The ECONNREFUSED retry test (`image-queue-bootstrap.test.ts:187-205`) indirectly exercises the first path (the second `limitMock` returns `[]` after the cursor was reset to null), but this is incidental. There is no test whose name or assertion explicitly documents "first scan returning empty means bootstrapped immediately."

**Risk:** A developer reading the bootstrap code and modifying the empty-batch handling won't see a failing test that describes the expected first-scan behavior — they could accidentally revert to always-retry on empty without breaking any clearly named test.

**Concrete test to add** (`apps/web/src/__tests__/image-queue-bootstrap.test.ts`):
```typescript
it('sets bootstrapped = true immediately when first scan returns zero pending images', async () => {
    vi.useFakeTimers();
    const { bootstrapImageProcessingQueue, getProcessingQueueState, limitMock }
        = await loadQueueModule({ pendingBatches: [[]], resolveIdle: false });

    await bootstrapImageProcessingQueue();

    expect(limitMock).toHaveBeenCalledTimes(1);
    expect(getProcessingQueueState().bootstrapped).toBe(true);
    // No retry timer should be scheduled — queue is truly empty
    expect(getProcessingQueueState().bootstrapRetryTimer).toBeUndefined();
    vi.useRealTimers();
});
```

---

### R12-TEST-07 — `getProcessingQueueState()` shape validation path untested

**Severity:** LOW-MEDIUM  
**Confidence:** MEDIUM  
**Gap:** `b3c55036` added defensive shape validation to `getProcessingQueueState()`: if the global symbol already exists but is missing the `queue`, `enqueued`, or `bootstrapped` fields, the function re-initializes instead of crashing or returning a broken state. No test exercises this path.

**Risk:** Test isolation failure or a future module-mocking change could accidentally install a partial object under the queue symbol. Without a test for the re-initialization path, this defensive code might break in a refactor (e.g., if the validation condition accidentally excludes a valid state).

**Concrete test**: Requires module-level symbol manipulation — inject an object missing `bootstrapped` via the globalThis queue key symbol and verify `getProcessingQueueState()` returns a fully initialized state.

---

### R12-TEST-08 — `preIncrementShareAttempt` has no behavioral test file

**Severity:** LOW-MEDIUM  
**Confidence:** HIGH  
**Gap:** `og-rate-limit.test.ts` tests `preIncrementOgAttempt`, window reset, and prune behavior. No equivalent file exists for `preIncrementShareAttempt`. `rate-limit.test.ts` has basic increment/window-reset tests (lines 249-265) but these are sparse and do not cover:
- Timer-gated prune skip (newly added in `9d88e217`)
- Window boundary exactly at `resetAt`
- Capacity-cap eviction (`SHARE_RATE_LIMIT_MAX_KEYS = 2000`) behavior
- The `rollbackShareAttempt` function (if it exists — the OG path has one but share may not)

**Risk:** Share rate limit regressions are less visible than OG rate limit regressions because `/s/[key]` and `/g/[key]` are lower-traffic paths.

---

## 4. Previously Reported Issues — Status Update

| Issue | Prior Status | Current Status |
|-------|-------------|---------------|
| `image-queue-bootstrap.test.ts` 2 timeouts | FAILING | RESOLVED — tests pass |
| `touch-target-audit.test.ts` new violation | FAILING | RESOLVED — `f1f6202d` fixed the element |
| `request-origin.test.ts` test pollution | FLAKY | STABLE — passes consistently |
| `process-image-color-roundtrip.test.ts` failures | FAILING | Not re-evaluated (environment-dependent Sharp integration test) |
| No test for `safeInsertId()` BigInt overflow | Gap | Still open (carried over) |
| No test for `normalizeIp()` | Gap | Still open (carried over) |
| No test for `prioritizeSecurityFields` | New in cycle 12 | Open — see R12-TEST-02 |
| `/s/[key]` e2e gap | Gap | Still open (carried over) |

---

## 5. Invariants CLAUDE.md Claims Are "Locked by Tests" — Verification

All claimed test locks are confirmed to still exist:

| Invariant | Locked by | Status |
|-----------|-----------|--------|
| Blur data URL contract | `process-image-blur-wiring.test.ts`, `images-action-blur-wiring.test.ts` | PRESENT |
| View retention purge | `view-retention.test.ts` | PRESENT |
| OG sanitize shared helper | `sanitize-for-og-global.test.ts`, `og-sanitize.test.ts` | PRESENT |
| `backfill-color-pipeline` column set | `backfill-color-pipeline.test.ts` | PRESENT |
| `admin-backfill-runner` no-version-bump on detection failure | `admin-backfill-runner-detection-failure.test.ts` | PRESENT |
| SW template contract | `sw-template-contract.test.ts` | PRESENT |
| `tagNamesAgg` SQL contract | `data-tag-names-sql.test.ts` | PRESENT |
| `_PrivacySensitiveKeys` public fields guard | `privacy-fields.test.ts` | PRESENT |
| Touch target 44px floor | `touch-target-audit.test.ts` | PRESENT |
| API admin auth wrapping | `check-api-auth.test.ts` | PRESENT |
| Action origin guard | `check-action-origin.test.ts` | PRESENT |
| Public route rate limit | `check-public-route-rate-limit.test.ts` | PRESENT |

---

## 6. Findings Summary

| ID | Gap | Severity | Confidence |
|----|-----|----------|------------|
| R12-TEST-01 | `pruneOgRateLimit`/`pruneShareRateLimit` timer-gate behavior not tested | HIGH | HIGH |
| R12-TEST-02 | `prioritizeSecurityFields` in audit.ts has zero tests | HIGH | HIGH |
| R12-TEST-03 | `getExpectedOrigin` null-protocol + present-host edge case untested | MEDIUM-HIGH | HIGH |
| R12-TEST-04 | `safeUnlink`/`safeCloseDirHandle` ENOENT discrimination untested | MEDIUM | HIGH |
| R12-TEST-05 | `rollbackOgAttempt` behavioral tests absent | MEDIUM | HIGH |
| R12-TEST-06 | Bootstrap first-scan-empty path has no named test | MEDIUM | HIGH |
| R12-TEST-07 | `getProcessingQueueState()` shape validation path untested | LOW-MEDIUM | MEDIUM |
| R12-TEST-08 | `preIncrementShareAttempt` has no behavioral test file | LOW-MEDIUM | HIGH |

---

## 7. Verification

Test run at HEAD `2a9976a1`:

```
Test Files  225 passed | 2 skipped (227)
Duration    24.75s
```

The 2 skipped files are the CLIP integration tests (gated on model weights — intentional and correct).

No failing tests. No timeout flakes observed in this run.

---

*Review completed by Test Engineer agent at HEAD `2a9976a1` (2026-06-27). All findings based on direct examination of source, test files, and `git show` diffs for commits `bcd67b12..2a9976a1`.*
