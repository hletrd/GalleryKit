# Run-4 Cycle 12 — test-engineer angle

Distinct full-inventory in-context pass (single-subagent constraint documented
in `_aggregate.md`).

## Inventory examined
- Test landscape for the rotation surface: `__tests__/queue-shutdown.test.ts`
  (behavioral, injected fake queue — the model to follow),
  `__tests__/image-queue.test.ts` (mocked-PQueue behavioral + fixture),
  `__tests__/image-queue-bootstrap.test.ts`,
  `__tests__/image-queue-permanent-failure.test.ts` (fixture: quiesce clears
  permanentlyFailedIds), `__tests__/image-queue-permanent-failure-cleanup.test.ts`,
  `__tests__/data-view-count-flush.test.ts` (c11 assertions verified
  present and matching the shipped source), `__tests__/restore-maintenance.test.ts`,
  `__tests__/restore-upload-lock.test.ts`, `__tests__/db-restore.test.ts`.

## FINDINGS

### TEST-R4C12-01 — no test pins the quiesce operation ORDER, and no test models p-queue's paused-queue idle semantics (gap / High)
`queue-shutdown.test.ts` asserts pause/clear/onIdle are CALLED for the drain
path (and the shutdownPromise memo), and
`image-queue-permanent-failure.test.ts` asserts quiesce clears state — but
NOTHING asserts the ORDER of `pause`/`clear`/`onIdle` in
`quiesceImageProcessingQueueForRestore`, and every existing fake queue stubs
`onIdle: vi.fn().mockResolvedValue(undefined)` — i.e. an onIdle that always
resolves, which is precisely the semantics a PAUSED p-queue does NOT have.
That mock shape is why c6627ec8's deadlock (COR-R4C12-01) passed the suite.

**Required tests (folded into the COR-R4C12-01 fix):**
1. A behavioral test injecting a fake queue whose `onIdle` resolves ONLY if
   `clear()` has already been called (faithful model of p-queue 9.1.2's
   paused-queue reachability: with queued items, only `clear()` can get
   `size` to 0). Must FAIL FAST (reject, not hang) when order is wrong so a
   regression doesn't burn the suite timeout.
2. An explicit call-order assertion (`pause` → `clear` → `onIdle`) for
   quiesce, mirroring the drain test's style, so the two paused-queue
   consumers cannot drift apart again.
Both must fail against the pre-fix source. Use the injected-queue parameter
(already in the signature) — no module mocking needed.

### Coverage notes (no action)
- The c11 fixture assertions in `data-view-count-flush.test.ts` were
  re-verified against the shipped `data.ts` — they pin entry-null-before-guard
  and the early-branch re-arm correctly (the `earlyBranch` slice trick
  excludes the finally re-arm; sound).
- `restore-upload-lock.test.ts` covers contract-lock acquisition/release
  paths including query-failure release; no gap found.
- The vitest suite baseline on the clean tree is 1745 passed / 182 files
  (run during PROMPT 3 gating; matches plan-293's recorded baseline +0).
