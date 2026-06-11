# Run-4 Cycle 11 — test-engineer angle

## Inventory
- Baseline: `npm test --workspace=apps/web` → **1744 passed (182 files)**,
  clean tree, this cycle.
- Existing view-count coverage: `src/__tests__/data-view-count-flush.test.ts`
  (12 fixture-style invariants — swap-and-drain, backoff, capacity symmetry).

## Gap — TEST-R4C11-01 (folds into COR-R4C11-01)
`data-view-count-flush.test.ts` locks the swap-and-drain + backoff invariants
but has **no assertion that `flushGroupViewCounts` clears
`viewCountFlushTimer` on entry / re-arms on the `isFlushing` early-return**.
That is exactly the invariant whose absence allows the stale-timer stranding
(COR-R4C11-01). The function takes no args, mutates module state, and calls
the real Drizzle client, so a full behavioral test needs the same large mock
lift the file's header explicitly deferred (C7-F03). Consistent with that
established convention, the fix is locked by **fixture-style** assertions:

1. In the `flushGroupViewCounts` body, the `viewCountFlushTimer = null`
   assignment appears BEFORE the `if (isFlushing)` guard (entry-null).
2. The `isFlushing` branch re-arms a timer guarded by
   `viewCountBuffer.size > 0`.

These two assertions fail against the pre-fix source and pass after, pinning
the regression without the mock burden.

## No flaky/over-mocked tests observed
The cycle-10 behavioral tests (`strip-gps-from-original.test.ts` motion-photo
case, `admin-user-delete-audit-detach.test.ts`) are proven-failing-before
and assert real behavior, not tautologies.
