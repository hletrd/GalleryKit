# Plan 96-Deferred — Cycle 9 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 9)
**Status:** DONE (deferred items documented)

---

## Cycle 9 Review Result

1 new actionable finding implemented (C9-F02). 2 findings deferred (C9-F01, C9-F03). 1 informational (C9-F04, verified correct).

## Deferred Items

### C9-F01: original_file_size bigint mode: 'number' precision [MEDIUM, Medium Confidence]

**File:** `apps/web/src/db/schema.ts:50`
**Reason:** Same class as deferred C30-04/C36-02/C8-01. The practical risk is negligible — the 200MB upload cap means `file.size` can never approach 2^53. The `mode: 'number'` is needed for Drizzle ORM compatibility with the JavaScript number type used throughout the codebase.
**Exit criterion:** If upload limits are ever raised above 8 PB or if file sizes come from other sources.

### C9-F03: searchImagesAction rate limit check/increment window [LOW, Low Confidence]

**File:** `apps/web/src/app/actions/public.ts:55-94`
**Reason:** The 1-request overshoot per window across processes is acceptable for a photo gallery search. The in-memory pre-increment prevents larger bursts for the same process. Fixing would require either a `SELECT FOR UPDATE` or `GET_LOCK` which adds latency for marginal improvement.
**Exit criterion:** If stricter rate-limit enforcement is needed (e.g., for commercial API usage).

## Prior Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02 / C8-01: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline
- C7-F03: No test coverage for view count buffering system
- C7-F04: No test for search rate limit rollback logic
- C8-F01: deleteTopicAlias revalidation (no change needed, informational)
