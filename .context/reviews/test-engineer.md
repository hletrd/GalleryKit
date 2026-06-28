# Test Engineer Review — Cycle 22 (2026-06-29)

**HEAD at investigation start:** bcd67b12 (post cycle-21)
**Test suite baseline:** 2195 passed / 4 skipped (2199 total, 241 files)
**Test suite after cycle-22 additions:** 2198 passed / 4 skipped (2202 total, 243 files)
**Test Health:** HEALTHY

---

## Cycle-21 test additions — vacuousness check

All five tests added in cycle 21 (T1b–T5) are **non-vacuous**. Each would fail if the specific fix it guards were reverted.

| Tag | Test file | Discriminator |
|-----|-----------|---------------|
| T1b | `focus-visible-links-scan.test.ts` | Would catch any of the 20 `hover:`-styled elements losing its `focus-visible:ring-2` if that element still carries `hover:` styling |
| T2 | `topics-actions.test.ts:534` | `order='1e3'` asserts `order: 1000`; `parseInt('1e3',10) === 1` fails the `toHaveBeenCalledWith` assertion |
| T3 | `data-view-count-flush.test.ts` | Source-contract regex requires `viewCountRetryCount.delete(oldestKey)` inside the eviction while-loop; removing the call from `data.ts:172` fails |
| T4 | `clip-semantic-limits-env.test.ts:43` | `SEMANTIC_SCAN_LIMIT=4e3` asserts 4000; `parseInt('4e3',10) === 4` fails |
| T5 | `process-image-max-input-pixels-env.test.ts:33` | `IMAGE_MAX_INPUT_PIXELS_TOPIC=64e6` asserts 64_000_000; `parseInt('64e6',10) === 64` fails |

---

## Tests written in cycle 22

### FINDING-1 (MEDIUM → FIXED): `updateTopic` scientific-notation order — no regression test

**File:** `apps/web/src/__tests__/topics-actions.test.ts` (line 601)
**Test name:** `'parses a scientific-notation order with Number() in updateTopic in-place path (R21C21 T2 / DBG21-01)'`

The T2 test (line 534) covered `createTopic` with `order='1e3'`. The inline comment said "Same fix lands in updateTopic" but no test called `updateTopic` with a scientific-notation order. If `Number(orderStr)` at `topics.ts:217` were reverted to `parseInt`, `order: 1` would be stored silently on every in-place topic update using an exponential order string; no existing test would catch it.

The new test exercises the **in-place update path** (slug unchanged → no rename transaction, direct `db.update(topics).set({ label, order })`). It replaces `updateMock` with a spy that captures the `.set()` payload and asserts `order: 1000`. Reverting `topics.ts:217` to `parseInt` makes the assertion fail.

### FINDING-2 (LOW → FIXED): `similar/[id]/route.ts` `.limit(SEMANTIC_SCAN_LIMIT)` not source-pinned

**File:** `apps/web/src/__tests__/semantic-scan-limit-source.test.ts`
**New describe block:** `'similar/[id] route SEMANTIC_SCAN_LIMIT source contract (cycle-22 TE gap)'` (2 tests)

`api/search/similar/[id]/route.ts:151` calls `.limit(SEMANTIC_SCAN_LIMIT)` to cap the brute-force embedding scan, but `semantic-scan-limit-source.test.ts` only pinned `api/search/semantic/route.ts`. The behavioral tests in `similar-route.test.ts` mock the DB and never assert the limit value. Removing `.limit(SEMANTIC_SCAN_LIMIT)` from the similar route would allow an unbounded vector scan on every image-similarity request; no prior test caught that.

Two source-contract assertions were added: import pin (import must name `SEMANTIC_SCAN_LIMIT` from `@/lib/clip-embeddings`) and call pin (`.limit(SEMANTIC_SCAN_LIMIT)` must appear in the source).

---

## Carried gaps (unchanged from cycle 21)

### TEST21-01 (MEDIUM, CARRIED): `IMAGE_MAX_INPUT_PIXELS` (non-TOPIC) not exported

**Location:** `apps/web/src/lib/process-image.ts:334`

```typescript
const envMaxInputPixels = Number(process.env.IMAGE_MAX_INPUT_PIXELS ?? '');
const maxInputPixels = Number.isFinite(envMaxInputPixels) && envMaxInputPixels > 0
    ? envMaxInputPixels
    : 256 * 1024 * 1024;
```

T5 in cycle 21 tests `MAX_INPUT_PIXELS_TOPIC` (an exported IIFE). The non-TOPIC `maxInputPixels` at line 334 is a module-local `const`. A `parseInt` regression here would silently cap the decompression-bomb guard at 256 pixels, rejecting every upload.

**Fix when ready:** export as `MAX_INPUT_PIXELS` (same IIFE pattern as `MAX_INPUT_PIXELS_TOPIC`) and add an env-parse test in `process-image-max-input-pixels-env.test.ts` using `vi.resetModules()` + dynamic import.

### TEST21-02 (LOW, CARRIED): `IMAGE_CLEANUP_CONCURRENCY` env parse not tested

Not exported; `|| 5` fallback limits blast radius. Deferred until exported.

### FINDING-3 (LOW, CARRIED): `lr-upload-hdr-gate.test.ts` source-regex only

No behavioral mock for the HDR rejection path in the LR upload route. Unchanged since cycle 21.

### FINDING-4 (LOW, CARRIED): `trackerSettled` double-settle source-regex only

Source-contract only. No mock-based behavioral test for the double-settle guard. Unchanged since cycle 21.

---

## Verification

```
Test Files  241 passed | 2 skipped (243)
     Tests  2198 passed | 4 skipped (2202)
  Duration  17.83s
```

3 new tests added (+1 `updateTopic` order, +2 similar-route source-contract), 0 regressions.
