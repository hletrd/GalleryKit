# Implementation Plans Index

## Active Plans

_None_

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
| **Cycle 4 Comprehensive Review** | 2026-04-19 | 9 actionable (2M/7L) | 9 complete via Plans 37-38 | 0 |
| Cycle 3 Comprehensive Review | 2026-04-19 | 12 (2M/10L) | 12 complete via Plans 35-36 | 0 |
| Comprehensive Code Review (full audit) | 2026-04-18 | 15 confirmed + 3 likely/risk | 15 confirmed + 2 low-risk likely fixes complete | 1 manual-validation risk (`/api/og` throttle architecture) |
| UI/UX Deep Review R7 | 2026-04-18 | 11 (6H/3M/2L) | Complete via Plan 26 | 0 |
| Comprehensive Review R6 | 2026-04-18 | 40 (2C/9H/18M/11L) | Complete | 0 |

---

## Cycle 4 Findings → Plan Mapping

### Plan 37 (Insert ID Consistency + Confirm Dialog)
- C4-01 admin-users.ts insertId BigInt inconsistency
- C4-02 db/page.tsx uses native confirm() for restore

### Plan 38 (Data Layer Caching + Rate-Limit Hardening)
- C4-03 getImageByShareKey called twice without cache
- C4-04 getSharedGroup called twice without cache
- C4-05 searchImagesAction DB increment fire-and-forget
- C4-06 No rate limit on share link creation
- C4-07 retryCounts/claimRetryCounts Maps grow unbounded
- C4-08 viewCountBuffer can accumulate during DB outage
- C4-09 uploadTracker prune is conditional

---

## Deferred Carry-Forward

1. U-15 connection limit docs mismatch (very low priority)
2. U-18 enumerative revalidatePath (low priority, current approach works)
3. /api/og throttle architecture (edge runtime, delegated to reverse proxy)
4. Font subsetting (Python brotli dependency issue)
5. Docker node_modules removal (native module dependency)

---

## Notes

- The `/api/og` architectural rate-limiting risk remains a separate manual-validation item unless a clean app-level design emerges during execution.
- Cycle 4 also fixed a pre-existing type error (`blur_data_url` made optional in `ImageDetail` interface) that was blocking TS compilation for `s/[key]/page.tsx`.
