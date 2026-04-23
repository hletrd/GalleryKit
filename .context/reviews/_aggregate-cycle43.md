# Aggregate Review — Cycle 43 (2026-04-20)

## Summary

Cycle 43 deep review of the full codebase by 9 specialized reviewers (code-reviewer, security-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, document-specialist, designer) found **2 new actionable issues** (1 MEDIUM, 1 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## New Findings (Deduplicated)

### C43-01/CR43-01/S43-01/D43-04/A43-01: `db-actions.ts` passes `LANG`/`LC_ALL` from process env to mysqldump/mysql child processes [MEDIUM] [HIGH confidence]
**Flagged by:** code-reviewer, security-reviewer, critic, debugger, architect (5 agents agree)
**Files:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 120, 312
**Description:** The explicit env objects for `mysqldump` and `mysql` child processes pass through `LANG: process.env.LANG` and `LC_ALL: process.env.LC_ALL` from the parent process. This is inconsistent with the `HOME` removal (commit 00000002b) which established the principle of minimizing env passthrough. Non-deterministic locale settings could cause backup/restore behavior to vary across server configurations, potentially leading to encoding mismatches between dump and restore operations.
**Fix:** Replace `LANG: process.env.LANG, LC_ALL: process.env.LC_ALL` with `LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'` for deterministic mysqldump/mysql behavior.

### CR43-02/S43-04: `escapeCsvField` does not strip null bytes and other non-\r\n control characters [LOW] [HIGH confidence]
**Flagged by:** critic, security-reviewer (2 agents agree)
**Files:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 20-29
**Description:** The CSV escaping function strips `\r\n` and handles formula injection, but does not strip null bytes (`\x00`) or other control characters (tab, etc.). Legacy data stored before `stripControlChars` was added could contain these characters. Some CSV parsers may misinterpret null bytes or other control characters.
**Fix:** Apply a control-character stripping regex like `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g` to values before the existing escape logic in `escapeCsvField`.

## Verified as Fixed (from prior cycles)

- AGG-7 (lightbox keyboard navigation): **VERIFIED FIXED** — Lightbox now handles ArrowLeft/ArrowRight/Escape/F keys with proper `window.addEventListener`. Focus management via FocusTrap is working.
- AGG-1 (privacy field separation): **VERIFIED FIXED** — `publicSelectFields` is correctly derived via destructuring with compile-time guard.
- C41-01/C41-02/C41-03/C42-01/C42-02/C42-03/C42-04 (stripControlChars for tags): **VERIFIED FIXED** — All tag operations now apply `stripControlChars` before validation.
- Plan-143 items (tmp cleanup, cleanString fix, topicRouteSegmentExists removal, TRUST_PROXY warning, revalidation empty string fix): **VERIFIED COMPLETE** per plan-143 status.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-42 remain deferred with no change in status. Key deferred items still outstanding:
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C30-03 (data) / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- CR-39-02: `processImageFormats` unlink-before-link race window
- D43-01: Backup file integrity verification after write (new this cycle, LOW)

## Agent Failures

None — all 9 reviews completed successfully.

## Recommended Priority for Implementation

1. **C43-01** — Set deterministic locale in mysqldump/mysql child processes (MEDIUM, easy fix)
2. **CR43-02** — Add control character stripping to `escapeCsvField` (LOW, easy fix)
