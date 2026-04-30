# Plan 95-Deferred — Cycle 8 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 8)
**Status:** DONE (deferred items documented)

---

## Cycle 8 Review Result

3 new actionable findings implemented (C8-04, C8-05, C8-10). 2 findings deferred (C8-01, C8-F01).

## Deferred Items

### C8-01: createGroupShareLink insertId BigInt precision [MEDIUM, High Confidence]
**File:** `apps/web/src/app/actions/sharing.ts:166`
**Reason:** Already deferred as C30-04/C36-02. The practical risk is negligible — would require ~9 million shared groups. The `Number.isFinite` guard catches NaN/Infinity. Precision loss for values near 2^53 is theoretically possible but not practically reachable.
**Exit criterion:** If the app ever supports tables approaching 2^53 rows or mysql2 config changes BigInt handling.

### C8-F01: deleteTopicAlias revalidation for alias path [MEDIUM, Medium Confidence]
**File:** `apps/web/src/app/actions/topics.ts:295`
**Reason:** After deeper analysis, the current implementation already correctly calls `revalidateLocalizedPaths` with the alias path, which force-invalidates ISR cache via `revalidatePath`. The concern about stale cache was overblown — `revalidatePath` does force-invalidate ISR cache. No code change needed.
**Exit criterion:** If ISR cache invalidation for deleted aliases is observed to fail in production.

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
