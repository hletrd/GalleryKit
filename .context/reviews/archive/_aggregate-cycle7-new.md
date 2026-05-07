# Aggregate Review — Cycle 7 (2026-04-19)

**Source review:** cycle7-comprehensive-review (multi-angle: code-quality, security, performance, architecture, test-engineer, UI/UX, verifier, debugger, document-specialist)

## Summary

Cycle 7 deep review of the full codebase found **6 new findings** (1 MEDIUM, 5 LOW). No CRITICAL or HIGH findings. No regressions from prior cycles. All prior cycle fixes verified as still in place.

## Findings

| ID | Description | Severity | Confidence | File | Reviewers |
|----|------------|----------|------------|------|-----------|
| C7-F01 | `flushGroupViewCounts` tight loop during DB outage — no backoff | MEDIUM | Medium | `apps/web/src/lib/data.ts:27-51` | code-quality, perf |
| C7-F02 | Search query validation length (1000) exceeds actual search slice (200) | LOW | Medium | `apps/web/src/app/actions/public.ts:25,96` | security, code-quality |
| C7-F03 | No test coverage for view count buffering system | LOW | Medium | `apps/web/src/lib/data.ts:12-65` | test-engineer |
| C7-F04 | No test for search rate limit rollback logic | LOW | Medium | `apps/web/src/app/actions/public.ts:62-94` | test-engineer |
| C7-F05 | `nav-client.tsx` inline useCallback in JSX provides no memoization | LOW | Low | `apps/web/src/components/nav-client.tsx:143-146` | code-quality, ui-ux |
| C7-F06 | `getImage` prev/next uses `= NULL` instead of `IS NULL` for null capture_date | LOW | Medium | `apps/web/src/lib/data.ts:333-378` | code-quality, debugger |

### C7-F01: flushGroupViewCounts tight loop (MEDIUM)

Previously deferred as C30-03/C36-03 but upgraded: during extended DB outages, the flush timer fires every 5s, each time attempting all 1000 buffered entries which all fail and re-buffer. This creates a burst of ~1000 failed queries every 5 seconds (720,000/hour). Fix: add consecutive failure counter with exponential backoff.

### C7-F02: Search query validation vs slice mismatch (LOW)

`query.length > 1000` passes but only first 200 chars are searched. Fix: align the validation limit with the actual search slice (lower to 200 or raise slice to 1000).

### C7-F03: View count buffer tests (LOW)

No unit tests for the buffering system. Fix: add tests with mock DB covering normal flush, cap enforcement, re-buffer on DB error, shutdown flush.

### C7-F04: Search rate limit rollback tests (LOW)

Recent rollback fix (commit a6bb900) lacks regression tests. Fix: add tests for rollback paths.

### C7-F05: Inline useCallback (LOW)

`useCallback` called inline in JSX doesn't provide memoization. Fix: move to component level or use plain arrow function.

### C7-F06: NULL capture_date SQL (LOW)

`eq(images.capture_date, null)` produces `= NULL` (always false in MySQL) instead of `IS NULL`. Isolates NULL-date images in navigation. Fix: use conditional `IS NULL` SQL.

## Cross-Agent Agreement

- C7-F01 flagged by both code-quality and performance — higher signal
- C7-F02 flagged by both security and code-quality — higher signal
- C7-F03/C7-F04 flagged only by test-engineer — but gaps are real
- C7-F06 flagged by both code-quality and debugger — higher signal

## Previously Fixed — Confirmed Resolved

All findings from cycles 1-6 verified as still resolved in current codebase. No regressions.

## Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without backoff (upgraded)
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline

## AGENT FAILURES

None — single reviewer completed all angles.

## TOTALS

- **1 MEDIUM** finding requiring implementation
- **5 LOW** findings recommended for implementation
- **0 CRITICAL/HIGH** findings
- **6 total** unique findings
