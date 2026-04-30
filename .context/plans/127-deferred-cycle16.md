# Plan 127 — Cycle 16 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 16)
**Status:** DONE (carry-forward only)

---

## New Items Deferred from Cycle 16

- C16-02: `db-actions.ts` env passthrough includes `LANG` and `LC_ALL` [LOW] — Already tracked as CR-38-05. No new deferral needed.
- C16-05: `exportImagesCsv` holds up to 50K rows in memory [LOW] — Already tracked as PERF-38-02. No new deferral needed.
- C16-06: Base Sharp instance never explicitly released [LOW] — Informational; no action needed. Sharp manages its own resources.
- C16-07: `searchImages` uses `notInArray` with large exclusion set [LOW] — Informational; bounded by limit of 100. No action needed.

## Previously Deferred Items (Unchanged from Cycle 15)

- C6R2-F01: Full StorageBackend integration (HIGH)
- C6R2-F03: Gallery config integration into processing pipeline (HIGH)
- C6R2-F04: Zero tests for StorageBackend (HIGH)
- C6R2-F10: serve-upload.ts local-only filesystem access (MEDIUM)
- C6R2-F11: S3 writeStream materializes entire file in memory (MEDIUM)
- C6R2-F12: statfs always checks local disk (MEDIUM)
- C6R2-F13: S3 deleteMany uses individual deletes (LOW)
- C6R2-F14: Zero tests for settings/SEO actions (LOW)
- C6R2-C05: Settings page lacks unsaved-changes protection (LOW)
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
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C4-F03: `isReservedTopicRouteSegment` rarely used
- C4-F05: `loadMoreImages` offset cap may allow expensive tag queries
- C4-F06: `processImageFormats` creates 3 sharp instances (informational)
- C6-F03: Missing E2E tests for upload pipeline
