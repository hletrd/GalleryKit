# Aggregate Review — Cycle 36 (2026-04-19)

## Summary

Cycle 36 review of the full codebase found **1 actionable issue** (LOW). No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase remains in strong shape after 35 prior cycles of fixes.

## Findings

| ID | Severity | Confidence | File | Description |
|----|----------|------------|------|-------------|
| C36-01 | LOW | Medium | `admin/(protected)/dashboard/page.tsx:10` | Dashboard page `parseInt` without upper-bound cap on page number — allows extreme offset queries (admin-only) |
| C36-02 | LOW | Low | `actions/sharing.ts:166` | `Number(result.insertId)` BigInt coercion — theoretical only for realistic galleries |
| C36-03 | LOW | High | `lib/data.ts:40-46` | `flushGroupViewCounts` re-buffers failed increments without retry limit (carry-forward from C30-04) |

## Actionable This Cycle

- C36-01: Add `Math.min(page, 1000)` cap on dashboard page number to prevent extreme OFFSET values in MySQL queries. Defense-in-depth for admin-only page.

## Deferred This Cycle

- C36-02: Theoretical BigInt coercion in `Number(insertId)` — not realistic for gallery-sized databases. Exit criterion: if the app ever supports tables approaching 2^53 rows.
- C36-03: Same as deferred C30-04 from cycle 30. Hard cap of 1000 buffer entries prevents memory issues; only affects view count accuracy during extended DB outages.

## Deferred Carry-Forward

All previously deferred items from cycles 5-33 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04: `createGroupShareLink` insertId validation inside transaction
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
