# Aggregate Review — Cycle 13 (2026-04-19)

**Source reviews:** cycle13-comprehensive-review (single reviewer, multi-angle)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## PRIORITY REMEDIATION ORDER

### Should-fix (MEDIUM)

1. **C13-01**: Login rate limit not rolled back on unexpected errors in `auth.ts`. The pre-incremented counter (TOCTOU fix) stays incremented even when the failure is infrastructure-level (DB query failure, Argon2 internal error) rather than a wrong credential. After 5 transient errors, the user is locked out despite never failing authentication. Roll back the counter in the outer catch block.

2. **C13-02**: Password change rate limit not rolled back on unexpected errors in `auth.ts`. Same pattern as C13-01 but in `updatePassword()`. Infrastructure failures (DB, Argon2, transaction errors) incorrectly consume rate limit attempts. Roll back the counter in the outer catch block.

### Improvement-only (LOW)

3. C13-03: CSV export column headers hardcoded in English in `db-actions.ts`. The admin UI is fully localized but the CSV always outputs English headers. Consider localizing or documenting as convention.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-11 findings (C11-01 through C11-05, C10-01 through C10-03, C9-01 through C9-03, C8-01 through C8-13, C7-01 through C7-10, C6-01 through C6-10, C5-01 through C5-08, C4-01 through C4-09, C3-01 through C3-12, C2-01 through C2-17, U-01 through U-21) remain resolved. No regressions detected.

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
11. C7-07 NULL capture_date prev/next navigation (legacy-only, reasonable UX)
12. C7-08 rate limit inconsistency in safe direction (no fix needed)
13. C8-04 searchImages query length guard (defense in depth, caller truncates)
14. C8-05 audit log on race-deleted image (control flow already guards)
15. C8-10 batchUpdateImageTags added count accuracy (negligible UX inaccuracy)

---

## AGENT FAILURES

None — single reviewer completed successfully.

---

## TOTALS

- **2 MEDIUM** findings requiring implementation
- **1 LOW** finding recommended for implementation
- **0 CRITICAL/HIGH** findings
- **3 total** actionable findings (2M + 1L)
