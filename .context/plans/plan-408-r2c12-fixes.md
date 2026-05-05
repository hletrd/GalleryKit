# Plan 408 — Cycle 12 (Run 2) Fixes

**Source**: `.context/reviews/_aggregate-r2c12.md`
**Created**: 2026-05-05
**Status**: Completed

## Summary

This plan addresses 6 findings from the Cycle 12 review. The highest-priority finding (C12-LOW-01) is a lint gate bypass that allows commented-out rate-limit helper calls to falsely satisfy the security-critical `check-public-route-rate-limit` gate. All findings are Low severity but span security, correctness, documentation, and test coverage.

## Tasks

### Task 1: Harden `check-public-route-rate-limit.ts` prefix check against commented-out helpers (C12-LOW-01)
- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`
- **Description**: Strip line comments (`// ...`) and block comments (`/* ... */`) from `withoutStrings` before the `usesPrefixHelper` regex check. The import check already excludes commented lines (C8-F03); extend the same defense to the prefix check.
- **Severity**: Low | **Confidence**: High

### Task 2: Fix semantic search Content-Length guard strictness (C12-LOW-02)
- **File**: `apps/web/src/app/api/search/semantic/route.ts`
- **Description**: Replace `Number.parseInt(contentLength, 10)` with `Number(contentLength)` + `Number.isFinite()` validation. Reject non-finite Content-Length values with 400 Bad Request before the body guard check.
- **Severity**: Low | **Confidence**: High

### Task 3: Add test fixture for commented-out helper bypass (C12-TE-02)
- **File**: `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- **Description**: Add test cases asserting that (a) a line-commented rate-limit helper call fails the gate, and (b) a block-commented rate-limit helper call fails the gate.
- **Severity**: Low | **Confidence**: High

### Task 4: Fix `bounded-map.ts` docstring to match actual behavior (C12-LOW-03)
- **File**: `apps/web/src/lib/bounded-map.ts`
- **Description**: Update the class docstring to clarify that `prune()` must be called before reads/writes to enforce the hard cap. The current docstring over-promises "automatic" eviction.
- **Severity**: Low | **Confidence**: Medium

### Task 5: Add semantic search POST handler integration tests (C12-TE-01)
- **File**: New `apps/web/src/__tests__/semantic-search-route.test.ts`
- **Description**: Add tests exercising the POST handler for: same-origin rejection (403), maintenance mode (503), oversized body (413), invalid JSON (400), invalid body shape (400), query too short (400), semantic disabled (403), rate limit (429), successful search (200), and enrichment fallback (200 with empty filenames).
- **Severity**: Low | **Confidence**: High

### Task 6: Fix high-bitdepth AVIF probe race condition (C12-LOW-04)
- **File**: `apps/web/src/lib/process-image.ts`
- **Description**: Wrap the 10-bit AVIF probe in a Promise-based singleton so only one worker performs the probe and the result is broadcast to all concurrent waiters. Replace the unguarded `_highBitdepthAvifProbed` / `_highBitdepthAvifAvailable` module-level state with a single probe promise.
- **Severity**: Low | **Confidence**: Medium

## Deferred Items

None. All 6 findings are scheduled for implementation in this plan.

## Implementation Order

1. Task 1 (lint gate prefix check) — unblocks Task 3
2. Task 3 (test fixture) — verifies Task 1
3. Task 2 (semantic search guard) — independent security fix
4. Task 4 (bounded-map docstring) — independent documentation fix
5. Task 5 (integration tests) — depends on no other task
6. Task 6 (AVIF probe race) — most complex, independent
