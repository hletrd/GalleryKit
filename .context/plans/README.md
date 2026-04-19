# Implementation Plans Index

## Active Plans

- 48 — Sharing insertId Guard, Login & User Form maxLength — DONE
- 49 — i18n Remaining Hardcoded Strings, UX Inconsistencies — DONE

## Completed Plans (Cycle 6)

- 41 — Upload Tracker TOCTOU Fix and CSV Export Memory Safety — DONE (2026-04-19)
- 42 — Auth Session Transaction Safety and Minor Fixes — DONE (2026-04-19)

## Completed Plans (Cycle 5)

- 39 — Confirm Dialog Consistency and InsertId Guard — DONE (2026-04-19)

## Completed Plans (Cycle 4)

- 37 — Insert ID Consistency and Confirm Dialog Replacement — DONE (2026-04-19)
- 38 — Data Layer Caching and Rate-Limit Hardening — DONE (2026-04-19)

## Completed Plans (Cycle 3)

- 35 — Insert ID Safety and Rate-Limit Map Pruning — DONE (2026-04-19)
- 36 — Data Layer Optimizations and ARIA Improvements — DONE (2026-04-19)

## Completed Plans (Cycle 2)

- 33 — Rate-Limit TOCTOU Fix (updatePassword) and Upload Tracker Hardening — DONE (2026-04-19)
- 34 — Tag Operations Validation, Search Optimization, and ARIA Improvements — DONE (2026-04-19)

## Completed Plans

- Plans 00-26 remain complete as previously recorded.
- 27 — Routing, Metadata, and View-State Consistency — DONE (2026-04-18)
- 28 — Upload, Restore, and Sharing Safety — DONE (2026-04-18)
- 29 — Admin Refresh, Proxy Semantics, and Docs/Deploy Alignment — DONE (2026-04-18)
- 30 — Security: Rate-Limit TOCTOU and Upload Batch Bypass — DONE (2026-04-19)
- 31 — Data Layer and Queue Hardening — DONE (2026-04-19)
- 32 — UI Component Polish and UX Improvements — DONE (2026-04-19)

---

## Reviews Cross-Referenced

| Review | Date | Total Findings | Planned | Deferred/Manual |
|--------|------|---------------|---------|-----------------|
| **Cycle 8 Comprehensive Review** | 2026-04-19 | 9 actionable (1M/8L) | 6 via Plans 48-49 | 3 via Plan 50 |
| **Cycle 7 Comprehensive Review** | 2026-04-19 | 7 actionable (1M/6L) | 7 via Plans 44-46 | 2 via Plan 47 |
| Cycle 6 Comprehensive Review | 2026-04-19 | 9 actionable (3M/6L) | 9 via Plans 41-42 | 1 via Plan 43 |
| Cycle 5 Comprehensive Review | 2026-04-19 | 9 actionable (2M/6L/1I) | 5 complete via Plan 39 | 4 via Plan 40 |
| Cycle 4 Comprehensive Review | 2026-04-19 | 9 actionable (2M/7L) | 9 complete via Plans 37-38 | 0 |
| Cycle 3 Comprehensive Review | 2026-04-19 | 12 (2M/10L) | 12 complete via Plans 35-36 | 0 |
| Comprehensive Code Review (full audit) | 2026-04-18 | 15 confirmed + 3 likely/risk | 15 confirmed + 2 low-risk likely fixes complete | 1 manual-validation risk (`/api/og` throttle architecture) |
| UI/UX Deep Review R7 | 2026-04-18 | 11 (6H/3M/2L) | Complete via Plan 26 | 0 |
| Comprehensive Review R6 | 2026-04-18 | 40 (2C/9H/18M/11L) | Complete | 0 |

---

## Cycle 8 Findings → Plan Mapping

### Plan 48 (Sharing insertId + Form maxLength)
- C8-01 createGroupShareLink insertId guard (already present — false positive)
- C8-02 maxLength on login form username/password inputs
- C8-03 maxLength on create-user password input

### Plan 49 (i18n + UX)
- C8-05 audit log on race-deleted image (no change needed — already guarded)
- C8-06 shared group page raw arrow → ArrowLeft + i18n
- C8-09 delete-user dialog wrong translation key
- C8-11 createTopic remaining hardcoded strings
- C8-12 updateTopic hardcoded error string

### Plan 50 (Deferred)
- C8-04 searchImages query length guard (defense in depth, caller already truncates)
- C8-05 audit log on race-deleted image (control flow analysis shows already guarded)
- C8-10 batchUpdateImageTags added count accuracy (negligible UX inaccuracy)

### Plan 44 (Password Change Transaction)
- C7-03 password change + session invalidation not in transaction

### Plan 45 (i18n + Share Link Safety)
- C7-05 hardcoded English strings in topics.ts
- C7-01 share link retry loop missing image existence check

### Plan 46 (UI + Password + CSV)
- C7-06 checkbox styling (downgraded — no component change needed)
- C7-09 split isDeleting state in topic-manager
- C7-10 maxLength on password inputs
- C7-04 CSV results GC release

### Plan 47 (Deferred)
- C7-07 NULL capture_date prev/next navigation (legacy-only)
- C7-08 rate limit inconsistency in safe direction (by-design)

---

## Deferred Carry-Forward

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

## Notes

- Build verified passing after cycle 8 changes.
- All `confirm()` calls have been eliminated from the codebase.
- Cycle 8 found 9 actionable findings (1M + 8L), down from 7 in cycle 7. One MEDIUM finding (C8-01) was a false positive — the insertId guard was already present. 6 findings were implemented, 3 deferred.
- All topic server action error strings now use i18n consistently.
