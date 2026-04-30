# Plan 134 — Cycle 30 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 30)
**Status:** DONE (carry-forward only)

---

## Deferred Items from Cycle 30

All previously deferred items from cycles 5-39 remain deferred with no change in status. No new items are deferred from cycle 30 — all C30 findings are scheduled for implementation in Plan 133.

### Previously deferred items (unchanged):

- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05 (auth): `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap — FIXED in prior cycle (dedicated PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS constant now exists)
- C30-03 (data) / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad — re-flagged as C30-02 this cycle, now scheduled for fix
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- CR-39-02: `processImageFormats` unlink-before-link race window
