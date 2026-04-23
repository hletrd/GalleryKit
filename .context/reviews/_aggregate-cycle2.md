# Aggregate Review — Cycle 2 (2026-04-19, New Loop)

**Source reviews:** code-quality-review-cycle2, security-review-cycle2, performance-review-cycle2

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|------------|-----------|-------------|----------|------------|-------------|
| C2-01 | C2-CQ-01, C2-SEC-01 | updateTopic fragile `e.message?.includes('Duplicate entry')` check | LOW | Medium | code-quality + security |
| C2-02 | C2-CQ-02 | deleteTopicAlias returns misleading `invalidAlias` error for non-MySQL failures | LOW | Low | code-quality only |
| C2-03 | C2-SEC-02 | createTopicAlias missing US-007 TOCTOU comment | LOW | Low | security only |

---

## PRIORITY REMEDIATION ORDER

### Should-fix (LOW)

1. **C2-01**: Replace `e.message?.includes('Duplicate entry')` with `e.cause?.code === 'ER_DUP_ENTRY'` in `updateTopic` catch block — consistent with `createTopic` and `createTopicAlias` in same file
2. **C2-02**: Return a generic server error instead of `invalidAlias` for non-MySQL failures in `deleteTopicAlias` catch block
3. **C2-03**: Add `// US-007` comment to `createTopicAlias` for documentation consistency

---

## VERIFIED: Prior Loop Findings Already Fixed

All stale MEDIUM findings from the prior loop's cycle 2 reviews have been fixed:

| Stale ID | Description | Verification Evidence |
|----------|-------------|----------------------|
| uploadTracker pruning | C2-CQ-01 / C2-PERF-01 / C2-SEC-01 | `pruneUploadTracker()` at images.ts:27,78; `UPLOAD_TRACKER_MAX_KEYS=2000` at line 24 |
| batchUpdateImageTags size cap | C2-CQ-03 / C2-SEC-06 | tags.ts:250 checks `addTagNames.length > 100` |
| Password rate-limit separation | C2-CQ-09 / C2-04 | Separate `passwordChangeRateLimit` Map in auth-rate-limit.ts |
| searchImages tag query limit | C2-CQ-06 / C2-PERF-02 | data.ts:575 uses `effectiveLimit - results.length` |
| deleteImages redundant filter | C2-PERF-05 | images.ts:417 uses `imageRecords.map(r => r.topic)` directly |

---

## DEFERRED CARRY-FORWARD

All previously deferred items from cycles 5-37 and cycle 1 (C1N-01 through C1N-23) remain deferred with no change in status:

- C1N-01: No HTML sanitization on title/description before storage
- C1N-02/C1N-03: Ad-hoc slug validation in data.ts instead of `isValidSlug()`
- C1N-04: Fragile message check in ER_DUP_ENTRY catch (admin-users.ts:54) — same class as new C2-01
- C1N-05: Type-unsafe GC pattern in exportImagesCsv
- C1N-10: Admin tag counts include unprocessed images
- C1N-23: No screen reader announcement on photo navigation
- C1N-13 through C1N-16: Test coverage gaps
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: passwordChangeRateLimit shares LOGIN_RATE_LIMIT_MAX_KEYS cap
- C30-03 / C36-03: flushGroupViewCounts re-buffers failed increments without retry limit
- C30-04 / C36-02: createGroupShareLink insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)

---

## AGENT FAILURES

None — all reviews completed successfully.

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **3 LOW** findings (2 actionable, 1 documentation-only)
- **0** new findings requiring immediate implementation
- **5** stale findings confirmed already fixed from prior loop
