# Test Engineer — Cycle 8 (RPL loop, 2026-04-23)

**Scope:** test coverage gaps, brittle assertions, and TDD opportunities
after cycle-7-rpl test additions (action-guards, csv-escape additions,
check-action-origin recursion).

## Findings

### T8-01 — No test for `uploadImages` tracker first-insert race [MEDIUM, HIGH]

**File:** target `apps/web/src/__tests__/images-actions.test.ts` or
new `upload-tracker-race.test.ts`.

**Gap:** no test reproduces concurrent first-insert on a cold IP
(CR8-01). A fixture that calls `uploadImages` twice in parallel on
the same IP before either `set` completes would catch it.

**Difficulty:** moderate — the test needs to mock `uploadTracker`
Map observability with await-ordered resolution.

**Priority:** MEDIUM. Ships as part of CR8-01 fix.

### T8-02 — No test for CSV zero-width bypass [LOW, HIGH]

**File:** target `apps/web/src/__tests__/csv-escape.test.ts`.

**Gap:** no test asserts `​=HYPERLINK(...)` is defused. Add:
- Input `​=HYPERLINK("x")` → must trigger formula prefix.
- Input `﻿=SUM(A1)` → must trigger formula prefix.
- Input `⁠=cmd` → must trigger formula prefix.

**Priority:** LOW. Ships with CRIT8-01 fix.

### T8-03 — No direct test for `rollbackShareRateLimitFull` [LOW, MEDIUM]

**File:** target `apps/web/src/__tests__/sharing-actions.test.ts`
(if exists) or new.

**Gap:** `rollbackShareRateLimitFull` is private to `sharing.ts`.
The six call sites are exercised indirectly via the public share
actions, but there's no test that asserts:
- On `failedToGenerateKey` error path, `decrementRateLimit` is called.
- On `failedToCreateGroup` retry-exhausted path, the DB decrement fires.

**Priority:** LOW. Low failure probability; regression test would
lock in the cycle-7-rpl behavior.

### T8-04 — `beginRestoreMaintenance` early-return path not unit tested [LOW, HIGH]

**File:** target `apps/web/src/__tests__/db-actions.test.ts`
(if exists) or `restore-maintenance.test.ts`.

**Gap:** the cycle-7-rpl fix (T7R-02) explicitly noted "Vitest unit
test is hard (requires mocking the connection)". No test was added.
A regression that removes the `RELEASE_LOCK` call on that path
would only be caught by a downstream symptom (restore seemingly
jammed).

**Priority:** LOW. The fix is defensive by comment; a test would
be ideal but not blocking.

### T8-05 — No test for `pruneShareRateLimit` eviction order [LOW, MEDIUM]

**File:** target `apps/web/src/__tests__/sharing-actions.test.ts`.

**Gap:** the eviction logic (CR8-08) is untested. A fixture that
fills the Map to 501 entries with staggered `resetAt` timestamps,
calls `pruneShareRateLimit`, and asserts which entries remain,
would lock the LRU-ish semantics.

**Priority:** LOW.

### T8-06 — No regression test for `cleanOrphanedTmpFiles` parallel behavior [LOW, HIGH]

**File:** target `apps/web/src/__tests__/image-queue.test.ts`
(if exists).

**Gap:** the cycle-7-rpl parallelization (AGG7R-13) is untested. A
fixture with three mock directories, each with 3 `.tmp` files, and
a slow-unlink stub for one dir, should demonstrate that the other
dirs complete without waiting.

**Priority:** LOW.

### T8-07 — E2E test for `/api/admin/db/download` absence [LOW, HIGH]

**File:** `apps/web/e2e/` (unsure of admin-api coverage).

**Gap:** per-cycle reviews keep re-citing the `X-Content-Type-Options`,
`Content-Disposition`, and auth check on this route. An e2e test
that asserts the GET without auth cookie returns 401 (or redirect)
and with auth returns the file with correct headers, would lock
the contract.

**Priority:** LOW.

### T8-08 — `decrementRateLimit` behavior under concurrent calls [LOW, MEDIUM]

**File:** target `apps/web/src/__tests__/rate-limit.test.ts`
(if exists).

**Gap:** the `GREATEST(count - 1, 0)` atomic decrement is untested.
Concurrent rollbacks should never drive the count below 0. A
fixture that fires 10 parallel `decrementRateLimit` calls against
a count-of-5 bucket should leave count = 0 (not -5).

**Priority:** LOW.

## Summary

Tests are in good shape. 48 test files, 275 tests, all passing. T8-01
(upload tracker race) is the one test worth prioritizing since it
directly validates a finding being planned. The rest are
defense-in-depth coverage gaps.
