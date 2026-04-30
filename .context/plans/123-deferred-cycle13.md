# Plan 123 — Cycle 13 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 13)
**Status:** DONE (carry-forward only)

---

## New Items Deferred from Cycle 13

### UX-13-02: Upload dropzone uses native `<select>` inconsistent with shadcn Select elsewhere [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/components/upload-dropzone.tsx` lines 223-232
- **Original severity/confidence:** LOW / MEDIUM
- **Reason:** Visual consistency improvement, not a bug. The native `<select>` is functional and accessible (has `htmlFor`/`id` pairing). Replacing it with shadcn's Select component requires restructuring the form state management since shadcn Select uses `onValueChange` instead of `onChange`, and the component needs to work inside the existing upload form layout. This is a UX polish item that can be done in a dedicated UI consistency pass.
- **Exit criterion:** When a UI consistency sweep is scheduled, or when the native select causes a specific usability complaint.

## Previously Deferred Items (Unchanged from Cycle 39)

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
- CR-39-02: `processImageFormats` unlink-before-link race window
