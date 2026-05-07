# Aggregate Review — Cycle 1 (2026-04-19)

**Source reviews:** security-review-cycle1, code-quality-review-cycle1, performance-review-cycle1, ux-review-cycle1, data-integrity-review-cycle1

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Several findings appeared in multiple reviews. The highest severity/confidence is preserved:

| Unified ID | Reviews | Deduped Description | Final Severity |
|------------|---------|---------------------|----------------|
| U-01 | SEC-01, DI-02 | Per-file upload bypasses batch limits | MEDIUM |
| U-02 | SEC-04 | Search rate-limit TOCTOU | MEDIUM |
| U-03 | CQ-01, PERF-03, UX-05 | Preview URL recreation flash | MEDIUM |
| U-04 | CQ-02 | Unbounded claim retry in image queue | MEDIUM |
| U-05 | CQ-03, PERF-01 | N+1 queries for shared group tags | MEDIUM |
| U-06 | CQ-10 | Duplicated maxInputPixels with inconsistent defaults | MEDIUM |
| U-07 | UX-01 | No live touch-drag on bottom sheet | MEDIUM |
| U-08 | SEC-02 | Predictable backup filenames | LOW |
| U-09 | SEC-03, DI-04 | revokePhotoShareLink misleading error | LOW |
| U-10 | CQ-04 | Math.max spread in histogram | LOW |
| U-11 | CQ-05 | Deprecated execCommand fallback | LOW |
| U-12 | CQ-06 | IntersectionObserver recreated on hasMore | LOW |
| U-13 | CQ-07 | sessionStorage in useState hydration mismatch | LOW |
| U-14 | CQ-08 | adminExtraFields exported but unused | LOW |
| U-15 | CQ-09 | Connection limit docs mismatch | LOW |
| U-16 | DI-01 | bigint mode:'number' precision loss | LOW |
| U-17 | DI-03 | Orphaned topic image on cleanup failure | LOW |
| U-18 | PERF-05 | Enumerative revalidatePath for batch deletes | LOW |
| U-19 | UX-02 | Click preventDefault suppresses interactive children | LOW |
| U-20 | UX-03 | Fullscreen errors silently swallowed | LOW |
| U-21 | UX-04 | Stale refs accumulate across searches | LOW |

---

## PRIORITY REMEDIATION ORDER

### Must-fix (MEDIUM)

1. **U-01**: Fix per-file upload bypass — either batch files in single FormData or add session-level quota
2. **U-02**: Fix search rate-limit TOCTOU — move increment before DB check (same pattern as login fix)
3. **U-03**: Fix preview URL recreation — use incremental URL management
4. **U-04**: Cap claim retries in image queue — add `claimRetryCounts` Map
5. **U-05**: Fix N+1 tag queries in getSharedGroup — batch query with inArray
6. **U-06**: Unify maxInputPixels config — separate env var for topic images
7. **U-07**: Add touch-drag tracking to bottom sheet

### Should-fix (LOW)

8. U-08 through U-21 — see individual review files for details

---

## PREVIOUSLY FIXED — Confirmed Resolved (No Action Needed)

All findings from the previous comprehensive review (2026-04-19) that had commits have been verified as resolved. The following were identified as previously deferred and remain relevant:

- **C-01 / DI-01**: bigint precision — still present, LOW severity
- **C-07**: OG image rate limiting — documented as architectural decision, no code change
- **FS-02 / PERF-05**: Enumerative revalidatePath — LOW, not yet addressed
- **S-02 / U-03**: Preview URL flash — now captured as MEDIUM
- **S-03 / U-04**: Unbounded claim retry — now captured as MEDIUM
- **S-04 / U-07**: Bottom sheet touch drag — now captured as MEDIUM
- **S-08 / U-06**: Duplicated maxInputPixels — now captured as MEDIUM
- **S-09 / U-10**: Math.max spread — still LOW
- **S-10 / U-11**: Deprecated execCommand — still LOW
- **S-11 / U-21**: Stale search refs — still LOW
- **S-12 / U-20**: Fullscreen error handling — still LOW
- **S-13 / U-12**: IntersectionObserver recreation — still LOW
- **S-14 / U-13**: Hydration mismatch — still LOW
- **S-15 / U-19**: Click preventDefault — still LOW
- **R-01 / U-14**: adminExtraFields export — still LOW
- **D-10 / U-15**: Connection limit mismatch — still LOW

---

## AGENT FAILURES

None — all reviews completed successfully.

---

## TOTALS

- **7 MEDIUM** findings requiring implementation
- **14 LOW** findings recommended for implementation
- **0 CRITICAL/HIGH** findings (all previous CRITICAL/HIGH issues resolved)
- **21 total** unique findings
