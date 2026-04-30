# Plan 93 — Cycle 6 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 6)
**Status:** DONE (deferred items documented)

---

## Cycle 6 Review Result

1 new actionable finding implemented (C6-F01). 2 findings already resolved. 2 findings deferred.

## Deferred Items

### C6-F03: No E2E test coverage for upload pipeline [LOW, High Confidence]
**Files:** `apps/web/src/__tests__/`, `apps/web/e2e/`
**Reason:** Large effort — requires Playwright setup, test database, and comprehensive test infrastructure. Unit test coverage is good but the critical upload pipeline lacks E2E coverage. Not a code quality or security issue.
**Exit criterion:** When a dedicated test-writing cycle is scheduled.

### C6-F04 / C4-F02: Native checkboxes in image-manager.tsx [LOW, High Confidence]
**Files:** `apps/web/src/components/image-manager.tsx:282-288, 303-309`
**Reason:** Visual inconsistency with shadcn/ui design system. Functionally correct with proper ARIA labels. Migration to Checkbox component is a UI polish item.
**Exit criterion:** When UI component migration is scheduled.

## Prior Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F03: `isReservedTopicRouteSegment` rarely used
- C4-F05: `loadMoreImages` offset cap may allow expensive tag queries
- C4-F06: `processImageFormats` creates 3 sharp instances (informational)
