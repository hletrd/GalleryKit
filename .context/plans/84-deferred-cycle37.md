# Plan 84 — Cycle 37 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 37)
**Status:** DONE (no new actionable findings)

---

## Cycle 37 Review Result

No new actionable findings. The codebase is in strong shape after 36 prior cycles of fixes.

## Deferred Carry-Forward

All previously deferred items remain with no change in status:

### C32-03: Insertion-order eviction in Maps [LOW]
**Files:** Various rate-limit Maps in `rate-limit.ts`, `auth-rate-limit.ts`, `actions/sharing.ts`
**Reason:** Maps use insertion-order eviction under hard cap pressure. LRU would be more fair but adds complexity for a marginal improvement. Hard caps prevent unbounded growth.
**Exit criterion:** If eviction fairness becomes a practical concern under production load.

### C32-04 / C30-08: Health endpoint DB disclosure [LOW]
**File:** `apps/web/src/app/api/health/route.ts`
**Reason:** Health endpoint reveals DB connectivity status. Only accessible unauthenticated, but info is minimal (`db: true/false`).
**Exit criterion:** If health endpoint is moved behind auth or if DB connectivity status is deemed sensitive.

### C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap [LOW]
**File:** `apps/web/src/lib/auth-rate-limit.ts:66`
**Reason:** Password change rate-limit Map uses the same `LOGIN_RATE_LIMIT_MAX_KEYS` (5000) cap as login. Should have its own constant but the practical impact is negligible.
**Exit criterion:** If separate rate-limit tuning is needed for password changes vs login.

### C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit [LOW, High Confidence]
**File:** `apps/web/src/lib/data.ts:40-46`
**Reason:** Same as deferred C30-04 from cycle 30. Hard cap of 1000 entries prevents memory issues. Only affects view count accuracy during extended DB outages, not stability.
**Exit criterion:** If view count accuracy becomes critical; implement a max-retry counter per buffered entry.

### C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion [LOW, Low Confidence]
**File:** `apps/web/src/app/actions/sharing.ts:166`
**Reason:** Theoretical only — galleries never approach 2^53 rows. `Number.isFinite` already validates NaN/Infinity.
**Exit criterion:** If the app ever supports tables approaching 2^53 rows or mysql2 config changes BigInt handling.

### C30-06: Tag slug regex inconsistency [LOW]
**Files:** `apps/web/src/lib/validation.ts` vs `apps/web/src/app/actions/tags.ts:13`
**Reason:** `isValidSlug` allows underscores; `getTagSlug` strips them. Minor inconsistency but no data corruption risk since slug generation strips before validation.
**Exit criterion:** If slug generation is refactored or if tag URLs with underscores are needed.

### Font subsetting [DEFERRED]
**Reason:** Requires Python brotli dependency for font subsetting. Not a code quality issue.
**Exit criterion:** If build pipeline adds Python support or an alternative subsetting tool is available.

### Docker node_modules removal [DEFERRED]
**Reason:** Native module bundling complications. Not a code quality issue.
**Exit criterion:** If standalone output properly handles all native dependencies.
