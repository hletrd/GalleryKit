# Aggregate Review — Cycle 35 (2026-04-19)

## Summary

Cycle 35 review of the full codebase found **3 actionable issues** (1 MEDIUM, 2 LOW). No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase remains in strong shape after 34 prior cycles of fixes.

## Findings

| ID | Severity | Confidence | File | Description |
|----|----------|------------|------|-------------|
| C35-01 | LOW | High | `g/[key]/page.tsx:65`, `[topic]/page.tsx:80`, `layout.tsx:66` | Missing `return` before `notFound()` in 3 locations (inconsistent with rest of codebase) |
| C35-02 | LOW | Medium | `db/index.ts:18` + `CLAUDE.md` | DB pool `connectionLimit` is 10 in code but CLAUDE.md documents 8 |
| C35-04 | MEDIUM | High | `p/[id]/page.tsx:25` | `generateMetadata` calls `parseInt(id)` without validating `id` is numeric; wasted DB query with NaN |

## Actionable This Cycle

- C35-01: Add `return` before `notFound()` in 3 files to match codebase convention
- C35-02: Update CLAUDE.md to document `connectionLimit: 10` matching actual code
- C35-04: Add `/^\d+$/.test(id)` validation in `generateMetadata` before `parseInt` to match the default export's pattern

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
