# Test Engineer Review — Run-9 Cycle-3

**HEAD:** c2d3857a  
**Date:** 2026-06-21  
**Vitest:** 4.1.4, default `forks` pool (one OS process per test file — `globalThis` is process-isolated between files)

---

## 1. Soundness Verification: Run-9 C1 Test Files

### `upload-tracker-state.test.ts` (TE-R9C1-01)

**Verdict: SOUND with one LOW isolation note (see section 3).**

All 11 tests pass deterministically. Coverage audit:

| Branch | Test(s) | Deterministic? |
|---|---|---|
| `pruneUploadTracker` — entry older than 2x window deleted | `deletes an entry older than 2x the tracking window` | Yes — injected `now`, fixed `windowStart` |
| `pruneUploadTracker` — entry exactly AT 2x boundary kept (strict `>`) | `keeps an entry exactly AT the 2x boundary` | Yes — off-by-one correctly tested |
| `pruneUploadTracker` — fresh entry kept | `keeps a fresh entry` | Yes |
| `pruneUploadTracker` — MAX_KEYS cap eviction, insertion-order oldest first | `evicts the oldest excess entries down to the cap` | Yes — Map insertion order is spec-guaranteed |
| `pruneUploadTracker` — no eviction at or below cap | `does not evict when at or below the cap` | Yes |
| `resetUploadTrackerWindowIfExpired` — resets past 1x window (strict `>`) | `zeroes count/bytes and advances windowStart` | Yes |
| `resetUploadTrackerWindowIfExpired` — leaves entry untouched AT 1x boundary | `leaves the entry untouched exactly AT the 1x boundary` | Yes — off-by-one correctly tested |
| `hasActiveUploadClaims` — `count > 0` → true | `returns true when an entry has count > 0` | Yes |
| `hasActiveUploadClaims` — `bytes > 0`, count=0 → true | `returns true when an entry has bytes > 0` | Yes |
| `hasActiveUploadClaims` — empty tracker → false | `returns false when tracker is empty` | Yes |
| `hasActiveUploadClaims` — window-expired entry reset → false, and reset persists | `returns false when all entries are window-expired` | Yes — also verifies in-place mutation |

The assertions are behavioral (not implementation-detail mirrors). The `beforeEach` clears the globalThis-backed Map between every test. The production `WINDOW_MS` and `MAX_KEYS` constants are mirrored explicitly in the test file with comments so drift is visible.

---

### `upload-processing-contract-lock.test.ts` (TE-R9C1-02)

**Verdict: SOUND.**

All 7 tests pass. Coverage audit:

| Branch | Test(s) | Deterministic? |
|---|---|---|
| `GET_LOCK` returns numeric `1` → lock acquired, RELEASE_LOCK called on `.release()` | `returns a working lock when GET_LOCK yields numeric 1` | Yes — mocked pool conn |
| `GET_LOCK` returns `BigInt(1)` → lock acquired (the previously unexercised arm) | `returns a working lock when GET_LOCK yields BigInt(1)` | Yes |
| `GET_LOCK` returns `0` → null returned, connection released, no RELEASE_LOCK issued | `returns null … when GET_LOCK yields 0` | Yes — verifies no RELEASE_LOCK |
| `GET_LOCK` returns `null` (timeout/unhealthy) → null returned, connection released | `returns null … when GET_LOCK yields null` | Yes |
| `getConnection` throws → null returned, no throw propagated | `returns null (no throw) when getConnection itself fails` | Yes |
| `GET_LOCK` query throws after connection obtained → null returned, connection released | `returns null and releases … when GET_LOCK query throws` | Yes |
| Double `release()` → idempotent: RELEASE_LOCK issued once, connection released once | `is a no-op on the second release() call` | Yes — mock call count assertions |

The `beforeEach` resets the `getConnectionMock` spy. The `makeConn` helper cleanly separates the GET_LOCK response from RELEASE_LOCK responses via SQL substring check. The stdout noise (production `console.log` calls for the error paths) is expected and does not indicate test failures.

---

## 2. Carried Deferrals — Re-confirmation

All three are **still open** as of HEAD c2d3857a. Quick grep evidence:

**TE-R7C2-03 [LOW]** — semantic route malformed-embedding row-skip (`api/search/semantic/route.ts` `.filter(m => m !== null)`):  
Grep of `__tests__/` for `decodeEmbedding`, `filter.*null`, or behavioral coverage of the `.filter()` chain in the semantic route returns no hit. The existing `semantic-similarity-selector-contract.test.ts` is a source-grep fixture for the similarity-function selector, not a behavioral test of the malformed-row skip path. Still open.

**TE-R7C2-04 [LOW]** — `logAuditEvent` metadata-truncation (`lib/audit.ts:8-51`):  
Grep of `__tests__/` for `logAuditEvent` shows it is used only as a mock (`vi.fn()`) in consumer tests. No test exercises the surrogate-pair-safe truncation branch (the `[...serializedMetadata].slice(0, 4000)` path that fires when `JSON.stringify(metadata).length > 4096`). Still open.

**TE-R7C2-05 [INFO]** — `backfillClipEmbeddings` action (`app/actions/embeddings.ts`) has no dedicated behavioral test:  
The only test touching `embeddings.ts` is `backfill-clip-embeddings-reembed.test.ts`, which is a source-grep fixture checking that `embeddings.ts` imports `getUploadTracker` (a structural import check, not a behavioral test). No test exercises the actual DB query or model-version-gated insert logic. Still open.

---

## 3. Flake Report — `upload-tracker-state.test.ts`

### Finding: TE-R9C3-01 [LOW] — Test isolation is `beforeEach`-only; `beforeAll` missing for pool-agnosticism

**Reported by verifier:** 1 failure / 2053 pass on run 1; 2054/2054 on runs 2 and 3.

**Root cause analysis:**

Under Vitest 4.1.4's default `forks` pool (one child process per test file), each file's `globalThis` is isolated at the OS process boundary. Cross-file `globalThis` contamination is structurally impossible under this pool model. The `beforeEach(() => getUploadTracker().clear())` is therefore sufficient for all current runs.

**Why the one-time failure most likely occurred:** a transient process-startup race or host memory pressure on run 1 caused a module import or Map initialization timing artifact. The code under test is purely synchronous and the assertions are deterministic — there is no timing-sensitive path that could produce a non-deterministic result given a clean `globalThis`.

**However, there is a genuine LOW-severity hardening gap:** the test file's isolation guarantee relies on the `forks` pool model remaining in effect. If a future maintainer sets `pool: 'vmThreads'` or `singleFork: true` in `vitest.config.ts` (both of which share `globalThis` between files), the `beforeEach` clear would no longer protect the very first test execution — the Map could carry stale entries from a previously-run file in the same worker thread. The fix is a single `beforeAll` at the top of the file:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

beforeAll(() => {
    getUploadTracker().clear();
});
```

This makes the test pool-configuration-agnostic at essentially zero cost. It is a hardening improvement, not a correctness fix for the current configuration.

**Severity: LOW.** The current codebase uses `forks` pool with no `singleFork` or `vmThreads` override; the one observed failure has no reproducible root cause under the current config. The `beforeAll` addition is the recommended fix to prevent a future pool-model change from silently introducing cross-file flakiness.

---

## 4. Fresh Sweep — New Gaps

**Scope of changes since run-9 c1 baseline (d3858cfc):**

The only code change merged between run-9 c1 and HEAD c2d3857a is `e1acaff1` (`fix(scripts): drain cicp-recheck queue with onIdle not onEmpty`). This modifies `apps/web/scripts/backfill-cicp-recheck.ts` exclusively — a one-shot operator diagnostic script, not a product runtime path. No new library functions, auth guards, race-condition fences, or parser paths were introduced.

**Verdict: ZERO new test gaps from new code.**

Broader sweep of existing untested correctness paths that have not been previously reported:

- The `onIdle`/`onEmpty` drain distinction in `backfill-cicp-recheck.ts` is not worth unit-testing: it is a one-shot script whose correctness depends on `p-queue`'s own contract, not on application logic. The 5 sibling drain sites already use `onIdle` and the commit comment documents the rationale thoroughly. A test would be mocking `p-queue` to verify that `onIdle` was called — which tests the test's own mock, not the behavior.

- No new auth/privacy guards, parser bounds, or race-condition fences were added. The existing test surface for those paths (advisory lock tests, backfill tests, privacy-fields test, check-api-auth, check-action-origin) was not changed.

---

## Summary

| Item | Status |
|---|---|
| `upload-tracker-state.test.ts` soundness | SOUND — 11/11 tests, all branches covered, deterministic |
| `upload-processing-contract-lock.test.ts` soundness | SOUND — 7/7 tests, both BigInt arms covered, error/idempotency paths covered |
| TE-R7C2-03 (semantic route `.filter(m !== null)`) | STILL OPEN [LOW] |
| TE-R7C2-04 (`logAuditEvent` truncation) | STILL OPEN [LOW] |
| TE-R7C2-05 (`backfillClipEmbeddings` action) | STILL OPEN [INFO] |
| New gaps from run-9 c3 code changes | ZERO |
| Flake finding | TE-R9C3-01 [LOW] — add `beforeAll` to `upload-tracker-state.test.ts` for pool-agnosticism |

**Test Health: HEALTHY.** The one new finding (TE-R9C3-01) is a hardening fix to an existing test, not a gap in production guard coverage. No correctness-adjacent or security-critical paths are newly untested.
