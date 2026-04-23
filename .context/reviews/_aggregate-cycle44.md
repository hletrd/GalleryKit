# Aggregate Review — Cycle 44 (2026-04-20)

## Summary

Cycle 44 deep review of the full codebase by 10 specialized reviewers (code-reviewer, security-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, document-specialist, designer) found **2 new actionable issues** (1 MEDIUM, 1 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## New Findings (Deduplicated)

### C44-01/CR44-01/S44-01/CC44-01/V44-06/T44-02/T44-05/D44-01/D44-02/A44-01: Inconsistent `stripControlChars` application across action modules [MEDIUM] [HIGH confidence]
**Flagged by:** code-reviewer, security-reviewer, critic, verifier, tracer (2 flows), debugger (2 instances), architect (1 design issue) — **10 agent-findings agree on the same root cause**
**Files:**
- `apps/web/src/app/actions/auth.ts` line 70 — `login` username not sanitized
- `apps/web/src/app/actions/images.ts` line 58 — `uploadImages` topic slug not sanitized
- `apps/web/src/app/actions/topics.ts` line 99 — `updateTopic` currentSlug not sanitized
- `apps/web/src/app/actions/topics.ts` line 189 — `deleteTopic` slug not sanitized
**Description:** The `stripControlChars` function is applied consistently to tag names, topic labels, topic aliases, SEO settings, gallery settings, and image title/description. However, it is NOT applied to: (1) the username in `login()`, (2) the topic slug in `uploadImages()`, (3) the `currentSlug` parameter in `updateTopic()`, and (4) the `slug` parameter in `deleteTopic()`. While the `isValidSlug` regex effectively rejects control characters, and stored usernames are sanitized on creation, the defense-in-depth principle ("sanitize before validate") is violated. The most concerning gap is the `login` username, which reaches the audit log's `target_id` column without sanitization.
**Fix:** Apply `stripControlChars()` to all four locations before validation/query. This is a low-risk, high-consistency fix.

### S44-02/CC44-02: `searchImagesAction` applies `stripControlChars` after slice instead of before [LOW] [HIGH confidence]
**Flagged by:** security-reviewer, critic (2 agents agree)
**File:** `apps/web/src/app/actions/public.ts` line 94
**Description:** `stripControlChars(query.trim().slice(0, 200))` — the 200-char slice is applied before control character stripping, so the effective query may be shorter than 200 chars. The order should be strip first, then slice.
**Fix:** Change to `stripControlChars(query.trim())?.slice(0, 200) ?? ''`.

## Verified as Fixed (from prior cycles)

- C43-01/CR43-01 (LANG/LC_ALL locale in db-actions): **VERIFIED FIXED** — Hardcoded to `'C.UTF-8'`.
- CR43-02/S43-04 (escapeCsvField null bytes): **VERIFIED FIXED** — Control character stripping regex added.
- AGG-7 (lightbox keyboard navigation): **VERIFIED FIXED** (from earlier cycles).
- AGG-1 (privacy field separation): **VERIFIED FIXED** (from earlier cycles).

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-43 remain deferred with no change in status. Key deferred items still outstanding:
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
- D43-01: Backup file integrity verification after write

## Test Coverage Gaps (New)

- TE44-01: No unit test for `stripControlChars` (critical security utility)
- TE44-02: No integration test for upload→process→serve pipeline
- TE44-03: No test for `escapeCsvField` edge cases

## Recommended Priority for Implementation

1. **C44-01** — Apply `stripControlChars` consistently to all user inputs (MEDIUM, easy fix, 4 locations)
2. **S44-02** — Reorder strip-before-slice in `searchImagesAction` (LOW, trivial fix)
3. **TE44-01** — Add unit test for `stripControlChars` (LOW, important regression protection)

## Agent Failures

None — all 10 reviews completed successfully.
