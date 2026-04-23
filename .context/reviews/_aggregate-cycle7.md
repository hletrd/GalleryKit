# Aggregate Review — Cycle 7 (2026-04-19)

**Source reviews:** cycle7-comprehensive-review (single reviewer, multi-angle)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## PRIORITY REMEDIATION ORDER

### Must-fix (MEDIUM)

1. **C7-03**: Wrap password change + session invalidation in explicit transaction in `auth.ts` to prevent old sessions surviving after password change on DB error.

### Should-fix (LOW)

2. C7-01: Add image existence check in `createPhotoShareLink` retry loop when `affectedRows === 0`
3. C7-05: Replace hardcoded English strings with `t()` calls in `topics.ts` (createTopic, updateTopic, createTopicAlias)
4. C7-06: Replace raw `<input type="checkbox">` with `<Checkbox>` component in `image-manager.tsx`
5. C7-09: Split shared `isDeleting` state into separate states for topic vs alias deletion in `topic-manager.tsx`
6. C7-10: Add `maxLength={1024}` to password `<Input>` fields in `password-form.tsx`

### Improvement-only (LOW)

7. C7-04: Change `const results` to `let results` in `exportImagesCsv` to allow GC release
8. C7-07: Fix `eq(images.capture_date, null)` → `IS NULL` in prev/next queries for NULL-date images
9. C7-08: No fix needed — rate limit inconsistency is in safe direction (informational)

### No-fix (informational)

10. C7-02: `deleteGroupShareLink` ownership check not needed in single-admin-trust model

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-6 findings (U-01 through U-21, C2-01 through C2-17, C3-01 through C3-12, C4-01 through C4-09, C5-01 through C5-08, C6-01 through C6-10) remain resolved. No regressions detected.

---

## DEFERRED CARRY-FORWARD

1. U-15 connection limit docs mismatch (very low priority)
2. U-18 enumerative revalidatePath (low priority, current approach works)
3. /api/og throttle architecture (edge runtime, delegated to reverse proxy)
4. Font subsetting (Python brotli dependency issue)
5. Docker node_modules removal (native module dependency)
6. C5-04 searchRateLimit in-memory race (safe by Node.js single-thread guarantee)
7. C5-05 original_file_size from client value (acceptable for display metadata)
8. C5-07 prunePasswordChangeRateLimit infrequent pruning (hard cap sufficient)
9. C5-08 dumpDatabase partial file cleanup race (negligible risk)
10. C6-10 queue bootstrap unbounded fetch (by-design, paginated limit if >10K pending)
11. C7-07 NULL capture_date prev/next navigation (LOW, uncommon legacy-only case)
12. C7-08 rate limit inconsistency in safe direction (no fix needed)

---

## AGENT FAILURES

None — single reviewer completed successfully.

---

## TOTALS

- **1 MEDIUM** finding requiring implementation
- **6 LOW** findings recommended for implementation (C7-01, C7-05, C7-06, C7-09, C7-10, C7-04)
- **2 LOW** findings deferred (C7-07, C7-08)
- **1 informational** finding requiring no action (C7-02)
- **0 CRITICAL/HIGH** findings
- **7 total** actionable findings (1M + 6L)
