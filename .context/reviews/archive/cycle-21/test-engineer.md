# Test Engineer Review — Cycle 21 (2026-06-29)

**HEAD at investigation start:** 993ed471
**Test suite state:** 2168 passed / 4 skipped (2172 total) across 240 files — up from cycle-20 baseline of 2155/4/236 (+13 tests, +4 files)
**Test Health:** HEALTHY
**New findings this cycle:** 2 actionable (1 MEDIUM, 1 LOW) + carry-forwards below

---

## Cycle-20 New Tests — Verification

All four cycle-20 test additions were verified as correctly exercising their fixes.

### T5: OG deadline fake-timers test — VERIFIED CORRECT

`apps/web/src/__tests__/og-photo-fallback.test.ts`:

```
'R20C20 (FINDING-1): stops starting attempts once the total budget is exhausted'
```

Uses `vi.useFakeTimers()`, captures `start = Date.now()`, then inside the mock callback calls
`vi.setSystemTime(start + OG_PHOTO_TOTAL_BUDGET_MS + 1)` before returning a 404. This correctly
advances `Date.now()` past the budget during the first await, so the loop's
`if (Date.now() >= deadline) break;` fires before the second iteration. Asserts
`calls.toHaveLength(1)` — the discriminating assertion: without the deadline guard, all three sizes
would be tried (3 calls). The test would fail if the condition were inverted or deleted. FINDING-1
from cycle-20 is closed.

### T1: Scientific-notation env parse tests — PARTIALLY COVERED

Three new tests added by T1 using `vi.resetModules()` + dynamic import:

- `audit-retention.test.ts` — `AUDIT_LOG_RETENTION_DAYS='1e3'` → 1000-day cutoff.
  Tests exported `purgeOldAuditLog`, captures the `lt()` call arg. VERIFIED CORRECT.
- `rate-limit.test.ts` — `getTrustedProxyHopCount('1e1')` → 10; `'2.5'` → 1 (non-integer rejected).
  Tests exported function directly. VERIFIED CORRECT.
- `upload-limits-env.test.ts` — `UPLOAD_MAX_TOTAL_BYTES='2e9'` → 2_000_000_000.
  Uses `vi.resetModules()` + dynamic import of `@/lib/upload-limits`. VERIFIED CORRECT.

The T1 commit fixed all 6 `parseInt` sites in the codebase, but tests were added for only 3.
The remaining 3 sites in `process-image.ts` and `actions/images.ts` have no regression tests.
See TEST21-01 and TEST21-02 below.

### T2: GPS walkAborted items-found path — VERIFIED CORRECT

`apps/web/src/__tests__/gps-exif-strip-isobmff.test.ts`:

```
'R20C20 (CQ20-06): returns null when the walk aborts AFTER finding an Exif item'
```

Builds a HEIF container with a valid Exif `infe` item followed by a malformed oversized box
(triggers `walkAborted`) and expects `null`. The discriminator is confirmed: the identical container
WITHOUT the malformed box returns `{stripped:false}` rather than `null`, verifying the test would
catch a regression where walkAborted is ignored on the items-found path. VERIFIED CORRECT.

### T3: Focus-visible ring source-contract tests — VERIFIED ADEQUATE

`apps/web/src/__tests__/focus-visible-rings-cycle20.test.ts` covers D20-01..04 via
`readFileSync` + assertion (matching the cycle-19 pattern). The D20-02 regex
`/focus-visible:ring-white(?!\s+focus-visible:ring-offset)/` correctly rejects a bare
`ring-white` without the following `ring-offset`. D20-03/D20-04 use `toBeGreaterThanOrEqual(2)` to
confirm both rendered instances are protected without over-constraining exact counts. VERIFIED
ADEQUATE.

### T6: BoundedMap `.data` live-ref doc warning — NO BEHAVIORAL TEST (intentional)

`bounded-map.ts:61` received a JSDoc comment warning callers that `.data` returns a live Map
reference and callers must not mutate values through it. No behavioral test was added — this
change is documentation-only. The existing `bounded-map.test.ts` already exercises `get()` and
`entries()` copy-on-read semantics; the warning has no runtime assertion surface. Acceptable.

---

## FINDING TEST21-01 (MEDIUM): `IMAGE_MAX_INPUT_PIXELS` env parse fixed by T1 but has no regression test

**Module:** `apps/web/src/lib/process-image.ts`, lines 334 and 344
**Test file:** none for these env parse paths

The T1 commit converted two sites:

```typescript
// Line 334 — NOT exported
const envMaxInputPixels = Number(process.env.IMAGE_MAX_INPUT_PIXELS ?? '');
// ...used as Sharp limitInputPixels (decompression bomb guard)

// Line 344 — EXPORTED
export const MAX_INPUT_PIXELS_TOPIC = (() => {
    const envTopicPixels = Number(process.env.IMAGE_MAX_INPUT_PIXELS_TOPIC ?? '');
    // ...
})();
```

No test was added for either site. The three other T1 tests use `vi.resetModules()` + dynamic
import — the correct pattern for module-init env parses, and directly applicable here since
`MAX_INPUT_PIXELS_TOPIC` is exported.

**Concrete risk:** `IMAGE_MAX_INPUT_PIXELS='256e6'` (256 megapixels, a common large-format camera
export notation) would regress to `parseInt('256e6', 10) === 256`, setting the decompression-bomb
limit to 256 PIXELS rather than 256 MEGAPIXELS. Every upload — including a 640×480 thumbnail —
would be rejected with an oversize pixel-count error. All photo ingestion fails silently (the image
stays unprocessed with no UI error).

This is the MEDIUM instance from the cycle-20 aggregate ("all uploads fail") that the aggregate
explicitly called "not deferrable," yet the T1 sweep landed the code fix without a test.

**Proposed tests** (new file `apps/web/src/__tests__/process-image-env.test.ts`):

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('process-image env-parse: Number() not parseInt() (TEST21-01)', () => {
    afterEach(async () => {
        vi.resetModules();
        delete process.env.IMAGE_MAX_INPUT_PIXELS_TOPIC;
    });

    it('MAX_INPUT_PIXELS_TOPIC parses scientific-notation in full, not truncated', async () => {
        // parseInt('64e6', 10) === 64 (64 pixels); Number('64e6') === 64_000_000 (64 MP)
        process.env.IMAGE_MAX_INPUT_PIXELS_TOPIC = '64e6';
        vi.resetModules();
        const { MAX_INPUT_PIXELS_TOPIC } = await import('@/lib/process-image');
        expect(MAX_INPUT_PIXELS_TOPIC).toBe(64_000_000);
    });

    it('MAX_INPUT_PIXELS_TOPIC falls back to the default on empty env', async () => {
        delete process.env.IMAGE_MAX_INPUT_PIXELS_TOPIC;
        vi.resetModules();
        const { MAX_INPUT_PIXELS_TOPIC } = await import('@/lib/process-image');
        // Default is 64 MP (67_108_864) per CLAUDE.md IMAGE_MAX_INPUT_PIXELS_TOPIC
        expect(MAX_INPUT_PIXELS_TOPIC).toBe(67_108_864);
    });
});
```

For the private `IMAGE_MAX_INPUT_PIXELS` (line 334): to add a direct regression test, export the
resolved constant as `MAX_INPUT_PIXELS` (matching the `MAX_INPUT_PIXELS_TOPIC` pattern) and add an
analogous `vi.resetModules()` test with `'256e6'` → 256_000_000. Without an export, the only
testable path is via a full `processImageFormats` call with a mock Sharp instance. The export
approach is lower-risk and matches existing conventions.

**Confidence:** HIGH.

---

## FINDING TEST21-02 (LOW): `IMAGE_CLEANUP_CONCURRENCY` env parse has no regression test

**Module:** `apps/web/src/app/actions/images.ts`, line 797
**Test file:** none

```typescript
const cleanupConcurrency = Math.max(1, Number(process.env.IMAGE_CLEANUP_CONCURRENCY ?? '') || 5);
```

Uses `Number()` (correct post-T1 form) with `|| 5` fallback. Not exported, not tested.

**Concrete risk:** Low. The `|| 5` fallback handles NaN from an empty, invalid, or unparseable env
value. A regression to `parseInt('1e1', 10) === 1` would set cleanup concurrency to 1 rather than
10 — the `Math.max(1, ...)` floor still applies, orphan-file cleanup merely slows, no data loss.

**Confidence:** HIGH (gap confirmed); risk is LOW given the safety net.

---

## Carry-forward Findings (status unchanged from prior cycles)

### FINDING-2 from cycle-20 (deferred) — `tryFetchPhotoBuffer` NaN Content-Length path

No change from cycle-20. `tryFetchPhotoBuffer` is exported; a direct test for the
`NaN Content-Length` fallthrough path is straightforward to add. Not re-raised as a new finding.

### FINDING-3 from cycle-19/20 (deferred) — `lr-upload-hdr-gate.test.ts` source-regex only

No change. Behavioral unit test impractical for the heavy multipart/token-auth LR route in unit
scope; source-contract is the accepted guardrail. Not re-raised.

### FINDING-4 from cycle-19/20 (deferred) — `trackerSettled` source-regex only

No change. The `let trackerSettled = false` / `if (trackerSettled) return;` guard is verified only
by regex on source text. Not re-raised.

### Debugger F3 from cycle-20 (deferred-evaluate) — audit.ts unbounded DELETE

`apps/web/src/lib/audit.ts:122`: `await db.delete(auditLog).where(lt(auditLog.created_at, cutoff))`
still lacks a LIMIT / chunk pattern (unlike `view-retention.ts` which has chunked batching). No
test was added. Unchanged from cycle-20 evaluate status. Not re-raised as a new finding.

---

## Non-Findings (swept this cycle)

### Flaky test patterns — NONE FOUND

Examined every `Date.now()` usage across the test suite outside of fixture construction.
Both `audit-retention.test.ts` and `view-retention.test.ts` use `vi.useFakeTimers()` +
`vi.setSystemTime(fixedDate)` in `beforeEach`. All `Date.now()` calls — both in code under test
and in `.toBe()` assertions — return the same frozen timestamp under fake timers. NOT flaky.
`lr-tokens-action.test.ts` and `admin-tokens.test.ts` use `new Date(Date.now() + ...)` only for
test fixture construction, not in equality assertions. `color-detection.test.ts` and
`process-topic-image.test.ts` use `Date.now()` only for unique temp-file names (no flaky impact).

### Semantic search resolver healing — well tested

`gallery-config.test.ts` has two behavioral tests confirming:
1. `semantic_search_mode = 'production'` heals to `'disabled'` when
   `SEMANTIC_SEARCH_ALLOW_PRODUCTION` is absent.
2. `'production'` passes through only when `SEMANTIC_SEARCH_ALLOW_PRODUCTION = 'true'`.

Both use real env mutation with cleanup. VERIFIED CORRECT.

### Privacy fields symmetric guard — VERIFIED CLOSED (N1 from cycle-20)

`apps/web/src/__tests__/privacy-fields.test.ts` line 83 implements the N1 cycle-20 EVALUATE
recommendation. It computes `adminSelectFieldKeys.filter(k => !publicKeySet.has(k)).sort()` and
asserts it equals `SENSITIVE_KEYS.sort()` — the additive bidirectional check. This is NOT the
naive `Exclude<keyof admin, keyof public>` replacement (which would make the `_SensitiveKeysInPublic`
compile guard tautological); it is a runtime bidirectional assertion that catches both directions
of drift. N1 is closed.

### `avif_10bit` public-safe status — tested

`privacy-fields.test.ts` `SENSITIVE_KEYS` array does not include `avif_10bit`. The symmetric guard
therefore catches any future attempt to mark it admin-only. The field is additionally asserted in
`color-details-section-delivered.test.ts` and `backfill-detection-failure-contract.test.ts`.
Coverage is adequate.

### BoundedMap — no new gap

`bounded-map.test.ts` covers all copy-on-read invariants. No consumer currently mutates through
`.data`. No test gap.

### MAJOR-2 focus-visible scanner — remains unbuilt (structural defer)

The cycle-20 exit criterion was met (≥3 fresh siblings). Cycle-20 added per-control source-contract
pins (T3 above) rather than a general scanner. The scanner remains unbuilt, consistent with the
cycle-20 deferred decision. No new test gap introduced this cycle.

### 4 skipped tests — expected environment gates

- `clip-offline-load.test.ts` (2 tests): skip condition `CLIP_OFFLINE_LOAD=1 && weights seeded`.
- `clip-semantic-integration.test.ts` (2 tests): skip condition `CLIP_INTEGRATION=1`.
Both are conditional environment gates, not abandoned tests.

---

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| TEST21-01 | `IMAGE_MAX_INPUT_PIXELS[_TOPIC]` env parse — T1 fixed code, no regression test; `MAX_INPUT_PIXELS_TOPIC` (exported) testable via `vi.resetModules()`; risk: scientific-notation value truncated → all uploads rejected as decompression bombs | MEDIUM | NEW |
| TEST21-02 | `IMAGE_CLEANUP_CONCURRENCY` env parse — not exported, no test; `\|\| 5` fallback limits practical risk | LOW | NEW |
| FINDING-2 | `tryFetchPhotoBuffer` NaN Content-Length path untested | LOW | CARRY-FORWARD (cycle-20 deferred) |
| FINDING-3 | `lr-upload-hdr-gate.test.ts` 100% source-regex | LOW | CARRY-FORWARD (cycle-19 deferred) |
| FINDING-4 | `trackerSettled` double-settle source-regex only | LOW | CARRY-FORWARD (cycle-19 deferred) |

**Recommended priority:** TEST21-01 only. Export `MAX_INPUT_PIXELS` alongside `MAX_INPUT_PIXELS_TOPIC`
and add `vi.resetModules()` tests for both. The `MAX_INPUT_PIXELS_TOPIC` test is a straight port of
the upload-limits-env pattern — low effort, high signal. TEST21-02 is acceptable without a test
given the `|| 5` fallback. All four cycle-20 new tests verified correct; no regressions found.
