# Plan 117 — Cycle 9 R2 Deferred Carry-Forward

**Created:** 2026-04-19 (Cycle 9 R2)
**Status:** DONE (carry-forward only)

---

## Deferred Items from Cycle 9 R2

No new items are deferred from cycle 9 R2 — all C9 findings are scheduled for implementation in Plan 116.

### One new item deferred from cycle 9 R2:

### C9R2-04: `queue_concurrency` setting has no effect on the live queue [LOW] [HIGH confidence]
- **Files:** `apps/web/src/lib/image-queue.ts` line 59, `apps/web/src/lib/gallery-config.ts` line 94
- **Original severity/confidence:** LOW / HIGH
- **Reason:** Changing PQueue concurrency at runtime requires careful testing — `PQueue` does not have an official `concurrency` setter. The `start({ concurrency })` method exists but its runtime behavior with active jobs is undocumented. Rushing this change could cause queue corruption. The setting is stored correctly in the DB and will take effect on server restart via the `QUEUE_CONCURRENCY` env var fallback. A proper fix needs a dedicated integration test.
- **Exit criterion:** After writing an integration test for PQueue concurrency changes, implement the live update via `queue.start({ concurrency: newValue })` or by replacing the queue instance.

### Previously deferred items (unchanged from cycle 39):

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
