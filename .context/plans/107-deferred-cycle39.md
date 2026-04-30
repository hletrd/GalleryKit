# Plan 107 — Cycle 39 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 39)
**Status:** DONE (carry-forward only)

---

## Deferred Items from Cycle 39

All previously deferred items from cycles 5-38 remain deferred with no change in status. No new items are deferred from cycle 39 — all C39 findings are scheduled for implementation in Plan 106.

### One new item deferred from cycle 39:

### CR-39-02: `processImageFormats` unlink-before-link race window [LOW] [LOW confidence]
- **Files:** `apps/web/src/lib/process-image.ts` lines 381-389
- **Original severity/confidence:** LOW / LOW
- **Reason:** The processing queue has concurrency 1 and UUID-based filenames make concurrent access to the same file path practically impossible. The theoretical race window is extremely narrow. Fixing this requires a temp-file+rename pattern that adds complexity for no practical benefit.
- **Exit criterion:** If the processing queue is ever made concurrent per-file, or if file serving 404s are observed during processing.

### Previously deferred items (unchanged from cycle 38):

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
