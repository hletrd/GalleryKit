# Plan 315 — Cycle 2/100 of Current Loop: View-Count Flush Backoff Test

**Cycle:** 2/100 of review-plan-fix loop (current loop)
**HEAD at plan creation:** `b840cb3 docs(reviews): record cycle-5 fresh review and plan-314`
**Status:** Implemented in this cycle

## Review Summary

Cycle 2 fresh review re-confirmed code-surface convergence. The only new actionable item is a test-only finding (`C2L2-TG01`) that closes a previously-deferred test gap (`C7-F03` deferred at cycle 7 with exit criterion "When a test infrastructure cycle is scheduled"). All gates are green this cycle, satisfying the scheduling criterion.

The C2-F01 fix to `flushGroupViewCounts` (commit `29eefad`, cycle 1 fresh) is a correctness-critical surface — it changed `viewCountBuffer` from `const` to `let` and introduced a swap-then-drain pattern so a process crash mid-flush no longer loses buffered increments. The follow-on `consecutiveFlushFailures` counter (already on master) adds exponential backoff for sustained DB outages. Neither has a regression test.

## New Findings This Cycle

| ID | Severity | Confidence | Finding | Status |
|---|---|---|---|---|
| C2L2-TG01 | LOW (test) | High | C2-F01 swap-and-drain plus `consecutiveFlushFailures` backoff in `lib/data.ts:52-105` lacks regression coverage. | Implemented this cycle |

## Implementation Action

Add a new vitest fixture-style test that verifies the **observable contracts** of the swap-and-drain plus backoff logic without needing to spin up a full DB or mock the Drizzle `db` client. The test reads the source file and asserts on the source-level invariants that prior cycles have made load-bearing — exactly the same fixture-style approach used by `data-tag-names-sql.test.ts` (the test that locks the `tagNamesAgg` shape).

This avoids the trap noted in cycle 7's deferral ("requires significant mock setup for the buffer/flush system") while still locking the contract. If a future refactor removes the swap pattern, the buffer-loss regression risk re-appears, and this test fails loudly with a pointer back to plan-311 / C2-F01.

### File to add

`apps/web/src/__tests__/data-view-count-flush.test.ts`

### Asserted invariants

1. `viewCountBuffer` is declared with `let` (not `const`) — so the swap can rebind the reference.
2. `flushGroupViewCounts` performs a swap before any DB write — the source contains the swap pair `const batch = viewCountBuffer; viewCountBuffer = new Map();` BEFORE the `db.update(...)` call, in that order.
3. `flushGroupViewCounts` uses chunked iteration over `entries` with `FLUSH_CHUNK_SIZE` to bound concurrency — source contains `for (let i = 0; i < entries.length; i += FLUSH_CHUNK_SIZE)`.
4. `consecutiveFlushFailures` is reset only when `succeeded > 0` and incremented only when `succeeded === 0 && batch.size > 0` — source contains the matched `if (succeeded > 0)` / `else if (batch.size > 0)` branch pair.
5. `getNextFlushInterval()` caps the backoff at `MAX_FLUSH_INTERVAL_MS` (5 minutes) via `Math.min(backoff, MAX_FLUSH_INTERVAL_MS)` — source contains the matched `Math.min(backoff, MAX_FLUSH_INTERVAL_MS)` expression.
6. The capacity guard in the re-buffer `.catch()` matches the same shape as the producer-side `bufferGroupViewCount` capacity guard (`viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE && !viewCountBuffer.has(groupId)`) — source contains both occurrences of that exact shape.
7. `MAX_VIEW_COUNT_BUFFER_SIZE` is a module-level constant set to 1000, and `FLUSH_CHUNK_SIZE` is 20 — locks the documented capacity / chunking constants.

These invariants together describe the load-bearing properties of the C2-F01 fix and the `consecutiveFlushFailures` backoff. A regression that broke any of them would re-introduce a real failure mode (buffer loss on crash, unbounded concurrency, never-ending retry hammer, or capacity overrun).

## Deferred Items

None new this cycle. All previously deferred items remain in their existing posture per `233-deferred-cycle3-loop.md`, `302-deferred-cycle1-loop-2026-04-25.md`, `304-deferred-cycle2-loop.md`, etc.

## Verification

- `npm test --workspace=apps/web` — must pass with new test green and pre-existing 461 still green.
- `npm run lint --workspace=apps/web` — must remain exit 0.
- `npm run typecheck --workspace=apps/web` — must remain exit 0.
- `npm run lint:api-auth --workspace=apps/web` — must remain exit 0.
- `npm run lint:action-origin --workspace=apps/web` — must remain exit 0.
- `npm run build --workspace=apps/web` — must remain exit 0.

## Closes

- `C2L2-TG01` — view-count flush backoff coverage gap (this cycle).
- `C7-F03` — originally deferred at cycle 7 with exit criterion "When a test infrastructure cycle is scheduled." Now closed.
