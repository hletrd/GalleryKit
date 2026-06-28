# Test Engineer Review — Cycle 20 (2026-06-27)

**HEAD at investigation start:** 9af705f4
**Test suite state:** 2155 passed / 4 skipped (2159 total) — up from cycle-19 baseline of 2134/4
**Test Health:** HEALTHY
**New findings this cycle:** 2 new actionable (1 MEDIUM, 1 LOW) + carry-forwards below

---

## Cycle-19 FINDING-1 — CLOSED

`rollbackOgAttempt` now has 5 behavioral tests in `apps/web/src/__tests__/og-rate-limit.test.ts`:
decrement when count > 1, delete on count-1, multi-step rollback to deletion, no-op on absent IP,
and resetAt preservation. All tests call the real function against the in-memory `ogRateLimit`
map via the exported `resetOgRateLimitForTests()` teardown. Closed.

---

## FINDING-1 (NEW / MEDIUM): `OG_PHOTO_TOTAL_BUDGET_MS` deadline branch is logically dead in tests

**Module:** `apps/web/src/lib/og-photo-fetch.ts` lines 101–106
**Test file:** `apps/web/src/__tests__/og-photo-fallback.test.ts` —
`describe('pickFirstAvailablePhotoBuffer runtime contract', ...)`

**What the code does (R19C19 CQ19-01):**

```typescript
const deadline = Date.now() + OG_PHOTO_TOTAL_BUDGET_MS; // 10 000 ms
for (const size of sortedSizes) {
    if (Date.now() >= deadline) break;   // budget guard
    const buffer = await tryFetchPhotoBuffer(origin, baseFilename, size);
    if (buffer) return { buffer, size };
}
```

**Why the tests do not exercise it:**

All four behavioral tests in the runtime-contract describe block mock `globalThis.fetch` with
synchronous returns. `Date.now()` never advances during a synchronous mock run, so the
`if (Date.now() >= deadline) break;` branch is never reached. The deadline line is dead code
under the current test suite.

**Concrete mutations that pass all tests:**

1. Invert the condition to `if (Date.now() < deadline) break;` — the loop skips all sizes after
   the first on every call, not just after budget exhaustion. All 4 tests still pass because no
   test asserts on iteration count when the first-fetch is a 404.
2. Delete the deadline check entirely — all 4 tests still pass. The protection the CQ19-01 fix
   was added for is silently removed.

**Proposed test** (add to `og-photo-fallback.test.ts`):

```typescript
import { OG_PHOTO_TOTAL_BUDGET_MS, pickFirstAvailablePhotoBuffer } from '@/lib/og-photo-fetch';
import { afterEach, it, expect, vi } from 'vitest';

it('stops trying additional sizes once the total budget is exhausted after the first attempt', async () => {
    const calls: string[] = [];
    vi.useFakeTimers();
    const start = Date.now();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        // Simulate the first attempt consuming the entire budget.
        vi.setSystemTime(start + OG_PHOTO_TOTAL_BUDGET_MS + 1);
        calls.push(String(input));
        return new Response(null, { status: 404 });
    }) as typeof fetch;

    const result = await pickFirstAvailablePhotoBuffer('http://localhost', 'abc.jpg', [640, 1536, 2048]);
    // Deadline exceeded after the first attempt → loop breaks early.
    expect(calls).toHaveLength(1);
    expect(result).toBeNull();
    vi.useRealTimers();
});
```

Note: `OG_PHOTO_TOTAL_BUDGET_MS` is currently unexported (file-scope `const`). It must be exported
for the test to reference it directly. Alternatively, the test can use the magic value 10001 with a
comment, but exporting the constant is cleaner and matches how `OG_PHOTO_MAX_BYTES` is handled.

**Risk:** MEDIUM. The deadline guard was the specific fix for social-crawler deadline breaches
(LinkedIn ~3 s, Twitter/X ~5-10 s) on broken `IMAGE_BASE_URL` paths. If silently removed in a
refactor, N×10 s hang is reintroduced before the OG fallback card is served. The test suite provides
no signal. This is a code path added specifically in R19C19; verifying the cycle-19 new tests
actually exercise behavior was explicitly in scope.

**Confidence:** HIGH.

---

## FINDING-2 (NEW / LOW): `tryFetchPhotoBuffer` has no direct unit tests; NaN Content-Length path uncovered

**Module:** `apps/web/src/lib/og-photo-fetch.ts` — exported `tryFetchPhotoBuffer`
**Test file:** no direct tests; only exercised indirectly through `pickFirstAvailablePhotoBuffer`

The four behavioral tests in `og-photo-fallback.test.ts` call `pickFirstAvailablePhotoBuffer`,
which delegates to `tryFetchPhotoBuffer`. The Content-Length guard in `tryFetchPhotoBuffer` is:

```typescript
const len = Number(contentLength);
if (Number.isFinite(len) && len > OG_PHOTO_MAX_BYTES) return null;
```

The `Number.isFinite(len)` branch specifically handles non-numeric headers (e.g., a CDN returning
`Content-Length: 0` for a missing file or `Content-Length: 'chunked'`). When `len` is `NaN`,
`Number.isFinite(NaN)` is `false`, so the pre-check is skipped and the body is buffered. The
post-buffer check `photoBuffer.length > OG_PHOTO_MAX_BYTES` is the correct safety net and does
catch oversize bodies. However:

- If the `Number.isFinite` guard is removed in a refactor, `NaN > OG_PHOTO_MAX_BYTES` evaluates to
  `false` (NaN comparisons), effectively bypassing the pre-check — and for large streaming responses
  with no Content-Length, the post-buffer check might not run until after the full body is consumed.
- No test covers the `NaN` input path to confirm the fallthrough semantics are intentional.

**Proposed test:**

```typescript
it('tryFetchPhotoBuffer: non-numeric Content-Length bypasses pre-check and falls through to buffering', async () => {
    globalThis.fetch = (async () => new Response(new Uint8Array(4), {
        status: 200,
        headers: { 'Content-Length': 'bogus' },
    })) as typeof fetch;
    const result = await tryFetchPhotoBuffer('http://localhost', 'abc.jpg', 640);
    // NaN → pre-check skipped → body buffered → 4 bytes < 1 MB cap → returns buffer
    expect(result).not.toBeNull();
    expect(result!.length).toBe(4);
});
```

**Risk:** LOW. The post-buffer check is a correct backstop; this is a defense-in-depth gap only.
`tryFetchPhotoBuffer` is exported and can be tested directly.

**Confidence:** HIGH.

---

## Carry-forward Findings (status unchanged from cycle 19)

### FINDING-2 from cycle 19 (deferred) — `lr-upload-hdr-gate.test.ts` is 100% source-regex

Confirmed still at the same documented state as `cycle-19-deferred.md FINDING-2`. The file reads
the LR route source via `readFileSync` and asserts on `toContain`/`toMatch` throughout. The LR
route is a heavy multipart/token-authenticated handler that is impractical to exercise end-to-end
in unit scope; source-contract tests are the accepted guardrail here. **Not re-raised as a new
finding — no regression from the documented cycle-19 status.**

### FINDING-3 from cycle 19 (deferred) — `trackerSettled` double-settle guard source-regex only

The `let trackerSettled = false` / `if (trackerSettled) return;` idempotency guard is verified only
by regex on source text. No test dispatches a request and asserts `settleUploadTrackerClaim` call
count. Unchanged from cycle-19-deferred.md FINDING-3. Not re-raised.

### FINDING-4 from cycle 19 (deferred) — `POOL_CONNECTION_LIMIT ?? 10` NaN fallback

Still unreachable in tests. Unchanged. Not re-raised.

### Cycle-18 carry-overs — M-1, M-2, L-1, L-2

Still open and unchanged. See cycle-19 review for details.

---

## Confirmed Non-Findings (cycle 20 verification)

### 4 skipped tests — expected, not a gap

- `apps/web/src/__tests__/clip-offline-load.test.ts` — 2 tests; skip condition
  `CLIP_OFFLINE_LOAD=1 && CLIP_MODELS_ROOT exists && weights seeded`. Absent in CI by design.
  Uses `describe.skip`, not `it.skip` — this is a conditional environment gate, not abandoned tests.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts` — 2 tests; skip condition
  `CLIP_INTEGRATION=1`. Anti-vacuity smoke test for the real jina-clip-v2 encoder. Cannot run
  without model weights.

### rollbackOgAttempt (cycle-19 FINDING-1) — CLOSED

See opening section. 5 behavioral tests in `og-rate-limit.test.ts`. All confirmed behavioral
(call real function, not source-regex). Verified closed.

### GPS EXIF strip — well covered

`strip-gps-from-original.test.ts` exercises `stripGpsFromOriginal` with real Sharp fixtures for
JPEG (lossless + identity-on-no-GPS), AVIF (ISOBMFF), WebP (RIFF), TIFF (no-GPS identity), PNG
(re-encode), and JPEG fallback on malformed structure. Pure-scrubber unit tests cover all format
paths including ExtendedXMP multi-chunk, motion-photo trailer, and the R19C19 F2 `walkAborted` fix
(verified separately in `gps-exif-strip-isobmff.test.ts`). No gap.

### BoundedMap — well covered

`bounded-map.test.ts` covers expiry pruning, prune return value, hard-cap eviction order, factory
semantics for `createResetAtBoundedMap` and `createWindowBoundedMap`, overwrite semantics, and the
R19C19 CQ19-02 copy-on-read invariant for `entries()`, `[Symbol.iterator]`, and `get()`. All
behavioral. No gap.

### view-retention — well covered

`view-retention.test.ts` has 7 behavioral tests covering default cutoff, positive override,
scientific notation (`'1e3'` → 1000, not 1 — the specific `Number()` vs `parseInt()` fix),
empty-string fallback, negative fallback, bounded DELETE count, and chunked batching. No gap.

### search-enrichment-fields — compile-time only, no test gap

`apps/web/src/lib/search-enrichment-fields.ts` is purely compile-time. The
`_searchEnrichmentPrivacyGuard` uses a TypeScript type-level `Extract<>` erased at runtime. `tsc`
(via `npm run typecheck --workspace=apps/web`) is the correct gate. No runtime tests are needed or
possible for a type-erased guard.

### og-photo-fallback.test.ts behavioral coverage — verified

The `describe('pickFirstAvailablePhotoBuffer runtime contract', ...)` block in
`og-photo-fallback.test.ts` calls the actual exported function with mocked `globalThis.fetch`.
Tests are behavioral, not source-regex. Ascending sort is verified (size `[1536, 640]` → first
call hits `_640.jpg`). Content-Length oversize pre-check, all-404 → null, network error → null are
all covered. The deadline gap (FINDING-1 above) is the only behavioral hole.

---

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | `OG_PHOTO_TOTAL_BUDGET_MS` deadline guard logically dead in tests — invertible without test failure | MEDIUM | NEW — test + export constant |
| 2 | `tryFetchPhotoBuffer` not directly tested; NaN Content-Length path uncovered | LOW | NEW — optional test |
| 3 | `lr-upload-hdr-gate.test.ts` 100% source-regex | LOW | CARRY-FORWARD (cycle-19-deferred FINDING-2) |

**Recommended priority:** FINDING-1 only requires one test with `vi.useFakeTimers()` plus exporting
`OG_PHOTO_TOTAL_BUDGET_MS`. FINDING-2 is optional cleanup. No regressions from prior cycles found.
