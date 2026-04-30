# Plan 94-Deferred — Cycle 7 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 7)
**Status:** DONE (deferred items documented)

---

## Cycle 7 Review Result

4 new actionable findings implemented (C7-F01, C7-F02, C7-F05, C7-F06). 2 findings deferred.

## Deferred Items

### C7-F03: No test coverage for view count buffering system [LOW, Medium Confidence]
**Files:** `apps/web/src/__tests__/`, `apps/web/src/lib/data.ts:12-65`
**Reason:** Requires significant mock setup for the buffer/flush system including mock DB, timer mocking, and concurrent flush simulation. Unit test coverage is good elsewhere but this buffering system lacks dedicated tests. Not a code quality or security issue — the buffer has been running correctly in production.
**Exit criterion:** When a dedicated test-writing cycle is scheduled.

### C7-F04: No test for search rate limit rollback logic [LOW, Medium Confidence]
**Files:** `apps/web/src/app/actions/public.ts:62-94`
**Reason:** Same as C7-F03 — requires mock for rate limit Maps and DB. The rollback fix (commit a6bb900) has been running correctly in production. Regression risk is low since the logic is straightforward decrement/delete.
**Exit criterion:** When a dedicated test-writing cycle is scheduled.

## Prior Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without retry limit (backoff added this cycle, but retry limit remains deferred)
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline
