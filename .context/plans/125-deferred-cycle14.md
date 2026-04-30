# Plan 125 — Cycle 14 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 14)
**Status:** DONE (carry-forward only)

---

## New Items Deferred from Cycle 14

None — all findings from Cycle 14 are scheduled for implementation in Plan 124.

## Previously Deferred Items (Unchanged from Cycle 13)

- C14-01 / CR-39-02: `processImageFormats` unlink-before-link race window (being fixed this cycle via Plan 124)
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- UX-13-02: Upload dropzone uses native `<select>` inconsistent with shadcn Select
